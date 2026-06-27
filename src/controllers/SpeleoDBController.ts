/**
 * SpeleoDBController -- the "center of the app".
 *
 * Owns all application state (auth, user, online/offline) and orchestrates
 * business logic.  Delegates network I/O to SpeleoDBService and persistence
 * to PreferencesService -- both injected for testability.
 *
 * Exposes an observer pattern (subscribe / notify) so the React provider can
 * re-render via useSyncExternalStore.
 */

import {
  DEFAULT_MAP_LAYER_ID,
  GPS,
  HTTP_STATUS,
  MAP_LAYERS,
  MAP_OVERLAYS,
  NETWORK,
  TILE_PREFETCH,
} from '../constants';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import { GpsTrackStore } from '../services/GpsTrackStore';
import { MultipartPayloadError } from '../services/HttpClient';
import {
  CapacitorRecordingNotificationPermissionGuard,
  type RecordingNotificationPermissionGuard,
} from '../services/RecordingNotificationPermissionGuard';
import type { LocationWatcher } from '../services/GeolocationWatcher';
import { createRecordingLocationWatcher } from '../services/BackgroundGeolocationWatcher';
import {
  clearCachedTilesRuntime,
  clearPrefetchJobsRuntime,
  evictLayerTilesRuntime,
  setTileCacheOfflineModeRuntime,
  setTileCacheOverLimitApprovedRuntime,
} from '../services/TileCacheRuntime';
import { getMapLayerById } from '../services/MapLayersService';
import { LazyTilePrefetchService } from '../services/LazyTilePrefetchService';
import type { TilePrefetchServiceLike } from '../services/TilePrefetchService';
import {
  buildTileUrlsForPoints,
  computeTilePrefetchSignature,
  extractPointCoordinates,
} from '../services/tilePrefetchPlanner';
import type { MapLayerDefinition } from '../types/mapLayer';
import type {
  AuthResponse,
  AuthState,
  AuthTokenResponse,
  LoginCredentials,
  OAuthTokenCredentials,
  User,
} from '../types';
import type { Project } from '../types/project';
import type { MapOverlayId } from '../types/mapOverlay';
import type {
  TilePrefetchJobState,
  TilePrefetchProjectInput,
  TilePrefetchRequest,
} from '../types/tilePrefetch';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import {
  mapLandmarkCollections,
  parseLandmarkMutationError,
  removeLandmarkFeature,
  upsertLandmarkFeature,
} from '../utils/landmarkMutations';
import {
  LandmarkMutationError,
  type LandmarkApiObject,
  type LandmarkCollection,
  type LandmarkCreateInput,
  type LandmarkUpdateInput,
} from '../types/landmark';
import {
  OfflineOpPersistenceError,
  OfflineOpQueue,
  type OfflineReplayPort,
  type OfflineSyncSummary,
} from '../offline/OfflineOpQueue';
import { OfflineOpStore } from '../offline/OfflineOpStore';
import { generateLocalLandmarkId } from '../offline/ops/OfflineOp';
import {
  findLandmarkFeature,
  normalizeCollection,
  roundCoordinate,
  snapshotFromFeature,
} from '../offline/landmarkSnapshot';
import type {
  LandmarkSnapshot,
  OfflineConflictChoice,
  OfflineOpView,
} from '../types/offlineOp';
import type {
  GpsRecordingState,
  GpsTrackListItem,
  GpsTrackSnapshot,
  LocalGpsTrack,
  RecordedPoint,
  RemoteGpsTrack,
} from '../types/gpsTrack';
import type { GpsTrackUpdateInput } from '../services/SpeleoDBService';
import { GpsTrackGpxService, EmptyGpxTrackError, type GpsTrackGpxFile } from '../services/GpsTrackGpxService';
import { generateUuid } from '../utils/ids';
import { shouldAcceptFix } from '../utils/gpsSampling';
import { summarizeTrack } from '../utils/gpsTrackStats';
import { normalizeHexColor, randomTrackColor } from '../utils/gpsTrackColors';
import { snapshotFromRemote } from '../offline/gpsTrackSnapshot';
import { parseRemoteGpsTrack, parseRemoteGpsTracks } from '../utils/remoteGpsTrack';
import { gpsTrackGeoJsonToPoints } from '../utils/gpsTrackGeoJson';
import { CancellationContext } from './CancellationContext';
import { isAbortError } from '../utils/abort';
import type {
  CacheLoadPhaseResult,
  GeoJSONSyncPhaseResult,
  OverlaySyncPhaseResult,
  ProjectRefreshPhaseResult,
  SyncProjectsResult,
  TilePrefetchPhaseResult,
} from '../types/sync';

// ==================== Sync status ====================

export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

/** Per-project prefetch inputs built once and reused across layers. */
interface BuiltProjectInputs {
  inputs: TilePrefetchProjectInput[];
  eligibleCount: number;
  failedCount: number;
}

// ==================== Preferences interface (for DI) ====================

/** The slice of PreferencesService the controller needs. */
export interface PreferencesPort {
  getPreferences(): {
    email?: string;
    token?: string;
    instance?: string;
    lastSyncedAt?: number;
    tileCacheOverLimitApproved?: boolean;
    tileCacheOverLimitPromptAcknowledged?: boolean;
    selectedMapLayerId?: string;
    layerOfflineSync?: Record<string, boolean>;
  };
  setPreferences(
    prefs: Partial<{
      email?: string;
      token?: string;
      instance?: string;
      lastSyncedAt?: number;
      tileCacheOverLimitApproved?: boolean;
      tileCacheOverLimitPromptAcknowledged?: boolean;
      selectedMapLayerId?: string;
      layerOfflineSync?: Record<string, boolean>;
    }>,
  ): void;
  clearPreferences(): void;
}

// ==================== Storage keys (offline) ====================

const STORAGE_KEYS = {
  USERS_DB: 'speleo_users_db',
} as const;

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

function isRetryableGpsUploadStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * A GPS watch error is *fatal* (recording cannot continue) only when the OS
 * refuses location authorization: the background-geolocation plugin reports
 * `code: 'NOT_AUTHORIZED'` (permission revoked / "Always" denied / location
 * services off) and the web `GeolocationPositionError` uses `code === 1`
 * (PERMISSION_DENIED). Everything else (a momentary "signal lost", timeout,
 * etc.) is transient and must NOT stop an in-progress recording.
 */
function isFatalWatchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'NOT_AUTHORIZED') return true;
  if (code === 1 || code === '1') return true;
  return false;
}

/** User-facing message when a recording stops because location was denied. */
const GPS_RECORDING_PERMISSION_LOST_MESSAGE =
  'Location access was denied, so GPS recording stopped. Allow location ' +
  '(set to "Always" for background recording) and start again.';

function hasAuthTokenResponse(data: unknown): data is AuthTokenResponse {
  if (!data || typeof data !== 'object') {
    return false;
  }

  return typeof (data as { token?: unknown }).token === 'string'
    && (data as { token: string }).token.trim().length > 0;
}

function extractAuthErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const body = data as {
    detail?: unknown;
    message?: unknown;
    errors?: { non_field_errors?: unknown };
  };
  if (typeof body.detail === 'string' && body.detail.trim()) return body.detail;
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (Array.isArray(body.errors?.non_field_errors)) {
    const firstError = body.errors.non_field_errors[0];
    if (typeof firstError === 'string' && firstError.trim()) return firstError;
  }
  return undefined;
}

// ==================== Controller ====================

export class SpeleoDBController {
  // ---- Observable state -----------------------------------------------------
  private _authState: AuthState = { isAuthenticated: false, user: null, token: null };
  private _isOnline = false;
  private _isOfflineLocked = false;
  private _projects: Project[] = [];
  private _syncStatus: SyncStatus = 'idle';
  private _lastSyncedAt: number | null = null;
  private _tilePrefetchJobs: TilePrefetchJobState[] = [];
  // Monotonic counter bumped after any landmark create/edit/delete writes the
  // cached overlay:landmarks FeatureCollection, so the Dashboard re-reads it.
  private _landmarksRevision = 0;
  // Tile-cache overflow consent (persisted) + a transient manual re-trigger.
  private _tileCacheOverLimitApproved = false;
  private _tileCacheOverLimitPromptAcknowledged = false;
  private _storageConsentRequested = false;
  // Latch so the "stuck while approved" diagnostic warns once, not per notify.
  private _warnedStuckWhileApproved = false;
  // Offline mutation queue (landmark create/edit/delete made while offline or
  // after a "not reachable" failure). Owns persistence + optimistic fold +
  // replay/conflict resolution. See docs/offline-op-queue.md.
  private offlineQueue!: OfflineOpQueue;
  private _pendingOpsRevision = 0;
  // ---- GPS tracks + recording -----------------------------------------------
  // Recorded tracks (persisted in IndexedDB), the live recording state machine,
  // and the in-progress point buffer. Uploads to SpeleoDB follow the same
  // offline-first model as landmarks (record offline, upload on reconnect).
  // See docs/gps-tracks.md.
  private _gpsTracks: LocalGpsTrack[] = [];
  // Server-stored tracks (metadata) synced like projects/landmarks. The unified
  // list folds pending offline ops over these and merges in local recordings.
  private _remoteGpsTracks: RemoteGpsTrack[] = [];
  private _gpsRecordingState: GpsRecordingState = 'idle';
  private _currentTrackPoints: RecordedPoint[] = [];
  // Color assigned to the in-progress recording (palette pick), persisted onto
  // the finalized local track so its map line is colored and editable.
  private _recordingColor = '';
  private _gpsTracksRevision = 0;
  // The in-progress recording is persisted incrementally (not just on stop) so
  // a force-quit mid-recording recovers the captured points on next launch.
  private _recordingTrackId: string | null = null;
  private _recordingStartedAt = 0;
  private _recordingActiveElapsedMs = 0;
  private _recordingActiveStartedAt: number | null = null;
  private _recordingWatchSessionStartedAt = 0;
  private _recordingName = '';
  private _gpsPersistGeneration = 0;
  private _gpsPersistQueue: Promise<void> | null = null;
  // Set when an active recording is forcibly stopped by a fatal location error
  // (e.g. permission revoked / "Always" denied). The UI reads it once to show a
  // toast, then clears it via `clearGpsRecordingError()`. Null in the normal
  // case so a recording never appears broken silently.
  private _gpsRecordingError: string | null = null;
  private _listeners = new Set<() => void>();
  private tilePrefetch!: TilePrefetchServiceLike;
  private tilePrefetchUnsubscribe: (() => void) | null = null;
  private _isPurgingLocalData = false;
  private _asyncGeneration = 0;
  private _nextRunId = 1;
  private activeValidationContext: CancellationContext | null = null;
  private activeSyncContext: CancellationContext | null = null;
  // Best-effort, fire-and-forget layer prefetches (Settings toggle) run on their
  // own contexts. Tracked here so logout/teardown aborts them like the sync and
  // validation contexts (otherwise an enable-then-logout race leaks async work).
  private activeLayerPrefetchContexts = new Set<CancellationContext>();
  private _trackedOperations = new Set<Promise<unknown>>();

  // Snapshot references for useSyncExternalStore (identity-stable between notifies)
  private _authStateSnapshot: AuthState = this._authState;
  private _isOnlineSnapshot: boolean = this._isOnline;
  private _isOfflineLockedSnapshot: boolean = this._isOfflineLocked;
  private _projectsSnapshot: Project[] = this._projects;
  private _syncStatusSnapshot: SyncStatus = this._syncStatus;
  private _lastSyncedAtSnapshot: number | null = this._lastSyncedAt;
  private _tilePrefetchJobsSnapshot: TilePrefetchJobState[] = this._tilePrefetchJobs;
  private _landmarksRevisionSnapshot: number = this._landmarksRevision;
  private _tileCacheOverLimitApprovedSnapshot = this._tileCacheOverLimitApproved;
  private _tileCacheOverLimitPromptAcknowledgedSnapshot =
    this._tileCacheOverLimitPromptAcknowledged;
  private _storageConsentRequestedSnapshot = this._storageConsentRequested;
  private _pendingOpsCountSnapshot = 0;
  private _pendingOpsRevisionSnapshot = this._pendingOpsRevision;
  private _gpsTracksSnapshot: GpsTrackListItem[] = [];
  /**
   * The `_gpsTracksRevision` the current `_gpsTracksSnapshot` was built from.
   * Lets `notify()` rebuild the unified list only when GPS data actually
   * changed, so `gpsTracks` keeps a stable reference across unrelated notifies.
   */
  private _builtGpsTracksRevision = -1;
  private _gpsRecordingStateSnapshot: GpsRecordingState = this._gpsRecordingState;
  private _currentTrackPointsSnapshot: RecordedPoint[] = this._currentTrackPoints;
  private _gpsTracksRevisionSnapshot: number = this._gpsTracksRevision;
  private _gpsRecordingStartedAtSnapshot: number | null = null;
  private _gpsRecordingElapsedMsSnapshot = 0;
  private _gpsRecordingElapsedUpdatedAtSnapshot: number | null = null;
  private _gpsRecordingErrorSnapshot: string | null = this._gpsRecordingError;

