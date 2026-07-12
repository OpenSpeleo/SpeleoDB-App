import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeleoDBController, type PreferencesPort } from './SpeleoDBController';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import { type HttpResponse } from '../services/HttpClient';
import type { AuthTokenResponse } from '../types';
import type { OfflineMapSyncEngineLike } from '../services/OfflineMapSyncEngine';
import { EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT } from '../services/OfflineMapSyncStore';
import type { OfflineMapSyncRequest } from '../types/offlineMapSync';
import type { Project } from '../types/project';
import { __seedTileCacheEntryForTests, getTile } from '../services/tileCache/TileCacheRepository';
import { allowConsoleWarn } from '../test/consoleGuard';
import { createAbortError } from '../utils/abort';
import { OfflineOpStore } from '../offline/OfflineOpStore';
import type { SerializedOfflineOp } from '../types/offlineOp';
import { GpsTrackStore } from '../services/GpsTrackStore';
import type { GeolocationWatcher } from '../services/GeolocationWatcher';
import type { RecordingNotificationPermissionGuard } from '../services/RecordingNotificationPermissionGuard';
import { ProjectGeoJSONAnalysisError } from '../services/ProjectGeoJSONAnalyzer';
import type { LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import type { SessionStore, StoredSession } from '../services/SecureSessionStore';

function expectRebuildRequest(
  request: OfflineMapSyncRequest,
): asserts request is Extract<OfflineMapSyncRequest, { mode: 'rebuild' }> {
  expect(request.mode).toBe('rebuild');
  if (request.mode !== 'rebuild') throw new Error('Expected a rebuild request');
}

// Tests that exercise controller behavior without an explicit engine must not
// leave a real background downloader running into the next test. Engine
// integration is covered at its own storage/network seam.
vi.mock('../services/LazyOfflineMapSyncEngine', () => ({
  LazyOfflineMapSyncEngine: class {
    subscribe() { return () => {}; }
    getSnapshot() { return EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT; }
    async preload() {}
    async schedule() {
      return { coordinateCount: 0, scheduledTileCount: 0, failedTileCount: 0 };
    }
    async waitForIdle() {}
    resumeBlocked() {}
    async releaseLayer() {}
    cancel() {}
    dispose() {}
  },
}));

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
    getLandmarkCollections: vi.fn(async () => ({ status: 200, data: [] }) as HttpResponse<unknown>),
    getGpsTracks: vi.fn(async () => ({ status: 200, data: [] }) as HttpResponse<unknown>),
    updateGpsTrack: vi.fn(async () => ({ status: 200, data: {} }) as HttpResponse<unknown>),
    deleteGpsTrack: vi.fn(async () => ({ status: 200, data: { message: 'deleted' } }) as HttpResponse<unknown>),
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
  hasStoredSession?: boolean;
  lastSyncedAt?: number;
  tileCacheOverLimitApproved?: boolean;
  tileCacheOverLimitPromptAcknowledged?: boolean;
  selectedMapLayerId?: string;
  layerOfflineSync?: Record<string, boolean>;
};

function createMockPrefs(initial?: StoredPrefs): PreferencesPort {
  const { token: initialToken, ...initialPreferences } = initial ?? {};
  let store: StoredPrefs = {
    ...initialPreferences,
    hasStoredSession:
      initialToken && initialPreferences.instance
        ? true
        : initialPreferences.hasStoredSession,
  };
  let currentSession: StoredSession | null =
    initialToken && initialPreferences.instance
      ? {
        email: initialPreferences.email,
        instance: initialPreferences.instance,
        token: initialToken,
      }
      : null;
  const clearPreferences = vi.fn(() => { store = {}; });
  const session: SessionStore = {
    initialize: vi.fn(async () => currentSession),
    getSession: vi.fn(() => currentSession ? { ...currentSession } : null),
    establish: vi.fn(async (next) => {
      currentSession = { ...next };
      store = {
        ...store,
        email: next.email,
        instance: next.instance,
        hasStoredSession: true,
      };
    }),
    clear: vi.fn(async () => {
      currentSession = null;
      clearPreferences();
    }),
  };
  return {
    getPreferences: vi.fn(() => ({ ...store })),
    setPreferences: vi.fn((p: Partial<StoredPrefs>) => {
      store = { ...store, ...p };
    }),
    clearPreferences,
    session,
  };
}

function createMockCache(): ProjectCacheService {
  // Stateful GPS-track caches so applyGpsTrackUpsert/Removal + sync reflect back.
  let gpsTracks: unknown[] | null = null;
  const gpsGeo = new Map<string, unknown>();
  const overlayGeoJSON = new Map<string, unknown>();
  const projectGeoJSON = new Map<string, import('../types/projectGeoJSON').ProjectGeoJSONCacheRecord>();
  const setOverlayGeoJSON = vi.fn(async (id: string, value: unknown) => {
    overlayGeoJSON.set(id, value);
    return true;
  });
  const setGpsTracks = vi.fn(async (tracks: unknown[]) => {
    gpsTracks = tracks;
    return true;
  });
  const cache = {
    getProjects: vi.fn(async () => null),
    setProjects: vi.fn(async () => true),
    getGeoJSON: vi.fn(async () => null),
    setGeoJSON: vi.fn(async () => true),
    getProjectGeoJSONRecord: vi.fn(async (id: string) =>
      projectGeoJSON.get(id) ?? { state: 'missing', commitId: null, data: null }),
    setValidatedProjectGeoJSON: vi.fn(async (
      id: string,
      data: GeoJSON.FeatureCollection,
      commitId: string,
      analysis: import('../types/projectGeoJSON').ProjectGeoJSONAnalysis,
    ) => {
      projectGeoJSON.set(id, { state: 'active', commitId, data, analysis });
      return true;
    }),
    setQuarantinedProjectGeoJSON: vi.fn(async (
      id: string,
      commitId: string,
      reason: import('../types/projectGeoJSON').ProjectGeoJSONContentFailureReason,
      diagnostics: import('../types/projectGeoJSON').ProjectGeoJSONFailureDiagnostics,
    ) => {
      projectGeoJSON.set(id, {
        state: 'quarantined',
        commitId,
        data: null,
        reason,
        diagnostics,
        warningAcknowledged: false,
      });
      return true;
    }),
    acknowledgeProjectGeoJSONQuarantine: vi.fn(async () => true),
    getOverlayGeoJSON: vi.fn(async (id: string) => overlayGeoJSON.get(id) ?? null),
    setOverlayGeoJSON,
    updateOverlayFeatureCollection: vi.fn(async (
      id: string,
      updater: (
        current: GeoJSON.FeatureCollection | null,
      ) => GeoJSON.FeatureCollection,
    ) => {
      const current = (overlayGeoJSON.get(id) as GeoJSON.FeatureCollection | undefined) ?? null;
      const next = updater(current);
      await setOverlayGeoJSON(id, next);
      return next;
    }),
    getCachedCommitId: vi.fn(async () => null),
    getLandmarkCollections: vi.fn(async () => null),
    setLandmarkCollections: vi.fn(async () => true),
    getGpsTracks: vi.fn(async () => gpsTracks),
    setGpsTracks,
    updateGpsTracks: vi.fn(async (
      updater: (current: unknown[] | null) => unknown[],
    ) => {
      const next = updater(gpsTracks);
      await setGpsTracks(next);
      return next;
    }),
    getGpsTrackGeoJSON: vi.fn(async (id: string) => gpsGeo.get(id) ?? null),
    setGpsTrackGeoJSON: vi.fn(async (id: string, data: unknown) => {
      gpsGeo.set(id, data);
      return true;
    }),
    removeGpsTrackGeoJSON: vi.fn(async (id: string) => {
      gpsGeo.delete(id);
    }),
    clearAll: vi.fn(async () => {}),
  } as unknown as ProjectCacheService;
  cache.getOverlayGeoJSONForOfflineMap = vi.fn(
    async (id, options) => (
      await cache.getOverlayGeoJSON(id, options)
      ?? { type: 'FeatureCollection', features: [] }
    ),
  );
  return cache;
}

/** In-memory OfflineOpStore so controller offline tests are isolated from IDB. */
function createMemoryOpStore(): OfflineOpStore {
  const records = new Map<string, SerializedOfflineOp>();
  return {
    list: vi.fn(async () => [...records.values()].sort((a, b) => a.seq - b.seq)),
    put: vi.fn(async (op: SerializedOfflineOp) => {
      records.set(op.id, op);
      return true;
    }),
    remove: vi.fn(async (id: string) => {
      records.delete(id);
      return true;
    }),
    clear: vi.fn(async () => {
      records.clear();
    }),
  } as unknown as OfflineOpStore;
}

function createMockTilePrefetch(
  overrides: Partial<OfflineMapSyncEngineLike> = {},
): OfflineMapSyncEngineLike {
  return {
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT),
    preload: vi.fn(async () => {}),
    schedule: vi.fn(async () => ({ coordinateCount: 0, scheduledTileCount: 0, failedTileCount: 0 })),
    resumeBlocked: vi.fn(),
    releaseLayer: vi.fn(async () => {}),
    cancel: vi.fn(),
    waitForIdle: vi.fn(async () => {}),
    dispose: vi.fn(),
    ...overrides,
  };
}

/**
 * A tile-prefetch mock whose subscribed jobs can be driven from the test, so we
 * can simulate a storage-blocked job reaching the controller.
 */
