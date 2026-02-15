import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeleoDBController, type PreferencesPort } from './SpeleoDBController';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { HttpResponse } from '../services/HttpClient';
import type { AuthTokenResponse } from '../types';
import { PREFERENCES } from '../constants';
import { TilePrefetchService } from '../services/TilePrefetchService';
import type { Project, ProjectsGeoJSONResponse } from '../types/project';
import type { TilePrefetchJobState } from '../types/tilePrefetch';
import { getTile, upsertTile } from '../services/tileCache/TileCacheRepository';

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
    it('clears auth state and removes persisted preferences', async () => {
      await controller.login(validCreds);
      expect(controller.isAuthenticated()).toBe(true);

      await controller.logout();

      expect(controller.isAuthenticated()).toBe(false);
      expect(controller.currentUser).toBeNull();
      expect(prefs.clearPreferences).toHaveBeenCalledOnce();
    });

    it('clears local pending sync queue and offline users on logout', async () => {
      localStorage.setItem('speleo_pending_sync', JSON.stringify([{ type: 'signup' }]));
      localStorage.setItem(
        'speleo_users_db',
        JSON.stringify({ 'user@example.com': { password: 'pass', user: { id: '1' } } }),
      );
      await controller.logout();

      expect(localStorage.getItem('speleo_pending_sync')).toBeNull();
      expect(localStorage.getItem('speleo_users_db')).toBeNull();
    });

    it('clears cached map tiles on logout', async () => {
      const tileUrl = 'https://tiles.example.com/logout-clear.png';
      await upsertTile(tileUrl, new Uint8Array([1, 2, 3]).buffer, {
        pinnedByAutoPrefetch: false,
      });
      expect(await getTile(tileUrl)).not.toBeNull();

      await controller.logout();

      expect(await getTile(tileUrl)).toBeNull();
    });

    it('waits for project cache cleanup before resolving logout', async () => {
      const mockTilePrefetch = {
        subscribe: vi.fn(() => () => {}),
        enqueueProjects: vi.fn(async () => {}),
        waitForIdle: vi.fn(async () => {}),
        dispose: vi.fn(),
      } as unknown as TilePrefetchService;
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      const clearAllResolver: { fn?: () => void } = {};
      cache.clearAll = vi.fn(
        () => new Promise<void>((resolve) => {
          clearAllResolver.fn = () => resolve();
        }),
      );

      let logoutResolved = false;
      const logoutPromise = controller.logout().then(() => {
        logoutResolved = true;
      });

      await Promise.resolve();
      expect(cache.clearAll).toHaveBeenCalledOnce();
      expect(logoutResolved).toBe(false);

      if (!clearAllResolver.fn) throw new Error('clearAll resolver should be defined');
      clearAllResolver.fn();
      await logoutPromise;
      expect(logoutResolved).toBe(true);
    });

    it('tears down in-memory tile prefetch runtime state on logout', async () => {
      const unsubscribe = vi.fn();
      let listener: (jobs: TilePrefetchJobState[]) => void = () => {};
      const mockTilePrefetch = {
        subscribe: vi.fn((cb: (jobs: TilePrefetchJobState[]) => void) => {
          listener = cb;
          return unsubscribe;
        }),
        enqueueProjects: vi.fn(async () => {}),
        dispose: vi.fn(),
      } as unknown as TilePrefetchService;
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      listener([{
        projectId: 'p1',
        commitId: 'c1',
        status: 'queued',
        zoomMin: 0,
        zoomMax: 0,
        padMeters: 50,
        totalTiles: 1,
        completedTiles: 0,
        failedTiles: 0,
        bytesDownloaded: 0,
        estimatedBytes: 0,
        updatedAt: Date.now(),
      }]);
      expect(controller.tilePrefetchJobs.length).toBe(1);

      await controller.logout();

      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(mockTilePrefetch.dispose).toHaveBeenCalledOnce();
      expect(controller.tilePrefetchJobs.length).toBe(0);
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
      expect(ctrl.isAuthenticated()).toBe(false);
      expect(withToken.clearPreferences).toHaveBeenCalledOnce();
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
      expect(ctrl.isAuthenticated()).toBe(true);
      expect(withToken.clearPreferences).not.toHaveBeenCalled();
    });

    it('skips startup network call when browser is offline', async () => {
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const result = await ctrl.validateSession();

      expect(result).toBe('network_error');
      expect(ctrl.isOfflineLocked).toBe(true);
      expect(service.validateToken).not.toHaveBeenCalled();
      onlineSpy.mockRestore();
    });

    it('returns "unauthorized" when no token in preferences', async () => {
      const result = await controller.validateSession();
      expect(result).toBe('unauthorized');
    });

    it('keeps session on disconnect and allows retry recovery', async () => {
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
      expect(ctrl.isAuthenticated()).toBe(true);
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
      expect(validateToken).toHaveBeenCalledTimes(2);
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

      await controller.logout();

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
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.isOfflineLocked).toBe(true);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).not.toHaveBeenCalled();
    });

    it('skips geojson download stage if network drops after project list fetch', async () => {
      let online = true;
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async (_instance: string, _token: string) => {
          online = false;
          return {
            status: 200,
            data: {
              data: [{
                id: 'p1',
                name: 'Project 1',
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
                  id: 'c1',
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
              }],
              success: true,
              timestamp: '2026-01-01T00:00:00.000Z',
              url: 'https://www.speleodb.org/api/v1/projects/geojson/',
            },
          } as HttpResponse<ProjectsGeoJSONResponse>;
        }),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(service.downloadJSON).not.toHaveBeenCalled();
      onlineSpy.mockRestore();
    });
  });

  describe('disconnect login behavior', () => {
    it('preserves offline users after disconnect timeout', async () => {
      const validateToken = vi.fn(async () => {
        throw new Error('timeout');
      });
      service = createMockService({ validateToken });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);
      localStorage.setItem(
        'speleo_users_db',
        JSON.stringify({
          'user@example.com': {
            password: 'pass',
            user: { id: '1', email: 'user@example.com', name: 'User' },
          },
        }),
      );

      await controller.validateSession();
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.isOfflineLocked).toBe(true);

      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const result = await controller.login(validCreds);
      onlineSpy.mockRestore();

      expect(result.success).toBe(true);
      expect(service.authenticate).not.toHaveBeenCalled();
    });
  });
});
