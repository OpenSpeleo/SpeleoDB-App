/**
 * ProjectCacheService -- project-specific read/write layer on top of CacheStore.
 *
 * Knows the shape of project data and geojson entries; hides IndexedDB
 * details from the rest of the app.
 */

import { CacheStore, type CacheEntry } from './CacheStore';
import { ProjectGeoJSONRecordMemoryCache } from './ProjectGeoJSONRecordMemoryCache';
import type { Project } from '../types/project';
import type { MapOverlayId } from '../types/mapOverlay';
import type { LandmarkCollection } from '../types/landmark';
import type { RemoteGpsTrack } from '../types/gpsTrack';
import { PROJECT_GEOJSON_VALIDATION } from '../constants';
import type {
  ProjectGeoJSONAnalysis,
  ProjectGeoJSONCacheRecord,
  ProjectGeoJSONContentFailureReason,
  ProjectGeoJSONFailureDiagnostics,
  ProjectGeoJSONFileFailureReason,
} from '../types/projectGeoJSON';
import { isAbortError, throwIfAborted } from '../utils/abort';
import {
  longitudeIntervalSpanDegrees,
  webMercatorSpanKm,
} from '../utils/geographicBounds';

// ==================== Internal keys ====================

/** The projects list is stored under a single well-known key. */
const PROJECTS_LIST_KEY = 'list';
const OVERLAY_KEY_PREFIX = 'overlay:';
/**
 * Writable landmark collections cached during sync (in the `projects` store)
 * so the create form's collection picker still works offline. Cleared with the
 * rest of the cache on logout.
 */
const LANDMARK_COLLECTIONS_KEY = 'landmark-collections';
/**
 * Server GPS-track metadata list cached during sync (in the `projects` store)
 * so the unified track list still renders offline. Mirrors the landmark
 * collections key; the per-track GeoJSON geometry is cached separately under
 * `gps-track:<id>` in the `geojson` store.
 */
const GPS_TRACKS_KEY = 'gps-tracks';
const GPS_TRACK_GEOJSON_KEY_PREFIX = 'gps-track:';
const GEOJSON_STATE_META_KEY = 'projectGeoJSONState';
const GEOJSON_VALIDATION_VERSION_META_KEY = 'projectGeoJSONValidationVersion';
const GEOJSON_ANALYSIS_META_KEY = 'projectGeoJSONAnalysis';
const GEOJSON_FAILURE_DIAGNOSTICS_META_KEY = 'projectGeoJSONFailureDiagnostics';
const GEOJSON_FAILURE_REASON_META_KEY = 'projectGeoJSONFailureReason';
const GEOJSON_WARNING_ACKNOWLEDGED_META_KEY = 'projectGeoJSONWarningAcknowledged';
// Schema-v2 builds before the deadline policy correction persisted timeout
// quarantines at this threshold. Keep them readable so they can be retried.
const LEGACY_BBOX_TIMEOUT_MS = 500;

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isBounds(value: unknown): value is ProjectGeoJSONAnalysis['bounds'] {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Partial<ProjectGeoJSONAnalysis['bounds']>;
  if (
    typeof bounds.west !== 'number' || !Number.isFinite(bounds.west)
    || bounds.west < -180 || bounds.west > 180
    || typeof bounds.east !== 'number' || !Number.isFinite(bounds.east)
    || bounds.east < -180 || bounds.east > 180
    || typeof bounds.south !== 'number' || !Number.isFinite(bounds.south)
    || bounds.south < -90 || bounds.south > 90
    || typeof bounds.north !== 'number' || !Number.isFinite(bounds.north)
    || bounds.north < -90 || bounds.north > 90
    || bounds.south > bounds.north
    || typeof bounds.crossesDateline !== 'boolean'
  ) {
    return false;
  }
  const validBounds = bounds as ProjectGeoJSONAnalysis['bounds'];
  return validBounds.crossesDateline
    ? validBounds.west > validBounds.east
      && longitudeIntervalSpanDegrees(validBounds) > 0
    : validBounds.west <= validBounds.east;
}

