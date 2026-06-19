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
  HTTP_STATUS,
  MAP_LAYERS,
  MAP_OVERLAYS,
  NETWORK,
  TILE_PREFETCH,
} from '../constants';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
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

function hasAuthTokenResponse(data: unknown): data is AuthTokenResponse {
  if (!data || typeof data !== 'object') {
    return false;
  }

  return typeof (data as { token?: unknown }).token === 'string'
    && (data as { token: string }).token.trim().length > 0;
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
  // Tile-cache overflow consent (persisted) + a transient manual re-trigger.
  private _tileCacheOverLimitApproved = false;
  private _tileCacheOverLimitPromptAcknowledged = false;
  private _storageConsentRequested = false;
  // Latch so the "stuck while approved" diagnostic warns once, not per notify.
  private _warnedStuckWhileApproved = false;
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
  private _tileCacheOverLimitApprovedSnapshot = this._tileCacheOverLimitApproved;
  private _tileCacheOverLimitPromptAcknowledgedSnapshot =
    this._tileCacheOverLimitPromptAcknowledged;
  private _storageConsentRequestedSnapshot = this._storageConsentRequested;

  constructor(
    private service: SpeleoDBService,
    private prefs: PreferencesPort,
    private cache: ProjectCacheService,
    tilePrefetch?: TilePrefetchServiceLike,
  ) {
    this.attachTilePrefetch(tilePrefetch ?? this.createTilePrefetchService());
    this.restoreSession();
    this.restoreTileCacheOverLimitConsent();
    this.setOfflineLocked(false);
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
    this._tileCacheOverLimitApprovedSnapshot = this._tileCacheOverLimitApproved;
    this._tileCacheOverLimitPromptAcknowledgedSnapshot =
      this._tileCacheOverLimitPromptAcknowledged;
    this._storageConsentRequestedSnapshot = this._storageConsentRequested;
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
          const userEmail = typeof response.data.user === 'string' && response.data.user.trim()
            ? response.data.user
            : email;
          const user: User = { id: 'auth', email: userEmail, name: userEmail };
          this.invalidateAsyncOperations();
          this._authState = { isAuthenticated: true, user, token: response.data.token };
          this._isOnline = true;
          this.prefs.setPreferences({ email: userEmail, token: response.data.token, instance: instance.trim() });
          this.notify();
          return { success: true, message: 'Login successful', user, token: response.data.token };
        }

        // Error response from server
        const body = response.data as
          | {
              detail?: string;
              message?: string;
              errors?: { non_field_errors?: string[] };
            }
          | undefined;
        const message =
          body?.detail ??
          body?.message ??
          body?.errors?.non_field_errors?.[0] ??
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
      // tracks itself for logout teardown.
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

      // Reset in-memory state first so UI reflects the wipe immediately.
      this._authState = { isAuthenticated: false, user: null, token: null };
      this._isOnline = false;
      this.setOfflineLocked(false);
      this._projects = [];
      this._syncStatus = 'idle';
      this._lastSyncedAt = null;
      this._tilePrefetchJobs = [];
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
   */
  async getOverlayGeoJSON(overlayId: MapOverlayId): Promise<unknown | null> {
    return this.cache.getOverlayGeoJSON(overlayId);
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

    return {
      phase: 'overlay_sync',
      status: failedOverlayCount > 0 ? 'failed' : 'applied',
      reason: failedOverlayCount > 0 ? 'overlay_sync_partial_failure' : 'overlays_synced',
      attemptedOverlayCount: MAP_OVERLAYS.length,
      syncedOverlayCount,
      failedOverlayCount,
    };
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
        const email = prefs.email ?? '';
        this._authState = {
          isAuthenticated: true,
          user: { id: 'restored', email, name: email },
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
