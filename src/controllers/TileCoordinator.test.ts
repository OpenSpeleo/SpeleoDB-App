import { MAP_OVERLAYS } from '../constants';
import { clearCachedTiles } from '../services/tileCache/TileCacheRepository';
import { DownloadAreaType } from '../types/downloadArea';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { OfflineMapSyncEngineLike } from '../services/OfflineMapSyncEngine';
import { EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT } from '../services/OfflineMapSyncStore';
import type { OfflineMapSyncRequest } from '../types/offlineMapSync';
import { CancellationContext } from './CancellationContext';
import { TileCoordinator } from './TileCoordinator';
import type { GpsTrackPrefetchSource } from './GpsTrackCoordinator';
import { evictLayerTilesRuntime } from '../services/TileCacheRuntime';
import type { Project } from '../types/project';
import type { GisGeometryPrefetchSource, GisGeometryPrefetchSnapshot } from '../types/gisGeometry';
import { readDownloadAreaCatalog } from '../services/tileCache/DownloadAreaRepository';

function expectRebuildRequest(
  request: OfflineMapSyncRequest,
): asserts request is Extract<OfflineMapSyncRequest, { mode: 'rebuild' }> {
  expect(request.mode).toBe('rebuild');
  if (request.mode !== 'rebuild') throw new Error('Expected a rebuild request');
}

vi.mock('../services/TileCacheRuntime', () => ({
  clearCachedTilesRuntime: vi.fn(async () => {}),
  evictLayerTilesRuntime: vi.fn(async () => {}),
  setTileCacheOverLimitApprovedRuntime: vi.fn(),
}));

