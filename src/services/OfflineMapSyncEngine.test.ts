import { describe, expect, it, vi } from 'vitest';
import type {
  OfflineMapGenerationRecord,
  OfflineMapPlanningInput,
  OfflineMapPlanRecord,
  OfflineMapSyncRequest,
} from '../types/offlineMapSync';
import {
  OfflineMapSyncEngine,
  type OfflineMapSyncEngineDependencies,
} from './OfflineMapSyncEngine';
import { OfflineMapSyncStore } from './OfflineMapSyncStore';

function request(coordinateCount = 12): OfflineMapSyncRequest {
  return {
    mode: 'rebuild',
    plan: {
      sourceRevision: `revision-${coordinateCount}`,
      projects: [],
      points: [],
      paths: [],
      minZoom: 0,
      maxZoom: 18,
      padMeters: 50,
    },
    layers: [{ id: 'esri-satellite', tileUrlTemplate: 'https://tiles/{z}/{x}/{y}' }],
  };
}

function encodedCoordinates(count: number): Uint32Array {
  const values = new Uint32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = 18;
    values[index * 3 + 1] = index;
    values[index * 3 + 2] = index;
  }
  return values;
}

function harness(options: {
  count?: number;
  activeGeneration?: OfflineMapGenerationRecord;
  fetchTile?: ReturnType<typeof vi.fn>;
  claimCached?: ReturnType<typeof vi.fn>;
  now?: () => number;
  isOnline?: () => boolean;
  isTerminalFetchError?: (error: unknown) => boolean;
  persistGeneration?: (generation: OfflineMapGenerationRecord) => Promise<void>;
} = {}) {
  const count = options.count ?? 12;
  const plan: OfflineMapPlanRecord = {
    id: `plan-${count}`,
    sourceRevision: `revision-${count}`,
    coverageVersion: 2,
    coordinateCount: count,
    chunkCount: count > 0 ? 1 : 0,
    createdAt: 1,
  };
  const generations = new Map<string, OfflineMapGenerationRecord>();
  if (options.activeGeneration) generations.set(options.activeGeneration.id, options.activeGeneration);
  const paintCallbacks: Array<() => void> = [];
  const store = new OfflineMapSyncStore((callback) => {
    paintCallbacks.push(callback);
    return () => {};
  });
  const fetchTile = options.fetchTile ?? vi.fn(async () => ({
    downloadedBytes: 10,
    cacheDeltaBytes: 10,
  }));
  const claimCached = options.claimCached ?? vi.fn(async (urls: readonly string[]) => (
    urls.map(() => null)
  ));
  const setGeneration = vi.fn(async (generation: OfflineMapGenerationRecord) => {
    await options.persistGeneration?.(generation);
    generations.set(generation.id, { ...generation });
  });
  const releaseGeneration = vi.fn(async (generationId: string) => {
    generations.delete(generationId);
  });
  const engine = new OfflineMapSyncEngine({
    store,
    now: options.now ?? (() => Date.now()),
    isOnline: options.isOnline ?? (() => true),
    migrate: vi.fn(async () => {}),
    getCacheStats: vi.fn(async () => ({
      totalBytes: 0,
      tileCount: 0,
      pinnedBytes: 0,
      pinnedTileCount: 0,
      updatedAt: 1,
    })),
    getPlan: vi.fn(async () => plan),
    getPlanById: vi.fn(async (planId: string) => planId === plan.id ? plan : null),
    getPlanChunk: vi.fn(async (_planId: string, index: number) => (
      count > 0 && index === 0
        ? { planId: plan.id, index: 0, coordinates: encodedCoordinates(count) }
        : null
    )),
    getGenerations: vi.fn(async () => [...generations.values()]),
    normalizeGenerations: vi.fn(async () => [...generations.values()]),
    recoverPlanStorage: vi.fn(async () => {}),
    setGeneration,
    activateGeneration: vi.fn(async (generationId: string) => {
      const next = generations.get(generationId)!;
      const previous = [...generations.values()].find((generation) => (
        generation.layerId === next.layerId && generation.status === 'active'
      ));
      generations.set(generationId, { ...next, status: 'active' });
      return previous ? [previous.id] : [];
    }),
    releaseGeneration,
    garbageCollectPlans: vi.fn(async () => {}),
    claimCached: claimCached as unknown as OfflineMapSyncEngineDependencies['claimCached'],
    fetchTile: fetchTile as unknown as OfflineMapSyncEngineDependencies['fetchTile'],
    plan: vi.fn(),
    isTerminalFetchError: options.isTerminalFetchError ?? (() => false),
  });
  return {
    engine,
    store,
    paintCallbacks,
    fetchTile,
    claimCached,
    setGeneration,
    releaseGeneration,
  };
}

