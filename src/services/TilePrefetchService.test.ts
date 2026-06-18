import { describe, it, expect, vi } from 'vitest';
import {
  TilePrefetchService,
  buildTileUrlsForFeatureCollection,
  computePaddedBounds,
} from './TilePrefetchService';
import type { TilePrefetchJobState } from '../types/tilePrefetch';
import type { TilePrefetchDependencies } from './TilePrefetchService';
import { MAP_LAYERS } from '../constants';

const HILLSHADE_TEMPLATE = MAP_LAYERS.find(
  (l) => l.id === 'esri-world-hillshade',
)!.tileUrlTemplate;

function pointFeatureCollection(lng: number, lat: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
      },
    ],
  };
}

function twoPointFeatureCollection(lng: number, lat: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
      },
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [lng + 0.001, lat + 0.001],
        },
      },
    ],
  };
}

async function waitForCondition(
  condition: () => boolean,
  attempts = 50,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error('Condition not met in time');
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TilePrefetchService geometry helpers', () => {
  it('computes a dateline-safe interval for features crossing +/-180', () => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [179.9, 0] },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [-179.9, 0] },
        },
      ],
    };

    const bounds = computePaddedBounds(fc, 50);
    expect(bounds).not.toBeNull();
    expect(bounds?.crossesDateline).toBe(true);
  });

  it('builds tile urls for the requested zoom range', () => {
    const fc = pointFeatureCollection(2.3, 46.6);
    const urls = buildTileUrlsForFeatureCollection(fc, {
      tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
      minZoom: 0,
      maxZoom: 2,
      padMeters: 50,
    });

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((url) => url.includes('/0/'))).toBe(true);
    expect(urls.some((url) => url.includes('/2/'))).toBe(true);
  });
});

