import { describe, expect, it } from 'vitest';
import {
  isProjectGeoJSONOversized,
  measureProjectGeoJSONBounds,
  ProjectGeoJSONComputationError,
} from './projectGeoJSONBounds';

const EARTH_RADIUS_KM = 6_371.0088;

function collection(geometries: Array<GeoJSON.Geometry | null>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometries.map((geometry) => (
      { type: 'Feature', properties: {}, geometry } as GeoJSON.Feature
    )),
  };
}

function expectInvalid(input: unknown): void {
  try {
    measureProjectGeoJSONBounds(input);
    throw new Error('Expected measurement to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectGeoJSONComputationError);
    expect(error).toMatchObject({ reason: 'invalid_geojson' });
  }
}

describe('measureProjectGeoJSONBounds geometry traversal', () => {
  it.each<[string, GeoJSON.Geometry]>([
    ['Point with altitude', { type: 'Point', coordinates: [2, 45, 120] }],
    ['MultiPoint', { type: 'MultiPoint', coordinates: [[2, 45], [2.01, 45.01]] }],
    ['LineString', { type: 'LineString', coordinates: [[2, 45], [2.01, 45.01]] }],
    ['MultiLineString', {
      type: 'MultiLineString',
      coordinates: [[[2, 45], [2.01, 45.01]], [[2.005, 45.005], [2.008, 45.008]]],
    }],
    ['Polygon with a hole', {
      type: 'Polygon',
      coordinates: [
        [[2, 45], [2.01, 45], [2.01, 45.01], [2, 45]],
        [[2.002, 45.002], [2.004, 45.002], [2.004, 45.004], [2.002, 45.002]],
      ],
    }],
    ['MultiPolygon', {
      type: 'MultiPolygon',
      coordinates: [[[[2, 45], [2.01, 45], [2.01, 45.01], [2, 45]]]],
    }],
    ['nested GeometryCollection', {
      type: 'GeometryCollection',
      geometries: [{
        type: 'GeometryCollection',
        geometries: [{ type: 'LineString', coordinates: [[2, 45], [2.01, 45.01]] }],
      }],
    }],
  ])('measures %s without omitting coordinates', (_label, geometry) => {
    const result = measureProjectGeoJSONBounds(collection([geometry]));
    expect(result.bounds.west).toBeCloseTo(2);
    expect(result.bounds.east).toBeCloseTo(geometry.type === 'Point' ? 2 : 2.01);
    expect(result.bounds.south).toBeCloseTo(45);
    expect(result.bounds.north).toBeCloseTo(geometry.type === 'Point' ? 45 : 45.01);
  });

  it('ignores null feature geometry while retaining other features', () => {
    const result = measureProjectGeoJSONBounds(collection([
      null,
      { type: 'Point', coordinates: [2, 45] },
    ]));
    expect(result.bounds).toEqual({
      west: 2,
      east: 2,
      south: 45,
      north: 45,
      crossesDateline: false,
    });
  });

  it.each([
    null,
    {},
    { type: 'FeatureCollection', features: {} },
    { type: 'FeatureCollection', features: [null] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {} }] },
  ])('rejects a malformed collection or feature %#', (input) => expectInvalid(input));

  it.each([
    { type: 'Point', coordinates: [] },
    { type: 'MultiPoint', coordinates: [[0]] },
    { type: 'LineString', coordinates: [[0, 0]] },
    { type: 'MultiLineString', coordinates: [[[0, 0]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
    { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0]]]] },
    { type: 'GeometryCollection', geometries: {} },
    { type: 'GeometryCollection', geometries: [null] },
    { type: 'CircularString', coordinates: [[0, 0], [1, 1]] },
  ])('rejects malformed nesting or shape %#', (geometry) => {
    expectInvalid(collection([geometry as unknown as GeoJSON.Geometry]));
  });

  it.each([
    { coordinates: [Number.NaN, 0] },
    { coordinates: [Number.POSITIVE_INFINITY, 0] },
    { coordinates: [181, 0] },
    { coordinates: [-181, 0] },
    { coordinates: [0, 91] },
    { coordinates: [0, -91] },
    { coordinates: ['2', 45] },
    { coordinates: [2, '45'] },
  ])('rejects an invalid position $coordinates', ({ coordinates }) => {
    expectInvalid(collection([{
      type: 'Point',
      coordinates,
    } as unknown as GeoJSON.Point]));
  });

  it('reports no_coordinates for empty and null-only valid collections', () => {
    for (const input of [
      collection([]),
      collection([null]),
      collection([{ type: 'GeometryCollection', geometries: [] }]),
      collection([{ type: 'MultiPoint', coordinates: [] }]),
    ]) {
      expect(() => measureProjectGeoJSONBounds(input)).toThrowError(
        expect.objectContaining({ reason: 'no_coordinates' }),
      );
    }
  });
});

