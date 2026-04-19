import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeleoDBController, type PreferencesPort } from './SpeleoDBController';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { HttpResponse } from '../services/HttpClient';
import type { AuthTokenResponse } from '../types';
import { TilePrefetchService } from '../services/TilePrefetchService';
import type { Project } from '../types/project';
import type { TilePrefetchJobState } from '../types/tilePrefetch';
import { getTile, upsertTile } from '../services/tileCache/TileCacheRepository';

function createProjectFixture(
  overrides: Omit<Partial<Project>, 'latest_commit'> & {
    latest_commit?: Partial<Project['latest_commit']>;
  } = {},
): Project {
  const { latest_commit: latestCommitOverrides, ...projectOverrides } = overrides;

  return {
    id: 'p1',
    name: 'Project',
    description: '',
    country: 'US',
    color: '#377eb8',
    type: 'COMPASS',
    visibility: 'PRIVATE',
    is_active: true,
    created_by: 'u@x.com',
    creation_date: '2026-01-01',
    modified_date: '2026-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: 'https://example.com/p1.geojson',
    ...projectOverrides,
    latest_commit: {
      id: 'c1',
      message: 'init',
      author_email: 'u@x.com',
      author_name: 'U',
      authored_date: '2026-01-01',
      dt_since: 'today',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
      ...latestCommitOverrides,
    },
  };
}

const DEFAULT_PROJECT = createProjectFixture({
  id: 'p1',
  name: 'Prefetch project',
  country: 'FR',
  latest_commit: {
    id: 'commit-1',
    author_email: 'u@example.com',
    author_name: 'User',
    authored_date: '2025-01-01',
  },
});

const V2_PROJECT = createProjectFixture({
  id: 'p-v2',
  name: 'V2 Project',
  geojson_file: 'https://example.com/p-v2.geojson',
});

// ==================== Mocks ====================

function createMockService(overrides?: Partial<SpeleoDBService>): SpeleoDBService {
  return {
    authenticate: vi.fn(async () => ({ status: 200, data: { user: 'u@x.com', token: 'tok' } }) as HttpResponse<AuthTokenResponse>),
    validateToken: vi.fn(async () => ({ status: 200, data: {} }) as HttpResponse<unknown>),
    getProjectsGeoJSON: vi.fn(async () => ({ status: 200, data: [DEFAULT_PROJECT] }) as HttpResponse<Project[]>),
    getLandmarksGeoJSON: vi.fn(async () => ({
      status: 200,
      data: { type: 'FeatureCollection', features: [] },
    }) as HttpResponse<GeoJSON.FeatureCollection>),
    getSubsurfaceStationsGeoJSON: vi.fn(async () => ({
      status: 200,
      data: { type: 'FeatureCollection', features: [] },
    }) as HttpResponse<GeoJSON.FeatureCollection>),
    getSurfaceStationsGeoJSON: vi.fn(async () => ({
      status: 200,
      data: { type: 'FeatureCollection', features: [] },
    }) as HttpResponse<GeoJSON.FeatureCollection>),
    getExplorationLeadsGeoJSON: vi.fn(async () => ({
      status: 200,
      data: { type: 'FeatureCollection', features: [] },
    }) as HttpResponse<GeoJSON.FeatureCollection>),
    getCylinderInstallsGeoJSON: vi.fn(async () => ({
      status: 200,
      data: { type: 'FeatureCollection', features: [] },
    }) as HttpResponse<GeoJSON.FeatureCollection>),
    downloadJSON: vi.fn(async () => ({
      status: 200,
      data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      },
    }) as HttpResponse<unknown>),
    ...overrides,
  } as unknown as SpeleoDBService;
}

type StoredPrefs = {
  email?: string;
  token?: string;
  instance?: string;
  lastSyncedAt?: number;
};

