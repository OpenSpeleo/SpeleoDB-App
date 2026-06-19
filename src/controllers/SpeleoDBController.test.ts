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
import { allowConsoleWarn } from '../test/consoleGuard';
import { createAbortError } from '../utils/abort';

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
  tileCacheOverLimitApproved?: boolean;
  tileCacheOverLimitPromptAcknowledged?: boolean;
  selectedMapLayerId?: string;
  layerOfflineSync?: Record<string, boolean>;
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
    setProjects: vi.fn(async () => true),
    getGeoJSON: vi.fn(async () => null),
    setGeoJSON: vi.fn(async () => true),
    getOverlayGeoJSON: vi.fn(async () => null),
    setOverlayGeoJSON: vi.fn(async () => true),
    getCachedCommitId: vi.fn(async () => null),
    clearAll: vi.fn(async () => {}),
  } as unknown as ProjectCacheService;
}

function createMockTilePrefetch(
  overrides: Partial<TilePrefetchService> = {},
): TilePrefetchService {
  return {
    enqueueProjects: vi.fn(async () => {}),
    enqueueTileUrls: vi.fn(async () => {}),
    removeLayer: vi.fn(async () => {}),
    resumeBlockedJobs: vi.fn(),
    subscribe: vi.fn((listener: (jobs: TilePrefetchJobState[]) => void) => {
      listener([]);
      return () => {};
    }),
    waitForIdle: vi.fn(async () => {}),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as TilePrefetchService;
}

/**
 * A tile-prefetch mock whose subscribed jobs can be driven from the test, so we
 * can simulate a storage-blocked job reaching the controller.
 */
function createControllableTilePrefetch() {
  let listenerRef: (jobs: TilePrefetchJobState[]) => void = () => {};
  const resumeBlockedJobs = vi.fn();
  const service = {
    enqueueProjects: vi.fn(async () => {}),
    enqueueTileUrls: vi.fn(async () => {}),
    removeLayer: vi.fn(async () => {}),
    resumeBlockedJobs,
    subscribe: vi.fn((listener: (jobs: TilePrefetchJobState[]) => void) => {
      listenerRef = listener;
      listener([]);
      return () => {};
    }),
    waitForIdle: vi.fn(async () => {}),
    dispose: vi.fn(),
  } as unknown as TilePrefetchService;
  return {
    service,
    resumeBlockedJobs,
    emit: (jobs: TilePrefetchJobState[]) => listenerRef(jobs),
  };
}

function blockedLandmarkJob(): TilePrefetchJobState {
  return {
    layerId: 'esri-satellite',
    projectId: 'landmarks',
    commitId: 'sig-1',
    status: 'paused',
    zoomMin: 0,
    zoomMax: 18,
    padMeters: 50,
    totalTiles: 10,
    completedTiles: 0,
    failedTiles: 0,
    bytesDownloaded: 0,
    estimatedBytes: 0,
    blockedByStorage: true,
    updatedAt: 1,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
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

      await flushPromises(3);
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
        layerId: 'esri-satellite',
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

    it('drops non-positive lastSyncedAt values during restore', () => {
      const restoredPrefs = createMockPrefs({
        email: 'restored@example.com',
        token: 'saved-token',
        instance: 'https://www.speleodb.org',
        lastSyncedAt: 0,
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
      allowConsoleWarn(
        expect.stringContaining('syncProjects: API fetch failed:'),
        expect.any(Error),
      );
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
    });

    it('does not update lastSyncedAt when the server responds with a non-2xx status', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: refresh skipped (status=500)'),
      );
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
      allowConsoleWarn(
        expect.stringContaining('Failed to persist lastSyncedAt:'),
        expect.any(Error),
      );
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

    it('keeps session on disconnect and does not retry in-process while offline-locked', async () => {
      const validateToken = vi.fn()
        .mockRejectedValue(new Error('timeout'));
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
        expect.objectContaining({
          timeoutMs: 10000,
          signal: expect.any(AbortSignal),
        }),
      );

      const second = await ctrl.validateSession();
      expect(second).toBe('network_error');
      expect(ctrl.isOfflineLocked).toBe(true);
      expect(validateToken).toHaveBeenCalledTimes(1);
    });

    it('ignores stale validation results after logout invalidates the session', async () => {
      const deferred = createDeferred<HttpResponse<unknown>>();
      service = createMockService({
        validateToken: vi.fn(() => deferred.promise),
      });
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const validationPromise = ctrl.validateSession();
      const logoutPromise = ctrl.logout();
      await logoutPromise;
      deferred.reject(new Error('timeout'));

      const result = await validationPromise;

      expect(result).toBe('unauthorized');
      expect(ctrl.isAuthenticated()).toBe(false);
      expect(ctrl.isOfflineLocked).toBe(false);
    });
  });

  // ---- attemptReconnect (Settings "Go Online") ------------------------------

  describe('attemptReconnect', () => {
    function offlineLockedController(validateToken: ReturnType<typeof vi.fn>) {
      const withToken = createMockPrefs({
        token: 't',
        instance: 'https://www.speleodb.org',
      });
      service = createMockService({
        validateToken: validateToken as unknown as SpeleoDBService['validateToken'],
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);
      return { ctrl, withToken };
    }

    it('returns "ok", clears the offline lock, and launches a sync on 2xx', async () => {
      // First probe fails (locks offline); the reconnect probe succeeds.
      const validateToken = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ status: 200, data: {} } as HttpResponse<unknown>);
      const { ctrl } = offlineLockedController(validateToken);

      expect(await ctrl.validateSession()).toBe('network_error');
      expect(ctrl.isOfflineLocked).toBe(true);

      const result = await ctrl.attemptReconnect();
      await flushPromises(8);

      expect(result).toBe('ok');
      expect(ctrl.isOfflineLocked).toBe(false);
      expect(ctrl.isOnline).toBe(true);
      // Probed the server even though it was offline-locked (unlike validateSession).
      expect(validateToken).toHaveBeenCalledTimes(2);
      // The success path launches a project sync.
      expect(service.getProjectsGeoJSON).toHaveBeenCalled();
    });

    it('returns "network_error", stays offline-locked, and does not sync or logout', async () => {
      const validateToken = vi.fn().mockRejectedValue(new Error('timeout'));
      const { ctrl, withToken } = offlineLockedController(validateToken);

      expect(await ctrl.validateSession()).toBe('network_error');
      expect(ctrl.isOfflineLocked).toBe(true);

      const result = await ctrl.attemptReconnect();
      await flushPromises(4);

      expect(result).toBe('network_error');
      expect(ctrl.isOfflineLocked).toBe(true);
      expect(ctrl.isAuthenticated()).toBe(true);
      expect(withToken.clearPreferences).not.toHaveBeenCalled();
      expect(service.getProjectsGeoJSON).not.toHaveBeenCalled();
    });

    it('returns "unauthorized" and logs out on 4xx', async () => {
      const validateToken = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ status: 401, data: {} } as HttpResponse<unknown>);
      const { ctrl, withToken } = offlineLockedController(validateToken);

      expect(await ctrl.validateSession()).toBe('network_error');

      const result = await ctrl.attemptReconnect();

      expect(result).toBe('unauthorized');
      expect(ctrl.isAuthenticated()).toBe(false);
      expect(withToken.clearPreferences).toHaveBeenCalled();
      expect(service.getProjectsGeoJSON).not.toHaveBeenCalled();
    });
  });

  // ---- Runtime online -> offline transition (failed Resync) -----------------

  describe('syncProjects runtime offline transition', () => {
    function onlineController() {
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      cache.getProjects = vi.fn(async () => [DEFAULT_PROJECT]);
      const ctrl = new SpeleoDBController(service, withToken, cache);
      return { ctrl, withToken };
    }

    it('flips offline (cache preserved, no logout) when the refresh hits a transport error', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: API fetch failed:'),
        expect.any(Error),
      );
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => { throw new Error('Network failure'); }),
      });
      const { ctrl, withToken } = onlineController();
      expect(ctrl.isOfflineLocked).toBe(false);

      await ctrl.syncProjects();

      expect(ctrl.isOfflineLocked).toBe(true);
      expect(ctrl.isOnline).toBe(false);
      expect(ctrl.isAuthenticated()).toBe(true);
      expect(ctrl.projects).toEqual([DEFAULT_PROJECT]);
      expect(withToken.clearPreferences).not.toHaveBeenCalled();
    });

    it('flips offline when the refresh returns a 5xx', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: refresh skipped (status=500)'),
      );
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({ status: 500, data: {} }) as HttpResponse<Project[]>),
      });
      const { ctrl } = onlineController();

      await ctrl.syncProjects();

      expect(ctrl.isOfflineLocked).toBe(true);
      expect(ctrl.isOnline).toBe(false);
      expect(ctrl.isAuthenticated()).toBe(true);
    });

    it('does NOT flip offline or logout on a 4xx refresh', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: refresh skipped (status=403)'),
      );
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({ status: 403, data: {} }) as HttpResponse<Project[]>),
      });
      const { ctrl, withToken } = onlineController();

      await ctrl.syncProjects();

      expect(ctrl.isOfflineLocked).toBe(false);
      expect(ctrl.isAuthenticated()).toBe(true);
      expect(withToken.clearPreferences).not.toHaveBeenCalled();
    });

    it('does NOT flip offline when the refresh is aborted', async () => {
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => { throw createAbortError(); }),
      });
      const { ctrl } = onlineController();

      await ctrl.syncProjects();

      expect(ctrl.isOfflineLocked).toBe(false);
      expect(ctrl.isAuthenticated()).toBe(true);
    });
  });

  describe('syncProjects invalidation', () => {
    it('does not restore projects or lastSyncedAt after logout while sync is waiting on the API', async () => {
      const response = createDeferred<HttpResponse<Project[]>>();
      service = createMockService({
        getProjectsGeoJSON: vi.fn(() => response.promise),
      });
      cache.getProjects = vi.fn(async () => null);
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const syncPromise = ctrl.syncProjects();
      const logoutPromise = ctrl.logout();

      response.resolve({ status: 200, data: [DEFAULT_PROJECT] });

      await Promise.all([syncPromise, logoutPromise]);

      expect(ctrl.isAuthenticated()).toBe(false);
      expect(ctrl.projects).toEqual([]);
      expect(ctrl.lastSyncedAt).toBeNull();
      expect(cache.setProjects).not.toHaveBeenCalled();
    });

    it('does not write cached geojson after logout invalidates an in-flight sync', async () => {
      const download = createDeferred<HttpResponse<unknown>>();
      service = createMockService({
        getProjectsGeoJSON: vi.fn(async () => ({ status: 200, data: [DEFAULT_PROJECT] }) as HttpResponse<Project[]>),
        downloadJSON: vi.fn(() => download.promise) as unknown as SpeleoDBService['downloadJSON'],
      });
      cache.getProjects = vi.fn(async () => null);
      cache.getCachedCommitId = vi.fn(async () => null);
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);

      const syncPromise = ctrl.syncProjects();
      await flushPromises(8);
      expect(service.downloadJSON).toHaveBeenCalledOnce();

      const logoutPromise = ctrl.logout();

      download.resolve({
        status: 200,
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
        },
      });

      await Promise.all([syncPromise, logoutPromise]);

      expect(ctrl.isAuthenticated()).toBe(false);
      expect(cache.setGeoJSON).not.toHaveBeenCalled();
      expect(ctrl.projects).toEqual([]);
      expect(ctrl.lastSyncedAt).toBeNull();
    });

    it('does not re-lock offline when a non-abort refresh failure lands after logout', async () => {
      // Regression: a logged-out (aborted) sync whose refresh rejects with a
      // non-abort transport error must NOT call enterOfflineMode() -- otherwise
      // a logged-out controller wrongly reports isOfflineLocked === true. With
      // the staleness guard, the aborted context rethrows before the warn fires.
      const response = createDeferred<HttpResponse<Project[]>>();
      service = createMockService({
        getProjectsGeoJSON: vi.fn(() => response.promise),
      });
      cache.getProjects = vi.fn(async () => null);
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      const ctrl = new SpeleoDBController(service, withToken, cache);
      expect(ctrl.isOfflineLocked).toBe(false);

      const syncPromise = ctrl.syncProjects();
      // Let the refresh reach (and await) the in-flight fetch before logout.
      await flushPromises(8);

      const logoutPromise = ctrl.logout();

      // The in-flight refresh settles with a real (non-abort) network error
      // *after* logout already aborted the sync context and cleared the lock.
      response.reject(new Error('Network failure'));

      await Promise.all([syncPromise, logoutPromise]);

      expect(ctrl.isAuthenticated()).toBe(false);
      expect(ctrl.isOfflineLocked).toBe(false);
      expect(ctrl.isOnline).toBe(false);
    });
  });

  describe('syncProjects phase results', () => {
    it('returns explicit per-phase results for a successful sync', async () => {
      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(
        service,
        withToken,
        cache,
        createMockTilePrefetch(),
      );

      const result = await controller.syncProjects();

      expect(result.status).toBe('done');
      expect(result.runId).toBeGreaterThan(0);
      expect(result.phases.cacheLoad).toEqual(expect.objectContaining({
        phase: 'cache_load',
        status: 'skipped',
      }));
      expect(result.phases.projectRefresh).toEqual(expect.objectContaining({
        phase: 'project_refresh',
        status: 'applied',
        projectCount: 1,
        cacheWriteSucceeded: true,
      }));
      expect(result.phases.geojsonSync).toEqual(expect.objectContaining({
        phase: 'geojson_sync',
        status: 'applied',
        eligibleProjectCount: 1,
        downloadedProjectCount: 1,
      }));
      expect(result.phases.overlaySync).toEqual(expect.objectContaining({
        phase: 'overlay_sync',
        status: 'applied',
        attemptedOverlayCount: 5,
        syncedOverlayCount: 5,
      }));
      expect(result.phases.tilePrefetch).toEqual(expect.objectContaining({
        phase: 'tile_prefetch',
        status: 'applied',
        eligibleProjectCount: 1,
        scheduledProjectCount: 1,
      }));
    });

    it('aborts an older sync run when a newer sync starts', async () => {
      const firstResponse = createDeferred<HttpResponse<Project[]>>();
      const secondProject = createProjectFixture({
        id: 'p2',
        name: 'Newest Project',
        latest_commit: {
          id: 'commit-2',
        },
      });
      let requestCount = 0;
      service = createMockService({
        getProjectsGeoJSON: vi.fn(() => {
          requestCount += 1;
          if (requestCount === 1) {
            return firstResponse.promise;
          }

          return Promise.resolve({
            status: 200,
            data: [secondProject],
          }) as Promise<HttpResponse<Project[]>>;
        }) as unknown as SpeleoDBService['getProjectsGeoJSON'],
      });
      cache.getProjects = vi.fn(async () => null);
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache);

      const firstSync = controller.syncProjects();
      await flushPromises(2);
      const secondSync = controller.syncProjects();
      await flushPromises(8);

      firstResponse.resolve({
        status: 200,
        data: [DEFAULT_PROJECT],
      });

      const [firstResult, secondResult] = await Promise.all([firstSync, secondSync]);

      expect(firstResult.status).toBe('aborted');
      expect(secondResult.status).toBe('done');
      expect(controller.projects).toEqual([secondProject]);
      expect(cache.setProjects).toHaveBeenCalledTimes(1);
      expect(cache.setProjects).toHaveBeenCalledWith(
        [secondProject],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
      controller = new SpeleoDBController(
        service,
        prefs,
        cache,
        createMockTilePrefetch(),
      );
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
        enqueueTileUrls: vi.fn(async () => {}),
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

    it('enqueues a combined landmarks tile prefetch job from cached landmark points', async () => {
      const enqueueTileUrls = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects: vi.fn(async () => {}),
        enqueueTileUrls,
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));
      cache.getOverlayGeoJSON = vi.fn(async (id: string) =>
        id === 'landmarks'
          ? {
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [10.4, 45.3] } },
                { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-73.9, 40.7] } },
              ],
            }
          : null,
      );

      prefs.setPreferences({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      const result = await controller.syncProjects();
      await Promise.resolve();

      expect(enqueueTileUrls).toHaveBeenCalledOnce();
      const [target] = enqueueTileUrls.mock.calls.at(0) as unknown as [
        { id: string; commitId: string; tileUrls: string[]; zoomMin: number; zoomMax: number; padMeters: number },
      ];
      expect(target.id).toBe('landmarks');
      expect(target.zoomMin).toBe(0);
      expect(target.zoomMax).toBe(18);
      expect(target.padMeters).toBe(50);
      expect(target.tileUrls.length).toBeGreaterThan(0);
      expect(target.commitId).toMatch(/^sig-2-/);
      expect(result.phases.tilePrefetch.landmarkScheduled).toBe(true);
      expect(result.phases.tilePrefetch.landmarkTileCount).toBe(target.tileUrls.length);
    });

    it('skips landmark tile prefetch when there are no landmark points', async () => {
      const enqueueTileUrls = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects: vi.fn(async () => {}),
        enqueueTileUrls,
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      cache.getOverlayGeoJSON = vi.fn(async () => ({ type: 'FeatureCollection', features: [] }));

      prefs.setPreferences({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      const result = await controller.syncProjects();

      expect(enqueueTileUrls).not.toHaveBeenCalled();
      expect(result.phases.tilePrefetch.landmarkScheduled).toBe(false);
      expect(result.phases.tilePrefetch.landmarkTileCount).toBe(0);
    });

    it('produces a stable landmark signature across repeated syncs', async () => {
      const enqueueTileUrls = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects: vi.fn(async () => {}),
        enqueueTileUrls,
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      cache.getOverlayGeoJSON = vi.fn(async (id: string) =>
        id === 'landmarks'
          ? {
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [10.4, 45.3] } },
              ],
            }
          : null,
      );

      prefs.setPreferences({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await controller.syncProjects();

      const first = enqueueTileUrls.mock.calls.at(0) as unknown as [{ commitId: string }];
      const second = enqueueTileUrls.mock.calls.at(1) as unknown as [{ commitId: string }];
      expect(first[0].commitId).toBe(second[0].commitId);
    });

    it('schedules satellite first, then enabled extra layers at their max zoom', async () => {
      const enqueueProjects = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects,
        enqueueTileUrls: vi.fn(async () => {}),
        removeLayer: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      prefs.setPreferences({
        token: 'tok',
        instance: 'https://www.speleodb.org',
        layerOfflineSync: { 'esri-world-hillshade': true },
      });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await Promise.resolve();

      const calls = enqueueProjects.mock.calls as unknown as Array<
        [unknown, { maxZoom: number; tileUrlTemplate: string }, { layerId?: string } | undefined]
      >;
      const layerIds = calls.map((c) => c[2]?.layerId);
      expect(layerIds[0]).toBe('esri-satellite');
      expect(layerIds).toContain('esri-world-hillshade');

      const hillCall = calls.find((c) => c[2]?.layerId === 'esri-world-hillshade');
      expect(hillCall).toBeDefined();
      const request = hillCall![1];
      // Hillshade matches satellite's z18 for offline parity.
      expect(request.maxZoom).toBe(18);
      expect(request.tileUrlTemplate).toContain('World_Hillshade');
    });

    it('schedules only satellite when no extra layers are enabled', async () => {
      const enqueueProjects = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects,
        enqueueTileUrls: vi.fn(async () => {}),
        removeLayer: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      prefs.setPreferences({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await Promise.resolve();

      const calls = enqueueProjects.mock.calls as unknown as Array<
        [unknown, unknown, { layerId?: string } | undefined]
      >;
      const layerIds = calls.map((c) => c[2]?.layerId);
      expect(layerIds).toEqual(['esri-satellite']);
    });

    it('setLayerOfflineSync(true) persists opt-in and schedules that layer', async () => {
      const enqueueProjects = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects,
        enqueueTileUrls: vi.fn(async () => {}),
        removeLayer: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      prefs.setPreferences({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);
      await controller.syncProjects();
      enqueueProjects.mockClear();

      await controller.setLayerOfflineSync('esri-world-hillshade', true);

      expect(prefs.getPreferences().layerOfflineSync?.['esri-world-hillshade']).toBe(true);
      const calls = enqueueProjects.mock.calls as unknown as Array<
        [unknown, unknown, { layerId?: string } | undefined]
      >;
      const hillCall = calls.find((c) => c[2]?.layerId === 'esri-world-hillshade');
      expect(hillCall).toBeDefined();
    });

    it('setLayerOfflineSync(false) removes jobs and evicts the layer tiles', async () => {
      const removeLayer = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects: vi.fn(async () => {}),
        enqueueTileUrls: vi.fn(async () => {}),
        removeLayer,
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      prefs.setPreferences({
        token: 'tok',
        instance: 'https://www.speleodb.org',
        layerOfflineSync: { 'esri-world-hillshade': true },
      });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      const hillTileUrl =
        'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/5/1/2';
      await upsertTile(hillTileUrl, new Uint8Array([1, 2, 3]).buffer, {
        pinnedByAutoPrefetch: true,
      });
      expect(await getTile(hillTileUrl)).not.toBeNull();

      await controller.setLayerOfflineSync('esri-world-hillshade', false);

      expect(prefs.getPreferences().layerOfflineSync?.['esri-world-hillshade']).toBe(false);
      expect(removeLayer).toHaveBeenCalledWith('esri-world-hillshade');
      expect(await getTile(hillTileUrl)).toBeNull();
    });

    it('setLayerOfflineSync ignores the forced satellite layer', async () => {
      const removeLayer = vi.fn(async () => {});
      const enqueueProjects = vi.fn(async () => {});
      const mockTilePrefetch = {
        enqueueProjects,
        enqueueTileUrls: vi.fn(async () => {}),
        removeLayer,
        subscribe: vi.fn(() => () => {}),
      } as unknown as TilePrefetchService;

      prefs.setPreferences({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.setLayerOfflineSync('esri-satellite', false);

      expect(removeLayer).not.toHaveBeenCalled();
      expect(enqueueProjects).not.toHaveBeenCalled();
      expect(prefs.getPreferences().layerOfflineSync?.['esri-satellite']).toBeUndefined();
    });

    it('aborts an in-flight layer prefetch when the user logs out', async () => {
      const enqueueProjects = vi.fn(async () => {});
      const enqueueTileUrls = vi.fn(async () => {});
      const mockTilePrefetch = createMockTilePrefetch({ enqueueProjects, enqueueTileUrls });

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } },
        ],
      }));

      prefs.setPreferences({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);
      await controller.syncProjects();
      enqueueProjects.mockClear();
      enqueueTileUrls.mockClear();

      // Now hang the *layer* prefetch at the landmark-load step so we can log
      // out while it is in flight (sync above used the default null overlay).
      const deferred = createDeferred<GeoJSON.FeatureCollection | null>();
      cache.getOverlayGeoJSON = vi.fn(() => deferred.promise);

      const pending = controller.setLayerOfflineSync('esri-world-hillshade', true);
      await flushPromises(3);

      // Logging out must abort the layer-prefetch context (not just the sync /
      // validation contexts), so the in-flight prefetch bails before enqueueing.
      await controller.logout();

      deferred.resolve(null);
      await pending;

      expect(enqueueTileUrls).not.toHaveBeenCalled();
      expect(enqueueProjects).not.toHaveBeenCalled();
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
      allowConsoleWarn(
        expect.stringContaining('Failed to cache geojson for project p1:'),
        expect.any(Error),
      );
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
    });

    it('skips project geojson cache writes for non-2xx download responses', async () => {
      allowConsoleWarn(
        expect.stringContaining('Skipping geojson cache for project p1: status 403'),
      );
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
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith(
        'landmarks',
        customFeatureCollection,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith(
        'subsurfaceStations',
        customFeatureCollection,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith(
        'surfaceStations',
        customFeatureCollection,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith(
        'explorationLeads',
        customFeatureCollection,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith(
        'cylinderInstalls',
        customFeatureCollection,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('continues sync when one overlay endpoint fails', async () => {
      allowConsoleWarn(
        expect.stringContaining('Failed to sync overlay landmarks:'),
        expect.any(Error),
      );
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
    });

    it('skips malformed overlay payloads without blocking the rest of overlay sync', async () => {
      allowConsoleWarn(
        'Overlay sync skipped for landmarks: malformed 2xx payload',
      );
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
      }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('surfaceStations', {
        type: 'FeatureCollection',
        features: [],
      }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('explorationLeads', {
        type: 'FeatureCollection',
        features: [],
      }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(cache.setOverlayGeoJSON).toHaveBeenCalledWith('cylinderInstalls', {
        type: 'FeatureCollection',
        features: [],
      }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
      expect(cache.setProjects).toHaveBeenCalledWith(
        v2Body,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
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
      expect(cache.setProjects).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(service.downloadJSON).not.toHaveBeenCalled();
      expect(service.getLandmarksGeoJSON).toHaveBeenCalledOnce();
      expect(controller.syncStatus).toBe('done');
      expect(controller.isOnline).toBe(true);
    });

    it('on 200 with a legacy envelope body: treats the payload as malformed and skips side-effects', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: refresh skipped (status=200)'),
      );
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
    });

    it('on 4xx with empty cache: surfaces error, skips cache write, skips overlay sync, never logs out', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: refresh skipped (status=401)'),
      );
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
    });

    it('on 4xx with cached projects: keeps cache, reports done, never logs out', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: refresh skipped (status=401)'),
      );
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
    });

    it('on 5xx with empty cache: surfaces error, skips cache write, skips overlay sync', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: refresh skipped (status=500)'),
      );
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
    });

    it('on transport rejection sets syncStatus to "error" when cache is empty', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: API fetch failed:'),
        expect.any(Error),
      );
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
    });

    it('on transport rejection keeps syncStatus "done" when cached projects exist', async () => {
      allowConsoleWarn(
        expect.stringContaining('syncProjects: API fetch failed:'),
        expect.any(Error),
      );
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

  describe('tile-cache overflow consent', () => {
    it('flags over-limit and the one-time auto prompt from a blocked job', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);

      expect(ctrl.isTileCacheOverLimit).toBe(false);
      expect(ctrl.needsAutoStoragePrompt).toBe(false);

      tp.emit([blockedLandmarkJob()]);

      expect(ctrl.isTileCacheOverLimit).toBe(true);
      expect(ctrl.needsAutoStoragePrompt).toBe(true);
      expect(ctrl.storageConsentRequired).toBe(true);
    });

    it('acknowledging the prompt persists it and suppresses the auto popup (warning stays)', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);
      tp.emit([blockedLandmarkJob()]);

      ctrl.acknowledgeStoragePrompt();

      expect(prefs.setPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ tileCacheOverLimitPromptAcknowledged: true }),
      );
      expect(ctrl.needsAutoStoragePrompt).toBe(false);
      expect(ctrl.storageConsentRequired).toBe(false);
      // The underlying condition persists, so the Settings warning stays visible.
      expect(ctrl.isTileCacheOverLimit).toBe(true);
    });

    it('does not auto-prompt across restarts once acknowledged (persistent)', () => {
      const acknowledgedPrefs = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
        tileCacheOverLimitPromptAcknowledged: true,
      });
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, acknowledgedPrefs, cache, tp.service);

      tp.emit([blockedLandmarkJob()]);

      expect(ctrl.isTileCacheOverLimit).toBe(true);
      expect(ctrl.needsAutoStoragePrompt).toBe(false);
    });

    it('approving persists both flags, clears over-limit, and resumes prefetch', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);
      tp.emit([blockedLandmarkJob()]);

      ctrl.approveTileCacheOverLimit();

      expect(prefs.setPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          tileCacheOverLimitApproved: true,
          tileCacheOverLimitPromptAcknowledged: true,
        }),
      );
      expect(ctrl.isTileCacheOverLimitApproved).toBe(true);
      // Approval lifts the cap, so the over-limit condition no longer surfaces.
      expect(ctrl.isTileCacheOverLimit).toBe(false);
      expect(ctrl.needsAutoStoragePrompt).toBe(false);
      expect(tp.resumeBlockedJobs).toHaveBeenCalledOnce();
    });

    it('manual request re-opens the prompt even after acknowledgement', () => {
      const acknowledgedPrefs = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
        tileCacheOverLimitPromptAcknowledged: true,
      });
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, acknowledgedPrefs, cache, tp.service);
      tp.emit([blockedLandmarkJob()]);

      expect(ctrl.needsAutoStoragePrompt).toBe(false);
      expect(ctrl.storageConsentRequired).toBe(false);

      ctrl.requestStorageConsentPrompt();
      expect(ctrl.storageConsentRequested).toBe(true);
      expect(ctrl.storageConsentRequired).toBe(true);

      ctrl.clearStorageConsentRequest();
      expect(ctrl.storageConsentRequested).toBe(false);
      expect(ctrl.storageConsentRequired).toBe(false);
    });

    it('warns once when a job stays blockedByStorage while overflow is approved', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);
      ctrl.approveTileCacheOverLimit();
      expect(ctrl.isTileCacheOverLimitApproved).toBe(true);

      // A real cap-lift would have cleared the flag; simulate the runtime
      // failing to propagate by emitting a still-blocked job after approval.
      allowConsoleWarn(/blocked by storage while overflow is approved/);
      tp.emit([blockedLandmarkJob()]);
      // Latched: a second emit of the same stuck state must not warn again.
      tp.emit([blockedLandmarkJob()]);

      // The Settings warning still stays hidden (approval semantics unchanged).
      expect(ctrl.isTileCacheOverLimit).toBe(false);
    });

    it('revoking clears approval but keeps the acknowledged flag', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);
      ctrl.approveTileCacheOverLimit();
      expect(ctrl.isTileCacheOverLimitApproved).toBe(true);

      ctrl.revokeTileCacheOverLimit();

      expect(ctrl.isTileCacheOverLimitApproved).toBe(false);
      expect(prefs.setPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tileCacheOverLimitApproved: false,
          tileCacheOverLimitPromptAcknowledged: true,
        }),
      );
    });

    it('restores persisted approval at construction', () => {
      const approvedPrefs = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
        tileCacheOverLimitApproved: true,
        tileCacheOverLimitPromptAcknowledged: true,
      });
      const ctrl = new SpeleoDBController(service, approvedPrefs, cache);

      expect(ctrl.isTileCacheOverLimitApproved).toBe(true);
    });

    it('resets consent state on logout', async () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);
      ctrl.approveTileCacheOverLimit();
      expect(ctrl.isTileCacheOverLimitApproved).toBe(true);

      await ctrl.logout();

      expect(ctrl.isTileCacheOverLimitApproved).toBe(false);
      expect(ctrl.isTileCacheOverLimit).toBe(false);
    });
  });
});
