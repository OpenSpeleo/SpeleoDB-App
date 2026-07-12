import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { GpsTrackStore } from '../services/GpsTrackStore';
import type { GpsTrackGpxFile, GpsTrackGpxService } from '../services/GpsTrackGpxService';
import type {
  GpsTrackListItem,
  GpsTrackSnapshot,
  LocalGpsTrack,
  RecordedPoint,
  RemoteGpsTrack,
} from '../types/gpsTrack';
import { gpsTrackGeoJsonToPoints } from '../utils/gpsTrackGeoJson';
import { normalizeHexColor } from '../utils/gpsTrackColors';
import { summarizeTrack } from '../utils/gpsTrackStats';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { parseRemoteGpsTrack } from '../utils/remoteGpsTrack';
import { snapshotFromRemote } from '../offline/gpsTrackSnapshot';
import { isAbortError, throwIfAborted } from '../utils/abort';
import type { OfflineMutationCoordinator } from './OfflineMutationCoordinator';

export interface GpsTrackPrefetchSource {
  targetKind: 'gps-track-local' | 'gps-track-server';
  targetId: string;
  sourceRevision: string;
  paths: Array<Array<[number, number]>>;
}

export class OfflineMapGpsGeometryUnavailableError extends Error {
  constructor(trackId: string, reason: string) {
    super(`GPS track ${trackId} is unavailable for offline-map planning: ${reason}`);
    this.name = 'OfflineMapGpsGeometryUnavailableError';
  }
}

function signalOptions(signal?: AbortSignal): [] | [{ signal: AbortSignal }] {
  return signal ? [{ signal }] : [];
}

interface GpsTrackCoordinatorDependencies {
  store: GpsTrackStore;
  cache: ProjectCacheService;
  transport: Pick<SpeleoDBService, 'downloadJSON'>;
  gpx: GpsTrackGpxService;
  mutations: OfflineMutationCoordinator;
  hasNetworkAccess(): boolean;
  isSessionActive(): boolean;
  isPurging(): boolean;
  now(): number;
  notifyStateChanged(): void;
}

/** Owns local/remote GPS track state, persistence, geometry, and UI snapshots. */
export class GpsTrackCoordinator {
  private localTracks: LocalGpsTrack[] = [];
  private remoteTracks: RemoteGpsTrack[] = [];
  private trackSnapshot: GpsTrackListItem[] = [];
  private _revision = 0;
  private loadGeneration = 0;
  private persistGeneration = 0;
  private persistQueue: Promise<void> | null = null;

  constructor(private readonly dependencies: GpsTrackCoordinatorDependencies) {}

  get tracks(): GpsTrackListItem[] {
    return this.trackSnapshot;
  }

  get revision(): number {
    return this._revision;
  }

  get hasPendingPersistence(): boolean {
    return this.persistQueue !== null;
  }

  load(): Promise<void> {
    const generation = this.loadGeneration;
    const local = this.dependencies.store.list()
      .then((tracks) => {
        if (tracks.length > 0 && this.canPublishLoad(generation)) {
          this.localTracks = tracks;
          this.bump();
        }
      })
      .catch((error) => console.warn('Failed to load GPS tracks:', error));
    const remote = this.dependencies.cache.getGpsTracks()
      .then((tracks) => {
        if (tracks && tracks.length > 0 && this.canPublishLoad(generation)) {
          this.remoteTracks = tracks;
          this.bump();
        }
      })
      .catch((error) => console.warn('Failed to load cached GPS tracks:', error));
    return Promise.all([local, remote]).then(() => undefined);
  }

  localTrack(id: string): LocalGpsTrack | null {
    return this.localTracks.find((track) => track.id === id) ?? null;
  }

  remoteSnapshot(id: string): GpsTrackSnapshot | null {
    const track = this.remoteTracks.find((candidate) => candidate.id === id);
    return track ? snapshotFromRemote(track) : null;
  }

  addCompletedTrack(track: LocalGpsTrack): void {
    this.localTracks = [track, ...this.localTracks];
  }

  recordingStateChanged(): void {
    this.bump();
  }

  offlineMutationChanged(): void {
    this.bump(false);
  }