  constructor(
    private service: SpeleoDBService,
    private prefs: PreferencesPort,
    private cache: ProjectCacheService,
    tilePrefetch?: TilePrefetchServiceLike,
    private offlineOpStore: OfflineOpStore = new OfflineOpStore(),
    private gpsTrackStore: GpsTrackStore = new GpsTrackStore(),
    private geolocationWatcher: LocationWatcher = createRecordingLocationWatcher(),
    private recordingNotificationPermission: RecordingNotificationPermissionGuard =
      new CapacitorRecordingNotificationPermissionGuard(),
    private gpsTrackGpxService: GpsTrackGpxService = new GpsTrackGpxService(),
  ) {
    this.attachTilePrefetch(tilePrefetch ?? this.createTilePrefetchService());
    this.offlineQueue = this.buildOfflineQueue();
    this.restoreSession();
    this.restoreTileCacheOverLimitConsent();
    this.setOfflineLocked(false);
    // Load persisted GPS tracks so the panel shows them on startup. Only notify
    // when something was restored, so a clean start does not perturb revisions.
    const gpsLoadGeneration = this.captureAsyncGeneration();
    void this.gpsTrackStore
      .list()
      .then((tracks) => {
        if (
          tracks.length > 0 &&
          this.isAsyncGenerationCurrent(gpsLoadGeneration) &&
          this._authState.isAuthenticated &&
          !this._isPurgingLocalData
        ) {
          this._gpsTracks = tracks;
          this.bumpGpsTracksRevision();
        }
      })
      .catch((error) => console.warn('Failed to load GPS tracks:', error));
    // Load cached server tracks so the unified list renders offline at launch.
    void this.cache
      .getGpsTracks()
      .then((tracks) => {
        if (
          tracks &&
          tracks.length > 0 &&
          this.isAsyncGenerationCurrent(gpsLoadGeneration) &&
          this._authState.isAuthenticated &&
          !this._isPurgingLocalData
        ) {
          this._remoteGpsTracks = tracks;
          this.bumpGpsTracksRevision();
        }
      })
      .catch((error) => console.warn('Failed to load cached GPS tracks:', error));
    // Load persisted ops so the map folds them and the Pending tab appears on
    // startup (before any user action). Only refresh the UI when something was
    // actually restored, so a clean start does not perturb revisions.
    void this.offlineQueue
      .load()
      .then(() => {
        if (this.offlineQueue.count > 0) this.handleOfflineQueueChange();
      })
      .catch((error) => console.warn('Failed to load offline op queue:', error));
  }

  /**
   * Build the offline queue with a replay port bound to this controller's
   * service + cache. Credentials are resolved at call time so a token refresh
   * is always reflected. Ground-truth writes reuse the existing single
   * cache-write seam (`applyLandmarkUpsert` / `applyLandmarkRemoval`).
   */
  private buildOfflineQueue(): OfflineOpQueue {
    const port: OfflineReplayPort = {
      hasNetworkAccess: () => this.hasNetworkAccess(),
      postLandmark: (input) => {
        const credentials = this.requireQueueCredentials();
        return this.service.createLandmark(credentials.instance, credentials.token, input);
      },
      patchLandmark: (id, input) => {
        const credentials = this.requireQueueCredentials();
        return this.service.updateLandmark(credentials.instance, credentials.token, id, input);
      },
      deleteLandmark: (id) => {
        const credentials = this.requireQueueCredentials();
        return this.service.deleteLandmark(credentials.instance, credentials.token, id);
      },
      fetchLandmarksGeoJSON: () => {
        const credentials = this.requireQueueCredentials();
        return this.service.getLandmarksGeoJSON(credentials.instance, credentials.token);
      },
      applyUpsert: (landmark) => this.applyLandmarkUpsert(landmark),
      applyRemoval: (id) => this.applyLandmarkRemoval(id),
      uploadGpsTrack: async (localTrackId) => {
        const track = this._gpsTracks.find((t) => t.id === localTrackId);
        // Already gone (e.g. deleted after a prior partial success): the upload
        // is moot. Report success so the op resolves and is removed.
        if (!track) return { status: 200, data: {} };
        return this.performGpsUpload(track);
      },
      patchGpsTrack: (id, input) => {
        const credentials = this.requireQueueCredentials();
        return this.service.updateGpsTrack(credentials.instance, credentials.token, id, input);
      },
      deleteGpsTrackRemote: (id) => {
        const credentials = this.requireQueueCredentials();
        return this.service.deleteGpsTrack(credentials.instance, credentials.token, id);
      },
      fetchGpsTracks: () => {
        const credentials = this.requireQueueCredentials();
        return this.service.getGpsTracks(credentials.instance, credentials.token);
      },
      applyGpsTrackUpsert: (track) => this.applyGpsTrackUpsert(track),
      applyGpsTrackRemoval: (id) => this.applyGpsTrackRemoval(id),
      onGpsTrackCreated: (localTrackId) => this.finalizeGpsUpload(localTrackId),
    };
    return new OfflineOpQueue(this.offlineOpStore, port, () => this.handleOfflineQueueChange());
  }

  private requireQueueCredentials(): { token: string; instance: string } {
    const credentials = this.getSyncCredentials();
    if (!credentials) {
      throw new Error('No credentials available for offline replay.');
    }
    return credentials;
  }

  private handleOfflineQueueChange(): void {
    // A queue change can alter the optimistic fold, so refresh the map
    // (landmarksRevision), the pending list (pendingOpsRevision), and the
    // unified GPS list (gpsTracksRevision -- a GPS op enqueue/replay/conflict
    // changes the derived pending chips + the folded server tracks; notify()
    // now only rebuilds that list when this revision changes).
    this._landmarksRevision += 1;
    this._pendingOpsRevision += 1;
    this._gpsTracksRevision += 1;
    this.notify();
  }

  // ---- State accessors (snapshot-based for useSyncExternalStore) -------------

  get authState(): AuthState {
    return this._authStateSnapshot;
  }

  get isOnline(): boolean {
    return this._isOnlineSnapshot;
  }

  get isOfflineLocked(): boolean {
    return this._isOfflineLockedSnapshot;
  }

  get currentUser(): User | null {
    return this._authState.user;
  }

  get projects(): Project[] {
    return this._projectsSnapshot;
  }

  get syncStatus(): SyncStatus {
    return this._syncStatusSnapshot;
  }

  get lastSyncedAt(): number | null {
    return this._lastSyncedAtSnapshot;
  }

  get tilePrefetchJobs(): TilePrefetchJobState[] {
    return this._tilePrefetchJobsSnapshot;
  }

  /**
   * Bumped after every landmark create/edit/delete that writes the cached
   * overlay:landmarks payload. The Dashboard re-reads the cache when this
   * changes so the map + Landmark panel reflect the mutation.
   */
  get landmarksRevision(): number {
    return this._landmarksRevisionSnapshot;
  }

  /** Number of pending offline mutations (drives the Pending tab + badge). */
  get pendingOpsCount(): number {
    return this._pendingOpsCountSnapshot;
  }

  /** Bumped on any offline-queue change so the Pending page re-reads the list. */
  get pendingOpsRevision(): number {
    return this._pendingOpsRevisionSnapshot;
  }

  /**
   * Unified GPS track list (newest first): local recordings + server tracks,
   * with pending offline-op state folded in. `origin` distinguishes the two.
   */
  get gpsTracks(): GpsTrackListItem[] {
    return this._gpsTracksSnapshot;
  }

  /** Current recording lifecycle (`idle` / `recording` / `paused`). */
  get gpsRecordingState(): GpsRecordingState {
    return this._gpsRecordingStateSnapshot;
  }

  /**
   * Epoch ms when the current recording started (null when idle). Lets the UI
   * tick a live duration from the moment Start is pressed -- before the first
   * GPS fix arrives -- so recording feels immediate.
   */
  get gpsRecordingStartedAt(): number | null {
    return this._gpsRecordingStartedAtSnapshot;
  }

  /** Active recording duration, excluding paused wall time, at the last snapshot. */
  get gpsRecordingElapsedMs(): number {
    return this._gpsRecordingElapsedMsSnapshot;
  }

  /**
   * Epoch ms when `gpsRecordingElapsedMs` was measured. Non-null only while
   * actively recording so the UI can tick locally without counting paused time.
   */
  get gpsRecordingElapsedUpdatedAt(): number | null {
    return this._gpsRecordingElapsedUpdatedAtSnapshot;
  }

  /** Live point buffer of the in-progress recording (empty when idle). */
  get currentTrackPoints(): RecordedPoint[] {
    return this._currentTrackPointsSnapshot;
  }

  /**
   * Set when an active recording was forcibly stopped by a fatal location error
   * (permission denied/revoked). The UI surfaces it once then calls
   * `clearGpsRecordingError()`. Null otherwise.
   */
  get gpsRecordingError(): string | null {
    return this._gpsRecordingErrorSnapshot;
  }

  /** Bumped on any GPS track/recording change so the panel re-reads state. */
  get gpsTracksRevision(): number {
    return this._gpsTracksRevisionSnapshot;
  }

  /** True when the user has approved letting tile prefetch exceed the cap. */
  get isTileCacheOverLimitApproved(): boolean {
    return this._tileCacheOverLimitApprovedSnapshot;
  }

  /**
   * True when prefetch is stalled at the cache cap and overflow is not yet
   * approved. Drives the Settings warning. False once approved.
   */
  get isTileCacheOverLimit(): boolean {
    if (this._tileCacheOverLimitApprovedSnapshot) return false;
    return this._tilePrefetchJobsSnapshot.some((job) => job.blockedByStorage === true);
  }

  /**
   * True when the one-time auto consent popup should appear: over the limit and
   * the user has not yet been asked. Suppressed forever once acknowledged.
   */
  get needsAutoStoragePrompt(): boolean {
    return this.isTileCacheOverLimit && !this._tileCacheOverLimitPromptAcknowledgedSnapshot;
  }

  /** Transient flag set by the Settings warning to manually re-open the prompt. */
  get storageConsentRequested(): boolean {
    return this._storageConsentRequestedSnapshot;
  }

  /**
   * Whether the storage-consent modal should be open: either the one-time auto
   * prompt, or a manual re-trigger from Settings.
   */
  get storageConsentRequired(): boolean {
    return this.needsAutoStoragePrompt || this._storageConsentRequestedSnapshot;
  }

  isAuthenticated(): boolean {
    return this._authState.isAuthenticated;
  }

  // ---- Observer pattern -----------------------------------------------------

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  private notify(): void {
    // Produce new snapshot references so useSyncExternalStore detects changes.
    this._authStateSnapshot = { ...this._authState };
    this._isOnlineSnapshot = this._isOnline;
    this._isOfflineLockedSnapshot = this._isOfflineLocked;
    this._projectsSnapshot = [...this._projects];
    this._syncStatusSnapshot = this._syncStatus;
    this._lastSyncedAtSnapshot = this._lastSyncedAt;
    this._tilePrefetchJobsSnapshot = [...this._tilePrefetchJobs];
    this._landmarksRevisionSnapshot = this._landmarksRevision;
    this._tileCacheOverLimitApprovedSnapshot = this._tileCacheOverLimitApproved;
    this._tileCacheOverLimitPromptAcknowledgedSnapshot =
      this._tileCacheOverLimitPromptAcknowledged;
    this._storageConsentRequestedSnapshot = this._storageConsentRequested;
    this._pendingOpsCountSnapshot = this.offlineQueue ? this.offlineQueue.count : 0;
    this._pendingOpsRevisionSnapshot = this._pendingOpsRevision;
    // Rebuild the unified GPS list only when the GPS revision actually changed.
    // Frequent unrelated notifies (tile prefetch progress, online/sync status)
    // would otherwise re-run summarizeTrack over every local recording and hand
    // `gpsTracks` a fresh array reference, churning the Dashboard's gps-tracks
    // map source on every tick. Gating keeps the reference stable when nothing
    // GPS-related changed.
    if (this._gpsTracksRevision !== this._builtGpsTracksRevision) {
      this._gpsTracksSnapshot = this.buildUnifiedGpsTracks();
      this._builtGpsTracksRevision = this._gpsTracksRevision;
    }
    this._gpsRecordingStateSnapshot = this._gpsRecordingState;
    const snapshotNow = Date.now();
    this._gpsRecordingStartedAtSnapshot =
      this._gpsRecordingState === 'idle' ? null : this._recordingStartedAt;
    this._gpsRecordingElapsedMsSnapshot = this.recordingElapsedMsAt(snapshotNow);
    this._gpsRecordingElapsedUpdatedAtSnapshot =
      this._gpsRecordingState === 'recording' ? snapshotNow : null;
    this._currentTrackPointsSnapshot = [...this._currentTrackPoints];
    this._gpsTracksRevisionSnapshot = this._gpsTracksRevision;
    this._gpsRecordingErrorSnapshot = this._gpsRecordingError;
    this._listeners.forEach((fn) => fn());
  }

  private invalidateAsyncOperations(): void {
    this._asyncGeneration += 1;
    this.activeValidationContext?.abort('Async operations invalidated');
    this.activeSyncContext?.abort('Async operations invalidated');
    for (const context of this.activeLayerPrefetchContexts) {
      context.abort('Async operations invalidated');
    }
    this.activeLayerPrefetchContexts.clear();
  }

  private captureAsyncGeneration(): number {
    return this._asyncGeneration;
  }

  private isAsyncGenerationCurrent(generation: number): boolean {
    return generation === this._asyncGeneration;
  }

  private staleSessionResult(): 'ok' | 'unauthorized' {
    return this._authState.isAuthenticated ? 'ok' : 'unauthorized';
  }

  private nextRunId(): number {
    const runId = this._nextRunId;
    this._nextRunId += 1;
    return runId;
  }

  private beginValidationContext(): CancellationContext {
    this.activeValidationContext?.abort('Session validation superseded');
    const context = new CancellationContext(this.nextRunId(), 'Session validation');
    this.activeValidationContext = context;
    return context;
  }

  private beginSyncContext(): CancellationContext {
    this.activeSyncContext?.abort('Project sync superseded');
    const context = new CancellationContext(this.nextRunId(), 'Project sync');
    this.activeSyncContext = context;
    return context;
  }

  private isValidationContextCurrent(context: CancellationContext): boolean {
    return this.activeValidationContext === context;
  }

  private isSyncContextCurrent(context: CancellationContext): boolean {
    return this.activeSyncContext === context;
  }

