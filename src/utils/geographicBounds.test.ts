import { describe, expect, it } from 'vitest';
import {
  clampWebMercatorLatitude,
  longitudeIntervalSpanDegrees,
  mergeLongitudeIntervals,
  normalizeLongitude,
  shortestLongitudeInterval,
  WEB_MERCATOR_MAX_LATITUDE,
  webMercatorSpanKm,
} from './geographicBounds';

describe('geographic longitude intervals', () => {
  it('normalizes longitudes with one canonical dateline value', () => {
    expect(normalizeLongitude(-180)).toBe(-180);
    expect(normalizeLongitude(180)).toBe(-180);
    expect(normalizeLongitude(540)).toBe(-180);
    expect(normalizeLongitude(-0)).toBe(0);
  });

  it.each([
    [[12], { west: 12, east: 12, crossesDateline: false }],
    [[-120.3], { west: -120.30000000000001, east: -120.30000000000001, crossesDateline: false }],
    [[12, 12, 12], { west: 12, east: 12, crossesDateline: false }],
    [[-4, 8, 2], { west: -4, east: 8, crossesDateline: false }],
    [[179, -179], { west: 179, east: -179, crossesDateline: true }],
    [[-180, 180], { west: -180, east: -180, crossesDateline: false }],
    [[170, 180], { west: 170, east: 180, crossesDateline: false }],
    [[0, 180], { west: -180, east: 0, crossesDateline: false }],
    [[90, -90], { west: -90, east: 90, crossesDateline: false }],
  ])('finds a deterministic shortest interval for %j', (values, expected) => {
    expect(shortestLongitudeInterval(values as number[])).toEqual(expected);
  });

  it('merges the full directed arcs rather than only their endpoints', () => {
    const merged = mergeLongitudeIntervals([
      { west: 170, east: -170, crossesDateline: true },
      { west: -175, east: -160, crossesDateline: false },
    ]);
    expect(merged).toEqual({ west: 170, east: -160, crossesDateline: true });
    expect(longitudeIntervalSpanDegrees(merged!)).toBe(30);
  });

  it('returns a stable full-world sentinel when directed coverage is complete', () => {
    const merged = mergeLongitudeIntervals([
      { west: -180, east: 0, crossesDateline: false },
      { west: 0, east: 180, crossesDateline: false },
    ]);
    expect(merged).toEqual({ west: -180, east: 180, crossesDateline: false });
    expect(longitudeIntervalSpanDegrees(merged!)).toBe(360);
  });

  it('handles no intervals explicitly and rejects invalid point inputs', () => {
    expect(mergeLongitudeIntervals([])).toBeNull();
    expect(() => shortestLongitudeInterval([])).toThrow(RangeError);
    expect(() => shortestLongitudeInterval([181])).toThrow(RangeError);
    expect(() => shortestLongitudeInterval([Number.NaN])).toThrow(RangeError);
  });
});

describe('Web-Mercator bounds', () => {
  it('clamps latitude at both finite projection limits', () => {
    expect(clampWebMercatorLatitude(90)).toBe(WEB_MERCATOR_MAX_LATITUDE);
    expect(clampWebMercatorLatitude(-90)).toBe(-WEB_MERCATOR_MAX_LATITUDE);
    expect(clampWebMercatorLatitude(20)).toBe(20);
  });

  it('measures a directed antimeridian arc rather than its complement', () => {
    const span = webMercatorSpanKm({
      west: 179.75,
      east: -179.75,
      crossesDateline: true,
      south: 0,
      north: 0,
    });
    expect(span.xKm).toBeCloseTo(55.659745, 5);
    expect(span.yKm).toBe(0);
  });

  it('exposes polar projection amplification after latitude clamping', () => {
    const equatorial = webMercatorSpanKm({
      west: 0,
      east: 0,
      crossesDateline: false,
      south: 0,
      north: 0.5,
    });
    const polar = webMercatorSpanKm({
      west: 0,
      east: 0,
      crossesDateline: false,
      south: 84,
      north: 84.5,
    });
    expect(equatorial.yKm).toBeLessThan(56);
    expect(polar.yKm).toBeGreaterThan(500);
  });
});
