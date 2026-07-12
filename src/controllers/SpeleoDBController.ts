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
import type { OfflineMapSyncEngineLike } from '../services/OfflineMapSyncEngine';
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
import type { OfflineMapSyncSnapshot } from '../types/offlineMapSync';
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
  LocalGpsTrack,
  RecordedPoint,
} from '../types/gpsTrack';
import { GpsTrackGpxService, type GpsTrackGpxFile } from '../services/GpsTrackGpxService';
import { generateUuid } from '../utils/ids';
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
import { GpsTrackCoordinator } from './GpsTrackCoordinator';
import { GpsTrackMutationCoordinator } from './GpsTrackMutationCoordinator';
import { createAbortError, isAbortError, throwIfAborted } from '../utils/abort';
import { CancellationContext } from './CancellationContext';
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
  private readonly gpsTrackCoordinator: GpsTrackCoordinator;
  private readonly gpsTrackMutationCoordinator: GpsTrackMutationCoordinator;
  private readonly gpsRecordingCoordinator: GpsRecordingCoordinator;
  private _listeners = new Set<() => void>();
  private _isPurgingLocalData = false;
  private _asyncGeneration = 0;
  private _trackedOperations = new Set<Promise<unknown>>();
  private _userOperationContext: CancellationContext | null = null;
  private _nextUserOperationRunId = 1;

  // Snapshot references for useSyncExternalStore (identity-stable between notifies)
  private _landmarksRevisionSnapshot: number = this._landmarksRevision;

  constructor(
    private service: SpeleoDBService,
    private prefs: PreferencesPort,
    private cache: ProjectCacheService,
    offlineMapSync?: OfflineMapSyncEngineLike,
    private offlineOpStore: OfflineOpStore = new OfflineOpStore(),
    gpsTrackStore: GpsTrackStore = new GpsTrackStore(),
    private geolocationWatcher: LocationWatcher = createRecordingLocationWatcher(),
    private recordingNotificationPermission: RecordingNotificationPermissionGuard =
      new CapacitorRecordingNotificationPermissionGuard(),
    gpsTrackGpxService: GpsTrackGpxService = new GpsTrackGpxService(),
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
    this.gpsTrackCoordinator = new GpsTrackCoordinator({
      store: gpsTrackStore,
      cache: this.cache,
      transport: this.service,
      gpx: gpsTrackGpxService,
      mutations: this.offlineMutations,
      hasNetworkAccess: () => this.hasNetworkAccess(),
      isSessionActive: () => this.sessionCoordinator.isAuthenticated,
      isPurging: () => this._isPurgingLocalData,
      now: () => Date.now(),
      notifyStateChanged: () => this.notify(),
    });
    this.gpsTrackMutationCoordinator = new GpsTrackMutationCoordinator({
      tracks: this.gpsTrackCoordinator,
      transport: this.service,
      mutations: this.offlineMutations,
      hasNetworkAccess: () => this.hasNetworkAccess(),
      getCredentials: () => this.getSyncCredentials(),
      enterOfflineMode: () => this.enterOfflineMode(),
    });
    this.gpsRecordingCoordinator = new GpsRecordingCoordinator({
      watcher: this.geolocationWatcher,
      notificationPermission: this.recordingNotificationPermission,
      now: () => Date.now(),
      generateId: () => generateUuid(),
      defaultName: (timestamp) => this.defaultTrackName(timestamp),
      persist: (track) => this.gpsTrackCoordinator.enqueuePersist(track),
      removePersisted: (id) => this.gpsTrackCoordinator.removePersisted(id),
      waitForPersistence: () => this.gpsTrackCoordinator.waitForPersistence(),
      invalidatePersistence: () => this.gpsTrackCoordinator.invalidatePersistence(),
      addCompletedTrack: (track) => {
        this.gpsTrackCoordinator.addCompletedTrack(track);
        void this.tileCoordinator.scheduleLocalGpsTrack(track);
      },
      notifyStateChanged: () => this.gpsTrackCoordinator.recordingStateChanged(),
    });
    this.projectOverlaySyncCoordinator = new ProjectOverlaySyncCoordinator({
      cache: this.cache,
      transport: this.service,
      pendingMutations: () => this.offlineMutations,
      hasNetworkAccess: () => this.hasNetworkAccess(),
    });
    this.tileCoordinator = new TileCoordinator({
      cache: this.cache,
      preferences: {
        get: () => this.prefs.getPreferences(),
        set: (value) => this.prefs.setPreferences(value),
      },
      hasNetworkAccess: () => this.hasNetworkAccess(),
      getProjects: () => this.projectSyncCoordinator.projects,
      getGpsPrefetchSources: (signal) => this.gpsTrackCoordinator.getPrefetchSources(signal),
      notifyStateChanged: () => this.notify(),
    }, offlineMapSync);
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
        syncGpsTracks: (context, instance, token) => this.gpsTrackMutationCoordinator.syncPhase(
          context,
          instance,
          token,
        ),
        queueTilePrefetch: (projects, runId) => this.tileCoordinator.queueProjectSync(
          projects,
          runId,
        ),
      },
      now: () => Date.now(),
      elapsedNow: () => performance.now(),
    });
    void this.gpsTrackCoordinator.load();
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
        return this.service.createLandmark(credentials.instance, credentials.token, input, {
          signal: this.requireUserOperationContext().signal,
        });
      },
      patchLandmark: (id, input) => {
        const credentials = this.requireQueueCredentials();
        return this.service.updateLandmark(credentials.instance, credentials.token, id, input, {
          signal: this.requireUserOperationContext().signal,
        });
      },
      deleteLandmark: (id) => {
        const credentials = this.requireQueueCredentials();
        return this.service.deleteLandmark(credentials.instance, credentials.token, id, {
          signal: this.requireUserOperationContext().signal,
        });
      },
      fetchLandmarksGeoJSON: () => {
        const credentials = this.requireQueueCredentials();
        return this.service.getLandmarksGeoJSON(credentials.instance, credentials.token, {
          signal: this.requireUserOperationContext().signal,
        });
      },
      applyUpsert: (landmark) => this.applyLandmarkUpsert(
        landmark,
        this.requireUserOperationContext().signal,
      ),
      applyRemoval: (id) => this.applyLandmarkRemoval(
        id,
        this.requireUserOperationContext().signal,
      ),
      uploadGpsTrack: (localTrackId) =>
        this.gpsTrackMutationCoordinator.performReplayUpload(
          localTrackId,
          this.requireUserOperationContext().signal,
        ),
      patchGpsTrack: (id, input) => {
        const credentials = this.requireQueueCredentials();
        return this.service.updateGpsTrack(credentials.instance, credentials.token, id, input, {
          signal: this.requireUserOperationContext().signal,
        });
      },
      deleteGpsTrackRemote: (id) => {
        const credentials = this.requireQueueCredentials();
        return this.service.deleteGpsTrack(credentials.instance, credentials.token, id, {
          signal: this.requireUserOperationContext().signal,
        });
      },
      fetchGpsTracks: () => {
        const credentials = this.requireQueueCredentials();
        return this.service.getGpsTracks(credentials.instance, credentials.token, {
          signal: this.requireUserOperationContext().signal,
        });
      },
      applyGpsTrackUpsert: (track) => this.gpsTrackCoordinator.applyRemoteUpsert(
        track,
        this.requireUserOperationContext().signal,
      ),
      applyGpsTrackRemoval: (id) => this.gpsTrackCoordinator.applyRemoteRemoval(
        id,
        this.requireUserOperationContext().signal,
      ),
      onGpsTrackCreated: (localTrackId) =>
        this.gpsTrackMutationCoordinator.finalizeUpload(
          localTrackId,
          this.requireUserOperationContext().signal,
        ),
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
    this.gpsTrackCoordinator.offlineMutationChanged();
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

  get offlineMapSyncSnapshot(): OfflineMapSyncSnapshot {
    return this.tileCoordinator.snapshot;
  }

  subscribeOfflineMapSync(listener: () => void): () => void {
    return this.tileCoordinator.subscribe(listener);
  }

  async refreshOfflineMaps(): Promise<void> {
    await this.tileCoordinator.refreshOfflineMaps();
  }

  get isOfflineMapRefreshActive(): boolean {
    return this.tileCoordinator.isRefreshActive;
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
    return this.gpsTrackCoordinator.tracks;
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
   * Set when recording requires user attention (fatal location loss or durable
   * persistence/cleanup failure). The UI surfaces it once then calls
   * `clearGpsRecordingError()`. Null otherwise; recoverable points remain owned
   * by the recording coordinator after the one-shot message is cleared.
   */
  get gpsRecordingError(): string | null {
    return this.gpsRecordingCoordinator.recordingError;
  }

  /** Bumped on any GPS track/recording change so the panel re-reads state. */
  get gpsTracksRevision(): number {
    return this.gpsTrackCoordinator.revision;
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
    this._listeners.forEach((fn) => fn());
  }

  private invalidateAsyncOperations(): void {
    this._asyncGeneration += 1;
    this._userOperationContext?.abort('User operations invalidated');
    this._userOperationContext = null;
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

  private runUserOperation<T>(
    operation: (context: CancellationContext) => Promise<T>,
  ): Promise<T> {
    let context: CancellationContext;
    try {
      context = this.requireUserOperationContext();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.trackOperation((async () => {
      context.throwIfAborted();
      const result = await operation(context);
      context.throwIfAborted();
      return result;
    })());
  }

  private requireUserOperationContext(): CancellationContext {
    if (this._isPurgingLocalData || !this.sessionCoordinator.isAuthenticated) {
      throw createAbortError('No active user session.');
    }
    if (!this._userOperationContext) {
      this._userOperationContext = new CancellationContext(
        this._nextUserOperationRunId,
        'User operation lifetime',
      );
      this._nextUserOperationRunId += 1;
    }
    return this._userOperationContext;
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

  async preloadOfflineMaps(): Promise<void> {
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
   * - 401/403 -> 'unauthorized' (and local logout/cache purge)
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
   * - `unauthorized`  -> 401/403: session invalid, logout + cache purge already ran.
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
    let sessionClearFailed = false;
    let cleanupFailed = false;
    const notifySafely = (): void => {
      try {
        this.notify();
      } catch {
        cleanupFailed = true;
      }
    };
    try {
      // Revoke all published user state before awaiting fallible native or
      // persistence teardown. Cleanup failures are reported only after every
      // independent wipe step has been attempted.
      this.sessionCoordinator.reset();
      this.projectSyncCoordinator.reset();
      this.gpsTrackCoordinator.resetForLogout();
      this.offlineMutations.reset();
      notifySafely();

      const teardownTasks: Promise<void>[] = [
        Promise.resolve().then(() => this.tileCoordinator.stopForLogout()).catch(() => {
          cleanupFailed = true;
        }),
        Promise.resolve().then(() => this.gpsRecordingCoordinator.stopForLogout()).catch(() => {
          cleanupFailed = true;
        }),
      ];
      try {
        await this.prefs.session.clear();
      } catch {
        sessionClearFailed = true;
      }

      try {
        localStorage.clear();
      } catch {
        cleanupFailed = true;
      }

      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.clear();
        }
      } catch {
        cleanupFailed = true;
      }

      notifySafely();

      await Promise.all(teardownTasks);
      await this.waitForTrackedOperations();
      if (this.gpsTrackCoordinator.hasPendingPersistence) {
        try {
          await this.gpsTrackCoordinator.waitForPersistence();
        } catch {
          cleanupFailed = true;
        }
      }

      const cleanupResults = await Promise.allSettled([
        this.cache.clearAll(),
        ...this.tileCoordinator.persistentCleanupTasks(),
      ]);
      for (const result of cleanupResults) {
        if (result.status === 'rejected') {
          cleanupFailed = true;
        }
      }

      try {
        this.tileCoordinator.restartAfterLogout();
      } catch {
        cleanupFailed = true;
      }
      notifySafely();
      if (sessionClearFailed) {
        throw new Error('Secure credential deletion failed during logout.');
      }
      if (cleanupFailed) {
        throw new Error('Local data deletion did not complete during logout.');
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
    return this.runUserOperation((context) => this.projectGeoJSONCoordinator.getMapData(
      this.projectSyncCoordinator.projects,
      projectId,
      context.signal,
    ));
  }

  /** Backward-compatible data-only accessor; still enforces validation. */
  async getProjectGeoJSON(projectId: string): Promise<unknown | null> {
    return (await this.getProjectMapData(projectId))?.featureCollection ?? null;
  }

  /** Persist acknowledgement for the exact warning versions currently shown. */
  async acknowledgeProjectGeoJSONWarnings(): Promise<ProjectGeoJSONAcknowledgementResult> {
    return this.runUserOperation((context) => (
      this.projectGeoJSONCoordinator.acknowledgeWarnings(context.signal)
    ));
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
    return this.runUserOperation(async (context) => {
      const raw = await this.cache.getOverlayGeoJSON(overlayId, { signal: context.signal });
      context.throwIfAborted();
      if (overlayId !== 'landmarks') return raw;
      await this.offlineMutations.load();
      context.throwIfAborted();
      if (this.offlineMutations.count === 0) return raw;
      const base = normalizeGeoJSON(raw) ?? { type: 'FeatureCollection', features: [] };
      return this.offlineMutations.foldLandmarks(base);
    });
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
    const credentials = this.getSyncCredentials();
    if (!credentials) return [];
    return this.runUserOperation(async (context) => {
      if (!this.hasNetworkAccess()) {
        return (await this.cache.getLandmarkCollections({ signal: context.signal })) ?? [];
      }

      try {
        const response = await this.service.getLandmarkCollections(
          credentials.instance,
          credentials.token,
          { signal: context.signal },
        );
        context.throwIfAborted();
        if (!isSuccessfulStatus(response.status)) {
          return (await this.cache.getLandmarkCollections({ signal: context.signal })) ?? [];
        }
        const collections = mapLandmarkCollections(response.data);
        await this.cache.setLandmarkCollections(collections, { signal: context.signal });
        context.throwIfAborted();
        return collections;
      } catch (error) {
        if (isAbortError(error)) throw error;
        console.warn('Failed to load landmark collections:', error);
        return (await this.cache.getLandmarkCollections({ signal: context.signal })) ?? [];
      }
    });
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
    return this.runUserOperation(async (context) => {
      if (this.hasNetworkAccess()) {
        try {
          const response = await this.attemptLandmarkRequest(() =>
            this.service.createLandmark(credentials.instance, credentials.token, input, {
              signal: context.signal,
            }),
          );
          context.throwIfAborted();
          const landmark = this.extractLandmark(response.status, response.data);
          await this.applyLandmarkUpsert(landmark, context.signal);
          return landmark;
        } catch (error) {
          if (this.isUnreachableError(error)) {
            this.enterOfflineMode();
            return this.enqueueCreate(input, context.signal);
          }
          throw error;
        }
      }
      return this.enqueueCreate(input, context.signal);
    });
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
    return this.runUserOperation(async (context) => {
      if (this.hasNetworkAccess()) {
        try {
          const response = await this.attemptLandmarkRequest(() =>
            this.service.updateLandmark(credentials.instance, credentials.token, id, input, {
              signal: context.signal,
            }),
          );
          context.throwIfAborted();
          const landmark = this.extractLandmark(response.status, response.data);
          await this.applyLandmarkUpsert(landmark, context.signal);
          return landmark;
        } catch (error) {
          if (this.isUnreachableError(error)) {
            this.enterOfflineMode();
            return this.enqueueUpdate(id, input, context.signal);
          }
          throw error;
        }
      }
      return this.enqueueUpdate(id, input, context.signal);
    });
  }

  /**
   * Delete a landmark. Same online/offline/4xx semantics as `createLandmark`.
   */
  async deleteLandmark(id: string): Promise<void> {
    const credentials = this.getSyncCredentials();
    if (!credentials) throw new LandmarkMutationError('permission', 'You are not signed in.');
    return this.runUserOperation(async (context) => {
      if (this.hasNetworkAccess()) {
        try {
          const response = await this.attemptLandmarkRequest(() =>
            this.service.deleteLandmark(credentials.instance, credentials.token, id, {
              signal: context.signal,
            }),
          );
          context.throwIfAborted();
          if (!isSuccessfulStatus(response.status)) {
            throw parseLandmarkMutationError(response.status, response.data);
          }
          await this.applyLandmarkRemoval(id, context.signal);
          return;
        } catch (error) {
          if (this.isUnreachableError(error)) {
            this.enterOfflineMode();
            await this.enqueueDelete(id, context.signal);
            return;
          }
          throw error;
        }
      }
      await this.enqueueDelete(id, context.signal);
    });
  }

  // ---- GPS track recording + upload -----------------------------------------

  /**
   * Begin recording a GPS track. Requests location permission and starts the
   * shared position watch (no watcher-level filters; gating is the shared
   * `shouldAcceptFix` time gate). Throws if permission is denied so the UI can
   * surface it. Overlapping starts share one transition; a later start outside
   * `idle` rejects with `GpsRecordingTransitionError`.
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
   * Serialize a unified track to a GPX document + file name for export / share.
   * Works for local recordings (in-memory points) and server tracks (geometry
   * downloaded + cached on demand). Reuses the same builder as upload.
   */
  async buildGpxFileForTrack(item: GpsTrackListItem): Promise<GpsTrackGpxFile> {
    return this.runUserOperation((context) => (
      this.gpsTrackCoordinator.buildGpxFile(item, context.signal)
    ));
  }

  /**
   * Points for a track, for map display + GPX export. Local recordings return
   * their in-memory buffer; server tracks download + cache their GeoJSON.
   */
  async getGpsTrackPoints(id: string): Promise<RecordedPoint[]> {
    return this.runUserOperation((context) => (
      this.gpsTrackCoordinator.getPoints(id, context.signal)
    ));
  }

  /**
   * Cache-first GeoJSON geometry for a server track (downloaded from its signed
   * URL on first use). Returns null for a local track (use its points) or when
   * unavailable offline.
   */
  async getGpsTrackGeoJSON(id: string): Promise<GeoJSON.FeatureCollection | null> {
    return this.runUserOperation((context) => (
      this.gpsTrackCoordinator.getGeoJSON(id, context.signal)
    ));
  }

  /**
   * Upload a recorded local track (the "create" mutation). Mirrors
   * `createLandmark`: an online 2xx deletes the local copy and re-syncs the
   * server list; an unreachable failure flips offline and enqueues a
   * `CreateGpsTrackOp` (drained from the Pending page); a definitive 4xx throws.
   */
  async uploadGpsTrack(id: string): Promise<void> {
    await this.runUserOperation((context) => (
      this.gpsTrackMutationCoordinator.upload(id, context.signal)
    ));
  }

  /**
   * Edit a track's name/color. A local recording is edited in place (no
   * network; any pending upload op is updated to match). A server track follows
   * the landmark online-attempt-then-enqueue model (PATCH; enqueue on
   * unreachable; throw on definitive 4xx).
   */
  async editGpsTrack(id: string, input: { name?: string; color?: string }): Promise<void> {
    await this.runUserOperation((context) => (
      this.gpsTrackMutationCoordinator.edit(id, input, context.signal)
    ));
  }

  /**
   * Delete a track. A local recording is removed from this device (and any
   * pending upload op discarded). A server track follows the landmark model
   * (DELETE; enqueue on unreachable; throw on definitive 4xx).
   */
  async removeGpsTrack(id: string): Promise<void> {
    await this.runUserOperation((context) => (
      this.gpsTrackMutationCoordinator.remove(id, context.signal)
    ));
  }

  /** Refresh the server GPS-track list (used after an upload + standalone). */
  async syncGpsTracks(): Promise<void> {
    await this.runUserOperation((context) => (
      this.gpsTrackMutationCoordinator.sync(context.signal)
    ));
  }

  private defaultTrackName(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Track ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
      if (isAbortError(error)) throw error;
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

  private async enqueueCreate(
    input: LandmarkCreateInput,
    signal?: AbortSignal,
  ): Promise<LandmarkApiObject> {
    throwIfAborted(signal);
    const landmark = await this.buildOptimisticCreate(input, signal);
    throwIfAborted(signal);
    try {
      await this.offlineMutations.enqueueLandmarkCreate(landmark);
      throwIfAborted(signal);
    } catch (error) {
      this.throwOfflineQueuePersistenceError(error);
    }
    return landmark;
  }

  private async enqueueUpdate(
    id: string,
    input: LandmarkUpdateInput,
    signal?: AbortSignal,
  ): Promise<LandmarkApiObject> {
    // The footprint is ONLY the last known server state from the ground-truth
    // cache. If the landmark isn't in the ground truth we record `null` rather
    // than fabricating a baseline from the user's own edit -- inventing one
    // would guarantee a false "changed on the server" conflict on the next sync.
    throwIfAborted(signal);
    const baseline = await this.currentLandmarkSnapshot(id, signal);
    const next = this.snapshotFromUpdate(input, baseline);
    try {
      await this.offlineMutations.enqueueLandmarkUpdate(id, baseline, next);
      throwIfAborted(signal);
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

  private async enqueueDelete(id: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const baseline = await this.currentLandmarkSnapshot(id, signal);
    try {
      await this.offlineMutations.enqueueLandmarkDelete(id, baseline);
      throwIfAborted(signal);
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
  private async currentLandmarkSnapshot(
    id: string,
    signal?: AbortSignal,
  ): Promise<LandmarkSnapshot | null> {
    throwIfAborted(signal);
    const fc = normalizeGeoJSON(await this.cache.getOverlayGeoJSON('landmarks', { signal }));
    throwIfAborted(signal);
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
  private async buildOptimisticCreate(
    input: LandmarkCreateInput,
    signal?: AbortSignal,
  ): Promise<LandmarkApiObject> {
    throwIfAborted(signal);
    const collectionId =
      typeof input.collection === 'string' && input.collection.trim() !== ''
        ? input.collection.trim()
        : null;
    let collectionName = 'Personal Landmarks';
    let collectionColor = '';
    let isPersonal = collectionId === null;
    if (collectionId) {
      const cached = await this.cache.getLandmarkCollections({ signal });
      throwIfAborted(signal);
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
    return this.runUserOperation(() => this.offlineMutations.syncAll());
  }

  /** Replay a single pending op. */
  async syncOfflineOp(id: string): Promise<OfflineSyncSummary> {
    return this.runUserOperation(() => this.offlineMutations.syncOne(id));
  }

  /** Discard a pending op; the map reverts to the prior version via re-fold. */
  async discardOfflineOp(id: string): Promise<void> {
    await this.runUserOperation(() => this.offlineMutations.discard(id));
  }

  /** Resolve a conflicted op by keeping the local change or the server version. */
  async resolveOfflineOpConflict(
    id: string,
    choice: OfflineConflictChoice,
  ): Promise<OfflineSyncSummary> {
    return this.runUserOperation(() => this.offlineMutations.resolveConflict(id, choice));
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

  private async applyLandmarkUpsert(
    landmark: LandmarkApiObject,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    await this.cache.updateOverlayFeatureCollection(
      'landmarks',
      (current) => upsertLandmarkFeature(current, landmark),
      { signal },
    );
    throwIfAborted(signal);
    this.bumpLandmarksRevision();
  }

  private async applyLandmarkRemoval(id: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.cache.updateOverlayFeatureCollection(
      'landmarks',
      (current) => removeLandmarkFeature(current, id),
      { signal },
    );
    throwIfAborted(signal);
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
