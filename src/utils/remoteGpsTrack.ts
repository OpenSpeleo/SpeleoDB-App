/**
 * Pure mapping from the SpeleoDB server GPS-track shape to the app's
 * `RemoteGpsTrack`.
 *
 * The list endpoint (`GET /api/v2/gps_tracks/`) returns bare objects shaped as
 * `{ id, name, color, file, sha256_hash, creation_date, modified_date }` where
 * `file` is a pre-signed GeoJSON URL and the dates are ISO-8601 strings. The
 * detail/PATCH endpoint omits `file`/`sha256_hash`. This helper tolerates both
 * and is null-safe so a malformed entry is skipped rather than crashing sync.
 */

import { normalizeHexColor } from './gpsTrackColors';
import type { RemoteGpsTrack } from '../types/gpsTrack';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseDate(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

/** Parse one server track object, or null when it lacks a usable id. */
export function parseRemoteGpsTrack(raw: unknown): RemoteGpsTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = asString(obj.id);
  if (!id) return null;
  return {
    id,
    name: asString(obj.name),
    color: normalizeHexColor(obj.color),
    fileUrl: asString(obj.file),
    sha256: asString(obj.sha256_hash),
    createdAt: parseDate(obj.creation_date),
    updatedAt: parseDate(obj.modified_date),
  };
}

/** Parse a server list payload into `RemoteGpsTrack[]`, dropping bad entries. */
export function parseRemoteGpsTracks(data: unknown): RemoteGpsTrack[] {
  if (!Array.isArray(data)) return [];
  const tracks: RemoteGpsTrack[] = [];
  for (const entry of data) {
    const track = parseRemoteGpsTrack(entry);
    if (track) tracks.push(track);
  }
  return tracks;
}
