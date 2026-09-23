import { describe, expect, it, vi } from 'vitest';
import { prepareGpsTrack } from './prepareGpsTrack';
import { gpsTrackGeoJsonToPointsAsync } from './gpsTrackGeoJson';

describe('GPS viewer geometry preparation', () => {
  it('yields between bounded batches and produces reusable geometry and bounds', async () => {
    const yieldWork = vi.fn(async () => {});
    const points = Array.from({ length: 2501 }, (_, index) => ({
      longitude: -73 + index / 100_000, latitude: 45, altitude: 10, timestamp: index,
    }));
    const prepared = await prepareGpsTrack(points, 'sha-one', () => true, yieldWork);
    expect(yieldWork).toHaveBeenCalledTimes(3);
    expect(prepared?.revision).toBe('sha-one');
    expect(prepared?.feature?.geometry.coordinates).toHaveLength(2501);
    expect(prepared?.feature?.geometry.coordinates[0]).toEqual([-73, 45, 10]);
    expect(prepared?.bounds?.[0][0]).toBeLessThan(-73);
    expect(prepared?.bounds?.[1][0]).toBeGreaterThan(-72.975);
  });

  it('abandons obsolete work at the next batch and rejects invalid coordinates', async () => {
    let current = true;
    const yieldWork = vi.fn(async () => { current = false; });
    const points = [{ longitude: 0, latitude: 0, timestamp: 1 }];
    expect(await prepareGpsTrack(points, 'old', () => current, yieldWork)).toBeUndefined();
    const empty = await prepareGpsTrack([{ ...points[0], latitude: 100 }], 'invalid', () => true);
    expect(empty).toMatchObject({ feature: null, bounds: null });
  });

  it('converts downloaded multiline geometry cooperatively and observes cancellation', async () => {
    const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [
        [[-73, 45, 10], [-73.1, 45.1]], [[-72, 44]],
      ] },
    }] };
    expect(await gpsTrackGeoJsonToPointsAsync(collection)).toEqual([
      { longitude: -73, latitude: 45, altitude: 10, timestamp: 0 },
      { longitude: -73.1, latitude: 45.1, altitude: null, timestamp: 0 },
      { longitude: -72, latitude: 44, altitude: null, timestamp: 0 },
    ]);
    const abort = new AbortController();
    abort.abort();
    await expect(gpsTrackGeoJsonToPointsAsync(collection, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