function createControllableTilePrefetch() {
  let listenerRef: () => void = () => {};
  let snapshot = EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT;
  const resumeBlocked = vi.fn();
  const service = {
    subscribe: vi.fn((listener: () => void) => {
      listenerRef = listener;
      return () => {};
    }),
    getSnapshot: vi.fn(() => snapshot),
    preload: vi.fn(async () => {}),
    schedule: vi.fn(async () => ({ coordinateCount: 0, scheduledTileCount: 0, failedTileCount: 0 })),
    resumeBlocked,
    releaseLayer: vi.fn(async () => {}),
    cancel: vi.fn(),
    waitForIdle: vi.fn(async () => {}),
    dispose: vi.fn(),
  } satisfies OfflineMapSyncEngineLike;
  return {
    service,
    resumeBlocked,
    emit: (blockedByStorage: boolean) => {
      snapshot = {
        ...EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
        blockedByStorage,
        phase: blockedByStorage ? 'storage-blocked' : 'idle',
      };
      listenerRef();
    },
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
    controller = new SpeleoDBController(service, prefs, cache, createMockTilePrefetch());
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
        { signal: expect.any(AbortSignal) },
      );
      expect(prefs.session.establish).toHaveBeenCalledWith(
        {
          email: 'u@x.com',
          token: 'tok',
          instance: validCreds.instance,
        },
        { signal: expect.any(AbortSignal) },
      );
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
      expect(prefs.session.establish).toHaveBeenCalledWith(
        {
          email: 'created@x.com',
          token: 'created-token',
          instance: validCreds.instance,
        },
        { signal: expect.any(AbortSignal) },
      );
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

    it('fails closed when a validated login cannot be committed securely', async () => {
      vi.mocked(prefs.session.establish).mockRejectedValueOnce(new Error('vault unavailable'));

      const result = await controller.login(validCreds);

      expect(result).toEqual({
        success: false,
        message: 'Login succeeded, but the session could not be established safely.',
      });
      expect(controller.isAuthenticated()).toBe(false);
      expect(prefs.session.establish).toHaveBeenCalledOnce();
    });

    it('rejects a transport failure even when legacy plaintext credentials exist', async () => {
      localStorage.setItem('speleo_users_db', JSON.stringify({
        'user@example.com': {
          password: 'pass',
          user: { id: 'legacy', email: 'user@example.com', name: 'Legacy' },
        },
      }));
      service = createMockService({
        authenticate: vi.fn(async () => { throw new Error('network unavailable'); }),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.login(validCreds);

      expect(result).toEqual({
        success: false,
        message: 'Unable to reach SpeleoDB. Offline access requires a previously validated session.',
      });
      expect(controller.isAuthenticated()).toBe(false);
      expect(prefs.session.establish).not.toHaveBeenCalled();
    });
  });

  // ---- OAuth token login ---------------------------------------------------

  describe('loginWithToken', () => {
    it('validates a trimmed token and establishes an identity-free session on any 2xx', async () => {
      service = createMockService({
        validateToken: vi.fn(async () => ({ status: 204, data: null }) as HttpResponse<unknown>),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.loginWithToken({
        token: '  oauth-token  ',
        instance: '  https://custom.speleodb.org/  ',
      });

      expect(result).toEqual({
        success: true,
        message: 'Login successful',
        token: 'oauth-token',
      });
      expect(service.validateToken).toHaveBeenCalledWith(
        'https://custom.speleodb.org',
        'oauth-token',
        { signal: expect.any(AbortSignal) },
      );
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.currentUser).toBeNull();
      expect(controller.isOnline).toBe(true);
      expect(prefs.session.establish).toHaveBeenCalledWith(
        {
          email: undefined,
          token: 'oauth-token',
          instance: 'https://custom.speleodb.org',
        },
        { signal: expect.any(AbortSignal) },
      );
    });

    it('requires a token without calling the service', async () => {
      const result = await controller.loginWithToken({
        token: '   ',
        instance: validCreds.instance,
      });

      expect(result).toEqual({ success: false, message: 'OAuth token is required' });
      expect(service.validateToken).not.toHaveBeenCalled();
      expect(prefs.setPreferences).not.toHaveBeenCalled();
    });

    it('requires an instance without calling the service', async () => {
      const result = await controller.loginWithToken({ token: 'oauth-token', instance: '   ' });

      expect(result).toEqual({
        success: false,
        message: 'SpeleoDB instance URL is required',
      });
      expect(service.validateToken).not.toHaveBeenCalled();
      expect(prefs.setPreferences).not.toHaveBeenCalled();
    });

    it('ignores 4xx token error prose without authenticating or persisting', async () => {
      service = createMockService({
        validateToken: vi.fn(async () => ({
          status: 401,
          data: { detail: 'This token has expired.' },
        }) as HttpResponse<unknown>),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.loginWithToken({
        token: 'expired-token',
        instance: validCreds.instance,
      });

      expect(result).toEqual({ success: false, message: 'Invalid OAuth token' });
      expect(controller.isAuthenticated()).toBe(false);
      expect(prefs.setPreferences).not.toHaveBeenCalled();
    });

    it('uses the invalid-token fallback for a 4xx response without a message', async () => {
      service = createMockService({
        validateToken: vi.fn(async () => ({ status: 403, data: {} }) as HttpResponse<unknown>),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.loginWithToken({
        token: 'invalid-token',
        instance: validCreds.instance,
      });

      expect(result).toEqual({ success: false, message: 'Invalid OAuth token' });
      expect(controller.isAuthenticated()).toBe(false);
      expect(prefs.setPreferences).not.toHaveBeenCalled();
    });

    it('rejects a non-4xx server failure without persisting the token', async () => {
      service = createMockService({
        validateToken: vi.fn(async () => ({ status: 503, data: {} }) as HttpResponse<unknown>),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.loginWithToken({
        token: 'oauth-token',
        instance: validCreds.instance,
      });

      expect(result).toEqual({
        success: false,
        message: 'Unable to validate OAuth token. Please try again.',
      });
      expect(controller.isAuthenticated()).toBe(false);
      expect(controller.isOfflineLocked).toBe(false);
      expect(prefs.setPreferences).not.toHaveBeenCalled();
    });

    it('rejects a transport failure without persisting the token or entering offline mode', async () => {
      service = createMockService({
        validateToken: vi.fn(async () => { throw new Error('Network failure'); }),
      });
      controller = new SpeleoDBController(service, prefs, cache);

      const result = await controller.loginWithToken({
        token: 'oauth-token',
        instance: validCreds.instance,
      });

      expect(result).toEqual({
        success: false,
        message: 'Unable to validate OAuth token. Check your connection and try again.',
      });
      expect(controller.isAuthenticated()).toBe(false);
      expect(controller.isOfflineLocked).toBe(false);
      expect(prefs.setPreferences).not.toHaveBeenCalled();
    });

    it('fails closed when a validated OAuth token cannot be committed securely', async () => {
      vi.mocked(prefs.session.establish).mockRejectedValueOnce(new Error('vault unavailable'));

      const result = await controller.loginWithToken({
        token: 'oauth-token',
        instance: validCreds.instance,
      });

      expect(result).toEqual({
        success: false,
        message: 'Login succeeded, but the session could not be established safely.',
      });
      expect(controller.isAuthenticated()).toBe(false);
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

    it('finishes local revocation but reports a native credential deletion failure', async () => {
      await controller.login(validCreds);
      vi.mocked(prefs.session.clear).mockRejectedValueOnce(new Error('vault unavailable'));

      await expect(controller.logout()).rejects.toThrow(
        'Secure credential deletion failed during logout.',
      );

      expect(controller.isAuthenticated()).toBe(false);
      expect(controller.currentUser).toBeNull();
      expect(localStorage.length).toBe(0);
    });

    it('continues destructive cleanup when GPS teardown fails and reports the failure', async () => {
      const harness = gpsControllerWith();
      vi.mocked(harness.watcher.stop).mockRejectedValueOnce(new Error('native stop failed'));
      localStorage.setItem('private', 'data');

      await expect(harness.controller.logout()).rejects.toThrow(
        'Local data deletion did not complete during logout.',
      );

      expect(harness.controller.isAuthenticated()).toBe(false);
      expect(harness.prefs.session.clear).toHaveBeenCalledOnce();
      expect(harness.cache.clearAll).toHaveBeenCalledOnce();
      expect(localStorage.length).toBe(0);
    });

    it('attempts every wipe step and reports failed durable cache deletion', async () => {
      await controller.login(validCreds);
      cache.clearAll = vi.fn(async () => { throw new Error('cache clear failed'); });
      localStorage.setItem('private', 'data');

      await expect(controller.logout()).rejects.toThrow(
        'Local data deletion did not complete during logout.',
      );

      expect(controller.isAuthenticated()).toBe(false);
      expect(prefs.session.clear).toHaveBeenCalledOnce();
      expect(cache.clearAll).toHaveBeenCalledOnce();
      expect(localStorage.length).toBe(0);
    });

    it('continues destructive cleanup when a state subscriber throws', async () => {
      await controller.login(validCreds);
      controller.subscribe(() => { throw new Error('subscriber failed'); });
      localStorage.setItem('private', 'data');

      await expect(controller.logout()).rejects.toThrow(
        'Local data deletion did not complete during logout.',
      );

      expect(controller.isAuthenticated()).toBe(false);
      expect(prefs.session.clear).toHaveBeenCalledOnce();
      expect(cache.clearAll).toHaveBeenCalledOnce();
      expect(localStorage.length).toBe(0);
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
      await __seedTileCacheEntryForTests(tileUrl, new Uint8Array([1, 2, 3]).buffer, {
        pinnedByAutoPrefetch: false,
      });
      expect(await getTile(tileUrl)).not.toBeNull();

      await controller.logout();

      expect(await getTile(tileUrl)).toBeNull();
    });

    it('waits for project cache cleanup before resolving logout', async () => {
      const mockTilePrefetch = createMockTilePrefetch({
        subscribe: vi.fn(() => () => {}),
        waitForIdle: vi.fn(async () => {}),
        dispose: vi.fn(),
      });
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

      await vi.waitFor(() => expect(cache.clearAll).toHaveBeenCalledOnce());
      expect(logoutResolved).toBe(false);

      if (!clearAllResolver.fn) throw new Error('clearAll resolver should be defined');
      clearAllResolver.fn();
      await logoutPromise;
      expect(logoutResolved).toBe(true);
    });

    it('tears down in-memory tile prefetch runtime state on logout', async () => {
      const mockTilePrefetch = createMockTilePrefetch({ dispose: vi.fn() });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      expect(controller.offlineMapSyncSnapshot.phase).toBe('idle');

      await controller.logout();

      expect(mockTilePrefetch.dispose).toHaveBeenCalledOnce();
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

    it('restores a token-authenticated session without inventing a user identity', () => {
      const restoredPrefs = createMockPrefs({
        email: '',
        token: 'saved-token',
        instance: 'https://www.speleodb.org',
      });

      const fresh = new SpeleoDBController(service, restoredPrefs, cache);

      expect(fresh.isAuthenticated()).toBe(true);
      expect(fresh.currentUser).toBeNull();
      expect(fresh.authState.token).toBe('saved-token');
    });

    it('stays unauthenticated when preferences are empty', () => {
      const emptyPrefs = createMockPrefs();
      const fresh = new SpeleoDBController(service, emptyPrefs, cache);

      expect(fresh.isAuthenticated()).toBe(false);
      expect(fresh.currentUser).toBeNull();
    });

    it('stays unauthenticated when the initialized session store rejected invalid metadata', () => {
      const invalidPrefs = createMockPrefs({
        email: 'restored@example.com',
        token: 'saved-token',
      });

      const fresh = new SpeleoDBController(service, invalidPrefs, cache);

      expect(fresh.isAuthenticated()).toBe(false);
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
        ...createMockPrefs({
          token: 'tok',
          instance: 'https://www.speleodb.org',
        }),
        setPreferences: vi.fn(({ lastSyncedAt }: { lastSyncedAt?: number }) => {
          if (typeof lastSyncedAt === 'number') {
            throw new Error('storage unavailable');
          }
        }) as unknown as PreferencesPort['setPreferences'],
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

    it('returns "unauthorized" when the server explicitly denies authorization', async () => {
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

    it('returns "unauthorized" when the session store rejected a token without an instance', async () => {
      const withInvalidPrefs = createMockPrefs({
        token: 't',
      });
      const ctrl = new SpeleoDBController(service, withInvalidPrefs, cache);

      const result = await ctrl.validateSession();
      expect(result).toBe('unauthorized');
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

    it('returns "unauthorized" and logs out on explicit authorization denial', async () => {
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
      const tilePrefetch = createMockTilePrefetch();
      const ctrl = new SpeleoDBController(service, withToken, cache, tilePrefetch);

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
      expect(cache.setValidatedProjectGeoJSON).not.toHaveBeenCalled();
      expect(cache.setQuarantinedProjectGeoJSON).not.toHaveBeenCalled();
      expect(tilePrefetch.schedule).not.toHaveBeenCalled();
      expect(ctrl.projectGeoJSONWarnings).toEqual([]);
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
    it('publishes validated project map data before later remote phases finish', async () => {
      const landmarks = createDeferred<HttpResponse<GeoJSON.FeatureCollection>>();
      service = createMockService({
        getLandmarksGeoJSON: vi.fn(() => landmarks.promise),
      });
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
      const initialRevision = controller.mapDataRevision;

      const sync = controller.syncProjects();
      await vi.waitFor(() => {
        expect(cache.setValidatedProjectGeoJSON).toHaveBeenCalledOnce();
        expect(service.getLandmarksGeoJSON).toHaveBeenCalledOnce();
      });
      const revisionBeforeLandmarksFinish = controller.mapDataRevision;
      landmarks.resolve({
        status: 200,
        data: { type: 'FeatureCollection', features: [] },
      });
      await sync;

      expect(revisionBeforeLandmarksFinish).toBeGreaterThan(initialRevision);
    });

    it('starts overlay and GPS persistence together after project map publication', async () => {
      const landmarks = createDeferred<HttpResponse<GeoJSON.FeatureCollection>>();
      const gpsTracks = createDeferred<HttpResponse<unknown>>();
      service = createMockService({
        getLandmarksGeoJSON: vi.fn(() => landmarks.promise),
        getGpsTracks: vi.fn(() => gpsTracks.promise),
      });
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
      const initialRevision = controller.mapDataRevision;
      let foregroundSettled = false;

      const sync = controller.syncProjects().then((result) => {
        foregroundSettled = true;
        return result;
      });
      await vi.waitFor(() => {
        expect(cache.setValidatedProjectGeoJSON).toHaveBeenCalledOnce();
        expect(service.getLandmarksGeoJSON).toHaveBeenCalledOnce();
      });
      const gpsStartedBeforeOverlayFinished = vi.mocked(service.getGpsTracks).mock.calls.length === 1;
      const revisionWhileMetadataPending = controller.mapDataRevision;

      landmarks.resolve({
        status: 200,
        data: { type: 'FeatureCollection', features: [] },
      });
      await vi.waitFor(() => expect(service.getGpsTracks).toHaveBeenCalledOnce());
      expect(foregroundSettled).toBe(false);
      gpsTracks.resolve({ status: 200, data: [] });
      await sync;

      expect(gpsStartedBeforeOverlayFinished).toBe(true);
      expect(revisionWhileMetadataPending).toBeGreaterThan(initialRevision);
    });

    it('loads landmark collections without waiting for overlay cache writes', async () => {
      const overlayWrite = createDeferred<boolean>();
      cache.setOverlayGeoJSON = vi.fn(() => overlayWrite.promise);
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

      const sync = controller.syncProjects();
      await vi.waitFor(() => expect(cache.setOverlayGeoJSON).toHaveBeenCalledTimes(5));
      const collectionsStartedWhileOverlayWritesPending = vi.mocked(
        service.getLandmarkCollections,
      ).mock.calls.length === 1;
      overlayWrite.resolve(true);
      await sync;

      expect(collectionsStartedWhileOverlayWritesPending).toBe(true);
      expect(cache.setLandmarkCollections).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('completes foreground sync before offline-map preparation starts', async () => {
      const tileSchedule = createDeferred<{
        coordinateCount: number;
        scheduledTileCount: number;
        failedTileCount: number;
      }>();
      let foregroundSettled = false;
      let foregroundSettledWhenPlanningStarted: boolean | null = null;
      const tilePrefetch = createMockTilePrefetch({
        schedule: vi.fn(() => {
          foregroundSettledWhenPlanningStarted = foregroundSettled;
          return tileSchedule.promise;
        }),
      });
      const withToken = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, withToken, cache, tilePrefetch);

      const sync = controller.syncProjects().then((result) => {
        foregroundSettled = true;
        return result;
      });
      await vi.waitFor(() => expect(tilePrefetch.schedule).toHaveBeenCalledOnce());
      tileSchedule.resolve({
        coordinateCount: 0,
        scheduledTileCount: 0,
        failedTileCount: 0,
      });
      const result = await sync;

      expect(foregroundSettledWhenPlanningStarted).toBe(true);
      expect(result.status).toBe('done');
      expect(controller.syncStatus).toBe('done');
    });

    it('logs ordered phase timings and one terminal timing without user data', async () => {
      let monotonicTime = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => {
        monotonicTime += 5;
        return monotonicTime;
      });
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [2.3, 46.6] },
        }],
      }));
      const withToken = createMockPrefs({
        token: 'secret-token',
        instance: 'https://private.example.test',
      });
      controller = new SpeleoDBController(
        service,
        withToken,
        cache,
        createMockTilePrefetch(),
      );

      const result = await controller.syncProjects();
      const timingRecords = consoleLog.mock.calls
        .filter(([label]) => label === '[project-sync:timing]')
        .map(([, record]) => record);

      expect(timingRecords).toHaveLength(7);
      expect(timingRecords.map((record) => record.phase)).toEqual([
        'cache_load',
        'project_refresh',
        'geojson_sync',
        'overlay_sync',
        'gps_sync',
        'tile_prefetch',
        'total',
      ]);
      expect(timingRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: result.runId,
          phase: 'project_refresh',
          status: 'applied',
          reason: 'project_list_refreshed',
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({
          runId: result.runId,
          phase: 'gps_sync',
          status: 'applied',
          reason: 'gps_sync_completed',
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({
          runId: result.runId,
          phase: 'total',
          status: 'done',
          durationMs: expect.any(Number),
        }),
      ]));
      expect(timingRecords.every((record) => record.durationMs >= 0)).toBe(true);
      expect(JSON.stringify(timingRecords)).not.toContain('secret-token');
      expect(JSON.stringify(timingRecords)).not.toContain('private.example.test');
      expect(JSON.stringify(timingRecords)).not.toContain(DEFAULT_PROJECT.id);
      expect(JSON.stringify(timingRecords)).not.toContain(DEFAULT_PROJECT.name);
    });

    it('logs aggregate GeoJSON work timings without project identity or payloads', async () => {
      let monotonicTime = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => {
        monotonicTime += 5;
        return monotonicTime;
      });
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      const withToken = createMockPrefs({
        token: 'secret-token',
        instance: 'https://private.example.test',
      });
      controller = new SpeleoDBController(
        service,
        withToken,
        cache,
        createMockTilePrefetch(),
      );

      const result = await controller.syncProjects();
      const records = consoleLog.mock.calls
        .filter(([label]) => label === '[project-geojson:timing]')
        .map(([, record]) => record);

      expect(records.map((record) => record.phase)).toEqual([
        'cache_read_work',
        'download_work',
        'normalization_work',
        'validation_work',
        'cache_write_work',
      ]);
      expect(records.every((record) => (
        record.runId === result.runId
        && record.status === 'applied'
        && typeof record.durationMs === 'number'
        && record.durationMs >= 0
      ))).toBe(true);
      expect(JSON.stringify(records)).not.toContain('secret-token');
      expect(JSON.stringify(records)).not.toContain('private.example.test');
      expect(JSON.stringify(records)).not.toContain(DEFAULT_PROJECT.id);
      expect(JSON.stringify(records)).not.toContain(DEFAULT_PROJECT.name);
    });

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
        reason: 'tile_prefetch_queued',
        eligibleProjectCount: 1,
        scheduledProjectCount: 0,
      }));
    });

    it('processes three project files concurrently while preserving exact counters', async () => {
      const projects = ['p1', 'p2', 'p3'].map((id, index) => createProjectFixture({
        id,
        name: `Project ${index + 1}`,
        geojson_file: `https://example.com/${id}.geojson`,
        latest_commit: { id: `commit-${index + 1}` },
      }));
      const responses = new Map(projects.map((project) => [
        project.geojson_file!,
        createDeferred<HttpResponse<unknown>>(),
      ]));
      let activeDownloads = 0;
      let maximumActiveDownloads = 0;
      const downloadJSON = vi.fn((url: string) => {
        activeDownloads += 1;
        maximumActiveDownloads = Math.max(maximumActiveDownloads, activeDownloads);
        return responses.get(url)!.promise.finally(() => { activeDownloads -= 1; });
      });
      const concurrentController = new SpeleoDBController(
        createMockService({
          getProjectsGeoJSON: vi.fn(async () => ({ status: 200, data: projects })),
          downloadJSON: downloadJSON as unknown as SpeleoDBService['downloadJSON'],
        }),
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        createMockCache(),
        createMockTilePrefetch(),
      );

      const sync = concurrentController.syncProjects();
      await flushPromises(8);

      expect(downloadJSON).toHaveBeenCalledTimes(3);
      expect(maximumActiveDownloads).toBe(3);
      for (const response of responses.values()) {
        response.resolve({
          status: 200,
          data: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [2.3, 46.6] },
            }],
          },
        });
      }

      const result = await sync;
      expect(result.phases.geojsonSync).toMatchObject({
        eligibleProjectCount: 3,
        downloadedProjectCount: 3,
        validatedProjectCount: 3,
        quarantinedProjectCount: 0,
        skippedProjectCount: 0,
        failedProjectCount: 0,
      });
    });

    it('aborts an older sync run when a newer sync starts', async () => {
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
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
      const totalTimingRecords = consoleLog.mock.calls
        .filter(([, record]) => (
          record
          && typeof record === 'object'
          && 'phase' in record
          && record.phase === 'total'
        ))
        .map(([, record]) => record);
      expect(totalTimingRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({ runId: firstResult.runId, status: 'aborted' }),
        expect.objectContaining({ runId: secondResult.runId, status: 'done' }),
      ]));
    });
  });

  describe('project GeoJSON bbox quarantine', () => {
    it('quarantines an 8,000 km file and never downloads or analyzes the same commit again', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'bbox_too_large' }),
      );
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'bbox_too_large' }),
      );
      const hugeGeoJSON: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[0, 0], [75, 0]] },
        }],
      };
      const downloadJSON = vi.fn(async () => ({ status: 200, data: hugeGeoJSON }));
      const quarantineService = createMockService({
        downloadJSON: downloadJSON as unknown as SpeleoDBService['downloadJSON'],
      });
      const quarantineCache = createMockCache();
      const quarantineTile = createMockTilePrefetch();
      const quarantinePrefs = createMockPrefs({ token: 'tok', instance: 'https://api.test' });
      const quarantineController = new SpeleoDBController(
        quarantineService,
        quarantinePrefs,
        quarantineCache,
        quarantineTile,
      );

      const first = await quarantineController.syncProjects();
      await vi.waitFor(() => expect(quarantineTile.schedule).toHaveBeenCalledTimes(1));
      const warningSnapshot = quarantineController.projectGeoJSONWarnings;
      const second = await quarantineController.syncProjects();
      await vi.waitFor(() => expect(quarantineTile.schedule).toHaveBeenCalledTimes(2));

      expect(first.phases.geojsonSync).toMatchObject({
        status: 'failed', quarantinedProjectCount: 1, validatedProjectCount: 0,
      });
      expect(second.phases.geojsonSync).toMatchObject({ quarantinedProjectCount: 1 });
      expect(downloadJSON).toHaveBeenCalledOnce();
      expect(quarantineCache.setQuarantinedProjectGeoJSON).toHaveBeenCalledOnce();
      expect(quarantineTile.schedule).toHaveBeenCalled();
      expect(vi.mocked(quarantineTile.schedule).mock.calls.every(
        ([request]) => request.mode === 'rebuild' && request.plan.projects.length === 0,
      )).toBe(true);
      expect(quarantineController.projectGeoJSONWarnings).toEqual([
        expect.objectContaining({ projectId: 'p1', commitId: 'commit-1', reason: 'bbox_too_large' }),
      ]);
      expect(quarantineController.projectGeoJSONWarnings).toBe(warningSnapshot);
      expect(await quarantineController.getProjectMapData('p1')).toBeNull();
    });

    it('keeps a file session-blocked when quarantine persistence fails', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'bbox_too_large' }),
      );
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({
          projectId: 'p1',
          reason: 'bbox_too_large',
          source: 'cache',
        }),
      );
      allowConsoleWarn(
        '[project-geojson:quarantine-persistence-failed]',
        expect.objectContaining({ projectId: 'p1', commitId: 'commit-1' }),
      );
      const downloadJSON = vi.fn(async () => ({
        status: 200,
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [[0, 0], [75, 0]] },
          }],
        },
      }));
      const cache = createMockCache();
      cache.setQuarantinedProjectGeoJSON = vi.fn(async () => false);
      const controller = new SpeleoDBController(
        createMockService({
          downloadJSON: downloadJSON as unknown as SpeleoDBService['downloadJSON'],
        }),
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        cache,
        createMockTilePrefetch(),
      );

      await controller.syncProjects();
      const second = await controller.syncProjects();

      expect(downloadJSON).toHaveBeenCalledOnce();
      expect(cache.setQuarantinedProjectGeoJSON).toHaveBeenCalledOnce();
      expect(second.phases.geojsonSync).toMatchObject({
        quarantinedProjectCount: 1,
        skippedProjectCount: 1,
        failedProjectCount: 1,
      });
      expect(controller.projectGeoJSONWarnings).toEqual([
        expect.objectContaining({ projectId: 'p1', persistent: false }),
      ]);
    });

    it('reactivates a quarantined project when a newer compact commit arrives', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'bbox_too_large' }),
      );
      const firstProject = createProjectFixture({ latest_commit: { id: 'bad' } });
      const fixedProject = createProjectFixture({ latest_commit: { id: 'fixed' } });
      const getProjectsGeoJSON = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: [firstProject] })
        .mockResolvedValueOnce({ status: 200, data: [fixedProject] });
      const downloadJSON = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          data: {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [75, 0]] } }],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2, 45] } }],
          },
        });
      const recoveryCache = createMockCache();
      const recoveryController = new SpeleoDBController(
        createMockService({ getProjectsGeoJSON, downloadJSON }),
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        recoveryCache,
        createMockTilePrefetch(),
      );

      await recoveryController.syncProjects();
      expect(recoveryController.projectGeoJSONWarnings).toHaveLength(1);
      await recoveryController.syncProjects();

      expect(downloadJSON).toHaveBeenCalledTimes(2);
      expect(recoveryController.projectGeoJSONWarnings).toEqual([]);
      expect(await recoveryController.getProjectMapData('p1')).toMatchObject({
        featureCollection: { type: 'FeatureCollection' },
      });
    });

    it('keeps a worker deadline transient and never persists it as file corruption', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'validation_unavailable' }),
      );
      const timeoutAnalyzer = {
        analyze: vi.fn(async () => {
          throw new ProjectGeoJSONAnalysisError(
            'validation_unavailable',
            'validation deadline exceeded',
            false,
          );
        }),
      };
      const timeoutCache = createMockCache();
      const timeoutController = new SpeleoDBController(
        createMockService(),
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        timeoutCache,
        createMockTilePrefetch(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        timeoutAnalyzer,
      );

      await timeoutController.syncProjects();
      expect(timeoutController.projectGeoJSONWarnings[0]).toMatchObject({
        reason: 'validation_unavailable',
        persistent: false,
      });
      expect(timeoutCache.setQuarantinedProjectGeoJSON).not.toHaveBeenCalled();
      await timeoutController.acknowledgeProjectGeoJSONWarnings();
      expect(timeoutController.projectGeoJSONWarnings).toEqual([]);
      expect(timeoutCache.acknowledgeProjectGeoJSONQuarantine).not.toHaveBeenCalled();
    });

    it('keeps the warning open when acknowledgement persistence fails', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'bbox_too_large' }),
      );
      const cache = createMockCache();
      cache.acknowledgeProjectGeoJSONQuarantine = vi.fn(async () => false);
      const controller = new SpeleoDBController(
        createMockService({
          downloadJSON: vi.fn(async () => ({
            status: 200,
            data: {
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: [[0, 0], [75, 0]] },
              }],
            },
          })) as unknown as SpeleoDBService['downloadJSON'],
        }),
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        cache,
        createMockTilePrefetch(),
      );

      await controller.syncProjects();
      const warningSnapshot = controller.projectGeoJSONWarnings;
      const result = await controller.acknowledgeProjectGeoJSONWarnings();

      expect(result).toEqual({ acknowledgedCount: 0, failedCount: 1 });
      expect(controller.projectGeoJSONWarnings).toBe(warningSnapshot);
      expect(controller.projectGeoJSONWarnings).toHaveLength(1);
    });

    it('session-blocks a cache-record read failure without retrying storage, download, or analysis', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'validation_unavailable' }),
      );
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({
          projectId: 'p1',
          reason: 'validation_unavailable',
          source: 'cache',
        }),
      );
      const failingCache = createMockCache();
      failingCache.getProjectGeoJSONRecord = vi.fn(async () => {
        throw new Error('IndexedDB read failed');
      });
      const analyzer = { analyze: vi.fn() };
      const tilePrefetch = createMockTilePrefetch();
      const readFailureController = new SpeleoDBController(
        createMockService(),
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        failingCache,
        tilePrefetch,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        analyzer,
      );

      const first = await readFailureController.syncProjects();
      await vi.waitFor(() => {
        expect(failingCache.getProjectGeoJSONRecord).toHaveBeenCalledTimes(2);
      });
      const second = await readFailureController.syncProjects();
      await vi.waitFor(() => {
        expect(failingCache.getProjectGeoJSONRecord).toHaveBeenCalledTimes(3);
      });

      expect(first.phases.geojsonSync).toMatchObject({
        quarantinedProjectCount: 1,
        skippedProjectCount: 1,
        failedProjectCount: 1,
      });
      expect(second.phases.geojsonSync).toMatchObject({
        quarantinedProjectCount: 1,
        skippedProjectCount: 1,
        failedProjectCount: 1,
      });
      // Validation reads once; each replacement attempt re-reads the required
      // current record and fails closed instead of omitting the project.
      expect(failingCache.getProjectGeoJSONRecord).toHaveBeenCalledTimes(3);
      expect(failingCache.setValidatedProjectGeoJSON).not.toHaveBeenCalled();
      expect(failingCache.setQuarantinedProjectGeoJSON).not.toHaveBeenCalled();
      expect(analyzer.analyze).not.toHaveBeenCalled();
      expect(readFailureController.projectGeoJSONWarnings).toEqual([
        expect.objectContaining({ reason: 'validation_unavailable', persistent: false }),
      ]);
      expect(tilePrefetch.schedule).not.toHaveBeenCalled();
      expect(first.phases.tilePrefetch.reason).toBe('tile_prefetch_queued');
      expect(second.phases.tilePrefetch.reason).toBe('tile_prefetch_queued');
    });

    it('keeps unversioned legacy bytes fail-closed offline without attributing or analyzing them', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'validation_unavailable' }),
      );
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({
          projectId: 'p1',
          reason: 'validation_unavailable',
          source: 'cache',
        }),
      );
      const offlineCache = createMockCache();
      offlineCache.getProjects = vi.fn(async () => [DEFAULT_PROJECT]);
      offlineCache.getProjectGeoJSONRecord = vi.fn(async () => ({
        state: 'legacy',
        commitId: null,
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [2.3, 46.6] },
          }],
        },
      } as const));
      const analyzer = {
        analyze: vi.fn(async () => ({
          bounds: {
            west: 2.3,
            east: 2.3,
            south: 46.6,
            north: 46.6,
            crossesDateline: false,
          },
          widthKm: 0,
          heightKm: 0,
          durationMs: 1,
        })),
      };
      const validateToken = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ status: 200, data: {} });
      const offlineService = createMockService({
        validateToken,
      });
      const offlineController = new SpeleoDBController(
        offlineService,
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        offlineCache,
        createMockTilePrefetch(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        analyzer,
      );
      expect(await offlineController.validateSession()).toBe('network_error');

      const result = await offlineController.syncProjects();

      expect(result.phases.geojsonSync).toMatchObject({
        downloadedProjectCount: 0,
        validatedProjectCount: 0,
        quarantinedProjectCount: 1,
        skippedProjectCount: 1,
        failedProjectCount: 1,
      });
      expect(offlineService.downloadJSON).not.toHaveBeenCalled();
      expect(analyzer.analyze).not.toHaveBeenCalled();
      expect(offlineCache.setValidatedProjectGeoJSON).not.toHaveBeenCalled();
      expect(offlineCache.setQuarantinedProjectGeoJSON).not.toHaveBeenCalled();

      expect(await offlineController.acknowledgeProjectGeoJSONWarnings()).toEqual({
        acknowledgedCount: 1,
        failedCount: 0,
      });
      await offlineController.syncProjects();
      expect(offlineCache.getProjectGeoJSONRecord).toHaveBeenCalledOnce();
      expect(offlineController.projectGeoJSONWarnings).toEqual([]);

      expect(await offlineController.attemptReconnect()).toBe('ok');
      await flushPromises(20);
      expect(offlineService.downloadJSON).toHaveBeenCalledOnce();
      expect(analyzer.analyze).toHaveBeenCalledOnce();
      expect(offlineCache.setValidatedProjectGeoJSON).toHaveBeenCalledOnce();
    });

    it('counts a successful malformed response as downloaded and as a failed quarantine', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'invalid_geojson' }),
      );
      const malformedController = new SpeleoDBController(
        createMockService({
          downloadJSON: vi.fn(async () => ({
            status: 200,
            data: { nope: true },
          })) as unknown as SpeleoDBService['downloadJSON'],
        }),
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        createMockCache(),
        createMockTilePrefetch(),
      );

      const result = await malformedController.syncProjects();

      expect(result.phases.geojsonSync).toMatchObject({
        downloadedProjectCount: 1,
        validatedProjectCount: 0,
        quarantinedProjectCount: 1,
        skippedProjectCount: 0,
        failedProjectCount: 1,
      });
    });

    it('audits and quarantines a legacy cached file while offline without downloading', async () => {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({ projectId: 'p1', reason: 'bbox_too_large' }),
      );
      const offlineCache = createMockCache();
      offlineCache.getProjects = vi.fn(async () => [DEFAULT_PROJECT]);
      offlineCache.getProjectGeoJSONRecord = vi.fn(async () => ({
        state: 'legacy',
        commitId: 'commit-1',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [[0, 0], [75, 0]] },
          }],
        },
      } as const));
      const offlineService = createMockService({
        validateToken: vi.fn(async () => { throw new Error('offline'); }),
      });
      const offlineController = new SpeleoDBController(
        offlineService,
        createMockPrefs({ token: 'tok', instance: 'https://api.test' }),
        offlineCache,
        createMockTilePrefetch(),
      );
      expect(await offlineController.validateSession()).toBe('network_error');

      const result = await offlineController.syncProjects();

      expect(offlineService.downloadJSON).not.toHaveBeenCalled();
      expect(result.phases.geojsonSync).toMatchObject({
        quarantinedProjectCount: 1,
        status: 'failed',
      });
      expect(offlineCache.setQuarantinedProjectGeoJSON).toHaveBeenCalledWith(
        'p1',
        'commit-1',
        'bbox_too_large',
        expect.anything(),
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
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 1,
        scheduledTileCount: 1,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      await prefs.session.establish({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());

      expect(schedule).toHaveBeenCalledOnce();
      const request = schedule.mock.calls[0][0];
      expectRebuildRequest(request);
      expect(request.plan.projects).toHaveLength(1);
      expect(request.plan.minZoom).toBe(0);
      expect(request.plan.maxZoom).toBe(18);
      expect(request.plan.padMeters).toBe(50);
    });

    it('enqueues a combined landmarks tile prefetch job from cached landmark points', async () => {
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 7,
        scheduledTileCount: 7,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

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

      await prefs.session.establish({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      const result = await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());

      const request = schedule.mock.calls[0][0];
      expectRebuildRequest(request);
      expect(request.plan.points).toEqual(
        expect.arrayContaining([[10.4, 45.3], [-73.9, 40.7]]),
      );
      expect(result.phases.tilePrefetch.reason).toBe('tile_prefetch_queued');
    });

    it('skips landmark tile prefetch when there are no landmark points', async () => {
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 0,
        scheduledTileCount: 0,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

      cache.getOverlayGeoJSON = vi.fn(async () => ({ type: 'FeatureCollection', features: [] }));

      await prefs.session.establish({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      const result = await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());

      const request = schedule.mock.calls[0][0];
      expectRebuildRequest(request);
      expect(request.plan.points).toEqual([]);
      expect(result.phases.tilePrefetch.reason).toBe('tile_prefetch_queued');
    });

    it('produces a stable landmark signature across repeated syncs', async () => {
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 1,
        scheduledTileCount: 1,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

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

      await prefs.session.establish({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());
      await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));

      const firstRequest = schedule.mock.calls[0][0];
      const secondRequest = schedule.mock.calls[1][0];
      expectRebuildRequest(firstRequest);
      expectRebuildRequest(secondRequest);
      expect(firstRequest.plan.sourceRevision).toBe(secondRequest.plan.sourceRevision);
    });

    it('schedules satellite first, then enabled extra layers at their max zoom', async () => {
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 1,
        scheduledTileCount: 2,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      await prefs.session.establish({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      prefs.setPreferences({ layerOfflineSync: { 'esri-world-hillshade': true } });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());

      const request = schedule.mock.calls[0][0];
      expectRebuildRequest(request);
      const layerIds = request.layers.map((layer) => layer.id);
      expect(layerIds[0]).toBe('esri-satellite');
      expect(layerIds).toContain('esri-world-hillshade');
      expect(request.plan.maxZoom).toBe(18);
      expect(request.layers.find((layer) => layer.id === 'esri-world-hillshade')?.tileUrlTemplate)
        .toContain('World_Hillshade');
    });

    it('schedules only satellite when no extra layers are enabled', async () => {
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 1,
        scheduledTileCount: 1,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      await prefs.session.establish({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());

      const layerIds = schedule.mock.calls[0][0].layers.map((layer) => layer.id);
      expect(layerIds).toEqual(['esri-satellite']);
    });

    it('setLayerOfflineSync(true) persists opt-in and schedules that layer', async () => {
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 1,
        scheduledTileCount: 1,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } }],
      }));

      await prefs.session.establish({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);
      await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());
      schedule.mockClear();

      await controller.setLayerOfflineSync('esri-world-hillshade', true);

      expect(prefs.getPreferences().layerOfflineSync?.['esri-world-hillshade']).toBe(true);
      expect(schedule).toHaveBeenCalledOnce();
      expect(schedule.mock.calls[0][0].layers.map((layer) => layer.id))
        .toContain('esri-world-hillshade');
    });

    it('setLayerOfflineSync(false) removes jobs and evicts the layer tiles', async () => {
      const releaseLayer = vi.fn(async () => {});
      const mockTilePrefetch = createMockTilePrefetch({ releaseLayer });

      await prefs.session.establish({
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      prefs.setPreferences({ layerOfflineSync: { 'esri-world-hillshade': true } });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      const hillTileUrl =
        'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/5/1/2';
      await __seedTileCacheEntryForTests(hillTileUrl, new Uint8Array([1, 2, 3]).buffer, {
        pinnedByAutoPrefetch: true,
      });
      expect(await getTile(hillTileUrl)).not.toBeNull();

      await controller.setLayerOfflineSync('esri-world-hillshade', false);

      expect(prefs.getPreferences().layerOfflineSync?.['esri-world-hillshade']).toBe(false);
      expect(releaseLayer).toHaveBeenCalledWith('esri-world-hillshade');
      expect(await getTile(hillTileUrl)).toBeNull();
    });

    it('setLayerOfflineSync ignores the forced satellite layer', async () => {
      const releaseLayer = vi.fn(async () => {});
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 0,
        scheduledTileCount: 0,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ releaseLayer, schedule });

      await prefs.session.establish({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);

      await controller.setLayerOfflineSync('esri-satellite', false);

      expect(releaseLayer).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
      expect(prefs.getPreferences().layerOfflineSync?.['esri-satellite']).toBeUndefined();
    });

    it('aborts an in-flight layer prefetch when the user logs out', async () => {
      const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
        coordinateCount: 1,
        scheduledTileCount: 1,
        failedTileCount: 0,
      }));
      const mockTilePrefetch = createMockTilePrefetch({ schedule });

      cache.getGeoJSON = vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.3, 46.6] } },
        ],
      }));

      await prefs.session.establish({ token: 'tok', instance: 'https://www.speleodb.org' });
      controller = new SpeleoDBController(service, prefs, cache, mockTilePrefetch);
      await controller.syncProjects();
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());
      schedule.mockClear();

      // Hang the active-plan reuse request so logout can invalidate it.
      const deferred = createDeferred<{
        coordinateCount: number;
        scheduledTileCount: number;
        failedTileCount: number;
      }>();
      schedule.mockImplementationOnce(() => deferred.promise);

      const pending = controller.setLayerOfflineSync('esri-world-hillshade', true);
      await flushPromises(3);
      const layerRequest = schedule.mock.calls[0][0];

      // Logging out aborts the layer request even if the engine settles late.
      await controller.logout();

      deferred.resolve({ coordinateCount: 1, scheduledTileCount: 2, failedTileCount: 0 });

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(layerRequest.mode).toBe('reuse-active-plan');
      expect(layerRequest.signal?.aborted).toBe(true);
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
        'Failed to cache project GeoJSON:',
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
      expect(cache.setValidatedProjectGeoJSON).not.toHaveBeenCalled();
      expect(cache.setQuarantinedProjectGeoJSON).not.toHaveBeenCalled();
    });

    it('skips project geojson cache writes for non-2xx download responses', async () => {
      allowConsoleWarn(
        'Skipping project GeoJSON cache: status 403',
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
      expect(cache.setValidatedProjectGeoJSON).not.toHaveBeenCalled();
      expect(cache.setQuarantinedProjectGeoJSON).not.toHaveBeenCalled();
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
      controller = new SpeleoDBController(
        service,
        createMockPrefs({ token: 'tok', instance: 'https://www.speleodb.org' }),
        cache,
      );

      const result = await controller.getOverlayGeoJSON('landmarks');

      expect(cache.getOverlayGeoJSON).toHaveBeenCalledWith(
        'landmarks',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(result).toEqual(payload);
    });
  });

  describe('disconnect login behavior', () => {
    it('preserves the validated secure session but refuses password reauthentication', async () => {
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

      expect(result).toEqual({
        success: false,
        message: 'Unable to reach SpeleoDB. Offline access requires a previously validated session.',
      });
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.authState.token).toBe('tok');
      expect(service.authenticate).not.toHaveBeenCalled();
    });
  });

  describe('tile-cache overflow consent', () => {
    it('flags over-limit and the one-time auto prompt from a blocked job', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);

      expect(ctrl.isTileCacheOverLimit).toBe(false);
      expect(ctrl.needsAutoStoragePrompt).toBe(false);

      tp.emit(true);

      expect(ctrl.isTileCacheOverLimit).toBe(true);
      expect(ctrl.needsAutoStoragePrompt).toBe(true);
      expect(ctrl.storageConsentRequired).toBe(true);
    });

    it('acknowledging the prompt persists it and suppresses the auto popup (warning stays)', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);
      tp.emit(true);

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

      tp.emit(true);

      expect(ctrl.isTileCacheOverLimit).toBe(true);
      expect(ctrl.needsAutoStoragePrompt).toBe(false);
    });

    it('approving persists both flags, clears over-limit, and resumes prefetch', () => {
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, prefs, cache, tp.service);
      tp.emit(true);

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
      expect(tp.resumeBlocked).toHaveBeenCalledOnce();
    });

    it('manual request re-opens the prompt even after acknowledgement', () => {
      const acknowledgedPrefs = createMockPrefs({
        token: 'tok',
        instance: 'https://www.speleodb.org',
        tileCacheOverLimitPromptAcknowledged: true,
      });
      const tp = createControllableTilePrefetch();
      const ctrl = new SpeleoDBController(service, acknowledgedPrefs, cache, tp.service);
      tp.emit(true);

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
      tp.emit(true);
      // Latched: a second emit of the same stuck state must not warn again.
      tp.emit(true);

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

// ==================== Landmark CRUD ====================

describe('SpeleoDBController landmark CRUD', () => {
  const ONLINE_PREFS = { token: 'tok', instance: 'https://www.speleodb.org' };

  const apiLandmark = {
    id: 'lm-1',
    name: 'Camp',
    description: 'Base camp',
    latitude: 45.5,
    longitude: -122.25,
    collection: 'col-1',
    collection_name: 'Survey A',
    collection_color: '#3b82f6',
    is_personal_collection: false,
    can_write: true,
    can_delete: true,
  };

  function onlineController(
    serviceOverrides?: Partial<SpeleoDBService>,
    cacheRef?: ProjectCacheService,
    opStore: OfflineOpStore = createMemoryOpStore(),
  ) {
    const service = createMockService(serviceOverrides);
    const prefs = createMockPrefs({ ...ONLINE_PREFS });
    const cache = cacheRef ?? createMockCache();
    const controller = new SpeleoDBController(
      service,
      prefs,
      cache,
      createMockTilePrefetch(),
      opStore,
    );
    return { service, prefs, cache, controller };
  }

  it.each([
    {
      label: 'create',
      serviceMethod: 'createLandmark' as const,
      optionsIndex: 3,
      response: { status: 201, data: { landmark: apiLandmark } },
      invoke: (controller: SpeleoDBController) => controller.createLandmark({
        name: 'Camp',
        latitude: 45.5,
        longitude: -122.25,
      }),
    },
    {
      label: 'update',
      serviceMethod: 'updateLandmark' as const,
      optionsIndex: 4,
      response: { status: 200, data: { landmark: { ...apiLandmark, name: 'Updated' } } },
      invoke: (controller: SpeleoDBController) => controller.updateLandmark(
        'lm-1',
        { name: 'Updated' },
      ),
    },
    {
      label: 'delete',
      serviceMethod: 'deleteLandmark' as const,
      optionsIndex: 3,
      response: { status: 200, data: { message: 'deleted' } },
      invoke: (controller: SpeleoDBController) => controller.deleteLandmark('lm-1'),
    },
  ])(
    'aborts and drains an in-flight landmark $label before logout cache deletion',
    async ({ serviceMethod, optionsIndex, response, invoke }) => {
      const pendingResponse = deferred<{ status: number; data: unknown }>();
      const request = vi.fn(() => pendingResponse.promise);
      const { controller, cache } = onlineController({
        [serviceMethod]: request,
      } as Partial<SpeleoDBService>);

      const mutation = invoke(controller);
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      let logoutSettled = false;
      const logout = controller.logout().then(() => { logoutSettled = true; });
      await flushPromises(3);
      const requestOptions = request.mock.calls[0]?.[optionsIndex] as
        | { signal?: AbortSignal }
        | undefined;
      const logoutSettledBeforeResponse = logoutSettled;

      pendingResponse.resolve(response);
      const [mutationResult, logoutResult] = await Promise.allSettled([mutation, logout]);

      expect(requestOptions?.signal?.aborted).toBe(true);
      expect(logoutSettledBeforeResponse).toBe(false);
      expect(mutationResult).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ name: 'AbortError' }),
      });
      expect(logoutResult.status).toBe('fulfilled');
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
      expect(controller.landmarksRevision).toBe(0);
    },
  );

  it('aborts a collection load and prevents its response from repopulating cache after logout', async () => {
    const pendingResponse = deferred<{ status: number; data: unknown }>();
    const getLandmarkCollections = vi.fn((
      _instance: string,
      _token: string,
      _options?: { signal?: AbortSignal },
    ) => pendingResponse.promise);
    const { controller, cache } = onlineController({ getLandmarkCollections } as never);

    const load = controller.getLandmarkCollections();
    await vi.waitFor(() => expect(getLandmarkCollections).toHaveBeenCalledOnce());
    const logout = controller.logout();
    await flushPromises(3);
    const options = getLandmarkCollections.mock.calls[0]?.[2];
    pendingResponse.resolve({
      status: 200,
      data: [{ id: 'c1', name: 'Survey', user_permission_level: 2 }],
    });
    const [loadResult, logoutResult] = await Promise.allSettled([load, logout]);

    expect(options?.signal?.aborted).toBe(true);
    expect(loadResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ name: 'AbortError' }),
    });
    expect(logoutResult.status).toBe('fulfilled');
    expect(cache.setLandmarkCollections).not.toHaveBeenCalled();
  });

  it('invalidates an old offline replay so it cannot publish or remove its op after logout', async () => {
    const opStore = createMemoryOpStore();
    await opStore.put({
      id: 'logout-replay',
      entityType: 'landmark',
      kind: 'create',
      seq: 1,
      createdAt: Date.now(),
      status: 'pending',
      created: {
        id: 'local:logout-replay',
        name: 'Pending camp',
        description: '',
        latitude: 1,
        longitude: 2,
        collection: '',
      },
    });
    const pendingResponse = deferred<{ status: number; data: unknown }>();
    const createLandmark = vi.fn((
      _instance: string,
      _token: string,
      _input: unknown,
      _options?: { signal?: AbortSignal },
    ) => pendingResponse.promise);
    const { controller, cache } = onlineController({ createLandmark } as never, undefined, opStore);
    await vi.waitFor(() => expect(controller.pendingOpsCount).toBe(1));

    const replay = controller.syncOfflineOps();
    await vi.waitFor(() => expect(createLandmark).toHaveBeenCalledOnce());
    const revisionBeforeLogout = controller.landmarksRevision;
    let logoutSettled = false;
    const logout = controller.logout().then(() => { logoutSettled = true; });
    await flushPromises(3);
    const options = createLandmark.mock.calls[0]?.[3];
    const logoutSettledBeforeResponse = logoutSettled;

    pendingResponse.resolve({ status: 201, data: { landmark: apiLandmark } });
    const [replayResult, logoutResult] = await Promise.allSettled([replay, logout]);

    expect(options?.signal?.aborted).toBe(true);
    expect(logoutSettledBeforeResponse).toBe(false);
    expect(replayResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ name: 'AbortError' }),
    });
    expect(logoutResult.status).toBe('fulfilled');
    expect(opStore.remove).not.toHaveBeenCalled();
    expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
    expect(controller.landmarksRevision).toBe(revisionBeforeLogout);
  });

  /** Build an offline-locked controller by failing startup validation. */
  async function offlineController(serviceOverrides?: Partial<SpeleoDBService>) {
    const service = createMockService({
      validateToken: vi.fn(async () => { throw new Error('timeout'); }),
      ...serviceOverrides,
    });
    const prefs = createMockPrefs({ ...ONLINE_PREFS });
    const cache = createMockCache();
    const controller = new SpeleoDBController(
      service,
      prefs,
      cache,
      createMockTilePrefetch(),
      createMemoryOpStore(),
    );
    await controller.validateSession();
    expect(controller.isOfflineLocked).toBe(true);
    return { service, prefs, cache, controller };
  }

  // ---- createLandmark -------------------------------------------------------

  describe('createLandmark', () => {
    it('calls the service, upserts the new feature into cache, and bumps the revision', async () => {
      const createLandmark = vi.fn(async () => ({ status: 201, data: { landmark: apiLandmark } }));
      const { controller, cache } = onlineController({ createLandmark } as never);

      expect(controller.landmarksRevision).toBe(0);
      const result = await controller.createLandmark({
        name: 'Camp',
        latitude: 45.5,
        longitude: -122.25,
        collection: 'col-1',
      });

      expect(result.id).toBe('lm-1');
      expect(createLandmark).toHaveBeenCalledWith(
        ONLINE_PREFS.instance,
        ONLINE_PREFS.token,
        expect.objectContaining({ name: 'Camp', collection: 'col-1' }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      const setCalls = (cache.setOverlayGeoJSON as ReturnType<typeof vi.fn>).mock.calls;
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0][0]).toBe('landmarks');
      const written = setCalls[0][1] as GeoJSON.FeatureCollection;
      expect(written.features.map((f) => f.id)).toContain('lm-1');
      expect(controller.landmarksRevision).toBe(1);
    });

    it('merges into the existing cached landmarks collection', async () => {
      const existing: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'lm-0', properties: { id: 'lm-0' }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      };
      const cache = createMockCache();
      await cache.setOverlayGeoJSON('landmarks', existing);
      vi.mocked(cache.setOverlayGeoJSON).mockClear();
      const createLandmark = vi.fn(async () => ({ status: 201, data: { landmark: apiLandmark } }));
      const { controller } = onlineController({ createLandmark } as never, cache);

      await controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 });

      const written = (cache.setOverlayGeoJSON as ReturnType<typeof vi.fn>).mock.calls[0][1] as GeoJSON.FeatureCollection;
      expect(written.features.map((f) => f.id).sort()).toEqual(['lm-0', 'lm-1']);
    });

    it('does not publish a confirmed landmark when its atomic cache commit fails', async () => {
      const storageError = new Error('landmark cache transaction failed');
      const cache = createMockCache() as ProjectCacheService & {
        updateOverlayFeatureCollection: ReturnType<typeof vi.fn>;
      };
      cache.updateOverlayFeatureCollection = vi.fn(async () => { throw storageError; });
      vi.mocked(cache.setOverlayGeoJSON).mockResolvedValue(false);
      const createLandmark = vi.fn(async () => ({
        status: 201,
        data: { landmark: apiLandmark },
      }));
      const { controller } = onlineController({ createLandmark } as never, cache);

      await expect(controller.createLandmark({
        name: 'Camp',
        latitude: 1,
        longitude: 2,
      })).rejects.toBe(storageError);

      expect(controller.landmarksRevision).toBe(0);
    });

    it('enqueues an offline op (no service call, ground truth untouched) when offline-locked', async () => {
      const createLandmark = vi.fn();
      const { controller, cache } = await offlineController({ createLandmark } as never);

      const result = await controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 });

      // Optimistic landmark carries a local temp id; nothing was sent or written.
      expect(result.id.startsWith('local:')).toBe(true);
      expect(createLandmark).not.toHaveBeenCalled();
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
      expect(controller.pendingOpsCount).toBe(1);

      // The optimistic view folds the pending create over the (empty) ground truth.
      const folded = (await controller.getOverlayGeoJSON('landmarks')) as GeoJSON.FeatureCollection;
      expect(folded.features.map((f) => f.properties?.name)).toContain('Camp');
    });

    it('rejects with a permission error when credentials are missing', async () => {
      const service = createMockService();
      const prefs = createMockPrefs({});
      const controller = new SpeleoDBController(service, prefs, createMockCache(), createMockTilePrefetch());

      await expect(
        controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 }),
      ).rejects.toMatchObject({ kind: 'permission' });
    });

    it('maps a 400 duplicate-coordinate response and does not touch the cache', async () => {
      const createLandmark = vi.fn(async () => ({
        status: 400,
        data: { error: 'A landmark for GPS coordinate (1, 2) already exists or is invalid.' },
      }));
      const { controller, cache } = onlineController({ createLandmark } as never);

      await expect(
        controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 }),
      ).rejects.toMatchObject({ kind: 'duplicate' });
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
      expect(controller.landmarksRevision).toBe(0);
    });

    it('enqueues an offline op when an online create hits a transport error', async () => {
      // A transport failure means "not reachable" -> queue it, do not lose it.
      const createLandmark = vi.fn(async () => { throw new Error('boom'); });
      const { controller, cache } = onlineController({ createLandmark } as never);

      const result = await controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 });

      expect(createLandmark).toHaveBeenCalledOnce();
      expect(result.id.startsWith('local:')).toBe(true);
      expect(controller.pendingOpsCount).toBe(1);
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
    });

    it('surfaces an error when an unreachable create cannot be saved durably', async () => {
      const createLandmark = vi.fn(async () => { throw new Error('boom'); });
      const failingStore = {
        list: vi.fn(async () => []),
        put: vi.fn(async () => false),
        remove: vi.fn(async () => true),
        clear: vi.fn(async () => {}),
      } as unknown as OfflineOpStore;
      const { controller, cache } = onlineController(
        { createLandmark } as never,
        undefined,
        failingStore,
      );

      await expect(
        controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 }),
      ).rejects.toMatchObject({
        kind: 'unknown',
        message: expect.stringContaining('Could not save this offline change'),
      });
      expect(controller.pendingOpsCount).toBe(0);
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
    });

    it('enqueues an offline op when an online create hits a 5xx', async () => {
      const createLandmark = vi.fn(async () => ({ status: 503, data: {} }));
      const { controller } = onlineController({ createLandmark } as never);

      const result = await controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 });

      expect(result.id.startsWith('local:')).toBe(true);
      expect(controller.pendingOpsCount).toBe(1);
    });

    it('flips the app to offline mode when an online create is unreachable', async () => {
      const createLandmark = vi.fn(async () => { throw new Error('network down'); });
      const { controller } = onlineController({ createLandmark } as never);
      expect(controller.isOfflineLocked).toBe(false);

      await controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 });

      expect(controller.isOfflineLocked).toBe(true);
      expect(controller.isOnline).toBe(false);
    });

    it('rejects a malformed success payload with no landmark id', async () => {
      const createLandmark = vi.fn(async () => ({ status: 201, data: { landmark: { name: 'x' } } }));
      const { controller, cache } = onlineController({ createLandmark } as never);

      await expect(
        controller.createLandmark({ name: 'Camp', latitude: 1, longitude: 2 }),
      ).rejects.toMatchObject({ kind: 'unknown' });
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
    });
  });

  // ---- updateLandmark -------------------------------------------------------

  describe('updateLandmark', () => {
    it('upserts the updated feature and bumps the revision', async () => {
      const updateLandmark = vi.fn(async () => ({
        status: 200,
        data: { landmark: { ...apiLandmark, name: 'Renamed' } },
      }));
      const { controller, cache } = onlineController({ updateLandmark } as never);

      const result = await controller.updateLandmark('lm-1', { name: 'Renamed' });

      expect(result.name).toBe('Renamed');
      expect(updateLandmark).toHaveBeenCalledWith(
        ONLINE_PREFS.instance,
        ONLINE_PREFS.token,
        'lm-1',
        expect.objectContaining({ name: 'Renamed' }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      const written = (cache.setOverlayGeoJSON as ReturnType<typeof vi.fn>).mock.calls[0][1] as GeoJSON.FeatureCollection;
      expect(written.features.find((f) => f.id === 'lm-1')?.properties?.name).toBe('Renamed');
      expect(controller.landmarksRevision).toBe(1);
    });

    it('maps a 403 to a permission error and skips cache write', async () => {
      const updateLandmark = vi.fn(async () => ({ status: 403, data: {} }));
      const { controller, cache } = onlineController({ updateLandmark } as never);

      await expect(controller.updateLandmark('lm-1', { name: 'x' })).rejects.toMatchObject({
        kind: 'permission',
      });
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
    });

    it('enqueues an offline edit when offline-locked', async () => {
      const { controller, cache } = await offlineController();
      const result = await controller.updateLandmark('lm-1', { name: 'x', latitude: 1, longitude: 2 });
      expect(result.name).toBe('x');
      expect(controller.pendingOpsCount).toBe(1);
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
    });

    it('flips the app to offline mode when an online edit is unreachable', async () => {
      const updateLandmark = vi.fn(async () => { throw new Error('network down'); });
      const { controller } = onlineController({ updateLandmark } as never);
      expect(controller.isOfflineLocked).toBe(false);

      await controller.updateLandmark('lm-1', { name: 'x', latitude: 1, longitude: 2 });

      expect(controller.isOfflineLocked).toBe(true);
      expect(controller.pendingOpsCount).toBe(1);
    });
  });

  // ---- deleteLandmark -------------------------------------------------------

  describe('deleteLandmark', () => {
    it('removes the feature from the cache and bumps the revision', async () => {
      const existing: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'lm-1', properties: { id: 'lm-1' }, geometry: { type: 'Point', coordinates: [0, 0] } },
          { type: 'Feature', id: 'lm-2', properties: { id: 'lm-2' }, geometry: { type: 'Point', coordinates: [1, 1] } },
        ],
      };
      const cache = createMockCache();
      await cache.setOverlayGeoJSON('landmarks', existing);
      vi.mocked(cache.setOverlayGeoJSON).mockClear();
      const deleteLandmark = vi.fn(async () => ({ status: 200, data: { message: 'deleted' } }));
      const { controller } = onlineController({ deleteLandmark } as never, cache);

      await controller.deleteLandmark('lm-1');

      const written = (cache.setOverlayGeoJSON as ReturnType<typeof vi.fn>).mock.calls[0][1] as GeoJSON.FeatureCollection;
      expect(written.features.map((f) => f.id)).toEqual(['lm-2']);
      expect(controller.landmarksRevision).toBe(1);
    });

    it('maps a 404 to not_found and does not write the cache', async () => {
      const deleteLandmark = vi.fn(async () => ({ status: 404, data: {} }));
      const { controller, cache } = onlineController({ deleteLandmark } as never);

      await expect(controller.deleteLandmark('lm-1')).rejects.toMatchObject({ kind: 'not_found' });
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
    });

    it('enqueues an offline delete (no service call) when offline-locked', async () => {
      const deleteLandmark = vi.fn();
      const { controller, cache } = await offlineController({ deleteLandmark } as never);

      await controller.deleteLandmark('lm-1');

      expect(deleteLandmark).not.toHaveBeenCalled();
      expect(cache.setOverlayGeoJSON).not.toHaveBeenCalled();
      expect(controller.pendingOpsCount).toBe(1);
    });

    it('flips the app to offline mode when an online delete is unreachable', async () => {
      const deleteLandmark = vi.fn(async () => { throw new Error('network down'); });
      const { controller } = onlineController({ deleteLandmark } as never);
      expect(controller.isOfflineLocked).toBe(false);

      await controller.deleteLandmark('lm-1');

      expect(controller.isOfflineLocked).toBe(true);
      expect(controller.pendingOpsCount).toBe(1);
    });
  });

  // ---- getLandmarkCollections -----------------------------------------------

  describe('getLandmarkCollections', () => {
    it('returns mapped writable collections when online', async () => {
      const getLandmarkCollections = vi.fn(async () => ({
        status: 200,
        data: [
          { id: 'c1', name: 'Survey A', is_personal: false, user_permission_level: 2 },
          { id: 'c2', name: 'Read Only', is_personal: false, user_permission_level: 1 },
        ],
      }));
      const { controller } = onlineController({ getLandmarkCollections } as never);

      const result = await controller.getLandmarkCollections();
      expect(result.map((c) => c.id)).toEqual(['c1']);
    });

    it('returns [] when offline-locked', async () => {
      const getLandmarkCollections = vi.fn();
      const { controller } = await offlineController({ getLandmarkCollections } as never);

      expect(await controller.getLandmarkCollections()).toEqual([]);
      expect(getLandmarkCollections).not.toHaveBeenCalled();
    });

    it('returns [] on a non-2xx response', async () => {
      const getLandmarkCollections = vi.fn(async () => ({ status: 500, data: {} }));
      const { controller } = onlineController({ getLandmarkCollections } as never);
      expect(await controller.getLandmarkCollections()).toEqual([]);
    });

    it('returns [] when the request throws', async () => {
      allowConsoleWarn('Failed to load landmark collections:', expect.any(Error));
      const getLandmarkCollections = vi.fn(async () => { throw new Error('net'); });
      const { controller } = onlineController({ getLandmarkCollections } as never);
      expect(await controller.getLandmarkCollections()).toEqual([]);
    });
  });

  // ---- resync refreshes overlays --------------------------------------------

  it('bumps the landmarks revision after a resync rewrites the overlay cache', async () => {
    // A landmark deleted on the web is reflected by a resync that re-fetches the
    // landmarks overlay; the revision bump makes the UI re-read the fresh cache.
    const { controller } = onlineController();
    expect(controller.landmarksRevision).toBe(0);

    await controller.syncProjects();

    expect(controller.landmarksRevision).toBeGreaterThan(0);
  });

  it('does not full-overwrite the landmarks overlay while pending offline ops exist', async () => {
    const pendingCreate: SerializedOfflineOp = {
      id: 'op-create',
      entityType: 'landmark',
      kind: 'create',
      seq: 1,
      createdAt: Date.now(),
      status: 'pending',
      created: {
        id: 'local:camp',
        name: 'Offline Camp',
        description: '',
        latitude: 1,
        longitude: 2,
        collection: '',
      },
    };
    const opStore = {
      list: vi.fn(async () => [pendingCreate]),
      put: vi.fn(async () => true),
      remove: vi.fn(async () => true),
      clear: vi.fn(async () => {}),
    } as unknown as OfflineOpStore;
    const getLandmarksGeoJSON = vi.fn(async () => ({
      status: 200,
      data: { type: 'FeatureCollection', features: [] },
    }) as HttpResponse<GeoJSON.FeatureCollection>);
    const service = createMockService({ getLandmarksGeoJSON });
    const prefs = createMockPrefs({ ...ONLINE_PREFS });
    const cache = createMockCache();
    const controller = new SpeleoDBController(
      service,
      prefs,
      cache,
      createMockTilePrefetch(),
      opStore,
    );

    await controller.syncProjects();

    expect(getLandmarksGeoJSON).not.toHaveBeenCalled();
    expect(cache.setOverlayGeoJSON).not.toHaveBeenCalledWith(
      'landmarks',
      expect.anything(),
      expect.anything(),
    );
  });

  // ---- footprint fidelity (real cache) --------------------------------------

  describe('conflict footprint (real cache, server unchanged)', () => {
    const serverGeo: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'lm-1',
          // Mirror the real backend geojson: id only at feature level, no
          // properties.id; full-precision coordinates.
          properties: {
            name: 'Camp',
            description: 'Base camp',
            collection: 'col-1',
            collection_name: 'Survey A',
            collection_color: '#3b82f6',
            is_personal_collection: false,
            can_write: true,
            can_delete: true,
          },
          geometry: { type: 'Point', coordinates: [-122.2512345, 45.5012345] },
        },
      ],
    };

    // Mirrors the real "Go Online -> Sync" flow: an unreachable CRUD locks the
    // app offline, so the queue can only be replayed after a reconnect clears
    // the lock. validateToken defaults to 200 in the mock service.
    async function goOnlineAndSync(controller: SpeleoDBController) {
      await controller.attemptReconnect();
      await vi.waitFor(() => expect(controller.syncStatus).toBe('done'));
      return controller.syncOfflineOps();
    }

    async function realCacheController(serviceOverrides: Partial<SpeleoDBService>) {
      const { ProjectCacheService: RealCache } = await import('../services/ProjectCacheService');
      const cache = new RealCache();
      await cache.clearAll();
      await cache.setOverlayGeoJSON('landmarks', serverGeo);
      const service = createMockService({
        getLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: serverGeo })),
        ...serviceOverrides,
      });
      const prefs = createMockPrefs({ ...ONLINE_PREFS });
      const controller = new SpeleoDBController(
        service,
        prefs,
        cache,
        createMockTilePrefetch(),
        createMemoryOpStore(),
      );
      return { controller, cache, service };
    }

    it('edits offline then syncs WITHOUT a false conflict when the server is unchanged', async () => {
      // First service call (the online attempt) fails -> enqueue; the replay
      // PATCH succeeds.
      const updateLandmark = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ status: 200, data: { landmark: { ...apiLandmark, name: 'Renamed' } } });
      const { controller } = await realCacheController({ updateLandmark } as never);

      // Edit only the name; resend every other field exactly as the server has it.
      await controller.updateLandmark('lm-1', {
        name: 'Renamed',
        description: 'Base camp',
        latitude: 45.5012345,
        longitude: -122.2512345,
        collection: 'col-1',
      });
      expect(controller.pendingOpsCount).toBe(1);

      const result = await goOnlineAndSync(controller);

      expect(result.conflicted).toBe(0);
      expect(result.succeeded).toBe(1);
      expect(updateLandmark).toHaveBeenCalledTimes(2);
      expect(controller.pendingOpsCount).toBe(0);
    });

    it('deletes offline then syncs WITHOUT a false conflict when the server is unchanged', async () => {
      const deleteLandmark = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ status: 200, data: { message: 'deleted' } });
      const { controller } = await realCacheController({ deleteLandmark } as never);

      await controller.deleteLandmark('lm-1');
      expect(controller.pendingOpsCount).toBe(1);

      const result = await goOnlineAndSync(controller);

      expect(result.conflicted).toBe(0);
      expect(result.succeeded).toBe(1);
      expect(controller.pendingOpsCount).toBe(0);
    });

    it('does NOT fabricate a baseline (no false conflict) when the landmark is absent from the ground truth', async () => {
      // currentLandmarkSnapshot returns null (mock cache has nothing), so the op
      // must carry a null footprint and the replay must push without claiming a
      // conflict -- the exact "every edit warns me" symptom, prevented.
      const updateLandmark = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ status: 200, data: { landmark: { ...apiLandmark, name: 'Renamed' } } });
      // Mock cache returns null for getOverlayGeoJSON; server pull returns a
      // DIFFERENT current value -- a fabricated baseline would have conflicted.
      const { controller } = onlineController({
        updateLandmark,
        getLandmarksGeoJSON: vi.fn(async () => ({
          status: 200,
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 'lm-1',
                properties: { name: 'Server Current', description: '', collection: 'col-1' },
                geometry: { type: 'Point', coordinates: [-122.25, 45.5] },
              },
            ],
          },
        })),
      } as never);

      await controller.updateLandmark('lm-1', {
        name: 'Renamed',
        description: '',
        latitude: 45.5,
        longitude: -122.25,
        collection: 'col-1',
      });

      const result = await goOnlineAndSync(controller);

      expect(result.conflicted).toBe(0);
      expect(result.succeeded).toBe(1);
      expect(updateLandmark).toHaveBeenCalledTimes(2);
    });

    it('does NOT conflict on the exact real-world mismatch (7dp + personal UUID vs 6dp + empty)', async () => {
      // Reproduces the reported console footprint mismatch:
      //   baseline: [..., 20.3027113, -87.4376589, "<personal-uuid>"]   (7dp, UUID, NO personal flag)
      //   server:   [..., 20.302711,  -87.437659,  null]               (6dp, empty)
      const PERSONAL_UUID = '1b6b338e-35b7-4a81-a982-c166e4301793';
      const { ProjectCacheService: RealCache } = await import('../services/ProjectCacheService');
      const cache = new RealCache();
      await cache.clearAll();
      // No landmark-collections cached on purpose: the fix must NOT depend on
      // resolving the personal collection id (collection is excluded entirely).
      // Ground truth cached in create/edit-API shape: personal UUID, 7dp coords,
      // and crucially NO is_personal_collection flag.
      await cache.setOverlayGeoJSON('landmarks', {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'lm-bbb',
            properties: {
              id: 'lm-bbb',
              name: 'Bbb456',
              description: 'Bbb',
              collection: PERSONAL_UUID,
              can_write: true,
              can_delete: true,
            },
            geometry: { type: 'Point', coordinates: [-87.4376589, 20.3027113] },
          },
        ],
      });

      // The geojson endpoint: 6dp coords and an empty collection.
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'lm-bbb',
            properties: { name: 'Bbb456', description: 'Bbb', collection: '' },
            geometry: { type: 'Point', coordinates: [-87.437659, 20.302711] },
          },
        ],
      };
      const fullLandmark = {
        id: 'lm-bbb',
        name: 'Renamed',
        description: 'Bbb',
        latitude: 20.3027113,
        longitude: -87.4376589,
        collection: PERSONAL_UUID,
      };
      const updateLandmark = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ status: 200, data: { landmark: fullLandmark } });
      const service = createMockService({
        updateLandmark,
        getLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: geojson })),
      } as never);
      const controller = new SpeleoDBController(
        service,
        createMockPrefs({ ...ONLINE_PREFS }),
        cache,
        createMockTilePrefetch(),
        createMemoryOpStore(),
      );

      // Edit (rename) -- resends the cached 7dp coords and the personal UUID.
      await controller.updateLandmark('lm-bbb', {
        name: 'Renamed',
        description: 'Bbb',
        latitude: 20.3027113,
        longitude: -87.4376589,
        collection: PERSONAL_UUID,
      });
      const editResult = await goOnlineAndSync(controller);
      expect(editResult.conflicted).toBe(0);
      expect(editResult.succeeded).toBe(1);
    });

    it('does NOT conflict on delete for the same real-world mismatch', async () => {
      const PERSONAL_UUID = '1b6b338e-35b7-4a81-a982-c166e4301793';
      const { ProjectCacheService: RealCache } = await import('../services/ProjectCacheService');
      const cache = new RealCache();
      await cache.clearAll();
      await cache.setOverlayGeoJSON('landmarks', {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'lm-bbb',
            properties: {
              id: 'lm-bbb',
              name: 'Bbb456',
              description: 'Bbb',
              collection: PERSONAL_UUID,
              can_write: true,
              can_delete: true,
            },
            geometry: { type: 'Point', coordinates: [-87.4376589, 20.3027113] },
          },
        ],
      });
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'lm-bbb',
            properties: { name: 'Bbb456', description: 'Bbb', collection: '' },
            geometry: { type: 'Point', coordinates: [-87.437659, 20.302711] },
          },
        ],
      };
      const deleteLandmark = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ status: 200, data: { message: 'deleted' } });
      const controller = new SpeleoDBController(
        createMockService({
          deleteLandmark,
          getLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: geojson })),
        } as never),
        createMockPrefs({ ...ONLINE_PREFS }),
        cache,
        createMockTilePrefetch(),
        createMemoryOpStore(),
      );

      await controller.deleteLandmark('lm-bbb');
      const result = await goOnlineAndSync(controller);

      expect(result.conflicted).toBe(0);
      expect(result.succeeded).toBe(1);
    });

    it('DOES flag a conflict when the server actually changed since the baseline', async () => {
      const changedServer: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            ...serverGeo.features[0],
            properties: { ...serverGeo.features[0].properties, name: 'Renamed On Web' },
          },
        ],
      };
      const updateLandmark = vi.fn().mockRejectedValueOnce(new Error('network down'));
      const { controller } = await realCacheController({
        updateLandmark,
        getLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: changedServer })),
      } as never);

      await controller.updateLandmark('lm-1', {
        name: 'My Rename',
        description: 'Base camp',
        latitude: 45.5012345,
        longitude: -122.2512345,
        collection: 'col-1',
      });

      const result = await goOnlineAndSync(controller);

      expect(result.conflicted).toBe(1);
      // The PATCH must NOT have been sent for the conflicted op.
      expect(updateLandmark).toHaveBeenCalledTimes(1);
    });
  });

  // ---- chaos: sequential mutations accumulate revisions ---------------------

  it('accumulates the revision across multiple successful mutations', async () => {
    const createLandmark = vi.fn(async () => ({ status: 201, data: { landmark: apiLandmark } }));
    const updateLandmark = vi.fn(async () => ({ status: 200, data: { landmark: apiLandmark } }));
    const deleteLandmark = vi.fn(async () => ({ status: 200, data: {} }));
    const { controller } = onlineController({ createLandmark, updateLandmark, deleteLandmark } as never);

    await controller.createLandmark({ name: 'A', latitude: 1, longitude: 2 });
    await controller.updateLandmark('lm-1', { name: 'B' });
    await controller.deleteLandmark('lm-1');

    expect(controller.landmarksRevision).toBe(3);
  });
});

