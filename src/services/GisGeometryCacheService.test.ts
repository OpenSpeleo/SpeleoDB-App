import { beforeEach, describe, expect, it } from 'vitest';
import { CacheStore } from './CacheStore';
import { GisGeometryCacheService, type GisGeometryCatalog } from './GisGeometryCacheService';
import { GEOMETRY_ID, geometryDetail, geometryMetadata } from '../gisGeometry/testFixtures';
import { parseGisGeometryDetail } from '../gisGeometry/validation';

const store = new CacheStore();
beforeEach(async () => { await store.clear('projects'); await store.clear('geojson'); });
const catalog = (scope: string): GisGeometryCatalog => ({ schemaVersion: 1, scope, items: [geometryMetadata()], revokedIds: [] });
describe('GIS Geometry IndexedDB authority', () => {
  it('persists original coordinates and isolates identical UUIDs across account scopes', async () => {
    const cache = new GisGeometryCacheService(store);
    await cache.putCatalog(catalog('a'));
    await cache.putDetail('a', parseGisGeometryDetail(geometryDetail()));
    await cache.putCatalog(catalog('b'));
    expect(await cache.getDetail('b', GEOMETRY_ID)).toBeNull();
    const recreated = new GisGeometryCacheService(new CacheStore());
    expect((await recreated.getDetail('a', GEOMETRY_ID))?.detail.geojson).toEqual(geometryDetail().geojson);
    await recreated.clearScope('a');
    expect(await cache.getCatalog('a')).toBeNull();
    expect(await cache.getCatalog('b')).not.toBeNull();
  });
  it('checks monotonic revision in the actual serialized read-write transaction', async () => {
    const cache = new GisGeometryCacheService(store);
    const newer = parseGisGeometryDetail(geometryDetail({ revision: 9, name: 'Newer' }));
    const older = parseGisGeometryDetail(geometryDetail({ revision: 2, name: 'Older' }));
    await Promise.all([cache.putDetail('a', newer), cache.putDetail('a', older)]);
    expect((await cache.getDetail('a', GEOMETRY_ID))?.detail.revision).toBe(9);
    expect((await cache.putDetail('a', older)).detail.name).toBe('Newer');
  });
  it('clears orphan details and a corrupt catalog without deleting another account', async () => {
    const cache = new GisGeometryCacheService(store);
    await store.set('projects', 'gis-geometry:a:catalog', { data: 'corrupt', cachedAt: 1 });
    await cache.putDetail('a', parseGisGeometryDetail(geometryDetail()));
    await cache.putDetail('ab', parseGisGeometryDetail(geometryDetail()));
    await cache.clearScope('a');
    expect(await cache.getCatalog('a')).toBeNull();
    expect(await cache.getDetail('a', GEOMETRY_ID)).toBeNull();
    expect(await cache.getDetail('ab', GEOMETRY_ID)).not.toBeNull();
  });
  it('aborts stale publication inside a transaction and preserves prior durable bytes', async () => {
    const cache = new GisGeometryCacheService(store);
    await cache.putDetail('a', parseGisGeometryDetail(geometryDetail()));
    await expect(cache.putDetail('a', parseGisGeometryDetail(geometryDetail({ revision: 2 })), undefined, () => { throw new Error('revoked'); })).rejects.toThrow('revoked');
    expect((await cache.getDetail('a', GEOMETRY_ID))?.detail.revision).toBe(1);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(cache.putCatalog(catalog('a'), cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await cache.getCatalog('a')).toBeNull();
  });
  it('keeps durable revocation authority after coordinate deletion and recreation', async () => {
    const cache = new GisGeometryCacheService(store);
    await cache.putDetail('a', parseGisGeometryDetail(geometryDetail()));
    await cache.putCatalog({ ...catalog('a'), items: [], revokedIds: [GEOMETRY_ID] });
    await cache.removeDetails('a', [GEOMETRY_ID]);
    const recreated = new GisGeometryCacheService(new CacheStore());
    expect((await recreated.getCatalog('a'))?.revokedIds).toEqual([GEOMETRY_ID]);
    expect(await recreated.getDetail('a', GEOMETRY_ID)).toBeNull();
  });
  it('fails closed on malformed persisted membership and coordinates', async () => {
    const cache = new GisGeometryCacheService(store);
    await store.set('projects', 'gis-geometry:a:catalog', { data: { ...catalog('a'), schemaVersion: 99 }, cachedAt: 1 });
    await expect(cache.getCatalog('a')).rejects.toThrow();
    await store.set('geojson', `gis-geometry:a:${GEOMETRY_ID}`, { data: { schemaVersion: 1, scope: 'wrong', detail: geometryDetail() }, cachedAt: 1 });
    await expect(cache.getDetail('a', GEOMETRY_ID)).rejects.toThrow();
  });
});
