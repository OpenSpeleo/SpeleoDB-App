import { GIS_GEOMETRY_CONTRACT as rules } from './constants';
import type { GisGeometryDetail, GisGeometryMapRecord, GisGeometryMetadata, GisGeometryShape } from '../types/gisGeometry';

type Position = [number, number];
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
const equal = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const cross = (a: Position, b: Position, c: Position) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const contains = (a: Position, b: Position, p: Position) => p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
function intersects(a: Position, b: Position, c: Position, d: Position): boolean {
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
  return (((x > 0 && y < 0) || (x < 0 && y > 0)) && ((z > 0 && w < 0) || (z < 0 && w > 0)))
    || (x === 0 && contains(a, b, c)) || (y === 0 && contains(a, b, d))
    || (z === 0 && contains(c, d, a)) || (w === 0 && contains(c, d, b));
}
/** Read-only port of upstream geometry_editor/geometry.js; bounded to 100 vertices. */
export function inspectGisGeometry(value: unknown) {
  const v = object(value);
  if (Object.keys(v).length !== 2 || !('type' in v) || !('coordinates' in v) || !rules.types.includes(v.type as string)) invalid();
  const polygon = v.type === 'Polygon';
  if (polygon && (!Array.isArray(v.coordinates) || v.coordinates.length !== 1)) invalid();
  const coordinates: unknown = polygon ? (v.coordinates as unknown[])[0] : v.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length - Number(polygon) > rules.max_vertices) invalid();
  const points = coordinates.map((p): Position => {
    if (!Array.isArray(p) || p.length !== rules.position_dimensions || p.some(n => typeof n !== 'number' || !Number.isFinite(n))
      || Math.abs(p[0]) > rules.longitude_limit || Math.abs(p[1]) > rules.latitude_limit) invalid();
    return [p[0], p[1]];
  });
  const vertexCount = points.length - Number(polygon);
  if (vertexCount < (polygon ? rules.min_polygon_vertices : rules.min_line_vertices)) invalid();
  if (polygon && !equal(points[0], points[points.length - 1])) invalid();
  for (let i = 1; i < points.length; i++) if (equal(points[i - 1], points[i]) || Math.abs(points[i][0] - points[i - 1][0]) > rules.longitude_limit) invalid();
  if (polygon) {
    const vertices = points.slice(0, -1);
    if (new Set(vertices.map(p => p.join(','))).size !== vertexCount) invalid();
    let twiceArea = 0;
    for (let i = 1; i < vertices.length - 1; i++) twiceArea += cross(vertices[0], vertices[i], vertices[i + 1]);
    if (twiceArea === 0) invalid();
    for (let i = 0; i < vertexCount; i++) {
      const j = (i + 1) % vertexCount;
      for (let k = i + 1; k < vertexCount; k++) {
        const l = (k + 1) % vertexCount;
        if (j !== k && l !== i && intersects(vertices[i], vertices[j], vertices[k], vertices[l])) invalid();
      }
      const a = vertices[(i + vertexCount - 1) % vertexCount], b = vertices[i], c = vertices[j];
      if (cross(a, b, c) === 0 && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0) invalid();
    }
  }
  const west = Math.min(...points.map(p => p[0])), east = Math.max(...points.map(p => p[0]));
  const south = Math.min(...points.map(p => p[1])), north = Math.max(...points.map(p => p[1]));
  const radians = Math.PI / 180;
  const areaM2 = rules.earth_radius_m ** 2 * ((east - west) * radians) * 2 * Math.cos(((north + south) / 2) * radians) * Math.sin(((north - south) / 2) * radians);
  if (areaM2 > rules.max_area_m2) invalid();
  return { geometry: { type: v.type, coordinates: polygon ? [points] : points } as GisGeometryShape,
    bounds: { west, south, east, north, crossesDateline: false }, areaM2, vertexCount };
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
