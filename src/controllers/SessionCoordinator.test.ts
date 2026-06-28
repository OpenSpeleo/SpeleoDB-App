import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpResponse } from '../services/HttpClient';
import type { SessionStore, StoredSession } from '../services/SecureSessionStore';
import { allowConsoleError } from '../test/consoleGuard';
import type { AuthTokenResponse } from '../types';
import {
  SessionCoordinator,
  type SessionCoordinatorHooks,
  type SessionTransport,
} from './SessionCoordinator';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSessionStore(
  initial: StoredSession | null = null,
  overrides: Partial<SessionStore> = {},
): SessionStore {
  let session = initial;
  return {
    initialize: vi.fn(async () => session),
    getSession: vi.fn(() => session ? { ...session } : null),
    establish: vi.fn(async (next) => { session = { ...next }; }),
    clear: vi.fn(async () => { session = null; }),
    ...overrides,
  };
}

function createTransport(overrides: Partial<SessionTransport> = {}): SessionTransport {
  return {
    authenticate: vi.fn(async () => ({
      status: 200,
      data: { user: 'server@example.com', token: 'token' },
    }) as HttpResponse<AuthTokenResponse>),
    validateToken: vi.fn(async () => ({ status: 200, data: {} })),
    ...overrides,
  };
}

function createHooks(overrides: Partial<SessionCoordinatorHooks> = {}): SessionCoordinatorHooks {
  return {
    notifyStateChanged: vi.fn(),
    invalidateApplicationOperations: vi.fn(),
    purgeLocalUserData: vi.fn(async () => {}),
    startReconnectSync: vi.fn(),
    setOfflineRuntime: vi.fn(),
    ...overrides,
  };
}

function createHarness(options: {
  session?: StoredSession | null;
  store?: SessionStore;
  transport?: SessionTransport;
  hooks?: SessionCoordinatorHooks;
} = {}) {
  const store = options.store ?? createSessionStore(options.session ?? null);
  const transport = options.transport ?? createTransport();
  const hooks = options.hooks ?? createHooks();
  const coordinator = new SessionCoordinator({ transport, sessionStore: store, hooks });
  return { coordinator, hooks, store, transport };
}

const STORED_SESSION: StoredSession = {
  email: 'restored@example.com',
  instance: 'https://www.speleodb.org',
  token: 'stored-token',
};