describe('measureProjectGeoJSONBounds circular and distance math', () => {
  it.each([
    [[[12, 0]], { west: 12, east: 12, crossesDateline: false }],
    [[[12, 0], [12, 1]], { west: 12, east: 12, crossesDateline: false }],
    [[[-4, 0], [8, 0]], { west: -4, east: 8, crossesDateline: false }],
    [[[179.9, 0], [-179.9, 0]], { west: 179.9, east: -179.9, crossesDateline: true }],
    [[[-180, 0], [180, 0]], { west: -180, east: -180, crossesDateline: false }],
    [[[0, 0], [180, 0]], { west: -180, east: 0, crossesDateline: false }],
  ])('uses deterministic circular bounds for %j', (coordinates, expected) => {
    const result = measureProjectGeoJSONBounds(collection([{
      type: coordinates.length === 1 ? 'Point' : 'LineString',
      coordinates: coordinates.length === 1 ? coordinates[0] : coordinates,
    } as GeoJSON.Geometry]));
    expect(result.bounds.west).toBeCloseTo(expected.west, 12);
    expect(result.bounds.east).toBeCloseTo(expected.east, 12);
    expect(result.bounds.crossesDateline).toBe(expected.crossesDateline);
  });

  it('accounts for latitude when measuring east-west width', () => {
    const equator = measureProjectGeoJSONBounds(collection([
      { type: 'LineString', coordinates: [[0, 0], [0.5, 0]] },
    ]));
    const highLatitude = measureProjectGeoJSONBounds(collection([
      { type: 'LineString', coordinates: [[0, 75], [0.5, 75]] },
    ]));
    expect(highLatitude.widthKm).toBeLessThan(equator.widthKm / 3);
  });

  it('accepts exactly 100 equatorial km and rejects a minimal excess', () => {
    const exactDegrees = 100 / EARTH_RADIUS_KM * 180 / Math.PI;
    const exact = measureProjectGeoJSONBounds(collection([{
      type: 'LineString',
      coordinates: [[0, 0], [exactDegrees, 0]],
    }]));
    const over = measureProjectGeoJSONBounds(collection([{
      type: 'LineString',
      coordinates: [[0, 0], [exactDegrees + 1e-9, 0]],
    }]));
    expect(exact.widthKm).toBeCloseTo(100, 10);
    expect(isProjectGeoJSONOversized(exact)).toBe(false);
    expect(over.widthKm).toBeGreaterThan(100);
    expect(isProjectGeoJSONOversized(over)).toBe(true);
  });

  it('rejects width-only and height-only excesses with strict comparison', () => {
    expect(isProjectGeoJSONOversized({ widthKm: 100, heightKm: 100 })).toBe(false);
    expect(isProjectGeoJSONOversized({ widthKm: 100.000001, heightKm: 1 })).toBe(true);
    expect(isProjectGeoJSONOversized({ widthKm: 1, heightKm: 100.000001 })).toBe(true);
  });

  it('returns the raw dimensions for the 8,000 km regression fixture', () => {
    const result = measureProjectGeoJSONBounds(collection([{
      type: 'LineString',
      coordinates: [[0, 0], [75, 0]],
    }]));
    expect(result.widthKm).toBeGreaterThan(8_000);
    expect(isProjectGeoJSONOversized(result)).toBe(true);
  });

  it('fails an exact-100-km polar width whose projected footprint is unsafe', () => {
    const latitude = 80;
    const latitudeRadians = latitude * Math.PI / 180;
    const longitudeDeltaRadians = 2 * Math.asin(
      Math.sin(100 / (2 * EARTH_RADIUS_KM)) / Math.cos(latitudeRadians),
    );
    const longitudeDeltaDegrees = longitudeDeltaRadians * 180 / Math.PI;
    try {
      measureProjectGeoJSONBounds(collection([{
        type: 'LineString',
        coordinates: [[0, latitude], [longitudeDeltaDegrees, latitude]],
      }]));
      throw new Error('Expected polar analysis to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        reason: 'bbox_error',
        measurement: {
          widthKm: expect.any(Number),
          heightKm: 0,
        },
      });
      expect((error as ProjectGeoJSONComputationError).measurement!.widthKm).toBe(100);
    }
  });

  it('accepts finite point bounds at the poles', () => {
    const result = measureProjectGeoJSONBounds(collection([{
      type: 'Point',
      coordinates: [0, 90],
    }]));
    expect(result).toMatchObject({ widthKm: 0, heightKm: 0 });
  });

  it('does not mutate the input', () => {
    const input = collection([{
      type: 'LineString',
      coordinates: [[2, 45, 120], [2.01, 45.01, 130]],
    }]);
    const before = JSON.stringify(input);
    measureProjectGeoJSONBounds(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
