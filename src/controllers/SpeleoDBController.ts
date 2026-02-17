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
  clearCachedTiles,
  clearPrefetchJobs,
  setTileCacheOfflineMode,
} from '../services/TileCacheService';
import { TilePrefetchService } from '../services/TilePrefetchService';
import type {
  AuthResponse,
  AuthState,
  LoginCredentials,
  User,
} from '../types';
import type { Project } from '../types/project';
import type { MapOverlayId } from '../types/mapOverlay';
import type { TilePrefetchJobState } from '../types/tilePrefetch';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';

// ==================== Sync status ====================

export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

// ==================== Preferences interface (for DI) ====================

/** The slice of PreferencesService the controller needs. */
export interface PreferencesPort {
  getPreferences(): { email?: string; token?: string; instance?: string };
  setPreferences(prefs: Partial<{ email?: string; token?: string; instance?: string }>): void;
  clearPreferences(): void;
}

// ==================== Storage keys (offline) ====================

const STORAGE_KEYS = {
  USERS_DB: 'speleo_users_db',
} as const;

// ==================== Controller ====================

export class SpeleoDBController {
  // ---- Observable state -----------------------------------------------------
  private _authState: AuthState = { isAuthenticated: false, user: null, token: null };
  private _isOnline = false;
  private _isOfflineLocked = false;
  private _isRetryingConnection = false;
  private _projects: Project[] = [];
  private _syncStatus: SyncStatus = 'idle';
  private _tilePrefetchJobs: TilePrefetchJobState[] = [];
  private _listeners = new Set<() => void>();
  private tilePrefetch!: TilePrefetchService;
  private tilePrefetchUnsubscribe: (() => void) | null = null;
  private _isPurgingLocalData = false;

  // Snapshot references for useSyncExternalStore (identity-stable between notifies)
  private _authStateSnapshot: AuthState = this._authState;
  private _isOnlineSnapshot: boolean = this._isOnline;
  private _isOfflineLockedSnapshot: boolean = this._isOfflineLocked;
  private _isRetryingConnectionSnapshot: boolean = this._isRetryingConnection;
  private _projectsSnapshot: Project[] = this._projects;
  private _syncStatusSnapshot: SyncStatus = this._syncStatus;
  private _tilePrefetchJobsSnapshot: TilePrefetchJobState[] = this._tilePrefetchJobs;

