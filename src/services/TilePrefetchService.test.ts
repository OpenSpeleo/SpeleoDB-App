import { describe, it, expect, vi } from 'vitest';
import {
  TilePrefetchService,
  buildTileUrlsForFeatureCollection,
  computePaddedBounds,
} from './TilePrefetchService';
import type { TilePrefetchJobState } from '../types/tilePrefetch';
import type { TilePrefetchDependencies } from './TilePrefetchService';

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
});
