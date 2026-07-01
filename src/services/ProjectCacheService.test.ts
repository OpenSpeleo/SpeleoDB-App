import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_GEOJSON_VALIDATION } from '../constants';
import { SpeleoDBController, type PreferencesPort } from '../controllers/SpeleoDBController';
import { allowConsoleWarn } from '../test/consoleGuard';
import type { Project } from '../types/project';
import type { SpeleoDBService } from './SpeleoDBService';
import type { OfflineMapSyncEngineLike } from './OfflineMapSyncEngine';
import { EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT } from './OfflineMapSyncStore';
import { CacheStore } from './CacheStore';
import { ProjectCacheService } from './ProjectCacheService';

function persistenceProject(commitId: string): Project {
  return {
    id: 'persistent-project',
    name: 'Persistent project',
    description: '',
    country: 'FR',
    color: '#377eb8',
    type: 'COMPASS',
    visibility: 'PRIVATE',
    is_active: true,
    created_by: 'user@example.com',
    creation_date: '2026-01-01',
    modified_date: '2026-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: 'https://example.com/project.geojson',
    latest_commit: {
      id: commitId,
      message: 'test',
      author_email: 'user@example.com',
      author_name: 'User',
      authored_date: '2026-01-01',
      dt_since: 'today',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
  };
}

function persistenceService(
  project: Project,
  downloadJSON: ReturnType<typeof vi.fn>,
): SpeleoDBService {
  const emptyCollection = { type: 'FeatureCollection', features: [] } as const;
  return {
    getProjectsGeoJSON: vi.fn(async () => ({ status: 200, data: [project] })),
    downloadJSON,
    getLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: emptyCollection })),
    getSubsurfaceStationsGeoJSON: vi.fn(async () => ({ status: 200, data: emptyCollection })),
    getSurfaceStationsGeoJSON: vi.fn(async () => ({ status: 200, data: emptyCollection })),
    getExplorationLeadsGeoJSON: vi.fn(async () => ({ status: 200, data: emptyCollection })),
    getCylinderInstallsGeoJSON: vi.fn(async () => ({ status: 200, data: emptyCollection })),
    getLandmarkCollections: vi.fn(async () => ({ status: 200, data: [] })),
    getGpsTracks: vi.fn(async () => ({ status: 200, data: [] })),
  } as unknown as SpeleoDBService;
}

function persistencePreferences(): PreferencesPort {
  const session = {
    email: 'user@example.com',
    token: 'token',
    instance: 'https://api.example.com',
  };
  return {
    getPreferences: () => ({
      email: 'user@example.com',
      instance: 'https://api.example.com',
      hasStoredSession: true,
    }),
    setPreferences: vi.fn(),
    clearPreferences: vi.fn(),
    session: {
      initialize: vi.fn(async () => session),
      getSession: vi.fn(() => ({ ...session })),
      establish: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    },
  };
}

function persistenceTilePrefetch(): OfflineMapSyncEngineLike {
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
  };
}