function createMockPrefs(initial?: StoredPrefs): PreferencesPort {
  let store: StoredPrefs = initial ?? {};
  return {
    getPreferences: vi.fn(() => ({ ...store })),
    setPreferences: vi.fn((p: Partial<StoredPrefs>) => {
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
    getOverlayGeoJSON: vi.fn(async () => null),
    setOverlayGeoJSON: vi.fn(async () => {}),
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

    it('accepts any 2xx auth response that includes a token body', async () => {
      service = createMockService({
        authenticate: vi.fn(async () => ({
          status: 201,
          data: { user: 'created@x.com', token: 'created-token' },
        }) as HttpResponse<AuthTokenResponse>),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.login(validCreds);

      expect(result.success).toBe(true);
      expect(result.token).toBe('created-token');
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.currentUser?.email).toBe('created@x.com');
      expect(prefs.setPreferences).toHaveBeenCalledWith({
        email: 'created@x.com',
        token: 'created-token',
        instance: validCreds.instance,
      });
    });

    it('rejects malformed 2xx auth responses that do not include a token', async () => {
      service = createMockService({
        authenticate: vi.fn(async () => ({
          status: 201,
          data: { user: 'created@x.com' },
        }) as HttpResponse<AuthTokenResponse | unknown>),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.login(validCreds);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Login failed');
      expect(controller.isAuthenticated()).toBe(false);
      expect(prefs.setPreferences).not.toHaveBeenCalled();
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

    it('clears preferences when token exists without instance', () => {
      const invalidPrefs = createMockPrefs({
        email: 'restored@example.com',
        token: 'saved-token',
      });

      const fresh = new SpeleoDBController(service, invalidPrefs, cache);

      expect(fresh.isAuthenticated()).toBe(false);
      expect(invalidPrefs.clearPreferences).toHaveBeenCalledOnce();
    });

    it('restores lastSyncedAt from preferences', () => {
      const restoredPrefs = createMockPrefs({
        email: 'restored@example.com',
        token: 'saved-token',
        instance: 'https://www.speleodb.org',
        lastSyncedAt: 1_710_000_000_000,
      });

      const fresh = new SpeleoDBController(service, restoredPrefs, cache);

      expect(fresh.lastSyncedAt).toBe(1_710_000_000_000);
    });

    it('keeps lastSyncedAt null when preferences omit it', () => {
      const restoredPrefs = createMockPrefs({
        email: 'restored@example.com',
        token: 'saved-token',
        instance: 'https://www.speleodb.org',
      });

      const fresh = new SpeleoDBController(service, restoredPrefs, cache);

      expect(fresh.lastSyncedAt).toBeNull();
    });
  });

  // ---- lastSyncedAt ---------------------------------------------------------

  describe('lastSyncedAt tracking', () => {
    it('starts at null on a fresh controller', () => {
      expect(controller.lastSyncedAt).toBeNull();
    });

    it('updates and persists lastSyncedAt after a successful sync', async () => {
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const before = Date.now();
      await ctrl.syncProjects();
      const after = Date.now();

      expect(ctrl.lastSyncedAt).not.toBeNull();
      expect(ctrl.lastSyncedAt!).toBeGreaterThanOrEqual(before);
      expect(ctrl.lastSyncedAt!).toBeLessThanOrEqual(after);
      expect(withToken.setPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ lastSyncedAt: ctrl.lastSyncedAt }),
      );
    });

    it('does not update lastSyncedAt when the sync request throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => { throw new Error('Network failure'); }),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      await ctrl.syncProjects();

      expect(ctrl.lastSyncedAt).toBeNull();
      expect(withToken.setPreferences).not.toHaveBeenCalledWith(
        expect.objectContaining({ lastSyncedAt: expect.anything() }),
      );
      warnSpy.mockRestore();
    });

    it('does not update lastSyncedAt when the server responds with a non-2xx status', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({ status: 500, data: {} }) as HttpResponse<Project[]>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      await ctrl.syncProjects();

      expect(ctrl.lastSyncedAt).toBeNull();
      expect(withToken.setPreferences).not.toHaveBeenCalledWith(
        expect.objectContaining({ lastSyncedAt: expect.anything() }),
      );
      warnSpy.mockRestore();
    });

    it('resets lastSyncedAt to null on logout', async () => {
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
        lastSyncedAt: 1_710_000_000_000,
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);
      expect(ctrl.lastSyncedAt).toBe(1_710_000_000_000);

      await ctrl.logout();

      expect(ctrl.lastSyncedAt).toBeNull();
    });

    it('still updates lastSyncedAt in memory when persistence throws', async () => {
      // Defensive try/catch in recordSuccessfulSync(): even if storage is
      // unavailable (quota, JSON failure, port misbehavior), the in-memory
      // timestamp must still reflect the successful sync so the UI updates.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const failingPrefs: PreferencesPort = {
        getPreferences: vi.fn(() => ({
          token: 'tok',
          instance: 'https://www.speleodb.org',
        })),
        setPreferences: vi.fn(({ lastSyncedAt }: { lastSyncedAt?: number }) => {
          if (typeof lastSyncedAt === 'number') {
            throw new Error('storage unavailable');
          }
        }) as unknown as PreferencesPort['setPreferences'],
        clearPreferences: vi.fn(),
      };
      const ctrl = new SpeleoDBController(service, failingPrefs, cache);

      const before = Date.now();
      await ctrl.syncProjects();
      const after = Date.now();

      expect(ctrl.lastSyncedAt).not.toBeNull();
      expect(ctrl.lastSyncedAt!).toBeGreaterThanOrEqual(before);
      expect(ctrl.lastSyncedAt!).toBeLessThanOrEqual(after);
      expect(failingPrefs.setPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ lastSyncedAt: ctrl.lastSyncedAt }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist lastSyncedAt:'),
        expect.any(Error),
      );
      warnSpy.mockRestore();
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

    it('does not rely on browser online hints for startup validation', async () => {
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const result = await ctrl.validateSession();

      expect(result).toBe('ok');
      expect(ctrl.isOfflineLocked).toBe(false);
      expect(service.validateToken).toHaveBeenCalledOnce();
      onlineSpy.mockRestore();
    });

    it('returns "unauthorized" when no token in preferences', async () => {
      const result = await controller.validateSession();
      expect(result).toBe('unauthorized');
    });

    it('returns "unauthorized" and clears preferences when token has no instance', async () => {
      const withInvalidPrefs = createMockPrefs({
        token: 't',
      });
      const ctrl = new SpeleoDBController(service, withInvalidPrefs, cache);

      const result = await ctrl.validateSession();
      expect(result).toBe('unauthorized');
      expect(withInvalidPrefs.clearPreferences).toHaveBeenCalled();
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
        10000,
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
      expect(service.getLandmarksGeoJSON).not.toHaveBeenCalled();
      expect(service.getSubsurfaceStationsGeoJSON).not.toHaveBeenCalled();
      expect(service.getSurfaceStationsGeoJSON).not.toHaveBeenCalled();
      expect(service.getExplorationLeadsGeoJSON).not.toHaveBeenCalled();
      expect(service.getCylinderInstallsGeoJSON).not.toHaveBeenCalled();
    });

    it('continues project sync when geojson downloads fail', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Default mock returns a single project with id 'p1' and a non-null
      // geojson_file; only override the failing transport call.
      service = createMockService({
        downloadJSON: vi.fn(async () => {
          throw new Error('Network dropped');
        }),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(service.downloadJSON).toHaveBeenCalledOnce();
      expect(cache.setGeoJSON).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cache geojson for project p1:'),
        expect.any(Error),
      );
    });

    it('skips project geojson cache writes for non-2xx download responses', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        downloadJSON: vi.fn(async <T = unknown>() => ({
          status: 403,
          data: { Code: 'AccessDenied' } as T,
        })) as unknown as SpeleoDBService['downloadJSON'],
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(service.downloadJSON).toHaveBeenCalledOnce();
      expect(cache.setGeoJSON).not.toHaveBeenCalled();
      expect(cache.setProjects).toHaveBeenCalledOnce();
      expect(controller.syncStatus).toBe('done');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping geojson cache for project p1: status 403'),
      );
    });

    it('syncs read-only overlay geojson payloads during project sync', async () => {
      const customFeatureCollection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { test: true }, geometry: { type: 'Point', coordinates: [0, 0] } }],
      };
      service = createMockService({
        getLandmarksGeoJSON: vi.fn(async () => ({
          status: 200,
          data: customFeatureCollection,
        }) as HttpResponse<GeoJSON.FeatureCollection | unknown>),
        getSubsurfaceStationsGeoJSON: vi.fn(async () => ({
          status: 200,
          data: customFeatureCollection,
        }) as HttpResponse<GeoJSON.FeatureCollection | unknown>),
        getSurfaceStationsGeoJSON: vi.fn(async () => ({
          status: 200,
          data: customFeatureCollection,
        }) as HttpResponse<GeoJSON.FeatureCollection | unknown>),
        getExplorationLeadsGeoJSON: vi.fn(async () => ({
          status: 200,
          data: customFeatureCollection,
        }) as HttpResponse<GeoJSON.FeatureCollection | unknown>),
        getCylinderInstallsGeoJSON: vi.fn(async () => ({
          status: 200,
          data: customFeatureCollection,
        }) as HttpResponse<GeoJSON.FeatureCollection | unknown>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getLandmarksGeoJSON).toHaveBeenCalledOnce();
      expect(service.getSubsurfaceStationsGeoJSON).toHaveBeenCalledOnce();
      expect(service.getSurfaceStationsGeoJSON).toHaveBeenCalledOnce();
      expect(service.getExplorationLeadsGeoJSON).toHaveBeenCalledOnce();
      expect(service.getCylinderInstallsGeoJSON).toHaveBeenCalledOnce();
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('landmarks', customFeatureCollection);
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('subsurfaceStations', customFeatureCollection);
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('surfaceStations', customFeatureCollection);
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('explorationLeads', customFeatureCollection);
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('cylinderInstalls', customFeatureCollection);
    });

    it('continues sync when one overlay endpoint fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const getLandmarksGeoJSON = vi.fn(async () => {
        throw new Error('overlay endpoint failed');
      });
      service = createMockService({
        getLandmarksGeoJSON,
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(cache.setProjects).toHaveBeenCalledOnce();
      expect(service.getSubsurfaceStationsGeoJSON).toHaveBeenCalledOnce();
      expect(service.getSurfaceStationsGeoJSON).toHaveBeenCalledOnce();
      expect(service.getExplorationLeadsGeoJSON).toHaveBeenCalledOnce();
      expect(service.getCylinderInstallsGeoJSON).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync overlay landmarks:'),
        expect.any(Error),
      );
    });

    it('skips malformed overlay payloads without blocking the rest of overlay sync', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        getLandmarksGeoJSON: vi.fn(async () => ({
          status: 200,
          data: { detail: 'not geojson' },
        }) as HttpResponse<GeoJSON.FeatureCollection | unknown>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(cache.setProjects).toHaveBeenCalledOnce();
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalledWith('landmarks', expect.anything());
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('subsurfaceStations', {
        type: 'FeatureCollection',
        features: [],
      });
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('surfaceStations', {
        type: 'FeatureCollection',
        features: [],
      });
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('explorationLeads', {
        type: 'FeatureCollection',
        features: [],
      });
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('cylinderInstalls', {
        type: 'FeatureCollection',
        features: [],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'Overlay sync skipped for landmarks: malformed 2xx payload',
      );
    });
  });

  // ==========================================================================
  // syncProjects v2 envelope-free contract
  //
  // Locks in that the controller treats the v2 response as a bare `Project[]`
  // (not the legacy `{ data, success, timestamp, url }` envelope) across the
  // success / 4xx / 5xx / transport-error matrix.
  //
  // Critical invariants:
  //   - non-2xx responses preserve cache and never overwrite projects state;
  //   - syncStatus surfaces 'error' iff there are no cached projects to show;
  //   - data-fetch 4xx never triggers logout / clearPreferences (only
  //     validateSession may, per docs/offline-mode.md).
  // ==========================================================================
  describe('syncProjects v2 envelope-free contract', () => {
    it('on 200 stores the bare Project[] body verbatim into the cache', async () => {
      const v2Body: Project[] = [V2_PROJECT];
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({
          status: 200,
          data: v2Body,
        }) as HttpResponse<Project[]>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(cache.setProjects).toHaveBeenCalledOnce();
      expect(cache.setProjects).toHaveBeenCalledWith(v2Body);
      expect(controller.projects).toEqual(v2Body);
      expect(controller.syncStatus).toBe('done');
      expect(controller.isOnline).toBe(true);
    });

    it('on 200 with an empty Project[]: clears stale cached projects and keeps sync successful', async () => {
      cache.getProjects = vi.fn(async () => [V2_PROJECT]);
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({
          status: 200,
          data: [],
        }) as HttpResponse<Project[]>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(controller.projects).toEqual([]);
      expect(cache.setProjects).toHaveBeenCalledWith([]);
      expect(service.downloadJSON).not.toHaveBeenCalled();
      expect(service.getLandmarksGeoJSON).toHaveBeenCalledOnce();
      expect(controller.syncStatus).toBe('done');
      expect(controller.isOnline).toBe(true);
    });

    it('on 200 with a legacy envelope body: treats the payload as malformed and skips side-effects', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({
          status: 200,
          data: { data: [V2_PROJECT] },
        }) as HttpResponse<Project[] | unknown>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(controller.projects).toEqual([]);
      expect(cache.setProjects).not.toHaveBeenCalled();
      expect(service.downloadJSON).not.toHaveBeenCalled();
      expect(service.getLandmarksGeoJSON).not.toHaveBeenCalled();
      expect(controller.syncStatus).toBe('error');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('syncProjects: refresh skipped (status=200)'),
      );
    });

    it('on 4xx with empty cache: surfaces error, skips cache write, skips overlay sync, never logs out', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({
          status: 401,
          data: { detail: 'Invalid token.' },
        }) as HttpResponse<Project[] | unknown>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(cache.setProjects).not.toHaveBeenCalled();
      expect(service.getLandmarksGeoJSON).not.toHaveBeenCalled();
      expect(service.getSubsurfaceStationsGeoJSON).not.toHaveBeenCalled();
      expect(service.getSurfaceStationsGeoJSON).not.toHaveBeenCalled();
      expect(service.getExplorationLeadsGeoJSON).not.toHaveBeenCalled();
      expect(service.getCylinderInstallsGeoJSON).not.toHaveBeenCalled();
      expect(controller.projects).toEqual([]);
      expect(controller.syncStatus).toBe('error');
      // Data-fetch 4xx must NOT trigger logout or preference clearing -- only
      // validateSession may (see docs/offline-mode.md).
      expect(withToken.clearPreferences).not.toHaveBeenCalled();
      expect(controller.isAuthenticated()).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('syncProjects: refresh skipped (status=401)'),
      );
    });

    it('on 4xx with cached projects: keeps cache, reports done, never logs out', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cache.getProjects = vi.fn(async () => [V2_PROJECT]);
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({
          status: 401,
          data: { detail: 'Invalid token.' },
        }) as HttpResponse<Project[] | unknown>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(controller.projects).toEqual([V2_PROJECT]);
      expect(controller.syncStatus).toBe('done');
      expect(cache.setProjects).not.toHaveBeenCalled();
      expect(withToken.clearPreferences).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('syncProjects: refresh skipped (status=401)'),
      );
    });

    it('on 5xx with empty cache: surfaces error, skips cache write, skips overlay sync', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({
          status: 500,
          data: { detail: 'Internal server error.' },
        }) as HttpResponse<Project[] | unknown>),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(cache.setProjects).not.toHaveBeenCalled();
      expect(service.getLandmarksGeoJSON).not.toHaveBeenCalled();
      expect(controller.projects).toEqual([]);
      expect(controller.syncStatus).toBe('error');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('syncProjects: refresh skipped (status=500)'),
      );
    });

    it('on transport rejection sets syncStatus to "error" when cache is empty', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => {
          throw new Error('Network dropped');
        }),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(service.getProjectsGeoJSON).toHaveBeenCalledOnce();
      expect(cache.setProjects).not.toHaveBeenCalled();
      expect(controller.projects).toEqual([]);
      expect(controller.syncStatus).toBe('error');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('syncProjects: API fetch failed:'),
        expect.any(Error),
      );
    });

    it('on transport rejection keeps syncStatus "done" when cached projects exist', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cache.getProjects = vi.fn(async () => [V2_PROJECT]);
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => {
          throw new Error('Network dropped');
        }),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      await controller.syncProjects();

      expect(controller.projects).toEqual([V2_PROJECT]);
      expect(controller.syncStatus).toBe('done');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('syncProjects: API fetch failed:'),
        expect.any(Error),
      );
    });
  });

  describe('overlay cache reads', () => {
    it('returns overlay geojson from cache service', async () => {
      const payload = { type: 'FeatureCollection', features: [] };
      cache.getOverlayGeoJSON = vi.fn(async () => payload);

      const result = await controller.getOverlayGeoJSON('landmarks');

      expect(cache.getOverlayGeoJSON).toHaveBeenCalledWith('landmarks');
      expect(result).toEqual(payload);
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

      const result = await controller.login(validCreds);

      expect(result.success).toBe(true);
      expect(service.authenticate).not.toHaveBeenCalled();
    });
  });
});
