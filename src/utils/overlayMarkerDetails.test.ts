import { describe, it, expect } from 'vitest';
import {
  formatCylinderGasMix,
  formatPressureWithUnit,
  normalizeInstallDate,
  parseOverlayMarkerDetails,
} from './overlayMarkerDetails';

describe('overlayMarkerDetails utilities', () => {
  describe('formatCylinderGasMix', () => {
    it('returns o2/he when helium percentage is above zero', () => {
      expect(formatCylinderGasMix(18, 45)).toBe('18/45');
    });

    it('returns Oxygen when o2 equals 100 and he is zero', () => {
      expect(formatCylinderGasMix(100, 0)).toBe('Oxygen');
    });

    it('returns Air when o2 equals 21 and he is zero', () => {
      expect(formatCylinderGasMix(21, 0)).toBe('Air');
    });

    it('returns NXxx when o2 is nitrox and he is zero', () => {
      expect(formatCylinderGasMix(32, 0)).toBe('NX32');
    });

    it('returns N/A when o2/he values are malformed', () => {
      expect(formatCylinderGasMix('not-a-number', 0)).toBe('N/A');
      expect(formatCylinderGasMix(32, undefined)).toBe('N/A');
    });
  });

  describe('formatPressureWithUnit', () => {
    it('formats imperial pressure as PSI', () => {
      expect(formatPressureWithUnit(3000, 'imperial')).toBe('3000 PSI');
    });

    it('formats metric pressure as BAR', () => {
      expect(formatPressureWithUnit(230, 'metric')).toBe('230 BAR');
    });

    it('returns N/A when pressure is missing', () => {
      expect(formatPressureWithUnit(undefined, 'metric')).toBe('N/A');
      expect(formatPressureWithUnit('', 'imperial')).toBe('N/A');
    });
  });

  describe('normalizeInstallDate', () => {
    it('extracts date from ISO datetime string', () => {
      expect(normalizeInstallDate('2026-02-17T13:25:19.000000+00:00')).toBe('2026-02-17');
    });

    it('returns N/A for empty values', () => {
      expect(normalizeInstallDate('')).toBe('N/A');
      expect(normalizeInstallDate(null)).toBe('N/A');
    });
  });

  describe('parseOverlayMarkerDetails', () => {
    it('parses exploration lead details from marker feature', () => {
      expect(parseOverlayMarkerDetails({
        id: 'feature-1',
        layer: { id: 'exploration-leads-icon-layer' },
        properties: {
          id: 'lead-123',
          description: 'lead ne, but might just go to the line',
        },
      })).toEqual({
        type: 'explorationLead',
        id: 'lead-123',
        description: 'lead ne, but might just go to the line',
      });
    });

    it('parses cylinder install details with Django parity formatting', () => {
      expect(parseOverlayMarkerDetails({
        id: 'feature-2',
        layer: { id: 'cylinder-installs-icon-layer' },
        properties: {
          id: 'cylinder-123',
          pressure: 3000,
          pressure_unit_system: 'imperial',
          o2_percentage: 32,
          he_percentage: 0,
          install_date: '2026-02-17',
        },
      })).toEqual({
        type: 'cylinderInstall',
        id: 'cylinder-123',
        pressure: '3000 PSI',
        gasMix: 'NX32',
        installDate: '2026-02-17',
      });
    });

    it('returns fallback values when marker properties are missing', () => {
      expect(parseOverlayMarkerDetails({
        id: 'feature-3',
        layer: { id: 'cylinder-installs-fallback-layer' },
        properties: {},
      })).toEqual({
        type: 'cylinderInstall',
        id: 'feature-3',
        pressure: 'N/A',
        gasMix: 'N/A',
        installDate: 'N/A',
      });
    });

    it('returns null for unknown layer ids', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'landmarks-layer' },
        properties: {},
      })).toBeNull();
    });
  });
});