describe('TilePrefetchService queue behavior', () => {
  function createDeps(overrides: Partial<TilePrefetchDependencies> = {}) {
    const jobs = new Map<string, TilePrefetchJobState>();
    const hasCachedTile = vi.fn(async () => false);
    const fetchAndCacheTile = vi.fn(async () => 2048);
    const deps = {
      hasCachedTile,
      fetchAndCacheTile,
      getAllPrefetchJobs: vi.fn(async () => []),
      setPrefetchJob: vi.fn(async (job: TilePrefetchJobState) => {
        jobs.set(job.projectId, { ...job });
      }),
      isOnline: vi.fn(() => true),
      now: vi.fn(() => Date.now()),
      sleep: vi.fn(async () => {}),
      ...overrides,
    };
    return {
      deps,
      jobs,
      hasCachedTile: deps.hasCachedTile as ReturnType<typeof vi.fn>,
      fetchAndCacheTile: deps.fetchAndCacheTile as ReturnType<typeof vi.fn>,
    };
  }

  it('dedupes shared tiles across projects and retries transient failures', async () => {
    let attempts = 0;
    const { deps, fetchAndCacheTile } = createDeps({
      fetchAndCacheTile: vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('temporary');
        return 1024;
      }),
    });
    const service = new TilePrefetchService(deps);
    const geojson = pointFeatureCollection(2.3, 46.6);

    await service.enqueueProjects(
      [
        { projectId: 'p1', commitId: 'c1', geojson },
        { projectId: 'p2', commitId: 'c1', geojson },
      ],
      {
        tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
        minZoom: 0,
        maxZoom: 0,
        padMeters: 50,
      },
    );
    await service.waitForIdle();

    const snapshot = service.getSnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.every((job) => job.status === 'done')).toBe(true);
    expect(snapshot.every((job) => job.completedTiles === 1)).toBe(true);
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(3);
    service.dispose();
  });

  it('is idempotent for an already-complete project commit', async () => {
    const { deps, fetchAndCacheTile } = createDeps();
    const service = new TilePrefetchService(deps);
    const geojson = pointFeatureCollection(2.3, 46.6);
    const request = {
      tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
      minZoom: 0,
      maxZoom: 0,
      padMeters: 50,
    };

    await service.enqueueProjects([{ projectId: 'p1', commitId: 'c1', geojson }], request);
    await service.waitForIdle();
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(1);

    await service.enqueueProjects([{ projectId: 'p1', commitId: 'c1', geojson }], request);
    await service.waitForIdle();
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('enqueueTileUrls creates a job and downloads the provided tiles', async () => {
    const { deps, fetchAndCacheTile } = createDeps();
    const service = new TilePrefetchService(deps);

    await service.enqueueTileUrls({
      id: 'landmarks',
      commitId: 'sig-1',
      tileUrls: [
        'https://tiles.example.com/0/0/0.png',
        'https://tiles.example.com/1/1/1.png',
      ],
      zoomMin: 0,
      zoomMax: 18,
      padMeters: 50,
    });
    await service.waitForIdle();

    const job = service.getSnapshot().find((j) => j.projectId === 'landmarks');
    expect(job?.status).toBe('done');
    expect(job?.totalTiles).toBe(2);
    expect(job?.completedTiles).toBe(2);
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it('enqueueTileUrls dedupes duplicate URLs within the target', async () => {
    const { deps, fetchAndCacheTile } = createDeps();
    const service = new TilePrefetchService(deps);

    await service.enqueueTileUrls({
      id: 'landmarks',
      commitId: 'sig-dup',
      tileUrls: [
        'https://tiles.example.com/0/0/0.png',
        'https://tiles.example.com/0/0/0.png',
      ],
      zoomMin: 0,
      zoomMax: 0,
      padMeters: 50,
    });
    await service.waitForIdle();

    const job = service.getSnapshot().find((j) => j.projectId === 'landmarks');
    expect(job?.totalTiles).toBe(1);
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('downloads a tile once when shared between a project job and the landmarks job', async () => {
    const cached = new Set<string>();
    const { deps, fetchAndCacheTile } = createDeps({
      hasCachedTile: vi.fn(async (url: string) => cached.has(url)),
      fetchAndCacheTile: vi.fn(async (url: string) => {
        cached.add(url);
        return 2048;
      }),
    });
    const service = new TilePrefetchService(deps);
    const sharedUrl = 'https://tiles.example.com/0/0/0.png';

    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c1', geojson: pointFeatureCollection(2.3, 46.6) }],
      {
        tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
        minZoom: 0,
        maxZoom: 0,
        padMeters: 50,
      },
    );
    await service.waitForIdle();
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(1);

    await service.enqueueTileUrls({
      id: 'landmarks',
      commitId: 'sig-1',
      tileUrls: [sharedUrl, 'https://tiles.example.com/0/0/1.png'],
      zoomMin: 0,
      zoomMax: 0,
      padMeters: 50,
    });
    await service.waitForIdle();

    // Only the one non-shared landmark tile is downloaded; the shared tile was
    // already cached by the project job.
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(2);
    const landmarks = service.getSnapshot().find((j) => j.projectId === 'landmarks');
    expect(landmarks?.status).toBe('done');
    expect(landmarks?.totalTiles).toBe(2);
    expect(landmarks?.completedTiles).toBe(2);
    service.dispose();
  });

  it('enqueueTileUrls is idempotent for an already-complete (id, commitId)', async () => {
    const { deps, fetchAndCacheTile } = createDeps();
    const service = new TilePrefetchService(deps);
    const target = {
      id: 'landmarks',
      commitId: 'sig-1',
      tileUrls: ['https://tiles.example.com/0/0/0.png'],
      zoomMin: 0,
      zoomMax: 0,
      padMeters: 50,
    };

    await service.enqueueTileUrls(target);
    await service.waitForIdle();
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(1);

    await service.enqueueTileUrls(target);
    await service.waitForIdle();
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('clears in-memory jobs on dispose', async () => {
    const { deps } = createDeps();
    const service = new TilePrefetchService(deps);

    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c1', geojson: pointFeatureCollection(2.3, 46.6) }],
      {
        tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
        minZoom: 0,
        maxZoom: 0,
        padMeters: 50,
      },
    );
    await service.waitForIdle();
    expect(service.getSnapshot().length).toBe(1);

    service.dispose();
    expect(service.getSnapshot().length).toBe(0);
  });

  it('throws AbortError when enqueueing is cancelled before work begins', async () => {
    const { deps, fetchAndCacheTile } = createDeps();
    const service = new TilePrefetchService(deps);
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.enqueueProjects(
        [{ projectId: 'p1', commitId: 'c1', geojson: pointFeatureCollection(2.3, 46.6) }],
        {
          tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
          minZoom: 0,
          maxZoom: 0,
          padMeters: 50,
        },
        { signal: abortController.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.getSnapshot()).toEqual([]);
    expect(fetchAndCacheTile).not.toHaveBeenCalled();
    service.dispose();
  });

  it('ignores stale queued tiles when a project is re-enqueued with a new commit', async () => {
    const firstDownload = createDeferred<number>();
    let fetchCalls = 0;
    const { deps, fetchAndCacheTile } = createDeps({
      fetchAndCacheTile: vi.fn(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) return firstDownload.promise;
        return 2000;
      }),
    });
    const service = new TilePrefetchService(deps);
    const firstGeojson = twoPointFeatureCollection(2.3, 46.6);
    const secondGeojson = twoPointFeatureCollection(-120, -35);
    const request = {
      tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
      minZoom: 3,
      maxZoom: 3,
      padMeters: 0,
    };
    const firstUrls = buildTileUrlsForFeatureCollection(firstGeojson, request);
    const secondUrls = buildTileUrlsForFeatureCollection(secondGeojson, request);
    expect(firstUrls.length).toBeGreaterThan(0);
    expect(secondUrls.length).toBeGreaterThan(0);
    const secondUrlSet = new Set(secondUrls);
    const overlapCount = firstUrls.filter((url) => secondUrlSet.has(url)).length;
    expect(overlapCount).toBe(0);

    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c1', geojson: firstGeojson }],
      request,
    );
    await waitForCondition(() => fetchAndCacheTile.mock.calls.length === 1);

    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c2', geojson: secondGeojson }],
      request,
    );

    firstDownload.resolve(1000);
    await service.waitForIdle();

    const [job] = service.getSnapshot();
    expect(fetchAndCacheTile.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(job.commitId).toBe('c2');
    expect(job.totalTiles).toBe(secondUrls.length);
    expect(job.completedTiles).toBe(secondUrls.length);
    expect(job.bytesDownloaded).toBe(secondUrls.length * 2000);
    expect(job.status).toBe('done');
    service.dispose();
  });

  it('marks failures when strict cache writes fail', async () => {
    const { deps, fetchAndCacheTile } = createDeps({
      fetchAndCacheTile: vi.fn(async () => {
        throw new Error('Tile cache is full');
      }),
    });
    const service = new TilePrefetchService(deps);

    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c1', geojson: pointFeatureCollection(2.3, 46.6) }],
      {
        tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
        minZoom: 0,
        maxZoom: 0,
        padMeters: 50,
      },
    );
    await service.waitForIdle();

    const [job] = service.getSnapshot();
    expect(job.status).toBe('error');
    expect(job.message).toContain('Tile cache is full');
    expect(fetchAndCacheTile).toHaveBeenCalled();
    service.dispose();
  });

  it('does not start tile downloads while dependency reports offline', async () => {
    const { deps, fetchAndCacheTile } = createDeps({
      isOnline: vi.fn(() => false),
    });
    const service = new TilePrefetchService(deps);

    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c1', geojson: pointFeatureCollection(2.3, 46.6) }],
      {
        tileUrlTemplate: 'https://tiles.example.com/{z}/{y}/{x}.png',
        minZoom: 0,
        maxZoom: 0,
        padMeters: 50,
      },
    );
    await service.waitForIdle();

    expect(fetchAndCacheTile).not.toHaveBeenCalled();
    service.dispose();
  });

  it('flags blockedByStorage and halts the queue on a capacity error (no hammering)', async () => {
    const capacityError = Object.assign(new Error('Tile cache is full'), {
      name: 'TileCacheCapacityError',
    });
    const { deps, fetchAndCacheTile } = createDeps({
      fetchAndCacheTile: vi.fn(async () => {
        throw capacityError;
      }),
    });
    const service = new TilePrefetchService(deps);

    await service.enqueueTileUrls({
      id: 'landmarks',
      commitId: 'sig-1',
      tileUrls: [
        'https://tiles.example.com/0/0/0.png',
        'https://tiles.example.com/1/1/1.png',
        'https://tiles.example.com/2/2/2.png',
      ],
      zoomMin: 0,
      zoomMax: 18,
      padMeters: 50,
    });
    await service.waitForIdle();

    const job = service.getSnapshot().find((j) => j.projectId === 'landmarks');
    expect(job?.blockedByStorage).toBe(true);
    expect(job?.status).toBe('paused');
    // Capacity errors are not retried and the queue halts after the first hit,
    // so only one write is attempted (the other two tiles are not hammered).
    expect(fetchAndCacheTile).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('resumes blocked jobs and completes once overflow is approved', async () => {
    let capped = true;
    const capacityError = Object.assign(new Error('Tile cache is full'), {
      name: 'TileCacheCapacityError',
    });
    const { deps } = createDeps({
      fetchAndCacheTile: vi.fn(async () => {
        if (capped) throw capacityError;
        return 1024;
      }),
    });
    const service = new TilePrefetchService(deps);

    await service.enqueueTileUrls({
      id: 'landmarks',
      commitId: 'sig-1',
      tileUrls: [
        'https://tiles.example.com/0/0/0.png',
        'https://tiles.example.com/0/0/1.png',
      ],
      zoomMin: 0,
      zoomMax: 0,
      padMeters: 50,
    });
    await service.waitForIdle();

    let job = service.getSnapshot().find((j) => j.projectId === 'landmarks');
    expect(job?.blockedByStorage).toBe(true);
    expect(job?.completedTiles).toBe(0);

    // Approve overflow: the cap no longer blocks writes; resume the queue.
    capped = false;
    service.resumeBlockedJobs();
    await service.waitForIdle();

    job = service.getSnapshot().find((j) => j.projectId === 'landmarks');
    expect(job?.blockedByStorage).toBe(false);
    expect(job?.status).toBe('done');
    expect(job?.completedTiles).toBe(2);
    service.dispose();
  });

  it('namespaces jobs per layer for the same target id', async () => {
    const { deps } = createDeps();
    const service = new TilePrefetchService(deps);
    const geojson = pointFeatureCollection(2.3, 46.6);
    const baseRequest = {
      tileUrlTemplate: 'https://sat.example.com/{z}/{y}/{x}.png',
      minZoom: 0,
      maxZoom: 0,
      padMeters: 50,
    };

    await service.enqueueProjects([{ projectId: 'p1', commitId: 'c1', geojson }], baseRequest, {
      layerId: 'esri-satellite',
    });
    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c1', geojson }],
      { ...baseRequest, tileUrlTemplate: 'https://hill.example.com/{z}/{y}/{x}.png' },
      { layerId: 'esri-world-hillshade' },
    );
    await service.waitForIdle();

    const snapshot = service.getSnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((j) => j.layerId).sort()).toEqual([
      'esri-satellite',
      'esri-world-hillshade',
    ]);
    expect(snapshot.every((j) => j.projectId === 'p1')).toBe(true);
    service.dispose();
  });

  it('removeLayer drops a layer\'s jobs and persists the deletion', async () => {
    const deletePrefetchJobsByLayer = vi.fn(async () => {});
    const { deps } = createDeps({ deletePrefetchJobsByLayer });
    const service = new TilePrefetchService(deps);
    const geojson = pointFeatureCollection(2.3, 46.6);
    const request = {
      tileUrlTemplate: 'https://sat.example.com/{z}/{y}/{x}.png',
      minZoom: 0,
      maxZoom: 0,
      padMeters: 50,
    };

    await service.enqueueProjects([{ projectId: 'p1', commitId: 'c1', geojson }], request, {
      layerId: 'esri-satellite',
    });
    await service.enqueueProjects(
      [{ projectId: 'p1', commitId: 'c1', geojson }],
      { ...request, tileUrlTemplate: 'https://hill.example.com/{z}/{y}/{x}.png' },
      { layerId: 'esri-world-hillshade' },
    );
    await service.waitForIdle();
    expect(service.getSnapshot()).toHaveLength(2);

    await service.removeLayer('esri-world-hillshade');

    expect(deletePrefetchJobsByLayer).toHaveBeenCalledWith('esri-world-hillshade');
    const snapshot = service.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].layerId).toBe('esri-satellite');
    service.dispose();
  });

  it('removeLayer clears cache-presence so a re-enable re-downloads the tiles', async () => {
    // Regression: disabling a layer evicts its tiles from IndexedDB, but the
    // in-memory cache-presence map must also be pruned. Otherwise a same-session
    // re-enable treats every tile as cached -> job auto-"done" with zero
    // downloads -> blank offline map while progress shows 100%.
    const { deps, fetchAndCacheTile } = createDeps();
    const service = new TilePrefetchService(deps);
    const geojson = pointFeatureCollection(2.3, 46.6);
    // Use the real hillshade template so removeLayer's prefix prune matches.
    const request = {
      tileUrlTemplate: HILLSHADE_TEMPLATE,
      minZoom: 0,
      maxZoom: 0,
      padMeters: 50,
    };

    await service.enqueueProjects([{ projectId: 'p1', commitId: 'c1', geojson }], request, {
      layerId: 'esri-world-hillshade',
    });
    await service.waitForIdle();
    const firstDownloadCount = fetchAndCacheTile.mock.calls.length;
    expect(firstDownloadCount).toBeGreaterThan(0);

    await service.removeLayer('esri-world-hillshade');

    // Re-enable the same target/commit. Because cache-presence was pruned, the
    // tiles must be queued and downloaded again (not short-circuited as done).
    await service.enqueueProjects([{ projectId: 'p1', commitId: 'c1', geojson }], request, {
      layerId: 'esri-world-hillshade',
    });
    await service.waitForIdle();

    expect(fetchAndCacheTile.mock.calls.length).toBe(firstDownloadCount * 2);
    const job = service.getSnapshot().find((j) => j.layerId === 'esri-world-hillshade');
    expect(job?.status).toBe('done');
    expect(job?.completedTiles).toBe(job?.totalTiles);
    service.dispose();
  });
});
