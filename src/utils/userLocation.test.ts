import { describe, expect, it } from 'vitest';
import type { RecordedPoint } from '../types/gpsTrack';
import {
  latestValidRecordingLocation,
  normalizeHeading,
  selectUserMapLocation,
  toUserMapLocation,
  unwrapHeading,
} from './userLocation';

describe('user location helpers', () => {
  it('validates map coordinates and finds the latest valid recording point', () => {
    expect(toUserMapLocation(-73, 45)).toEqual({ lng: -73, lat: 45 });
    expect(toUserMapLocation(200, 45)).toBeNull();
    const points: RecordedPoint[] = [
      { longitude: -73, latitude: 45, timestamp: 1 },
      { longitude: 200, latitude: 45, timestamp: 2 },
    ];
    expect(latestValidRecordingLocation(points)).toEqual({ lng: -73, lat: 45 });
    expect(latestValidRecordingLocation([points[1]])).toBeNull();
  });

  it('prefers an enabled live location over the recording fallback', () => {
    const live = { lng: 1, lat: 2 };
    const recording = { lng: 3, lat: 4 };
    expect(selectUserMapLocation(live, recording)).toBe(live);
    expect(selectUserMapLocation(null, recording)).toBe(recording);
    expect(selectUserMapLocation(null, null)).toBeNull();
  });

  it('normalizes headings and unwraps the north crossing along the short path', () => {
    expect(normalizeHeading(361)).toBe(1);
    expect(normalizeHeading(-1)).toBe(359);
    expect(normalizeHeading(Number.NaN)).toBeNull();
    expect(unwrapHeading(null, 359)).toBe(359);
    expect(unwrapHeading(359, 1)).toBe(361);
    expect(unwrapHeading(1, 359)).toBe(-1);
  });
});
