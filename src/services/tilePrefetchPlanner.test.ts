import { describe, it, expect } from 'vitest';
import {
  buildTileUrlsForProjectBounds,
  buildTileUrlsForPoints,
  buildTileUrlsForPaths,
  computeTilePrefetchSignature,
  extractPointCoordinates,
} from './tilePrefetchPlanner';
import type { TilePrefetchRequest } from '../types/tilePrefetch';
import { measureProjectGeoJSONBounds } from '../utils/projectGeoJSONBounds';

const TEMPLATE = '{z}/{x}/{y}';

function request(overrides: Partial<TilePrefetchRequest> = {}): TilePrefetchRequest {
  return {
    tileUrlTemplate: TEMPLATE,
    minZoom: 0,
    maxZoom: 0,
    padMeters: 50,
    ...overrides,
  };
}

function pointFeature(lng: number, lat: number): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

function collection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function zoomOf(url: string): number {
  return Number(url.split('/')[0]);
}

describe('extractPointCoordinates', () => {
  it('returns empty for null/empty/undefined', () => {
    expect(extractPointCoordinates(null)).toEqual([]);
    expect(extractPointCoordinates(undefined)).toEqual([]);
    expect(extractPointCoordinates(collection([]))).toEqual([]);
  });

  it('collects only valid Point coordinates', () => {
    const fc = collection([
      pointFeature(10.4, 45.3),
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      { type: 'Feature', properties: {}, geometry: null } as unknown as GeoJSON.Feature,
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1] } } as unknown as GeoJSON.Feature,
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [Number.NaN, 5] } } as unknown as GeoJSON.Feature,
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ['1', 5] } } as unknown as GeoJSON.Feature,
      pointFeature(-73.9, 40.7),
    ]);
    expect(extractPointCoordinates(fc)).toEqual([
      [10.4, 45.3],
      [-73.9, 40.7],
    ]);
  });
});

