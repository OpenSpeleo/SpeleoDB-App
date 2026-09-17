import type { ProjectGeoJSONBounds } from './projectGeoJSON';

export type GisGeometryShape = GeoJSON.LineString | GeoJSON.Polygon;
export interface GisGeometryMetadata {
  id: string;
  name: string;
  color: string;
  created_by: string;
  geometry_type: 'LineString' | 'Polygon';
  revision: number;
  user_permission_level: 1 | 2 | 3;
  user_permission_level_label: 'READ_ONLY' | 'READ_AND_WRITE' | 'ADMIN';
  can_write: boolean;
  can_delete: boolean;
  can_manage_permissions: boolean;
  creation_date: string;
  modified_date: string;
}
export interface GisGeometryDetail extends GisGeometryMetadata {
  geojson: GisGeometryShape;
  bbox_area_m2: number;
  vertex_count: number;
}
export interface GisGeometryMapRecord {
  detail: GisGeometryDetail;
  bounds: ProjectGeoJSONBounds;
  feature: GeoJSON.Feature<GisGeometryShape>;
}
export interface GisGeometryPrefetchSource {
  id: string;
  name: string;
  color: string;
  sourceRevision: string;
  bounds: ProjectGeoJSONBounds;
}
export interface GisGeometrySnapshot {
  scope: string | null;
  items: readonly GisGeometryMetadata[];
  records: Readonly<Record<string, GisGeometryMapRecord>>;
  loadingIds: readonly string[];
  errors: Readonly<Record<string, string>>;
  status: 'idle' | 'loading' | 'ready' | 'stale' | 'error';
  error: string | null;
}
export const EMPTY_GIS_GEOMETRY_SNAPSHOT: GisGeometrySnapshot = {
  scope: null, items: [], records: {}, loadingIds: [], errors: {}, status: 'idle', error: null,
};
