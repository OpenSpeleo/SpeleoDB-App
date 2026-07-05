import type { RecordedPoint } from '../types/gpsTrack';
import type { UserMapLocation } from '../types/userLocation';
import { isValidLatLng } from './coordinates';

export function toUserMapLocation(
  longitude: number,
  latitude: number,
): UserMapLocation | null {
  return isValidLatLng(latitude, longitude) ? { lng: longitude, lat: latitude } : null;
}

export function latestValidRecordingLocation(
  points: readonly RecordedPoint[],
): UserMapLocation | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    const location = toUserMapLocation(point.longitude, point.latitude);
    if (location) return location;
  }
  return null;
}

export function selectUserMapLocation(
  liveLocation: UserMapLocation | null,
  recordingLocation: UserMapLocation | null,
): UserMapLocation | null {
  return liveLocation ?? recordingLocation;
}

export function normalizeHeading(degrees: number): number | null {
  if (!Number.isFinite(degrees)) return null;
  return ((degrees % 360) + 360) % 360;
}

export function unwrapHeading(previous: number | null, next: number): number {
  const normalized = normalizeHeading(next);
  if (normalized === null || previous === null) return normalized ?? 0;
  const previousNormalized = normalizeHeading(previous) ?? 0;
  let delta = normalized - previousNormalized;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return previous + delta;
}
