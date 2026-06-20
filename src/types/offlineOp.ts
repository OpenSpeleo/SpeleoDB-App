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
 * Entity-agnostic on purpose: landmarks are the first (and currently only)
 * entity, but the base class + serialization shape are designed so future
 * objects can subclass `OfflineOp` without changing the store or the queue.
 *
 * See docs/offline-landmark-queue.md.
 */

import type { LandmarkApiObject } from './landmark';

export type OfflineEntityType = 'landmark';

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

/** Persisted shape of an op. Discriminated by `kind`. */
export interface SerializedOfflineOp {
  id: string;
  entityType: OfflineEntityType;
  kind: OfflineOpKind;
  seq: number;
  createdAt: number;
  status: OfflineOpStatus;
  lastError?: string;
  /** create: the optimistic landmark (carries a `local:<uuid>` temp id). */
  created?: LandmarkApiObject;
  /** update/delete: the server landmark id this op targets. */
  targetId?: string;
  /**
   * update/delete: last known server state (for conflict detection). `null`
   * when no reliable upstream snapshot was available at enqueue time.
   */
  baseline?: LandmarkSnapshot | null;
  /** update: the new values the user intends. */
  next?: LandmarkSnapshot;
}

/** One human-readable field change for the pending list + conflict UI. */
export interface OfflineOpFieldChange {
  field: keyof LandmarkSnapshot;
  label: string;
  from: string;
  to: string;
}

/** A view model for rendering an op in the pending list. */
export interface OfflineOpView {
  id: string;
  kind: OfflineOpKind;
  status: OfflineOpStatus;
  createdAt: number;
  /** Primary label, e.g. the landmark name. */
  title: string;
  /** Short summary, e.g. "New landmark" / "Edited name, latitude" / "Delete". */
  summary: string;
  /** Field-level changes (update only). */
  changes: OfflineOpFieldChange[];
  lastError?: string;
  /** Present when `status === 'conflict'`: the diverging local vs server state. */
  conflict?: OfflineOpConflict;
}

/**
 * The data the conflict modal needs: the user's intended local state and the
 * current server state, for an edit or a delete.
 */
export interface OfflineOpConflict {
  kind: 'update' | 'delete';
  title: string;
  /** Local intended snapshot (null when the op is a delete). */
  local: LandmarkSnapshot | null;
  /** Server snapshot (null when the server no longer has the landmark). */
  server: LandmarkSnapshot | null;
  /** Field rows for the diff table (only fields that differ). */
  rows: OfflineOpConflictRow[];
}

export interface OfflineOpConflictRow {
  field: keyof LandmarkSnapshot;
  label: string;
  local: string;
  server: string;
}

export type OfflineConflictChoice = 'local' | 'server';
