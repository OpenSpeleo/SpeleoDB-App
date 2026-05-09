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

import { HTTP_STATUS, MAP, MAP_OVERLAYS, NETWORK } from '../constants';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import {
  clearCachedTilesRuntime,
  clearPrefetchJobsRuntime,
  setTileCacheOfflineModeRuntime,
} from '../services/TileCacheRuntime';
import { LazyTilePrefetchService } from '../services/LazyTilePrefetchService';
import type { TilePrefetchServiceLike } from '../services/TilePrefetchService';
import type {
  AuthResponse,
  AuthState,
  AuthTokenResponse,
  LoginCredentials,
  User,
} from '../types';
import type { Project } from '../types/project';
import type { MapOverlayId } from '../types/mapOverlay';
import type { TilePrefetchJobState } from '../types/tilePrefetch';
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

// ==================== Preferences interface (for DI) ====================

/** The slice of PreferencesService the controller needs. */
export interface PreferencesPort {
  getPreferences(): {
    email?: string;
    token?: string;
    instance?: string;
    lastSyncedAt?: number;
  };
  setPreferences(
    prefs: Partial<{
      email?: string;
      token?: string;
      instance?: string;
      lastSyncedAt?: number;
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
  private _listeners = new Set<() => void>();
  private tilePrefetch!: TilePrefetchServiceLike;
  private tilePrefetchUnsubscribe: (() => void) | null = null;
  private _isPurgingLocalData = false;
  private _asyncGeneration = 0;
  private _nextRunId = 1;
  private activeValidationContext: CancellationContext | null = null;
  private activeSyncContext: CancellationContext | null = null;
  private _trackedOperations = new Set<Promise<unknown>>();

  // Snapshot references for useSyncExternalStore (identity-stable between notifies)
  private _authStateSnapshot: AuthState = this._authState;
  private _isOnlineSnapshot: boolean = this._isOnline;
  private _isOfflineLockedSnapshot: boolean = this._isOfflineLocked;
  private _projectsSnapshot: Project[] = this._projects;
  private _syncStatusSnapshot: SyncStatus = this._syncStatus;
  private _lastSyncedAtSnapshot: number | null = this._lastSyncedAt;
  private _tilePrefetchJobsSnapshot: TilePrefetchJobState[] = this._tilePrefetchJobs;

  constructor(
    private service: SpeleoDBService,
    private prefs: PreferencesPort,
    private cache: ProjectCacheService,
    tilePrefetch?: TilePrefetchServiceLike,
  ) {
    this.attachTilePrefetch(tilePrefetch ?? this.createTilePrefetchService());
    this.restoreSession();
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
    this._listeners.forEach((fn) => fn());
  }

  private invalidateAsyncOperations(): void {
    this._asyncGeneration += 1;
    this.activeValidationContext?.abort('Async operations invalidated');
    this.activeSyncContext?.abort('Async operations invalidated');
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
    this.tilePrefetchUnsubscribe = this.tilePrefetch.subscribe((jobs) => {
      this._tilePrefetchJobs = jobs;
      this.notify();
    });
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

  async preloadTilePrefetch(): Promise<void> {
    await this.tilePrefetch.preload?.();
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

      console.warn('syncProjects: API fetch failed:', error);
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
   * Build and enqueue tile prefetch jobs for every project with cached GeoJSON.
   * Uses bbox+50m and zoom levels 0..18 so map imagery is available offline.
   */
  private async scheduleTilePrefetchPhase(
    context: CancellationContext,
    projects: Project[],
  ): Promise<TilePrefetchPhaseResult> {
    if (!this.hasNetworkAccess()) {
      return this.createSkippedTilePrefetchPhase('offline_locked');
    }

    const eligible = projects.filter((p) => p.geojson_file && !p.exclude_geojson);
    if (eligible.length === 0) {
      return this.createSkippedTilePrefetchPhase('no_prefetch_candidates');
    }

    const inputs: Array<{
      projectId: string;
      commitId: string;
      geojson: GeoJSON.FeatureCollection;
    }> = [];
    let failedProjectCount = 0;

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

        failedProjectCount += 1;
        console.warn(`Failed preparing map prefetch for project ${project.id}:`, error);
      }
    }

    if (inputs.length === 0) {
      return {
        phase: 'tile_prefetch',
        status: failedProjectCount > 0 ? 'failed' : 'skipped',
        reason: failedProjectCount > 0 ? 'tile_prefetch_failed' : 'no_prefetch_candidates',
        eligibleProjectCount: eligible.length,
        scheduledProjectCount: 0,
        failedProjectCount,
      };
    }

    try {
      await this.tilePrefetch.enqueueProjects(inputs, {
        tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
        minZoom: 0,
        maxZoom: 18,
        padMeters: 50,
      }, {
        signal: context.signal,
      });
      context.throwIfAborted();

      return {
        phase: 'tile_prefetch',
        status: failedProjectCount > 0 ? 'failed' : 'applied',
        reason: failedProjectCount > 0 ? 'tile_prefetch_failed' : 'tile_prefetch_scheduled',
        eligibleProjectCount: eligible.length,
        scheduledProjectCount: inputs.length,
        failedProjectCount,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      console.warn('Map prefetch scheduling failed:', error);
      return {
        phase: 'tile_prefetch',
        status: 'failed',
        reason: 'tile_prefetch_failed',
        eligibleProjectCount: eligible.length,
        scheduledProjectCount: inputs.length,
        failedProjectCount: failedProjectCount + inputs.length,
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
