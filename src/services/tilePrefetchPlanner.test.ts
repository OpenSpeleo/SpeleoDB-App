import { describe, it, expect } from 'vitest';
import {
  buildTileUrlsForFeatureCollection,
  buildTileUrlsForPoints,
  computePaddedBounds,
  computeTilePrefetchSignature,
  extractPointCoordinates,
} from './tilePrefetchPlanner';
import type { TilePrefetchRequest } from '../types/tilePrefetch';

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
});

describe('buildTileUrlsForFeatureCollection (parity preserved after extraction)', () => {
  it('returns tiles for a compact feature collection', () => {
    const fc = collection([pointFeature(2.35, 48.85), pointFeature(2.36, 48.86)]);
    const urls = buildTileUrlsForFeatureCollection(fc, request({ minZoom: 0, maxZoom: 10 }));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toBe('0/0/0');
  });

  it('returns empty when the collection has no usable geometry', () => {
    expect(buildTileUrlsForFeatureCollection(collection([]), request())).toEqual([]);
  });

  it('computePaddedBounds remains exported and dateline-aware', () => {
    const fc = collection([pointFeature(179.9, 0), pointFeature(-179.9, 0)]);
    const bounds = computePaddedBounds(fc, 50);
    expect(bounds?.crossesDateline).toBe(true);
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