function pointCollection(lng: number, lat: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function projectFixture(id: string): Project {
  return {
    id,
    name: id,
    description: '',
    country: 'FR',
    color: '#123456',
    type: 'private',
    visibility: 'private',
    is_active: true,
    created_by: 'owner',
    creation_date: '2026-01-01',
    modified_date: '2026-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: `${id}.geojson`,
    latest_commit: {
      id: `commit-${id}`,
      message: '',
      author_email: '',
      author_name: '',
      authored_date: '',
      dt_since: '',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
  };
}

const coordinators: TileCoordinator[] = [];
beforeEach(async () => { await clearCachedTiles(); });
afterEach(async () => { for (const coordinator of coordinators.splice(0)) { coordinator.cancel(); await coordinator.stopForLogout(); } });

function createHarness(options: { deferWork?: (work: () => void) => void } = {}) {
  let progressListener: () => void = () => {};
  const schedule = vi.fn(async (_request: OfflineMapSyncRequest) => ({
    coordinateCount: 1,
    scheduledTileCount: 1,
    failedTileCount: 0,
  }));
  const waitForIdle = vi.fn(async () => {});
  const releaseLayer = vi.fn(async () => {});
  const service: OfflineMapSyncEngineLike = {
    subscribe: vi.fn((listener: () => void) => {
      progressListener = listener;
      return () => {};
    }),
    getSnapshot: vi.fn(() => EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT),
    preload: vi.fn(async () => {}),
    schedule,
    resumeBlocked: vi.fn(),
    releaseLayer,
    refreshCacheStats: vi.fn(async () => {}),
    cancel: vi.fn(),
    waitForIdle,
    dispose: vi.fn(),
  };
  const cache = {
    getOverlayGeoJSONForOfflineMap: vi.fn(async (id: string) => {
      if (id === 'landmarks') return pointCollection(1, 1);
      if (id === 'surfaceStations') return pointCollection(2, 2);
      if (id === 'subsurfaceStations') return pointCollection(3, 3);
      return { type: 'FeatureCollection', features: [] };
    }),
  } as unknown as ProjectCacheService;
  const gpsSources: GpsTrackPrefetchSource[] = [
    {
      targetKind: 'gps-track-local',
      targetId: 'local-1',
      sourceRevision: '1',
      paths: [[[4, 4], [4.01, 4.01]]],
    },
    {
      targetKind: 'gps-track-server',
      targetId: 'server-1',
      sourceRevision: 'sha-1',
      paths: [[[5, 5], [5.01, 5.01]]],
    },
  ];
  const getGpsPrefetchSources = vi.fn(async () => gpsSources);
  const gisSources: GisGeometryPrefetchSource[] = [];
  const getGisPrefetchSources = vi.fn(async () => gisSources);
  const getGisPrefetchSnapshot = vi.fn(async (_signal?: AbortSignal, _options?: { refresh?: boolean }): Promise<GisGeometryPrefetchSnapshot> => ({
    sources: await getGisPrefetchSources(), complete: true, retainedSourceKeys: [], isCurrent: () => true,
  }));
  const notifyStateChanged = vi.fn();
  let layerOfflineSync: Record<string, boolean> = {};
  const coordinator = new TileCoordinator({
    cache,
    preferences: {
      get: () => ({ layerOfflineSync }),
      set: vi.fn((value) => { if (value.layerOfflineSync) layerOfflineSync = value.layerOfflineSync; }),
    },
    hasNetworkAccess: () => true,
    getProjects: () => [],
    getGpsPrefetchSources,
    getGisPrefetchSnapshot,
    notifyStateChanged,
    deferWork: options.deferWork ?? ((work) => work()),
    yieldToMainThread: async () => {},
  }, service);
  coordinators.push(coordinator);
  return {
    coordinator,
    schedule,
    waitForIdle,
    notifyStateChanged,
    emitProgress: progressListener,
    cache,
    releaseLayer,
    getGpsPrefetchSources,
    gpsSources,
    gisSources,
    getGisPrefetchSources,
    getGisPrefetchSnapshot,
  };
}

describe('TileCoordinator offline coverage', () => {
  const geometrySource: GisGeometryPrefetchSource = {
    id: 'geometry-1',
    name: 'Reference polygon',
    color: '#377eb8',
    sourceRevision: '3',
    bounds: { west: 6, east: 6.001, south: 6, north: 6.001, crossesDateline: false },
  };

  it('waits for admitted deferred source reads before reporting offline-map idleness', async () => {
    let runDeferred!: () => void;
    const { coordinator, getGisPrefetchSources, schedule } = createHarness({
      deferWork: (work) => { runDeferred = work; },
    });
    const source = deferred<GisGeometryPrefetchSource[]>();
    getGisPrefetchSources.mockReturnValueOnce(source.promise);
    coordinator.queueProjectSync([], 1);
    let idle = false;
    const waiting = coordinator.waitForIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    expect(getGisPrefetchSources).not.toHaveBeenCalled();
    runDeferred();
    await vi.waitFor(() => expect(getGisPrefetchSources).toHaveBeenCalledOnce());
    expect(idle).toBe(false);
    source.resolve([geometrySource]);
    await waiting;
    expect(idle).toBe(true);
    expect(schedule).toHaveBeenCalledOnce();
    expect((await readDownloadAreaCatalog()).areas.some((area) => area.objectId === geometrySource.id)).toBe(true);
  });

  it('keeps unresolved sibling sources owned after another required source fails', async () => {
    const { coordinator, getGisPrefetchSources, cache, schedule } = createHarness();
    const source = deferred<GisGeometryPrefetchSource[]>();
    getGisPrefetchSources.mockReturnValueOnce(source.promise);
    vi.mocked(cache.getOverlayGeoJSONForOfflineMap).mockRejectedValueOnce(new Error('Overlay unavailable'));
    const result = coordinator.scheduleSyncPhase(new CancellationContext(1, 'failure'), []);
    let idle = false;
    const waiting = coordinator.waitForIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    source.resolve([]);
    expect((await result).status).toBe('failed');
    await waiting;
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('settles cancelled deferred admission without needing its scheduler callback', async () => {
    let runDeferred!: () => void;
    const { coordinator, getGisPrefetchSources, schedule } = createHarness({
      deferWork: (work) => { runDeferred = work; },
    });
    coordinator.queueProjectSync([], 1);
    coordinator.cancel();
    await coordinator.waitForIdle();
    runDeferred();
    expect(getGisPrefetchSources).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('drains an active source that ignores abort before completing logout', async () => {
    const { coordinator, getGisPrefetchSources, schedule } = createHarness();
    const source = deferred<GisGeometryPrefetchSource[]>();
    getGisPrefetchSources.mockReturnValueOnce(source.promise);
    coordinator.queueProjectSync([], 1);
    await vi.waitFor(() => expect(getGisPrefetchSources).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = Promise.resolve(coordinator.stopForLogout()).then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    source.resolve([geometrySource]);
    await stopping;
    expect(stopped).toBe(true);
    expect(schedule).not.toHaveBeenCalled();
    expect((await readDownloadAreaCatalog()).areas).toEqual([]);
  });

  it('starts healthy coverage before GIS resolves and then merges its hidden padded rectangle', async () => {
    const { coordinator, schedule, getGisPrefetchSources } = createHarness();
    const pending = deferred<GisGeometryPrefetchSource[]>();
    getGisPrefetchSources.mockReturnValueOnce(pending.promise);
    const sync = coordinator.scheduleSyncPhase(new CancellationContext(1, 'GIS source read'), []);
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());
    expect(getGisPrefetchSources).toHaveBeenCalledOnce();
    const ready = schedule.mock.calls[0][0];
    expectRebuildRequest(ready);
    expect(ready.plan.projects).toHaveLength(5);
    expect((await readDownloadAreaCatalog()).areas).toHaveLength(5);
    expect(coordinator.snapshot.totalTiles).toBeGreaterThan(0);
    pending.resolve([geometrySource]);
    await sync;
    await coordinator.areas.waitForIdle();
    const area = coordinator.areas.getSnapshot().areas.find((value) => value.type === DownloadAreaType.GisGeometry)!;
    expect(area).toMatchObject({ objectId: geometrySource.id, sourceKey: 'gis-geometry:geometry-1', sourceRevision: '3', visible: false });
    expect(area.topLeft[0]).toBeLessThan(6);
    expect(area.topLeft[1]).toBeGreaterThan(6.001);
    expect(area.bottomRight[0]).toBeGreaterThan(6.001);
    expect(area.bottomRight[1]).toBeLessThan(6);
    expect(schedule).toHaveBeenCalledTimes(2);
    const request = schedule.mock.calls[1][0];
    expectRebuildRequest(request);
    expect(request.plan.projects).toHaveLength(6);
  });

  it('preserves unavailable GIS rectangles while healthy sources advance through the union', async () => {
    const { coordinator, schedule, gisSources, gpsSources, getGisPrefetchSources } = createHarness();
    gisSources.push(geometrySource);
    await coordinator.scheduleSyncPhase(new CancellationContext(1, 'initial'), []);
    await coordinator.areas.waitForIdle();
    const before = await readDownloadAreaCatalog();
    const calls = schedule.mock.calls.length;
    gpsSources[0] = { ...gpsSources[0], sourceRevision: '2', paths: [[[7, 7], [7.001, 7.001]]] };
    getGisPrefetchSources.mockRejectedValueOnce(new Error('Current GIS detail unavailable'));
    const result = await coordinator.scheduleSyncPhase(new CancellationContext(2, 'failed'), []);
    await coordinator.areas.waitForIdle();
    expect(result.status).toBe('failed');
    const after = await readDownloadAreaCatalog();
    expect(after.areas.find(area => area.type === DownloadAreaType.GisGeometry))
      .toEqual(before.areas.find(area => area.type === DownloadAreaType.GisGeometry));
    expect(after.areas.find(area => area.sourceKey === 'gps-track-local:local-1'))
      .toMatchObject({ sourceRevision: '2', revision: 2 });
    expect(schedule).toHaveBeenCalledTimes(calls + 1);
  });

  it('plans nonzero healthy automatic coverage on a clean catalog when GIS fails', async () => {
    const { coordinator, schedule, getGisPrefetchSources } = createHarness();
    getGisPrefetchSources.mockRejectedValueOnce(new Error('Geometry endpoint unavailable'));
    const result = await coordinator.scheduleSyncPhase(new CancellationContext(1, 'clean cache'), []);
    await coordinator.areas.waitForIdle();
    expect(result.status).toBe('failed');
    expect(schedule).toHaveBeenCalledOnce();
    const request = schedule.mock.calls[0][0];
    expectRebuildRequest(request);
    expect(request.plan.projects).toHaveLength(5);
    expect((await readDownloadAreaCatalog()).areas).toHaveLength(5);
    expect(coordinator.snapshot.totalTiles).toBeGreaterThan(0);
  });

  it('imports healthy GIS peers while retaining only unresolved accessible identities', async () => {
    const { coordinator, gisSources, getGisPrefetchSnapshot } = createHarness();
    gisSources.push(geometrySource);
    await coordinator.scheduleSyncPhase(new CancellationContext(1, 'initial'), []);
    const prior = (await readDownloadAreaCatalog()).areas.find(area => area.type === DownloadAreaType.GisGeometry);
    getGisPrefetchSnapshot.mockResolvedValueOnce({
      sources: [{ ...geometrySource, id: 'healthy-peer' }], complete: true,
      retainedSourceKeys: ['gis-geometry:geometry-1'], isCurrent: () => true,
    });
    await coordinator.scheduleSyncPhase(new CancellationContext(2, 'partial'), []);
    expect((await readDownloadAreaCatalog()).areas.filter(area => area.type === DownloadAreaType.GisGeometry))
      .toEqual(expect.arrayContaining([prior, expect.objectContaining({ objectId: 'healthy-peer' })]));
  });

  it('does not cancel healthy preparation when historical geometry revocations replay', async () => {
    const { coordinator, schedule, getGisPrefetchSnapshot } = createHarness();
    const deferredSnapshot = deferred<GisGeometryPrefetchSnapshot>();
    getGisPrefetchSnapshot.mockReturnValueOnce(deferredSnapshot.promise);
    const context = new CancellationContext(1, 'historical revocation');
    const pending = coordinator.scheduleSyncPhase(context, []);
    await vi.waitFor(() => expect(getGisPrefetchSnapshot).toHaveBeenCalledOnce());
    await coordinator.removeGisGeometrySources(['previously-revoked']);
    expect(context.signal.aborted).toBe(false);
    deferredSnapshot.resolve({ sources: [geometrySource], complete: true, retainedSourceKeys: [], isCurrent: () => true });
    expect((await pending).status).toBe('applied');
    await coordinator.areas.waitForIdle();
    expect(schedule).toHaveBeenCalled();
    expect((await readDownloadAreaCatalog()).areas).toHaveLength(6);
  });

  it('removes revoked GIS sources despite unrelated failures and rejects an older collected result', async () => {
    const { coordinator, cache, gisSources, getGisPrefetchSnapshot } = createHarness();
    gisSources.push(geometrySource);
    await coordinator.scheduleSyncPhase(new CancellationContext(1, 'initial'), []);
    await coordinator.areas.waitForIdle();
    const before = await readDownloadAreaCatalog();
    const unrelated = before.areas.filter((area) => area.type !== DownloadAreaType.GisGeometry);
    const delayed = deferred<GisGeometryPrefetchSnapshot>();
    getGisPrefetchSnapshot.mockReturnValueOnce(delayed.promise);
    const old = coordinator.scheduleSyncPhase(new CancellationContext(2, 'older'), []);
    const oldRejection = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getGisPrefetchSnapshot).toHaveBeenCalledTimes(2));
    vi.mocked(cache.getOverlayGeoJSONForOfflineMap).mockRejectedValueOnce(new Error('Unrelated cache failure'));
    const failure = await coordinator.scheduleSyncPhase(new CancellationContext(3, 'unrelated failure'), []);
    expect(failure.status).toBe('failed');
    await coordinator.removeGisGeometrySources([geometrySource.id]);
    expect((await readDownloadAreaCatalog()).areas).toEqual(unrelated);
    delayed.resolve({ sources: [geometrySource], complete: true, retainedSourceKeys: [], isCurrent: () => false });
    await oldRejection;
    await coordinator.areas.waitForIdle();
    expect((await readDownloadAreaCatalog()).areas).toEqual(unrelated);
  });

  it('does not start queued project-sync preparation after cancellation', async () => {
    let deferredWork: (() => void) | null = null;
    const { coordinator, schedule } = createHarness({
      deferWork: (work) => { deferredWork = work; },
    });

    coordinator.queueProjectSync([], 11);
    coordinator.cancel();
    (deferredWork as (() => void) | null)?.();
    await Promise.resolve();

    expect(schedule).not.toHaveBeenCalled();
  });

  it('reads project coverage records with bounded concurrency', async () => {
    const { coordinator, cache } = createHarness();
    const gate = deferred<void>();
    let activeReads = 0;
    let maximumActiveReads = 0;
    cache.getProjectGeoJSONRecord = vi.fn(async (id: string) => {
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await gate.promise;
      activeReads -= 1;
      return {
        state: 'active' as const,
        commitId: `commit-${id}`,
        data: pointCollection(1, 1),
        analysis: {
          bounds: { west: 0, east: 2, south: 0, north: 2, crossesDateline: false },
          widthKm: 1,
          heightKm: 1,
          durationMs: 1,
        },
      };
    });
    const projects = Array.from({ length: 6 }, (_, index) => projectFixture(`p${index}`));

    const schedule = coordinator.scheduleSyncPhase(
      new CancellationContext(7, 'test'),
      projects,
    );
    await vi.waitFor(() => expect(cache.getProjectGeoJSONRecord).toHaveBeenCalled());
    const admittedBeforeFirstReadSettled = vi.mocked(cache.getProjectGeoJSONRecord).mock.calls.length;
    gate.resolve();
    await schedule;

    expect(admittedBeforeFirstReadSettled).toBe(4);
    expect(maximumActiveReads).toBe(4);
  });

  it('logs source collection and plan scheduling as separate timing phases', async () => {
    let monotonicTime = 0;
    const performanceNow = vi.spyOn(performance, 'now').mockImplementation(() => {
      monotonicTime += 5;
      return monotonicTime;
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { coordinator } = createHarness();

    await coordinator.scheduleSyncPhase(new CancellationContext(42, 'test'), []);
    const timingRecords = consoleLog.mock.calls
      .filter(([label]) => label === '[offline-map:timing]')
      .map(([, record]) => record);
    performanceNow.mockRestore();
    consoleLog.mockRestore();

    expect(timingRecords).toEqual([
      expect.objectContaining({
        runId: 42,
        phase: 'coverage_source_collection',
        status: 'applied',
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({
        runId: 42,
        phase: 'plan_schedule',
        status: 'applied',
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('schedules each landmark, station, and saved GPS track through the rectangle path', async () => {
    const { coordinator, schedule } = createHarness();
    await coordinator.scheduleSyncPhase(new CancellationContext(1, 'test'), []);
    await coordinator.areas.waitForIdle();
    expect(schedule).toHaveBeenCalledTimes(1);
    for (const [request] of schedule.mock.calls) {
      expectRebuildRequest(request);
      expect(request.coverageKey).toBeTruthy();
      expect(request.plan.projects).toHaveLength(5);
      expect(request.plan.points).toEqual([]);
      expect(request.plan.paths).toEqual([]);
      expect(request.plan.maxZoom).toBe(18);
    }
    expect(coordinator.areas.getSnapshot().areas.map((area) => area.type)).toEqual(expect.arrayContaining([DownloadAreaType.Landmark, DownloadAreaType.Track]));
  });

  it('forces the shared union and remains active through downloader idle', async () => {
    const { coordinator, schedule, waitForIdle } = createHarness();
    await coordinator.refreshOfflineMaps();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls.every(([request]) => request.forceRefresh)).toBe(true);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(coordinator.isRefreshActive).toBe(false);
  });

  it('does not publish per-tile progress through the global controller store', () => {
    const { emitProgress, notifyStateChanged } = createHarness();

    emitProgress();

    expect(notifyStateChanged).not.toHaveBeenCalled();
  });

  it('isolates a failed point family while planning the remaining automatic sources', async () => {
    const { coordinator, schedule, cache } = createHarness();
    vi.mocked(cache.getOverlayGeoJSONForOfflineMap).mockRejectedValueOnce(
      new Error('IndexedDB read failed'),
    );
    const result = await coordinator.scheduleSyncPhase(
      new CancellationContext(1, 'test'),
      [],
    );

    expect(result.status).toBe('failed');
    await coordinator.areas.waitForIdle();
    expect(schedule).toHaveBeenCalledOnce();
    expect((await readDownloadAreaCatalog()).areas).toHaveLength(4);
    expect(coordinator.areas.getSnapshot().error).toContain('Previous downloads are preserved');
  });

  it('does not perform layer-wide eviction when automatic sync is disabled', async () => {
    const { coordinator, releaseLayer } = createHarness();
    await coordinator.setLayerOfflineSync('esri-world-hillshade', false);
    expect(releaseLayer).not.toHaveBeenCalled();
    expect(evictLayerTilesRuntime).not.toHaveBeenCalled();
  });

  it('does not let older source collection supersede a newer request', async () => {
    const { coordinator, schedule, getGpsPrefetchSources, gpsSources } = createHarness();
    let resolveFirst!: (sources: GpsTrackPrefetchSource[]) => void;
    getGpsPrefetchSources
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(gpsSources);

    const first = coordinator.scheduleSyncPhase(new CancellationContext(1, 'older'), []);
    await vi.waitFor(() => expect(getGpsPrefetchSources).toHaveBeenCalledOnce());
    await coordinator.scheduleSyncPhase(new CancellationContext(2, 'newer'), []);
    resolveFirst(gpsSources);

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await coordinator.areas.waitForIdle();
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('enables a layer without inventing geometry when the catalog is empty', async () => {
    const { coordinator, schedule } = createHarness();
    await coordinator.setLayerOfflineSync('esri-world-hillshade', true);
    expect(schedule).not.toHaveBeenCalled();
    expect(coordinator.areas.getSnapshot().areas).toEqual([]);
  });
  it('layer toggles do not supersede or repeat an in-flight source collection', async () => {
    const { coordinator, schedule, getGpsPrefetchSources, gpsSources, cache } = createHarness();
    const gate = deferred<GpsTrackPrefetchSource[]>();
    getGpsPrefetchSources.mockImplementationOnce(() => gate.promise);
    const pending = coordinator.scheduleSyncPhase(new CancellationContext(1, 'source read'), []);
    await vi.waitFor(() => expect(getGpsPrefetchSources).toHaveBeenCalledOnce());
    await coordinator.setLayerOfflineSync('esri-world-hillshade', true);
    await coordinator.setLayerOfflineSync('esri-world-hillshade-dark', true);
    await coordinator.setLayerOfflineSync('esri-world-hillshade', false);
    gate.resolve(gpsSources);
    expect((await pending).status).toBe('applied');
    await coordinator.areas.waitForIdle();
    expect(getGpsPrefetchSources).toHaveBeenCalledOnce();
    expect(cache.getOverlayGeoJSONForOfflineMap).toHaveBeenCalledTimes(MAP_OVERLAYS.length);
    expect(schedule.mock.calls.map(([request]) => request.layers[0].id)).toEqual(['esri-satellite', 'esri-world-hillshade-dark']);
    expect(new Set(schedule.mock.calls.map(([request]) => request.coverageKey)).size).toBe(1);
    expect(coordinator.areas.getSnapshot().areas.every((area) => area.layerIds.join(',') === 'esri-satellite,esri-world-hillshade-dark')).toBe(true);
  });

  it('a failed layer preference commit cannot contaminate the next switch', async () => {
    const { coordinator } = createHarness();
    await coordinator.preload();
    const failure = deferred<void>();
    const original = coordinator.areas.setLayers.bind(coordinator.areas);
    const writes = vi.spyOn(coordinator.areas, 'setLayers').mockImplementationOnce(() => failure.promise).mockImplementation(original);
    const first = coordinator.setLayerOfflineSync('esri-world-hillshade', true);
    const failed = expect(first).rejects.toThrow('Storage failed');
    const second = coordinator.setLayerOfflineSync('esri-world-hillshade-dark', true);
    await vi.waitFor(() => expect(writes).toHaveBeenCalledOnce());
    failure.reject(new Error('Storage failed'));
    await failed;
    await second;
    expect(writes.mock.calls[1][0]).toEqual(['esri-satellite', 'esri-world-hillshade-dark']);
    expect(coordinator.areas.getSnapshot().enabledLayerIds).toEqual(['esri-satellite', 'esri-world-hillshade-dark']);
  });

});
