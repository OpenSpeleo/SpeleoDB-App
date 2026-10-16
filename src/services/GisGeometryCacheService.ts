import { CacheStore } from './CacheStore';
import type { GisGeometryMapRecord, GisGeometryMetadata } from '../types/gisGeometry';
import { isGisGeometryId, parseGisGeometryDetail, parseGisGeometryList } from '../gisGeometry/validation';
import { throwIfAborted } from '../utils/abort';

export interface GisGeometryCatalog {
  schemaVersion: 1 | 2;
  scope: string;
  items: GisGeometryMetadata[];
  /** Durable deletion authority survives interruption before offline-catalog cleanup. */
  revokedIds: string[];
}
const key = (scope: string, id: string) => `gis-geometry:${scope}:${id}`;
/** Only durable v1 data receives defaults; live API responses stay strict. */
function upgradeLegacyMetadata(value: unknown, detail = false): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return { ...record, alias: record.alias === undefined ? '' : record.alias,
    ...(detail ? { description: record.description === undefined ? '' : record.description } : {}) };
}
function parseCachedDetail(value: unknown, schemaVersion: number, id: string): GisGeometryMapRecord {
  const record = parseGisGeometryDetail(schemaVersion === 1 ? upgradeLegacyMetadata(value, true) : value, id);
  return schemaVersion === 1 ? { ...record, needsMetadataRefresh: true } : record;
}
export class GisGeometryCacheService {
  constructor(private readonly store = new CacheStore()) {}

  async getCatalog(scope: string): Promise<GisGeometryCatalog | null> {
    const entry = await this.store.get<GisGeometryCatalog>('projects', key(scope, 'catalog'));
    if (!entry) return null;
    const v = entry.data;
    if (![1, 2].includes(v?.schemaVersion) || v.scope !== scope || !Array.isArray(v.revokedIds) || !v.revokedIds.every(isGisGeometryId)) {
      throw new Error('Saved GIS Geometries could not be read.');
    }
    return { ...v, items: parseGisGeometryList(v.schemaVersion === 1 && Array.isArray(v.items) ? v.items.map(item => upgradeLegacyMetadata(item)) : v.items) };
  }

  async putCatalog(catalog: GisGeometryCatalog, signal?: AbortSignal, validate: () => void = () => {}): Promise<void> {
    await this.store.update<GisGeometryCatalog>('projects', key(catalog.scope, 'catalog'), () => {
      validate();
      return { data: { ...catalog, schemaVersion: 2 }, cachedAt: Date.now() };
    }, { signal });
    throwIfAborted(signal);
    validate();
  }

  async getDetail(scope: string, id: string): Promise<GisGeometryMapRecord | null> {
    const entry = await this.store.get<{ schemaVersion: number; scope: string; detail: unknown }>('geojson', key(scope, id));
    if (!entry) return null;
    if (![1, 2].includes(entry.data?.schemaVersion) || entry.data.scope !== scope) throw new Error('Saved GIS Geometry could not be read.');
    return parseCachedDetail(entry.data.detail, entry.data.schemaVersion, id);
  }

  async putDetail(scope: string, record: GisGeometryMapRecord, signal?: AbortSignal, validate: () => void = () => {}): Promise<GisGeometryMapRecord> {
    let accepted = record;
    await this.store.update<{ schemaVersion: number; scope: string; detail: unknown }>('geojson', key(scope, record.detail.id), current => {
      validate();
      if (current && [1, 2].includes(current.data.schemaVersion) && current.data.scope === scope) {
        let prior: GisGeometryMapRecord | null = null;
        try { prior = parseCachedDetail(current.data.detail, current.data.schemaVersion, record.detail.id); } catch { /* Fresh validated data repairs corrupt cache. */ }
        if (prior && prior.detail.revision > record.detail.revision) { accepted = prior; return null; }
      }
      return { data: { schemaVersion: record.needsMetadataRefresh ? 1 : 2, scope, detail: record.detail }, cachedAt: Date.now() };
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
