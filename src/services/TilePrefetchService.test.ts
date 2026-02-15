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
