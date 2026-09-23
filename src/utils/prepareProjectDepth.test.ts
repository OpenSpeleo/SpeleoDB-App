import { describe, expect, it, vi } from 'vitest';
import { attachDepthToFeatureCollection, computeDepthDomain } from './depthColoring';
import { prepareProjectDepth } from './prepareProjectDepth';

describe('cooperative survey depth preparation', () => {
  it('preserves property precedence and geometry depth, caches both enrichment and domain', async () => {
    const source: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { depth: '12' }, geometry: { type: 'Point', coordinates: [1, 2, 100] } },
      { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [
        { type: 'LineString', coordinates: [[1, 2, 20], [2, 3, 40], [3, 4]] },
      ] } },
      { type: 'Feature', properties: { depth: -30 }, geometry: { type: 'Point', coordinates: [1, 2] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } },
    ] };
    const yieldWork = vi.fn(async () => {});
    const result = await prepareProjectDepth(source, () => false, yieldWork);
    expect(result?.featureCollection).toEqual(attachDepthToFeatureCollection(source));
    expect(result?.depthDomain).toEqual(computeDepthDomain([source]));
    expect(await prepareProjectDepth(source, () => false, yieldWork)).toBe(result);
    expect(yieldWork).not.toHaveBeenCalled();
  });

  it('yields within one giant geometry and cancels before visiting all coordinates', async () => {
    let reads = 0;
    let stale = false;
    const coordinates = Array.from({ length: 100_000 }, () => {
      const position = [1, 2, 3];
      Object.defineProperty(position, '2', { get: () => { reads++; return 3; } });
      return position;
    });
    const source: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } },
    ] };
    const yieldWork = vi.fn(async () => { stale = true; });
    expect(await prepareProjectDepth(source, () => stale, yieldWork)).toBeNull();
    expect(yieldWork).toHaveBeenCalledOnce();
    expect(reads).toBeLessThanOrEqual(1000);
    stale = false;
    const result = await prepareProjectDepth(source, () => stale, async () => {});
    expect(result?.depthDomain).toEqual({ min: 0, max: 3 });
  });

  it('yields for large property-only surveys and for empty nested geometry', async () => {
    const source: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: Array.from({ length: 5000 }, () => ({
      type: 'Feature', properties: { depth: 5 }, geometry: { type: 'Point', coordinates: [1, 2] },
    })) };
    const yieldWork = vi.fn(async () => {});
    expect((await prepareProjectDepth(source, () => false, yieldWork))?.depthDomain).toEqual({ min: 0, max: 5 });
    expect(yieldWork).toHaveBeenCalledTimes(5);
    yieldWork.mockClear();
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: Array.from({ length: 5000 }, () => []) },
    }] };
    expect((await prepareProjectDepth(empty, () => false, yieldWork))?.depthDomain).toBeNull();
    expect(yieldWork).toHaveBeenCalledTimes(5);
  });
});