  enqueuePersist(track: LocalGpsTrack): Promise<void> {
    const run = () => this.persist(track);
    const queued = this.persistQueue ? this.persistQueue.then(run, run) : run();
    const trackedQueue = queued.finally(() => {
      if (this.persistQueue === trackedQueue) this.persistQueue = null;
    });
    this.persistQueue = trackedQueue;
    return trackedQueue;
  }

  removePersisted(id: string): Promise<void> {
    return this.dependencies.store.remove(id);
  }

  invalidatePersistence(): void {
    this.persistGeneration += 1;
  }

  async waitForPersistence(): Promise<void> {
    while (this.persistQueue) await this.persistQueue;
  }

  resetForLogout(): void {
    this.loadGeneration += 1;
    this.invalidatePersistence();
    this.localTracks = [];
    this.remoteTracks = [];
    this.bump(false);
  }

  async updateLocal(
    id: string,
    patch: Partial<LocalGpsTrack>,
    signal?: AbortSignal,
  ): Promise<LocalGpsTrack | null> {
    throwIfAborted(signal);
    const index = this.localTracks.findIndex((track) => track.id === id);
    if (index === -1) return null;
    const updated: LocalGpsTrack = {
      ...this.localTracks[index],
      ...patch,
      updatedAt: this.dependencies.now(),
    };
    await this.enqueuePersist(updated);
    throwIfAborted(signal);
    this.localTracks = [
      ...this.localTracks.slice(0, index),
      updated,
      ...this.localTracks.slice(index + 1),
    ];
    this.bump();
    return updated;
  }

  async removeLocal(id: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.dependencies.store.remove(id);
    throwIfAborted(signal);
    const next = this.localTracks.filter((track) => track.id !== id);
    if (next.length === this.localTracks.length) return;
    this.localTracks = next;
    this.bump();
  }

  async replaceRemote(tracks: RemoteGpsTrack[], signal?: AbortSignal): Promise<void> {
    await this.cacheRemote(tracks, signal);
    throwIfAborted(signal);
    this.publishRemote(tracks);
  }

  async cacheRemote(tracks: RemoteGpsTrack[], signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.dependencies.cache.setGpsTracks(tracks, ...signalOptions(signal));
    throwIfAborted(signal);
  }

  publishRemote(tracks: RemoteGpsTrack[]): void {
    this.remoteTracks = tracks;
    this.bump();
  }

  async applyRemoteUpsert(track: RemoteGpsTrack, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const next = await this.dependencies.cache.updateGpsTracks((current) => {
      const list = current ?? [];
      const index = list.findIndex((candidate) => candidate.id === track.id);
      return index === -1
        ? [track, ...list]
        : [...list.slice(0, index), { ...list[index], ...track }, ...list.slice(index + 1)];
    }, ...signalOptions(signal));
    throwIfAborted(signal);
    this.remoteTracks = next;
    this.bump();
  }

  async applyRemoteRemoval(id: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const next = await this.dependencies.cache.updateGpsTracks(
      (current) => (current ?? []).filter((track) => track.id !== id),
      ...signalOptions(signal),
    );
    throwIfAborted(signal);
    this.remoteTracks = next;
    await this.dependencies.cache.removeGpsTrackGeoJSON(id, ...signalOptions(signal));
    throwIfAborted(signal);
    this.bump();
  }

  mergeRemote(
    id: string,
    next: GpsTrackSnapshot,
    responseData: unknown,
  ): RemoteGpsTrack {
    const parsed = parseRemoteGpsTrack(responseData);
    const existing = this.remoteTracks.find((track) => track.id === id) ?? null;
    const base: RemoteGpsTrack = existing ?? {
      id,
      name: next.name,
      color: next.color,
      fileUrl: '',
      sha256: '',
      createdAt: 0,
      updatedAt: 0,
    };
    return {
      ...base,
      id,
      name: next.name,
      color: next.color,
      fileUrl: base.fileUrl || parsed?.fileUrl || '',
      sha256: base.sha256 || parsed?.sha256 || '',
      updatedAt: parsed?.updatedAt || this.dependencies.now(),
    };
  }

  buildLocalGpx(track: LocalGpsTrack): Promise<GpsTrackGpxFile> {
    return this.dependencies.gpx.buildFile(track);
  }