// ==================== GPS tracks ====================

/** In-memory GpsTrackStore so GPS tests are isolated from IndexedDB. */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve as (value?: T | PromiseLike<T>) => void, reject };
}

function createMemoryGpsStore(seed: LocalGpsTrack[] = []) {
  const records = new Map<string, LocalGpsTrack>(seed.map((t) => [t.id, t]));
  const store = {
    records,
    list: vi.fn(async () => [...records.values()].sort((a, b) => b.createdAt - a.createdAt)),
    get: vi.fn(async (id: string) => records.get(id) ?? null),
    put: vi.fn(async (t: LocalGpsTrack) => {
      records.set(t.id, { ...t });
    }),
    remove: vi.fn(async (id: string) => {
      records.delete(id);
    }),
    clear: vi.fn(async () => {
      records.clear();
    }),
  };
  return store as unknown as GpsTrackStore & { records: Map<string, LocalGpsTrack> };
}

/** A controllable fake GeolocationWatcher driven from tests. */
function createFakeWatcher(permission = 'granted') {
  let onFix: ((p: RecordedPoint) => void) | undefined;
  let onError: ((e: unknown) => void) | undefined;
  const watcher = {
    permission,
    startReject: null as Error | null,
    watching: false,
    requestPermissions: vi.fn(async () => watcher.permission),
    start: vi.fn(
      async (
        _opts: unknown,
        fix: (p: RecordedPoint) => void,
        err?: (e: unknown) => void,
      ) => {
        if (watcher.startReject) throw watcher.startReject;
        onFix = fix;
        onError = err;
        watcher.watching = true;
      },
    ),
    stop: vi.fn(async () => {
      watcher.watching = false;
    }),
    get isWatching() {
      return watcher.watching;
    },
    emit(p: RecordedPoint) {
      onFix?.(p);
    },
    emitError(e: unknown) {
      onError?.(e);
    },
  };
  return watcher as unknown as GeolocationWatcher & {
    permission: string;
    watching: boolean;
    emit: (p: RecordedPoint) => void;
    emitError: (e: unknown) => void;
    requestPermissions: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    startReject: Error | null;
  };
}

