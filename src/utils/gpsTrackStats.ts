/**
 * Pure geometry/stats helpers for recorded GPS tracks: great-circle distance
 * (haversine), total track length, and duration. IO-free and unit-tested.
 * Shared by the GPS panel and any consumer that needs track summaries.
 */

import type { RecordedPoint } from '../types/gpsTrack';
import { isValidLatLng } from './coordinates';

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points in meters. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  if (![aLat, aLng, bLat, bLng].every((v) => Number.isFinite(v))) return 0;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cumulative path length of a track in meters. Invalid coordinates (non-finite
 * or out of WGS-84 range) are skipped before summing so one bad fix can't poison
 * the total -- distance is measured across the remaining valid points only.
 */
export function trackDistanceMeters(points: readonly RecordedPoint[]): number {
  if (!Array.isArray(points)) return 0;
  const valid = points.filter((p) => isValidLatLng(p.latitude, p.longitude));
  if (valid.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const curr = valid[i];
    total += haversineMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
  }
  return total;
}

/** Wall-clock duration of a track in ms (latest timestamp - earliest timestamp). */
export function trackDurationMs(points: readonly RecordedPoint[]): number {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const timestamps = points.map((p) => p.timestamp).filter(Number.isFinite);
  if (timestamps.length < 2) return 0;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

export interface TrackSummary {
  pointCount: number;
  distanceMeters: number;
  durationMs: number;
}

export function summarizeTrack(points: readonly RecordedPoint[]): TrackSummary {
  return {
    pointCount: Array.isArray(points) ? points.length : 0,
    distanceMeters: trackDistanceMeters(points),
    durationMs: trackDurationMs(points),
  };
}

/** Format a duration in ms as a compact `H:MM:SS` / `M:SS` string. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0:00';
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}
