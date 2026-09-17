import type { GisGeometryDetail, GisGeometryMetadata } from '../types/gisGeometry';
export const GEOMETRY_ID = '12345678-1234-4234-8234-123456789abc';
export function geometryMetadata(patch: Record<string, unknown> = {}): GisGeometryMetadata {
  return {
    id: GEOMETRY_ID, name: 'Reference line', color: '#377eb8', created_by: 'creator@example.com',
    geometry_type: 'LineString', revision: 1, user_permission_level: 1, user_permission_level_label: 'READ_ONLY',
    can_write: false, can_delete: false, can_manage_permissions: false,
    creation_date: '2026-09-17T08:00:00-04:00', modified_date: '2026-09-17T08:00:00-04:00', ...patch,
  } as GisGeometryMetadata;
}
export function geometryDetail(patch: Record<string, unknown> = {}): GisGeometryDetail {
  return { ...geometryMetadata(), geojson: { type: 'LineString', coordinates: [[-87.5, 20.1], [-87.499123456789, 20.1]] }, bbox_area_m2: 0, vertex_count: 2, ...patch } as GisGeometryDetail;
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
