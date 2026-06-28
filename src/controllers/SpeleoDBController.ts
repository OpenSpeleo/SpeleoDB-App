/**
 * SpeleoDBController -- the "center of the app".
 *
 * Public application façade for React state and mobile business operations.
 * Session/startup state is delegated to SessionCoordinator; network I/O and
 * persistence remain behind injected services.
 *
 * Exposes an observer pattern (subscribe / notify) so the React provider can
 * re-render via useSyncExternalStore.
 */

import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { SessionStore } from '../services/SecureSessionStore';
import { GpsTrackStore } from '../services/GpsTrackStore';
import { MultipartPayloadError } from '../services/HttpClient';
import {
  CapacitorRecordingNotificationPermissionGuard,
  type RecordingNotificationPermissionGuard,
} from '../services/RecordingNotificationPermissionGuard';
import type { LocationWatcher } from '../services/GeolocationWatcher';
import { createRecordingLocationWatcher } from '../services/BackgroundGeolocationWatcher';
import {
  setTileCacheOfflineModeRuntime,
} from '../services/TileCacheRuntime';
import {
  ProjectGeoJSONAnalyzer,
  type ProjectGeoJSONAnalyzerPort,
} from '../services/ProjectGeoJSONAnalyzer';
import type { TilePrefetchServiceLike } from '../services/TilePrefetchService';
import type {
  AuthResponse,
  AuthState,
  LoginCredentials,
  OAuthTokenCredentials,
  User,
} from '../types';
import type { Project } from '../types/project';
import type {
  ProjectGeoJSONAcknowledgementResult,
  ProjectGeoJSONMapData,
  ProjectGeoJSONWarning,
} from '../types/projectGeoJSON';
import type { MapOverlayId } from '../types/mapOverlay';
import type {
  TilePrefetchJobState,
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
import { summarizeTrack } from '../utils/gpsTrackStats';
import { normalizeHexColor } from '../utils/gpsTrackColors';
import { snapshotFromRemote } from '../offline/gpsTrackSnapshot';
import { parseRemoteGpsTrack, parseRemoteGpsTracks } from '../utils/remoteGpsTrack';
import { gpsTrackGeoJsonToPoints } from '../utils/gpsTrackGeoJson';
import { CancellationContext } from './CancellationContext';
import { SessionCoordinator } from './SessionCoordinator';
import { ProjectGeoJSONCoordinator } from './ProjectGeoJSONCoordinator';
import { ProjectOverlaySyncCoordinator } from './ProjectOverlaySyncCoordinator';
import {
  ProjectSyncCoordinator,
  type SyncStatus,
} from './ProjectSyncCoordinator';
import { OfflineMutationCoordinator } from './OfflineMutationCoordinator';
import { TileCoordinator } from './TileCoordinator';
import { GpsRecordingCoordinator } from './GpsRecordingCoordinator';
import { isAbortError } from '../utils/abort';
import type {
  SyncProjectsResult,
} from '../types/sync';

// ==================== Sync status ====================

export type { SyncStatus } from './ProjectSyncCoordinator';

// ==================== Preferences interface (for DI) ====================

/** The slice of PreferencesService the controller needs. */
export interface PreferencesPort {
  getPreferences(): {
    email?: string;
    instance?: string;
    hasStoredSession?: boolean;
    lastSyncedAt?: number;
    tileCacheOverLimitApproved?: boolean;
    tileCacheOverLimitPromptAcknowledged?: boolean;
    selectedMapLayerId?: string;
    layerOfflineSync?: Record<string, boolean>;
  };
  setPreferences(
    prefs: Partial<{
      email?: string;
      instance?: string;
      hasStoredSession?: boolean;
      lastSyncedAt?: number;
      tileCacheOverLimitApproved?: boolean;
      tileCacheOverLimitPromptAcknowledged?: boolean;
      selectedMapLayerId?: string;
      layerOfflineSync?: Record<string, boolean>;
    }>,
  ): void;
  clearPreferences(): void;
  session: SessionStore;
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isRetryableGpsUploadStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// ==================== Controller ====================

export class SpeleoDBController {
  // ---- Observable state -----------------------------------------------------
  private readonly sessionCoordinator: SessionCoordinator;
  private readonly projectGeoJSONCoordinator: ProjectGeoJSONCoordinator;
  private readonly projectOverlaySyncCoordinator: ProjectOverlaySyncCoordinator;
  private readonly projectSyncCoordinator: ProjectSyncCoordinator;
  private readonly tileCoordinator: TileCoordinator;
  // Monotonic counter bumped after any landmark create/edit/delete writes the
  // cached overlay:landmarks FeatureCollection, so the Dashboard re-reads it.
  private _landmarksRevision = 0;
  // Offline mutation queue (landmark create/edit/delete made while offline or
  // after a "not reachable" failure). Owns persistence + optimistic fold +
  // replay/conflict resolution. See docs/offline-op-queue.md.
  private readonly offlineMutations: OfflineMutationCoordinator;
  // ---- GPS tracks + recording -----------------------------------------------
  // Recorded tracks (persisted in IndexedDB), the live recording state machine,
  // and the in-progress point buffer. Uploads to SpeleoDB follow the same
  // offline-first model as landmarks (record offline, upload on reconnect).
  // See docs/gps-tracks.md.
  private _gpsTracks: LocalGpsTrack[] = [];
  // Server-stored tracks (metadata) synced like projects/landmarks. The unified
  // list folds pending offline ops over these and merges in local recordings.
  private _remoteGpsTracks: RemoteGpsTrack[] = [];
  private readonly gpsRecordingCoordinator: GpsRecordingCoordinator;
  private _gpsTracksRevision = 0;
  private _gpsPersistGeneration = 0;
  private _gpsPersistQueue: Promise<void> | null = null;
  private _listeners = new Set<() => void>();
  private _isPurgingLocalData = false;
  private _asyncGeneration = 0;
  private _trackedOperations = new Set<Promise<unknown>>();

  // Snapshot references for useSyncExternalStore (identity-stable between notifies)
  private _landmarksRevisionSnapshot: number = this._landmarksRevision;
  private _gpsTracksSnapshot: GpsTrackListItem[] = [];
  /**
   * The `_gpsTracksRevision` the current `_gpsTracksSnapshot` was built from.
   * Lets `notify()` rebuild the unified list only when GPS data actually
   * changed, so `gpsTracks` keeps a stable reference across unrelated notifies.
   */
  private _builtGpsTracksRevision = -1;
  private _gpsTracksRevisionSnapshot: number = this._gpsTracksRevision;

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
    private projectGeoJSONAnalyzer: ProjectGeoJSONAnalyzerPort = new ProjectGeoJSONAnalyzer(),
  ) {
    this.sessionCoordinator = new SessionCoordinator({
      transport: this.service,
      sessionStore: this.prefs.session,
      hooks: {
        notifyStateChanged: () => this.notify(),
        invalidateApplicationOperations: () => this.invalidateAsyncOperations(),
        purgeLocalUserData: () => this.purgeAllLocalUserData(),
        startReconnectSync: () => { void this.syncProjects(); },
        setOfflineRuntime: (locked) => setTileCacheOfflineModeRuntime(locked),
      },
    });
    this.projectGeoJSONCoordinator = new ProjectGeoJSONCoordinator({
      cache: this.cache,
      transport: this.service,
      analyzer: this.projectGeoJSONAnalyzer,
      hasNetworkAccess: () => this.hasNetworkAccess(),
      removePrefetchTarget: (projectId, signal) => this.tileCoordinator.removeTarget(
        projectId,
        signal,
      ),
      notifyStateChanged: () => this.notify(),
    });
    this.offlineMutations = new OfflineMutationCoordinator({
      store: this.offlineOpStore,
      replay: this.buildOfflineReplayPort(),
      onStateChanged: () => this.handleOfflineQueueChange(),
    });
    this.gpsRecordingCoordinator = new GpsRecordingCoordinator({
      watcher: this.geolocationWatcher,
      notificationPermission: this.recordingNotificationPermission,
      now: () => Date.now(),
      generateId: () => generateUuid(),
      defaultName: (timestamp) => this.defaultTrackName(timestamp),
      persist: (track) => this.enqueueGpsTrackPersist(track),
      removePersisted: (id) => this.gpsTrackStore.remove(id),
      waitForPersistence: () => this.waitForTrackedOperations(),
      invalidatePersistence: () => { this._gpsPersistGeneration += 1; },
      addCompletedTrack: (track) => { this._gpsTracks = [track, ...this._gpsTracks]; },
      notifyStateChanged: () => this.bumpGpsTracksRevision(),
    });
    this.projectOverlaySyncCoordinator = new ProjectOverlaySyncCoordinator({
      cache: this.cache,
      transport: this.service,
      pendingMutations: () => this.offlineMutations,
      hasNetworkAccess: () => this.hasNetworkAccess(),
    });
    this.tileCoordinator = new TileCoordinator({
      cache: this.cache,
      projectGeoJSON: this.projectGeoJSONCoordinator,
      preferences: {
        get: () => this.prefs.getPreferences(),
        set: (value) => this.prefs.setPreferences(value),
      },
      hasNetworkAccess: () => this.hasNetworkAccess(),
      getProjects: () => this.projectSyncCoordinator.projects,
      notifyStateChanged: () => this.notify(),
    }, tilePrefetch);
    this.projectSyncCoordinator = new ProjectSyncCoordinator({
      cache: this.cache,
      transport: this.service,
      sessions: this.prefs.session,
      metadata: {
        getLastSyncedAt: () => (
          this.sessionCoordinator.isAuthenticated
            ? this.prefs.getPreferences().lastSyncedAt
            : undefined
        ),
        setLastSyncedAt: (value) => this.prefs.setPreferences({ lastSyncedAt: value }),
      },
      geoJSON: this.projectGeoJSONCoordinator,
      overlays: this.projectOverlaySyncCoordinator,
      hooks: {
        hasNetworkAccess: () => this.hasNetworkAccess(),
        markOnline: () => this.sessionCoordinator.markOnline(false),
        enterOfflineMode: () => this.enterOfflineMode(),
        notifyStateChanged: () => this.notify(),
        bumpLandmarksRevision: () => this.bumpLandmarksRevision(),
        syncGpsTracks: (context, instance, token) => this.syncGpsTracksPhase(
          context,
          instance,
          token,
        ),
        scheduleTilePrefetch: (context, projects) => this.tileCoordinator.scheduleSyncPhase(
          context,
          projects,
        ),
      },
      now: () => Date.now(),
    });
    // Load persisted GPS tracks so the panel shows them on startup. Only notify
    // when something was restored, so a clean start does not perturb revisions.
    const gpsLoadGeneration = this.captureAsyncGeneration();
    void this.gpsTrackStore
      .list()
      .then((tracks) => {
        if (
          tracks.length > 0 &&
          this.isAsyncGenerationCurrent(gpsLoadGeneration) &&
          this.sessionCoordinator.isAuthenticated &&
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
          this.sessionCoordinator.isAuthenticated &&
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
    void this.offlineMutations
      .load()
      .catch((error) => console.warn('Failed to load offline op queue:', error));
  }

  /**
   * Build the offline queue with a replay port bound to this controller's
   * service + cache. Credentials are resolved at call time so a token refresh
   * is always reflected. Ground-truth writes reuse the existing single
   * cache-write seam (`applyLandmarkUpsert` / `applyLandmarkRemoval`).
   */
  private buildOfflineReplayPort(): OfflineReplayPort {
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
    return port;
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
    this._gpsTracksRevision += 1;
    this.notify();
  }

  // ---- State accessors (snapshot-based for useSyncExternalStore) -------------

  get authState(): AuthState {
    return this.sessionCoordinator.authState;
  }

  get isOnline(): boolean {
    return this.sessionCoordinator.isOnline;
  }

  get isOfflineLocked(): boolean {
    return this.sessionCoordinator.isOfflineLocked;
  }

  get currentUser(): User | null {
    return this.sessionCoordinator.currentUser;
  }

  get projects(): Project[] {
    return this.projectSyncCoordinator.projects;
  }

  get syncStatus(): SyncStatus {
    return this.projectSyncCoordinator.syncStatus;
  }

  get lastSyncedAt(): number | null {
    return this.projectSyncCoordinator.lastSyncedAt;
  }

  get projectGeoJSONWarnings(): ProjectGeoJSONWarning[] {
    return this.projectGeoJSONCoordinator.warnings;
  }

  get mapDataRevision(): number {
    return this.projectSyncCoordinator.mapDataRevision;
  }

  get tilePrefetchJobs(): TilePrefetchJobState[] {
    return this.tileCoordinator.prefetchJobs;
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
    return this.offlineMutations.count;
  }

  /** Bumped on any offline-queue change so the Pending page re-reads the list. */
  get pendingOpsRevision(): number {
    return this.offlineMutations.revision;
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
    return this.gpsRecordingCoordinator.recordingState;
  }

  /**
   * Epoch ms when the current recording started (null when idle). Lets the UI
   * tick a live duration from the moment Start is pressed -- before the first
   * GPS fix arrives -- so recording feels immediate.
   */
  get gpsRecordingStartedAt(): number | null {
    return this.gpsRecordingCoordinator.recordingStartedAt;
  }

  /** Active recording duration, excluding paused wall time, at the last snapshot. */
  get gpsRecordingElapsedMs(): number {
    return this.gpsRecordingCoordinator.recordingElapsedMs;
  }

  /**
   * Epoch ms when `gpsRecordingElapsedMs` was measured. Non-null only while
   * actively recording so the UI can tick locally without counting paused time.
   */
  get gpsRecordingElapsedUpdatedAt(): number | null {
    return this.gpsRecordingCoordinator.recordingElapsedUpdatedAt;
  }

  /** Live point buffer of the in-progress recording (empty when idle). */
  get currentTrackPoints(): RecordedPoint[] {
    return this.gpsRecordingCoordinator.currentPoints;
  }

  /**
   * Set when an active recording was forcibly stopped by a fatal location error
   * (permission denied/revoked). The UI surfaces it once then calls
   * `clearGpsRecordingError()`. Null otherwise.
   */
  get gpsRecordingError(): string | null {
    return this.gpsRecordingCoordinator.recordingError;
  }

  /** Bumped on any GPS track/recording change so the panel re-reads state. */
  get gpsTracksRevision(): number {
    return this._gpsTracksRevisionSnapshot;
  }

  /** True when the user has approved letting tile prefetch exceed the cap. */
  get isTileCacheOverLimitApproved(): boolean {
    return this.tileCoordinator.isOverflowApproved;
  }

  /**
   * True when prefetch is stalled at the cache cap and overflow is not yet
   * approved. Drives the Settings warning. False once approved.
   */
  get isTileCacheOverLimit(): boolean {
    return this.tileCoordinator.isOverLimit;
  }

  /**
   * True when the one-time auto consent popup should appear: over the limit and
   * the user has not yet been asked. Suppressed forever once acknowledged.
   */
  get needsAutoStoragePrompt(): boolean {
    return this.tileCoordinator.needsAutoPrompt;
  }

  /** Transient flag set by the Settings warning to manually re-open the prompt. */
  get storageConsentRequested(): boolean {
    return this.tileCoordinator.isConsentRequested;
  }

  /**
   * Whether the storage-consent modal should be open: either the one-time auto
   * prompt, or a manual re-trigger from Settings.
   */
  get storageConsentRequired(): boolean {
    return this.tileCoordinator.isConsentRequired;
  }

  isAuthenticated(): boolean {
    return this.sessionCoordinator.isAuthenticated;
  }

  // ---- Observer pattern -----------------------------------------------------

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  private notify(): void {
    // Produce new snapshot references so useSyncExternalStore detects changes.
    this._landmarksRevisionSnapshot = this._landmarksRevision;
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
    this._gpsTracksRevisionSnapshot = this._gpsTracksRevision;
    this._listeners.forEach((fn) => fn());
  }

  private invalidateAsyncOperations(): void {
    this._asyncGeneration += 1;
    this.sessionCoordinator.invalidate();
    this.projectSyncCoordinator.cancel();
    this.tileCoordinator.cancel();
  }

  private captureAsyncGeneration(): number {
    return this._asyncGeneration;
  }

  private isAsyncGenerationCurrent(generation: number): boolean {
    return generation === this._asyncGeneration;
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
    this.sessionCoordinator.enterOfflineMode();
  }

  async preloadTilePrefetch(): Promise<void> {
    await this.tileCoordinator.preload();
  }

  requestStorageConsentPrompt(): void {
    this.tileCoordinator.requestConsent();
  }

  clearStorageConsentRequest(): void {
    this.tileCoordinator.dismissConsentRequest();
  }

  approveTileCacheOverLimit(): void {
    this.tileCoordinator.approveOverflow();
  }

  acknowledgeStoragePrompt(): void {
    this.tileCoordinator.dismissAutoPrompt();
  }

  revokeTileCacheOverLimit(): void {
    this.tileCoordinator.revokeOverflow();
  }

  async setLayerOfflineSync(layerId: string, enabled: boolean): Promise<void> {
    await this.tileCoordinator.setLayerOfflineSync(layerId, enabled);
  }

  // ---- Actions --------------------------------------------------------------

  /** Login validates credentials against the server and never stores passwords locally. */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    return this.sessionCoordinator.login(credentials);
  }

  /**
   * Login with a user-supplied OAuth token. The token must be validated by the
   * selected instance before it is persisted; there is intentionally no
   * offline fallback for this flow.
   */
  async loginWithToken(credentials: OAuthTokenCredentials): Promise<AuthResponse> {
    return this.sessionCoordinator.loginWithToken(credentials);
  }

  /**
   * Validates the stored token with the server.
   * - 2xx   -> 'ok'
   * - 4xx   -> 'unauthorized' (and local logout/cache purge)
   * - other -> 'network_error' (keeps current session, enters offline mode)
   */
  async validateSession(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    return this.sessionCoordinator.validateSession();
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
    return this.sessionCoordinator.attemptReconnect();
  }

  /**
   * Logout and wipe all local user data immediately.
   * Confirmation (if any) is handled by the UI layer before calling this.
   */
  async logout(): Promise<void> {
    await this.sessionCoordinator.logout();
  }

  private async purgeAllLocalUserData(): Promise<void> {
    if (this._isPurgingLocalData) return;
    this._isPurgingLocalData = true;
    this.invalidateAsyncOperations();
    let sessionClearError: unknown;
    try {
      try {
        await this.tileCoordinator.stopForLogout();
      } catch {
        // Continue cleanup even if best-effort tile worker teardown fails.
      }

      await this.gpsRecordingCoordinator.stopForLogout();

      // Reset in-memory state first so UI reflects the wipe immediately.
      this.sessionCoordinator.reset();
      this.projectSyncCoordinator.reset();
      this._gpsTracks = [];
      this._remoteGpsTracks = [];
      // Bump so notify()'s revision-gated rebuild clears the unified GPS list
      // (logout calls notify() directly rather than via bumpGpsTracksRevision).
      this._gpsTracksRevision += 1;
      try {
        await this.prefs.session.clear();
      } catch (error) {
        sessionClearError = error;
      }

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
        ...this.tileCoordinator.persistentCleanupTasks(),
      ]);
      for (const result of cleanupResults) {
        if (result.status === 'rejected') {
          console.error('Failed to wipe local cache data:', result.reason);
        }
      }

      this.tileCoordinator.restartAfterLogout();
      // Rebuild the offline queue so its in-memory ops are dropped along with
      // the persisted store (cleared by cache.clearAll above).
      this.offlineMutations.reset();
      this.notify();
      if (sessionClearError) {
        throw new Error('Secure credential deletion failed during logout.');
      }
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
    return this.trackOperation(this.projectSyncCoordinator.sync());
  }

  /**
   * Read a single project's validated map payload. Legacy, stale, quarantined,
   * and session-blocked entries are fail-closed.
   */
  async getProjectMapData(projectId: string): Promise<ProjectGeoJSONMapData | null> {
    return this.projectGeoJSONCoordinator.getMapData(
      this.projectSyncCoordinator.projects,
      projectId,
    );
  }

  /** Backward-compatible data-only accessor; still enforces validation. */
  async getProjectGeoJSON(projectId: string): Promise<unknown | null> {
    return (await this.getProjectMapData(projectId))?.featureCollection ?? null;
  }

  /** Persist acknowledgement for the exact warning versions currently shown. */
  async acknowledgeProjectGeoJSONWarnings(): Promise<ProjectGeoJSONAcknowledgementResult> {
    return this.projectGeoJSONCoordinator.acknowledgeWarnings();
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
    await this.offlineMutations.load();
    if (this.offlineMutations.count === 0) return raw;
    const base = normalizeGeoJSON(raw) ?? { type: 'FeatureCollection', features: [] };
    return this.offlineMutations.foldLandmarks(base);
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
    await this.gpsRecordingCoordinator.start();
  }

  async pauseTrackRecording(): Promise<void> {
    await this.gpsRecordingCoordinator.pause();
  }

  async resumeTrackRecording(): Promise<void> {
    await this.gpsRecordingCoordinator.resume();
  }

  async stopTrackRecording(name?: string): Promise<LocalGpsTrack | null> {
    return this.gpsRecordingCoordinator.stop(name);
  }

  async discardTrackRecording(): Promise<void> {
    await this.gpsRecordingCoordinator.discard();
  }

  clearGpsRecordingError(): void {
    this.gpsRecordingCoordinator.clearError();
  }

  /**
   * Build the unified GPS-track list the panel + map consume: server tracks
   * (ground truth with pending update/delete ops folded over them) plus local
   * recordings, each annotated with derived pending state from the queue.
   */
  private buildUnifiedGpsTracks(): GpsTrackListItem[] {
    const pending = this.offlineMutations
      ? this.offlineMutations.gpsPendingBySubject()
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

    const remote = this.offlineMutations
      ? this.offlineMutations.foldGpsTracks(this._remoteGpsTracks)
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
      console.warn('Failed to download GPS track GeoJSON:', error);
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
      if (this.offlineMutations.hasGpsCreateFor(id)) {
        await this.offlineMutations.enqueueGpsCreate({ id, name, color });
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
      await this.offlineMutations.discardGpsTrackOpsForSubject(id);
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
      await this.offlineMutations.enqueueGpsCreate({ id: track.id, name: track.name, color: track.color });
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
      await this.offlineMutations.enqueueGpsUpdate(id, baseline, next);
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
  }

  private async enqueueGpsDelete(id: string, baseline: GpsTrackSnapshot | null): Promise<void> {
    try {
      await this.offlineMutations.enqueueGpsDelete(id, baseline);
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

  private async persistGpsTrack(track: LocalGpsTrack): Promise<void> {
    const generation = this._gpsPersistGeneration;
    if (this._isPurgingLocalData || !this.sessionCoordinator.isAuthenticated) return;
    try {
      await this.gpsTrackStore.put(track);
      if (
        generation !== this._gpsPersistGeneration ||
        this._isPurgingLocalData ||
        !this.sessionCoordinator.isAuthenticated
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
      await this.offlineMutations.enqueueLandmarkCreate(landmark);
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
      await this.offlineMutations.enqueueLandmarkUpdate(id, baseline, next);
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
      await this.offlineMutations.enqueueLandmarkDelete(id, baseline);
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
    return this.offlineMutations.views();
  }

  /** Replay every pending op against the server. */
  async syncOfflineOps(): Promise<OfflineSyncSummary> {
    return this.offlineMutations.syncAll();
  }

  /** Replay a single pending op. */
  async syncOfflineOp(id: string): Promise<OfflineSyncSummary> {
    return this.offlineMutations.syncOne(id);
  }

  /** Discard a pending op; the map reverts to the prior version via re-fold. */
  async discardOfflineOp(id: string): Promise<void> {
    await this.offlineMutations.discard(id);
  }

  /** Resolve a conflicted op by keeping the local change or the server version. */
  async resolveOfflineOpConflict(
    id: string,
    choice: OfflineConflictChoice,
  ): Promise<OfflineSyncSummary> {
    return this.offlineMutations.resolveConflict(id, choice);
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
  // ---- Validation helpers ---------------------------------------------------

  private getSyncCredentials(): { token: string; instance: string } | null {
    const session = this.prefs.session.getSession();
    return session ? { token: session.token, instance: session.instance } : null;
  }

  validateEmail(email: string): boolean {
    return this.sessionCoordinator.validateEmail(email);
  }

  // ---- Private helpers ------------------------------------------------------

  private hasNetworkAccess(): boolean {
    return this.sessionCoordinator.hasNetworkAccess;
  }
}