describe('OfflineMapSyncEngine', () => {
  it('persists a 12K plan in six final chunks before the planner completes', async () => {
    const finalChunks = [2_048, 2_048, 2_048, 2_048, 2_048, 1_760]
      .map(encodedCoordinates);
    const putPlanChunk = vi.fn(async () => {});
    let chunkWasDurableBeforePlannerCompletion = false;
    const planner = vi.fn(async (
      _input: OfflineMapPlanningInput,
      consume: (chunk: Uint32Array, index: number) => Promise<void> | void,
    ) => {
      for (let index = 0; index < finalChunks.length; index += 1) {
        await consume(finalChunks[index], index);
      }
      chunkWasDurableBeforePlannerCompletion = putPlanChunk.mock.calls.length === 6;
      return 12_000;
    });
    const committed: OfflineMapPlanRecord[] = [];
    const engine = new OfflineMapSyncEngine({
      getPlan: vi.fn(async () => null),
      getPlanById: vi.fn(async (id: string) => committed.find((plan) => plan.id === id) ?? null),
      deletePlan: vi.fn(async () => {}),
      deletePlanChunks: vi.fn(async () => {}),
      putPlanChunk,
      commitPlan: vi.fn(async (plan: OfflineMapPlanRecord) => {
        committed.push(plan);
      }),
      plan: planner,
      getPlanChunk: vi.fn(async (_planId: string, index: number) => ({
        planId: committed[0]?.id ?? 'pending', index, coordinates: finalChunks[index],
      })),
      getGenerations: vi.fn(async () => []),
      setGeneration: vi.fn(async () => {}),
      activateGeneration: vi.fn(async () => []),
      releaseGeneration: vi.fn(async () => {}),
      normalizeGenerations: vi.fn(async () => []),
      recoverPlanStorage: vi.fn(async () => {}),
      garbageCollectPlans: vi.fn(async () => {}),
      getCacheStats: vi.fn(async () => ({
        totalBytes: 0, tileCount: 0, pinnedBytes: 0, pinnedTileCount: 0, updatedAt: 1,
      })),
      claimCached: vi.fn(async () => [{
        url: 'https://tiles/18/0/0',
        sizeBytes: 1,
        isNoData: false,
        fetchedAt: Date.now(),
        lastAccessedAt: Date.now(),
        prefetchOwnerCount: 1,
        pinnedByAutoPrefetch: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]),
      fetchTile: vi.fn(),
      migrate: vi.fn(async () => {}),
      isOnline: () => true,
    });

    await engine.schedule(request(12_000));
    engine.cancel();
    await engine.waitForIdle();

    expect(chunkWasDurableBeforePlannerCompletion).toBe(true);
    expect(putPlanChunk).toHaveBeenCalledTimes(6);
    expect(putPlanChunk).toHaveBeenLastCalledWith(expect.objectContaining({
      index: 5,
      coordinates: finalChunks[5],
    }));
    expect(committed[0]).toMatchObject({ coordinateCount: 12_000, chunkCount: 6 });
  });

  it('keeps six downloads active and drains the next tile immediately', async () => {
    const gates: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchTile = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight -= 1;
      return { downloadedBytes: 10, cacheDeltaBytes: 10 };
    });
    const { engine } = harness({ count: 12, fetchTile });

    await engine.schedule(request(12));
    await vi.waitFor(() => expect(gates).toHaveLength(6));
    expect(maxInFlight).toBe(6);

    gates.shift()!();
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(7));
    while (gates.length > 0) gates.shift()!();
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(12));
    while (gates.length > 0) gates.shift()!();
    await engine.waitForIdle();

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'completed',
      totalTiles: 12,
      completedTiles: 12,
      failedTiles: 0,
    });
  });

  it('backpressures audited work at 64 outstanding tasks and clears it on cancellation', async () => {
    const gates: Array<() => void> = [];
    const fetchTile = vi.fn(async () => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return { downloadedBytes: 1, cacheDeltaBytes: 1 };
    });
    const { engine } = harness({ count: 100, fetchTile });

    await engine.schedule(request(100));
    await vi.waitFor(() => expect(engine.getSnapshot().queuedTiles).toBe(64));
    expect(fetchTile).toHaveBeenCalledTimes(6);
    engine.cancel();
    while (gates.length > 0) gates.shift()!();
    await engine.waitForIdle();

    expect(engine.getSnapshot()).toMatchObject({ phase: 'cancelled', queuedTiles: 0 });
  });

  it('uses one manifest lookup and performs no audit or network work for fresh active coverage', async () => {
    const active: OfflineMapGenerationRecord = {
      id: 'active-satellite',
      planId: 'plan-12',
      layerId: 'esri-satellite',
      status: 'active',
      totalTiles: 12,
      completedTiles: 12,
      failedTiles: 0,
      bytesDownloaded: 100,
      refreshAfter: Date.now() + 10_000,
      updatedAt: Date.now(),
    };
    const { engine, claimCached, fetchTile, setGeneration } = harness({
      count: 12,
      activeGeneration: active,
    });

    await engine.schedule(request(12));
    await engine.waitForIdle();

    expect(claimCached).not.toHaveBeenCalled();
    expect(fetchTile).not.toHaveBeenCalled();
    expect(setGeneration).not.toHaveBeenCalled();
    expect(engine.getSnapshot()).toMatchObject({ totalTiles: 12, completedTiles: 12 });
  });

  it('clamps persisted active coverage so one layer cannot mask another above 100%', async () => {
    const active: OfflineMapGenerationRecord = {
      id: 'active-satellite',
      planId: 'plan-12',
      layerId: 'esri-satellite',
      status: 'active',
      totalTiles: 12,
      completedTiles: 15,
      failedTiles: 0,
      bytesDownloaded: 100,
      refreshAfter: Date.now() + 10_000,
      updatedAt: Date.now(),
    };
    const { engine } = harness({ count: 12, activeGeneration: active });

    await engine.preload();

    expect(engine.getSnapshot()).toMatchObject({
      totalTiles: 12,
      completedTiles: 12,
      coverageTotalTiles: 12,
      coverageCompletedTiles: 12,
      layers: [expect.objectContaining({ totalTiles: 12, completedTiles: 12 })],
    });
  });

  it('updates in-memory progress for each tile without waiting for a checkpoint', async () => {
    const gates: Array<() => void> = [];
    const fetchTile = vi.fn(async () => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return { downloadedBytes: 10, cacheDeltaBytes: 10 };
    });
    const { engine, store, setGeneration } = harness({
      count: 2,
      fetchTile,
      now: () => 100,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    await engine.schedule(request(2));
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    const durableWritesBeforeCompletion = setGeneration.mock.calls.length;
    gates.shift()!();
    await vi.waitFor(() => expect(store.getSnapshot().completedTiles).toBe(1));

    expect(setGeneration).toHaveBeenCalledTimes(durableWritesBeforeCompletion);
    expect(store.getSnapshot().completedTiles).toBe(1);
    gates.shift()!();
    await engine.waitForIdle();
    expect(store.getSnapshot().completedTiles).toBe(2);
  });

  it('moves a transient retry behind ready tiles instead of occupying a worker', async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const attempts = new Map<string, number>();
      const fetchTile = vi.fn(async (url: string) => {
        order.push(url);
        const attempt = (attempts.get(url) ?? 0) + 1;
        attempts.set(url, attempt);
        if (url.endsWith('/0/0') && attempt === 1) throw new Error('transport');
        return { downloadedBytes: 10, cacheDeltaBytes: 10 };
      });
      const { engine } = harness({ count: 3, fetchTile });
      await engine.schedule(request(3));
      await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(3));
      expect(order.slice(0, 3)).toEqual([
        'https://tiles/18/0/0',
        'https://tiles/18/1/1',
        'https://tiles/18/2/2',
      ]);

      await vi.advanceTimersByTimeAsync(500);
      await engine.waitForIdle();
      expect(order.at(-1)).toBe('https://tiles/18/0/0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry terminal failures or count them as completed coverage', async () => {
    const terminal = new Error('HTTP 404');
    const fetchTile = vi.fn(async () => { throw terminal; });
    const { engine } = harness({
      count: 1,
      fetchTile,
      isTerminalFetchError: (error) => error === terminal,
    });

    await engine.schedule(request(1));
    await engine.waitForIdle();

    expect(fetchTile).toHaveBeenCalledOnce();
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'completed-with-errors',
      totalTiles: 1,
      completedTiles: 0,
      failedTiles: 1,
    });
  });

  it('rejects late completion after cancellation even when transport ignores abort', async () => {
    let settle!: () => void;
    const fetchTile = vi.fn(async () => {
      await new Promise<void>((resolve) => { settle = resolve; });
      return { downloadedBytes: 10, cacheDeltaBytes: 10 };
    });
    const { engine } = harness({ count: 1, fetchTile });

    await engine.schedule(request(1));
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledOnce());
    engine.cancel();
    settle();
    await engine.waitForIdle();

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'cancelled',
      completedTiles: 0,
    });
  });

  it('serializes a late checkpoint before persisting terminal cancellation', async () => {
    let now = 0;
    let settleFetch!: () => void;
    let releaseCheckpoint!: () => void;
    let checkpointStarted = false;
    const checkpointGate = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
    const fetchTile = vi.fn(async () => {
      await new Promise<void>((resolve) => { settleFetch = resolve; });
      return { downloadedBytes: 10, cacheDeltaBytes: 10 };
    });
    const { engine, setGeneration } = harness({
      count: 1,
      fetchTile,
      now: () => now,
      persistGeneration: async (generation) => {
        if (generation.status === 'pending' && generation.completedTiles === 1) {
          checkpointStarted = true;
          await checkpointGate;
        }
      },
    });

    await engine.schedule(request(1));
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledOnce());
    now = 1_000;
    settleFetch();
    await vi.waitFor(() => expect(checkpointStarted).toBe(true));

    engine.cancel();
    releaseCheckpoint();
    await engine.waitForIdle();

    const finalGeneration = setGeneration.mock.calls.at(-1)?.[0];
    expect(finalGeneration).toMatchObject({ status: 'failed' });
    expect(engine.getSnapshot().phase).toBe('cancelled');
  });

  it('pauses without consuming workers while offline and resumes immediately on reconnect', async () => {
    let online = false;
    const fetchTile = vi.fn(async () => ({ downloadedBytes: 10, cacheDeltaBytes: 10 }));
    const { engine } = harness({
      count: 2,
      fetchTile,
      isOnline: () => online,
    });

    await engine.schedule(request(2));
    await vi.waitFor(() => expect(engine.getSnapshot().phase).toBe('paused'));
    expect(fetchTile).not.toHaveBeenCalled();

    online = true;
    engine.resumeBlocked();
    await engine.waitForIdle();

    expect(fetchTile).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot()).toMatchObject({ phase: 'completed', completedTiles: 2 });
  });

  it('downloads fresh cached tiles when force refresh is requested', async () => {
    const now = Date.now();
    const claimCached = vi.fn(async (urls: readonly string[]) => urls.map((url) => ({
      url,
      sizeBytes: 10,
      lastAccessed: now,
      fetchedAt: now,
      ownerCount: 0,
    })));
    const { engine, fetchTile } = harness({ count: 2, claimCached, now: () => now });

    await engine.schedule({ ...request(2), forceRefresh: true });
    await engine.waitForIdle();

    expect(fetchTile).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'completed',
      cachedFreshTiles: 0,
      downloadedTiles: 2,
    });
  });

  it('releases an interrupted pending generation before restart recovery', async () => {
    const interrupted: OfflineMapGenerationRecord = {
      id: 'interrupted-generation',
      planId: 'plan-1',
      layerId: 'esri-satellite',
      status: 'pending',
      totalTiles: 1,
      completedTiles: 0,
      failedTiles: 0,
      bytesDownloaded: 0,
      refreshAfter: 0,
      updatedAt: 1,
    };
    const { engine, releaseGeneration } = harness({ count: 1, activeGeneration: interrupted });

    await engine.schedule(request(1));
    await engine.waitForIdle();

    expect(releaseGeneration).toHaveBeenCalledWith('interrupted-generation');
    expect(engine.getSnapshot().phase).toBe('completed');
  });

  it('publishes active coverage and reclaims interrupted generations during preload', async () => {
    const interrupted: OfflineMapGenerationRecord = {
      id: 'interrupted-preload',
      planId: 'plan-1',
      layerId: 'esri-satellite',
      status: 'releasing',
      totalTiles: 1,
      completedTiles: 0,
      failedTiles: 0,
      bytesDownloaded: 0,
      refreshAfter: 0,
      updatedAt: 1,
    };
    const { engine, releaseGeneration } = harness({
      count: 1,
      activeGeneration: interrupted,
    });

    await engine.preload();
    await engine.waitForIdle();

    expect(releaseGeneration).toHaveBeenCalledWith('interrupted-preload');
    expect(engine.getSnapshot().phase).toBe('idle');
  });

  it('does not let a superseded session overwrite the replacement progress', async () => {
    let settleFirst!: () => void;
    let calls = 0;
    const fetchTile = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolve) => { settleFirst = resolve; });
      return { downloadedBytes: 10, cacheDeltaBytes: 10 };
    });
    const { engine } = harness({ count: 1, fetchTile });

    await engine.schedule(request(1));
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledOnce());
    await engine.schedule(request(1));
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(2));
    settleFirst();
    await engine.waitForIdle();

    expect(engine.getSnapshot()).toMatchObject({ phase: 'completed', completedTiles: 1 });
  });

  it('finishes 1,000 controlled-latency tiles in six-worker waves', async () => {
    vi.useFakeTimers();
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      const dispatchTimes: number[] = [];
      const startedAt = Date.now();
      const fetchTile = vi.fn(async () => {
        dispatchTimes.push(Date.now());
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        inFlight -= 1;
        return { downloadedBytes: 10, cacheDeltaBytes: 10 };
      });
      const { engine } = harness({ count: 1_000, fetchTile, now: () => Date.now() });

      await engine.schedule(request(1_000));
      await vi.advanceTimersByTimeAsync(16_600);
      expect(engine.getSnapshot().phase).not.toBe('completed');
      await vi.advanceTimersByTimeAsync(100);
      await engine.waitForIdle();

      expect(maxInFlight).toBe(6);
      expect(fetchTile).toHaveBeenCalledTimes(1_000);
      const dispatchGaps = dispatchTimes.slice(1).map((value, index) => (
        value - dispatchTimes[index]
      ));
      expect(Math.max(...dispatchGaps)).toBeLessThanOrEqual(100);
      expect(Date.now() - startedAt).toBeLessThan(100_000 / 4);
      expect(engine.getSnapshot()).toMatchObject({
        phase: 'completed',
        completedTiles: 1_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