function isAnalysis(value: unknown): value is ProjectGeoJSONAnalysis {
  if (!value || typeof value !== 'object') return false;
  const analysis = value as Partial<ProjectGeoJSONAnalysis>;
  return isBounds(analysis.bounds)
    && isNonNegativeFiniteNumber(analysis.widthKm)
    && analysis.widthKm <= PROJECT_GEOJSON_VALIDATION.MAX_WIDTH_KM
    && isNonNegativeFiniteNumber(analysis.heightKm)
    && analysis.heightKm <= PROJECT_GEOJSON_VALIDATION.MAX_HEIGHT_KM
    && isNonNegativeFiniteNumber(analysis.durationMs)
    && analysis.durationMs <= PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS
    && isProjectedFootprintSafe(analysis.bounds);
}

function parseProjectGeoJSONCacheRecord(
  entry: CacheEntry | null,
): ProjectGeoJSONCacheRecord {
  if (!entry) return { state: 'missing', commitId: null, data: null };

  const rawCommitId = entry.meta?.commitId;
  const commitId = isCommitId(rawCommitId) ? rawCommitId : null;
  const version = entry.meta?.[GEOJSON_VALIDATION_VERSION_META_KEY];
  const state = entry.meta?.[GEOJSON_STATE_META_KEY];
  if (version !== String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION) || !commitId) {
    return { state: 'legacy', commitId, data: entry.data };
  }

  const analysis = parseAnalysis(entry.meta?.[GEOJSON_ANALYSIS_META_KEY]);
  if (state === 'active' && analysis && isFeatureCollection(entry.data)) {
    return { state: 'active', commitId, data: entry.data, analysis };
  }

  const reason = entry.meta?.[GEOJSON_FAILURE_REASON_META_KEY];
  const diagnostics = parseFailureDiagnostics(
    entry.meta?.[GEOJSON_FAILURE_DIAGNOSTICS_META_KEY],
  );
  const warningAcknowledged = parseAcknowledged(
    entry.meta?.[GEOJSON_WARNING_ACKNOWLEDGED_META_KEY],
  );
  if (
    state === 'quarantined'
    && entry.data === null
    && isFileFailureReason(reason)
    && diagnostics
    && isFailureDiagnosticsForReason(reason, diagnostics)
    && warningAcknowledged !== null
  ) {
    return {
      state: 'quarantined',
      commitId,
      data: null,
      reason,
      diagnostics,
      warningAcknowledged,
    };
  }

  return { state: 'legacy', commitId, data: entry.data };
}

function isProjectedFootprintSafe(bounds: ProjectGeoJSONAnalysis['bounds']): boolean {
  const { xKm, yKm } = webMercatorSpanKm(bounds);
  return Number.isFinite(xKm)
    && xKm >= 0
    && xKm <= PROJECT_GEOJSON_VALIDATION.MAX_MERCATOR_X_SPAN_KM
    && Number.isFinite(yKm)
    && yKm >= 0
    && yKm <= PROJECT_GEOJSON_VALIDATION.MAX_MERCATOR_Y_SPAN_KM;
}

function parseAnalysis(value: string | undefined): ProjectGeoJSONAnalysis | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isAnalysis(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFileFailureReason(value: string | undefined): value is ProjectGeoJSONFileFailureReason {
  return value === 'bbox_too_large'
    || value === 'bbox_timeout'
    || value === 'invalid_geojson'
    || value === 'no_coordinates'
    || value === 'bbox_error';
}

function isContentFailureReason(
  value: string | undefined,
): value is ProjectGeoJSONContentFailureReason {
  return value === 'bbox_too_large'
    || value === 'invalid_geojson'
    || value === 'no_coordinates'
    || value === 'bbox_error';
}

function isNullableMetric(value: unknown): value is number | null {
  return value === null || isNonNegativeFiniteNumber(value);
}

function isFailureDiagnostics(value: unknown): value is ProjectGeoJSONFailureDiagnostics {
  if (!value || typeof value !== 'object') return false;
  const diagnostics = value as Partial<ProjectGeoJSONFailureDiagnostics>;
  return (diagnostics.bounds === null || isBounds(diagnostics.bounds))
    && isNullableMetric(diagnostics.widthKm)
    && isNullableMetric(diagnostics.heightKm)
    && isNullableMetric(diagnostics.durationMs);
}

function isFailureDiagnosticsForReason(
  reason: ProjectGeoJSONFileFailureReason,
  diagnostics: ProjectGeoJSONFailureDiagnostics,
): boolean {
  if (reason === 'bbox_too_large') {
    return diagnostics.bounds !== null
      && diagnostics.widthKm !== null
      && diagnostics.heightKm !== null
      && diagnostics.durationMs !== null
      && (
        diagnostics.widthKm > PROJECT_GEOJSON_VALIDATION.MAX_WIDTH_KM
        || diagnostics.heightKm > PROJECT_GEOJSON_VALIDATION.MAX_HEIGHT_KM
      );
  }
  if (reason === 'bbox_timeout') {
    return diagnostics.durationMs !== null
      && diagnostics.durationMs >= LEGACY_BBOX_TIMEOUT_MS;
  }
  return true;
}

function parseFailureDiagnostics(value: string | undefined): ProjectGeoJSONFailureDiagnostics | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isFailureDiagnostics(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseAcknowledged(value: string | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function isCommitId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { type?: unknown }).type === 'FeatureCollection'
    && Array.isArray((value as { features?: unknown }).features),
  );
}

