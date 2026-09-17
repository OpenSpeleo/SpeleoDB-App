import { CacheStore } from './CacheStore';
import type { GisGeometryMapRecord, GisGeometryMetadata } from '../types/gisGeometry';
import { isGisGeometryId, parseGisGeometryDetail, parseGisGeometryList } from '../gisGeometry/validation';
import { throwIfAborted } from '../utils/abort';

export interface GisGeometryCatalog {
  schemaVersion: 1;
  scope: string;
  items: GisGeometryMetadata[];
  /** Durable deletion authority survives interruption before offline-catalog cleanup. */
  revokedIds: string[];
}
const key = (scope: string, id: string) => `gis-geometry:${scope}:${id}`;
export class GisGeometryCacheService {
  constructor(private readonly store = new CacheStore()) {}

  async getCatalog(scope: string): Promise<GisGeometryCatalog | null> {
    const entry = await this.store.get<GisGeometryCatalog>('projects', key(scope, 'catalog'));
    if (!entry) return null;
    const v = entry.data;
    if (v?.schemaVersion !== 1 || v.scope !== scope || !Array.isArray(v.revokedIds) || !v.revokedIds.every(isGisGeometryId)) {
      throw new Error('Saved GIS Geometries could not be read.');
    }
    return { ...v, items: parseGisGeometryList(v.items) };
  }

  async putCatalog(catalog: GisGeometryCatalog, signal?: AbortSignal, validate: () => void = () => {}): Promise<void> {
    await this.store.update<GisGeometryCatalog>('projects', key(catalog.scope, 'catalog'), () => {
      validate();
      return { data: catalog, cachedAt: Date.now() };
    }, { signal });
    throwIfAborted(signal);
    validate();
  }

  async getDetail(scope: string, id: string): Promise<GisGeometryMapRecord | null> {
    const entry = await this.store.get<{ schemaVersion: number; scope: string; detail: unknown }>('geojson', key(scope, id));
    if (!entry) return null;
    if (entry.data?.schemaVersion !== 1 || entry.data.scope !== scope) throw new Error('Saved GIS Geometry could not be read.');
    return parseGisGeometryDetail(entry.data.detail, id);
  }

  async putDetail(scope: string, record: GisGeometryMapRecord, signal?: AbortSignal, validate: () => void = () => {}): Promise<GisGeometryMapRecord> {
    let accepted = record;
    await this.store.update<{ schemaVersion: number; scope: string; detail: unknown }>('geojson', key(scope, record.detail.id), current => {
      validate();
      if (current?.data.schemaVersion === 1 && current.data.scope === scope) {
        let prior: GisGeometryMapRecord | null = null;
        try { prior = parseGisGeometryDetail(current.data.detail, record.detail.id); } catch { /* Fresh validated data repairs corrupt cache. */ }
        if (prior && prior.detail.revision > record.detail.revision) { accepted = prior; return null; }
      }
      return { data: { schemaVersion: 1, scope, detail: record.detail }, cachedAt: Date.now() };
    }, { signal });
    throwIfAborted(signal);
    validate();
    return accepted;
  }

  async removeDetails(scope: string, ids: readonly string[], signal?: AbortSignal): Promise<void> {
    await Promise.all(ids.map(id => this.store.delete('geojson', key(scope, id), { signal })));
    throwIfAborted(signal);
  }

  async clearScope(scope: string): Promise<void> {
    // Clear by key ownership, even when an interrupted write orphaned a detail
    // or the catalog cannot be parsed. No other account's entries are touched.
    const prefix = key(scope, '');
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    await Promise.all([
      this.store.delete('geojson', range),
      this.store.delete('projects', range),
    ]);
  }
}