describe('ProjectCacheService overlay cache', () => {
  let cache: ProjectCacheService;

  beforeEach(async () => {
    cache = new ProjectCacheService();
    await cache.clearAll();
  });

  it('stores and reads namespaced overlay geojson entries', async () => {
    const overlayPayload: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Landmark A' },
          geometry: { type: 'Point', coordinates: [2.3, 46.6] },
        },
      ],
    };

    await cache.setOverlayGeoJSON('landmarks', overlayPayload);

    const fromCache = await cache.getOverlayGeoJSON('landmarks');
    expect(fromCache).toEqual(overlayPayload);
  });

  it('keeps overlay and project geojson cache entries independent', async () => {
    const projectGeoJson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    const overlayGeoJson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { type: 'sensor' },
          geometry: { type: 'Point', coordinates: [1, 1] },
        },
      ],
    };

    await cache.setGeoJSON('project-1', projectGeoJson, 'commit-1');
    await cache.setOverlayGeoJSON('subsurfaceStations', overlayGeoJson);

    expect(await cache.getGeoJSON('project-1')).toEqual(projectGeoJson);
    expect(await cache.getOverlayGeoJSON('subsurfaceStations')).toEqual(overlayGeoJson);
    expect(await cache.getCachedCommitId('project-1')).toBe('commit-1');
  });

  it('round-trips validated project GeoJSON and its analysis', async () => {
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2, 45] } }],
    };
    const analysis = {
      bounds: { west: 2, east: 2, south: 45, north: 45, crossesDateline: false },
      widthKm: 0,
      heightKm: 0,
      durationMs: 12,
    };
    expect(await cache.setValidatedProjectGeoJSON('p1', geojson, 'c1', analysis)).toBe(true);
    expect(await cache.getProjectGeoJSONRecord('p1')).toEqual({
      state: 'active', commitId: 'c1', data: geojson, analysis,
    });
  });

  it('accepts exact raw limits and the exact worker deadline in schema-v2 metadata', async () => {
    const equatorialDegreesFor100Km = 100 / 6_371.0088 * 180 / Math.PI;
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    const analysis = {
      bounds: {
        west: 0,
        east: equatorialDegreesFor100Km,
        south: -equatorialDegreesFor100Km / 2,
        north: equatorialDegreesFor100Km / 2,
        crossesDateline: false,
      },
      widthKm: PROJECT_GEOJSON_VALIDATION.MAX_WIDTH_KM,
      heightKm: PROJECT_GEOJSON_VALIDATION.MAX_HEIGHT_KM,
      durationMs: PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS,
    };

    expect(await cache.setValidatedProjectGeoJSON('exact-limits', geojson, 'c1', analysis))
      .toBe(true);
    expect(await cache.getProjectGeoJSONRecord('exact-limits')).toEqual({
      state: 'active', commitId: 'c1', data: geojson, analysis,
    });
  });

  it('quarantines per commit, discards unsafe bytes, and persists acknowledgement', async () => {
    await cache.setGeoJSON('p1', { huge: true }, 'c0');
    expect(await cache.setQuarantinedProjectGeoJSON(
      'p1',
      'c1',
      'bbox_too_large',
      {
        bounds: { west: 0, east: 75, south: 0, north: 0, crossesDateline: false },
        widthKm: 8_000,
        heightKm: 0,
        durationMs: 20,
      },
    )).toBe(true);
    expect(await cache.getGeoJSON('p1')).toBeNull();
    expect(await cache.getProjectGeoJSONRecord('p1')).toMatchObject({
      state: 'quarantined',
      commitId: 'c1',
      data: null,
      reason: 'bbox_too_large',
      diagnostics: {
        bounds: { west: 0, east: 75, south: 0, north: 0, crossesDateline: false },
        widthKm: 8_000,
        heightKm: 0,
        durationMs: 20,
      },
      warningAcknowledged: false,
    });

    expect(await cache.acknowledgeProjectGeoJSONQuarantine('p1', 'wrong')).toBe(false);
    expect(await cache.acknowledgeProjectGeoJSONQuarantine('p1', 'c1')).toBe(true);
    expect(await cache.getProjectGeoJSONRecord('p1')).toMatchObject({
      state: 'quarantined', warningAcknowledged: true,
    });
  });

  it('recognizes pre-validation entries as legacy without trusting them as active', async () => {
    const legacy = { type: 'FeatureCollection', features: [] };
    await cache.setGeoJSON('legacy', legacy, 'old-commit');
    expect(await cache.getProjectGeoJSONRecord('legacy')).toEqual({
      state: 'legacy', commitId: 'old-commit', data: legacy,
    });
  });

  it('treats corrupt validation metadata as legacy instead of active', async () => {
    const store = new CacheStore();
    const data = { type: 'FeatureCollection', features: [] };
    await store.set('geojson', 'corrupt', {
      data,
      cachedAt: Date.now(),
      meta: {
        commitId: 'c1',
        projectGeoJSONState: 'active',
        projectGeoJSONValidationVersion:
          String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION),
        projectGeoJSONAnalysis: '{not-json',
      },
    });

    expect(await cache.getProjectGeoJSONRecord('corrupt')).toEqual({
      state: 'legacy',
      commitId: 'c1',
      data,
    });
  });

  it.each([
    ['longitude range', { bounds: { west: -181, east: 2, south: 45, north: 45, crossesDateline: false }, widthKm: 0, heightKm: 0, durationMs: 1 }],
    ['latitude order', { bounds: { west: 2, east: 2, south: 46, north: 45, crossesDateline: false }, widthKm: 0, heightKm: 0, durationMs: 1 }],
    ['non-crossing direction', { bounds: { west: 170, east: -170, south: 0, north: 0, crossesDateline: false }, widthKm: 0, heightKm: 0, durationMs: 1 }],
    ['crossing direction', { bounds: { west: -170, east: 170, south: 0, north: 0, crossesDateline: true }, widthKm: 0, heightKm: 0, durationMs: 1 }],
    ['zero-width crossing', { bounds: { west: 180, east: -180, south: 0, north: 0, crossesDateline: true }, widthKm: 0, heightKm: 0, durationMs: 1 }],
    ['negative dimension', { bounds: { west: 2, east: 2, south: 45, north: 45, crossesDateline: false }, widthKm: -1, heightKm: 0, durationMs: 1 }],
    ['raw width limit', { bounds: { west: 2, east: 3, south: 45, north: 45, crossesDateline: false }, widthKm: PROJECT_GEOJSON_VALIDATION.MAX_WIDTH_KM + 0.001, heightKm: 0, durationMs: 1 }],
    ['raw height limit', { bounds: { west: 2, east: 2, south: 45, north: 46, crossesDateline: false }, widthKm: 0, heightKm: PROJECT_GEOJSON_VALIDATION.MAX_HEIGHT_KM + 0.001, durationMs: 1 }],
    ['analysis deadline', { bounds: { west: 2, east: 2, south: 45, north: 45, crossesDateline: false }, widthKm: 0, heightKm: 0, durationMs: PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS + 0.001 }],
    ['projected x safety limit', { bounds: { west: 0, east: 1, south: 89, north: 89, crossesDateline: false }, widthKm: 2, heightKm: 0, durationMs: 1 }],
    ['projected y safety limit', { bounds: { west: 0, east: 0, south: 80, north: 80.2, crossesDateline: false }, widthKm: 0, heightKm: 23, durationMs: 1 }],
  ])('treats schema-v2 active metadata with an invalid %s as legacy', async (_label, analysis) => {
    const store = new CacheStore();
    const data = { type: 'FeatureCollection', features: [] };
    await store.set('geojson', 'invalid-active', {
      data,
      cachedAt: Date.now(),
      meta: {
        commitId: 'c1',
        projectGeoJSONState: 'active',
        projectGeoJSONValidationVersion:
          String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION),
        projectGeoJSONAnalysis: JSON.stringify(analysis),
      },
    });

    expect(await cache.getProjectGeoJSONRecord('invalid-active')).toEqual({
      state: 'legacy',
      commitId: 'c1',
      data,
    });
  });

  it.each([
    ['infrastructure reason', {
      projectGeoJSONFailureReason: 'validation_unavailable',
      projectGeoJSONFailureDiagnostics: JSON.stringify({
        bounds: null, widthKm: null, heightKm: null, durationMs: 500,
      }),
      projectGeoJSONWarningAcknowledged: 'false',
    }],
    ['missing diagnostics', {
      projectGeoJSONFailureReason: 'bbox_timeout',
      projectGeoJSONWarningAcknowledged: 'false',
    }],
    ['negative diagnostics', {
      projectGeoJSONFailureReason: 'bbox_timeout',
      projectGeoJSONFailureDiagnostics: JSON.stringify({
        bounds: null, widthKm: null, heightKm: null, durationMs: -1,
      }),
      projectGeoJSONWarningAcknowledged: 'false',
    }],
    ['inexact acknowledgement', {
      projectGeoJSONFailureReason: 'bbox_timeout',
      projectGeoJSONFailureDiagnostics: JSON.stringify({
        bounds: null, widthKm: null, heightKm: null, durationMs: 500,
      }),
      projectGeoJSONWarningAcknowledged: 'yes',
    }],
  ])('treats a schema-v2 quarantine with %s as legacy', async (_label, quarantineMeta) => {
    const store = new CacheStore();
    await store.set('geojson', 'invalid-quarantine', {
      data: null,
      cachedAt: Date.now(),
      meta: {
        commitId: 'c1',
        projectGeoJSONState: 'quarantined',
        projectGeoJSONValidationVersion:
          String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION),
        ...quarantineMeta,
      },
    });

    expect(await cache.getProjectGeoJSONRecord('invalid-quarantine')).toEqual({
      state: 'legacy', commitId: 'c1', data: null,
    });
    expect(await cache.acknowledgeProjectGeoJSONQuarantine('invalid-quarantine', 'c1')).toBe(false);
  });

  it.each(['validation_unavailable', 'bbox_timeout'] as const)(
    'refuses to create a durable quarantine for %s',
    async (reason) => {
      expect(await cache.setQuarantinedProjectGeoJSON(
        'non-content-failure',
        'c1',
        // Exercise the runtime boundary in addition to the content-only parameter type.
        reason as 'bbox_error',
        { bounds: null, widthKm: null, heightKm: null, durationMs: 10_000 },
      )).toBe(false);
      expect(await cache.getProjectGeoJSONRecord('non-content-failure')).toEqual({
        state: 'missing', commitId: null, data: null,
      });
    },
  );

  it('propagates a project-record storage read failure', async () => {
    const storageError = new Error('IndexedDB read failed');
    const failingStore = {
      get: vi.fn(async () => { throw storageError; }),
    } as unknown as CacheStore;
    const failingCache = new ProjectCacheService(failingStore);

    await expect(failingCache.getProjectGeoJSONRecord('p1')).rejects.toBe(storageError);
  });

  it('does not let an old acknowledgement overwrite a concurrently persisted newer commit', async () => {
    const diagnostics = {
      bounds: null,
      widthKm: null,
      heightKm: null,
      durationMs: 10,
    };
    await cache.setQuarantinedProjectGeoJSON('ack-race', 'c1', 'bbox_error', diagnostics);

    const oldAcknowledgement = cache.acknowledgeProjectGeoJSONQuarantine('ack-race', 'c1');
    const newerCommit = cache.setQuarantinedProjectGeoJSON(
      'ack-race', 'c2', 'bbox_error', diagnostics,
    );
    expect(await Promise.all([oldAcknowledgement, newerCommit])).toEqual([true, true]);
    expect(await cache.getProjectGeoJSONRecord('ack-race')).toMatchObject({
      state: 'quarantined',
      commitId: 'c2',
      warningAcknowledged: false,
    });

    const replacementFirst = cache.setQuarantinedProjectGeoJSON(
      'ack-race', 'c3', 'bbox_error', diagnostics,
    );
    const staleAcknowledgement = cache.acknowledgeProjectGeoJSONQuarantine('ack-race', 'c2');
    await replacementFirst;
    expect(await staleAcknowledgement).toBe(false);
    expect(await cache.getProjectGeoJSONRecord('ack-race')).toMatchObject({
      state: 'quarantined',
      commitId: 'c3',
      warningAcknowledged: false,
    });
  });

  it('clears overlay geojson cache entries on clearAll', async () => {
    await cache.setOverlayGeoJSON('explorationLeads', {
      type: 'FeatureCollection',
      features: [],
    });

    await cache.clearAll();

    expect(await cache.getOverlayGeoJSON('explorationLeads')).toBeNull();
  });

  it('throws AbortError instead of swallowing cancelled writes', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      cache.setProjects([], { signal: abortController.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('leaves existing data intact when a write or clear is already aborted', async () => {
    await cache.setGeoJSON('abort-preserves', { original: true }, 'c1');
    const abortController = new AbortController();
    abortController.abort();

    await expect(cache.setGeoJSON(
      'abort-preserves',
      { replacement: true },
      'c2',
      { signal: abortController.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    await expect(cache.clearAll({ signal: abortController.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(await cache.getGeoJSON('abort-preserves')).toEqual({ original: true });
    expect(await cache.getCachedCommitId('abort-preserves')).toBe('c1');
  });

  it('aborts an in-flight IndexedDB transaction before replacement bytes commit', async () => {
    await cache.setGeoJSON('abort-in-flight', { original: true }, 'c1');
    const abortController = new AbortController();
    const originalPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
      abortController.abort();
      return request;
    });

    try {
      await expect(cache.setGeoJSON(
        'abort-in-flight',
        { replacement: true },
        'c2',
        { signal: abortController.signal },
      )).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      putSpy.mockRestore();
    }

    expect(await cache.getGeoJSON('abort-in-flight')).toEqual({ original: true });
    expect(await cache.getCachedCommitId('abort-in-flight')).toBe('c1');
  });

  it('persists quarantine and acknowledgement across controller recreation, then recovers', async () => {
    for (let index = 0; index < 3; index += 1) {
      allowConsoleWarn(
        '[project-geojson:bbox]',
        expect.objectContaining({
          projectId: 'persistent-project',
          commitId: 'oversized',
          reason: 'bbox_too_large',
        }),
      );
    }
    const oversized: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[0, 0], [75, 0]] },
      }],
    };
    const firstDownload = vi.fn(async () => ({ status: 200, data: oversized }));
    const firstController = new SpeleoDBController(
      persistenceService(persistenceProject('oversized'), firstDownload),
      persistencePreferences(),
      cache,
      persistenceTilePrefetch(),
    );

    await firstController.syncProjects();
    expect(firstDownload).toHaveBeenCalledOnce();
    expect(firstController.projectGeoJSONWarnings).toHaveLength(1);
    expect(await cache.getProjectGeoJSONRecord('persistent-project')).toMatchObject({
      state: 'quarantined',
      commitId: 'oversized',
      data: null,
      warningAcknowledged: false,
    });

    const repeatedDownload = vi.fn(async () => {
      throw new Error('same quarantined commit must not download');
    });
    const neverAnalyze = vi.fn(async () => {
      throw new Error('same quarantined commit must not analyze');
    });
    const secondController = new SpeleoDBController(
      persistenceService(persistenceProject('oversized'), repeatedDownload),
      persistencePreferences(),
      cache,
      persistenceTilePrefetch(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { analyze: neverAnalyze },
    );
    await secondController.syncProjects();
    expect(repeatedDownload).not.toHaveBeenCalled();
    expect(neverAnalyze).not.toHaveBeenCalled();
    expect(secondController.projectGeoJSONWarnings).toHaveLength(1);

    await secondController.acknowledgeProjectGeoJSONWarnings();
    expect(await cache.getProjectGeoJSONRecord('persistent-project')).toMatchObject({
      state: 'quarantined',
      warningAcknowledged: true,
    });

    const thirdController = new SpeleoDBController(
      persistenceService(persistenceProject('oversized'), repeatedDownload),
      persistencePreferences(),
      cache,
      persistenceTilePrefetch(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { analyze: neverAnalyze },
    );
    await thirdController.syncProjects();
    expect(thirdController.projectGeoJSONWarnings).toEqual([]);

    const compact: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[2, 45], [2.01, 45.01]] },
      }],
    };
    const fixedDownload = vi.fn(async () => ({ status: 200, data: compact }));
    const recoveredController = new SpeleoDBController(
      persistenceService(persistenceProject('fixed'), fixedDownload),
      persistencePreferences(),
      cache,
      persistenceTilePrefetch(),
    );
    await recoveredController.syncProjects();

    expect(fixedDownload).toHaveBeenCalledOnce();
    expect(recoveredController.projectGeoJSONWarnings).toEqual([]);
    expect(await recoveredController.getProjectMapData('persistent-project')).toMatchObject({
      featureCollection: compact,
      bounds: expect.any(Object),
    });
  });

  it('revalidates a historical 500 ms timeout marker for the same commit when online', async () => {
    const store = new CacheStore();
    await store.set('geojson', 'persistent-project', {
      data: null,
      cachedAt: Date.now(),
      meta: {
        commitId: 'legacy-timeout',
        projectGeoJSONState: 'quarantined',
        projectGeoJSONValidationVersion:
          String(PROJECT_GEOJSON_VALIDATION.CACHE_SCHEMA_VERSION),
        projectGeoJSONFailureReason: 'bbox_timeout',
        projectGeoJSONFailureDiagnostics: JSON.stringify({
          bounds: null,
          widthKm: null,
          heightKm: null,
          durationMs: 500,
        }),
        projectGeoJSONWarningAcknowledged: 'false',
      },
    });

    expect(await cache.getProjectGeoJSONRecord('persistent-project')).toMatchObject({
      state: 'quarantined',
      commitId: 'legacy-timeout',
      reason: 'bbox_timeout',
    });

    const compact: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[2, 45], [2.01, 45.01]] },
      }],
    };
    const download = vi.fn(async () => ({ status: 200, data: compact }));
    const controller = new SpeleoDBController(
      persistenceService(persistenceProject('legacy-timeout'), download),
      persistencePreferences(),
      cache,
      persistenceTilePrefetch(),
    );

    await controller.syncProjects();

    expect(download).toHaveBeenCalledOnce();
    expect(controller.projectGeoJSONWarnings).toEqual([]);
    expect(await cache.getProjectGeoJSONRecord('persistent-project')).toMatchObject({
      state: 'active',
      commitId: 'legacy-timeout',
      data: compact,
    });
    expect(await controller.getProjectMapData('persistent-project')).toMatchObject({
      commitId: 'legacy-timeout',
      featureCollection: compact,
      bounds: expect.any(Object),
    });
  });

  it('stores and reads the server GPS-track metadata list', async () => {
    const tracks = [
      { id: 'g1', name: 'A', color: '#377eb8', fileUrl: 'u1', sha256: 'h1', createdAt: 1, updatedAt: 1 },
      { id: 'g2', name: 'B', color: '#e41a1c', fileUrl: 'u2', sha256: 'h2', createdAt: 2, updatedAt: 2 },
    ];
    expect(await cache.getGpsTracks()).toBeNull();
    await cache.setGpsTracks(tracks);
    expect(await cache.getGpsTracks()).toEqual(tracks);
  });

  it('stores, reads and removes per-track GeoJSON geometry independently', async () => {
    const geo: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }],
    };
    await cache.setGpsTrackGeoJSON('g1', geo);
    expect(await cache.getGpsTrackGeoJSON('g1')).toEqual(geo);
    expect(await cache.getGpsTrackGeoJSON('g2')).toBeNull();
    await cache.removeGpsTrackGeoJSON('g1');
    expect(await cache.getGpsTrackGeoJSON('g1')).toBeNull();
  });

  it('clears GPS track caches on clearAll', async () => {
    await cache.setGpsTracks([{ id: 'g1', name: 'A', color: '#377eb8', fileUrl: 'u', sha256: 'h', createdAt: 1, updatedAt: 1 }]);
    await cache.setGpsTrackGeoJSON('g1', { type: 'FeatureCollection', features: [] });
    await cache.clearAll();
    expect(await cache.getGpsTracks()).toBeNull();
    expect(await cache.getGpsTrackGeoJSON('g1')).toBeNull();
  });
});