// ==================== Service ====================

export interface CacheOperationOptions {
  signal?: AbortSignal
}

export class ProjectCacheService {
  private store: CacheStore;
  private readonly projectRecords = new ProjectGeoJSONRecordMemoryCache();

  constructor(store?: CacheStore) {
    this.store = store ?? new CacheStore();
  }

  // ---- Projects list ----------------------------------------------------------

  /** Read the cached projects array, or null if nothing is cached. */
  async getProjects(options: CacheOperationOptions = {}): Promise<Project[] | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get<Project[]>('projects', PROJECTS_LIST_KEY);
      throwIfAborted(options.signal)
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.getProjects failed:', error);
      return null;
    }
  }

  /** Overwrite the cached projects list. */
  async setProjects(projects: Project[], options: CacheOperationOptions = {}): Promise<boolean> {
    throwIfAborted(options.signal)
    try {
      await this.store.set('projects', PROJECTS_LIST_KEY, {
        data: projects,
        cachedAt: Date.now(),
      }, options);
      throwIfAborted(options.signal)
      return true
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.setProjects failed:', error);
      return false
    }
  }

  // ---- GeoJSON files ----------------------------------------------------------

  /** Read a cached geojson payload for a project, or null if not cached. */
  async getGeoJSON(projectId: string, options: CacheOperationOptions = {}): Promise<unknown | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get('geojson', projectId);
      throwIfAborted(options.signal)
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.getGeoJSON failed:', error);
      return null;
    }
  }

  /** Write a geojson payload, tagged with the commit ID that produced it. */
  async setGeoJSON(
    projectId: string,
    data: unknown,
    commitId: string,
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal)
    try {
      await this.store.set('geojson', projectId, {
        data,
        cachedAt: Date.now(),
        meta: { commitId },
      }, options);
      throwIfAborted(options.signal)
      this.projectRecords.publish(projectId, {
        state: 'legacy',
        commitId: isCommitId(commitId) ? commitId : null,
        data,
      });
      return true
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.setGeoJSON failed:', error);
      return false
    }
  }

  /** Read the complete validation state for one project GeoJSON cache entry. */
  async getProjectGeoJSONRecord(
    projectId: string,
    options: CacheOperationOptions = {},
  ): Promise<ProjectGeoJSONCacheRecord> {
    throwIfAborted(options.signal);
    try {
      const record = await this.projectRecords.get(projectId, async () => {
        const entry = await this.store.get('geojson', projectId);
        return parseProjectGeoJSONCacheRecord(entry);
      });
      throwIfAborted(options.signal);
      return record;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal);
      }
      throw error;
    }
  }

  /** Persist normalized GeoJSON together with its validated, unpadded bounds. */
  async setValidatedProjectGeoJSON(
    projectId: string,
    data: GeoJSON.FeatureCollection,
    commitId: string,
    analysis: ProjectGeoJSONAnalysis,
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal);
    if (!isCommitId(commitId) || !isFeatureCollection(data) || !isAnalysis(analysis)) {
      return false;
    }
    try {
      await this.store.set('geojson', projectId, {
        data,
        cachedAt: Date.now(),
        meta: {
          commitId,
          [GEOJSON_STATE_META_KEY]: 'active',
          [GEOJSON_VALIDATION_VERSION_META_KEY]:
            String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION),
          [GEOJSON_ANALYSIS_META_KEY]: JSON.stringify(analysis),
        },
      }, options);
      throwIfAborted(options.signal);
      this.projectRecords.publish(projectId, {
        state: 'active',
        commitId,
        data,
        analysis,
      });
      return true;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error('ProjectCacheService.setValidatedProjectGeoJSON failed:', error);
      return false;
    }
  }

  /** Replace proven-unsafe GeoJSON bytes with a durable, per-commit quarantine marker. */
  async setQuarantinedProjectGeoJSON(
    projectId: string,
    commitId: string,
    reason: ProjectGeoJSONContentFailureReason,
    diagnostics: ProjectGeoJSONFailureDiagnostics,
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal);
    if (
      !isCommitId(commitId)
      || !isContentFailureReason(reason)
      || !isFailureDiagnostics(diagnostics)
      || !isFailureDiagnosticsForReason(reason, diagnostics)
    ) {
      return false;
    }
    try {
      await this.store.set('geojson', projectId, {
        data: null,
        cachedAt: Date.now(),
        meta: {
          commitId,
          [GEOJSON_STATE_META_KEY]: 'quarantined',
          [GEOJSON_VALIDATION_VERSION_META_KEY]:
            String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION),
          [GEOJSON_FAILURE_REASON_META_KEY]: reason,
          [GEOJSON_FAILURE_DIAGNOSTICS_META_KEY]: JSON.stringify(diagnostics),
          [GEOJSON_WARNING_ACKNOWLEDGED_META_KEY]: 'false',
        },
      }, options);
      throwIfAborted(options.signal);
      this.projectRecords.publish(projectId, {
        state: 'quarantined',
        commitId,
        data: null,
        reason,
        diagnostics,
        warningAcknowledged: false,
      });
      return true;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error('ProjectCacheService.setQuarantinedProjectGeoJSON failed:', error);
      return false;
    }
  }

  /** Acknowledge only the quarantine version the user actually saw. */
  async acknowledgeProjectGeoJSONQuarantine(
    projectId: string,
    commitId: string,
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal);
    try {
      const updated = await this.store.update('geojson', projectId, (entry) => {
        const reason = entry?.meta?.[GEOJSON_FAILURE_REASON_META_KEY];
        const diagnostics = parseFailureDiagnostics(
          entry?.meta?.[GEOJSON_FAILURE_DIAGNOSTICS_META_KEY],
        );
        const acknowledged = parseAcknowledged(
          entry?.meta?.[GEOJSON_WARNING_ACKNOWLEDGED_META_KEY],
        );
        if (
          !entry
          || entry.data !== null
          || entry.meta?.commitId !== commitId
          || entry.meta?.[GEOJSON_STATE_META_KEY] !== 'quarantined'
          || entry.meta?.[GEOJSON_VALIDATION_VERSION_META_KEY]
            !== String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION)
          || !isFileFailureReason(reason)
          || !diagnostics
          || !isFailureDiagnosticsForReason(reason, diagnostics)
          || acknowledged === null
        ) {
          return null;
        }
        return {
          ...entry,
          meta: {
            ...entry.meta,
            [GEOJSON_WARNING_ACKNOWLEDGED_META_KEY]: 'true',
          },
        };
      }, options);
      throwIfAborted(options.signal);
      if (updated) {
        const cached = this.projectRecords.peek(projectId);
        if (
          cached?.state === 'quarantined'
          && cached.commitId === commitId
        ) {
          this.projectRecords.publish(projectId, {
            ...cached,
            warningAcknowledged: true,
          });
        } else {
          this.projectRecords.invalidate(projectId);
        }
      }
      return updated;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error(
        `ProjectCacheService.acknowledgeProjectGeoJSONQuarantine(${projectId}) failed:`,
        error,
      );
      return false;
    }
  }

  /** Return the commit ID stored alongside a project's geojson, or null. */
  async getCachedCommitId(projectId: string, options: CacheOperationOptions = {}): Promise<string | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get('geojson', projectId);
      throwIfAborted(options.signal)
      return entry?.meta?.commitId ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      return null;
    }
  }

  // ---- Shared read-only map overlays -----------------------------------------

  /** Read a cached overlay payload, or null if not cached. */
  async getOverlayGeoJSON(
    overlayId: MapOverlayId,
    options: CacheOperationOptions = {},
  ): Promise<unknown | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get('geojson', this.getOverlayCacheKey(overlayId));
      throwIfAborted(options.signal)
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.getOverlayGeoJSON failed:', error);
      return null;
    }
  }

  /** Strict read for rolling offline-map replacement; storage errors must abort replacement. */
  async getOverlayGeoJSONForOfflineMap(
    overlayId: MapOverlayId,
    options: CacheOperationOptions = {},
  ): Promise<unknown | null> {
    throwIfAborted(options.signal);
    const entry = await this.store.get('geojson', this.getOverlayCacheKey(overlayId));
    throwIfAborted(options.signal);
    return entry?.data ?? null;
  }

  /** Write an overlay GeoJSON payload. */
  async setOverlayGeoJSON(
    overlayId: MapOverlayId,
    data: unknown,
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal)
    try {
      await this.store.set('geojson', this.getOverlayCacheKey(overlayId), {
        data,
        cachedAt: Date.now(),
      }, options);
      throwIfAborted(options.signal)
      return true
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.setOverlayGeoJSON failed:', error);
      return false
    }
  }

  /**
   * Atomically mutate one overlay FeatureCollection. Storage and schema errors
   * are authoritative: callers must not publish a confirmed server mutation
   * unless this transaction completes.
   */
  async updateOverlayFeatureCollection(
    overlayId: MapOverlayId,
    updater: (
      current: GeoJSON.FeatureCollection | null,
    ) => GeoJSON.FeatureCollection,
    options: CacheOperationOptions = {},
  ): Promise<GeoJSON.FeatureCollection> {
    throwIfAborted(options.signal);
    let result: GeoJSON.FeatureCollection | undefined;
    const updated = await this.store.update<GeoJSON.FeatureCollection>(
      'geojson',
      this.getOverlayCacheKey(overlayId),
      (entry) => {
        const currentData = entry?.data ?? null;
        if (currentData !== null && !isFeatureCollection(currentData)) {
          throw new Error(`Cached ${overlayId} overlay is not a FeatureCollection.`);
        }
        const next = updater(currentData as GeoJSON.FeatureCollection | null);
        if (!isFeatureCollection(next)) {
          throw new Error(`Updated ${overlayId} overlay is not a FeatureCollection.`);
        }
        result = next;
        return {
          ...(entry ?? {}),
          data: next,
          cachedAt: Date.now(),
        };
      },
      options,
    );
    throwIfAborted(options.signal);
    if (!updated || !result) {
      throw new Error(`Atomic ${overlayId} overlay update did not commit.`);
    }
    return result;
  }

  // ---- Writable landmark collections (offline create picker) ------------------

  /** Read the cached writable landmark collections, or null if none cached. */
  async getLandmarkCollections(
    options: CacheOperationOptions = {},
  ): Promise<LandmarkCollection[] | null> {
    throwIfAborted(options.signal);
    try {
      const entry = await this.store.get<LandmarkCollection[]>('projects', LANDMARK_COLLECTIONS_KEY);
      throwIfAborted(options.signal);
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error('ProjectCacheService.getLandmarkCollections failed:', error);
      return null;
    }
  }

  /** Cache the writable landmark collections (overwrites). */
  async setLandmarkCollections(
    collections: LandmarkCollection[],
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal);
    try {
      await this.store.set('projects', LANDMARK_COLLECTIONS_KEY, {
        data: collections,
        cachedAt: Date.now(),
      }, options);
      throwIfAborted(options.signal);
      return true;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error('ProjectCacheService.setLandmarkCollections failed:', error);
      return false;
    }
  }

  // ---- Server GPS tracks (synced list + lazy geometry) ------------------------

  /** Read the cached server GPS-track metadata list, or null if none cached. */
  async getGpsTracks(options: CacheOperationOptions = {}): Promise<RemoteGpsTrack[] | null> {
    throwIfAborted(options.signal);
    try {
      const entry = await this.store.get<RemoteGpsTrack[]>('projects', GPS_TRACKS_KEY);
      throwIfAborted(options.signal);
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error('ProjectCacheService.getGpsTracks failed:', error);
      return null;
    }
  }

  /** Cache the server GPS-track metadata list (overwrites). */
  async setGpsTracks(
    tracks: RemoteGpsTrack[],
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal);
    try {
      await this.store.set('projects', GPS_TRACKS_KEY, {
        data: tracks,
        cachedAt: Date.now(),
      }, options);
      throwIfAborted(options.signal);
      return true;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error('ProjectCacheService.setGpsTracks failed:', error);
      return false;
    }
  }

  /** Atomically mutate the confirmed server GPS-track list. */
  async updateGpsTracks(
    updater: (current: RemoteGpsTrack[] | null) => RemoteGpsTrack[],
    options: CacheOperationOptions = {},
  ): Promise<RemoteGpsTrack[]> {
    throwIfAborted(options.signal);
    let result: RemoteGpsTrack[] | undefined;
    const updated = await this.store.update<RemoteGpsTrack[]>(
      'projects',
      GPS_TRACKS_KEY,
      (entry) => {
        const currentData = entry?.data ?? null;
        if (currentData !== null && !Array.isArray(currentData)) {
          throw new Error('Cached GPS track list is invalid.');
        }
        const next = updater(currentData as RemoteGpsTrack[] | null);
        if (!Array.isArray(next)) {
          throw new Error('Updated GPS track list is invalid.');
        }
        result = next;
        return {
          ...(entry ?? {}),
          data: next,
          cachedAt: Date.now(),
        };
      },
      options,
    );
    throwIfAborted(options.signal);
    if (!updated || !result) {
      throw new Error('Atomic GPS track update did not commit.');
    }
    return result;
  }

  /** Read a cached GPS-track GeoJSON geometry by track id, or null. */
  async getGpsTrackGeoJSON(
    trackId: string,
    options: CacheOperationOptions = {},
  ): Promise<unknown | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get('geojson', this.getGpsTrackGeoJSONKey(trackId));
      throwIfAborted(options.signal)
      const stored = entry?.data as unknown;
      if (
        stored
        && typeof stored === 'object'
        && 'geojson' in stored
      ) {
        return (stored as { geojson: unknown }).geojson;
      }
      return stored ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.getGpsTrackGeoJSON failed:', error);
      return null;
    }
  }

  /** Cache a GPS-track GeoJSON geometry by track id. */
  async setGpsTrackGeoJSON(
    trackId: string,
    data: unknown,
    sha256 = '',
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal)
    try {
      await this.store.set('geojson', this.getGpsTrackGeoJSONKey(trackId), {
        data: { geojson: data, sha256 },
        cachedAt: Date.now(),
      }, options);
      throwIfAborted(options.signal)
      return true
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.setGpsTrackGeoJSON failed:', error);
      return false
    }
  }

  /** Read geometry together with the server content identity used to cache it. */
  async getGpsTrackGeoJSONRecord(
    trackId: string,
    options: CacheOperationOptions = {},
  ): Promise<{ geojson: unknown; sha256: string } | null> {
    throwIfAborted(options.signal);
    try {
      const entry = await this.store.get('geojson', this.getGpsTrackGeoJSONKey(trackId));
      throwIfAborted(options.signal);
      const stored = entry?.data as unknown;
      if (
        stored
        && typeof stored === 'object'
        && 'geojson' in stored
      ) {
        const record = stored as { geojson: unknown; sha256?: unknown };
        return {
          geojson: record.geojson,
          sha256: typeof record.sha256 === 'string' ? record.sha256 : '',
        };
      }
      return stored === undefined || stored === null
        ? null
        : { geojson: stored, sha256: '' };
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      throw error;
    }
  }

  /** Remove a cached GPS-track GeoJSON geometry by track id (best-effort). */
  async removeGpsTrackGeoJSON(
    trackId: string,
    options: CacheOperationOptions = {},
  ): Promise<void> {
    throwIfAborted(options.signal);
    try {
      await this.store.delete('geojson', this.getGpsTrackGeoJSONKey(trackId), options);
      throwIfAborted(options.signal);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throwIfAborted(options.signal);
      console.error('ProjectCacheService.removeGpsTrackGeoJSON failed:', error);
    }
  }

  // ---- Housekeeping -----------------------------------------------------------

  /**
   * Wipe all cached projects, geojson, queued offline ops, and recorded GPS
   * tracks (e.g. on logout).
   */
  async clearAll(options: CacheOperationOptions = {}): Promise<void> {
    throwIfAborted(options.signal);
    this.projectRecords.clear();
    const results = await Promise.allSettled([
      this.store.clear('projects', options),
      this.store.clear('geojson', options),
      this.store.clear('offline_ops', options),
      this.store.clear('gps_tracks', options),
    ]);
    throwIfAborted(options.signal);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('Local cache deletion did not complete.');
    }
  }

  private getOverlayCacheKey(overlayId: MapOverlayId): string {
    return `${OVERLAY_KEY_PREFIX}${overlayId}`;
  }

  private getGpsTrackGeoJSONKey(trackId: string): string {
    return `${GPS_TRACK_GEOJSON_KEY_PREFIX}${trackId}`;
  }
}
