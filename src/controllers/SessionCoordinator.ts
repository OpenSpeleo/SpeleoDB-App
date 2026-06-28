import { NETWORK } from '../constants';
import type { HttpResponse } from '../services/HttpClient';
import type { ServiceRequestOptions } from '../services/SpeleoDBService';
import type { SessionStore } from '../services/SecureSessionStore';
import type {
  AuthResponse,
  AuthState,
  AuthTokenResponse,
  LoginCredentials,
  OAuthTokenCredentials,
  User,
} from '../types';
import { isAbortError } from '../utils/abort';
import { CancellationContext } from './CancellationContext';

export type SessionValidationResult = 'ok' | 'unauthorized' | 'network_error';

export interface SessionTransport {
  authenticate(
    instance: string,
    email: string,
    password: string,
  ): Promise<HttpResponse<AuthTokenResponse | unknown>>;
  validateToken(
    instance: string,
    token: string,
    options?: ServiceRequestOptions,
  ): Promise<HttpResponse<unknown>>;
}

export interface SessionCoordinatorHooks {
  notifyStateChanged(): void;
  invalidateApplicationOperations(): void;
  purgeLocalUserData(): Promise<void>;
  startReconnectSync(): void;
  setOfflineRuntime(locked: boolean): void;
}

export interface SessionCoordinatorDependencies {
  transport: SessionTransport;
  sessionStore: SessionStore;
  hooks: SessionCoordinatorHooks;
}

const EMPTY_AUTH_STATE: AuthState = {
  isAuthenticated: false,
  user: null,
  token: null,
};

const OFFLINE_LOGIN_REQUIRES_SESSION_MESSAGE =
  'Unable to reach SpeleoDB. Offline access requires a previously validated session.';

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

