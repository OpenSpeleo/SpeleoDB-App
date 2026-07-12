import { describe, expect, it, vi } from 'vitest';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { OfflineMapSyncEngineLike } from '../services/OfflineMapSyncEngine';
import { EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT } from '../services/OfflineMapSyncStore';
import type { OfflineMapSyncRequest } from '../types/offlineMapSync';
import { CancellationContext } from './CancellationContext';
import { TileCoordinator } from './TileCoordinator';
import type { GpsTrackPrefetchSource } from './GpsTrackCoordinator';
import { evictLayerTilesRuntime } from '../services/TileCacheRuntime';
import type { Project } from '../types/project';

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
      return null;
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
  const notifyStateChanged = vi.fn();
  const coordinator = new TileCoordinator({
    cache,
    preferences: {
      get: () => ({ layerOfflineSync: {} }),
      set: vi.fn(),
    },
    hasNetworkAccess: () => true,
    getProjects: () => [],
    getGpsPrefetchSources,
    notifyStateChanged,
    deferWork: options.deferWork ?? ((work) => work()),
    yieldToMainThread: async () => {},
  }, service);
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
  };
}

describe('TileCoordinator offline coverage', () => {
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

  it('schedules landmarks, combined stations, local GPS, and server GPS', async () => {
    const { coordinator, schedule } = createHarness();
    await coordinator.scheduleSyncPhase(new CancellationContext(1, 'test'), []);

    expect(schedule).toHaveBeenCalledOnce();
    const request = schedule.mock.calls[0][0];
    expectRebuildRequest(request);
    expect(request.plan.maxZoom).toBe(18);
    expect(request.plan.points).toEqual(expect.arrayContaining([[1, 1], [2, 2], [3, 3]]));
    expect(request.plan.paths).toHaveLength(2);
  });

  it('forces every enabled target and remains active through downloader idle', async () => {
    const { coordinator, schedule, waitForIdle } = createHarness();
    await coordinator.refreshOfflineMaps();

    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule.mock.calls[0][0].forceRefresh).toBe(true);
    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(coordinator.isRefreshActive).toBe(false);
  });

  it('does not publish per-tile progress through the global controller store', () => {
    const { emitProgress, notifyStateChanged } = createHarness();

    emitProgress();

    expect(notifyStateChanged).not.toHaveBeenCalled();
  });

  it('fails closed when a required coverage source cannot be read', async () => {
    const { coordinator, schedule, cache } = createHarness();
    vi.mocked(cache.getOverlayGeoJSONForOfflineMap).mockRejectedValueOnce(
      new Error('IndexedDB read failed'),
    );
    const result = await coordinator.scheduleSyncPhase(
      new CancellationContext(1, 'test'),
      [],
    );

    expect(result.status).toBe('failed');
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not evict a disabled layer when generation release fails', async () => {
    const { coordinator, releaseLayer } = createHarness();
    releaseLayer.mockRejectedValueOnce(new Error('release failed'));

    await expect(coordinator.setLayerOfflineSync(
      'esri-world-hillshade',
      false,
    )).rejects.toThrow('release failed');

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
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('enables a layer by reusing the active satellite plan', async () => {
    const { coordinator, schedule } = createHarness();

    await coordinator.setLayerOfflineSync('esri-world-hillshade', true);

    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule.mock.calls[0][0]).toMatchObject({
      mode: 'reuse-active-plan',
      referenceLayerId: 'esri-satellite',
    });
  });
});