describe('buildTileUrlsForPoints', () => {
  it('returns the single root tile for one point at zoom 0', () => {
    expect(buildTileUrlsForPoints([[10.4, 45.3]], request())).toEqual(['0/0/0']);
  });

  it('returns empty for no points', () => {
    expect(buildTileUrlsForPoints([], request())).toEqual([]);
  });

  it('skips non-finite coordinates', () => {
    expect(
      buildTileUrlsForPoints(
        [[Number.NaN, 1], [2, Number.POSITIVE_INFINITY]],
        request(),
      ),
    ).toEqual([]);
  });

  it('dedupes identical points', () => {
    const single = buildTileUrlsForPoints([[10.4, 45.3]], request({ maxZoom: 6 }));
    const duplicated = buildTileUrlsForPoints(
      [[10.4, 45.3], [10.4, 45.3]],
      request({ maxZoom: 6 }),
    );
    expect(duplicated).toEqual(single);
  });

  it('dedupes shared low-zoom tiles across far-apart points (all share 0/0/0 at zoom 0)', () => {
    const urls = buildTileUrlsForPoints(
      [[-120.3, 40.2], [119.7, -40.4]],
      request({ minZoom: 0, maxZoom: 0 }),
    );
    expect(urls).toEqual(['0/0/0']);
  });

  it('produces distinct tiles for far-apart points at higher zoom', () => {
    const urls = buildTileUrlsForPoints(
      [[-120.3, 40.2], [119.7, -40.4]],
      request({ minZoom: 5, maxZoom: 5 }),
    );
    expect(new Set(urls).size).toBe(urls.length); // all unique
    expect(urls.length).toBe(2);
  });

  it('covers every zoom in the requested range', () => {
    const urls = buildTileUrlsForPoints([[10.4, 45.3]], request({ minZoom: 0, maxZoom: 4 }));
    const zooms = new Set(urls.map(zoomOf));
    expect([...zooms].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('handles points near the antimeridian without spanning the world', () => {
    const urls = buildTileUrlsForPoints([[179.95, 0.1]], request({ minZoom: 3, maxZoom: 3 }));
    // A tight pad near the dateline must not blow up into the whole row of tiles.
    expect(urls.length).toBeLessThanOrEqual(4);
    expect(urls.every((u) => zoomOf(u) === 3)).toBe(true);
  });

  it('clamps polar points to finite Web-Mercator tile rows', () => {
    expect(
      buildTileUrlsForPoints([[0, 90]], request({ minZoom: 3, maxZoom: 3, padMeters: 0 })),
    ).toEqual(['3/4/0']);
    expect(
      buildTileUrlsForPoints([[0, -90]], request({ minZoom: 3, maxZoom: 3, padMeters: 0 })),
    ).toEqual(['3/4/7']);
  });

  it('skips finite coordinates outside the geographic range', () => {
    expect(
      buildTileUrlsForPoints(
        [[181, 0], [-181, 0], [0, 91], [0, -91]],
        request({ minZoom: 3, maxZoom: 3 }),
      ),
    ).toEqual([]);
  });
});

describe('buildTileUrlsForProjectBounds', () => {
  it('returns tiles for a compact feature collection', () => {
    const fc = collection([pointFeature(2.35, 48.85), pointFeature(2.36, 48.86)]);
    const urls = buildTileUrlsForProjectBounds(
      measureProjectGeoJSONBounds(fc).bounds,
      request({ minZoom: 0, maxZoom: 10 }),
    );
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toBe('0/0/0');
  });

  it('uses already-validated dateline-aware bounds', () => {
    const fc = collection([pointFeature(179.9, 0), pointFeature(-179.9, 0)]);
    const bounds = measureProjectGeoJSONBounds(fc).bounds;
    expect(bounds.crossesDateline).toBe(true);
    const urls = buildTileUrlsForProjectBounds(bounds, request({ minZoom: 3, maxZoom: 3 }));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.length).toBeLessThanOrEqual(4);
  });

  it('dedupes overlapping dateline ranges at the root zoom', () => {
    const urls = buildTileUrlsForProjectBounds(
      {
        west: 179.9,
        east: -179.9,
        south: 0,
        north: 0,
        crossesDateline: true,
      },
      request({ minZoom: 0, maxZoom: 0, padMeters: 0 }),
    );

    expect(urls).toEqual(['0/0/0']);
  });

  it('keeps a zero-width interval local instead of expanding it to the world', () => {
    const urls = buildTileUrlsForProjectBounds(
      {
        west: 12,
        east: 12,
        south: 45,
        north: 45,
        crossesDateline: false,
      },
      request({ minZoom: 8, maxZoom: 8, padMeters: 0 }),
    );

    expect(urls).toHaveLength(1);
  });

  it('applies meter padding on both sides of a tile boundary', () => {
    const bounds = {
      west: 0,
      east: 0,
      south: 0,
      north: 0,
      crossesDateline: false,
    };
    const unpadded = buildTileUrlsForProjectBounds(
      bounds,
      request({ minZoom: 10, maxZoom: 10, padMeters: 0 }),
    );
    const padded = buildTileUrlsForProjectBounds(
      bounds,
      request({ minZoom: 10, maxZoom: 10, padMeters: 50 }),
    );

    expect(unpadded).toEqual(['10/512/512']);
    expect(padded).toEqual(expect.arrayContaining([
      '10/511/511',
      '10/511/512',
      '10/512/511',
      '10/512/512',
    ]));
    expect(new Set(padded).size).toBe(padded.length);
  });

  it('clamps validated high-latitude bounds before tile conversion', () => {
    const urls = buildTileUrlsForProjectBounds(
      {
        west: 20,
        east: 20,
        south: 89,
        north: 90,
        crossesDateline: false,
      },
      request({ minZoom: 4, maxZoom: 4, padMeters: 0 }),
    );

    expect(urls).toEqual(['4/8/0']);
  });
});

describe('computeTilePrefetchSignature', () => {
  it('is stable and order-independent', () => {
    const a = computeTilePrefetchSignature([[1, 2], [3, 4]]);
    const b = computeTilePrefetchSignature([[3, 4], [1, 2]]);
    expect(a).toBe(b);
  });

  it('ignores sub-meter coordinate noise (rounded to 1e-5)', () => {
    const a = computeTilePrefetchSignature([[1.000000, 2.0]]);
    const b = computeTilePrefetchSignature([[1.000001, 2.0]]);
    expect(a).toBe(b);
  });

  it('changes when a point is added or moved', () => {
    const base = computeTilePrefetchSignature([[1, 2]]);
    expect(computeTilePrefetchSignature([[1, 2], [5, 6]])).not.toBe(base);
    expect(computeTilePrefetchSignature([[1.5, 2]])).not.toBe(base);
  });

  it('encodes the point count and is empty-stable', () => {
    expect(computeTilePrefetchSignature([])).toBe(computeTilePrefetchSignature([]));
    expect(computeTilePrefetchSignature([])).toMatch(/^sig-0-/);
    expect(computeTilePrefetchSignature([[1, 2]])).toMatch(/^sig-1-/);
  });
});

describe('buildTileUrlsForPaths', () => {
  it('follows a long diagonal instead of filling its bounding box', () => {
    const options = request({ minZoom: 8, maxZoom: 8, padMeters: 0 });
    const pathUrls = buildTileUrlsForPaths([[[0, 0], [20, 20]]], options);
    const bboxUrls = buildTileUrlsForProjectBounds({
      west: 0,
      east: 20,
      south: 0,
      north: 20,
      crossesDateline: false,
    }, options);

    expect(pathUrls.length).toBeGreaterThan(1);
    expect(pathUrls.length).toBeLessThan(bboxUrls.length / 2);
  });

  it('takes the short wrapped route across the dateline', () => {
    const urls = buildTileUrlsForPaths(
      [[[179.9, 0], [-179.9, 0]]],
      request({ minZoom: 8, maxZoom: 8, padMeters: 0 }),
    );
    const xValues = urls.map((url) => Number(url.split('/')[1]));

    expect(xValues.every((x) => x <= 1 || x >= 254)).toBe(true);
    expect(urls.length).toBeLessThanOrEqual(4);
  });
});
