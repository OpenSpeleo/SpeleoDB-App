/**
 * Offline-first Authentication Service
 * Stores credentials locally and syncs when online
 */

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

interface LoginCredentials {
  email: string;
  password: string;
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

// Storage keys
const STORAGE_KEYS = {
  AUTH_STATE: 'speleo_auth_state',
  PENDING_SYNC: 'speleo_pending_sync',
  USERS_DB: 'speleo_users_db', // For offline demo/testing
};

// API base URL - configure for your backend
const API_BASE_URL = 'https://api.speleodb.org';

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
   * Load auth state from local storage
   */
  private loadAuthState(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.AUTH_STATE);
      if (stored) {
        this.authState = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load auth state:', error);
    }
  }

  /**
   * Save auth state to local storage
   */
  private saveAuthState(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTH_STATE, JSON.stringify(this.authState));
    } catch (error) {
      console.error('Failed to save auth state:', error);
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
   * Save user to local database
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

  /**
   * Check if online
   */
  private isOnline(): boolean {
    return navigator.onLine;
  }

  /**
   * Generate a simple token (for offline use)
   */
  private generateOfflineToken(): string {
    return 'offline_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  /**
   * Generate a simple user ID
   */
  private generateUserId(): string {
    return 'user_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  /**
   * Validate email format
   */
  validateEmail(email: string): boolean {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  }

  /**
   * Login - works offline by checking local storage
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const { email, password } = credentials;

    // Validate inputs
    if (!this.validateEmail(email)) {
      return { success: false, message: 'Invalid email address' };
    }

    if (!password) {
      return { success: false, message: 'Password is required' };
    }

    // Try online login first
    if (this.isOnline()) {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (response.ok) {
          const data = await response.json();
          this.authState = {
            isAuthenticated: true,
            user: data.user,
            token: data.token,
          };
          this.saveAuthState();
          // Also save locally for offline access
          this.saveLocalUser(email, password, data.user);
          return { success: true, message: 'Login successful', user: data.user, token: data.token };
        } else {
          const error = await response.json();
          return { success: false, message: error.message || 'Login failed' };
        }
      } catch (error) {
        console.log('Online login failed, trying offline...', error);
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
      this.saveAuthState();
      return { success: true, message: 'Login successful (offline)', user: localUser.user, token };
    }

    return { success: false, message: 'Invalid email or password' };
  }

  /**
   * Signup - stores locally and syncs when online
   */
  async signup(credentials: SignupCredentials): Promise<AuthResponse> {
    const { name, email, password, country } = credentials;

    // Validate inputs
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

    // Check if user already exists locally
    const localUsers = this.getLocalUsers();
    if (localUsers[email.toLowerCase()]) {
      return { success: false, message: 'An account with this email already exists' };
    }

    // Create user object
    const user: User = {
      id: this.generateUserId(),
      email,
      name,
      country,
    };

    // Try online signup first
    if (this.isOnline()) {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, country }),
        });

        if (response.ok) {
          const data = await response.json();
          // Save locally
          this.saveLocalUser(email, password, data.user || user);
          return { success: true, message: 'Account created! Please check your email to verify.', user: data.user };
        } else {
          const error = await response.json();
          return { success: false, message: error.message || 'Signup failed' };
        }
      } catch (error) {
        console.log('Online signup failed, creating locally...', error);
      }
    }

    // Offline signup - store locally and mark for sync
    this.saveLocalUser(email, password, user);
    this.addPendingSync({ type: 'signup', data: { name, email, password, country } });

    return { 
      success: true, 
      message: 'Account created locally. It will sync when you\'re online.',
      user 
    };
  }

  /**
   * Add item to pending sync queue
   */
  private addPendingSync(item: { type: string; data: unknown }): void {
    try {
      const pending = this.getPendingSync();
      pending.push({ ...item, timestamp: Date.now() });
      localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, JSON.stringify(pending));
    } catch (error) {
      console.error('Failed to add pending sync:', error);
    }
  }

  /**
   * Get pending sync items
   */
  private getPendingSync(): Array<{ type: string; data: unknown; timestamp: number }> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PENDING_SYNC);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * Sync pending items when online
   */
  async syncPending(): Promise<void> {
    if (!this.isOnline()) return;

    const pending = this.getPendingSync();
    const remaining: typeof pending = [];

    for (const item of pending) {
      try {
        if (item.type === 'signup') {
          const response = await fetch(`${API_BASE_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
   * Logout
   */
  logout(): void {
    this.authState = {
      isAuthenticated: false,
      user: null,
      token: null,
    };
    this.saveAuthState();
  }

  /**
   * Get current auth state
   */
  getAuthState(): AuthState {
    return { ...this.authState };
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  /**
   * Get current user
   */
  getCurrentUser(): User | null {
    return this.authState.user;
  }
}

// Export singleton instance
export const authService = new AuthService();
export type { User, AuthState, LoginCredentials, SignupCredentials, AuthResponse };
