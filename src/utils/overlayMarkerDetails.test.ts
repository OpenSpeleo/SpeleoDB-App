import { describe, it, expect } from 'vitest';
import {
  formatCylinderGasMix,
  formatGpsCoordinate,
  formatLatLng,
  formatPressureWithUnit,
  isProjectPointLayerId,
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

  describe('formatGpsCoordinate', () => {
    it('formats Point geometry as lat, lng', () => {
      expect(formatGpsCoordinate({ type: 'Point', coordinates: [2.3, 46.6] })).toBe('46.6, 2.3');
    });

    it('returns N/A for null geometry', () => {
      expect(formatGpsCoordinate(null)).toBe('N/A');
    });

    it('returns N/A for undefined geometry', () => {
      expect(formatGpsCoordinate(undefined)).toBe('N/A');
    });

    it('returns N/A for non-Point geometry type', () => {
      expect(formatGpsCoordinate({ type: 'LineString', coordinates: [2.3, 46.6] })).toBe('N/A');
    });

    it('returns N/A when coordinates array is too short', () => {
      expect(formatGpsCoordinate({ type: 'Point', coordinates: [2.3] })).toBe('N/A');
    });

    it('returns N/A when coordinates contain non-finite values', () => {
      expect(formatGpsCoordinate({ type: 'Point', coordinates: [NaN, 46.6] })).toBe('N/A');
      expect(formatGpsCoordinate({ type: 'Point', coordinates: [2.3, Infinity] })).toBe('N/A');
    });

    it('limits coordinates to 7 decimal places', () => {
      expect(formatGpsCoordinate({ type: 'Point', coordinates: [2.123456789012, 46.987654321098] }))
        .toBe('46.9876543, 2.1234568');
    });

    it('does not add trailing zeros for short decimals', () => {
      expect(formatGpsCoordinate({ type: 'Point', coordinates: [2.3, 46.6] })).toBe('46.6, 2.3');
    });
  });

  describe('formatLatLng', () => {
    it('formats lat and lng with up to 7 decimal places', () => {
      expect(formatLatLng(46.987654321098, 2.123456789012)).toBe('46.9876543, 2.1234568');
    });

    it('does not add trailing zeros', () => {
      expect(formatLatLng(46.6, 2.3)).toBe('46.6, 2.3');
    });

    it('returns N/A for non-finite values', () => {
      expect(formatLatLng(NaN, 2.3)).toBe('N/A');
      expect(formatLatLng(46.6, Infinity)).toBe('N/A');
    });
  });

  describe('isProjectPointLayerId', () => {
    it('matches project point layer IDs', () => {
      expect(isProjectPointLayerId('project-p1-point')).toBe(true);
      expect(isProjectPointLayerId('project-abc-123-point')).toBe(true);
    });

    it('rejects non-matching layer IDs', () => {
      expect(isProjectPointLayerId('project-p1-line')).toBe(false);
      expect(isProjectPointLayerId('landmarks-layer')).toBe(false);
      expect(isProjectPointLayerId('project--point')).toBe(false);
      expect(isProjectPointLayerId('project-point')).toBe(false);
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
        layer: { id: 'project-p1-line' },
        properties: {},
      })).toBeNull();
    });

    it('parses landmark details from marker feature', () => {
      expect(parseOverlayMarkerDetails({
        id: 'feature-lm',
        layer: { id: 'landmarks-layer' },
        properties: {
          id: 'lm-1',
          name: 'Big Entrance',
          description: 'Main cave entrance',
          collection_name: 'Shared Survey',
          is_personal_collection: false,
        },
        geometry: { type: 'Point', coordinates: [2.3, 46.6] },
      })).toEqual({
        type: 'landmark',
        id: 'lm-1',
        name: 'Big Entrance',
        description: 'Main cave entrance',
        gpsCoordinate: '46.6, 2.3',
        collectionName: 'Shared Survey',
        isPersonalCollection: false,
        canWrite: false,
        canDelete: false,
        collectionId: null,
        latitude: 46.6,
        longitude: 2.3,
      });
    });

    it('exposes permissions, collection id, and coordinates for an editable landmark', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'landmarks-layer' },
        properties: {
          id: 'lm-9',
          name: 'Editable',
          collection: 'col-7',
          collection_name: 'Survey A',
          can_write: true,
          can_delete: true,
        },
        geometry: { type: 'Point', coordinates: [2.3, 46.6] },
      })).toMatchObject({
        type: 'landmark',
        canWrite: true,
        canDelete: true,
        collectionId: 'col-7',
        latitude: 46.6,
        longitude: 2.3,
      });
    });

    it('flags personal collections and defaults their name', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'landmarks-layer' },
        properties: { id: 'lm-3', name: 'Camp', collection_type: 'PERSONAL' },
        geometry: { type: 'Point', coordinates: [2.3, 46.6] },
      })).toEqual({
        type: 'landmark',
        id: 'lm-3',
        name: 'Camp',
        description: 'N/A',
        gpsCoordinate: '46.6, 2.3',
        collectionName: 'Personal Landmarks',
        isPersonalCollection: true,
        canWrite: false,
        canDelete: false,
        collectionId: null,
        latitude: 46.6,
        longitude: 2.3,
      });
    });

    it('returns fallback values for landmark with missing properties', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'landmarks-layer' },
        properties: {},
      })).toEqual({
        type: 'landmark',
        id: 'unknown',
        name: 'N/A',
        description: 'N/A',
        gpsCoordinate: 'N/A',
        collectionName: 'N/A',
        isPersonalCollection: false,
        canWrite: false,
        canDelete: false,
        collectionId: null,
        latitude: null,
        longitude: null,
      });
    });

    it('parses surface station details from marker feature', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'surface-stations-layer' },
        properties: { id: 'ss-1', name: 'Station Alpha', description: 'Weather station' },
        geometry: { type: 'Point', coordinates: [5.1, 43.2] },
      })).toEqual({
        type: 'surfaceStation',
        id: 'ss-1',
        name: 'Station Alpha',
        description: 'Weather station',
        gpsCoordinate: '43.2, 5.1',
      });
    });

    it('returns fallback values for surface station with missing properties', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'surface-stations-layer' },
        properties: {},
      })).toEqual({
        type: 'surfaceStation',
        id: 'unknown',
        name: 'N/A',
        description: 'N/A',
        gpsCoordinate: 'N/A',
      });
    });

    it('parses subsurface station details from circle layer', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'subsurface-stations-circles' },
        properties: { id: 'sub-1', name: 'Sensor Room', description: 'CO2 sensor', tag: 'Geology' },
      })).toEqual({
        type: 'subsurfaceStation',
        id: 'sub-1',
        name: 'Sensor Room',
        description: 'CO2 sensor',
        tag: 'Geology',
      });
    });

    it('parses subsurface station details from icon layers', () => {
      for (const layerId of [
        'subsurface-stations-biology-icons',
        'subsurface-stations-bone-icons',
        'subsurface-stations-artifact-icons',
        'subsurface-stations-geology-icons',
      ] as const) {
        const result = parseOverlayMarkerDetails({
          layer: { id: layerId },
          properties: { id: 'sub-2', name: 'Discovery', description: 'Fossil find' },
        });
        expect(result).toMatchObject({
          type: 'subsurfaceStation',
          name: 'Discovery',
          description: 'Fossil find',
        });
      }
    });

    it('resolves tag from object with name property', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'subsurface-stations-circles' },
        properties: { id: 'sub-3', name: 'Deep', description: 'Below', tag: { name: 'Paleontology', color: '#ff0000' } },
      })).toMatchObject({
        type: 'subsurfaceStation',
        tag: 'Paleontology',
      });
    });

    it('returns N/A tag for missing or null tag', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'subsurface-stations-circles' },
        properties: { id: 'sub-4', name: 'S4' },
      })).toMatchObject({ tag: 'N/A' });

      expect(parseOverlayMarkerDetails({
        layer: { id: 'subsurface-stations-circles' },
        properties: { id: 'sub-5', name: 'S5', tag: null },
      })).toMatchObject({ tag: 'N/A' });
    });

    it('returns fallback values for subsurface station with missing properties', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'subsurface-stations-circles' },
        properties: {},
      })).toEqual({
        type: 'subsurfaceStation',
        id: 'unknown',
        name: 'N/A',
        description: 'N/A',
        tag: 'N/A',
      });
    });

    it('parses project point details with context', () => {
      const context = {
        projectNameByPointLayerId: new Map([['project-p1-point', 'Cave Alpha']]),
      };
      expect(parseOverlayMarkerDetails(
        {
          layer: { id: 'project-p1-point' },
          properties: { name: 'Entrance A' },
          geometry: { type: 'Point', coordinates: [2.3, 46.6] },
        },
        context,
      )).toEqual({
        type: 'projectPoint',
        id: 'unknown',
        projectName: 'Cave Alpha',
        name: 'Entrance A',
        gpsCoordinate: '46.6, 2.3',
      });
    });

    it('returns N/A project name when context is missing', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'project-p1-point' },
        properties: { name: 'Entrance B' },
        geometry: { type: 'Point', coordinates: [1.0, 45.0] },
      })).toMatchObject({
        type: 'projectPoint',
        projectName: 'N/A',
        name: 'Entrance B',
      });
    });

    it('returns fallback values for project point with missing properties', () => {
      expect(parseOverlayMarkerDetails({
        layer: { id: 'project-p2-point' },
        properties: {},
      })).toEqual({
        type: 'projectPoint',
        id: 'unknown',
        projectName: 'N/A',
        name: 'N/A',
        gpsCoordinate: 'N/A',
      });
    });

    it('returns null when layer id is missing', () => {
      expect(parseOverlayMarkerDetails({
        layer: {},
        properties: {},
      })).toBeNull();
    });
  });
});
