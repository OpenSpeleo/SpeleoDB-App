/**
 * Types for the offline mutation queue.
 *
 * An OfflineOp is a single user mutation (create/edit/delete) that could not be
 * confirmed against the server at the time it was made -- either because the
 * app was offline-locked or because the request failed in a way that means
 * "not reachable" (transport error / timeout / 5xx). Ops are persisted, folded
 * optimistically over the cached server snapshot, and replayed when
 * connectivity returns.
 *
 * Entity-agnostic on purpose: landmarks were the first entity; GPS tracks are
 * the second. The base class + serialization shape are designed so any future
 * object can subclass `OfflineOp` and share the one queue + Pending page.
 *
 * See docs/offline-op-queue.md.
 */

import type { LandmarkApiObject } from './landmark';
import type { GpsTrackSnapshot } from './gpsTrack';

export type OfflineEntityType = 'landmark' | 'gpsTrack';

export type OfflineOpKind = 'create' | 'update' | 'delete';

/**
 * - `pending`  : queued, not yet attempted (or attempted and still reachable).
 * - `syncing`  : a replay attempt is in flight.
 * - `conflict` : the server state diverged from the op's baseline; needs the
 *                user to choose local vs server.
 * - `error`    : a definitive failure (e.g. 4xx) that the user must see.
 */
export type OfflineOpStatus = 'pending' | 'syncing' | 'conflict' | 'error';

/**
 * The comparable subset of a landmark. This is the "last known state" used to
 * detect whether the server changed underneath a queued edit/delete. The
 * landmarks GeoJSON does not carry `modified_date`, so we compare these fields
 * (canonicalized) rather than relying on a server timestamp.
 */
export interface LandmarkSnapshot {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  collection: string | null;
}

/** Persisted shape of an op. Discriminated by `entityType` + `kind`. */
export interface SerializedOfflineOp {
  id: string;
  entityType: OfflineEntityType;
  kind: OfflineOpKind;
  seq: number;
  createdAt: number;
  status: OfflineOpStatus;
  lastError?: string;
  // ---- landmark ----
  /** create: the optimistic landmark (carries a `local:<uuid>` temp id). */
  created?: LandmarkApiObject;
  /** update/delete: last known landmark server state (for conflict detection). */
  baseline?: LandmarkSnapshot | null;
  /** update: the new landmark values the user intends. */
  next?: LandmarkSnapshot;
  // ---- gps track ----
  /** create: the recorded local track being uploaded (id + display fields). */
  createdGpsTrack?: { id: string; name: string; color: string };
  /** update/delete: last known GPS-track server state (for conflict detection). */
  gpsBaseline?: GpsTrackSnapshot | null;
  /** update: the new GPS-track name/color the user intends. */
  gpsNext?: GpsTrackSnapshot;
  // ---- shared ----
  /** update/delete: the server entity id this op targets. */
  targetId?: string;
}

/** One human-readable field change for the pending list + conflict UI. */
export interface OfflineOpFieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

/** A view model for rendering an op in the pending list. */
export interface OfflineOpView {
  id: string;
  /** Which entity this op concerns (drives the pending-list label). */
  entityType?: OfflineEntityType;
  kind: OfflineOpKind;
  status: OfflineOpStatus;
  createdAt: number;
  /** Primary label, e.g. the landmark/track name. */
  title: string;
  /** Short summary, e.g. "New landmark" / "Edited name, color" / "Delete". */
  summary: string;
  /** Field-level changes (update only). */
  changes: OfflineOpFieldChange[];
  lastError?: string;
  /** Present when `status === 'conflict'`: the diverging local vs server state. */
  conflict?: OfflineOpConflict;
}

/**
 * The data the conflict modal needs: the user's intended local state and the
 * current server state, for an edit or a delete. Entity-agnostic: the modal
 * only reads `entityLabel`, `title`, `kind`, `server === null`, and `rows`.
 */
export interface OfflineOpConflict {
  kind: 'update' | 'delete';
  /** Human noun for the modal copy, e.g. "landmark" or "GPS track". */
  entityLabel?: string;
  title: string;
  /** Local intended snapshot (null when the op is a delete). */
  local?: unknown;
  /** Server snapshot (null when the server no longer has the entity). */
  server: unknown | null;
  /** Field rows for the diff table (only fields that differ). */
  rows: OfflineOpConflictRow[];
}

export interface OfflineOpConflictRow {
  field: string;
  label: string;
  local: string;
  server: string;
}

export type OfflineConflictChoice = 'local' | 'server';
