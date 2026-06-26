import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  trackDistanceMeters,
  trackDurationMs,
  summarizeTrack,
  formatDuration,
} from './gpsTrackStats';
import type { RecordedPoint } from '../types/gpsTrack';

function pt(latitude: number, longitude: number, timestamp = 0): RecordedPoint {
  return { latitude, longitude, timestamp };
}

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(45, -73, 45, -73)).toBe(0);
  });

  it('approximates one degree of latitude (~111 km)', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(haversineMeters(NaN, 0, 1, 0)).toBe(0);
  });
});

describe('trackDistanceMeters', () => {
  it('is 0 for empty or single-point tracks', () => {
    expect(trackDistanceMeters([])).toBe(0);
    expect(trackDistanceMeters([pt(0, 0)])).toBe(0);
  });

  it('sums segment lengths', () => {
    const total = trackDistanceMeters([pt(0, 0), pt(0, 1), pt(0, 2)]);
    const oneLeg = haversineMeters(0, 0, 0, 1);
    expect(total).toBeCloseTo(oneLeg * 2, 3);
  });

  it('skips invalid coordinates instead of zeroing/poisoning the total', () => {
    const oneLeg = haversineMeters(0, 0, 0, 1);
    // A NaN fix and an out-of-WGS84-range fix between two valid points must be
    // dropped, and distance measured across the remaining valid points.
    const total = trackDistanceMeters([
      pt(0, 0),
      pt(Number.NaN, 1),
      pt(91, 200),
      pt(0, 1),
    ]);
    expect(total).toBeCloseTo(oneLeg, 3);
    expect(Number.isFinite(total)).toBe(true);
  });

  it('is 0 when fewer than two coordinates are valid', () => {
    expect(trackDistanceMeters([pt(0, 0), pt(Number.NaN, Number.NaN)])).toBe(0);
  });
});

describe('trackDurationMs', () => {
  it('is 0 for fewer than two points', () => {
    expect(trackDurationMs([pt(0, 0, 5)])).toBe(0);
  });

  it('returns last minus first timestamp', () => {
    expect(trackDurationMs([pt(0, 0, 1000), pt(0, 1, 4000)])).toBe(3000);
  });

  it('uses min/max timestamps so out-of-order fixes still have a duration', () => {
    expect(trackDurationMs([pt(0, 0, 4000), pt(0, 1, 1000)])).toBe(3000);
  });
});

describe('summarizeTrack', () => {
  it('reports count, distance and duration', () => {
    const s = summarizeTrack([pt(0, 0, 0), pt(0, 1, 2000)]);
    expect(s.pointCount).toBe(2);
    expect(s.durationMs).toBe(2000);
    expect(s.distanceMeters).toBeGreaterThan(0);
  });
});

describe('formatDuration', () => {
  it('formats minutes:seconds under an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
  });

  it('formats hours:minutes:seconds over an hour', () => {
    expect(formatDuration(3_661_000)).toBe('1:01:01');
  });

  it('guards invalid input', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});
