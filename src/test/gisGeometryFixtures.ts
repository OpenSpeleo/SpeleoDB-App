import type { GisGeometryMetadata, GisGeometryMapRecord, GisGeometrySnapshot } from '../types/gisGeometry';
import { EMPTY_GIS_GEOMETRY_SNAPSHOT } from '../types/gisGeometry';

export function gisMetadata(overrides: Partial<GisGeometryMetadata> = {}): GisGeometryMetadata {
  return {
    id: '12345678-1234-4234-8234-123456789abc', name: 'Reference line', color: '#377eb8',
    created_by: 'creator@example.test', geometry_type: 'LineString', revision: 1,
    user_permission_level: 1, user_permission_level_label: 'READ_ONLY',
    can_write: false, can_delete: false, can_manage_permissions: false,
    creation_date: '2026-09-17T08:00:00-04:00', modified_date: '2026-09-17T08:00:00-04:00',
    ...overrides,
  };
}

export function gisRecord(metadata = gisMetadata()): GisGeometryMapRecord {
  const geometry: GeoJSON.LineString = { type: 'LineString', coordinates: [[-87.5, 20.1], [-87.499, 20.1]] };
  return {
    detail: { ...metadata, geojson: geometry, bbox_area_m2: 0, vertex_count: 2 },
    bounds: { west: -87.5, east: -87.499, south: 20.1, north: 20.1, crossesDateline: false },
    feature: { type: 'Feature', id: metadata.id, properties: { name: metadata.name }, geometry },
  };
}

export function gisSnapshot(overrides: Partial<GisGeometrySnapshot> = {}): GisGeometrySnapshot {
  return { ...EMPTY_GIS_GEOMETRY_SNAPSHOT, scope: 'session-a', status: 'ready', items: [gisMetadata()], ...overrides };
}