  constructor(
    private service: SpeleoDBService,
    private prefs: PreferencesPort,
    private cache: ProjectCacheService,
    tilePrefetch?: TilePrefetchService,
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

  get isRetryingConnection(): boolean {
    return this._isRetryingConnectionSnapshot;
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
    this._isRetryingConnectionSnapshot = this._isRetryingConnection;
    this._projectsSnapshot = [...this._projects];
    this._syncStatusSnapshot = this._syncStatus;
    this._tilePrefetchJobsSnapshot = [...this._tilePrefetchJobs];
    this._listeners.forEach((fn) => fn());
  }

  private attachTilePrefetch(service: TilePrefetchService): void {
    this.tilePrefetch = service;
    this.tilePrefetchUnsubscribe = this.tilePrefetch.subscribe((jobs) => {
      this._tilePrefetchJobs = jobs;
      this.notify();
    });
  }

  private createTilePrefetchService(): TilePrefetchService {
    return new TilePrefetchService({
      isOnline: () => this.hasNetworkAccess(),
    });
  }

  private setOfflineLocked(locked: boolean): void {
    this._isOfflineLocked = locked;
    setTileCacheOfflineMode(locked);
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

        if (response.status === HTTP_STATUS.OK) {
          const userEmail = response.data.user ?? email;
          const user: User = { id: 'auth', email: userEmail, name: userEmail };
          this._authState = { isAuthenticated: true, user, token: response.data.token };
          this._isOnline = true;
          this.prefs.setPreferences({ email: userEmail, token: response.data.token, instance: instance.trim() });
          this.notify();
          return { success: true, message: 'Login successful', user, token: response.data.token };
        }

        // Error response from server
        const body = response.data as { detail?: string; message?: string } | undefined;
        const message =
          body?.detail ?? body?.message ??
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

  async retryConnection(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    if (this._isRetryingConnection) return 'network_error';

    this._isRetryingConnection = true;
    this.notify();
    try {
      return await this.validateSessionAgainstServer();
    } finally {
      this._isRetryingConnection = false;
      this.notify();
    }
  }

  private async validateSessionAgainstServer(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    const prefs = this.prefs.getPreferences();
    const token = prefs.token;
    const instance = prefs.instance?.trim();
    if (!token || !instance) return 'unauthorized';

    try {
      const response = await this.service.validateToken(
        instance,
        token,
        NETWORK.STARTUP_AUTH_TIMEOUT_MS,
      );

      if (response.status >= 200 && response.status < 300) {
        this._isOnline = true;
        this.setOfflineLocked(false);
        this.notify();
        return 'ok';
      }
      if (response.status >= 400 && response.status < 500) {
        await this.logout();
        return 'unauthorized';
      }
      // Any non-4xx status at startup is treated as a transient network/server issue.
      // Keep the session and move to offline mode instead of wiping local data.
      this._isOnline = false;
      this.setOfflineLocked(true);
      this.notify();
      return 'network_error';
    } catch {
      // Timeout or transport errors must never trigger logout.
      this._isOnline = false;
      this.setOfflineLocked(true);
      this.notify();
      return 'network_error';
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
      this._isRetryingConnection = false;
      this._projects = [];
      this._syncStatus = 'idle';
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

      const cleanupResults = await Promise.allSettled([
        this.cache.clearAll(),
        clearCachedTiles(),
        clearPrefetchJobs(),
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
  async syncProjects(): Promise<void> {
    // Step 1 -- serve from cache instantly
    try {
      const cached = await this.cache.getProjects();
      if (cached && cached.length > 0) {
        this._projects = cached;
        this.notify();
      }
    } catch (error) {
      console.warn('Failed to load cached projects:', error);
    }

    // Step 2 -- fetch fresh data if online
    if (!this.hasNetworkAccess()) {
      // Already showing cached data (if any); nothing more to do offline.
      if (this._projects.length === 0) {
        this._syncStatus = 'error';
      }
      this.notify();
      return;
    }

    const prefs = this.prefs.getPreferences();
    const token = prefs.token;
    const instance = prefs.instance?.trim();
    if (!token || !instance) return;

    this._syncStatus = 'syncing';
    this.notify();

    try {
      const response = await this.service.getProjectsGeoJSON(instance, token);

      if (response.status >= 200 && response.status < 300 && response.data?.data) {
        const freshProjects = response.data.data;
        this._projects = freshProjects;
        this._isOnline = true;
        this.setOfflineLocked(false);
        await this.cache.setProjects(freshProjects);
        this.notify();

        // Step 3 -- download geojson files in background (non-blocking)
        await this.downloadGeoJSONFiles(freshProjects);

        // Step 4 -- sync read-only map overlays for offline icon rendering.
        await this.syncMapOverlays(instance, token);

        // Step 5 -- start aggressive tile prefetch in background for offline mode.
        void this.scheduleTilePrefetch(freshProjects);
      }

      this._syncStatus = 'done';
    } catch (error) {
      console.warn('syncProjects: API fetch failed:', error);
      this._syncStatus = this._projects.length > 0 ? 'done' : 'error';
    }

    this.notify();
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
  private async downloadGeoJSONFiles(projects: Project[]): Promise<void> {
    if (!this.hasNetworkAccess()) return;

    const eligible = projects.filter(
      (p) => p.geojson_file && !p.exclude_geojson,
    );
    if (eligible.length === 0) return;

    // Shared mutable queue consumed by the workers.
    const queue = [...eligible];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        if (!this.hasNetworkAccess()) return;
        const project = queue.shift()!;
        try {
          const cachedCommit = await this.cache.getCachedCommitId(project.id);
          if (cachedCommit === project.latest_commit.id) continue; // already up to date

          if (!this.hasNetworkAccess()) return;
          const res = await this.service.downloadJSON(project.geojson_file!);
          await this.cache.setGeoJSON(project.id, res.data, project.latest_commit.id);
        } catch (error) {
          console.warn(`Failed to cache geojson for project ${project.id}:`, error);
        }
      }
    };

    const concurrency = Math.min(3, eligible.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  /**
   * Sync shared map overlays so read-only icons remain available offline.
   */
  private async syncMapOverlays(instance: string, token: string): Promise<void> {
    if (!this.hasNetworkAccess()) return;

    await Promise.all(MAP_OVERLAYS.map(async (overlay) => {
      if (!this.hasNetworkAccess()) return;

      try {
        const response = await this.fetchOverlayGeoJSON(overlay.id, instance, token);
        if (response.status >= 200 && response.status < 300) {
          await this.cache.setOverlayGeoJSON(overlay.id, response.data);
          return;
        }

        console.warn(
          `Overlay sync skipped for ${overlay.id}: status ${response.status}`,
        );
      } catch (error) {
        console.warn(`Failed to sync overlay ${overlay.id}:`, error);
      }
    }));
  }

  private fetchOverlayGeoJSON(
    overlayId: MapOverlayId,
    instance: string,
    token: string,
  ): ReturnType<SpeleoDBService['getLandmarksGeoJSON']> {
    switch (overlayId) {
      case 'landmarks':
        return this.service.getLandmarksGeoJSON(instance, token);
      case 'subsurfaceStations':
        return this.service.getSubsurfaceStationsGeoJSON(instance, token);
      case 'surfaceStations':
        return this.service.getSurfaceStationsGeoJSON(instance, token);
      case 'explorationLeads':
        return this.service.getExplorationLeadsGeoJSON(instance, token);
      case 'cylinderInstalls':
        return this.service.getCylinderInstallsGeoJSON(instance, token);
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
  private async scheduleTilePrefetch(projects: Project[]): Promise<void> {
    if (!this.hasNetworkAccess()) return;

    const eligible = projects.filter((p) => p.geojson_file && !p.exclude_geojson);
    if (eligible.length === 0) return;

    const inputs: Array<{
      projectId: string;
      commitId: string;
      geojson: GeoJSON.FeatureCollection;
    }> = [];

    for (const project of eligible) {
      try {
        const raw = await this.cache.getGeoJSON(project.id);
        const normalized = normalizeGeoJSON(raw);
        if (!normalized || normalized.features.length === 0) continue;
        inputs.push({
          projectId: project.id,
          commitId: project.latest_commit.id,
          geojson: normalized,
        });
      } catch (error) {
        console.warn(`Failed preparing map prefetch for project ${project.id}:`, error);
      }
    }

    if (inputs.length === 0) return;

    try {
      await this.tilePrefetch.enqueueProjects(inputs, {
        tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
        minZoom: 0,
        maxZoom: 18,
        padMeters: 50,
      });
    } catch (error) {
      console.warn('Map prefetch scheduling failed:', error);
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
      if (prefs.token && prefs.instance) {
        const email = prefs.email ?? '';
        this._authState = {
          isAuthenticated: true,
          user: { id: 'restored', email, name: email },
          token: prefs.token,
        };
        // Update snapshots (no notify -- no listeners registered yet at construct time).
        this._authStateSnapshot = { ...this._authState };
      }
    } catch (error) {
      console.error('Failed to load auth state:', error);
    }
  }

  /** Attempt login against the local users DB (offline). */
  private offlineLogin(email: string, password: string, instance: string): AuthResponse {
    const localUsers = this.getLocalUsers();
    const localUser = localUsers[email.toLowerCase()];

    if (localUser && localUser.password === password) {
      const token = this.generateOfflineToken();
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
