import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeleoDBController, type PreferencesPort } from './SpeleoDBController';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { HttpResponse } from '../services/HttpClient';
import type { AuthTokenResponse } from '../types';
import { PREFERENCES } from '../constants';
import { TilePrefetchService } from '../services/TilePrefetchService';
import type { Project } from '../types/project';

// ==================== Mocks ====================

function createMockService(overrides?: Partial<SpeleoDBService>): SpeleoDBService {
  const project: Project = {
    id: 'p1',
    name: 'Prefetch project',
    description: '',
    country: 'FR',
    type: 'survey',
    visibility: 'public',
    is_active: true,
    created_by: 'u',
    creation_date: '2025-01-01',
    modified_date: '2025-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: 'https://example.com/p1.geojson',
    latest_commit: {
      id: 'commit-1',
      message: 'init',
      author_email: 'u@example.com',
      author_name: 'User',
      authored_date: '2025-01-01',
      dt_since: 'today',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
  };

  return {
    authenticate: vi.fn(async () => ({ status: 200, data: { user: 'u@x.com', token: 'tok' } }) as HttpResponse<AuthTokenResponse>),
    validateToken: vi.fn(async () => ({ status: 200, data: {} }) as HttpResponse<unknown>),
    signup: vi.fn(async () => ({ status: 201, data: { user: { id: '1', email: 'a@b.com', name: 'A' } } }) as HttpResponse),
    getProjectsGeoJSON: vi.fn(async () => ({ status: 200, data: { data: [project] } }) as HttpResponse<unknown>),
    downloadJSON: vi.fn(async () => ({
      status: 200,
      data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      },
    }) as HttpResponse<unknown>),
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

function createMockCache(): ProjectCacheService {
  return {
    getProjects: vi.fn(async () => null),
    setProjects: vi.fn(async () => {}),
    getGeoJSON: vi.fn(async () => null),
    setGeoJSON: vi.fn(async () => {}),
    getCachedCommitId: vi.fn(async () => null),
    clearAll: vi.fn(async () => {}),
  } as unknown as ProjectCacheService;
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
  let cache: ReturnType<typeof createMockCache>;
  let controller: SpeleoDBController;

  beforeEach(() => {
    localStorage.clear();
    service = createMockService();
    prefs = createMockPrefs();
    cache = createMockCache();
    controller = new SpeleoDBController(service, prefs, cache);
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
      controller = new SpeleoDBController(service, prefs, cache);

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

      const fresh = new SpeleoDBController(service, restoredPrefs, cache);

      expect(fresh.isAuthenticated()).toBe(true);
      expect(fresh.currentUser?.email).toBe('restored@example.com');
    });

    it('stays unauthenticated when preferences are empty', () => {
      const emptyPrefs = createMockPrefs();
      const fresh = new SpeleoDBController(service, emptyPrefs, cache);

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
      const ctrl = new SpeleoDBController(service, withToken, cache);

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
      const ctrl = new SpeleoDBController(service, withToken, cache);

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
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const result = await ctrl.validateSession();
      expect(result).toBe('network_error');
      expect(ctrl.isOfflineLocked).toBe(true);
    });

    it('returns "unauthorized" when no token in preferences', async () => {
      const result = await controller.validateSession();
      expect(result).toBe('unauthorized');
    });

    it('uses startup auth timeout and unlocks on successful retry', async () => {
      const validateToken = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ status: 200, data: {} });
      service = createMockService({
        validateToken,
      });
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const first = await ctrl.validateSession();
      expect(first).toBe('network_error');
      expect(ctrl.isOfflineLocked).toBe(true);
      expect(validateToken).toHaveBeenNthCalledWith(
        1,
        'https://www.speleodb.org',
        't',
        3000,
      );

      const retried = await ctrl.retryConnection();
      expect(retried).toBe('ok');
      expect(ctrl.isOfflineLocked).toBe(false);
      expect(validateToken).toHaveBeenNthCalledWith(
        2,
        'https://www.speleodb.org',
        't',
        3000,
      );
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

  describe('syncProjects tile prefetch', () => {
    it('enqueues prefetch jobs after geojson sync', async () => {
      const enqueueProjects = vi.fn(async () => {});
      const subscribe = vi.fn(() => () => {});
      const mockTilePrefetch = {
        enqueueProjects,
        subscribe,
      } as unknown as TilePrefetchService;

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      prefs.setPreferences({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await Promise.resolve();

      expect(enqueueProjects).toHaveBeenCalledOnce();
      const firstCall = enqueueProjects.mock.calls.at(0);
      expect(firstCall).toBeDefined();
      if (!firstCall) return;
      const [projects, request] = firstCall as unknown as [
        Array<{ projectId: string }>,
        { minZoom: number; maxZoom: number; padMeters: number },
      ];
      expect(projects[0].projectId).toBe('p1');
      expect(request.minZoom).toBe(0);
      expect(request.maxZoom).toBe(18);
      expect(request.padMeters).toBe(50);

      onlineSpy.mockRestore();
    });

    it('does not call network project sync while offline lock is active', async () => {
      const validateToken = vi.fn(async () => {
        throw new Error('timeout');
      });
      service = createMockService({
        validateToken,
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.validateSession();
      expect(controller.isOfflineLocked).toBe(true);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).not.toHaveBeenCalled();
    });
  });

  describe('offline lock network gating', () => {
    it('skips online login call while offline lock is active', async () => {
      const validateToken = vi.fn(async () => {
        throw new Error('timeout');
      });
      service = createMockService({ validateToken });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.validateSession();
      expect(controller.isOfflineLocked).toBe(true);

      await controller.login(validCreds);
      expect(service.authenticate).not.toHaveBeenCalled();
    });
  });
});
