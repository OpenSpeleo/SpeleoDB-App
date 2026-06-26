import { describe, expect, it } from 'vitest';
import { isValidLatLng } from './coordinates';

describe('isValidLatLng', () => {
  it('accepts finite coordinates within WGS-84 bounds', () => {
    expect(isValidLatLng(0, 0)).toBe(true);
    expect(isValidLatLng(45.123, -73.456)).toBe(true);
    expect(isValidLatLng(-90, -180)).toBe(true);
    expect(isValidLatLng(90, 180)).toBe(true);
  });

  it('rejects non-finite coordinates', () => {
    expect(isValidLatLng(Number.NaN, 0)).toBe(false);
    expect(isValidLatLng(0, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });
});
