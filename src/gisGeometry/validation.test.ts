import { describe, expect, it } from 'vitest';
import fixtures from './geometry_cases.json';
import { inspectGisGeometry, parseGisGeometryDetail, parseGisGeometryList } from './validation';
import { geometryDetail, geometryMetadata } from './testFixtures';

describe('GIS Geometry API validation', () => {
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
