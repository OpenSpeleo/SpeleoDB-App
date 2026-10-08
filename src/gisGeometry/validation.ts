import { validateGeometry } from '@speleodb/map-core/geometry';
import { GIS_GEOMETRY_CONTRACT as rules } from './constants';
import type { GisGeometryDetail, GisGeometryMapRecord, GisGeometryMetadata, GisGeometryShape } from '../types/gisGeometry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isGisGeometryId(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GIS Geometry response.');
  return value as Record<string, unknown>;
}
function invalid(): never { throw new Error('Invalid GIS Geometry response.'); }
function date(value: unknown): value is string {
  return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
export function parseGisGeometryMetadata(value: unknown): GisGeometryMetadata {
  const v = object(value);
  const levels = ['READ_ONLY', 'READ_AND_WRITE', 'ADMIN'];
  if (!isGisGeometryId(v.id) || typeof v.name !== 'string' || !v.name.trim() || Array.from(v.name).length > rules.name_max_length
    || typeof v.color !== 'string' || !/^#[\da-f]{6}$/i.test(v.color)
    || typeof v.created_by !== 'string' || !rules.types.includes(v.geometry_type as string)
    || !Number.isSafeInteger(v.revision) || (v.revision as number) < 1
    || ![1, 2, 3].includes(v.user_permission_level as number)
    || v.user_permission_level_label !== levels[(v.user_permission_level as number) - 1]
    || v.can_write !== ((v.user_permission_level as number) >= 2)
    || v.can_delete !== (v.user_permission_level === 3) || v.can_manage_permissions !== (v.user_permission_level === 3)
    || !date(v.creation_date) || !date(v.modified_date)) invalid();
  return {
    id: v.id as string, name: v.name as string, color: v.color as string, created_by: v.created_by as string,
    geometry_type: v.geometry_type as GisGeometryMetadata['geometry_type'], revision: v.revision as number,
    user_permission_level: v.user_permission_level as GisGeometryMetadata['user_permission_level'],
    user_permission_level_label: v.user_permission_level_label as GisGeometryMetadata['user_permission_level_label'],
    can_write: v.can_write as boolean, can_delete: v.can_delete as boolean, can_manage_permissions: v.can_manage_permissions as boolean,
    creation_date: v.creation_date as string, modified_date: v.modified_date as string,
  };
}
export function parseGisGeometryList(value: unknown): GisGeometryMetadata[] {
  if (!Array.isArray(value)) invalid();
  const items = value.map(parseGisGeometryMetadata);
  if (new Set(items.map(item => item.id)).size !== items.length) invalid();
  return items;
}
/** Shared upstream validation; API parsing retains the fixed mobile error boundary. */
export function inspectGisGeometry(value: unknown) {
  const shape = object(value);
  const coordinates = shape.coordinates;
  if (shape.type === 'LineString') {
    if (!Array.isArray(coordinates) || coordinates.length > rules.max_vertices) invalid();
  } else if (shape.type === 'Polygon') {
    if (!Array.isArray(coordinates) || coordinates.length !== 1
      || !Array.isArray(coordinates[0]) || coordinates[0].length > rules.max_vertices + 1) invalid();
  } else invalid();
  const analysis = validateGeometry(value);
  if (!analysis.valid || !analysis.bounds) invalid();
  const [[west, south], [east, north]] = analysis.bounds;
  const positions = (shape.type === 'Polygon' ? coordinates[0] : coordinates) as number[][];
  const copiedPositions = positions.map(position => [position[0], position[1]]);
  return {
    geometry: { type: shape.type, coordinates: shape.type === 'Polygon' ? [copiedPositions] : copiedPositions } as GisGeometryShape,
    bounds: { west, south, east, north, crossesDateline: false },
    areaM2: analysis.areaM2,
    vertexCount: analysis.vertexCount,
  };
}
export function parseGisGeometryDetail(value: unknown, expectedId?: string): GisGeometryMapRecord {
  const metadata = parseGisGeometryMetadata(value), v = object(value);
  const analysis = inspectGisGeometry(v.geojson);
  if ((expectedId && metadata.id !== expectedId) || metadata.geometry_type !== analysis.geometry.type
    || typeof v.bbox_area_m2 !== 'number' || !Number.isFinite(v.bbox_area_m2) || v.bbox_area_m2 < 0 || v.bbox_area_m2 > rules.max_area_m2
    || v.vertex_count !== analysis.vertexCount
    || Math.abs(v.bbox_area_m2 - analysis.areaM2) > Math.max(1e-6, analysis.areaM2 * 1e-12)) invalid();
  const detail: GisGeometryDetail = { ...metadata, geojson: analysis.geometry, bbox_area_m2: v.bbox_area_m2, vertex_count: analysis.vertexCount };
  return { detail, bounds: analysis.bounds, feature: { type: 'Feature', id: detail.id, properties: { name: detail.name }, geometry: detail.geojson } };
}