const GPS_PREFS = { email: 'u@x.com', token: 'tok', instance: 'https://api.test' };

function gpsControllerWith(opts: {
  uploadGpx?: SpeleoDBService['uploadGpx'];
  store?: ReturnType<typeof createMemoryGpsStore>;
  watcher?: ReturnType<typeof createFakeWatcher>;
  notificationPermission?: 'granted' | 'denied';
  /** Pre-seed the cache ground truth with server tracks (parsed shape). */
  remoteTracks?: Record<string, unknown>[];
  /** Make token validation fail so validateSession() locks the app offline. */
  failValidate?: boolean;
  /** Inject a specific offline-map engine (e.g. a controllable one). */
  tilePrefetch?: OfflineMapSyncEngineLike;
} = {}) {
  const store = opts.store ?? createMemoryGpsStore();
  const watcher = opts.watcher ?? createFakeWatcher();
  const service = createMockService({
    uploadGpx:
      opts.uploadGpx ??
      (vi.fn(async () => ({ status: 200, data: { landmarks_created: 1, gps_tracks_created: 1 } })) as never),
    ...(opts.failValidate
      ? { validateToken: vi.fn(async () => { throw new Error('timeout'); }) as never }
      : {}),
  });
  const prefs = createMockPrefs({ ...GPS_PREFS });
  const cache = createMockCache();
  if (opts.remoteTracks) {
    void cache.setGpsTracks(opts.remoteTracks as never);
  }
  const notificationGuard = {
    requestPermission: vi.fn(async () => opts.notificationPermission ?? 'granted'),
  } as RecordingNotificationPermissionGuard & { requestPermission: ReturnType<typeof vi.fn> };
  const controller = new SpeleoDBController(
    service,
    prefs,
    cache,
    opts.tilePrefetch ?? createMockTilePrefetch(),
    createMemoryOpStore(),
    store,
    watcher,
    notificationGuard,
  );
  return { controller, store, watcher, service, prefs, cache, notificationGuard };
}