  private trackOperation<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.finally(() => {
      this._trackedOperations.delete(tracked);
    });
    this._trackedOperations.add(tracked);
    return tracked;
  }

  private async waitForTrackedOperations(): Promise<void> {
    if (this._trackedOperations.size === 0) return;
    await Promise.allSettled([...this._trackedOperations]);
  }

  private recordingElapsedMsAt(now: number): number {
    if (this._gpsRecordingState === 'idle') return 0;
    const activeSegmentMs =
      this._gpsRecordingState === 'recording' && this._recordingActiveStartedAt !== null
        ? Math.max(0, now - this._recordingActiveStartedAt)
        : 0;
    return this._recordingActiveElapsedMs + activeSegmentMs;
  }

  private freezeRecordingElapsed(now = Date.now()): void {
    this._recordingActiveElapsedMs = this.recordingElapsedMsAt(now);
    this._recordingActiveStartedAt = null;
  }

  private resetRecordingTiming(): void {
    this._recordingStartedAt = 0;
    this._recordingActiveElapsedMs = 0;
    this._recordingActiveStartedAt = null;
    this._recordingWatchSessionStartedAt = 0;
  }

  private attachTilePrefetch(service: TilePrefetchServiceLike): void {
    this.tilePrefetch = service;
    this._warnedStuckWhileApproved = false;
    this.tilePrefetchUnsubscribe = this.tilePrefetch.subscribe((jobs) => {
      this._tilePrefetchJobs = jobs;
      this.warnIfStuckWhileApproved(jobs);
      this.notify();
    });
  }

  /**
   * Surface the otherwise-invisible failure mode where overflow is approved but
   * a job remains `blockedByStorage` -- e.g. the runtime cap-lift never reached
   * the tile cache, so `processQueue` keeps re-blocking. `isTileCacheOverLimit`
   * intentionally returns false once approved (the Settings warning disappears),
   * so without this the stalled prefetch would be completely silent. Latched to
   * avoid log spam across repeated notifies.
   */
  private warnIfStuckWhileApproved(jobs: TilePrefetchJobState[]): void {
    const stuck = this._tileCacheOverLimitApproved
      && jobs.some((job) => job.blockedByStorage === true);
    if (!stuck) {
      this._warnedStuckWhileApproved = false;
      return;
    }
    if (this._warnedStuckWhileApproved) return;
    this._warnedStuckWhileApproved = true;
    console.warn(
      'Tile prefetch is blocked by storage while overflow is approved; the cap-lift may not have reached the tile cache.',
    );
  }

  private createTilePrefetchService(): TilePrefetchServiceLike {
    return new LazyTilePrefetchService({
      isOnline: () => this.hasNetworkAccess(),
    });
  }

  private setOfflineLocked(locked: boolean): void {
    this._isOfflineLocked = locked;
    setTileCacheOfflineModeRuntime(locked);
  }

  /**
   * Flip the app from online to offline at runtime when a server request shows
   * we can no longer reach the backend (timeout / transport error / 5xx).
   *
   * Idempotent: a no-op when already offline-locked so repeated failures don't
   * thrash `notify()`. This is request-driven (only called from a failed
   * user-initiated network operation) -- the app never subscribes to passive
   * `online`/`offline` connectivity events. See docs/networking.md.
   */
  private enterOfflineMode(): void {
    if (this._isOfflineLocked) return;
    this._isOnline = false;
    this.setOfflineLocked(true);
    this.notify();
  }

  async preloadTilePrefetch(): Promise<void> {
    await this.tilePrefetch.preload?.();
  }

  // ---- Tile-cache overflow consent ------------------------------------------

  /** Restore persisted overflow consent and push it into the tile-cache runtime. */
  private restoreTileCacheOverLimitConsent(): void {
    try {
      const prefs = this.prefs.getPreferences();
      this._tileCacheOverLimitApproved = prefs.tileCacheOverLimitApproved === true;
      this._tileCacheOverLimitPromptAcknowledged =
        prefs.tileCacheOverLimitPromptAcknowledged === true;
      this._tileCacheOverLimitApprovedSnapshot = this._tileCacheOverLimitApproved;
      this._tileCacheOverLimitPromptAcknowledgedSnapshot =
        this._tileCacheOverLimitPromptAcknowledged;
      setTileCacheOverLimitApprovedRuntime(this._tileCacheOverLimitApproved);
    } catch (error) {
      console.warn('Failed to restore tile-cache overflow consent:', error);
    }
  }

  private persistTileCacheOverLimitConsent(): void {
    try {
      this.prefs.setPreferences({
        tileCacheOverLimitApproved: this._tileCacheOverLimitApproved,
        tileCacheOverLimitPromptAcknowledged: this._tileCacheOverLimitPromptAcknowledged,
      });
    } catch (error) {
      console.warn('Failed to persist tile-cache overflow consent:', error);
    }
  }

  /** Manually re-open the storage-consent prompt (from the Settings warning). */
  requestStorageConsentPrompt(): void {
    if (this._storageConsentRequested) return;
    this._storageConsentRequested = true;
    this.notify();
  }

  /** Clear the manual re-trigger once the modal has consumed it. */
  clearStorageConsentRequest(): void {
    if (!this._storageConsentRequested) return;
    this._storageConsentRequested = false;
    this.notify();
  }

  /**
   * User approved exceeding the cache cap. Persists both flags, lifts the cap in
   * the tile-cache runtime, and resumes the stalled prefetch queue.
   */
  approveTileCacheOverLimit(): void {
    this._tileCacheOverLimitApproved = true;
    this._tileCacheOverLimitPromptAcknowledged = true;
    this._storageConsentRequested = false;
    this._warnedStuckWhileApproved = false;
    this.persistTileCacheOverLimitConsent();
    setTileCacheOverLimitApprovedRuntime(true);
    this.notify();
    this.tilePrefetch.resumeBlockedJobs();
  }

  /** User dismissed the prompt ("Not now"): remember it so it never auto-nags again. */
  acknowledgeStoragePrompt(): void {
    this._tileCacheOverLimitPromptAcknowledged = true;
    this._storageConsentRequested = false;
    this.persistTileCacheOverLimitConsent();
    this.notify();
  }

  /** Turn overflow back off (from Settings). Keeps the acknowledged flag. */
  revokeTileCacheOverLimit(): void {
    this._tileCacheOverLimitApproved = false;
    this._warnedStuckWhileApproved = false;
    this.persistTileCacheOverLimitConsent();
    setTileCacheOverLimitApprovedRuntime(false);
    this.notify();
  }

  /**
   * Enable/disable offline sync for a tile layer (Settings "Layers" section).
   *
   * Forced layers (satellite) are immutable. Enabling while online starts the
   * layer's prefetch immediately (satellite remains prioritized because it is
   * always scheduled first during a full sync; a manual enable enqueues only the
   * one layer). Disabling removes the layer's prefetch jobs and evicts its
   * cached tiles to reclaim space.
   */
  async setLayerOfflineSync(layerId: string, enabled: boolean): Promise<void> {
    const layer = getMapLayerById(layerId);
    if (!layer || layer.forcedOffline) return;

    const current = this.prefs.getPreferences().layerOfflineSync ?? {};
    // Persist (and reconcile data) unconditionally: even when the stored flag
    // already matches, enabling re-schedules and disabling re-cleans, so the
    // operation stays idempotent without a special-case early return.
    this.prefs.setPreferences({
      layerOfflineSync: { ...current, [layerId]: enabled },
    });
    this.notify();

    if (enabled) {
      if (!this.hasNetworkAccess()) return;
      await this.scheduleSingleLayerPrefetch(layer);
    } else {
      await this.removeLayerOfflineData(layer);
    }
  }

  /** Layers (excluding the forced satellite layer) currently opted in to sync. */
  private getEnabledExtraLayers(): MapLayerDefinition[] {
    const sync = this.prefs.getPreferences().layerOfflineSync ?? {};
    return MAP_LAYERS.filter((layer) => !layer.forcedOffline && sync[layer.id] === true);
  }

  /**
   * Schedule prefetch for a single layer using the already-cached project
   * GeoJSON + landmarks. Best-effort and gated by the active network state.
   */
  private async scheduleSingleLayerPrefetch(layer: MapLayerDefinition): Promise<void> {
    const context = new CancellationContext(this.nextRunId(), 'Layer prefetch');
    this.activeLayerPrefetchContexts.add(context);
    try {
      const landmarkPoints = await this.loadLandmarkPrefetchPoints(context);
      await this.enqueueLayerLandmarks(context, layer, landmarkPoints);
      const built = await this.buildProjectPrefetchInputs(context, this._projects);
      await this.enqueueLayerProjects(context, layer, built);
    } catch (error) {
      if (isAbortError(error)) return;
      console.warn(`Failed scheduling prefetch for layer ${layer.id}:`, error);
    } finally {
      this.activeLayerPrefetchContexts.delete(context);
    }
  }

  /** Remove a disabled layer's prefetch jobs and evict its cached tiles. */
  private async removeLayerOfflineData(layer: MapLayerDefinition): Promise<void> {
    try {
      await this.tilePrefetch.removeLayer(layer.id);
    } catch (error) {
      console.warn(`Failed removing prefetch jobs for layer ${layer.id}:`, error);
    }
    try {
      const prefix = layer.tileUrlTemplate.split('{z}')[0];
      if (prefix) {
        await evictLayerTilesRuntime([prefix]);
      }
    } catch (error) {
      console.warn(`Failed evicting tiles for layer ${layer.id}:`, error);
    }
  }

  // ---- Actions --------------------------------------------------------------

  /**
   * Login: validates inputs, calls the API, falls back to offline if needed.
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const { email, password, instance } = credentials;

    if (!this.validateEmail(email)) {
      return { success: false, message: 'Invalid email address' };
    }
    if (!password) {
      return { success: false, message: 'Password is required' };
    }
    if (!instance?.trim()) {
      return { success: false, message: 'SpeleoDB instance URL is required' };
    }

    // Online path
    if (this.hasNetworkAccess()) {
      try {
        const response = await this.service.authenticate(instance, email, password);

        if (isSuccessfulStatus(response.status) && hasAuthTokenResponse(response.data)) {
          const authToken = response.data.token.trim();
          const userEmail = typeof response.data.user === 'string' && response.data.user.trim()
            ? response.data.user
            : email;
          const user = this.establishAuthenticatedSession(
            authToken,
            instance,
            userEmail,
          );
          return {
            success: true,
            message: 'Login successful',
            user: user ?? undefined,
            token: authToken,
          };
        }

        // Error response from server
        const message =
          extractAuthErrorMessage(response.data) ??
          (response.status === HTTP_STATUS.UNAUTHORIZED ? 'Invalid email or password' : 'Login failed');
        return { success: false, message };
      } catch (error) {
        // Network failure -- fall through to offline login
        console.warn('Online login failed, trying offline...', error);
      }
    }

    // Offline fallback
    return this.offlineLogin(email, password, instance);
  }

  /**
   * Login with a user-supplied OAuth token. The token must be validated by the
   * selected instance before it is persisted; there is intentionally no
   * offline fallback for this flow.
   */
  async loginWithToken(credentials: OAuthTokenCredentials): Promise<AuthResponse> {
    const token = credentials.token?.trim();
    const instance = credentials.instance?.trim();

    if (!token) {
      return { success: false, message: 'OAuth token is required' };
    }
    if (!instance) {
      return { success: false, message: 'SpeleoDB instance URL is required' };
    }

    try {
      const response = await this.service.validateToken(instance, token);

      if (isSuccessfulStatus(response.status)) {
        this.establishAuthenticatedSession(token, instance);
        return { success: true, message: 'Login successful', token };
      }

      if (isClientErrorStatus(response.status)) {
        return {
          success: false,
          message: extractAuthErrorMessage(response.data) ?? 'Invalid OAuth token',
        };
      }

      return {
        success: false,
        message:
          extractAuthErrorMessage(response.data) ??
          'Unable to validate OAuth token. Please try again.',
      };
    } catch {
      return {
        success: false,
        message: 'Unable to validate OAuth token. Check your connection and try again.',
      };
    }
  }

  /**
   * Validates the stored token with the server.
   * - 2xx   -> 'ok'
   * - 4xx   -> 'unauthorized' (and local logout/cache purge)
   * - other -> 'network_error' (keeps current session, enters offline mode)
   */
  async validateSession(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    if (this._isOfflineLocked) {
      return 'network_error';
    }
    return this.validateSessionAgainstServer();
  }

  /**
   * Explicit user-initiated reconnect attempt from offline mode (Settings ->
   * "Go Online"). Unlike `validateSession()`, this bypasses the offline-lock
   * short-circuit and actually probes the server.
   *
   * - `ok`            -> session is valid: offline lock is cleared (online
   *                      restored) and a project sync is launched.
   * - `network_error` -> still unreachable: stays offline-locked, no logout.
   * - `unauthorized`  -> 4xx: session invalid, logout + cache purge already ran.
   *
   * This is the second allowed reconnect trigger alongside app relaunch. It is
   * user-driven, not a passive connectivity listener. See docs/networking.md.
   */
  async attemptReconnect(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    const result = await this.validateSessionAgainstServer();
    if (result === 'ok') {
      // Fire-and-forget: the offline lock is already cleared, so the UI can
      // hide the Go Online button immediately while the sync runs. syncProjects
      // tracks itself for logout teardown and refreshes the GPS track list.
      // Pending GPS ops drain from the Pending page, exactly like landmarks.
      void this.syncProjects();
    }
    return result;
  }

  private async validateSessionAgainstServer(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    const validationGeneration = this.captureAsyncGeneration();
    const context = this.beginValidationContext();
    const prefs = this.prefs.getPreferences();
    const token = prefs.token;
    const instance = prefs.instance?.trim();
    if (!token || !instance) {
      if (prefs.token && !instance) {
        this.prefs.clearPreferences();
      }
      return 'unauthorized';
    }

    try {
      const response = await this.service.validateToken(
        instance,
        token,
        {
          timeoutMs: NETWORK.STARTUP_AUTH_TIMEOUT_MS,
          signal: context.signal,
        },
      );

      context.throwIfAborted();
      if (
        !this.isAsyncGenerationCurrent(validationGeneration) ||
        !this.isValidationContextCurrent(context)
      ) {
        return this.staleSessionResult();
      }

      if (isSuccessfulStatus(response.status)) {
        this._isOnline = true;
        this.setOfflineLocked(false);
        this.notify();
        return 'ok';
      }
      if (isClientErrorStatus(response.status)) {
        await this.logout();
        return 'unauthorized';
      }
      // Any non-4xx status at startup is treated as a transient network/server issue.
      // Keep the session and move to offline mode instead of wiping local data.
      this._isOnline = false;
      this.setOfflineLocked(true);
      this.notify();
      return 'network_error';
    } catch (error) {
      if (
        isAbortError(error) ||
        !this.isAsyncGenerationCurrent(validationGeneration) ||
        !this.isValidationContextCurrent(context)
      ) {
        return this.staleSessionResult();
      }
      // Timeout or transport errors must never trigger logout.
      this._isOnline = false;
      this.setOfflineLocked(true);
      this.notify();
      return 'network_error';
    } finally {
      if (this.activeValidationContext === context) {
        this.activeValidationContext = null;
      }
    }
  }

  /**
   * Logout and wipe all local user data immediately.
   * Confirmation (if any) is handled by the UI layer before calling this.
   */
  async logout(): Promise<void> {
    await this.purgeAllLocalUserData();
  }

  private async purgeAllLocalUserData(): Promise<void> {
    if (this._isPurgingLocalData) return;
    this._isPurgingLocalData = true;
    this.invalidateAsyncOperations();
    try {
      const prefetchAtPurgeStart = this.tilePrefetch;

      // Stop prefetch updates first to avoid stale progress being re-published.
      this.tilePrefetchUnsubscribe?.();
      this.tilePrefetchUnsubscribe = null;
      prefetchAtPurgeStart.dispose();
      try {
        await prefetchAtPurgeStart.waitForIdle?.();
      } catch {
        // Continue cleanup even if prefetch teardown fails.
      }

      // Stop any active GPS recording so the watch is released and the buffer
      // does not survive into the next session.
      this._gpsPersistGeneration += 1;
      await this.geolocationWatcher.stop();

      // Reset in-memory state first so UI reflects the wipe immediately.
      this._authState = { isAuthenticated: false, user: null, token: null };
      this._isOnline = false;
      this.setOfflineLocked(false);
      this._projects = [];
      this._syncStatus = 'idle';
      this._lastSyncedAt = null;
      this._tilePrefetchJobs = [];
      this._gpsTracks = [];
      this._remoteGpsTracks = [];
      // Bump so notify()'s revision-gated rebuild clears the unified GPS list
      // (logout calls notify() directly rather than via bumpGpsTracksRevision).
      this._gpsTracksRevision += 1;
      this._gpsRecordingState = 'idle';
      this._currentTrackPoints = [];
      this._recordingTrackId = null;
      this._recordingColor = '';
      this.resetRecordingTiming();
      this._gpsRecordingError = null;
      this._tileCacheOverLimitApproved = false;
      this._tileCacheOverLimitPromptAcknowledged = false;
      this._storageConsentRequested = false;
      setTileCacheOverLimitApprovedRuntime(false);
      this.prefs.clearPreferences();

      try {
        localStorage.clear();
      } catch (error) {
        console.error('Failed to clear local storage user data:', error);
      }

      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.clear();
        }
      } catch {
        // no-op in environments where sessionStorage is unavailable.
      }

      this.notify();

      await this.waitForTrackedOperations();

      const cleanupResults = await Promise.allSettled([
        this.cache.clearAll(),
        clearCachedTilesRuntime(),
        clearPrefetchJobsRuntime(),
      ]);
      for (const result of cleanupResults) {
        if (result.status === 'rejected') {
          console.error('Failed to wipe local cache data:', result.reason);
        }
      }

      // Recreate a fresh prefetch service so runtime state restarts from zero.
      this.attachTilePrefetch(this.createTilePrefetchService());
      // Rebuild the offline queue so its in-memory ops are dropped along with
      // the persisted store (cleared by cache.clearAll above).
      this.offlineQueue = this.buildOfflineQueue();
      this._pendingOpsRevision += 1;
      this.notify();
    } finally {
      this._isPurgingLocalData = false;
    }
  }

  // ---- Project sync ---------------------------------------------------------

  /**
   * Main sync orchestrator.
   *
   * 1. Load cached projects immediately so the UI can render without waiting.
   * 2. If online, fetch the fresh list from the API, cache it, then
   *    download any new/changed geojson files in the background.
   */
  async syncProjects(): Promise<SyncProjectsResult> {
    return this.trackOperation((async () => {
      const context = this.beginSyncContext();
      const result = this.createSyncProjectsResult(context.runId);

      try {
        result.phases.cacheLoad = await this.loadCachedProjectsPhase(context);

        if (!this.hasNetworkAccess()) {
          result.phases.projectRefresh = {
            phase: 'project_refresh',
            status: 'skipped',
            reason: 'offline_locked',
            projectCount: 0,
            httpStatus: null,
            cacheWriteSucceeded: false,
            preservedCachedProjects: this._projects.length > 0,
          };
          result.phases.geojsonSync = this.createSkippedGeoJSONPhase('offline_locked');
          result.phases.overlaySync = this.createSkippedOverlaySyncPhase('offline_locked');
          result.phases.tilePrefetch = this.createSkippedTilePrefetchPhase('offline_locked');

          const finalStatus = this.deriveSyncCompletionStatus(result.phases.projectRefresh);
          if (this.isSyncContextCurrent(context)) {
            this._syncStatus = finalStatus;
            this.notify();
          }
          result.status = finalStatus;
          return result;
        }

        const credentials = this.getSyncCredentials();
        if (!credentials) {
          result.phases.projectRefresh = {
            phase: 'project_refresh',
            status: 'skipped',
            reason: 'missing_credentials',
            projectCount: 0,
            httpStatus: null,
            cacheWriteSucceeded: false,
            preservedCachedProjects: this._projects.length > 0,
          };
          result.phases.geojsonSync = this.createSkippedGeoJSONPhase('missing_credentials');
          result.phases.overlaySync = this.createSkippedOverlaySyncPhase('missing_credentials');
          result.phases.tilePrefetch = this.createSkippedTilePrefetchPhase('missing_credentials');

          const finalStatus = this.deriveSyncCompletionStatus(result.phases.projectRefresh);
          if (this.isSyncContextCurrent(context)) {
            this._syncStatus = finalStatus;
            this.notify();
          }
          result.status = finalStatus;
          return result;
        }

        if (this.isSyncContextCurrent(context)) {
          this._syncStatus = 'syncing';
          this.notify();
        }

        const refreshOutcome = await this.refreshProjectsPhase(
          context,
          credentials.instance,
          credentials.token,
        );
        result.phases.projectRefresh = refreshOutcome.phase;

        if (refreshOutcome.projects) {
          result.phases.geojsonSync = await this.syncGeoJSONPhase(
            context,
            refreshOutcome.projects,
          );
          result.phases.overlaySync = await this.syncMapOverlaysPhase(
            context,
            credentials.instance,
            credentials.token,
          );
          // The overlay caches (incl. landmarks) were just rewritten from the
          // server. `lastSyncedAt` already fired during the earlier project
          // refresh phase (before this rewrite), so bump the overlay revision
          // now to make the UI re-read the freshly written cache. Without this,
          // a landmark deleted/added elsewhere would not appear after a resync.
          if (
            this.isSyncContextCurrent(context)
            && result.phases.overlaySync.status !== 'skipped'
          ) {
            this.bumpLandmarksRevision();
          }
          // Refresh the server GPS-track list (best-effort; mirrors overlays).
          await this.syncGpsTracksPhase(context, credentials.instance, credentials.token);
          result.phases.tilePrefetch = await this.scheduleTilePrefetchPhase(
            context,
            refreshOutcome.projects,
          );
        } else {
          result.phases.geojsonSync = this.createSkippedGeoJSONPhase(
            result.phases.projectRefresh.reason,
          );
          result.phases.overlaySync = this.createSkippedOverlaySyncPhase(
            result.phases.projectRefresh.reason,
          );
          result.phases.tilePrefetch = this.createSkippedTilePrefetchPhase(
            result.phases.projectRefresh.reason,
          );
        }

        const finalStatus = this.deriveSyncCompletionStatus(result.phases.projectRefresh);
        if (this.isSyncContextCurrent(context)) {
          this._syncStatus = finalStatus;
          this.notify();
        }
        result.status = finalStatus;
        return result;
      } catch (error) {
        if (isAbortError(error) || !this.isSyncContextCurrent(context)) {
          return this.finalizeAbortedSyncResult(result);
        }

        console.warn('syncProjects: unexpected sync failure:', error);
        const finalStatus = this.deriveSyncCompletionStatus(result.phases.projectRefresh);
        if (this.isSyncContextCurrent(context)) {
          this._syncStatus = finalStatus;
          this.notify();
        }
        result.status = finalStatus;
        return result;
      } finally {
        if (this.activeSyncContext === context) {
          this.activeSyncContext = null;
        }
      }
    })());
  }

  /**
   * Read a single project's geojson from the cache.
   */
  async getProjectGeoJSON(projectId: string): Promise<unknown | null> {
    return this.cache.getGeoJSON(projectId);
  }

  /**
   * Read an overlay GeoJSON payload from cache.
   *
   * For landmarks, this returns the optimistic view: the cached server snapshot
   * (ground truth) with all pending offline ops folded over it in order. When
   * there are no pending ops it returns the raw cached payload unchanged, so the
   * online path is unaffected.
   */
  async getOverlayGeoJSON(overlayId: MapOverlayId): Promise<unknown | null> {
    const raw = await this.cache.getOverlayGeoJSON(overlayId);
    if (overlayId !== 'landmarks') return raw;
    await this.offlineQueue.load();
    if (this.offlineQueue.count === 0) return raw;
    const base = normalizeGeoJSON(raw) ?? { type: 'FeatureCollection', features: [] };
    return this.offlineQueue.foldOver(base);
  }

  // ==================== Landmark CRUD ====================

  /**
   * Fetch the user's writable landmark collections (for the create/edit picker).
   *
   * Online: fetches fresh and caches the result so offline creates can still
   * pick a collection. Offline (or on any failure): returns the cached list, or
   * `[]` so the form falls back to the personal collection. Never throws.
   */
  async getLandmarkCollections(): Promise<LandmarkCollection[]> {
    if (!this.hasNetworkAccess()) {
      return (await this.cache.getLandmarkCollections()) ?? [];
    }
    const credentials = this.getSyncCredentials();
    if (!credentials) return [];

    try {
      const response = await this.service.getLandmarkCollections(
        credentials.instance,
        credentials.token,
      );
      if (!isSuccessfulStatus(response.status)) {
        return (await this.cache.getLandmarkCollections()) ?? [];
      }
      const collections = mapLandmarkCollections(response.data);
      await this.cache.setLandmarkCollections(collections);
      return collections;
    } catch (error) {
      if (isAbortError(error)) return [];
      console.warn('Failed to load landmark collections:', error);
      return (await this.cache.getLandmarkCollections()) ?? [];
    }
  }

  /**
   * Create a landmark.
   *
   * Online + reachable: POST, then upsert into the cached overlay (the existing
   * single cache-write seam). If offline-locked or the request fails in a way
   * that means "not reachable" (transport error / timeout / 5xx), the create is
   * enqueued as an offline op and folded optimistically. Definitive failures
   * (4xx: validation/duplicate/permission) still throw `LandmarkMutationError`.
   */
  async createLandmark(input: LandmarkCreateInput): Promise<LandmarkApiObject> {
    const credentials = this.getSyncCredentials();
    if (!credentials) throw new LandmarkMutationError('permission', 'You are not signed in.');

    if (this.hasNetworkAccess()) {
      try {
        const response = await this.attemptLandmarkRequest(() =>
          this.service.createLandmark(credentials.instance, credentials.token, input),
        );
        const landmark = this.extractLandmark(response.status, response.data);
        await this.applyLandmarkUpsert(landmark);
        return landmark;
      } catch (error) {
        if (this.isUnreachableError(error)) {
          this.enterOfflineMode();
          return this.enqueueCreate(input);
        }
        throw error;
      }
    }
    return this.enqueueCreate(input);
  }

  /**
   * Edit a landmark. Same online/offline/4xx semantics as `createLandmark`.
   */
  async updateLandmark(
    id: string,
    input: LandmarkUpdateInput,
  ): Promise<LandmarkApiObject> {
    const credentials = this.getSyncCredentials();
    if (!credentials) throw new LandmarkMutationError('permission', 'You are not signed in.');

    if (this.hasNetworkAccess()) {
      try {
        const response = await this.attemptLandmarkRequest(() =>
          this.service.updateLandmark(credentials.instance, credentials.token, id, input),
        );
        const landmark = this.extractLandmark(response.status, response.data);
        await this.applyLandmarkUpsert(landmark);
        return landmark;
      } catch (error) {
        if (this.isUnreachableError(error)) {
          this.enterOfflineMode();
          return this.enqueueUpdate(id, input);
        }
        throw error;
      }
    }
    return this.enqueueUpdate(id, input);
  }

  /**
   * Delete a landmark. Same online/offline/4xx semantics as `createLandmark`.
   */
  async deleteLandmark(id: string): Promise<void> {
    const credentials = this.getSyncCredentials();
    if (!credentials) throw new LandmarkMutationError('permission', 'You are not signed in.');

    if (this.hasNetworkAccess()) {
      try {
        const response = await this.attemptLandmarkRequest(() =>
          this.service.deleteLandmark(credentials.instance, credentials.token, id),
        );
        if (!isSuccessfulStatus(response.status)) {
          throw parseLandmarkMutationError(response.status, response.data);
        }
        await this.applyLandmarkRemoval(id);
        return;
      } catch (error) {
        if (this.isUnreachableError(error)) {
          this.enterOfflineMode();
          await this.enqueueDelete(id);
          return;
        }
        throw error;
      }
    }
    await this.enqueueDelete(id);
  }

  // ---- GPS track recording + upload -----------------------------------------

  /**
   * Begin recording a GPS track. Requests location permission and starts the
   * shared position watch (no watcher-level filters; gating is the shared
   * `shouldAcceptFix` time gate). Throws if permission is denied so the UI can
   * surface it. A no-op when already recording.
   */
  async startTrackRecording(): Promise<void> {
    if (this._gpsRecordingState === 'recording') return;
    if (this._gpsRecordingState === 'paused') {
      await this.resumeTrackRecording();
      return;
    }
    const permission = await this.geolocationWatcher.requestPermissions();
    if (permission !== 'granted') {
      throw new Error('Location permission is required to record a GPS track.');
    }
    // Best-effort: prompt for the Android 13+ notification permission so the
    // foreground-service recording notification is visible. Recording does NOT
    // depend on it -- the foreground service still runs if the user declines, the
    // notification is just hidden -- so a denial must never block the core field
    // feature. No-op on iOS/web (the guard returns 'granted'). See docs/gps-tracks.md.
    await this.recordingNotificationPermission.requestPermission();
    const now = Date.now();
    this._recordingTrackId = generateUuid();
    this._recordingStartedAt = now;
    this._recordingActiveElapsedMs = 0;
    this._recordingActiveStartedAt = now;
    this._recordingWatchSessionStartedAt = now;
    this._recordingName = this.defaultTrackName(now);
    this._recordingColor = randomTrackColor();
    this._currentTrackPoints = [];
    this._gpsRecordingState = 'recording';
    this._gpsRecordingError = null;
    // No record is written until the first fix arrives (see appendTrackPoint),
    // which persists incrementally for crash recovery. Persisting an empty
    // track up front would, on a force-quit during GPS warm-up, leave a useless
    // 0-point "track" in the list that cannot be uploaded.
    this.bumpGpsTracksRevision();
    try {
      await this.startGpsWatch();
    } catch (error) {
      await this.geolocationWatcher.stop();
      this._currentTrackPoints = [];
      this._recordingTrackId = null;
      this._recordingColor = '';
      this.resetRecordingTiming();
      this._recordingName = '';
      this._gpsRecordingState = 'idle';
      this.bumpGpsTracksRevision();
      throw error;
    }
  }

  /** Pause recording: stop the watch but keep the captured buffer. */
  async pauseTrackRecording(): Promise<void> {
    if (this._gpsRecordingState !== 'recording') return;
    await this.geolocationWatcher.stop();
    this.freezeRecordingElapsed();
    this._gpsRecordingState = 'paused';
    this.bumpGpsTracksRevision();
  }

  /** Resume a paused recording. */
  async resumeTrackRecording(): Promise<void> {
    if (this._gpsRecordingState !== 'paused') return;
    // Best-effort notification permission (see startTrackRecording); a denial
    // never blocks resuming -- the foreground service runs regardless.
    await this.recordingNotificationPermission.requestPermission();
    const previousSessionStartedAt = this._recordingWatchSessionStartedAt;
    const previousActiveStartedAt = this._recordingActiveStartedAt;
    this._gpsRecordingState = 'recording';
    const now = Date.now();
    this._recordingActiveStartedAt = now;
    this._recordingWatchSessionStartedAt = now;
    this.bumpGpsTracksRevision();
    try {
      await this.startGpsWatch();
    } catch (error) {
      this._gpsRecordingState = 'paused';
      this._recordingWatchSessionStartedAt = previousSessionStartedAt;
      this._recordingActiveStartedAt = previousActiveStartedAt;
      this.bumpGpsTracksRevision();
      throw error;
    }
  }

  /**
   * Stop recording and persist the captured points as a new track. Returns the
   * saved track, or null when nothing was captured (the session is discarded).
   */
  async stopTrackRecording(name?: string): Promise<LocalGpsTrack | null> {
    if (this._gpsRecordingState === 'idle') return null;
    await this.geolocationWatcher.stop();
    const points = this._currentTrackPoints;
    const id = this._recordingTrackId;
    const startedAt = this._recordingStartedAt;
    const recordingName = this._recordingName;
    this.freezeRecordingElapsed();
    await this.waitForTrackedOperations();
    this._currentTrackPoints = [];
    this._recordingTrackId = null;
    this.resetRecordingTiming();
    this._recordingName = '';
    this._gpsRecordingState = 'idle';

    // Nothing captured: discard the empty in-progress record.
    if (!id || points.length === 0) {
      if (id) {
        await this.gpsTrackStore.remove(id).catch((error) => {
          console.warn('Failed to discard empty GPS track:', error);
        });
      }
      this.bumpGpsTracksRevision();
      return null;
    }

    const track = this.buildFinalizedTrack(id, name?.trim() || recordingName, points, startedAt);
    await this.enqueueGpsTrackPersist(track);
    this._gpsTracks = [track, ...this._gpsTracks];
    this.bumpGpsTracksRevision();
    return track;
  }

  /**
   * Abandon the in-progress recording: stop the watch and delete the captured
   * buffer without saving a track. Used by the recording screen's Cancel
   * action. A no-op when not recording.
   */
  async discardTrackRecording(): Promise<void> {
    if (this._gpsRecordingState === 'idle') return;
    await this.geolocationWatcher.stop();
    this._gpsPersistGeneration += 1;
    await this.waitForTrackedOperations();
    const id = this._recordingTrackId;
    this._currentTrackPoints = [];
    this._recordingTrackId = null;
    this.resetRecordingTiming();
    this._recordingName = '';
    this._gpsRecordingState = 'idle';
    if (id) {
      await this.gpsTrackStore.remove(id).catch((error) => {
        console.warn('Failed to discard GPS track recording:', error);
      });
    }
    this.bumpGpsTracksRevision();
  }

  /**
   * Build the unified GPS-track list the panel + map consume: server tracks
   * (ground truth with pending update/delete ops folded over them) plus local
   * recordings, each annotated with derived pending state from the queue.
   */
  private buildUnifiedGpsTracks(): GpsTrackListItem[] {
    const pending = this.offlineQueue
      ? this.offlineQueue.gpsPendingBySubject()
      : new Map<string, { state: GpsTrackListItem['pending']; error?: string | null }>();
    const items: GpsTrackListItem[] = [];

    for (const track of this._gpsTracks) {
      const summary = summarizeTrack(track.points);
      const p = pending.get(track.id);
      items.push({
        id: track.id,
        name: track.name,
        // Guarantee a valid hex even for tracks recorded by an older build that
        // predates `LocalGpsTrack.color` (otherwise editing one feeds `undefined`
        // into the edit modal's `color.toLowerCase()` and crashes the app).
        color: normalizeHexColor(track.color),
        origin: 'local',
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        pointCount: summary.pointCount,
        distanceMeters: summary.distanceMeters,
        durationMs: summary.durationMs,
        pending: p?.state,
        pendingError: p?.error ?? null,
      });
    }

    const remote = this.offlineQueue
      ? this.offlineQueue.foldGpsTracks(this._remoteGpsTracks)
      : this._remoteGpsTracks;
    for (const track of remote) {
      const p = pending.get(track.id);
      items.push({
        id: track.id,
        name: track.name,
        color: track.color,
        origin: 'remote',
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        pending: p?.state,
        pendingError: p?.error ?? null,
      });
    }

    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Serialize a unified track to a GPX document + file name for export / share.
   * Works for local recordings (in-memory points) and server tracks (geometry
   * downloaded + cached on demand). Reuses the same builder as upload.
   */
  async buildGpxFileForTrack(item: GpsTrackListItem): Promise<GpsTrackGpxFile> {
    const local = this._gpsTracks.find((t) => t.id === item.id);
    if (local) return this.gpsTrackGpxService.buildFile(local);
    const points = await this.getGpsTrackPoints(item.id);
    const synthetic: LocalGpsTrack = {
      id: item.id,
      name: item.name,
      color: item.color,
      points,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    return this.gpsTrackGpxService.buildFile(synthetic);
  }

  /**
   * Points for a track, for map display + GPX export. Local recordings return
   * their in-memory buffer; server tracks download + cache their GeoJSON.
   */
  async getGpsTrackPoints(id: string): Promise<RecordedPoint[]> {
    const local = this._gpsTracks.find((t) => t.id === id);
    if (local) return [...local.points];
    const geojson = await this.getGpsTrackGeoJSON(id);
    return geojson ? gpsTrackGeoJsonToPoints(geojson) : [];
  }

  /**
   * Cache-first GeoJSON geometry for a server track (downloaded from its signed
   * URL on first use). Returns null for a local track (use its points) or when
   * unavailable offline.
   */
  async getGpsTrackGeoJSON(id: string): Promise<GeoJSON.FeatureCollection | null> {
    if (this._gpsTracks.some((t) => t.id === id)) return null;
    const cached = await this.cache.getGpsTrackGeoJSON(id);
    if (cached) {
      const normalizedCache = normalizeGeoJSON(cached);
      if (normalizedCache) return normalizedCache;
    }
    const remote = this._remoteGpsTracks.find((t) => t.id === id);
    if (!remote || !remote.fileUrl || !this.hasNetworkAccess()) return null;
    try {
      const response = await this.service.downloadJSON(remote.fileUrl);
      if (!isSuccessfulStatus(response.status)) return null;
      // The signed URL serves `application/geo+json`; native transports
      // (CapacitorHttp) hand that back as a raw string rather than parsed JSON,
      // so normalize it (parse + unwrap) exactly like project geojson before
      // caching. Without this the track downloads but renders no line on device.
      const normalized = normalizeGeoJSON(response.data);
      if (!normalized) return null;
      await this.cache.setGpsTrackGeoJSON(id, normalized);
      return normalized;
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn(`Failed to download GPS track GeoJSON ${id}:`, error);
      return null;
    }
  }

  /**
   * Upload a recorded local track (the "create" mutation). Mirrors
   * `createLandmark`: an online 2xx deletes the local copy and re-syncs the
   * server list; an unreachable failure flips offline and enqueues a
   * `CreateGpsTrackOp` (drained from the Pending page); a definitive 4xx throws.
   */
  async uploadGpsTrack(id: string): Promise<void> {
    const track = this._gpsTracks.find((t) => t.id === id);
    if (!track) return;
    if (track.points.length === 0) {
      throw new Error('This track has no points to upload.');
    }
    if (this.hasNetworkAccess() && this.getSyncCredentials()) {
      let response: { status: number; data: unknown };
      try {
        response = await this.performGpsUpload(track);
      } catch (error) {
        if (isAbortError(error)) throw error;
        this.enterOfflineMode();
        await this.enqueueGpsCreate(track);
        return;
      }
      if (isSuccessfulStatus(response.status)) {
        await this.finalizeGpsUpload(id);
        return;
      }
      if (isRetryableGpsUploadStatus(response.status)) {
        if (response.status !== 429) this.enterOfflineMode();
        await this.enqueueGpsCreate(track);
        return;
      }
      // Definitive 4xx: surface to the user; do not enqueue.
      throw new Error(this.parseGpxUploadError(response.data));
    }
    await this.enqueueGpsCreate(track);
  }

  /**
   * Edit a track's name/color. A local recording is edited in place (no
   * network; any pending upload op is updated to match). A server track follows
   * the landmark online-attempt-then-enqueue model (PATCH; enqueue on
   * unreachable; throw on definitive 4xx).
   */
  async editGpsTrack(id: string, input: { name?: string; color?: string }): Promise<void> {
    const local = this._gpsTracks.find((t) => t.id === id);
    if (local) {
      const name = input.name?.trim() ? input.name.trim() : local.name;
      const color = input.color !== undefined ? normalizeHexColor(input.color, local.color) : local.color;
      await this.updateGpsTrack(id, { name, color });
      if (this.offlineQueue.hasGpsCreateFor(id)) {
        await this.offlineQueue.enqueueGpsCreate({ id, name, color });
      }
      return;
    }

    const baseline = this.currentGpsTrackSnapshot(id);
    const next: GpsTrackSnapshot = {
      name: input.name?.trim() ? input.name.trim() : baseline?.name ?? '',
      color: input.color !== undefined ? normalizeHexColor(input.color, baseline?.color) : baseline?.color ?? normalizeHexColor(undefined),
    };
    const patch: GpsTrackUpdateInput = { name: next.name, color: next.color };

    if (this.hasNetworkAccess() && this.getSyncCredentials()) {
      const credentials = this.getSyncCredentials()!;
      let response: { status: number; data: unknown };
      try {
        response = await this.service.updateGpsTrack(credentials.instance, credentials.token, id, patch);
      } catch (error) {
        if (isAbortError(error)) throw error;
        this.enterOfflineMode();
        await this.enqueueGpsUpdate(id, baseline, next);
        return;
      }
      if (isSuccessfulStatus(response.status)) {
        await this.applyGpsTrackUpsert(this.mergeRemoteTrack(id, next, response.data));
        return;
      }
      if (isRetryableGpsUploadStatus(response.status)) {
        if (response.status !== 429) this.enterOfflineMode();
        await this.enqueueGpsUpdate(id, baseline, next);
        return;
      }
      throw new Error(this.parseGpxUploadError(response.data));
    }
    await this.enqueueGpsUpdate(id, baseline, next);
  }

  /**
   * Delete a track. A local recording is removed from this device (and any
   * pending upload op discarded). A server track follows the landmark model
   * (DELETE; enqueue on unreachable; throw on definitive 4xx).
   */
  async removeGpsTrack(id: string): Promise<void> {
    const local = this._gpsTracks.find((t) => t.id === id);
    if (local) {
      await this.offlineQueue.discardGpsTrackOpsForSubject(id);
      await this.removeLocalGpsTrack(id);
      return;
    }

    const baseline = this.currentGpsTrackSnapshot(id);
    if (this.hasNetworkAccess() && this.getSyncCredentials()) {
      const credentials = this.getSyncCredentials()!;
      let response: { status: number; data: unknown };
      try {
        response = await this.service.deleteGpsTrack(credentials.instance, credentials.token, id);
      } catch (error) {
        if (isAbortError(error)) throw error;
        this.enterOfflineMode();
        await this.enqueueGpsDelete(id, baseline);
        return;
      }
      if (isSuccessfulStatus(response.status) || response.status === 404) {
        await this.applyGpsTrackRemoval(id);
        return;
      }
      if (isRetryableGpsUploadStatus(response.status)) {
        if (response.status !== 429) this.enterOfflineMode();
        await this.enqueueGpsDelete(id, baseline);
        return;
      }
      throw new Error(this.parseGpxUploadError(response.data));
    }
    await this.enqueueGpsDelete(id, baseline);
  }

  /** Refresh the server GPS-track list (used after an upload + standalone). */
  async syncGpsTracks(): Promise<void> {
    if (!this.hasNetworkAccess()) return;
    const credentials = this.getSyncCredentials();
    if (!credentials) return;
    try {
      const response = await this.service.getGpsTracks(credentials.instance, credentials.token);
      if (!isSuccessfulStatus(response.status)) return;
      const tracks = parseRemoteGpsTracks(response.data);
      await this.cache.setGpsTracks(tracks);
      this._remoteGpsTracks = tracks;
      this.bumpGpsTracksRevision();
    } catch (error) {
      if (isAbortError(error)) return;
      console.warn('syncGpsTracks failed:', error);
    }
  }

  // ---- GPS track offline helpers --------------------------------------------

  /** Build + upload the GPX for a local track. Build errors map to a 4xx-shape. */
  private async performGpsUpload(track: LocalGpsTrack): Promise<{ status: number; data: unknown }> {
    const credentials = this.getSyncCredentials();
    if (!credentials) return { status: 401, data: { error: 'You are not signed in.' } };
    let gpxFile: GpsTrackGpxFile;
    try {
      gpxFile = await this.gpsTrackGpxService.buildFile(track);
    } catch (error) {
      if (error instanceof EmptyGpxTrackError || error instanceof MultipartPayloadError) {
        return { status: 422, data: { error: error.message } };
      }
      throw error;
    }
    const response = await this.service.uploadGpx(
      credentials.instance,
      credentials.token,
      gpxFile.gpx,
      gpxFile.fileName,
    );
    return { status: response.status, data: response.data };
  }

  /** After a confirmed upload: delete the local recording and re-sync the list. */
  private async finalizeGpsUpload(localTrackId: string): Promise<void> {
    await this.removeLocalGpsTrack(localTrackId);
    await this.syncGpsTracks();
  }

  /** Remove a local recording from the store + in-memory list. */
  private async removeLocalGpsTrack(id: string): Promise<void> {
    await this.gpsTrackStore.remove(id).catch((error) => {
      console.warn('Failed to delete GPS track:', error);
    });
    const before = this._gpsTracks.length;
    this._gpsTracks = this._gpsTracks.filter((t) => t.id !== id);
    if (this._gpsTracks.length !== before) this.bumpGpsTracksRevision();
  }

  private async enqueueGpsCreate(track: LocalGpsTrack): Promise<void> {
    try {
      await this.offlineQueue.enqueueGpsCreate({ id: track.id, name: track.name, color: track.color });
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
  }

  private async enqueueGpsUpdate(
    id: string,
    baseline: GpsTrackSnapshot | null,
    next: GpsTrackSnapshot,
  ): Promise<void> {
    try {
      await this.offlineQueue.enqueueGpsUpdate(id, baseline, next);
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
  }

  private async enqueueGpsDelete(id: string, baseline: GpsTrackSnapshot | null): Promise<void> {
    try {
      await this.offlineQueue.enqueueGpsDelete(id, baseline);
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
  }

  /** Last known server state of a track (ground truth), or null when unknown. */
  private currentGpsTrackSnapshot(id: string): GpsTrackSnapshot | null {
    const track = this._remoteGpsTracks.find((t) => t.id === id);
    return track ? snapshotFromRemote(track) : null;
  }

  /** Merge a PATCH result into a `RemoteGpsTrack`, preserving fileUrl/sha256. */
  private mergeRemoteTrack(id: string, next: GpsTrackSnapshot, responseData: unknown): RemoteGpsTrack {
    const parsed = parseRemoteGpsTrack(responseData);
    const existing = this._remoteGpsTracks.find((t) => t.id === id) ?? null;
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
      updatedAt: parsed?.updatedAt || Date.now(),
    };
  }

  /** Write a confirmed server track into the ground-truth cache. */
  private async applyGpsTrackUpsert(track: RemoteGpsTrack): Promise<void> {
    const list = (await this.cache.getGpsTracks()) ?? [];
    const index = list.findIndex((t) => t.id === track.id);
    const next =
      index === -1
        ? [track, ...list]
        : [...list.slice(0, index), { ...list[index], ...track }, ...list.slice(index + 1)];
    await this.cache.setGpsTracks(next);
    this._remoteGpsTracks = next;
    this.bumpGpsTracksRevision();
  }

  /** Remove a confirmed-deleted server track from the ground-truth cache. */
  private async applyGpsTrackRemoval(id: string): Promise<void> {
    const list = (await this.cache.getGpsTracks()) ?? [];
    const next = list.filter((t) => t.id !== id);
    await this.cache.setGpsTracks(next);
    this._remoteGpsTracks = next;
    await this.cache.removeGpsTrackGeoJSON(id);
    this.bumpGpsTracksRevision();
  }

  /**
   * Refresh the server GPS-track list as a sync phase (abort-aware). Best-effort:
   * a failure never fails the overall sync.
   */
  private async syncGpsTracksPhase(
    context: CancellationContext,
    instance: string,
    token: string,
  ): Promise<void> {
    if (!this.hasNetworkAccess()) return;
    try {
      const response = await this.service.getGpsTracks(instance, token, { signal: context.signal });
      context.throwIfAborted();
      if (!this.isSyncContextCurrent(context)) return;
      if (!isSuccessfulStatus(response.status)) return;
      const tracks = parseRemoteGpsTracks(response.data);
      await this.cache.setGpsTracks(tracks);
      context.throwIfAborted();
      this._remoteGpsTracks = tracks;
      this.bumpGpsTracksRevision();
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('syncGpsTracksPhase failed:', error);
    }
  }

  private async startGpsWatch(): Promise<void> {
    // Identical watch setup to the high-accuracy point collector: raw fixes,
    // no watcher-level filters. All gating happens in appendTrackPoint via the
    // shared shouldAcceptFix gate. (The old min-distance filter compared real
    // fixes against the OS's replayed last-known location and silently dropped
    // everything until the user moved >2 m, which delayed the first point by
    // ~15-20 s when standing still.)
    await this.geolocationWatcher.start(
      { ...GPS.WATCH_OPTIONS },
      (point) => this.appendTrackPoint(point),
      (error) => this.handleRecordingWatchError(error),
    );
  }

  /**
   * Handle a watch error raised during recording. A fatal authorization error
   * (permission denied/revoked, location off) stops the recording and surfaces
   * a message -- otherwise the UI would sit at "Recording - 0 pts" forever.
   * Captured points are never dropped: any already-buffered fixes are finalized
   * into a saved track. A transient error (e.g. brief signal loss) keeps
   * recording running.
   */
  private handleRecordingWatchError(error: unknown): void {
    if (!isFatalWatchError(error)) {
      console.warn('GPS watch error during recording:', error);
      return;
    }
    if (this._gpsRecordingState === 'idle') return;
    void this.geolocationWatcher.stop();
    const points = this._currentTrackPoints;
    const id = this._recordingTrackId;
    const startedAt = this._recordingStartedAt;
    const name = this._recordingName;
    this.freezeRecordingElapsed();
    this._currentTrackPoints = [];
    this._recordingTrackId = null;
    this.resetRecordingTiming();
    this._recordingName = '';
    this._gpsRecordingState = 'idle';
    this._gpsRecordingError =
      points.length > 0
        ? `${GPS_RECORDING_PERMISSION_LOST_MESSAGE} Your ${points.length}-point track was saved.`
        : GPS_RECORDING_PERMISSION_LOST_MESSAGE;

    if (id && points.length > 0) {
      // Keep what was captured: finalize the partial track so no fixes are lost.
      const track = this.buildFinalizedTrack(id, name, points, startedAt);
      void this.enqueueGpsTrackPersist(track);
      this._gpsTracks = [track, ...this._gpsTracks];
    } else if (id) {
      void this.gpsTrackStore.remove(id).catch((removeError) => {
        console.warn('Failed to discard empty GPS track:', removeError);
      });
    }
    this.bumpGpsTracksRevision();
  }

  /** Clear the one-shot recording error after the UI has surfaced it. */
  clearGpsRecordingError(): void {
    if (this._gpsRecordingError === null) return;
    this._gpsRecordingError = null;
    this.notify();
  }

  private appendTrackPoint(point: RecordedPoint): void {
    if (this._gpsRecordingState !== 'recording' || !this._recordingTrackId) return;
    // Shared GPS gate (same as averaging): drop the OS's replayed pre-recording
    // fix, then keep at most one fix per TRACK_SAMPLE_INTERVAL_MS (~15 s). The
    // first real fix is kept immediately, so recording starts instantly.
    const last = this._currentTrackPoints[this._currentTrackPoints.length - 1];
    if (
      !shouldAcceptFix(point.timestamp, {
        sessionStartMs: this._recordingWatchSessionStartedAt - GPS.WATCH_START_STALE_FIX_GRACE_MS,
        lastAcceptedMs: last ? last.timestamp : null,
        minIntervalMs: GPS.TRACK_SAMPLE_INTERVAL_MS,
      })
    ) {
      return;
    }
    this._currentTrackPoints = [...this._currentTrackPoints, point];
    // Persist incrementally for crash recovery (fire-and-forget; the in-memory
    // buffer is the source of truth for the live UI).
    void this.enqueueGpsTrackPersist(this.buildRecordingTrack());
    this.bumpGpsTracksRevision();
  }

  /** Build a finalized (saved) track record from captured points. */
  private buildFinalizedTrack(
    id: string,
    name: string,
    points: RecordedPoint[],
    createdAt: number,
  ): LocalGpsTrack {
    return {
      id,
      name,
      color: this._recordingColor || randomTrackColor(),
      points,
      createdAt,
      updatedAt: Date.now(),
    };
  }

  private buildRecordingTrack(): LocalGpsTrack {
    return {
      id: this._recordingTrackId as string,
      name: this._recordingName,
      color: this._recordingColor || randomTrackColor(),
      points: this._currentTrackPoints,
      createdAt: this._recordingStartedAt,
      updatedAt: Date.now(),
    };
  }

  private async persistGpsTrack(track: LocalGpsTrack): Promise<void> {
    const generation = this._gpsPersistGeneration;
    if (this._isPurgingLocalData || !this._authState.isAuthenticated) return;
    try {
      await this.gpsTrackStore.put(track);
      if (
        generation !== this._gpsPersistGeneration ||
        this._isPurgingLocalData ||
        !this._authState.isAuthenticated
      ) {
        await this.gpsTrackStore.remove(track.id).catch(() => {
          // Best-effort cleanup of a write that finished after logout/discard.
        });
      }
    } catch (error) {
      console.warn('Failed to persist GPS track:', error);
    }
  }

  private enqueueGpsTrackPersist(track: LocalGpsTrack): Promise<void> {
    const run = () => this.persistGpsTrack(track);
    const queued = this._gpsPersistQueue ? this._gpsPersistQueue.then(run, run) : run();
    const trackedQueue = queued.catch(() => {
      // Keep the queue alive after a best-effort persistence failure.
    }).finally(() => {
      if (this._gpsPersistQueue === trackedQueue) this._gpsPersistQueue = null;
    });
    this._gpsPersistQueue = trackedQueue;
    return this.trackOperation(queued);
  }

  private async updateGpsTrack(
    id: string,
    patch: Partial<LocalGpsTrack>,
  ): Promise<LocalGpsTrack | null> {
    const index = this._gpsTracks.findIndex((t) => t.id === id);
    if (index === -1) return null;
    const updated: LocalGpsTrack = {
      ...this._gpsTracks[index],
      ...patch,
      updatedAt: Date.now(),
    };
    await this.enqueueGpsTrackPersist(updated);
    this._gpsTracks = [
      ...this._gpsTracks.slice(0, index),
      updated,
      ...this._gpsTracks.slice(index + 1),
    ];
    this.bumpGpsTracksRevision();
    return updated;
  }

  private bumpGpsTracksRevision(): void {
    this._gpsTracksRevision += 1;
    this.notify();
  }

  private defaultTrackName(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Track ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private parseGpxUploadError(data: unknown): string {
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const direct = obj.error ?? obj.detail ?? obj.message;
      if (typeof direct === 'string' && direct.trim()) return direct;
      const errors = obj.errors;
      if (errors && typeof errors === 'object') {
        const first = Object.values(errors as Record<string, unknown>)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
    }
    return 'The server could not import this GPS track.';
  }

  // ---- Offline enqueue helpers ----------------------------------------------

  private isUnreachableError(error: unknown): boolean {
    return error instanceof LandmarkMutationError && error.kind === 'network';
  }

  /**
   * Issue a landmark HTTP call, treating transport failures, timeouts, and 5xx
   * as "not reachable" (a `network` LandmarkMutationError -> enqueue). A 4xx
   * passes through as the raw response so the caller can surface the typed
   * validation/permission/duplicate error.
   */
  private async attemptLandmarkRequest<T>(
    call: () => Promise<{ status: number; data: T }>,
  ): Promise<{ status: number; data: T }> {
    let response: { status: number; data: T };
    try {
      response = await call();
    } catch (error) {
      if (error instanceof LandmarkMutationError) throw error;
      throw new LandmarkMutationError(
        'network',
        'Could not reach the server. Check your connection and try again.',
      );
    }
    if (response.status >= 500) {
      throw new LandmarkMutationError(
        'network',
        'Could not reach the server. Check your connection and try again.',
      );
    }
    return response;
  }

  private async enqueueCreate(input: LandmarkCreateInput): Promise<LandmarkApiObject> {
    const landmark = await this.buildOptimisticCreate(input);
    try {
      await this.offlineQueue.enqueueCreate(landmark);
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
    return landmark;
  }

  private async enqueueUpdate(
    id: string,
    input: LandmarkUpdateInput,
  ): Promise<LandmarkApiObject> {
    // The footprint is ONLY the last known server state from the ground-truth
    // cache. If the landmark isn't in the ground truth we record `null` rather
    // than fabricating a baseline from the user's own edit -- inventing one
    // would guarantee a false "changed on the server" conflict on the next sync.
    const baseline = await this.currentLandmarkSnapshot(id);
    const next = this.snapshotFromUpdate(input, baseline);
    try {
      await this.offlineQueue.enqueueUpdate(id, baseline, next);
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
    return {
      id,
      name: next.name,
      description: next.description,
      latitude: next.latitude,
      longitude: next.longitude,
      collection: next.collection ?? '',
    };
  }

  private async enqueueDelete(id: string): Promise<void> {
    const baseline = await this.currentLandmarkSnapshot(id);
    try {
      await this.offlineQueue.enqueueDelete(id, baseline);
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
  }

  private throwOfflineQueuePersistenceError(error: unknown): never {
    if (error instanceof OfflineOpPersistenceError) {
      throw new LandmarkMutationError(
        'unknown',
        'Could not save this offline change on this device. Please try again before closing the app.',
      );
    }
    throw error;
  }

  /**
   * Footprint of a landmark's last known server state, read from the
   * ground-truth cache. Returns `null` when the landmark is not in the ground
   * truth (see the footprint rules in docs/offline-op-queue.md).
   */
  private async currentLandmarkSnapshot(id: string): Promise<LandmarkSnapshot | null> {
    const fc = normalizeGeoJSON(await this.cache.getOverlayGeoJSON('landmarks'));
    const feature = findLandmarkFeature(fc, id);
    return feature ? snapshotFromFeature(feature) : null;
  }

  private snapshotFromUpdate(
    input: LandmarkUpdateInput,
    fallback: LandmarkSnapshot | null,
  ): LandmarkSnapshot {
    return {
      name: input.name ?? fallback?.name ?? '',
      description: input.description ?? fallback?.description ?? '',
      latitude: roundCoordinate(input.latitude ?? fallback?.latitude ?? 0),
      longitude: roundCoordinate(input.longitude ?? fallback?.longitude ?? 0),
      collection:
        input.collection !== undefined
          ? normalizeCollection(input.collection)
          : fallback?.collection ?? null,
    };
  }

  /** Build the optimistic landmark for an offline create (resolves display props from cache). */
  private async buildOptimisticCreate(input: LandmarkCreateInput): Promise<LandmarkApiObject> {
    const collectionId =
      typeof input.collection === 'string' && input.collection.trim() !== ''
        ? input.collection.trim()
        : null;
    let collectionName = 'Personal Landmarks';
    let collectionColor = '';
    let isPersonal = collectionId === null;
    if (collectionId) {
      const cached = await this.cache.getLandmarkCollections();
      const match = cached?.find((collection) => collection.id === collectionId);
      collectionName = match?.name ?? '';
      collectionColor = match?.color ?? '';
      isPersonal = match?.isPersonal ?? false;
    }
    return {
      id: generateLocalLandmarkId(),
      name: input.name,
      description: input.description ?? '',
      latitude: roundCoordinate(input.latitude),
      longitude: roundCoordinate(input.longitude),
      collection: collectionId ?? '',
      collection_name: collectionName,
      collection_color: collectionColor,
      is_personal_collection: isPersonal,
      can_write: true,
      can_delete: true,
    };
  }

  // ---- Offline queue public API ---------------------------------------------

  /** Pending offline ops, newest first (for the Pending page). */
  getPendingOps(): OfflineOpView[] {
    return this.offlineQueue.views();
  }

  /** Replay every pending op against the server. */
  async syncOfflineOps(): Promise<OfflineSyncSummary> {
    return this.offlineQueue.syncAll();
  }

  /** Replay a single pending op. */
  async syncOfflineOp(id: string): Promise<OfflineSyncSummary> {
    return this.offlineQueue.syncOne(id);
  }

  /** Discard a pending op; the map reverts to the prior version via re-fold. */
  async discardOfflineOp(id: string): Promise<void> {
    await this.offlineQueue.discard(id);
  }

  /** Resolve a conflicted op by keeping the local change or the server version. */
  async resolveOfflineOpConflict(
    id: string,
    choice: OfflineConflictChoice,
  ): Promise<OfflineSyncSummary> {
    return this.offlineQueue.resolveConflict(id, choice);
  }

  private extractLandmark(status: number, data: unknown): LandmarkApiObject {
    if (!isSuccessfulStatus(status)) {
      throw parseLandmarkMutationError(status, data);
    }
    const envelope = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const candidate =
      envelope.landmark && typeof envelope.landmark === 'object'
        ? (envelope.landmark as Record<string, unknown>)
        : envelope;
    if (typeof candidate.id !== 'string' || candidate.id === '') {
      throw new LandmarkMutationError(
        'unknown',
        'The server returned an unexpected response.',
        { status },
      );
    }
    return candidate as unknown as LandmarkApiObject;
  }

  private async applyLandmarkUpsert(landmark: LandmarkApiObject): Promise<void> {
    const current = normalizeGeoJSON(await this.cache.getOverlayGeoJSON('landmarks'));
    const next = upsertLandmarkFeature(current, landmark);
    await this.cache.setOverlayGeoJSON('landmarks', next);
    this.bumpLandmarksRevision();
  }

  private async applyLandmarkRemoval(id: string): Promise<void> {
    const current = normalizeGeoJSON(await this.cache.getOverlayGeoJSON('landmarks'));
    const next = removeLandmarkFeature(current, id);
    await this.cache.setOverlayGeoJSON('landmarks', next);
    this.bumpLandmarksRevision();
  }

  private bumpLandmarksRevision(): void {
    this._landmarksRevision += 1;
    this.notify();
  }

  /**
   * Download geojson files for all eligible projects, skipping those whose
   * cached version already matches the latest commit.
   *
   * Uses a simple worker-pool to limit concurrency to 3 parallel downloads.
   */
  private createSyncProjectsResult(runId: number): SyncProjectsResult {
    return {
      runId,
      status: 'done',
      phases: {
        cacheLoad: {
          phase: 'cache_load',
          status: 'skipped',
          reason: 'no_cached_projects',
          cachedProjectCount: 0,
        },
        projectRefresh: {
          phase: 'project_refresh',
          status: 'skipped',
          reason: 'missing_credentials',
          projectCount: 0,
          httpStatus: null,
          cacheWriteSucceeded: false,
          preservedCachedProjects: false,
        },
        geojsonSync: this.createSkippedGeoJSONPhase('no_geojson_candidates'),
        overlaySync: this.createSkippedOverlaySyncPhase('no_overlay_sync_needed'),
        tilePrefetch: this.createSkippedTilePrefetchPhase('no_prefetch_candidates'),
      },
    };
  }

  private createSkippedGeoJSONPhase(reason: GeoJSONSyncPhaseResult['reason']): GeoJSONSyncPhaseResult {
    return {
      phase: 'geojson_sync',
      status: reason === 'aborted' ? 'aborted' : 'skipped',
      reason,
      eligibleProjectCount: 0,
      downloadedProjectCount: 0,
      skippedProjectCount: 0,
      failedProjectCount: 0,
    };
  }

  private createSkippedOverlaySyncPhase(
    reason: OverlaySyncPhaseResult['reason'],
  ): OverlaySyncPhaseResult {
    return {
      phase: 'overlay_sync',
      status: reason === 'aborted' ? 'aborted' : 'skipped',
      reason,
      attemptedOverlayCount: 0,
      syncedOverlayCount: 0,
      failedOverlayCount: 0,
    };
  }

  private createSkippedTilePrefetchPhase(
    reason: TilePrefetchPhaseResult['reason'],
  ): TilePrefetchPhaseResult {
    return {
      phase: 'tile_prefetch',
      status: reason === 'aborted' ? 'aborted' : 'skipped',
      reason,
      eligibleProjectCount: 0,
      scheduledProjectCount: 0,
      failedProjectCount: 0,
    };
  }

  private finalizeAbortedSyncResult(result: SyncProjectsResult): SyncProjectsResult {
    if (result.phases.projectRefresh.status === 'skipped') {
      result.phases.projectRefresh = {
        phase: 'project_refresh',
        status: 'aborted',
        reason: 'aborted',
        projectCount: 0,
        httpStatus: null,
        cacheWriteSucceeded: false,
        preservedCachedProjects: this._projects.length > 0,
      };
    }
    if (result.phases.geojsonSync.status === 'skipped') {
      result.phases.geojsonSync = this.createSkippedGeoJSONPhase('aborted');
    }
    if (result.phases.overlaySync.status === 'skipped') {
      result.phases.overlaySync = this.createSkippedOverlaySyncPhase('aborted');
    }
    if (result.phases.tilePrefetch.status === 'skipped') {
      result.phases.tilePrefetch = this.createSkippedTilePrefetchPhase('aborted');
    }
    result.status = 'aborted';
    return result;
  }

  private deriveSyncCompletionStatus(
    projectRefreshPhase: ProjectRefreshPhaseResult,
  ): 'done' | 'error' {
    if (
      projectRefreshPhase.status === 'applied' ||
      (projectRefreshPhase.status === 'failed' &&
        projectRefreshPhase.reason === 'project_list_cache_write_failed')
    ) {
      return 'done';
    }

    return this._projects.length > 0 ? 'done' : 'error';
  }

  private getSyncCredentials(): { token: string; instance: string } | null {
    const prefs = this.prefs.getPreferences();
    const token = prefs.token;
    const instance = prefs.instance?.trim();
    if (!token || !instance) {
      return null;
    }

    return { token, instance };
  }

  private async loadCachedProjectsPhase(
    context: CancellationContext,
  ): Promise<CacheLoadPhaseResult> {
    try {
      const cached = await this.cache.getProjects({ signal: context.signal });
      context.throwIfAborted();

      if (cached === null) {
        return {
          phase: 'cache_load',
          status: 'skipped',
          reason: 'no_cached_projects',
          cachedProjectCount: 0,
        };
      }

      this._projects = cached;
      this.notify();
      return {
        phase: 'cache_load',
        status: 'applied',
        reason: 'cached_projects_loaded',
        cachedProjectCount: cached.length,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      console.warn('Failed to load cached projects:', error);
      return {
        phase: 'cache_load',
        status: 'failed',
        reason: 'cache_load_failed',
        cachedProjectCount: 0,
      };
    }
  }

  private async refreshProjectsPhase(
    context: CancellationContext,
    instance: string,
    token: string,
  ): Promise<{ phase: ProjectRefreshPhaseResult; projects: Project[] | null }> {
    try {
      const response = await this.service.getProjectsGeoJSON(
        instance,
        token,
        { signal: context.signal },
      );
      context.throwIfAborted();

      if (!isSuccessfulStatus(response.status)) {
        console.warn(
          `syncProjects: refresh skipped (status=${response.status}); preserving cached projects.`,
        );
        // A 4xx means the server is reachable (auth/validation issue) and never
        // triggers logout here per the v2 contract -- keep current behavior. A
        // 5xx / non-4xx status means the backend is unreachable, so flip the
        // app offline (shows the offline modal + reveals Go Online).
        if (!isClientErrorStatus(response.status)) {
          this.enterOfflineMode();
        }
        return {
          phase: {
            phase: 'project_refresh',
            status: 'failed',
            reason: 'project_refresh_rejected',
            projectCount: 0,
            httpStatus: response.status,
            cacheWriteSucceeded: false,
            preservedCachedProjects: this._projects.length > 0,
          },
          projects: null,
        };
      }

      if (!Array.isArray(response.data)) {
        console.warn(
          `syncProjects: refresh skipped (status=${response.status}); preserving cached projects.`,
        );
        return {
          phase: {
            phase: 'project_refresh',
            status: 'failed',
            reason: 'project_refresh_malformed',
            projectCount: 0,
            httpStatus: response.status,
            cacheWriteSucceeded: false,
            preservedCachedProjects: this._projects.length > 0,
          },
          projects: null,
        };
      }

      const freshProjects = response.data;
      this._projects = freshProjects;
      this._isOnline = true;
      this.setOfflineLocked(false);
      const cacheWriteSucceeded = await this.cache.setProjects(
        freshProjects,
        { signal: context.signal },
      );
      context.throwIfAborted();
      if (cacheWriteSucceeded) {
        this.recordSuccessfulSync();
      }
      this.notify();

      return {
        phase: {
          phase: 'project_refresh',
          status: cacheWriteSucceeded ? 'applied' : 'failed',
          reason: cacheWriteSucceeded
            ? 'project_list_refreshed'
            : 'project_list_cache_write_failed',
          projectCount: freshProjects.length,
          httpStatus: response.status,
          cacheWriteSucceeded,
          preservedCachedProjects: false,
        },
        projects: freshProjects,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      // A superseded or logged-out sync is always aborted. Rethrow as an abort
      // so a stale, non-abort completion can never flip global offline state
      // (e.g. re-lock offline after logout cleared it). Mirrors the success and
      // non-2xx branches, which are already guarded by throwIfAborted above.
      context.throwIfAborted();

      console.warn('syncProjects: API fetch failed:', error);
      // Timeout / transport failure: the backend is unreachable, so flip the
      // app offline. Cache is preserved; no logout.
      this.enterOfflineMode();
      return {
        phase: {
          phase: 'project_refresh',
          status: 'failed',
          reason: 'project_refresh_rejected',
          projectCount: 0,
          httpStatus: null,
          cacheWriteSucceeded: false,
          preservedCachedProjects: this._projects.length > 0,
        },
        projects: null,
      };
    }
  }

  /**
   * Download geojson files for all eligible projects, skipping those whose
   * cached version already matches the latest commit.
   *
   * Uses a simple worker-pool to limit concurrency to 3 parallel downloads.
   */
  private async syncGeoJSONPhase(
    context: CancellationContext,
    projects: Project[],
  ): Promise<GeoJSONSyncPhaseResult> {
    if (!this.hasNetworkAccess()) {
      return this.createSkippedGeoJSONPhase('offline_locked');
    }

    const eligible = projects.filter(
      (p) => p.geojson_file && !p.exclude_geojson,
    );
    if (eligible.length === 0) {
      return this.createSkippedGeoJSONPhase('no_geojson_candidates');
    }

    let downloadedProjectCount = 0;
    let skippedProjectCount = 0;
    let failedProjectCount = 0;

    const queue = [...eligible];
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        context.throwIfAborted();
        if (!this.hasNetworkAccess()) return;

        const project = queue.shift();
        if (!project) return;

        try {
          const cachedCommit = await this.cache.getCachedCommitId(
            project.id,
            { signal: context.signal },
          );
          context.throwIfAborted();
          if (cachedCommit === project.latest_commit.id) {
            skippedProjectCount += 1;
            continue;
          }

          const response = await this.service.downloadJSON(
            project.geojson_file!,
            { signal: context.signal },
          );
          context.throwIfAborted();
          if (!isSuccessfulStatus(response.status)) {
            failedProjectCount += 1;
            console.warn(`Skipping geojson cache for project ${project.id}: status ${response.status}`);
            continue;
          }

          const normalized = normalizeGeoJSON(response.data);
          if (!normalized) {
            failedProjectCount += 1;
            console.warn(`Skipping geojson cache for project ${project.id}: malformed payload`);
            continue;
          }

          const didCacheGeoJSON = await this.cache.setGeoJSON(
            project.id,
            normalized,
            project.latest_commit.id,
            { signal: context.signal },
          );
          context.throwIfAborted();
          if (didCacheGeoJSON) {
            downloadedProjectCount += 1;
          } else {
            failedProjectCount += 1;
          }
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          failedProjectCount += 1;
          console.warn(`Failed to cache geojson for project ${project.id}:`, error);
        }
      }
    };

    const concurrency = Math.min(3, eligible.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return {
      phase: 'geojson_sync',
      status: failedProjectCount > 0 ? 'failed' : 'applied',
      reason: failedProjectCount > 0 ? 'geojson_sync_partial_failure' : 'geojson_synced',
      eligibleProjectCount: eligible.length,
      downloadedProjectCount,
      skippedProjectCount,
      failedProjectCount,
    };
  }

  /**
   * Sync shared map overlays so read-only icons remain available offline.
   */
  private async syncMapOverlaysPhase(
    context: CancellationContext,
    instance: string,
    token: string,
  ): Promise<OverlaySyncPhaseResult> {
    if (!this.hasNetworkAccess()) {
      return this.createSkippedOverlaySyncPhase('offline_locked');
    }

    let syncedOverlayCount = 0;
    let failedOverlayCount = 0;

    await Promise.all(MAP_OVERLAYS.map(async (overlay) => {
      context.throwIfAborted();
      if (!this.hasNetworkAccess()) return;
      if (overlay.id === 'landmarks' && await this.shouldSkipLandmarkOverlaySync()) {
        return;
      }

      try {
        const response = await this.fetchOverlayGeoJSON(
          overlay.id,
          instance,
          token,
          context,
        );
        context.throwIfAborted();

        if (!isSuccessfulStatus(response.status)) {
          failedOverlayCount += 1;
          console.warn(
            `Overlay sync skipped for ${overlay.id}: status ${response.status}`,
          );
          return;
        }

        const normalized = normalizeGeoJSON(response.data);
        if (!normalized) {
          failedOverlayCount += 1;
          console.warn(`Overlay sync skipped for ${overlay.id}: malformed 2xx payload`);
          return;
        }

        const didCacheOverlay = await this.cache.setOverlayGeoJSON(
          overlay.id,
          normalized,
          { signal: context.signal },
        );
        context.throwIfAborted();

        if (didCacheOverlay) {
          syncedOverlayCount += 1;
        } else {
          failedOverlayCount += 1;
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        failedOverlayCount += 1;
        console.warn(`Failed to sync overlay ${overlay.id}:`, error);
      }
    }));

    // Best-effort: cache the writable collection list so an offline create can
    // still pick a collection. Never fails the overlay phase.
    try {
      context.throwIfAborted();
      const collectionsResponse = await this.service.getLandmarkCollections(instance, token, {
        signal: context.signal,
      });
      context.throwIfAborted();
      if (isSuccessfulStatus(collectionsResponse.status)) {
        await this.cache.setLandmarkCollections(mapLandmarkCollections(collectionsResponse.data));
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('Failed to cache landmark collections during sync:', error);
    }

    return {
      phase: 'overlay_sync',
      status: failedOverlayCount > 0 ? 'failed' : 'applied',
      reason: failedOverlayCount > 0 ? 'overlay_sync_partial_failure' : 'overlays_synced',
      attemptedOverlayCount: MAP_OVERLAYS.length,
      syncedOverlayCount,
      failedOverlayCount,
    };
  }

  private async shouldSkipLandmarkOverlaySync(): Promise<boolean> {
    if (this.offlineQueue.isReplaying) return true;
    try {
      await this.offlineQueue.load();
    } catch (error) {
      console.warn('Skipping landmarks overlay sync because pending ops could not be loaded:', error);
      return true;
    }
    return this.offlineQueue.count > 0;
  }

  private fetchOverlayGeoJSON(
    overlayId: MapOverlayId,
    instance: string,
    token: string,
    context: CancellationContext,
  ): ReturnType<SpeleoDBService['getLandmarksGeoJSON']> {
    switch (overlayId) {
      case 'landmarks':
        return this.service.getLandmarksGeoJSON(instance, token, { signal: context.signal });
      case 'subsurfaceStations':
        return this.service.getSubsurfaceStationsGeoJSON(instance, token, { signal: context.signal });
      case 'surfaceStations':
        return this.service.getSurfaceStationsGeoJSON(instance, token, { signal: context.signal });
      case 'explorationLeads':
        return this.service.getExplorationLeadsGeoJSON(instance, token, { signal: context.signal });
      case 'cylinderInstalls':
        return this.service.getCylinderInstallsGeoJSON(instance, token, { signal: context.signal });
      default: {
        const exhaustiveCheck: never = overlayId;
        throw new Error(`Unsupported overlay id: ${exhaustiveCheck}`);
      }
    }
  }

  /**
   * Build and enqueue tile prefetch jobs so map imagery is available offline.
   * Projects use their survey bbox; landmarks use a combined per-point job.
   * Landmark prefetch is independent of project eligibility.
   */
  private async scheduleTilePrefetchPhase(
    context: CancellationContext,
    projects: Project[],
  ): Promise<TilePrefetchPhaseResult> {
    if (!this.hasNetworkAccess()) {
      return this.createSkippedTilePrefetchPhase('offline_locked');
    }

    const satellite = getMapLayerById(DEFAULT_MAP_LAYER_ID) ?? MAP_LAYERS[0];
    const landmarkPoints = await this.loadLandmarkPrefetchPoints(context);
    const built = await this.buildProjectPrefetchInputs(context, projects);

    // Satellite is always scheduled first so its tiles download with priority.
    // The satellite project result is the canonical tile-prefetch phase result
    // (project sync percentage tracks satellite only).
    const satelliteLandmarkCount = await this.enqueueLayerLandmarks(
      context,
      satellite,
      landmarkPoints,
    );
    const projectResult = await this.enqueueLayerProjects(context, satellite, built);

    // Extra opted-in layers are scheduled afterwards. Because the prefetch queue
    // is FIFO, satellite tiles are always downloaded before extra-layer tiles.
    // Extra-layer scheduling is best-effort and does not affect the phase
    // contract returned to the sync caller.
    for (const layer of this.getEnabledExtraLayers()) {
      context.throwIfAborted();
      await this.enqueueLayerLandmarks(context, layer, landmarkPoints);
      await this.enqueueLayerProjects(context, layer, built);
    }

    return {
      ...projectResult,
      landmarkTileCount: satelliteLandmarkCount,
      landmarkScheduled: satelliteLandmarkCount > 0,
    };
  }

  /**
   * Build a per-layer prefetch request from a base request (project or
   * landmark): keeps the base zoom range + pad but swaps in the layer's tile
   * URL template and clamps the max zoom to the layer's native max zoom.
   */
  private buildLayerPrefetchRequest(
    layer: MapLayerDefinition,
    base: TilePrefetchRequest,
  ): TilePrefetchRequest {
    return {
      tileUrlTemplate: layer.tileUrlTemplate,
      minZoom: base.minZoom,
      maxZoom: Math.min(base.maxZoom, layer.maxZoom),
      padMeters: base.padMeters,
    };
  }

  /** Load landmark prefetch points from cached overlay GeoJSON ([] when none). */
  private async loadLandmarkPrefetchPoints(
    context: CancellationContext,
  ): Promise<Array<[number, number]>> {
    try {
      context.throwIfAborted();
      const raw = await this.cache.getOverlayGeoJSON('landmarks');
      context.throwIfAborted();
      const normalized = normalizeGeoJSON(raw);
      if (!normalized) return [];
      return extractPointCoordinates(normalized);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn('Loading landmark prefetch points failed:', error);
      return [];
    }
  }

  /**
   * Enqueue the combined "landmarks" job for a layer from precomputed points.
   * Best-effort: failures are logged and do not fail the surrounding sync.
   * Returns the number of (deduped) tiles scheduled (0 when there are none).
   */
  private async enqueueLayerLandmarks(
    context: CancellationContext,
    layer: MapLayerDefinition,
    points: Array<[number, number]>,
  ): Promise<number> {
    if (points.length === 0) return 0;
    try {
      const request = this.buildLayerPrefetchRequest(layer, TILE_PREFETCH.LANDMARK_REQUEST);
      const tileUrls = buildTileUrlsForPoints(points, request);
      if (tileUrls.length === 0) return 0;

      await this.tilePrefetch.enqueueTileUrls(
        {
          id: TILE_PREFETCH.LANDMARK_TARGET_ID,
          commitId: computeTilePrefetchSignature(points),
          tileUrls,
          zoomMin: request.minZoom,
          zoomMax: request.maxZoom,
          padMeters: request.padMeters,
        },
        { signal: context.signal, layerId: layer.id },
      );
      context.throwIfAborted();

      return tileUrls.length;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn(`Landmark map prefetch scheduling failed for layer ${layer.id}:`, error);
      return 0;
    }
  }

  /** Read + normalize each eligible project's GeoJSON once (reused per layer). */
  private async buildProjectPrefetchInputs(
    context: CancellationContext,
    projects: Project[],
  ): Promise<BuiltProjectInputs> {
    const eligible = projects.filter((p) => p.geojson_file && !p.exclude_geojson);
    const inputs: TilePrefetchProjectInput[] = [];
    let failedCount = 0;

    for (const project of eligible) {
      try {
        context.throwIfAborted();
        const raw = await this.cache.getGeoJSON(project.id, { signal: context.signal });
        context.throwIfAborted();
        const normalized = normalizeGeoJSON(raw);
        if (!normalized || normalized.features.length === 0) continue;
        inputs.push({
          projectId: project.id,
          commitId: project.latest_commit.id,
          geojson: normalized,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        failedCount += 1;
        console.warn(`Failed preparing map prefetch for project ${project.id}:`, error);
      }
    }

    return { inputs, eligibleCount: eligible.length, failedCount };
  }

  /** Enqueue project prefetch jobs for a layer and build its phase result. */
  private async enqueueLayerProjects(
    context: CancellationContext,
    layer: MapLayerDefinition,
    built: BuiltProjectInputs,
  ): Promise<TilePrefetchPhaseResult> {
    const { inputs, eligibleCount, failedCount } = built;
    if (eligibleCount === 0) {
      return this.createSkippedTilePrefetchPhase('no_prefetch_candidates');
    }

    if (inputs.length === 0) {
      return {
        phase: 'tile_prefetch',
        status: failedCount > 0 ? 'failed' : 'skipped',
        reason: failedCount > 0 ? 'tile_prefetch_failed' : 'no_prefetch_candidates',
        eligibleProjectCount: eligibleCount,
        scheduledProjectCount: 0,
        failedProjectCount: failedCount,
      };
    }

    try {
      const request = this.buildLayerPrefetchRequest(layer, TILE_PREFETCH.PROJECT_REQUEST);
      await this.tilePrefetch.enqueueProjects(inputs, request, {
        signal: context.signal,
        layerId: layer.id,
      });
      context.throwIfAborted();

      return {
        phase: 'tile_prefetch',
        status: failedCount > 0 ? 'failed' : 'applied',
        reason: failedCount > 0 ? 'tile_prefetch_failed' : 'tile_prefetch_scheduled',
        eligibleProjectCount: eligibleCount,
        scheduledProjectCount: inputs.length,
        failedProjectCount: failedCount,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      console.warn(`Map prefetch scheduling failed for layer ${layer.id}:`, error);
      return {
        phase: 'tile_prefetch',
        status: 'failed',
        reason: 'tile_prefetch_failed',
        eligibleProjectCount: eligibleCount,
        scheduledProjectCount: inputs.length,
        failedProjectCount: failedCount + inputs.length,
      };
    }
  }

  // ---- Validation helpers ---------------------------------------------------

  validateEmail(email: string): boolean {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  }

  // ---- Private helpers ------------------------------------------------------

  /** Restore auth state from preferences at construction time. */
  private restoreSession(): void {
    try {
      const prefs = this.prefs.getPreferences();
      if (prefs.token && !prefs.instance) {
        this.prefs.clearPreferences();
        return;
      }
      if (prefs.token && prefs.instance) {
        const email = prefs.email?.trim() ?? '';
        this._authState = {
          isAuthenticated: true,
          user: email ? { id: 'restored', email, name: email } : null,
          token: prefs.token,
        };
        if (
          typeof prefs.lastSyncedAt === 'number' &&
          Number.isFinite(prefs.lastSyncedAt) &&
          prefs.lastSyncedAt > 0
        ) {
          this._lastSyncedAt = prefs.lastSyncedAt;
        }
        // Update snapshots (no notify -- no listeners registered yet at construct time).
        this._authStateSnapshot = { ...this._authState };
        this._lastSyncedAtSnapshot = this._lastSyncedAt;
      }
    } catch (error) {
      console.error('Failed to load auth state:', error);
    }
  }

  /** Record a successful project-list refresh and persist its timestamp. */
  private recordSuccessfulSync(): void {
    this._lastSyncedAt = Date.now();
    try {
      this.prefs.setPreferences({ lastSyncedAt: this._lastSyncedAt });
    } catch (error) {
      console.warn('Failed to persist lastSyncedAt:', error);
    }
  }

  /** Publish and persist a validated online session from either login method. */
  private establishAuthenticatedSession(
    token: string,
    instance: string,
    email?: string,
  ): User | null {
    const normalizedToken = token.trim();
    const normalizedInstance = instance.trim();
    const normalizedEmail = email?.trim() ?? '';
    const user: User | null = normalizedEmail
      ? { id: 'auth', email: normalizedEmail, name: normalizedEmail }
      : null;

    this.invalidateAsyncOperations();
    this._authState = { isAuthenticated: true, user, token: normalizedToken };
    this._isOnline = true;
    this.setOfflineLocked(false);
    this.prefs.setPreferences({
      email: normalizedEmail,
      token: normalizedToken,
      instance: normalizedInstance,
    });
    this.notify();
    return user;
  }

  /** Attempt login against the local users DB (offline). */
  private offlineLogin(email: string, password: string, instance: string): AuthResponse {
    const localUsers = this.getLocalUsers();
    const localUser = localUsers[email.toLowerCase()];

    if (localUser && localUser.password === password) {
      const token = this.generateOfflineToken();
      this.invalidateAsyncOperations();
      this._authState = { isAuthenticated: true, user: localUser.user, token };
      this.prefs.setPreferences({
        email: localUser.user.email,
        token,
        instance: instance.trim() || this.prefs.getPreferences().instance,
      });
      this.notify();
      return { success: true, message: 'Login successful (offline)', user: localUser.user, token };
    }

    return { success: false, message: 'Invalid email or password' };
  }

  // ---- Local users DB -------------------------------------------------------

  private getLocalUsers(): Record<string, { password: string; user: User }> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.USERS_DB);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  // ---- ID generators --------------------------------------------------------

  private generateOfflineToken(): string {
    return 'offline_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private hasNetworkAccess(): boolean {
    return !this._isOfflineLocked;
  }
}
