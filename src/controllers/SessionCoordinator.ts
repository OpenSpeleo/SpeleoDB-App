import { NETWORK } from '../constants';
import type { HttpResponse } from '../services/HttpClient';
import type { ServiceRequestOptions } from '../services/SpeleoDBService';
import type { SessionStore, StoredSession } from '../services/SecureSessionStore';
import type {
  AuthResponse,
  AuthState,
  AuthTokenResponse,
  LoginCredentials,
  OAuthTokenCredentials,
  User,
} from '../types';
import { isAbortError } from '../utils/abort';
import { getInstanceBaseUrl } from '../utils/instanceUrl';
import { CancellationContext } from './CancellationContext';

export type SessionValidationResult = 'ok' | 'unauthorized' | 'network_error';

interface SessionValidationOutcome {
  result: SessionValidationResult;
  authoritative: boolean;
}

export interface SessionTransport {
  authenticate(
    instance: string,
    email: string,
    password: string,
    options?: ServiceRequestOptions,
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
const SUPERSEDED_AUTHENTICATION_MESSAGE = 'Authentication attempt was superseded.';
const LOGOUT_IN_PROGRESS_MESSAGE = 'Sign out is in progress. Please try again.';
const INVALID_INSTANCE_MESSAGE = 'Enter a valid SpeleoDB instance origin URL.';
const SESSION_SETUP_FAILED_MESSAGE =
  'Login succeeded, but the session could not be established safely.';

function normalizeInstance(instance: string): string | null {
  try {
    return getInstanceBaseUrl(instance);
  } catch {
    return null;
  }
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

function isAuthorizationDeniedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function hasAuthTokenResponse(data: unknown): data is AuthTokenResponse {
  if (!data || typeof data !== 'object') return false;
  const token = (data as { token?: unknown }).token;
  return typeof token === 'string' && token.trim().length > 0;
}

function normalizeStoredSession(session: StoredSession): StoredSession | null {
  const token = session.token.trim();
  const instance = normalizeInstance(session.instance);
  if (!token || !instance) return null;
  const email = session.email?.trim();
  return { token, instance, ...(email ? { email } : {}) };
}

function sessionsMatch(left: StoredSession, right: StoredSession): boolean {
  return left.token === right.token
    && left.instance === right.instance
    && left.email === right.email;
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
  private nextAuthenticationRunId = 1;
  private activeAuthenticationContext: CancellationContext | null = null;
  private readonly authenticationOperations = new Set<Promise<AuthResponse>>();
  private sessionMutationTail: Promise<void> = Promise.resolve();
  private isLoggingOut = false;
  private logoutPromise: Promise<void> | null = null;
  private reconnectPromise: Promise<SessionValidationResult> | null = null;

  constructor(private readonly dependencies: SessionCoordinatorDependencies) {
    this.restoreSession();
    this.setConnectivity(false, false, false);
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
    const normalizedInstance = normalizeInstance(instance);
    if (!normalizedInstance) {
      return { success: false, message: INVALID_INSTANCE_MESSAGE };
    }
    if (!this.hasNetworkAccess) {
      return { success: false, message: OFFLINE_LOGIN_REQUIRES_SESSION_MESSAGE };
    }
    if (this.isLoggingOut) {
      return { success: false, message: LOGOUT_IN_PROGRESS_MESSAGE };
    }

    return this.runAuthentication((context) => this.loginWithPassword(
      { ...credentials, instance: normalizedInstance },
      context,
    ));
  }

  private async loginWithPassword(
    credentials: LoginCredentials,
    context: CancellationContext,
  ): Promise<AuthResponse> {
    const { email, password, instance } = credentials;
    try {
      context.throwIfAborted();
      const response = await this.dependencies.transport.authenticate(instance, email, password, {
        signal: context.signal,
      });
      context.throwIfAborted();
      if (isSuccessfulStatus(response.status) && hasAuthTokenResponse(response.data)) {
        const authToken = response.data.token.trim();
        const userEmail = typeof response.data.user === 'string' && response.data.user.trim()
          ? response.data.user
          : email;
        try {
          const user = await this.establishAuthenticatedSession(
            authToken,
            instance,
            context,
            userEmail,
          );
          return {
            success: true,
            message: 'Login successful',
            user,
            token: authToken,
          };
        } catch (error) {
          if (isAbortError(error)) {
            return { success: false, message: SUPERSEDED_AUTHENTICATION_MESSAGE };
          }
          return {
            success: false,
            message: SESSION_SETUP_FAILED_MESSAGE,
          };
        }
      }

      const message = response.status === 401 ? 'Invalid email or password' : 'Login failed';
      return { success: false, message };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, message: SUPERSEDED_AUTHENTICATION_MESSAGE };
      }
      return { success: false, message: OFFLINE_LOGIN_REQUIRES_SESSION_MESSAGE };
    }
  }

  async loginWithToken(credentials: OAuthTokenCredentials): Promise<AuthResponse> {
    const token = credentials.token?.trim();
    const instance = credentials.instance?.trim();

    if (!token) return { success: false, message: 'OAuth token is required' };
    if (!instance) return { success: false, message: 'SpeleoDB instance URL is required' };
    const normalizedInstance = normalizeInstance(instance);
    if (!normalizedInstance) {
      return { success: false, message: INVALID_INSTANCE_MESSAGE };
    }
    if (this.isLoggingOut) {
      return { success: false, message: LOGOUT_IN_PROGRESS_MESSAGE };
    }

    return this.runAuthentication((context) => this.loginWithOAuthToken(
      token,
      normalizedInstance,
      context,
    ));
  }

  private async loginWithOAuthToken(
    token: string,
    instance: string,
    context: CancellationContext,
  ): Promise<AuthResponse> {
    try {
      context.throwIfAborted();
      const response = await this.dependencies.transport.validateToken(instance, token, {
        signal: context.signal,
      });
      context.throwIfAborted();
      if (isSuccessfulStatus(response.status)) {
        try {
          await this.establishAuthenticatedSession(token, instance, context);
          return { success: true, message: 'Login successful', token };
        } catch (error) {
          if (isAbortError(error)) {
            return { success: false, message: SUPERSEDED_AUTHENTICATION_MESSAGE };
          }
          return {
            success: false,
            message: SESSION_SETUP_FAILED_MESSAGE,
          };
        }
      }
      if (isClientErrorStatus(response.status)) {
        return {
          success: false,
          message: 'Invalid OAuth token',
        };
      }
      return {
        success: false,
        message: 'Unable to validate OAuth token. Please try again.',
      };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, message: SUPERSEDED_AUTHENTICATION_MESSAGE };
      }
      return {
        success: false,
        message: 'Unable to validate OAuth token. Check your connection and try again.',
      };
    }
  }

  async validateSession(): Promise<SessionValidationResult> {
    if (this.isLoggingOut) return 'unauthorized';
    if (this._isOfflineLocked) return 'network_error';
    return (await this.validateSessionAgainstServer()).result;
  }

  attemptReconnect(): Promise<SessionValidationResult> {
    if (this.isLoggingOut) return Promise.resolve('unauthorized');
    if (this.reconnectPromise) return this.reconnectPromise;

    const operation = (async () => {
      const outcome = await this.validateSessionAgainstServer();
      if (outcome.authoritative && outcome.result === 'ok') {
        try {
          this.dependencies.hooks.startReconnectSync();
        } catch {
          // Reconnect is already authoritative; follow-up sync is best-effort.
        }
      }
      return outcome.result;
    })();
    const trackedOperation = operation.finally(() => {
      this.reconnectPromise = null;
    });
    this.reconnectPromise = trackedOperation;
    return trackedOperation;
  }

  async logout(): Promise<void> {
    if (this.logoutPromise) return this.logoutPromise;

    this.isLoggingOut = true;
    this.invalidate();
    this.activeAuthenticationContext?.abort('Logout superseded authentication');
    this.dependencies.hooks.invalidateApplicationOperations();
    this.reset(true);
    const pendingAuthentication = [...this.authenticationOperations];
    const operation = (async () => {
      await Promise.allSettled(pendingAuthentication);
      await this.dependencies.hooks.purgeLocalUserData();
    })();
    this.logoutPromise = operation.finally(() => {
      this.isLoggingOut = false;
      this.logoutPromise = null;
    });
    return this.logoutPromise;
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

  private async validateSessionAgainstServer(): Promise<SessionValidationOutcome> {
    const generation = this.validationGeneration;
    const context = this.beginValidationContext();
    let session: StoredSession | null;
    try {
      session = this.dependencies.sessionStore.getSession();
    } catch {
      try {
        await this.logout();
      } catch {
        // Authentication is already revoked in memory. The controller purge
        // performs best-effort cleanup before reporting its storage failure.
      }
      this.finishValidation(context);
      return { result: 'unauthorized', authoritative: true };
    }
    if (!session) {
      this.finishValidation(context);
      return { result: 'unauthorized', authoritative: true };
    }

    const normalizedSession = normalizeStoredSession(session);
    if (!normalizedSession) {
      return this.rejectMalformedStoredSession(context);
    }
    let sessionMigrationPending = !sessionsMatch(session, normalizedSession);

    try {
      if (sessionMigrationPending) {
        await this.serializeSessionMutation(() => this.dependencies.sessionStore.establish(
          normalizedSession,
          { signal: context.signal },
        ));
        context.throwIfAborted();
        sessionMigrationPending = false;
      }
      const response = await this.dependencies.transport.validateToken(
        normalizedSession.instance,
        normalizedSession.token,
        {
          timeoutMs: NETWORK.STARTUP_AUTH_TIMEOUT_MS,
          signal: context.signal,
        },
      );
      context.throwIfAborted();

      if (isSuccessfulStatus(response.status)) {
        this.markOnline();
        return { result: 'ok', authoritative: true };
      }
      if (isAuthorizationDeniedStatus(response.status)) {
        await this.logout();
        return { result: 'unauthorized', authoritative: true };
      }
      this.setConnectivity(false, true, true);
      return { result: 'network_error', authoritative: true };
    } catch (error) {
      if (isAbortError(error) || !this.isValidationCurrent(context, generation)) {
        return { result: this.staleSessionResult(), authoritative: false };
      }
      if (sessionMigrationPending) {
        return this.rejectMalformedStoredSession(context);
      }
      this.setConnectivity(false, true, true);
      return { result: 'network_error', authoritative: true };
    } finally {
      this.finishValidation(context);
    }
  }

  private async establishAuthenticatedSession(
    token: string,
    instance: string,
    context: CancellationContext,
    email: string,
  ): Promise<User>;
  private async establishAuthenticatedSession(
    token: string,
    instance: string,
    context: CancellationContext,
    email?: undefined,
  ): Promise<null>;
  private async establishAuthenticatedSession(
    token: string,
    instance: string,
    context: CancellationContext,
    email?: string,
  ): Promise<User | null> {
    const normalizedToken = token.trim();
    const normalizedEmail = email?.trim() ?? '';
    const user: User | null = normalizedEmail
      ? { id: 'auth', email: normalizedEmail, name: normalizedEmail }
      : null;

    context.throwIfAborted();
    this.dependencies.hooks.invalidateApplicationOperations();
    context.throwIfAborted();
    await this.serializeSessionMutation(() => this.dependencies.sessionStore.establish(
      {
        email: normalizedEmail || undefined,
        token: normalizedToken,
        instance: instance.trim(),
      },
      { signal: context.signal },
    ));
    context.throwIfAborted();
    this._authState = { isAuthenticated: true, user, token: normalizedToken };
    this.setConnectivity(true, false, true);
    return user;
  }

  private restoreSession(): void {
    try {
      const session = this.dependencies.sessionStore.getSession();
      if (!session) return;
      const normalizedSession = normalizeStoredSession(session);
      if (!normalizedSession) return;
      const email = normalizedSession.email ?? '';
      this._authState = {
        isAuthenticated: true,
        user: email ? { id: 'restored', email, name: email } : null,
        token: normalizedSession.token,
      };
    } catch {
      console.error('Failed to load auth state.');
    }
  }

  private setConnectivity(isOnline: boolean, offlineLocked: boolean, notify: boolean): void {
    this._isOnline = isOnline;
    this._isOfflineLocked = offlineLocked;
    try {
      this.dependencies.hooks.setOfflineRuntime(offlineLocked);
    } catch {
      // Runtime adapters observe connectivity; they do not own it.
    }
    if (notify) {
      try {
        this.dependencies.hooks.notifyStateChanged();
      } catch {
        // Subscribers cannot roll back an authoritative state transition.
      }
    }
  }

  private async rejectMalformedStoredSession(
    context: CancellationContext,
  ): Promise<SessionValidationOutcome> {
    try {
      await this.logout();
    } catch {
      // Authentication is already revoked. Destructive cleanup exhausts every
      // independent wipe step before surfacing a failure.
    }
    this.finishValidation(context);
    return { result: 'unauthorized', authoritative: true };
  }

  private beginValidationContext(): CancellationContext {
    this.activeValidationContext?.abort('Session validation superseded');
    const context = new CancellationContext(this.nextValidationRunId, 'Session validation');
    this.nextValidationRunId += 1;
    this.activeValidationContext = context;
    return context;
  }

  private runAuthentication(
    authenticate: (context: CancellationContext) => Promise<AuthResponse>,
  ): Promise<AuthResponse> {
    const context = this.beginAuthenticationContext();
    const result = authenticate(context);
    const trackedResult = result.finally(() => {
      this.finishAuthentication(context);
      this.authenticationOperations.delete(trackedResult);
    });
    this.authenticationOperations.add(trackedResult);
    return trackedResult;
  }

  private serializeSessionMutation<T>(mutate: () => Promise<T>): Promise<T> {
    const result = this.sessionMutationTail.then(mutate);
    this.sessionMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private beginAuthenticationContext(): CancellationContext {
    this.invalidate();
    this.activeAuthenticationContext?.abort('Authentication superseded');
    const context = new CancellationContext(
      this.nextAuthenticationRunId,
      'Session authentication',
    );
    this.nextAuthenticationRunId += 1;
    this.activeAuthenticationContext = context;
    return context;
  }

  private finishAuthentication(context: CancellationContext): void {
    if (this.activeAuthenticationContext === context) {
      this.activeAuthenticationContext = null;
    }
  }

  private isValidationCurrent(context: CancellationContext, generation: number): boolean {
    return this.activeValidationContext === context && generation === this.validationGeneration;
  }

  private finishValidation(context: CancellationContext): void {
    if (this.activeValidationContext === context) this.activeValidationContext = null;
  }

  private staleSessionResult(): Exclude<SessionValidationResult, 'network_error'> {
    if (this.isLoggingOut) return 'unauthorized';
    return this._authState.isAuthenticated ? 'ok' : 'unauthorized';
  }
}
