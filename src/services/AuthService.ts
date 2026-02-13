/**
 * Offline-first Authentication Service
 * Uses POST /api/v1/user/auth-token/; on native (iOS/Android) uses CapacitorHttp to avoid CORS; on web uses fetch + FormData.
 * See docs/AUTH-CORS-ANALYSIS.md for why CORS appears and when native HTTP is used.
 */

import { Capacitor } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';
import { API, HEADERS, HTTP_STATUS, NETWORK, PREFERENCES } from '../constants';

/** True only when running inside the native app (Xcode/Android Studio), so we must use CapacitorHttp to avoid CORS. */
function useNativeHttp(): boolean {
  try {
    return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}
import {
  getPreferences,
  setPreferences,
  clearPreferences,
  type UserPreferences,
} from './PreferencesService';

interface User {
  id: string;
  email: string;
  name: string;
  country?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  instance: string;
}

interface SignupCredentials {
  name: string;
  email: string;
  password: string;
  country: string;
}

interface AuthResponse {
  success: boolean;
  message: string;
  user?: User;
  token?: string;
}

interface AuthTokenResponse {
  user: string;
  token: string;
}

// Legacy storage keys (for offline users DB and pending sync only)
const STORAGE_KEYS = {
  PENDING_SYNC: 'speleo_pending_sync',
  USERS_DB: 'speleo_users_db',
} as const;

/**
 * Normalizes instance to a comparable base (trim, default https, no trailing slash).
 */
function normalizeInstanceBase(instance: string): string {
  const base = instance.trim();
  const withScheme =
    base.startsWith('http://') || base.startsWith('https://')
      ? base
      : `https://${base}`;
  return withScheme.replace(/\/+$/, '');
}

/**
 * Builds auth-token request URL from the given instance base.
 */
export function buildAuthTokenUrl(instance: string): string {
  const base = normalizeInstanceBase(instance);
  return base + API.AUTH_TOKEN_ENDPOINT;
}

class AuthService {
  private authState: AuthState = {
    isAuthenticated: false,
    user: null,
    token: null,
  };

  constructor() {
    this.loadAuthState();
  }

  /**
   * Load auth state from PreferencesService at startup.
   */
  private loadAuthState(): void {
    try {
      const prefs = getPreferences();
      if (prefs.token && prefs.instance) {
        const email = prefs.email ?? '';
        this.authState = {
          isAuthenticated: true,
          user: {
            id: 'restored',
            email,
            name: email,
          },
          token: prefs.token,
        };
      }
    } catch (error) {
      console.error('Failed to load auth state:', error);
    }
  }

  /**
   * Get local users database (for offline functionality)
   */
  private getLocalUsers(): Record<string, { password: string; user: User }> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.USERS_DB);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  /**
   * Save user to local database (offline use)
   */
  private saveLocalUser(email: string, password: string, user: User): void {
    try {
      const users = this.getLocalUsers();
      users[email.toLowerCase()] = { password, user };
      localStorage.setItem(STORAGE_KEYS.USERS_DB, JSON.stringify(users));
    } catch (error) {
      console.error('Failed to save local user:', error);
    }
  }

  private isOnline(): boolean {
    return navigator.onLine;
  }

  private generateOfflineToken(): string {
    return 'offline_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private generateUserId(): string {
    return 'user_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  validateEmail(email: string): boolean {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  }

  /** Handle CapacitorHttp response (native iOS/Android). */
  private handleAuthTokenResponse(
    response: { status: number; data: unknown },
    email: string,
    instance: string
  ): AuthResponse {
    if (response.status === HTTP_STATUS.OK) {
      const data = response.data as AuthTokenResponse;
      const userEmail = data.user ?? email;
      const user: User = {
        id: 'auth',
        email: userEmail,
        name: userEmail,
      };
      this.authState = { isAuthenticated: true, user, token: data.token };
      setPreferences({ email: userEmail, token: data.token, instance: instance.trim() });
      return { success: true, message: 'Login successful', user, token: data.token };
    }
    const body = response.data as { detail?: string; message?: string } | undefined;
    const message =
      body?.detail ?? body?.message ?? (response.status === HTTP_STATUS.UNAUTHORIZED ? 'Invalid email or password' : 'Login failed');
    return { success: false, message };
  }

  /** Handle fetch Response (web). */
  private async handleAuthTokenFetchResponse(
    response: Response,
    email: string,
    instance: string
  ): Promise<AuthResponse> {
    if (response.status === HTTP_STATUS.OK) {
      const data = (await response.json()) as AuthTokenResponse;
      const userEmail = data.user ?? email;
      const user: User = { id: 'auth', email: userEmail, name: userEmail };
      this.authState = { isAuthenticated: true, user, token: data.token };
      setPreferences({ email: userEmail, token: data.token, instance: instance.trim() });
      return { success: true, message: 'Login successful', user, token: data.token };
    }
    const errorBody = await response.json().catch(() => ({}));
    const message =
      (errorBody as { detail?: string }).detail ??
      (errorBody as { message?: string }).message ??
      (response.status === HTTP_STATUS.UNAUTHORIZED ? 'Invalid email or password' : 'Login failed');
    return { success: false, message };
  }

  /**
   * Login: POST auth-token. On native uses CapacitorHttp (JSON); on web uses fetch (FormData).
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

    // Online: use native HTTP on iOS/Android (avoids CORS); use fetch on web.
    if (this.isOnline()) {
      const url = buildAuthTokenUrl(instance);
      const isNative = useNativeHttp();
      const platform = typeof Capacitor !== 'undefined' ? Capacitor.getPlatform?.() ?? 'unknown' : 'unknown';
      if (typeof console !== 'undefined' && console.log) {
        console.log(`SpeleoDB auth: platform=${platform}, transport=${isNative ? 'native' : 'fetch'}`);
      }

      if (isNative) {
        try {
          const response = await CapacitorHttp.request({
            url,
            method: 'POST',
            headers: { [HEADERS.CONTENT_TYPE]: HEADERS.APPLICATION_JSON_UTF8 },
            data: { email, password },
            connectTimeout: NETWORK.REQUEST_TIMEOUT_MS,
            readTimeout: NETWORK.REQUEST_TIMEOUT_MS,
          });
          return this.handleAuthTokenResponse(response, email, instance);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn('SpeleoDB native auth request failed:', error);
          return {
            success: false,
            message: `Login failed: ${msg}. Ensure the app was built with "npx cap sync" and run from Xcode/Android Studio.`,
          };
        }
      }

      try {
        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', password);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NETWORK.REQUEST_TIMEOUT_MS);

        const response = await fetch(url, {
          method: 'POST',
          body: formData,
          redirect: 'follow',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return this.handleAuthTokenFetchResponse(response, email, instance);
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return { success: false, message: 'Request timed out' };
        }
        console.warn('Online login failed, trying offline...', error);
      }
    }

    // Offline login - check local users
    const localUsers = this.getLocalUsers();
    const localUser = localUsers[email.toLowerCase()];

    if (localUser && localUser.password === password) {
      const token = this.generateOfflineToken();
      this.authState = {
        isAuthenticated: true,
        user: localUser.user,
        token,
      };
      setPreferences({
        email: localUser.user.email,
        token,
        instance: instance.trim() || getPreferences().instance,
      });
      return {
        success: true,
        message: 'Login successful (offline)',
        user: localUser.user,
        token,
      };
    }

    return { success: false, message: 'Invalid email or password' };
  }

  /**
   * Signup - stores locally and syncs when online. Uses instance from preferences.
   */
  async signup(credentials: SignupCredentials): Promise<AuthResponse> {
    const { name, email, password, country } = credentials;

    if (!name) {
      return { success: false, message: 'Name is required' };
    }

    if (!this.validateEmail(email)) {
      return { success: false, message: 'Invalid email address' };
    }

    if (!password || password.length < 8) {
      return { success: false, message: 'Password must be at least 8 characters' };
    }

    if (!country) {
      return { success: false, message: 'Country is required' };
    }

    const localUsers = this.getLocalUsers();
    if (localUsers[email.toLowerCase()]) {
      return { success: false, message: 'An account with this email already exists' };
    }

    const user: User = {
      id: this.generateUserId(),
      email,
      name,
      country,
    };

    if (this.isOnline()) {
      try {
        const prefs = getPreferences();
        const base = (prefs.instance ?? PREFERENCES.DEFAULT_INSTANCE).trim();
        const withScheme =
          base.startsWith('http://') || base.startsWith('https://')
            ? base
            : `https://${base}`;
        const baseUrl = withScheme.replace(/\/+$/, '');
        const signupUrl = `${baseUrl}${API.BASE_PATH}/auth/signup`;

        const response = await fetch(signupUrl, {
          method: 'POST',
          headers: {
            [HEADERS.CONTENT_TYPE]: HEADERS.APPLICATION_JSON,
          },
          body: JSON.stringify({ name, email, password, country }),
        });

        if (response.status === HTTP_STATUS.OK || response.status === HTTP_STATUS.CREATED) {
          const data = await response.json();
          this.saveLocalUser(email, password, data.user || user);
          return {
            success: true,
            message: 'Account created! Please check your email to verify.',
            user: data.user,
          };
        }

        const error = await response.json();
        return { success: false, message: (error as { message?: string }).message ?? 'Signup failed' };
      } catch (error) {
        console.warn('Online signup failed, creating locally...', error);
      }
    }

    this.saveLocalUser(email, password, user);
    this.addPendingSync({ type: 'signup', data: { name, email, password, country } });

    return {
      success: true,
      message: "Account created locally. It will sync when you're online.",
      user,
    };
  }

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

  async syncPending(): Promise<void> {
    if (!this.isOnline()) return;

    const prefs = getPreferences();
    const base = (prefs.instance ?? PREFERENCES.DEFAULT_INSTANCE).trim();
    const withScheme =
      base.startsWith('http://') || base.startsWith('https://') ? base : `https://${base}`;
    const baseUrl = withScheme.replace(/\/+$/, '');
    const signupUrl = `${baseUrl}${API.BASE_PATH}/auth/signup`;

    const pending = this.getPendingSync();
    const remaining: typeof pending = [];

    for (const item of pending) {
      try {
        if (item.type === 'signup') {
          const response = await fetch(signupUrl, {
            method: 'POST',
            headers: { [HEADERS.CONTENT_TYPE]: HEADERS.APPLICATION_JSON },
            body: JSON.stringify(item.data),
          });
          if (!response.ok) {
            remaining.push(item);
          }
        }
      } catch {
        remaining.push(item);
      }
    }

    localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify(remaining));
  }

  /**
   * Validates the stored token with the server. Call after app open when user has credentials.
   * - 2xx → 'ok' (app is online)
   * - 4xx (e.g. 401) → 'unauthorized' (clear prefs and go to home)
   * - Network error → 'network_error' (show offline modal, app is offline)
   */
  async validateStoredToken(): Promise<'ok' | 'unauthorized' | 'network_error'> {
    const prefs = getPreferences();
    const token = prefs.token;
    const instance = prefs.instance?.trim();
    if (!token || !instance) {
      return 'unauthorized';
    }

    const url = buildAuthTokenUrl(instance);
    const headers = { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` };

    try {
      if (useNativeHttp()) {
        const response = await CapacitorHttp.request({
          url,
          method: 'GET',
          headers,
          connectTimeout: NETWORK.REQUEST_TIMEOUT_MS,
          readTimeout: NETWORK.REQUEST_TIMEOUT_MS,
        });
        if (response.status >= 200 && response.status < 300) return 'ok';
        if (response.status >= 400 && response.status < 500) return 'unauthorized';
        return 'unauthorized';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), NETWORK.REQUEST_TIMEOUT_MS);
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status >= 200 && response.status < 300) return 'ok';
      if (response.status >= 400 && response.status < 500) return 'unauthorized';
      return 'unauthorized';
    } catch {
      return 'network_error';
    }
  }

  /**
   * Logout: clear in-memory state and remove email/token from preferences (keep instance).
   */
  logout(): void {
    this.authState = {
      isAuthenticated: false,
      user: null,
      token: null,
    };
    setPreferences({ email: undefined, token: undefined });
  }

  getAuthState(): AuthState {
    return { ...this.authState };
  }

  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  getCurrentUser(): User | null {
    return this.authState.user;
  }
}

export const authService = new AuthService();
export type { User, AuthState, SignupCredentials, AuthResponse };