describe('SessionCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('restoration and state publication', () => {
    it('restores a stored identity and initializes the offline runtime unlocked', () => {
      const { coordinator, hooks } = createHarness({ session: STORED_SESSION });

      expect(coordinator.authState).toEqual({
        isAuthenticated: true,
        user: {
          id: 'restored',
          email: 'restored@example.com',
          name: 'restored@example.com',
        },
        token: 'stored-token',
      });
      expect(coordinator.currentUser?.email).toBe('restored@example.com');
      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.isOnline).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(false);
      expect(coordinator.hasNetworkAccess).toBe(true);
      expect(hooks.setOfflineRuntime).toHaveBeenCalledOnce();
      expect(hooks.setOfflineRuntime).toHaveBeenCalledWith(false);
      expect(hooks.notifyStateChanged).not.toHaveBeenCalled();
    });

    it('restores a token-only session without inventing an identity', () => {
      const { coordinator } = createHarness({
        session: { ...STORED_SESSION, email: '   ' },
      });

      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.currentUser).toBeNull();
    });

    it('starts unauthenticated when no session exists', () => {
      const { coordinator } = createHarness();

      expect(coordinator.authState).toEqual({
        isAuthenticated: false,
        user: null,
        token: null,
      });
    });

    it('fails closed when session restoration throws', () => {
      const error = new Error('vault unavailable');
      allowConsoleError('Failed to load auth state:', error);
      const store = createSessionStore(null, {
        getSession: vi.fn(() => { throw error; }),
      });

      const { coordinator } = createHarness({ store });

      expect(coordinator.isAuthenticated).toBe(false);
    });

    it('publishes connectivity changes and keeps offline entry idempotent', () => {
      const { coordinator, hooks } = createHarness();

      coordinator.markOnline();
      expect(coordinator.isOnline).toBe(true);
      expect(coordinator.isOfflineLocked).toBe(false);

      coordinator.enterOfflineMode();
      coordinator.enterOfflineMode();
      expect(coordinator.isOnline).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(true);
      expect(coordinator.hasNetworkAccess).toBe(false);
      expect(hooks.notifyStateChanged).toHaveBeenCalledTimes(2);
      expect(hooks.setOfflineRuntime).toHaveBeenLastCalledWith(true);
    });

    it('can reset silently or publish the reset', () => {
      const { coordinator, hooks } = createHarness({ session: STORED_SESSION });

      coordinator.markOnline(false);
      coordinator.reset();
      expect(coordinator.isAuthenticated).toBe(false);
      expect(coordinator.isOnline).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(false);
      expect(hooks.notifyStateChanged).not.toHaveBeenCalled();

      coordinator.reset(true);
      expect(hooks.notifyStateChanged).toHaveBeenCalledOnce();
    });
  });

  describe('email and password login', () => {
    it.each([
      [{ email: 'invalid', password: 'password', instance: 'https://example.com' }, 'Invalid email address'],
      [{ email: 'user@example.com', password: '', instance: 'https://example.com' }, 'Password is required'],
      [{ email: 'user@example.com', password: 'password', instance: ' ' }, 'SpeleoDB instance URL is required'],
    ])('rejects invalid input before transport', async (credentials, message) => {
      const { coordinator, transport } = createHarness();

      await expect(coordinator.login(credentials)).resolves.toEqual({ success: false, message });
      expect(transport.authenticate).not.toHaveBeenCalled();
    });

    it('rejects a new login while the current session is offline-locked', async () => {
      const { coordinator, transport } = createHarness();
      coordinator.enterOfflineMode();

      const result = await coordinator.login({
        email: 'user@example.com',
        password: 'password',
        instance: 'https://example.com',
      });

      expect(result).toEqual({
        success: false,
        message: 'Unable to reach SpeleoDB. Offline access requires a previously validated session.',
      });
      expect(transport.authenticate).not.toHaveBeenCalled();
    });

    it('persists before publishing a normalized authenticated session', async () => {
      const transport = createTransport({
        authenticate: vi.fn(async () => ({
          status: 201,
          data: { user: '  server@example.com  ', token: '  issued-token  ' },
        })),
      });
      const { coordinator, hooks, store } = createHarness({ transport });

      const result = await coordinator.login({
        email: 'submitted@example.com',
        password: 'password',
        instance: '  https://example.com  ',
      });

      expect(store.establish).toHaveBeenCalledWith({
        email: 'server@example.com',
        instance: 'https://example.com',
        token: 'issued-token',
      });
      expect(result).toEqual({
        success: true,
        message: 'Login successful',
        user: { id: 'auth', email: 'server@example.com', name: 'server@example.com' },
        token: 'issued-token',
      });
      expect(hooks.invalidateApplicationOperations).toHaveBeenCalledOnce();
      expect(coordinator.isOnline).toBe(true);
    });

    it('uses the submitted email when the success body has no usable user', async () => {
      const transport = createTransport({
        authenticate: vi.fn(async () => ({ status: 200, data: { user: ' ', token: 'token' } })),
      });
      const { coordinator } = createHarness({ transport });

      const result = await coordinator.login({
        email: 'submitted@example.com',
        password: 'password',
        instance: 'https://example.com',
      });

      expect(result.user?.email).toBe('submitted@example.com');
    });

    it.each([
      [{ detail: 'detail error' }, 'detail error'],
      [{ detail: ' ', message: 'message error' }, 'message error'],
      [{ errors: { non_field_errors: ['field error'] } }, 'field error'],
      [{ errors: { non_field_errors: [7] } }, 'Invalid email or password'],
      [null, 'Invalid email or password'],
    ])('returns the supported 401 error shape', async (data, message) => {
      const transport = createTransport({
        authenticate: vi.fn(async () => ({ status: 401, data })),
      });
      const { coordinator } = createHarness({ transport });

      const result = await coordinator.login({
        email: 'user@example.com',
        password: 'password',
        instance: 'https://example.com',
      });

      expect(result).toEqual({ success: false, message });
    });

    it('rejects malformed success bodies and non-auth server failures', async () => {
      const transport = createTransport({
        authenticate: vi.fn()
          .mockResolvedValueOnce({ status: 200, data: null })
          .mockResolvedValueOnce({ status: 200, data: { token: ' ' } })
          .mockResolvedValueOnce({ status: 500, data: {} }),
      });
      const { coordinator } = createHarness({ transport });
      const credentials = {
        email: 'user@example.com',
        password: 'password',
        instance: 'https://example.com',
      };

      await expect(coordinator.login(credentials)).resolves.toEqual({
        success: false,
        message: 'Login failed',
      });
      await expect(coordinator.login(credentials)).resolves.toEqual({
        success: false,
        message: 'Login failed',
      });
      await expect(coordinator.login(credentials)).resolves.toEqual({
        success: false,
        message: 'Login failed',
      });
    });

    it('does not publish a session after transport or secure-storage failure', async () => {
      const transport = createTransport({
        authenticate: vi.fn()
          .mockRejectedValueOnce(new Error('offline'))
          .mockResolvedValueOnce({ status: 200, data: { user: 'u@example.com', token: 'token' } }),
      });
      const store = createSessionStore(null, {
        establish: vi.fn(async () => { throw new Error('vault failed'); }),
      });
      const { coordinator } = createHarness({ transport, store });
      const credentials = {
        email: 'user@example.com',
        password: 'password',
        instance: 'https://example.com',
      };

      expect((await coordinator.login(credentials)).message).toContain('previously validated session');
      await expect(coordinator.login(credentials)).resolves.toEqual({
        success: false,
        message: 'Login succeeded, but the secure session could not be saved.',
      });
      expect(coordinator.isAuthenticated).toBe(false);
    });
  });

  describe('OAuth token login', () => {
    it('rejects blank token and instance before transport', async () => {
      const { coordinator, transport } = createHarness();

      await expect(coordinator.loginWithToken({ token: ' ', instance: 'https://example.com' }))
        .resolves.toEqual({ success: false, message: 'OAuth token is required' });
      await expect(coordinator.loginWithToken({ token: 'token', instance: ' ' }))
        .resolves.toEqual({ success: false, message: 'SpeleoDB instance URL is required' });
      expect(transport.validateToken).not.toHaveBeenCalled();
    });

    it('validates and stores a normalized identity-free token', async () => {
      const { coordinator, store } = createHarness();

      const result = await coordinator.loginWithToken({
        token: '  oauth-token  ',
        instance: '  https://example.com  ',
      });

      expect(store.establish).toHaveBeenCalledWith({
        email: undefined,
        instance: 'https://example.com',
        token: 'oauth-token',
      });
      expect(result).toEqual({ success: true, message: 'Login successful', token: 'oauth-token' });
      expect(coordinator.currentUser).toBeNull();
    });

    it.each([
      [403, { message: 'denied' }, 'denied'],
      [401, {}, 'Invalid OAuth token'],
      [500, { detail: 'maintenance' }, 'maintenance'],
      [500, {}, 'Unable to validate OAuth token. Please try again.'],
    ])('classifies status %i without creating a session', async (status, data, message) => {
      const transport = createTransport({
        validateToken: vi.fn(async () => ({ status, data })),
      });
      const { coordinator, store } = createHarness({ transport });

      await expect(coordinator.loginWithToken({ token: 'token', instance: 'https://example.com' }))
        .resolves.toEqual({ success: false, message });
      expect(store.establish).not.toHaveBeenCalled();
    });

    it('reports transport and secure-storage failures without authenticating', async () => {
      const transport = createTransport({
        validateToken: vi.fn()
          .mockRejectedValueOnce(new Error('offline'))
          .mockResolvedValueOnce({ status: 204, data: null }),
      });
      const store = createSessionStore(null, {
        establish: vi.fn(async () => { throw new Error('vault failed'); }),
      });
      const { coordinator } = createHarness({ transport, store });
      const credentials = { token: 'token', instance: 'https://example.com' };

      await expect(coordinator.loginWithToken(credentials)).resolves.toEqual({
        success: false,
        message: 'Unable to validate OAuth token. Check your connection and try again.',
      });
      await expect(coordinator.loginWithToken(credentials)).resolves.toEqual({
        success: false,
        message: 'Login succeeded, but the secure session could not be saved.',
      });
      expect(coordinator.isAuthenticated).toBe(false);
    });
  });

  describe('validation, reconnect, and logout', () => {
    it('returns unauthorized without transport when no stored session exists', async () => {
      const { coordinator, transport } = createHarness();

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');
      expect(transport.validateToken).not.toHaveBeenCalled();
    });

    it('publishes online state after successful startup validation', async () => {
      const { coordinator, hooks, transport } = createHarness({ session: STORED_SESSION });

      await expect(coordinator.validateSession()).resolves.toBe('ok');

      expect(transport.validateToken).toHaveBeenCalledWith(
        STORED_SESSION.instance,
        STORED_SESSION.token,
        expect.objectContaining({ timeoutMs: 10_000, signal: expect.any(AbortSignal) }),
      );
      expect(coordinator.isOnline).toBe(true);
      expect(hooks.notifyStateChanged).toHaveBeenCalledOnce();
    });

    it('purges only client-error validation outcomes', async () => {
      const hooks = createHooks();
      const transport = createTransport({
        validateToken: vi.fn(async () => ({ status: 401, data: {} })),
      });
      const { coordinator } = createHarness({ session: STORED_SESSION, hooks, transport });

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');
      expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce();
    });

    it.each([
      ['server response', createTransport({ validateToken: vi.fn(async () => ({ status: 503, data: {} })) })],
      ['transport rejection', createTransport({ validateToken: vi.fn(async () => { throw new Error('offline'); }) })],
    ])('preserves the session and locks offline on %s', async (_label, transport) => {
      const { coordinator, hooks } = createHarness({ session: STORED_SESSION, transport });

      await expect(coordinator.validateSession()).resolves.toBe('network_error');
      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.isOfflineLocked).toBe(true);
      expect(hooks.purgeLocalUserData).not.toHaveBeenCalled();

      await expect(coordinator.validateSession()).resolves.toBe('network_error');
      expect(transport.validateToken).toHaveBeenCalledOnce();
    });

    it('bypasses the offline lock for explicit reconnect and starts one sync on success', async () => {
      const transport = createTransport({
        validateToken: vi.fn()
          .mockRejectedValueOnce(new Error('offline'))
          .mockResolvedValueOnce({ status: 200, data: {} }),
      });
      const { coordinator, hooks } = createHarness({ session: STORED_SESSION, transport });
      await coordinator.validateSession();

      await expect(coordinator.attemptReconnect()).resolves.toBe('ok');
      expect(coordinator.isOfflineLocked).toBe(false);
      expect(hooks.startReconnectSync).toHaveBeenCalledOnce();
    });

    it('does not start sync when reconnect remains offline', async () => {
      const transport = createTransport({
        validateToken: vi.fn(async () => ({ status: 500, data: {} })),
      });
      const { coordinator, hooks } = createHarness({ session: STORED_SESSION, transport });

      await expect(coordinator.attemptReconnect()).resolves.toBe('network_error');
      expect(hooks.startReconnectSync).not.toHaveBeenCalled();
    });

    it('ignores a superseded validation completion', async () => {
      const first = createDeferred<HttpResponse<unknown>>();
      const transport = createTransport({
        validateToken: vi.fn()
          .mockImplementationOnce(() => first.promise)
          .mockResolvedValueOnce({ status: 200, data: {} }),
      });
      const { coordinator } = createHarness({ session: STORED_SESSION, transport });

      const staleValidation = coordinator.validateSession();
      const currentValidation = coordinator.validateSession();
      first.resolve({ status: 500, data: {} });

      await expect(currentValidation).resolves.toBe('ok');
      await expect(staleValidation).resolves.toBe('ok');
      expect(coordinator.isOfflineLocked).toBe(false);
    });

    it('returns the post-reset state when invalidation aborts validation', async () => {
      const deferred = createDeferred<HttpResponse<unknown>>();
      const transport = createTransport({ validateToken: vi.fn(() => deferred.promise) });
      const { coordinator } = createHarness({ session: STORED_SESSION, transport });

      const validation = coordinator.validateSession();
      coordinator.invalidate();
      coordinator.reset();
      deferred.reject(new Error('late failure'));

      await expect(validation).resolves.toBe('unauthorized');
      expect(coordinator.isOfflineLocked).toBe(false);
    });

    it('delegates destructive logout to the lifecycle hook', async () => {
      const hooks = createHooks();
      const { coordinator } = createHarness({ session: STORED_SESSION, hooks });

      await coordinator.logout();

      expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce();
    });
  });
});
