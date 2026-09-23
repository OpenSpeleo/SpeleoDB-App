import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import {
  recordedPointToPointFeature,
  trackPointsToFeatureCollection,
  trackPointsToLineStringFeature,
  gpsTrackGeoJsonToPoints,
  gpsTrackGeoJsonToPointsAsync,
} from './gpsTrackGeoJson';
import { yieldToMainThread } from './yieldToMainThread';

vi.mock('./yieldToMainThread', () => ({ yieldToMainThread: vi.fn(async () => {}) }));
afterEach(() => vi.mocked(yieldToMainThread).mockReset().mockResolvedValue());

function pt(overrides: Partial<RecordedPoint> = {}): RecordedPoint {
  return {
    latitude: 45,
    longitude: -73,
    timestamp: 1000,
    ...overrides,
  };
}

function track(overrides: Partial<LocalGpsTrack> = {}): LocalGpsTrack {
  return {
    id: 'trk-1',
    name: 'Track 1',
    color: '#e41a1c',
    points: [pt(), pt({ latitude: 45.1, longitude: -73.1, timestamp: 2000 })],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('gpsTrackGeoJson', () => {
  it('builds a LineString feature with lon/lat coordinate order', () => {
    const feature = trackPointsToLineStringFeature([
      pt({ latitude: 45, longitude: -73 }),
      pt({ latitude: 46, longitude: -74 }),
    ]);

    expect(feature?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-73, 45],
        [-74, 46],
      ],
    });
    expect(feature?.properties.pointCount).toBe(2);
  });

  it('includes altitude only when finite', () => {
    const feature = trackPointsToLineStringFeature([
      pt({ altitude: 10 }),
      pt({ latitude: 45.1, longitude: -73.1, altitude: null }),
    ]);

    expect(feature?.geometry.coordinates).toEqual([
      [-73, 45, 10],
      [-73.1, 45.1],
    ]);
  });

  it('returns null when fewer than two valid points remain', () => {
    const feature = trackPointsToLineStringFeature([
      pt({ latitude: NaN }),
      pt({ latitude: 45 }),
    ]);

    expect(feature).toBeNull();
  });

  it('builds a Point feature with timestamp and accuracy properties', () => {
    const feature = recordedPointToPointFeature(pt({ accuracy: 4, altitudeAccuracy: 8 }));

    expect(feature?.geometry.coordinates).toEqual([-73, 45]);
    expect(feature?.properties).toEqual({
      timestamp: 1000,
      accuracy: 4,
      altitudeAccuracy: 8,
    });
  });

  it('builds a feature collection for live recording points', () => {
    const live = trackPointsToFeatureCollection(track().points, { name: 'Live' });
    expect(live.features).toHaveLength(1);
    expect(live.features[0].properties.name).toBe('Live');
  });

  it.each([
    null,
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-73, 45], [-74, 46, 7]] } },
    { type: 'FeatureCollection', features: [
      null, 7, {}, { geometry: null }, { geometry: { type: 'LineString', coordinates: null } },
      { geometry: { type: 'LineString', coordinates: [null, [], ['bad', 45], [500, 45], [-73, 45], [-74, 46, Infinity]] } },
      { geometry: { type: 'MultiLineString', coordinates: [null, 'bad', [], [[-75, 47, 8]], [[-76, 48]]] } },
      { geometry: { type: 'MultiLineString', coordinates: {} } },
      { geometry: { type: 'Point', coordinates: [-73, 45] } },
    ] },
  ])('preserves legacy conversion for mixed or malformed cached payloads %#', async payload => {
    expect(await gpsTrackGeoJsonToPointsAsync(payload)).toEqual(gpsTrackGeoJsonToPoints(payload));
  });

  it('yields within a single large line while retaining every valid coordinate', async () => {
    const payload = { features: [{ geometry: {
      type: 'LineString', coordinates: Array.from({ length: 2500 }, (_, index) => [-73 + index / 10000, 45]),
    } }] };
    expect(await gpsTrackGeoJsonToPointsAsync(payload)).toEqual(gpsTrackGeoJsonToPoints(payload));
    expect(yieldToMainThread).toHaveBeenCalledTimes(3);
  });

  it.each(['features', 'segments'])('can cancel traversal of a large payload with only invalid %s', async kind => {
    const controller = new AbortController();
    vi.mocked(yieldToMainThread).mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => { controller.abort(); });
    const entries = Array.from({ length: 2500 }, () => null);
    const payload = kind === 'features' ? { features: entries }
      : { features: [{ geometry: { type: 'MultiLineString', coordinates: entries } }] };
    await expect(gpsTrackGeoJsonToPointsAsync(payload, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(yieldToMainThread).toHaveBeenCalledTimes(2);
  });

  it('rejects already-cancelled conversion without waiting for another task', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(gpsTrackGeoJsonToPointsAsync({ features: [] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(yieldToMainThread).not.toHaveBeenCalled();
  });
});
