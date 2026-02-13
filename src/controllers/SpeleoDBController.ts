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
import type {
  AuthResponse,
  AuthState,
  LoginCredentials,
  SignupCredentials,
  User,
} from '../types';

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
  private _listeners = new Set<() => void>();

  // Snapshot references for useSyncExternalStore (identity-stable between notifies)
  private _authStateSnapshot: AuthState = this._authState;
  private _isOnlineSnapshot: boolean = this._isOnline;

  constructor(
    private service: SpeleoDBService,
    private prefs: PreferencesPort,
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
    this.prefs.setPreferences({ email: undefined, token: undefined });
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
