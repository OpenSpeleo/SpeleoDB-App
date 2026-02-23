import { describe, it, expect } from 'vitest';
import {
  FEET_TO_METERS,
  convertFeetToMeters,
  formatDepthValue,
  formatDistanceValue,
} from './measurementUnits';

describe('measurementUnits', () => {
  it('converts feet to meters', () => {
    expect(convertFeetToMeters(10)).toBeCloseTo(10 * FEET_TO_METERS, 6);
  });

  describe('formatDepthValue', () => {
    it('formats depth in feet', () => {
      expect(formatDepthValue(-20, 'feet')).toBe('-20 ft');
      expect(formatDepthValue(-20.34, 'feet')).toBe('-20.3 ft');
    });

    it('formats depth in meters when selected', () => {
      expect(formatDepthValue(-20, 'meters')).toBe('-6.1 m');
    });

    it('returns N/A for null, NaN, and Infinity', () => {
      expect(formatDepthValue(null, 'feet')).toBe('N/A');
      expect(formatDepthValue(NaN, 'feet')).toBe('N/A');
      expect(formatDepthValue(Infinity, 'meters')).toBe('N/A');
      expect(formatDepthValue(-Infinity, 'feet')).toBe('N/A');
    });

    it('formats zero depth', () => {
      expect(formatDepthValue(0, 'feet')).toBe('0 ft');
      expect(formatDepthValue(0, 'meters')).toBe('0 m');
    });
  });

  describe('formatDistanceValue', () => {
    it('formats distance in feet below threshold', () => {
      expect(formatDistanceValue(250, 'feet')).toBe('250 ft');
      expect(formatDistanceValue(5279, 'feet')).toBe('5279 ft');
    });

    it('switches to miles at 5280 feet', () => {
      expect(formatDistanceValue(5280, 'feet')).toBe('1.0 mi');
      expect(formatDistanceValue(52800, 'feet')).toBe('10 mi');
    });

    it('formats distance in meters below threshold', () => {
      const feetFor999m = 999 / FEET_TO_METERS;
      expect(formatDistanceValue(feetFor999m, 'meters')).toBe('999 m');
    });

    it('switches to km at 1000 meters', () => {
      const feetFor1000m = 1000 / FEET_TO_METERS;
      expect(formatDistanceValue(feetFor1000m, 'meters')).toBe('1.0 km');
      const feetFor15000m = 15000 / FEET_TO_METERS;
      expect(formatDistanceValue(feetFor15000m, 'meters')).toBe('15 km');
    });

    it('returns N/A for non-finite input', () => {
      expect(formatDistanceValue(NaN, 'feet')).toBe('N/A');
      expect(formatDistanceValue(Infinity, 'meters')).toBe('N/A');
    });

    it('formats zero distance', () => {
      expect(formatDistanceValue(0, 'feet')).toBe('0 ft');
      expect(formatDistanceValue(0, 'meters')).toBe('0 m');
    });
  });
});
