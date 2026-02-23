import { describe, it, expect } from 'vitest';
import {
  DEPTH_COLOR_STOPS,
  DEPTH_PROPERTY_KEY,
  attachDepthToFeatureCollection,
  computeDepthDomain,
  createDepthColorExpression,
  getDepthFromGeometry,
  getDepthFromProperties,
  getFeatureDepth,
  getDepthRatio,
  mergeDepthDomains,
} from './depthColoring';

function makeFeature(
  properties: Record<string, unknown>,
  geometry: GeoJSON.Geometry,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties,
    geometry,
  };
}

describe('depthColoring', () => {
  describe('getDepthFromProperties', () => {
    it('reads numeric depth from known property keys', () => {
      expect(getDepthFromProperties({ depth: -42 })).toBe(-42);
      expect(getDepthFromProperties({ depth_m: '12.5' })).toBe(12.5);
      expect(getDepthFromProperties({ z: 8 })).toBe(8);
      expect(getDepthFromProperties({ elevation: '33' })).toBe(33);
    });

    it('returns null when no numeric depth exists', () => {
      expect(getDepthFromProperties({ depth: 'abc' })).toBeNull();
      expect(getDepthFromProperties({})).toBeNull();
      expect(getDepthFromProperties(null)).toBeNull();
    });
  });

  describe('getDepthFromGeometry', () => {
    it('returns point Z when present', () => {
      expect(getDepthFromGeometry({
        type: 'Point',
        coordinates: [2.3, 46.6, -11],
      })).toBe(-11);
    });

    it('returns average Z for line-like geometries', () => {
      expect(getDepthFromGeometry({
        type: 'LineString',
        coordinates: [
          [0, 0, -10],
          [1, 1, -20],
          [2, 2, -30],
        ],
      })).toBe(-20);
    });

    it('returns null for geometries without Z values', () => {
      expect(getDepthFromGeometry({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      })).toBeNull();
    });

    it('returns average Z for polygon ring coordinates', () => {
      expect(getDepthFromGeometry({
        type: 'Polygon',
        coordinates: [[[0, 0, -10], [1, 0, -20], [1, 1, -30], [0, 0, -10]]],
      })).toBeCloseTo(-17.5);
    });

    it('returns average Z for MultiPolygon coordinates', () => {
      expect(getDepthFromGeometry({
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0, -10], [1, 0, -20], [0, 0, -10]]],
          [[[2, 2, -40], [3, 3, -40], [2, 2, -40]]],
        ],
      })).toBeCloseTo(-26.667, 2);
    });

    it('returns average Z for MultiPoint coordinates', () => {
      expect(getDepthFromGeometry({
        type: 'MultiPoint',
        coordinates: [[0, 0, -8], [1, 1, -12]],
      })).toBe(-10);
    });

    it('returns average Z for GeometryCollection', () => {
      expect(getDepthFromGeometry({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [0, 0, -10] },
          { type: 'Point', coordinates: [1, 1, -30] },
        ],
      })).toBe(-20);
    });
  });

  describe('getFeatureDepth', () => {
    it('prefers properties over geometry fallback', () => {
      const feature = makeFeature(
        { depth: -99 },
        { type: 'Point', coordinates: [1, 2, -5] },
      );
      expect(getFeatureDepth(feature)).toBe(-99);
    });

    it('falls back to geometry Z when property depth is absent', () => {
      const feature = makeFeature(
        {},
        { type: 'Point', coordinates: [1, 2, -5] },
      );
      expect(getFeatureDepth(feature)).toBe(-5);
    });
  });

  describe('attachDepthToFeatureCollection', () => {
    it('adds normalized depth property to features with depth', () => {
      const collection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          makeFeature({ name: 'a', depth: -10 }, { type: 'Point', coordinates: [0, 0] }),
          makeFeature({ name: 'b' }, { type: 'Point', coordinates: [0, 0, -20] }),
          makeFeature({ name: 'c' }, { type: 'Point', coordinates: [0, 0] }),
        ],
      };

      const normalized = attachDepthToFeatureCollection(collection);
      const propsA = normalized.features[0].properties as Record<string, unknown>;
      const propsB = normalized.features[1].properties as Record<string, unknown>;
      const propsC = normalized.features[2].properties as Record<string, unknown>;

      expect(propsA[DEPTH_PROPERTY_KEY]).toBe(-10);
      expect(propsB[DEPTH_PROPERTY_KEY]).toBe(-20);
      expect(propsC[DEPTH_PROPERTY_KEY]).toBeUndefined();
    });
  });

  describe('computeDepthDomain', () => {
    it('uses a 0-limited minimum and clamps negative depths', () => {
      const domain = computeDepthDomain([
        {
          type: 'FeatureCollection',
          features: [
            makeFeature({ [DEPTH_PROPERTY_KEY]: -5 }, { type: 'Point', coordinates: [0, 0] }),
            makeFeature({ [DEPTH_PROPERTY_KEY]: -40 }, { type: 'Point', coordinates: [0, 0] }),
          ],
        },
        {
          type: 'FeatureCollection',
          features: [
            makeFeature({}, { type: 'Point', coordinates: [0, 0, -25] }),
          ],
        },
      ]);

      expect(domain).toEqual({ min: 0, max: 0 });
    });

    it('keeps positive depth range while preserving 0 as minimum', () => {
      const domain = computeDepthDomain([
        {
          type: 'FeatureCollection',
          features: [
            makeFeature({ [DEPTH_PROPERTY_KEY]: -12 }, { type: 'Point', coordinates: [0, 0] }),
            makeFeature({ [DEPTH_PROPERTY_KEY]: 8 }, { type: 'Point', coordinates: [0, 0] }),
            makeFeature({}, { type: 'Point', coordinates: [0, 0, 22] }),
          ],
        },
      ]);

      expect(domain).toEqual({ min: 0, max: 22 });
    });

    it('returns null when no depth values are available', () => {
      const domain = computeDepthDomain([{
        type: 'FeatureCollection',
        features: [
          makeFeature({}, { type: 'Point', coordinates: [0, 0] }),
        ],
      }]);

      expect(domain).toBeNull();
    });

    it('returns null for empty collections array', () => {
      expect(computeDepthDomain([])).toBeNull();
    });
  });

  describe('createDepthColorExpression', () => {
    it('returns fallback color when domain is null', () => {
      expect(createDepthColorExpression(null, '#abc')).toBe('#abc');
    });

    it('returns case expression with single color when domain max is zero', () => {
      const expr = createDepthColorExpression({ min: 0, max: 0 }, '#fff');
      expect(Array.isArray(expr)).toBe(true);
      const arr = expr as unknown[];
      expect(arr[0]).toBe('case');
      expect(arr).toHaveLength(4);
      expect(arr[2]).toBe(DEPTH_COLOR_STOPS[0].color);
      expect(arr[3]).toBe('#fff');
    });

    it('creates expression tree when domain exists', () => {
      const expr = createDepthColorExpression({ min: 0, max: 10 }, '#fff');
      expect(Array.isArray(expr)).toBe(true);
      expect((expr as unknown[])[0]).toBe('case');
      expect(JSON.stringify(expr)).toContain('"max",0');
      expect(JSON.stringify(expr)).toContain('"sqrt"');
      for (const stop of DEPTH_COLOR_STOPS) {
        expect(JSON.stringify(expr)).toContain(stop.color);
      }
    });
  });

  describe('getDepthRatio', () => {
    it('computes linear depth ratios safely', () => {
      const domain = { min: 0, max: 100 };
      expect(getDepthRatio(0, domain)).toBe(0);
      expect(getDepthRatio(100, domain)).toBe(1);
      expect(getDepthRatio(25, domain)).toBeCloseTo(0.25, 2);
      expect(getDepthRatio(50, domain)).toBeCloseTo(0.5, 2);
      expect(getDepthRatio(-10, domain)).toBe(0);
      expect(getDepthRatio(120, domain)).toBe(1);
    });

    it('pins collapsed domains to 0/1 for gauge stability', () => {
      const domain = { min: 0, max: 0 };
      expect(getDepthRatio(-5, domain)).toBe(0);
      expect(getDepthRatio(0, domain)).toBe(0);
      expect(getDepthRatio(5, domain)).toBe(1);
    });
  });

  describe('mergeDepthDomains', () => {
    it('returns null for empty array', () => {
      expect(mergeDepthDomains([])).toBeNull();
    });

    it('returns null when all entries are null', () => {
      expect(mergeDepthDomains([null, null])).toBeNull();
    });

    it('returns single domain when only one is non-null', () => {
      expect(mergeDepthDomains([{ min: 0, max: 50 }, null])).toEqual({ min: 0, max: 50 });
    });

    it('merges multiple domains taking max of maxes', () => {
      expect(mergeDepthDomains([
        { min: 0, max: 30 },
        { min: 0, max: 80 },
      ])).toEqual({ min: 0, max: 80 });
    });

    it('always returns min 0 regardless of input min values', () => {
      const result = mergeDepthDomains([
        { min: 5, max: 30 },
        { min: 10, max: 80 },
      ]);
      expect(result).toEqual({ min: 0, max: 80 });
    });
  });
});
