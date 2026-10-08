import { describe, expect, it } from 'vitest';
import fixtures from '@speleodb/map-core/geometry-cases.json';
import { GIS_GEOMETRY_CONTRACT } from './constants';
import { inspectGisGeometry, parseGisGeometryDetail, parseGisGeometryList } from './validation';
import { geometryDetail, geometryMetadata } from './testFixtures';

describe('GIS Geometry API validation', () => {
  it.each(['LineString', 'Polygon'] as const)('rejects oversized %s input before reading positions', type => {
    let coordinateReads = 0;
    const positions = new Array(GIS_GEOMETRY_CONTRACT.max_vertices + (type === 'Polygon' ? 2 : 1));
    Object.defineProperty(positions, 0, { get() { coordinateReads++; return [-87.5, 20.1]; } });
    expect(() => inspectGisGeometry({ type, coordinates: type === 'Polygon' ? [positions] : positions }))
      .toThrow('Invalid GIS Geometry response.');
    expect(coordinateReads).toBe(0);
  });
  it('isolates validated geometry coordinates from later transport-object mutation', () => {
    const detail = geometryDetail();
    const parsed = parseGisGeometryDetail(detail);
    if (detail.geojson.type !== 'LineString' || parsed.detail.geojson.type !== 'LineString') throw new Error('Expected a line fixture');
    detail.geojson.coordinates[0][0] = 0;
    expect(parsed.detail.geojson.coordinates[0][0]).toBe(-87.5);
  });
  it('rejects foreign geometry fields without reading their values', () => {
    let foreignReads = 0;
    const geometry = { type: 'LineString', coordinates: [[-87.5, 20.1], [-87.499, 20.1]] };
    Object.defineProperty(geometry, 'foreign', { enumerable: true, get() { foreignReads++; return new Array(100_000); } });
    expect(() => inspectGisGeometry(geometry)).toThrow('Invalid GIS Geometry response.');
    expect(foreignReads).toBe(0);
  });
  for (const fixture of fixtures) {
    it(`matches the canonical Python/JavaScript contract: ${fixture.id}`, () => {
      if (!fixture.valid) { expect(() => inspectGisGeometry(fixture.geojson)).toThrow(); return; }
      const result = inspectGisGeometry(fixture.geojson);
      expect(result.vertexCount).toBe(fixture.vertex_count);
      expect(result.areaM2).toBeCloseTo(fixture.area_m2!, 4);
    });
  }
  it('preserves numeric precision, coordinate order and ordinary bounds', () => {
    const coordinates = [[-170, 20], [0, 20], [170, 20]];
    const result = inspectGisGeometry({ type: 'LineString', coordinates });
    expect(result.geometry.coordinates).toEqual(coordinates);
    expect(result.bounds).toEqual({ west: -170, east: 170, south: 20, north: 20, crossesDateline: false });
    const detailed = parseGisGeometryDetail(geometryDetail());
    expect(detailed.detail.geojson.coordinates).toEqual([[-87.5, 20.1], [-87.499123456789, 20.1]]);
  });
  it('accepts empty lists and every permission level with timezone offsets', () => {
    expect(parseGisGeometryList([])).toEqual([]);
    for (const level of [1, 2, 3] as const) expect(parseGisGeometryList([geometryMetadata({
      user_permission_level: level, user_permission_level_label: (['READ_ONLY','READ_AND_WRITE','ADMIN'] as const)[level - 1],
      can_write: level >= 2, can_delete: level === 3, can_manage_permissions: level === 3,
    })])).toHaveLength(1);
  });
  it('counts Unicode code points like the backend name limit', () => {
    const name = '🦇'.repeat(255);
    expect(parseGisGeometryList([geometryMetadata({ name })])[0].name).toBe(name);
    expect(() => parseGisGeometryList([geometryMetadata({ name: `${name}x` })])).toThrow();
  });
  it.each([
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { revision: 0 }, { id: '../../other' }, { color: 'url(evil)' },
    { user_permission_level: 0 }, { user_permission_level_label: 'ADMIN' }, { creation_date: '2026-01-01' },
    { geometry_type: 'Point' }, { can_write: true }, { name: 'x'.repeat(256) },
  ])('rejects unsafe metadata %j', patch => {
    expect(() => parseGisGeometryList([geometryMetadata(patch)])).toThrow();
  });
  it('rejects envelopes, duplicates and inconsistent detail measurements', () => {
    expect(() => parseGisGeometryList({ results: [] })).toThrow();
    expect(() => parseGisGeometryList([geometryMetadata(), geometryMetadata()])).toThrow();
    expect(() => parseGisGeometryDetail(geometryDetail({ vertex_count: 3 }))).toThrow();
    expect(() => parseGisGeometryDetail(geometryDetail({ bbox_area_m2: 1 }))).toThrow();
    expect(() => parseGisGeometryDetail(geometryDetail(), 'ffffffff-ffff-ffff-ffff-ffffffffffff')).toThrow();
    expect(() => inspectGisGeometry({ type: 'Feature', geometry: geometryDetail().geojson })).toThrow();
    expect(() => inspectGisGeometry(JSON.stringify(geometryDetail().geojson))).toThrow();
  });
});