function hasAuthTokenResponse(data: unknown): data is AuthTokenResponse {
  if (!data || typeof data !== 'object') return false;
  const token = (data as { token?: unknown }).token;
  return typeof token === 'string' && token.trim().length > 0;
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

/**
 * Owns authenticated-session and online/offline state transitions.
 *
 * The controller remains the public façade and injects lifecycle hooks for
 * destructive purge and project sync. Keeping those effects outside this
 * module prevents session policy from depending on GPS, tiles, or map state.
 */
export class SessionCoordinator {
  private _authState: AuthState = EMPTY_AUTH_STATE;
  private _isOnline = false;
  private _isOfflineLocked = false;
  private validationGeneration = 0;
  private nextValidationRunId = 1;
  private activeValidationContext: CancellationContext | null = null;

  constructor(private readonly dependencies: SessionCoordinatorDependencies) {
    this.restoreSession();
    this.dependencies.hooks.setOfflineRuntime(false);
  }

  get authState(): AuthState {
    return this._authState;
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  get isOfflineLocked(): boolean {
    return this._isOfflineLocked;
  }

  get currentUser(): User | null {
    return this._authState.user;
  }

  get isAuthenticated(): boolean {
    return this._authState.isAuthenticated;
  }

  get hasNetworkAccess(): boolean {
    return !this._isOfflineLocked;
  }

  validateEmail(email: string): boolean {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  }

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
    if (!this.hasNetworkAccess) {
      return { success: false, message: OFFLINE_LOGIN_REQUIRES_SESSION_MESSAGE };
    }

    try {
      const response = await this.dependencies.transport.authenticate(instance, email, password);
      if (isSuccessfulStatus(response.status) && hasAuthTokenResponse(response.data)) {
        const authToken = response.data.token.trim();
        const userEmail = typeof response.data.user === 'string' && response.data.user.trim()
          ? response.data.user
          : email;
        try {
          const user = await this.establishAuthenticatedSession(authToken, instance, userEmail);
          return {
            success: true,
            message: 'Login successful',
            user,
            token: authToken,
          };
        } catch {
          return {
            success: false,
            message: 'Login succeeded, but the secure session could not be saved.',
          };
        }
      }

      const message = extractAuthErrorMessage(response.data)
        ?? (response.status === 401 ? 'Invalid email or password' : 'Login failed');
      return { success: false, message };
    } catch {
      return { success: false, message: OFFLINE_LOGIN_REQUIRES_SESSION_MESSAGE };
    }
  }

  async loginWithToken(credentials: OAuthTokenCredentials): Promise<AuthResponse> {
    const token = credentials.token?.trim();
    const instance = credentials.instance?.trim();

    if (!token) return { success: false, message: 'OAuth token is required' };
    if (!instance) return { success: false, message: 'SpeleoDB instance URL is required' };

    try {
      const response = await this.dependencies.transport.validateToken(instance, token);
      if (isSuccessfulStatus(response.status)) {
        try {
          await this.establishAuthenticatedSession(token, instance);
          return { success: true, message: 'Login successful', token };
        } catch {
          return {
            success: false,
            message: 'Login succeeded, but the secure session could not be saved.',
          };
        }
      }
      if (isClientErrorStatus(response.status)) {
        return {
          success: false,
          message: extractAuthErrorMessage(response.data) ?? 'Invalid OAuth token',
        };
      }
      return {
        success: false,
        message: extractAuthErrorMessage(response.data)
          ?? 'Unable to validate OAuth token. Please try again.',
      };
    } catch {
      return {
        success: false,
        message: 'Unable to validate OAuth token. Check your connection and try again.',
      };
    }
  }

  async validateSession(): Promise<SessionValidationResult> {
    if (this._isOfflineLocked) return 'network_error';
    return this.validateSessionAgainstServer();
  }

  async attemptReconnect(): Promise<SessionValidationResult> {
    const result = await this.validateSessionAgainstServer();
    if (result === 'ok') this.dependencies.hooks.startReconnectSync();
    return result;
  }

  async logout(): Promise<void> {
    await this.dependencies.hooks.purgeLocalUserData();
  }

  /** Abort startup validation when login, logout, or a wider app reset wins. */
  invalidate(): void {
    this.validationGeneration += 1;
    this.activeValidationContext?.abort('Async operations invalidated');
  }

  /** Reset session state during the controller's all-data purge. */
  reset(notify = false): void {
    this._authState = EMPTY_AUTH_STATE;
    this.setConnectivity(false, false, notify);
  }

  /** Publish an online result from a successful authenticated data request. */
  markOnline(notify = true): void {
    this.setConnectivity(true, false, notify);
  }

  /** Enter request-driven offline mode without destroying the local session. */
  enterOfflineMode(): void {
    if (this._isOfflineLocked) return;
    this.setConnectivity(false, true, true);
  }

  private async validateSessionAgainstServer(): Promise<SessionValidationResult> {
    const generation = this.validationGeneration;
    const context = this.beginValidationContext();
    const session = this.dependencies.sessionStore.getSession();
    if (!session) {
      this.finishValidation(context);
      return 'unauthorized';
    }

    try {
      const response = await this.dependencies.transport.validateToken(
        session.instance,
        session.token,
        {
          timeoutMs: NETWORK.STARTUP_AUTH_TIMEOUT_MS,
          signal: context.signal,
        },
      );
      context.throwIfAborted();

      if (isSuccessfulStatus(response.status)) {
        this.markOnline();
        return 'ok';
      }
      if (isClientErrorStatus(response.status)) {
        await this.logout();
        return 'unauthorized';
      }
      this.setConnectivity(false, true, true);
      return 'network_error';
    } catch (error) {
      if (isAbortError(error) || !this.isValidationCurrent(context, generation)) {
        return this.staleSessionResult();
      }
      this.setConnectivity(false, true, true);
      return 'network_error';
    } finally {
      this.finishValidation(context);
    }
  }

  private async establishAuthenticatedSession(
    token: string,
    instance: string,
    email: string,
  ): Promise<User>;
  private async establishAuthenticatedSession(
    token: string,
    instance: string,
    email?: undefined,
  ): Promise<null>;
  private async establishAuthenticatedSession(
    token: string,
    instance: string,
    email?: string,
  ): Promise<User | null> {
    const normalizedToken = token.trim();
    const normalizedEmail = email?.trim() ?? '';
    const user: User | null = normalizedEmail
      ? { id: 'auth', email: normalizedEmail, name: normalizedEmail }
      : null;

    await this.dependencies.sessionStore.establish({
      email: normalizedEmail || undefined,
      token: normalizedToken,
      instance: instance.trim(),
    });
    this.dependencies.hooks.invalidateApplicationOperations();
    this._authState = { isAuthenticated: true, user, token: normalizedToken };
    this.setConnectivity(true, false, true);
    return user;
  }

  private restoreSession(): void {
    try {
      const session = this.dependencies.sessionStore.getSession();
      if (!session) return;
      const email = session.email?.trim() ?? '';
      this._authState = {
        isAuthenticated: true,
        user: email ? { id: 'restored', email, name: email } : null,
        token: session.token,
      };
    } catch (error) {
      console.error('Failed to load auth state:', error);
    }
  }

  private setConnectivity(isOnline: boolean, offlineLocked: boolean, notify: boolean): void {
    this._isOnline = isOnline;
    this._isOfflineLocked = offlineLocked;
    this.dependencies.hooks.setOfflineRuntime(offlineLocked);
    if (notify) this.dependencies.hooks.notifyStateChanged();
  }

  private beginValidationContext(): CancellationContext {
    this.activeValidationContext?.abort('Session validation superseded');
    const context = new CancellationContext(this.nextValidationRunId, 'Session validation');
    this.nextValidationRunId += 1;
    this.activeValidationContext = context;
    return context;
  }

  private isValidationCurrent(context: CancellationContext, generation: number): boolean {
    return this.activeValidationContext === context && generation === this.validationGeneration;
  }

  private finishValidation(context: CancellationContext): void {
    if (this.activeValidationContext === context) this.activeValidationContext = null;
  }

  private staleSessionResult(): Exclude<SessionValidationResult, 'network_error'> {
    return this._authState.isAuthenticated ? 'ok' : 'unauthorized';
  }
}
