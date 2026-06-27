import { featureCollection, lineString, point } from '@turf/helpers';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { GpsTrackOrigin, RecordedPoint } from '../types/gpsTrack';
import { isValidLatLng } from './coordinates';

export interface GpsTrackLineProperties {
  id?: string;
  name?: string;
  /** Hex color used for the map line (data-driven `line-color`). */
  color?: string;
  origin?: GpsTrackOrigin;
  createdAt?: number;
  updatedAt?: number;
  pointCount: number;
}

export interface GpsTrackPointProperties {
  timestamp: number;
  accuracy?: number | null;
  altitudeAccuracy?: number | null;
}

function isValidCoordinate(point: RecordedPoint): boolean {
  return isValidLatLng(point.latitude, point.longitude);
}

function positionFromRecordedPoint(recordedPoint: RecordedPoint): [number, number] | [number, number, number] {
  const base: [number, number] = [recordedPoint.longitude, recordedPoint.latitude];
  return typeof recordedPoint.altitude === 'number' && Number.isFinite(recordedPoint.altitude)
    ? [base[0], base[1], recordedPoint.altitude]
    : base;
}

export function recordedPointToPointFeature(
  recordedPoint: RecordedPoint,
): Feature<Point, GpsTrackPointProperties> | null {
  if (!isValidCoordinate(recordedPoint)) return null;
  return point(
    positionFromRecordedPoint(recordedPoint),
    {
      timestamp: recordedPoint.timestamp,
      accuracy: recordedPoint.accuracy ?? null,
      altitudeAccuracy: recordedPoint.altitudeAccuracy ?? null,
    },
  );
}

export function trackPointsToLineStringFeature(
  points: readonly RecordedPoint[],
  properties: Partial<Omit<GpsTrackLineProperties, 'pointCount'>> = {},
): Feature<LineString, GpsTrackLineProperties> | null {
  const coordinates = points.filter(isValidCoordinate).map(positionFromRecordedPoint);
  if (coordinates.length < 2) return null;
  return lineString(coordinates, {
    ...properties,
    pointCount: coordinates.length,
  });
}

export function trackPointsToFeatureCollection(
  points: readonly RecordedPoint[],
  properties: Partial<Omit<GpsTrackLineProperties, 'pointCount'>> = {},
): FeatureCollection<LineString, GpsTrackLineProperties> {
  const feature = trackPointsToLineStringFeature(points, properties);
  return featureCollection(feature ? [feature] : []);
}

function pushLineStringPoints(coordinates: unknown, out: RecordedPoint[]): void {
  if (!Array.isArray(coordinates)) return;
  for (const position of coordinates) {
    if (!Array.isArray(position) || position.length < 2) continue;
    const [lon, lat, ele] = position;
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    if (!isValidLatLng(lat, lon)) continue;
    out.push({
      latitude: lat,
      longitude: lon,
      altitude: typeof ele === 'number' && Number.isFinite(ele) ? ele : null,
      timestamp: 0,
    });
  }
}

/**
 * Flatten a downloaded GPS-track GeoJSON FeatureCollection (one or more
 * LineString / MultiLineString features) into `RecordedPoint[]`. Server tracks
 * carry no per-point timestamps, so timestamps are 0; this is used for map
 * display, distance stats and GPX re-export of a remote track.
 */
export function gpsTrackGeoJsonToPoints(geojson: unknown): RecordedPoint[] {
  const points: RecordedPoint[] = [];
  if (!geojson || typeof geojson !== 'object') return points;
  const collection = geojson as { type?: unknown; features?: unknown; geometry?: unknown };
  const features = Array.isArray(collection.features) ? collection.features : [];
  const geometries =
    features.length > 0
      ? features.map((f) => (f && typeof f === 'object' ? (f as { geometry?: unknown }).geometry : null))
      : [collection.geometry ?? null];
  for (const geometry of geometries) {
    if (!geometry || typeof geometry !== 'object') continue;
    const geom = geometry as { type?: unknown; coordinates?: unknown };
    if (geom.type === 'LineString') {
      pushLineStringPoints(geom.coordinates, points);
    } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      for (const segment of geom.coordinates) {
        pushLineStringPoints(segment, points);
      }
    }
  }
  return points;
}
