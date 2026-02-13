import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeleoDBController, type PreferencesPort } from './SpeleoDBController';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { HttpResponse } from '../services/HttpClient';
import type { AuthTokenResponse } from '../types';
import { PREFERENCES } from '../constants';

// ==================== Mocks ====================

function createMockService(overrides?: Partial<SpeleoDBService>): SpeleoDBService {
  return {
    authenticate: vi.fn(async () => ({ status: 200, data: { user: 'u@x.com', token: 'tok' } }) as HttpResponse<AuthTokenResponse>),
    validateToken: vi.fn(async () => ({ status: 200, data: {} }) as HttpResponse<unknown>),
    signup: vi.fn(async () => ({ status: 201, data: { user: { id: '1', email: 'a@b.com', name: 'A' } } }) as HttpResponse),
    ...overrides,
  } as SpeleoDBService;
}

function createMockPrefs(initial?: { email?: string; token?: string; instance?: string }): PreferencesPort {
  let store: { email?: string; token?: string; instance?: string } = initial ?? {};
  return {
    getPreferences: vi.fn(() => ({
      ...store,
      instance: store.instance ?? PREFERENCES.DEFAULT_INSTANCE,
    })),
    setPreferences: vi.fn((p: Partial<{ email?: string; token?: string; instance?: string }>) => {
      store = { ...store, ...p };
    }),
    clearPreferences: vi.fn(() => { store = {}; }),
  };
}

// ==================== Tests ====================

describe('SpeleoDBController', () => {
  const validCreds = {
    email: 'user@example.com',
    password: 'pass',
    instance: 'https://www.speleodb.org',
  };

  let service: ReturnType<typeof createMockService>;
  let prefs: ReturnType<typeof createMockPrefs>;
  let controller: SpeleoDBController;

  beforeEach(() => {
    localStorage.clear();
    service = createMockService();
    prefs = createMockPrefs();
    controller = new SpeleoDBController(service, prefs);
    vi.restoreAllMocks();
  });

  // ---- login (online) -------------------------------------------------------

  describe('login (online)', () => {
    it('calls service.authenticate and on 200 updates auth state + preferences', async () => {
      const result = await controller.login(validCreds);

      expect(result.success).toBe(true);
      expect(result.token).toBe('tok');
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.currentUser?.email).toBe('u@x.com');
      expect(controller.isOnline).toBe(true);

      expect(service.authenticate).toHaveBeenCalledWith(
        validCreds.instance,
        validCreds.email,
        validCreds.password,
      );
      expect(prefs.setPreferences).toHaveBeenCalledWith({
        email: 'u@x.com',
        token: 'tok',
        instance: validCreds.instance,
      });
    });

    it('on 401 returns failure and does not update auth state', async () => {
      service = createMockService({
        authenticate: vi.fn(async () => ({
          status: 401,
          data: {},
        }) as HttpResponse<AuthTokenResponse>),
      });
      controller = new SpeleoDBController(service, prefs);

      const result = await controller.login(validCreds);

      expect(result.success).toBe(false);
      expect(controller.isAuthenticated()).toBe(false);
    });

    it('returns failure for invalid email without calling service', async () => {
      const result = await controller.login({ ...validCreds, email: 'not-an-email' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid email');
      expect(service.authenticate).not.toHaveBeenCalled();
    });

    it('returns failure for empty password', async () => {
      const result = await controller.login({ ...validCreds, password: '' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Password');
      expect(service.authenticate).not.toHaveBeenCalled();
    });

    it('returns failure for empty instance', async () => {
      const result = await controller.login({ ...validCreds, instance: '   ' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('instance');
      expect(service.authenticate).not.toHaveBeenCalled();
    });
  });

  // ---- logout ---------------------------------------------------------------

  describe('logout', () => {
    it('clears auth state and removes email/token from preferences', async () => {
      await controller.login(validCreds);
      expect(controller.isAuthenticated()).toBe(true);

      controller.logout();

      expect(controller.isAuthenticated()).toBe(false);
      expect(controller.currentUser).toBeNull();
      expect(prefs.setPreferences).toHaveBeenCalledWith({
        email: undefined,
        token: undefined,
      });
    });
  });

  // ---- restoreSession -------------------------------------------------------

  describe('restoreSession (at construction)', () => {
    it('restores authenticated state when preferences have token and instance', () => {
      const restoredPrefs = createMockPrefs({
        email: 'restored@example.com',
        token: 'saved-token',
        instance: 'https://www.speleodb.org',
      });

      const fresh = new SpeleoDBController(service, restoredPrefs);

      expect(fresh.isAuthenticated()).toBe(true);
      expect(fresh.currentUser?.email).toBe('restored@example.com');
    });

    it('stays unauthenticated when preferences are empty', () => {
      const emptyPrefs = createMockPrefs();
      const fresh = new SpeleoDBController(service, emptyPrefs);

      expect(fresh.isAuthenticated()).toBe(false);
      expect(fresh.currentUser).toBeNull();
    });
  });

  // ---- validateSession ------------------------------------------------------

  describe('validateSession', () => {
    it('returns "ok" and sets isOnline when server responds 2xx', async () => {
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken);

      const result = await ctrl.validateSession();

      expect(result).toBe('ok');
      expect(ctrl.isOnline).toBe(true);
    });

    it('returns "unauthorized" when server responds 4xx', async () => {
      service = createMockService({
        validateToken: vi.fn(async () => ({ status: 401, data: {} }) as HttpResponse<unknown>),
      });
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken);

      const result = await ctrl.validateSession();
      expect(result).toBe('unauthorized');
    });

    it('returns "network_error" when request throws', async () => {
      service = createMockService({
        validateToken: vi.fn(async () => { throw new Error('Network failure'); }),
      });
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken);

      const result = await ctrl.validateSession();
      expect(result).toBe('network_error');
    });

    it('returns "unauthorized" when no token in preferences', async () => {
      const result = await controller.validateSession();
      expect(result).toBe('unauthorized');
    });
  });

  // ---- observer pattern -----------------------------------------------------

  describe('subscribe / notify', () => {
    it('calls listeners on login', async () => {
      const listener = vi.fn();
      controller.subscribe(listener);

      await controller.login(validCreds);

      expect(listener).toHaveBeenCalled();
    });

    it('unsubscribe stops notifications', async () => {
      const listener = vi.fn();
      const unsub = controller.subscribe(listener);
      unsub();

      await controller.login(validCreds);
      expect(listener).not.toHaveBeenCalled();
    });

    it('calls listeners on logout', async () => {
      await controller.login(validCreds);
      const listener = vi.fn();
      controller.subscribe(listener);

      controller.logout();

      expect(listener).toHaveBeenCalled();
    });
  });
});