  async buildGpxFile(item: GpsTrackListItem, signal?: AbortSignal): Promise<GpsTrackGpxFile> {
    throwIfAborted(signal);
    const local = this.localTrack(item.id);
    if (local) return this.buildLocalGpx(local);
    const points = await this.getPoints(item.id, signal);
    throwIfAborted(signal);
    return this.buildLocalGpx({
      id: item.id,
      name: item.name,
      color: item.color,
      points,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  async getPoints(id: string, signal?: AbortSignal): Promise<RecordedPoint[]> {
    throwIfAborted(signal);
    const local = this.localTrack(id);
    if (local) return [...local.points];
    const geojson = await this.getGeoJSON(id, signal);
    throwIfAborted(signal);
    return geojson ? gpsTrackGeoJsonToPoints(geojson) : [];
  }

  async getGeoJSON(id: string, signal?: AbortSignal): Promise<GeoJSON.FeatureCollection | null> {
    throwIfAborted(signal);
    if (this.localTrack(id)) return null;
    const remote = this.remoteTracks.find((track) => track.id === id);
    const cached = await this.dependencies.cache.getGpsTrackGeoJSON(
      id,
      ...signalOptions(signal),
    );
    throwIfAborted(signal);
    if (cached) {
      const normalizedCache = normalizeGeoJSON(cached);
      if (normalizedCache) return normalizedCache;
    }
    if (!remote?.fileUrl || !this.dependencies.hasNetworkAccess()) return null;
    try {
      const response = await this.dependencies.transport.downloadJSON(
        remote.fileUrl,
        ...signalOptions(signal),
      );
      throwIfAborted(signal);
      if (!isSuccessfulStatus(response.status)) return null;
      const normalized = normalizeGeoJSON(response.data);
      if (!normalized) return null;
      await this.dependencies.cache.setGpsTrackGeoJSON(
        id,
        normalized,
        remote.sha256,
        ...signalOptions(signal),
      );
      throwIfAborted(signal);
      return normalized;
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('Failed to download GPS track GeoJSON:', error);
      return null;
    }
  }

  /**
   * Build durable local/server GPS inputs for offline tile planning. Remote
   * geometry is eagerly refreshed when its server SHA changes, with bounded
   * concurrency so a large account does not flood the transport.
   */
  async getPrefetchSources(signal?: AbortSignal): Promise<GpsTrackPrefetchSource[]> {
    throwIfAborted(signal);
    const sources: GpsTrackPrefetchSource[] = this.localTracks.map((track) => ({
      targetKind: 'gps-track-local' as const,
      targetId: track.id,
      sourceRevision: `${track.updatedAt}`,
      paths: [track.points.map((point) => [point.longitude, point.latitude] as [number, number])],
    }));

    let cursor = 0;
    const remoteSources: GpsTrackPrefetchSource[] = [];
    const workers = Array.from(
      { length: Math.min(3, this.remoteTracks.length) },
      async () => {
        while (cursor < this.remoteTracks.length) {
          const track = this.remoteTracks[cursor];
          cursor += 1;
          throwIfAborted(signal);
          const geometry = await this.loadRemoteGeometryForPrefetch(track, signal);
          throwIfAborted(signal);
          if (!geometry) continue;
          const paths = linePathsFromGeoJSON(geometry);
          if (paths.length === 0) continue;
          remoteSources.push({
            targetKind: 'gps-track-server',
            targetId: track.id,
            sourceRevision: track.sha256 || `${track.updatedAt}`,
            paths,
          });
        }
      },
    );
    await Promise.all(workers);
    return [...sources, ...remoteSources];
  }

  private async loadRemoteGeometryForPrefetch(
    track: RemoteGpsTrack,
    signal?: AbortSignal,
  ): Promise<GeoJSON.FeatureCollection | null> {
    if (!track.sha256) {
      throw new OfflineMapGpsGeometryUnavailableError(track.id, 'server SHA unavailable');
    }
    const cached = await this.getCachedGeometryRecord(track.id, signal);
    if (cached?.sha256 === track.sha256) {
      const normalized = normalizeGeoJSON(cached.geojson);
      if (normalized) return normalized;
    }
    if (!track.fileUrl) {
      throw new OfflineMapGpsGeometryUnavailableError(track.id, 'download URL unavailable');
    }
    if (!this.dependencies.hasNetworkAccess()) {
      throw new OfflineMapGpsGeometryUnavailableError(track.id, 'network unavailable');
    }
    try {
      const response = await this.dependencies.transport.downloadJSON(track.fileUrl, { signal });
      throwIfAborted(signal);
      if (!isSuccessfulStatus(response.status)) {
        throw new OfflineMapGpsGeometryUnavailableError(
          track.id,
          `HTTP ${response.status}`,
        );
      }
      const normalized = normalizeGeoJSON(response.data);
      if (!normalized) {
        throw new OfflineMapGpsGeometryUnavailableError(track.id, 'invalid GeoJSON');
      }
      const cachedSuccessfully = await this.dependencies.cache.setGpsTrackGeoJSON(
        track.id,
        normalized,
        track.sha256,
        { signal },
      );
      if (!cachedSuccessfully) {
        throw new OfflineMapGpsGeometryUnavailableError(track.id, 'cache write failed');
      }
      return normalized;
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throwIfAborted(signal);
      if (error instanceof OfflineMapGpsGeometryUnavailableError) throw error;
      throw new OfflineMapGpsGeometryUnavailableError(
        track.id,
        error instanceof Error ? error.message : 'unknown failure',
      );
    }
  }

  private async getCachedGeometryRecord(
    trackId: string,
    signal?: AbortSignal,
  ): Promise<{ geojson: unknown; sha256: string } | null> {
    const cache = this.dependencies.cache as ProjectCacheService & {
      getGpsTrackGeoJSONRecord?: ProjectCacheService['getGpsTrackGeoJSONRecord'];
    };
    if (typeof cache.getGpsTrackGeoJSONRecord === 'function') {
      return cache.getGpsTrackGeoJSONRecord(trackId, { signal });
    }
    const legacy = await cache.getGpsTrackGeoJSON(trackId, { signal });
    return legacy === null ? null : { geojson: legacy, sha256: '' };
  }

  private canPublishLoad(generation: number): boolean {
    return generation === this.loadGeneration &&
      this.dependencies.isSessionActive() &&
      !this.dependencies.isPurging();
  }

  private async persist(track: LocalGpsTrack): Promise<void> {
    const generation = this.persistGeneration;
    if (this.dependencies.isPurging() || !this.dependencies.isSessionActive()) return;
    await this.dependencies.store.put(track);
    if (
      generation !== this.persistGeneration ||
      this.dependencies.isPurging() ||
      !this.dependencies.isSessionActive()
    ) {
      try {
        await this.dependencies.store.remove(track.id);
      } catch {
        // Best-effort cleanup of a write that finished after logout/discard.
      }
    }
  }

  private bump(publish = true): void {
    this._revision += 1;
    this.trackSnapshot = this.buildSnapshot();
    if (publish) this.dependencies.notifyStateChanged();
  }

  private buildSnapshot(): GpsTrackListItem[] {
    const pending = this.dependencies.mutations.gpsPendingBySubject();
    const items = this.localTracks.map((track): GpsTrackListItem => {
      const summary = summarizeTrack(track.points);
      const state = pending.get(track.id);
      return {
        id: track.id,
        name: track.name,
        color: normalizeHexColor(track.color),
        origin: 'local',
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        pointCount: summary.pointCount,
        distanceMeters: summary.distanceMeters,
        durationMs: summary.durationMs,
        pending: state?.state,
        pendingError: state?.error ?? null,
      };
    });
    const remote = this.dependencies.mutations.foldGpsTracks(this.remoteTracks);
    for (const track of remote) {
      const state = pending.get(track.id);
      items.push({
        id: track.id,
        name: track.name,
        color: track.color,
        origin: 'remote',
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        pending: state?.state,
        pendingError: state?.error ?? null,
      });
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function linePathsFromGeoJSON(
  collection: GeoJSON.FeatureCollection,
): Array<Array<[number, number]>> {
  const paths: Array<Array<[number, number]>> = [];
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const candidates: unknown[] = geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      const path: Array<[number, number]> = [];
      for (const position of candidate) {
        if (!Array.isArray(position) || position.length < 2) continue;
        const [lng, lat] = position;
        if (typeof lng !== 'number' || typeof lat !== 'number') continue;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        path.push([lng, lat]);
      }
      if (path.length > 0) paths.push(path);
    }
  }
  return paths;
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
