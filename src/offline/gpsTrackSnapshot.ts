/**
 * Pure helpers for the "last known state" of a server GPS track.
 *
 * Mirrors `landmarkSnapshot.ts`: the offline queue stores a `GpsTrackSnapshot`
 * (the comparable fields -- name + color) as the baseline for each edit/delete.
 * On replay we re-pull the server track list, build a snapshot from it, and
 * compare: equal -> safe to push; different -> conflict.
 *
 * Kept free of React/network/storage so it is reused by the ops, the queue, and
 * the conflict UI. See docs/offline-op-queue.md.
 */

import type { GpsTrackSnapshot, RemoteGpsTrack } from '../types/gpsTrack';
import type { OfflineOpConflictRow, OfflineOpFieldChange } from '../types/offlineOp';
import { normalizeHexColor } from '../utils/gpsTrackColors';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Build the comparable snapshot from a server track. */
export function snapshotFromRemote(track: RemoteGpsTrack): GpsTrackSnapshot {
  return { name: asString(track.name), color: normalizeHexColor(track.color) };
}

/** Normalize an arbitrary `{name,color}` into a canonical snapshot. */
export function normalizeGpsTrackSnapshot(input: { name?: unknown; color?: unknown }): GpsTrackSnapshot {
  return { name: asString(input.name), color: normalizeHexColor(input.color) };
}

function canonicalize(snapshot: GpsTrackSnapshot): string {
  return JSON.stringify([snapshot.name, normalizeHexColor(snapshot.color)]);
}

/** Exact equality of two GPS-track snapshots. */
export function snapshotsEqual(a: GpsTrackSnapshot, b: GpsTrackSnapshot): boolean {
  return canonicalize(a) === canonicalize(b);
}

/** Find a server track by id within a list. */
export function findRemoteTrack(
  tracks: readonly RemoteGpsTrack[] | null | undefined,
  id: string,
): RemoteGpsTrack | null {
  if (!Array.isArray(tracks)) return null;
  return tracks.find((track) => track.id === id) ?? null;
}

const FIELD_LABELS: Record<keyof GpsTrackSnapshot, string> = {
  name: 'Name',
  color: 'Color',
};

const FIELDS: (keyof GpsTrackSnapshot)[] = ['name', 'color'];

function displayValue(field: keyof GpsTrackSnapshot, snapshot: GpsTrackSnapshot): string {
  const value = snapshot[field];
  if (value === '' || value === null || value === undefined) return '\u2014';
  return String(value);
}

/** Human-readable field changes between two snapshots (only those that differ). */
export function diffSnapshots(from: GpsTrackSnapshot, to: GpsTrackSnapshot): OfflineOpFieldChange[] {
  const changes: OfflineOpFieldChange[] = [];
  for (const field of FIELDS) {
    const before = displayValue(field, from);
    const after = displayValue(field, to);
    if (before !== after) {
      changes.push({ field, label: FIELD_LABELS[field], from: before, to: after });
    }
  }
  return changes;
}

/** Conflict diff rows (local vs server) for the conflict modal. */
export function conflictRows(
  local: GpsTrackSnapshot | null,
  server: GpsTrackSnapshot | null,
): OfflineOpConflictRow[] {
  const rows: OfflineOpConflictRow[] = [];
  for (const field of FIELDS) {
    const localValue = local ? displayValue(field, local) : '\u2014';
    const serverValue = server ? displayValue(field, server) : '\u2014';
    if (localValue !== serverValue) {
      rows.push({ field, label: FIELD_LABELS[field], local: localValue, server: serverValue });
    }
  }
  return rows;
}