// Recording drops fixes whose timestamp predates the recording start
// (`Date.now()`), so test fixes are anchored to a far-future base to stay valid
// regardless of when the test runs. `ts` is an offset for ordering/spacing.
// Recording keeps at most one fix per GPS.TRACK_SAMPLE_INTERVAL_MS (15 s), so
// fixes meant to be *kept* are spaced >= 15 s apart in these tests.
const POINT_TS_BASE = 4_000_000_000_000;
function point(lat: number, lng: number, ts: number): RecordedPoint {
  return {
    latitude: lat,
    longitude: lng,
    altitude: 10,
    accuracy: 5,
    altitudeAccuracy: 8,
    timestamp: POINT_TS_BASE + ts,
  };
}

async function recordTrack(
  controller: SpeleoDBController,
  watcher: ReturnType<typeof createFakeWatcher>,
  points: RecordedPoint[],
  name?: string,
): Promise<LocalGpsTrack | null> {
  await controller.startTrackRecording();
  for (const p of points) watcher.emit(p);
  return controller.stopTrackRecording(name);
}

describe('SpeleoDBController GPS tracks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('recording lifecycle', () => {
    it('records fixes and persists a finalized track on stop', async () => {
      const { controller, store, watcher } = gpsControllerWith();
      const track = await recordTrack(controller, watcher, [point(1, 2, 0), point(1.001, 2, 15_000)], 'My Track');

      expect(track).not.toBeNull();
      expect(track!.name).toBe('My Track');
      expect(track!.points).toHaveLength(2);
      expect(controller.gpsRecordingState).toBe('idle');
      expect(controller.gpsTracks.map((t) => t.id)).toContain(track!.id);
      // Finalized track is durably stored.
      expect(store.records.get(track!.id)?.points).toHaveLength(2);
    });

    it('uses the default track name when stop is called without an explicit name', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(POINT_TS_BASE);
      const { controller, watcher } = gpsControllerWith();

      const track = await recordTrack(controller, watcher, [point(1, 2, 0)]);

      expect(track?.name).toMatch(/^Track \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(track?.name).not.toBe('');
      nowSpy.mockRestore();
    });

    it('exposes the live buffer + recording state while recording', async () => {
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      expect(controller.gpsRecordingState).toBe('recording');
      watcher.emit(point(1, 2, 0));
      watcher.emit(point(1.001, 2, 15_000));
      expect(controller.currentTrackPoints).toHaveLength(2);
      await controller.stopTrackRecording();
      expect(controller.currentTrackPoints).toHaveLength(0);
    });

    it('keeps the first fix immediately, then throttles to ~1 per 15 s', async () => {
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      // First real fix is kept right away (instant start, like averaging).
      watcher.emit(point(1, 2, 0));
      expect(controller.currentTrackPoints).toHaveLength(1);
      // Sub-15s fixes are dropped (correlated, add nothing to a walking path).
      watcher.emit(point(1.0001, 2, 5_000));
      watcher.emit(point(1.0002, 2, 14_999));
      expect(controller.currentTrackPoints).toHaveLength(1);
      // Once 15 s elapses, the next fix is kept.
      watcher.emit(point(1.001, 2, 15_000));
      expect(controller.currentTrackPoints).toHaveLength(2);
    });

    it('throws when location permission is denied', async () => {
      const watcher = createFakeWatcher('denied');
      const { controller } = gpsControllerWith({ watcher });
      await expect(controller.startTrackRecording()).rejects.toThrow(/permission/i);
      expect(controller.gpsRecordingState).toBe('idle');
    });

    it('records even when the Android notification permission is denied (non-blocking)', async () => {
      // The foreground service still runs without a visible notification, so a
      // notification denial must NOT block recording -- it is still requested
      // (best-effort, so the notification shows if later granted).
      const { controller, watcher, notificationGuard } = gpsControllerWith({
        notificationPermission: 'denied',
      });
      await controller.startTrackRecording();
      expect(notificationGuard.requestPermission).toHaveBeenCalledTimes(1);
      expect(controller.gpsRecordingState).toBe('recording');
      expect(watcher.start).toHaveBeenCalled();
      watcher.emit(point(1, 2, 0));
      expect(controller.currentTrackPoints).toHaveLength(1);
    });

    it('resumes even when the Android notification permission is denied (non-blocking)', async () => {
      const { controller, watcher, notificationGuard } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      await controller.pauseTrackRecording();
      notificationGuard.requestPermission.mockResolvedValue('denied');

      await controller.resumeTrackRecording();
      expect(notificationGuard.requestPermission).toHaveBeenCalledTimes(2);
      expect(controller.gpsRecordingState).toBe('recording');
      watcher.emit(point(1.001, 2, 15_000));
      expect(controller.currentTrackPoints).toHaveLength(2);
    });

    it('rolls back recording state when the watcher fails to start', async () => {
      const watcher = createFakeWatcher();
      watcher.startReject = new Error('background service not ready');
      const { controller } = gpsControllerWith({ watcher });
      await expect(controller.startTrackRecording()).rejects.toThrow(/service not ready/);
      expect(controller.gpsRecordingState).toBe('idle');
      expect(controller.currentTrackPoints).toHaveLength(0);
      expect(controller.gpsRecordingStartedAt).toBeNull();
    });

    it('discards an empty recording (no points captured)', async () => {
      const { controller, store, watcher } = gpsControllerWith();
      const result = await recordTrack(controller, watcher, []);
      expect(result).toBeNull();
      expect(controller.gpsTracks).toHaveLength(0);
      expect(store.records.size).toBe(0);
    });

    it('pause stops the watch and keeps the buffer; resume continues', async () => {
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      await controller.pauseTrackRecording();
      expect(controller.gpsRecordingState).toBe('paused');
      expect(watcher.stop).toHaveBeenCalled();
      expect(controller.currentTrackPoints).toHaveLength(1);

      await controller.resumeTrackRecording();
      expect(controller.gpsRecordingState).toBe('recording');
      watcher.emit(point(1.001, 2, 15_000));
      expect(controller.currentTrackPoints).toHaveLength(2);
    });

    it('recording elapsed time excludes paused wall time', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(POINT_TS_BASE);
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));

      nowSpy.mockReturnValue(POINT_TS_BASE + 60_000);
      await controller.pauseTrackRecording();
      expect(controller.gpsRecordingElapsedMs).toBe(60_000);
      expect(controller.gpsRecordingElapsedUpdatedAt).toBeNull();

      nowSpy.mockReturnValue(POINT_TS_BASE + 10 * 60_000);
      expect(controller.gpsRecordingElapsedMs).toBe(60_000);

      await controller.resumeTrackRecording();
      expect(controller.gpsRecordingElapsedMs).toBe(60_000);
      expect(controller.gpsRecordingElapsedUpdatedAt).toBe(POINT_TS_BASE + 10 * 60_000);
      nowSpy.mockRestore();
    });

    it('resume while paused preserves the existing buffer', async () => {
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      await controller.pauseTrackRecording();

      await controller.resumeTrackRecording();

      expect(controller.gpsRecordingState).toBe('recording');
      expect(controller.currentTrackPoints).toHaveLength(1);
      watcher.emit(point(1.001, 2, 15_000));
      expect(controller.currentTrackPoints).toHaveLength(2);
    });

    it('drops stale OS replayed fixes after resume using the active watch session start', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(POINT_TS_BASE);
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      await controller.pauseTrackRecording();

      nowSpy.mockReturnValue(POINT_TS_BASE + 60_000);
      await controller.resumeTrackRecording();
      watcher.emit(point(9, 9, 30_000)); // stale replay from before resume
      expect(controller.currentTrackPoints).toHaveLength(1);

      watcher.emit(point(1.001, 2, 60_500));
      expect(controller.currentTrackPoints).toHaveLength(2);
    });

    it('rolls back to paused (keeping the buffer) when the watcher fails to start on resume', async () => {
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      await controller.pauseTrackRecording();
      expect(controller.gpsRecordingState).toBe('paused');

      watcher.startReject = new Error('background service not ready');
      await expect(controller.resumeTrackRecording()).rejects.toThrow(/service not ready/);

      // The failed resume must not strand the session in 'recording': it returns
      // to 'paused' with the captured buffer intact so the user can retry.
      expect(controller.gpsRecordingState).toBe('paused');
      expect(controller.currentTrackPoints).toHaveLength(1);
    });

    it('stop while paused finalizes the buffered points into a saved track', async () => {
      const { controller, store, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      await controller.pauseTrackRecording();

      const track = await controller.stopTrackRecording();

      expect(track).not.toBeNull();
      expect(track?.points).toHaveLength(1);
      expect(controller.gpsRecordingState).toBe('idle');
      expect(store.records.get(track!.id)?.points).toHaveLength(1);
    });

    it('discard while paused deletes the in-progress track without saving', async () => {
      const { controller, store, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      await controller.pauseTrackRecording();

      await controller.discardTrackRecording();

      expect(controller.gpsRecordingState).toBe('idle');
      expect(controller.gpsTracks).toHaveLength(0);
      expect(store.records.size).toBe(0);
    });

    it('discard stops the watch and deletes the in-progress track without saving', async () => {
      const { controller, store, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      watcher.emit(point(1.001, 2, 15_000));
      expect(controller.currentTrackPoints).toHaveLength(2);

      await controller.discardTrackRecording();

      expect(controller.gpsRecordingState).toBe('idle');
      expect(watcher.stop).toHaveBeenCalled();
      expect(controller.currentTrackPoints).toHaveLength(0);
      // Nothing saved, and the in-progress record is removed from storage.
      expect(controller.gpsTracks).toHaveLength(0);
      expect(store.records.size).toBe(0);
    });

    it('rejects discard when not recording', async () => {
      const { controller, watcher } = gpsControllerWith();
      await expect(controller.discardTrackRecording()).rejects.toThrow(/cannot discard/i);
      expect(controller.gpsRecordingState).toBe('idle');
      expect(watcher.stop).not.toHaveBeenCalled();
    });

    it('rejects start while already recording', async () => {
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      await expect(controller.startTrackRecording()).rejects.toThrow(/cannot start/i);
      expect(watcher.requestPermissions).toHaveBeenCalledTimes(1);
    });

    it('chaos: a watch error during recording does not crash or stop recording', async () => {
      allowConsoleWarn(expect.stringContaining('GPS watch error'), expect.anything());
      const { controller, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emitError(new Error('signal lost'));
      expect(controller.gpsRecordingState).toBe('recording');
      watcher.emit(point(1, 2, 0));
      expect(controller.currentTrackPoints).toHaveLength(1);
    });

    it('does not persist any record until the first fix arrives', async () => {
      const { controller, store, watcher } = gpsControllerWith();
      await controller.startTrackRecording();
      // No up-front empty record: a force-quit during GPS warm-up must not leave
      // a useless 0-point "track" behind.
      expect(store.records.size).toBe(0);
      // The first kept fix is what persists the track (incremental crash safety).
      watcher.emit(point(1, 2, 0));
      expect(store.records.size).toBe(1);
    });

    it('serializes incremental persists so crash recovery keeps the latest point buffer', async () => {
      const firstPut = deferred<void>();
      const store = createMemoryGpsStore();
      let putCalls = 0;
      store.put = vi.fn(async (track: LocalGpsTrack) => {
        putCalls += 1;
        const snapshot = { ...track, points: [...track.points] };
        if (putCalls === 1) {
          await firstPut.promise;
        }
        store.records.set(snapshot.id, snapshot);
      }) as never;
      const { controller, watcher } = gpsControllerWith({ store });
      await controller.startTrackRecording();

      watcher.emit(point(1, 2, 0));
      watcher.emit(point(1.001, 2, 15_000));
      expect(store.put).toHaveBeenCalledTimes(1);

      firstPut.resolve();
      await vi.waitFor(() => expect(store.put).toHaveBeenCalledTimes(2));
      expect([...store.records.values()][0].points).toHaveLength(2);
    });

    it('fatal authorization error stops recording and surfaces a message', async () => {
      const { controller, watcher, store } = gpsControllerWith();
      await controller.startTrackRecording();
      // background-geolocation reports NOT_AUTHORIZED when location is denied.
      watcher.emitError({ code: 'NOT_AUTHORIZED', message: 'denied' });

      await vi.waitFor(() => expect(controller.gpsRecordingState).toBe('idle'));
      expect(controller.gpsRecordingState).toBe('idle');
      expect(controller.gpsRecordingError).toBeTruthy();
      expect(watcher.stop).toHaveBeenCalled();
      // Nothing was captured, so no track is left behind.
      expect(controller.gpsTracks).toHaveLength(0);
      expect(store.records.size).toBe(0);

      // The error is one-shot: the UI clears it after surfacing it.
      controller.clearGpsRecordingError();
      expect(controller.gpsRecordingError).toBeNull();
    });

    it('a fatal error mid-recording finalizes captured points (no data loss)', async () => {
      const { controller, watcher, store } = gpsControllerWith();
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      watcher.emit(point(1.001, 2, 15_000));
      // Permission revoked mid-run (web GeolocationPositionError.code === 1).
      watcher.emitError({ code: 1, message: 'User denied Geolocation' });

      await vi.waitFor(() => expect(controller.gpsTracks).toHaveLength(1));
      expect(controller.gpsRecordingState).toBe('idle');
      expect(controller.gpsRecordingError).toBeTruthy();
      expect(controller.gpsRecordingError).toMatch(/track was saved/i);
      // The two captured fixes are kept as a finalized track, not dropped.
      const tracks = controller.gpsTracks;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].pointCount).toBe(2);
      await vi.waitFor(() => expect(store.records.get(tracks[0].id)?.points).toHaveLength(2));
    });
  });

  describe('crash recovery (force-quit mid-recording)', () => {
    it('persists points incrementally so a fresh controller recovers them', async () => {
      const store = createMemoryGpsStore();
      const watcher = createFakeWatcher();
      const { controller } = gpsControllerWith({ store, watcher });

      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));
      watcher.emit(point(1.001, 2, 15_000));
      await vi.waitFor(() => expect(store.records.values().next().value?.points).toHaveLength(2));
      // Simulate a force-quit: never call stop; spin up a new controller on the
      // SAME persisted store.
      const recovered = createMemoryGpsStore([...store.records.values()]);
      const { controller: controller2 } = gpsControllerWith({ store: recovered });
      // Allow the async startup load to run.
      await Promise.resolve();
      await Promise.resolve();

      const tracks = controller2.gpsTracks;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].pointCount).toBe(2);
      expect(controller2.gpsRecordingState).toBe('idle');
      expect(controller2.currentTrackPoints).toHaveLength(0);
    });

    it('recovers a force-quit track via the REAL GpsTrackStore and can upload it', async () => {
      // End-to-end across the controller <-> real IndexedDB-backed store boundary
      // (fake-indexeddb), proving the recovered partial track is a usable,
      // uploadable track -- not just an in-memory artifact.
      const realStore = new GpsTrackStore();
      await realStore.clear();
      try {
        const watcher1 = createFakeWatcher();
        const controller1 = new SpeleoDBController(
          createMockService(),
          createMockPrefs({ ...GPS_PREFS }),
          createMockCache(),
          createMockTilePrefetch(),
          createMemoryOpStore(),
          realStore,
          watcher1,
        );
        await controller1.startTrackRecording();
        watcher1.emit(point(1, 2, 0));
        watcher1.emit(point(1.001, 2, 15_000));
        await vi.waitFor(async () => {
          const persisted = await realStore.list();
          expect(persisted[0]?.points).toHaveLength(2);
        });

        // Force-quit: never call stop. A fresh controller + fresh store instance
        // on the SAME database must recover the track from disk.
        const uploadGpx = vi.fn(async () => ({
          status: 200,
          data: { landmarks_created: 0, gps_tracks_created: 1 },
        }));
        const controller2 = new SpeleoDBController(
          createMockService({ uploadGpx: uploadGpx as never }),
          createMockPrefs({ ...GPS_PREFS }),
          createMockCache(),
          createMockTilePrefetch(),
          createMemoryOpStore(),
          new GpsTrackStore(),
          createFakeWatcher(),
        );
        await vi.waitFor(() => expect(controller2.gpsTracks).toHaveLength(1));
        const recovered = controller2.gpsTracks[0];
        expect(recovered.pointCount).toBe(2);
        expect(recovered.origin).toBe('local');
        expect(recovered.pending).toBeUndefined();

        // Online upload: GPX is sent, the local copy is deleted, the list re-syncs.
        await controller2.uploadGpsTrack(recovered.id);
        expect(uploadGpx).toHaveBeenCalledTimes(1);
        const gpxBody = (uploadGpx.mock.calls[0] as unknown[])[2] as string;
        expect(gpxBody).toContain('<gpx');
        expect(gpxBody).toContain('<trkpt');
        // The recovered local recording is removed once the server accepted it.
        await vi.waitFor(async () => {
          expect(await new GpsTrackStore().get(recovered.id)).toBeNull();
        });
      } finally {
        await realStore.clear();
      }
    });
  });

  // Seed a server-stored track into the controller's ground truth via a sync.
  const SERVER_TRACK = {
    id: 'srv-1',
    name: 'Server Track',
    color: '#377eb8',
    file: 'https://files.test/srv-1.geojson',
    sha256_hash: 'abc',
    creation_date: '2024-01-01T00:00:00Z',
    modified_date: '2024-01-01T00:00:00Z',
  };
  async function seedRemoteTrack(
    controller: SpeleoDBController,
    service: ReturnType<typeof createMockService>,
    track: Record<string, unknown> = SERVER_TRACK,
  ) {
    (service.getGpsTracks as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 200, data: [track] });
    await controller.syncGpsTracks();
  }

  it.each([
    {
      label: 'edit',
      serviceMethod: 'updateGpsTrack' as const,
      optionsIndex: 4,
      response: {
        status: 200,
        data: { id: 'srv-1', name: 'Late edit', color: '#984ea3' },
      },
      invoke: (controller: SpeleoDBController) => controller.editGpsTrack(
        'srv-1',
        { name: 'Late edit', color: '#984ea3' },
      ),
    },
    {
      label: 'delete',
      serviceMethod: 'deleteGpsTrack' as const,
      optionsIndex: 3,
      response: { status: 200, data: { message: 'deleted' } },
      invoke: (controller: SpeleoDBController) => controller.removeGpsTrack('srv-1'),
    },
  ])(
    'aborts and drains an in-flight server GPS $label before logout cache deletion',
    async ({ serviceMethod, optionsIndex, response, invoke }) => {
      const pendingResponse = deferred<{ status: number; data: unknown }>();
      const { controller, service, cache } = gpsControllerWith();
      await seedRemoteTrack(controller, service);
      const request = vi.fn(() => pendingResponse.promise);
      service[serviceMethod] = request as never;
      vi.mocked(cache.setGpsTracks).mockClear();
      vi.mocked(cache.removeGpsTrackGeoJSON).mockClear();

      const mutation = invoke(controller);
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      let logoutSettled = false;
      const logout = controller.logout().then(() => { logoutSettled = true; });
      await flushPromises(3);
      const requestOptions = request.mock.calls[0]?.[optionsIndex] as
        | { signal?: AbortSignal }
        | undefined;
      const logoutSettledBeforeResponse = logoutSettled;

      pendingResponse.resolve(response);
      const [mutationResult, logoutResult] = await Promise.allSettled([mutation, logout]);

      expect(requestOptions?.signal?.aborted).toBe(true);
      expect(logoutSettledBeforeResponse).toBe(false);
      expect(mutationResult).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ name: 'AbortError' }),
      });
      expect(logoutResult.status).toBe('fulfilled');
      expect(cache.setGpsTracks).not.toHaveBeenCalled();
      expect(cache.removeGpsTrackGeoJSON).not.toHaveBeenCalled();
      expect(controller.gpsTracks).toEqual([]);
    },
  );

  it('aborts a lazy server GPS geometry load before it can repopulate cache after logout', async () => {
    const pendingResponse = deferred<{ status: number; data: unknown }>();
    const { controller, service, cache } = gpsControllerWith();
    await seedRemoteTrack(controller, service);
    const downloadJSON = vi.fn((
      _url: string,
      _options?: { signal?: AbortSignal },
    ) => pendingResponse.promise);
    service.downloadJSON = downloadJSON as never;
    vi.mocked(cache.setGpsTrackGeoJSON).mockClear();

    const load = controller.getGpsTrackGeoJSON('srv-1');
    await vi.waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    let logoutSettled = false;
    const logout = controller.logout().then(() => { logoutSettled = true; });
    await flushPromises(3);
    const options = downloadJSON.mock.calls[0]?.[1];
    const logoutSettledBeforeResponse = logoutSettled;

    pendingResponse.resolve({
      status: 200,
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[-73, 45], [-73.01, 45.01]] },
        }],
      },
    });
    const [loadResult, logoutResult] = await Promise.allSettled([load, logout]);

    expect(options?.signal?.aborted).toBe(true);
    expect(logoutSettledBeforeResponse).toBe(false);
    expect(loadResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ name: 'AbortError' }),
    });
    expect(logoutResult.status).toBe('fulfilled');
    expect(cache.setGpsTrackGeoJSON).not.toHaveBeenCalled();
  });

  describe('edit + delete (local recordings)', () => {
    it('edits a local track name + color in place (no network)', async () => {
      const { controller, store, watcher, service } = gpsControllerWith();
      const track = await recordTrack(controller, watcher, [point(1, 2, 0)]);
      await controller.editGpsTrack(track!.id, { name: 'Renamed', color: '#4daf4a' });
      const item = controller.gpsTracks.find((t) => t.id === track!.id)!;
      expect(item.name).toBe('Renamed');
      expect(item.color).toBe('#4daf4a');
      expect(store.records.get(track!.id)?.name).toBe('Renamed');
      expect(service.updateGpsTrack).not.toHaveBeenCalled();
    });

    it('deletes a local track from state and storage', async () => {
      const { controller, store, watcher } = gpsControllerWith();
      const track = await recordTrack(controller, watcher, [point(1, 2, 0)]);
      await controller.removeGpsTrack(track!.id);
      expect(controller.gpsTracks).toHaveLength(0);
      expect(store.records.has(track!.id)).toBe(false);
    });
  });

  describe('unified list snapshot identity (perf)', () => {
    it('keeps gpsTracks referentially stable across a GPS-neutral notify, and rebuilds on a GPS change', async () => {
      const tile = createControllableTilePrefetch();
      const { controller, watcher } = gpsControllerWith({ tilePrefetch: tile.service });
      const track = await recordTrack(controller, watcher, [point(1, 2, 0)]);

      const before = controller.gpsTracks;
      expect(before).toHaveLength(1);

      // A GPS-neutral notify (tile prefetch progress) must NOT rebuild the list:
      // the reference stays identical so the Dashboard's gps-tracks map source
      // is not re-fed on every prefetch tick.
      tile.emit(true);
      expect(controller.gpsTracks).toBe(before);

      // An actual GPS change DOES produce a new reference + content.
      await controller.editGpsTrack(track!.id, { name: 'Renamed' });
      expect(controller.gpsTracks).not.toBe(before);
      expect(controller.gpsTracks.find((t) => t.id === track!.id)?.name).toBe('Renamed');
    });
  });

  describe('server track geometry', () => {
    const TRACK_GEOJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[-73, 45], [-73.01, 45.01]] },
        },
      ],
    };

    it('downloads + parses a server track for display', async () => {
      const { controller, service } = gpsControllerWith();
      await seedRemoteTrack(controller, service);
      (service.downloadJSON as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: TRACK_GEOJSON,
      });
      const points = await controller.getGpsTrackPoints('srv-1');
      expect(points).toHaveLength(2);
      expect(points[0]).toMatchObject({ latitude: 45, longitude: -73 });
    });

    it('parses a stringified geojson body (native transport returns a string)', async () => {
      // CapacitorHttp hands `application/geo+json` back as a raw string; the
      // controller must normalize it (parse) so the track still renders.
      const { controller, service } = gpsControllerWith();
      await seedRemoteTrack(controller, service);
      (service.downloadJSON as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: JSON.stringify(TRACK_GEOJSON),
      });
      const points = await controller.getGpsTrackPoints('srv-1');
      expect(points).toHaveLength(2);
    });
  });

  describe('edit + delete (server tracks)', () => {
    it('lists a synced server track as a remote item', async () => {
      const { controller, service } = gpsControllerWith();
      await seedRemoteTrack(controller, service);
      const item = controller.gpsTracks.find((t) => t.id === 'srv-1');
      expect(item?.origin).toBe('remote');
      expect(item?.name).toBe('Server Track');
    });

    it('edits a server track via PATCH when online', async () => {
      const { controller, service } = gpsControllerWith();
      await seedRemoteTrack(controller, service);
      await controller.editGpsTrack('srv-1', { name: 'New Name', color: '#984ea3' });
      expect(service.updateGpsTrack).toHaveBeenCalledWith('https://api.test', 'tok', 'srv-1', {
        name: 'New Name',
        color: '#984ea3',
      }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      const item = controller.gpsTracks.find((t) => t.id === 'srv-1')!;
      expect(item.name).toBe('New Name');
      expect(item.color).toBe('#984ea3');
    });

    it('deletes a server track via DELETE when online', async () => {
      const { controller, service } = gpsControllerWith();
      await seedRemoteTrack(controller, service);
      await controller.removeGpsTrack('srv-1');
      expect(service.deleteGpsTrack).toHaveBeenCalledWith(
        'https://api.test',
        'tok',
        'srv-1',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(controller.gpsTracks.find((t) => t.id === 'srv-1')).toBeUndefined();
    });

    it('queues an offline edit of a server track and folds it optimistically', async () => {
      const remote = {
        id: 'srv-1', name: 'Server Track', color: '#377eb8',
        fileUrl: 'https://files.test/srv-1.geojson', sha256: 'abc', createdAt: 1, updatedAt: 1,
      };
      const { controller, service } = gpsControllerWith({ remoteTracks: [remote], failValidate: true });
      await flushPromises(3);
      await controller.validateSession();
      expect(controller.isOfflineLocked).toBe(true);

      await controller.editGpsTrack('srv-1', { name: 'Offline Edit' });
      expect(service.updateGpsTrack).not.toHaveBeenCalled();
      expect(controller.pendingOpsCount).toBe(1);
      const item = controller.gpsTracks.find((t) => t.id === 'srv-1')!;
      expect(item.name).toBe('Offline Edit');
      expect(item.pending).toBe('update');
    });

    it('queues an offline delete of a server track (optimistically hidden)', async () => {
      const remote = {
        id: 'srv-1', name: 'Server Track', color: '#377eb8',
        fileUrl: 'https://files.test/srv-1.geojson', sha256: 'abc', createdAt: 1, updatedAt: 1,
      };
      const { controller, service } = gpsControllerWith({ remoteTracks: [remote], failValidate: true });
      await flushPromises(3);
      await controller.validateSession();
      expect(controller.isOfflineLocked).toBe(true);

      await controller.removeGpsTrack('srv-1');
      expect(service.deleteGpsTrack).not.toHaveBeenCalled();
      expect(controller.pendingOpsCount).toBe(1);
      // Optimistically removed from the unified list (shown on the Pending page).
      expect(controller.gpsTracks.find((t) => t.id === 'srv-1')).toBeUndefined();
    });
  });

  describe('upload (create op)', () => {
    async function recordedTrack(uploadGpx: SpeleoDBService['uploadGpx']) {
      const ctx = gpsControllerWith({ uploadGpx });
      const track = await recordTrack(ctx.controller, ctx.watcher, [point(1, 2, 0), point(1.001, 2, 15_000)]);
      return { ...ctx, id: track!.id };
    }

    it('uploads online: sends real GPX, deletes the local copy, re-syncs the list', async () => {
      const uploadGpx = vi.fn(async () => ({ status: 200, data: { landmarks_created: 2, gps_tracks_created: 1 } })) as never;
      const { controller, store, service, id } = await recordedTrack(uploadGpx);

      await controller.uploadGpsTrack(id);

      expect(uploadGpx).toHaveBeenCalledWith(
        'https://api.test',
        'tok',
        expect.stringContaining('<trkpt'),
        expect.stringMatching(/\.gpx$/),
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      // Local copy deleted + a tracks-only sync triggered (delete + replace).
      expect(store.records.has(id)).toBe(false);
      expect(controller.gpsTracks.find((t) => t.id === id)).toBeUndefined();
      expect(service.getGpsTracks).toHaveBeenCalled();
      expect(controller.pendingOpsCount).toBe(0);
    });

    it('throws on a definitive 4xx without enqueuing or going offline', async () => {
      const uploadGpx = vi.fn(async () => ({ status: 400, data: { error: 'bad gpx' } })) as never;
      const { controller, store, id } = await recordedTrack(uploadGpx);

      await expect(controller.uploadGpsTrack(id)).rejects.toThrow(/bad gpx/);
      expect(controller.isOfflineLocked).toBe(false);
      expect(controller.pendingOpsCount).toBe(0);
      // The local recording is kept for retry.
      expect(store.records.has(id)).toBe(true);
    });

    it('enqueues a create op + enters offline on a 5xx', async () => {
      const uploadGpx = vi.fn(async () => ({ status: 503, data: {} })) as never;
      const { controller, id } = await recordedTrack(uploadGpx);

      await controller.uploadGpsTrack(id);
      expect(controller.isOfflineLocked).toBe(true);
      expect(controller.pendingOpsCount).toBe(1);
      const item = controller.gpsTracks.find((t) => t.id === id)!;
      expect(item.pending).toBe('create');
    });

    it('enqueues a create op on a transport error', async () => {
      const uploadGpx = vi.fn(async () => { throw new Error('network down'); }) as never;
      const { controller, id } = await recordedTrack(uploadGpx);
      await controller.uploadGpsTrack(id);
      expect(controller.isOfflineLocked).toBe(true);
      expect(controller.pendingOpsCount).toBe(1);
    });

    it('throws when the track has no valid coordinates (empty GPX), without enqueuing', async () => {
      const uploadGpx = vi.fn(async () => ({ status: 200, data: {} })) as never;
      const { controller, watcher } = gpsControllerWith({ uploadGpx });
      const invalid: RecordedPoint = {
        latitude: Number.NaN, longitude: 200, altitude: null, accuracy: 5, altitudeAccuracy: 8,
        timestamp: POINT_TS_BASE,
      };
      const track = await recordTrack(controller, watcher, [invalid]);

      await expect(controller.uploadGpsTrack(track!.id)).rejects.toThrow(/no valid gps points/i);
      expect(uploadGpx).not.toHaveBeenCalled();
      expect(controller.isOfflineLocked).toBe(false);
      expect(controller.pendingOpsCount).toBe(0);
    });

    it('queues a create op without the network while offline-locked', async () => {
      const uploadGpx = vi.fn(async () => ({ status: 200, data: {} })) as never;
      const { controller, watcher } = gpsControllerWith({ uploadGpx, failValidate: true });
      await controller.validateSession();
      expect(controller.isOfflineLocked).toBe(true);

      const track = await recordTrack(controller, watcher, [point(1, 2, 0)]);
      await controller.uploadGpsTrack(track!.id);
      expect(uploadGpx).not.toHaveBeenCalled();
      expect(controller.pendingOpsCount).toBe(1);
    });

    it('is a no-op for an unknown track id', async () => {
      const { controller } = gpsControllerWith();
      await expect(controller.uploadGpsTrack('nope')).resolves.toBeUndefined();
    });
  });

  describe('offline upload drain (Pending page sync)', () => {
    it('replays a queued create op on syncOfflineOps: uploads + deletes local', async () => {
      const uploadGpx = vi.fn(async () => ({ status: 503, data: {} }));
      const { controller, store, service, watcher } = gpsControllerWith({ uploadGpx: uploadGpx as never });
      const track = await recordTrack(controller, watcher, [point(1, 2, 0), point(1.001, 2, 15_000)]);

      await controller.uploadGpsTrack(track!.id); // 5xx -> pending create op + offline
      expect(controller.pendingOpsCount).toBe(1);
      expect(controller.isOfflineLocked).toBe(true);

      // Reconnect (validateToken 200) clears the lock; the user then syncs Pending.
      await controller.attemptReconnect();
      await vi.waitFor(() => expect(controller.isOfflineLocked).toBe(false));
      uploadGpx.mockResolvedValue({ status: 200, data: { gps_tracks_created: 1 } } as never);

      const summary = await controller.syncOfflineOps();
      expect(summary.succeeded).toBe(1);
      expect(controller.pendingOpsCount).toBe(0);
      // Local recording removed after the confirmed upload; list re-synced.
      expect(store.records.has(track!.id)).toBe(false);
      expect(service.getGpsTracks).toHaveBeenCalled();
    });

    it('does NOT auto-drain GPS uploads on reconnect (Pending page is the sync surface)', async () => {
      const uploadGpx = vi.fn(async () => ({ status: 503, data: {} }));
      const { controller, watcher } = gpsControllerWith({ uploadGpx: uploadGpx as never });
      const track = await recordTrack(controller, watcher, [point(1, 2, 0)]);
      await controller.uploadGpsTrack(track!.id); // 5xx -> pending + offline
      expect(controller.pendingOpsCount).toBe(1);
      uploadGpx.mockClear();

      await controller.attemptReconnect();
      await flushPromises(4);
      // Reconnect refreshes data but never replays the queue automatically.
      expect(uploadGpx).not.toHaveBeenCalled();
      expect(controller.pendingOpsCount).toBe(1);
    });
  });

  describe('logout', () => {
    it('stops recording, clears GPS state, and releases the watch', async () => {
      const { controller, watcher } = gpsControllerWith();
      await recordTrack(controller, watcher, [point(1, 2, 0)]);
      await controller.startTrackRecording();

      await controller.logout();

      expect(controller.gpsRecordingState).toBe('idle');
      expect(controller.gpsTracks).toHaveLength(0);
      expect(controller.currentTrackPoints).toHaveLength(0);
      expect(watcher.stop).toHaveBeenCalled();
    });

    it('does not resurrect a GPS track when logout races an in-flight persist', async () => {
      const pendingPut = deferred<void>();
      const store = createMemoryGpsStore();
      store.put = vi.fn(async (t: LocalGpsTrack) => {
        await pendingPut.promise;
        store.records.set(t.id, { ...t });
      }) as never;
      const { controller, watcher } = gpsControllerWith({ store });
      await controller.startTrackRecording();
      watcher.emit(point(1, 2, 0));

      const logoutPromise = controller.logout();
      await Promise.resolve();
      pendingPut.resolve();
      await logoutPromise;

      expect(store.records.size).toBe(0);
      expect(controller.gpsTracks).toHaveLength(0);
    });

    it('ignores a stale startup GPS load that resolves after logout', async () => {
      const recoveredTrack: LocalGpsTrack = {
        id: 'recovered',
        name: 'Recovered',
        color: '#e41a1c',
        points: [point(1, 2, 0)],
        createdAt: 1,
        updatedAt: 1,
      };
      const listGate = deferred<LocalGpsTrack[]>();
      const store = createMemoryGpsStore([recoveredTrack]);
      store.list = vi.fn(async () => listGate.promise) as never;
      const { controller } = gpsControllerWith({ store });

      await controller.logout();
      listGate.resolve([recoveredTrack]);
      await Promise.resolve();
      await Promise.resolve();

      expect(controller.gpsTracks).toHaveLength(0);
    });
  });
});
