import { describe, expect, it } from 'vitest';
import type { LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import {
  recordedPointToPointFeature,
  trackPointsToFeatureCollection,
  trackPointsToLineStringFeature,
} from './gpsTrackGeoJson';

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
});
