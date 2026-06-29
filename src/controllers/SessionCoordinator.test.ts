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

    it('restores safely when the startup runtime adapter throws', () => {
      const hooks = createHooks({
        setOfflineRuntime: vi.fn(() => { throw new Error('runtime unavailable'); }),
      });

      const { coordinator } = createHarness({ session: STORED_SESSION, hooks });

      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.isOnline).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(false);
    });

    it('restores a token-only session without inventing an identity', () => {
      const { coordinator } = createHarness({
        session: {
          instance: STORED_SESSION.instance,
          token: STORED_SESSION.token,
        },
      });

      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.currentUser).toBeNull();
    });

    it('does not publish a malformed persisted session as authenticated', () => {
      const { coordinator } = createHarness({
        session: {
          email: 'restored@example.com',
          instance: 'https://www.speleodb.org/tenant',
          token: 'stored-token',
        },
      });

      expect(coordinator.isAuthenticated).toBe(false);
      expect(coordinator.currentUser).toBeNull();
      expect(coordinator.authState.token).toBeNull();
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
      allowConsoleError('Failed to load auth state.');
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

    it.each([
      'https://example.com/tenant',
      'https://example.com/?tenant=one',
      'https://example.com/#login',
    ])('rejects non-origin instance input %s before password transport', async (instance) => {
      const { coordinator, transport } = createHarness();

      await expect(coordinator.login({
        email: 'user@example.com',
        password: 'password',
        instance,
      })).resolves.toEqual({
        success: false,
        message: 'Enter a valid SpeleoDB instance origin URL.',
      });
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
        instance: '  http://example.com///  ',
      });

      expect(transport.authenticate).toHaveBeenCalledWith(
        'https://example.com',
        'submitted@example.com',
        'password',
        { signal: expect.any(AbortSignal) },
      );
      expect(store.establish).toHaveBeenCalledWith(
        {
          email: 'server@example.com',
          instance: 'https://example.com',
          token: 'issued-token',
        },
        { signal: expect.any(AbortSignal) },
      );
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
      { detail: 'detail error' },
      { detail: ' ', message: 'message error' },
      { errors: { non_field_errors: ['field error'] } },
      { errors: { non_field_errors: [7] } },
      null,
    ])('returns a fixed message for untrusted 401 body %#', async (data) => {
      const transport = createTransport({
        authenticate: vi.fn(async () => ({ status: 401, data })),
      });
      const { coordinator } = createHarness({ transport });

      const result = await coordinator.login({
        email: 'user@example.com',
        password: 'password',
        instance: 'https://example.com',
      });

      expect(result).toEqual({ success: false, message: 'Invalid email or password' });
    });

    it('never publishes reflected email or password error content', async () => {
      const reflected = 'Rejected USER%40example.com with p%40ss+word\nTry again';
      const transport = createTransport({
        authenticate: vi.fn(async () => ({
          status: 401,
          data: { detail: reflected },
        })),
      });
      const { coordinator } = createHarness({ transport });

      const result = await coordinator.login({
        email: 'user@example.com',
        password: 'p@ss word',
        instance: 'https://example.com',
      });

      expect(result.message).toBe('Invalid email or password');
      expect(result.message).not.toContain(reflected);
      expect(result.message).not.toContain('user@example.com');
      expect(result.message).not.toContain('p@ss word');
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
        message: 'Login succeeded, but the session could not be established safely.',
      });
      expect(coordinator.isAuthenticated).toBe(false);
    });

    it('keeps a committed login successful when publication observers throw', async () => {
      const hooks = createHooks();
      const { coordinator, store } = createHarness({ hooks });
      vi.mocked(hooks.setOfflineRuntime).mockImplementation(() => {
        throw new Error('runtime adapter failed');
      });
      vi.mocked(hooks.notifyStateChanged).mockImplementation(() => {
        throw new Error('subscriber failed');
      });

      await expect(coordinator.login({
        email: 'user@example.com',
        password: 'password',
        instance: 'https://example.com',
      })).resolves.toMatchObject({ success: true, token: 'token' });

      expect(store.establish).toHaveBeenCalledOnce();
      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.isOnline).toBe(true);
      expect(coordinator.isOfflineLocked).toBe(false);
    });

    it('does not commit a session when required application invalidation fails', async () => {
      const hooks = createHooks({
        invalidateApplicationOperations: vi.fn(() => {
          throw new Error('invalidation failed');
        }),
      });
      const { coordinator, store } = createHarness({ hooks });

      await expect(coordinator.loginWithToken({
        token: 'token',
        instance: 'https://example.com',
      })).resolves.toEqual({
        success: false,
        message: 'Login succeeded, but the session could not be established safely.',
      });

      expect(store.establish).not.toHaveBeenCalled();
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

    it.each([
      'https://example.com/tenant',
      'https://example.com/?tenant=one',
      'https://example.com/#login',
    ])('rejects non-origin instance input %s before token transport', async (instance) => {
      const { coordinator, transport } = createHarness();

      await expect(coordinator.loginWithToken({ token: 'token', instance }))
        .resolves.toEqual({
          success: false,
          message: 'Enter a valid SpeleoDB instance origin URL.',
        });
      expect(transport.validateToken).not.toHaveBeenCalled();
    });

    it('validates and stores a normalized identity-free token', async () => {
      const { coordinator, store } = createHarness();

      const result = await coordinator.loginWithToken({
        token: '  oauth-token  ',
        instance: '  http://example.com///  ',
      });

      expect(store.establish).toHaveBeenCalledOnce();
      expect(store.establish).toHaveBeenCalledWith(
        {
          email: undefined,
          instance: 'https://example.com',
          token: 'oauth-token',
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(result).toEqual({ success: true, message: 'Login successful', token: 'oauth-token' });
      expect(coordinator.currentUser).toBeNull();
    });

    it.each([
      [403, { message: 'denied' }, 'Invalid OAuth token'],
      [401, {}, 'Invalid OAuth token'],
      [500, { detail: 'maintenance' }, 'Unable to validate OAuth token. Please try again.'],
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

    it('never publishes raw or transformed token error content', async () => {
      const token = 'oauth /? [REDACTED] token';
      const encodedToken = encodeURIComponent(token);
      const mixedEscapes = encodedToken.replace('%2F', '%2f');
      const transport = createTransport({
        validateToken: vi.fn(async () => ({
          status: 403,
          data: {
            detail: `${token} ${encodedToken} ${mixedEscapes} ${'x'.repeat(400)}`,
          },
        })),
      });
      const { coordinator } = createHarness({ transport });

      const result = await coordinator.loginWithToken({
        token,
        instance: 'https://example.com',
      });

      expect(result.message).toBe('Invalid OAuth token');
      expect(result.message).not.toContain(encodedToken);
      expect(result.message).not.toContain(mixedEscapes);
      expect(result.message).not.toContain('[REDACTED]');
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
        message: 'Login succeeded, but the session could not be established safely.',
      });
      expect(coordinator.isAuthenticated).toBe(false);
    });
  });

  describe('authentication ownership', () => {
    it('lets the newest attempt finish without waiting for a stale transport', async () => {
      const staleResponse = createDeferred<HttpResponse<AuthTokenResponse>>();
      const authenticate = vi.fn((
        _instance: string,
        _email: string,
        _password: string,
        _options?: Parameters<SessionTransport['authenticate']>[3],
      ) => staleResponse.promise);
      const transport = createTransport({ authenticate });
      const { coordinator, store } = createHarness({ transport });

      const staleLogin = coordinator.login({
        email: 'old@example.com',
        password: 'password',
        instance: 'https://old.example',
      });
      await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
      const staleOptions = authenticate.mock.calls[0][3];

      const currentLogin = coordinator.loginWithToken({
        token: 'new-token',
        instance: 'https://new.example',
      });

      await expect(currentLogin).resolves.toEqual({
        success: true,
        message: 'Login successful',
        token: 'new-token',
      });
      expect(staleOptions?.signal?.aborted).toBe(true);
      expect(store.establish).toHaveBeenCalledOnce();
      expect(store.establish).toHaveBeenCalledWith(
        {
          email: undefined,
          instance: 'https://new.example',
          token: 'new-token',
        },
        { signal: expect.any(AbortSignal) },
      );

      staleResponse.resolve({
        status: 200,
        data: { user: 'old@example.com', token: 'old-token' },
      });
      await expect(staleLogin).resolves.toEqual({
        success: false,
        message: 'Authentication attempt was superseded.',
      });
      expect(coordinator.authState.token).toBe('new-token');
    });

    it('prevents stale startup validation from purging a new login', async () => {
      const staleResponse = createDeferred<HttpResponse<unknown>>();
      let validationCalls = 0;
      const validateToken = vi.fn((
        _instance: string,
        _token: string,
        _options?: Parameters<SessionTransport['validateToken']>[2],
      ) => {
        validationCalls += 1;
        return validationCalls === 1
          ? staleResponse.promise
          : Promise.resolve({ status: 200, data: {} });
      });
      const hooks = createHooks();
      const transport = createTransport({ validateToken });
      const { coordinator } = createHarness({
        hooks,
        session: STORED_SESSION,
        transport,
      });

      const staleValidation = coordinator.validateSession();
      await vi.waitFor(() => expect(validateToken).toHaveBeenCalledOnce());
      const validationSignal = validateToken.mock.calls[0][2]?.signal;
      const currentLogin = coordinator.loginWithToken({
        token: 'new-token',
        instance: 'https://new.example',
      });

      await expect(currentLogin).resolves.toMatchObject({
        success: true,
        token: 'new-token',
      });
      expect(validationSignal?.aborted).toBe(true);
      staleResponse.resolve({ status: 401, data: {} });
      await expect(staleValidation).resolves.toBe('ok');
      expect(hooks.purgeLocalUserData).not.toHaveBeenCalled();
      expect(coordinator.authState.token).toBe('new-token');
    });

    it('classifies a superseded token transport as cancellation', async () => {
      const staleResponse = createDeferred<HttpResponse<unknown>>();
      let validationCalls = 0;
      const validateToken = vi.fn(() => {
        validationCalls += 1;
        return validationCalls === 1
          ? staleResponse.promise
          : Promise.resolve({ status: 200, data: {} });
      });
      const transport = createTransport({ validateToken });
      const { coordinator } = createHarness({ transport });

      const staleLogin = coordinator.loginWithToken({
        token: 'old-token',
        instance: 'https://old.example',
      });
      await vi.waitFor(() => expect(validateToken).toHaveBeenCalledOnce());
      const currentLogin = coordinator.login({
        email: 'new@example.com',
        password: 'password',
        instance: 'https://new.example',
      });

      await expect(currentLogin).resolves.toMatchObject({ success: true });
      staleResponse.resolve({ status: 200, data: {} });
      await expect(staleLogin).resolves.toEqual({
        success: false,
        message: 'Authentication attempt was superseded.',
      });
    });

    it('rolls back a superseded token while a newer password login waits to commit', async () => {
      const staleWrite = createDeferred<void>();
      const store = createSessionStore();
      vi.mocked(store.establish).mockImplementationOnce(async (_session, options) => {
        await staleWrite.promise;
        options?.signal?.throwIfAborted();
      });
      const { coordinator, transport } = createHarness({ store });

      const staleLogin = coordinator.loginWithToken({
        token: 'old-token',
        instance: 'https://old.example',
      });
      await vi.waitFor(() => expect(store.establish).toHaveBeenCalledOnce());
      const currentLogin = coordinator.login({
        email: 'new@example.com',
        password: 'password',
        instance: 'https://new.example',
      });

      await vi.waitFor(() => expect(transport.authenticate).toHaveBeenCalledOnce());
      expect(store.establish).toHaveBeenCalledOnce();
      staleWrite.resolve();

      await expect(staleLogin).resolves.toEqual({
        success: false,
        message: 'Authentication attempt was superseded.',
      });
      await expect(currentLogin).resolves.toMatchObject({ success: true });
      expect(store.establish).toHaveBeenCalledTimes(2);
    });

    it('serializes secure writes and publishes only the newest session', async () => {
      const staleWrite = createDeferred<void>();
      const store = createSessionStore();
      vi.mocked(store.establish).mockImplementationOnce(async (_session, options) => {
        await staleWrite.promise;
        options?.signal?.throwIfAborted();
      });
      const { coordinator, transport } = createHarness({ store });

      const staleLogin = coordinator.login({
        email: 'old@example.com',
        password: 'password',
        instance: 'https://old.example',
      });
      await vi.waitFor(() => expect(store.establish).toHaveBeenCalledOnce());
      const currentLogin = coordinator.loginWithToken({
        token: 'new-token',
        instance: 'https://new.example',
      });

      await vi.waitFor(() => expect(transport.validateToken).toHaveBeenCalledOnce());
      expect(store.establish).toHaveBeenCalledOnce();
      staleWrite.resolve();

      await expect(staleLogin).resolves.toEqual({
        success: false,
        message: 'Authentication attempt was superseded.',
      });
      await expect(currentLogin).resolves.toEqual({
        success: true,
        message: 'Login successful',
        token: 'new-token',
      });
      expect(store.establish).toHaveBeenCalledTimes(2);
      expect(coordinator.authState.token).toBe('new-token');
    });

    it('waits for an aborted secure write before destructive logout', async () => {
      const staleWrite = createDeferred<void>();
      const store = createSessionStore();
      vi.mocked(store.establish).mockImplementationOnce(async (_session, options) => {
        await staleWrite.promise;
        options?.signal?.throwIfAborted();
      });
      const purge = createDeferred<void>();
      const hooks = createHooks({ purgeLocalUserData: vi.fn(() => purge.promise) });
      const { coordinator, transport } = createHarness({ hooks, store });

      const login = coordinator.login({
        email: 'user@example.com',
        password: 'password',
        instance: 'https://example.com',
      });
      await vi.waitFor(() => expect(store.establish).toHaveBeenCalledOnce());
      const logout = coordinator.logout();

      expect(coordinator.isAuthenticated).toBe(false);
      expect(coordinator.isOnline).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(false);

      await expect(coordinator.loginWithToken({
        token: 'new-token',
        instance: 'https://new.example',
      })).resolves.toEqual({
        success: false,
        message: 'Sign out is in progress. Please try again.',
      });
      await expect(coordinator.login({
        email: 'new@example.com',
        password: 'password',
        instance: 'https://new.example',
      })).resolves.toEqual({
        success: false,
        message: 'Sign out is in progress. Please try again.',
      });
      expect(transport.validateToken).not.toHaveBeenCalled();
      expect(hooks.purgeLocalUserData).not.toHaveBeenCalled();

      staleWrite.resolve();
      await expect(login).resolves.toEqual({
        success: false,
        message: 'Authentication attempt was superseded.',
      });
      await vi.waitFor(() => expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce());
      purge.resolve();
      await expect(logout).resolves.toBeUndefined();
      expect(coordinator.isAuthenticated).toBe(false);
    });

    it('coalesces concurrent logout requests and reopens login after purge', async () => {
      const purge = createDeferred<void>();
      const hooks = createHooks({ purgeLocalUserData: vi.fn(() => purge.promise) });
      const { coordinator } = createHarness({ hooks });

      const first = coordinator.logout();
      const second = coordinator.logout();
      await vi.waitFor(() => expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce());
      purge.resolve();

      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
      await expect(coordinator.loginWithToken({
        token: 'token',
        instance: 'https://example.com',
      })).resolves.toMatchObject({ success: true });
    });

    it('continues destructive logout when revocation adapters throw', async () => {
      const hooks = createHooks();
      const { coordinator } = createHarness({ session: STORED_SESSION, hooks });
      vi.mocked(hooks.notifyStateChanged).mockImplementation(() => {
        throw new Error('subscriber failed');
      });
      vi.mocked(hooks.setOfflineRuntime).mockImplementation(() => {
        throw new Error('runtime failed');
      });

      await expect(coordinator.logout()).resolves.toBeUndefined();

      expect(coordinator.isAuthenticated).toBe(false);
      expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce();
    });

    it('cancels validation and rejects new probes throughout logout', async () => {
      const validationResponse = createDeferred<HttpResponse<unknown>>();
      const validateToken = vi.fn((
        _instance: string,
        _token: string,
        _options?: Parameters<SessionTransport['validateToken']>[2],
      ) => validationResponse.promise);
      const purge = createDeferred<void>();
      const hooks = createHooks({ purgeLocalUserData: vi.fn(() => purge.promise) });
      const transport = createTransport({ validateToken });
      const { coordinator } = createHarness({
        hooks,
        session: STORED_SESSION,
        transport,
      });

      const staleValidation = coordinator.validateSession();
      await vi.waitFor(() => expect(validateToken).toHaveBeenCalledOnce());
      const validationSignal = validateToken.mock.calls[0][2]?.signal;
      const logout = coordinator.logout();

      expect(validationSignal?.aborted).toBe(true);
      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');
      await expect(coordinator.attemptReconnect()).resolves.toBe('unauthorized');
      expect(validateToken).toHaveBeenCalledOnce();

      validationResponse.resolve({ status: 200, data: {} });
      await expect(staleValidation).resolves.toBe('unauthorized');
      expect(coordinator.isOnline).toBe(false);
      purge.resolve();
      await expect(logout).resolves.toBeUndefined();
    });
  });

  describe('validation, reconnect, and logout', () => {
    it('returns unauthorized without transport when no stored session exists', async () => {
      const { coordinator, transport } = createHarness();

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');
      expect(transport.validateToken).not.toHaveBeenCalled();
    });

    it('purges a malformed persisted session without attempting transport', async () => {
      const hooks = createHooks();
      const { coordinator, transport } = createHarness({
        hooks,
        session: {
          email: 'restored@example.com',
          instance: 'https://www.speleodb.org/tenant?account=old',
          token: 'stored-token',
        },
      });

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');

      expect(transport.validateToken).not.toHaveBeenCalled();
      expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce();
      expect(coordinator.isAuthenticated).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(false);
    });

    it('persists a canonical upgrade before validating a recoverable session', async () => {
      const store = createSessionStore({
        email: ' restored@example.com ',
        instance: 'EXAMPLE.com///',
        token: ' stored-token ',
      });
      const { coordinator, transport } = createHarness({ store });

      await expect(coordinator.validateSession()).resolves.toBe('ok');

      expect(store.establish).toHaveBeenCalledWith(
        {
          email: 'restored@example.com',
          instance: 'https://example.com',
          token: 'stored-token',
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(vi.mocked(store.establish).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(transport.validateToken).mock.invocationCallOrder[0]);
      expect(transport.validateToken).toHaveBeenCalledWith(
        'https://example.com',
        'stored-token',
        expect.objectContaining({ timeoutMs: 10_000 }),
      );
    });

    it('purges when a required stored-session canonicalization cannot be committed', async () => {
      const store = createSessionStore({
        instance: 'EXAMPLE.com///',
        token: 'stored-token',
      }, {
        establish: vi.fn(async () => { throw new Error('metadata unavailable'); }),
      });
      const hooks = createHooks();
      const { coordinator, transport } = createHarness({ hooks, store });

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');

      expect(transport.validateToken).not.toHaveBeenCalled();
      expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce();
      expect(coordinator.isAuthenticated).toBe(false);
    });

    it('keeps a canonicalized session offline when later transport fails', async () => {
      const store = createSessionStore({
        instance: 'EXAMPLE.com///',
        token: 'stored-token',
      });
      const transport = createTransport({
        validateToken: vi.fn(async () => { throw new Error('offline'); }),
      });
      const hooks = createHooks();
      const { coordinator } = createHarness({ hooks, store, transport });

      await expect(coordinator.validateSession()).resolves.toBe('network_error');

      expect(hooks.purgeLocalUserData).not.toHaveBeenCalled();
      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.isOfflineLocked).toBe(true);
    });

    it('fails closed when validation cannot read the secure session', async () => {
      const error = new Error('vault state unavailable');
      allowConsoleError('Failed to load auth state.');
      const store = createSessionStore(null, {
        getSession: vi.fn(() => { throw error; }),
      });
      const { coordinator, hooks, transport } = createHarness({ store });

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');

      expect(coordinator.isAuthenticated).toBe(false);
      expect(coordinator.isOnline).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(false);
      expect(transport.validateToken).not.toHaveBeenCalled();
      expect(hooks.notifyStateChanged).toHaveBeenCalledOnce();
      expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce();
    });

    it('keeps an unreadable session unauthorized when destructive cleanup fails', async () => {
      const error = new Error('vault state unavailable');
      allowConsoleError('Failed to load auth state.');
      const store = createSessionStore(null, {
        getSession: vi.fn(() => { throw error; }),
      });
      const hooks = createHooks({
        purgeLocalUserData: vi.fn(async () => { throw new Error('clear failed'); }),
      });
      const { coordinator } = createHarness({ hooks, store });

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');
      expect(coordinator.isAuthenticated).toBe(false);
      expect(coordinator.isOfflineLocked).toBe(false);
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

    it('keeps successful validation authoritative when publication adapters throw', async () => {
      const hooks = createHooks();
      const { coordinator } = createHarness({ session: STORED_SESSION, hooks });
      vi.mocked(hooks.setOfflineRuntime).mockImplementation(() => {
        throw new Error('runtime adapter failed');
      });
      vi.mocked(hooks.notifyStateChanged).mockImplementation(() => {
        throw new Error('subscriber failed');
      });

      await expect(coordinator.validateSession()).resolves.toBe('ok');

      expect(coordinator.isAuthenticated).toBe(true);
      expect(coordinator.isOnline).toBe(true);
      expect(coordinator.isOfflineLocked).toBe(false);
    });

    it.each([401, 403])('purges an explicitly denied session on status %i', async (status) => {
      const hooks = createHooks();
      const transport = createTransport({
        validateToken: vi.fn(async () => ({ status, data: {} })),
      });
      const { coordinator } = createHarness({ session: STORED_SESSION, hooks, transport });

      await expect(coordinator.validateSession()).resolves.toBe('unauthorized');
      expect(hooks.purgeLocalUserData).toHaveBeenCalledOnce();
    });

    it.each([400, 404, 408, 409, 425, 429])(
      'preserves the session on inconclusive client status %i',
      async (status) => {
        const hooks = createHooks();
        const transport = createTransport({
          validateToken: vi.fn(async () => ({ status, data: {} })),
        });
        const { coordinator } = createHarness({ session: STORED_SESSION, hooks, transport });

        await expect(coordinator.validateSession()).resolves.toBe('network_error');
        expect(coordinator.isAuthenticated).toBe(true);
        expect(coordinator.isOfflineLocked).toBe(true);
        expect(hooks.purgeLocalUserData).not.toHaveBeenCalled();
      },
    );

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

    it('keeps reconnect success authoritative when follow-up sync launch throws', async () => {
      const hooks = createHooks({
        startReconnectSync: vi.fn(() => { throw new Error('sync launch failed'); }),
      });
      const { coordinator } = createHarness({ session: STORED_SESSION, hooks });
      coordinator.enterOfflineMode();

      await expect(coordinator.attemptReconnect()).resolves.toBe('ok');

      expect(coordinator.isOnline).toBe(true);
      expect(coordinator.isOfflineLocked).toBe(false);
      expect(hooks.startReconnectSync).toHaveBeenCalledOnce();
    });

    it('coalesces concurrent reconnect attempts and starts one sync', async () => {
      const reconnectResponse = createDeferred<HttpResponse<unknown>>();
      const transport = createTransport({
        validateToken: vi.fn()
          .mockRejectedValueOnce(new Error('offline'))
          .mockImplementationOnce(() => reconnectResponse.promise),
      });
      const { coordinator, hooks } = createHarness({ session: STORED_SESSION, transport });
      await coordinator.validateSession();

      const first = coordinator.attemptReconnect();
      const second = coordinator.attemptReconnect();

      expect(second).toBe(first);
      expect(transport.validateToken).toHaveBeenCalledTimes(2);
      reconnectResponse.resolve({ status: 200, data: {} });
      await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
      expect(hooks.startReconnectSync).toHaveBeenCalledOnce();
    });

    it('does not start reconnect sync from a validation superseded by logout', async () => {
      const reconnectResponse = createDeferred<HttpResponse<unknown>>();
      const transport = createTransport({
        validateToken: vi.fn(() => reconnectResponse.promise),
      });
      const { coordinator, hooks } = createHarness({ session: STORED_SESSION, transport });
      coordinator.enterOfflineMode();

      const reconnect = coordinator.attemptReconnect();
      await vi.waitFor(() => expect(transport.validateToken).toHaveBeenCalledOnce());
      await coordinator.logout();
      reconnectResponse.resolve({ status: 200, data: {} });

      await expect(reconnect).resolves.toBe('unauthorized');
      expect(hooks.startReconnectSync).not.toHaveBeenCalled();
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
