import { featureCollection, lineString, point } from '@turf/helpers';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { GpsTrackUploadStatus, LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import { isValidLatLng } from './coordinates';

export interface GpsTrackLineProperties {
  id?: string;
  name?: string;
  createdAt?: number;
  updatedAt?: number;
  uploadStatus?: GpsTrackUploadStatus;
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

export function gpsTrackToLineStringFeature(
  track: LocalGpsTrack,
): Feature<LineString, GpsTrackLineProperties> | null {
  return trackPointsToLineStringFeature(track.points, {
    id: track.id,
    name: track.name,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt,
    uploadStatus: track.uploadStatus,
  });
}

export function gpsTracksToFeatureCollection(
  tracks: readonly LocalGpsTrack[],
): FeatureCollection<LineString, GpsTrackLineProperties> {
  return featureCollection(
    tracks.flatMap((track) => {
      const feature = gpsTrackToLineStringFeature(track);
      return feature ? [feature] : [];
    }),
  );
}

export function trackPointsToFeatureCollection(
  points: readonly RecordedPoint[],
  properties: Partial<Omit<GpsTrackLineProperties, 'pointCount'>> = {},
): FeatureCollection<LineString, GpsTrackLineProperties> {
  const feature = trackPointsToLineStringFeature(points, properties);
  return featureCollection(feature ? [feature] : []);
}
