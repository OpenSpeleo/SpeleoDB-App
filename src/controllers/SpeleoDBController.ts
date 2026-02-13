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

import { HTTP_STATUS, PREFERENCES } from '../constants';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type {
  AuthResponse,
  AuthState,
  LoginCredentials,
  SignupCredentials,
  User,
} from '../types';
import type { Project } from '../types/project';

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
  PENDING_SYNC: 'speleo_pending_sync',
  USERS_DB: 'speleo_users_db',
} as const;

// ==================== Controller ====================

export class SpeleoDBController {
  // ---- Observable state -----------------------------------------------------
  private _authState: AuthState = { isAuthenticated: false, user: null, token: null };
  private _isOnline = false;
  private _projects: Project[] = [];
  private _syncStatus: SyncStatus = 'idle';
  private _listeners = new Set<() => void>();

  // Snapshot references for useSyncExternalStore (identity-stable between notifies)
  private _authStateSnapshot: AuthState = this._authState;
  private _isOnlineSnapshot: boolean = this._isOnline;
  private _projectsSnapshot: Project[] = this._projects;
  private _syncStatusSnapshot: SyncStatus = this._syncStatus;

  constructor(
    private service: SpeleoDBService,
    private prefs: PreferencesPort,
    private cache: ProjectCacheService,
  ) {
    this.restoreSession();
  }

  // ---- State accessors (snapshot-based for useSyncExternalStore) -------------

  get authState(): AuthState {
    return this._authStateSnapshot;
  }

  get isOnline(): boolean {
    return this._isOnlineSnapshot;
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
    this._projectsSnapshot = [...this._projects];
    this._syncStatusSnapshot = this._syncStatus;
    this._listeners.forEach((fn) => fn());
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
    if (navigator.onLine) {
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
   * Signup: stores locally and calls the API when online.
   */
  async signup(credentials: SignupCredentials): Promise<AuthResponse> {
    const { name, email, password, country } = credentials;

    if (!name) return { success: false, message: 'Name is required' };
    if (!this.validateEmail(email)) return { success: false, message: 'Invalid email address' };
    if (!password || password.length < 8) return { success: false, message: 'Password must be at least 8 characters' };
    if (!country) return { success: false, message: 'Country is required' };

    const localUsers = this.getLocalUsers();
    if (localUsers[email.toLowerCase()]) {
      return { success: false, message: 'An account with this email already exists' };
    }

    const user: User = { id: this.generateUserId(), email, name, country };

    if (navigator.onLine) {
      try {
        const prefs = this.prefs.getPreferences();
        const instanceUrl = prefs.instance ?? PREFERENCES.DEFAULT_INSTANCE;

        const response = await this.service.signup(instanceUrl, credentials);

        if (response.status === HTTP_STATUS.OK || response.status === HTTP_STATUS.CREATED) {
          this.saveLocalUser(email, password, response.data.user ? { ...user, ...response.data.user } : user);
          return {
            success: true,
            message: 'Account created! Please check your email to verify.',
            user: response.data.user ? { ...user, ...response.data.user } : user,
          };
        }

        return { success: false, message: response.data.message ?? 'Signup failed' };
      } catch (error) {
        console.warn('Online signup failed, creating locally...', error);
      }
    }

    // Offline: save locally and queue for sync
    this.saveLocalUser(email, password, user);
    this.addPendingSync({ type: 'signup', data: { name, email, password, country } });
    return { success: true, message: "Account created locally. It will sync when you're online.", user };
  }

  /**
   * Validates the stored token with the server.
   * - 2xx   -> 'ok'
   * - 4xx   -> 'unauthorized'
   * - error -> 'network_error'
   */
  async validateSession(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    const prefs = this.prefs.getPreferences();
    const token = prefs.token;
    const instance = prefs.instance?.trim();
    if (!token || !instance) return 'unauthorized';

    try {
      const response = await this.service.validateToken(instance, token);

      if (response.status >= 200 && response.status < 300) {
        this._isOnline = true;
        this.notify();
        return 'ok';
      }
      if (response.status >= 400 && response.status < 500) {
        return 'unauthorized';
      }
      return 'unauthorized';
    } catch {
      return 'network_error';
    }
  }

  /**
   * Logout: clear in-memory state and remove email/token from preferences (keep instance).
   */
  logout(): void {
    this._authState = { isAuthenticated: false, user: null, token: null };
    this._isOnline = false;
    this._projects = [];
    this._syncStatus = 'idle';
    this.prefs.setPreferences({ email: undefined, token: undefined });
    this.cache.clearAll();
    this.notify();
  }

  /**
   * Flush queued operations to the server (e.g. signup that happened offline).
   */
  async syncPending(): Promise<void> {
    if (!navigator.onLine) return;

    const prefs = this.prefs.getPreferences();
    const instanceUrl = prefs.instance ?? PREFERENCES.DEFAULT_INSTANCE;
    const pending = this.getPendingSync();
    const remaining: typeof pending = [];

    for (const item of pending) {
      try {
        if (item.type === 'signup') {
          const response = await this.service.signup(instanceUrl, item.data as SignupCredentials);
          if (response.status < 200 || response.status >= 300) {
            remaining.push(item);
          }
        }
      } catch {
        remaining.push(item);
      }
    }

    localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify(remaining));
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
    if (!navigator.onLine) {
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
        await this.cache.setProjects(freshProjects);
        this.notify();

        // Step 3 -- download geojson files in background (non-blocking)
        await this.downloadGeoJSONFiles(freshProjects);
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
   * Download geojson files for all eligible projects, skipping those whose
   * cached version already matches the latest commit.
   *
   * Uses a simple worker-pool to limit concurrency to 3 parallel downloads.
   */
  private async downloadGeoJSONFiles(projects: Project[]): Promise<void> {
    const eligible = projects.filter(
      (p) => p.geojson_file && !p.exclude_geojson,
    );
    if (eligible.length === 0) return;

    // Shared mutable queue consumed by the workers.
    const queue = [...eligible];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const project = queue.shift()!;
        try {
          const cachedCommit = await this.cache.getCachedCommitId(project.id);
          if (cachedCommit === project.latest_commit.id) continue; // already up to date

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

  private saveLocalUser(email: string, password: string, user: User): void {
    try {
      const users = this.getLocalUsers();
      users[email.toLowerCase()] = { password, user };
      localStorage.setItem(STORAGE_KEYS.USERS_DB, JSON.stringify(users));
    } catch (error) {
      console.error('Failed to save local user:', error);
    }
  }

  // ---- Pending sync queue ---------------------------------------------------

  private addPendingSync(item: { type: string; data: unknown }): void {
    try {
      const pending = this.getPendingSync();
      pending.push({ ...item, timestamp: Date.now() });
      localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify(pending));
    } catch (error) {
      console.error('Failed to add pending sync:', error);
    }
  }

  private getPendingSync(): Array<{ type: string; data: unknown; timestamp: number }> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PENDING_SYNC);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  // ---- ID generators --------------------------------------------------------

  private generateOfflineToken(): string {
    return 'offline_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private generateUserId(): string {
    return 'user_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}
