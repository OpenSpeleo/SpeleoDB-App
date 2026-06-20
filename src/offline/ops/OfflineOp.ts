/**
 * `OfflineOp` -- abstract base for every queued offline mutation.
 *
 * Each concrete CRUD operation (create/update/delete a landmark today; other
 * entities later) subclasses this. The base intentionally owns only the data
 * + the three pure capabilities the queue and UI need:
 *
 *  - `applyTo(fc)`   : fold this op over a FeatureCollection (optimistic view).
 *  - `describe()`    : human-readable summary for the pending list.
 *  - `serialize()`   : persistable shape.
 *
 * Network replay + conflict detection live in `OfflineOpQueue`, not on the op,
 * so the ops stay free of HTTP and are trivially testable. The queue switches
 * on `kind` and uses each op's `subjectId()` / baseline to drive replay.
 *
 * See docs/offline-landmark-queue.md.
 */

import type {
  OfflineEntityType,
  OfflineOpFieldChange,
  OfflineOpKind,
  OfflineOpStatus,
  SerializedOfflineOp,
} from '../../types/offlineOp';

/** Temp id prefix for a landmark created offline (no server id yet). */
export const LOCAL_ID_PREFIX = 'local:';

export function isLocalLandmarkId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_ID_PREFIX);
}

/** Generate a `local:<uuid>` temp id. Falls back when crypto.randomUUID is absent. */
export function generateLocalLandmarkId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${LOCAL_ID_PREFIX}${cryptoObj.randomUUID()}`;
  }
  const rand = Math.random().toString(36).slice(2);
  return `${LOCAL_ID_PREFIX}${Date.now().toString(36)}-${rand}`;
}

export interface OfflineOpDescription {
  title: string;
  summary: string;
  changes: OfflineOpFieldChange[];
}

export interface OfflineOpInit {
  id: string;
  seq: number;
  createdAt: number;
  status?: OfflineOpStatus;
  lastError?: string;
}

export abstract class OfflineOp {
  readonly entityType: OfflineEntityType = 'landmark';
  abstract readonly kind: OfflineOpKind;

  id: string;
  seq: number;
  createdAt: number;
  status: OfflineOpStatus;
  lastError?: string;

  constructor(init: OfflineOpInit) {
    this.id = init.id;
    this.seq = init.seq;
    this.createdAt = init.createdAt;
    this.status = init.status ?? 'pending';
    this.lastError = init.lastError;
  }

  /** The landmark id this op concerns (temp `local:` id for an offline create). */
  abstract subjectId(): string;

  /** True when the subject is a landmark created offline (not yet on the server). */
  isLocalSubject(): boolean {
    return isLocalLandmarkId(this.subjectId());
  }

  /** Immutably fold this op over a landmarks FeatureCollection. */
  abstract applyTo(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection;

  /** Human-readable summary for the pending list. */
  abstract describe(): OfflineOpDescription;

  /** Persistable shape. */
  abstract serialize(): SerializedOfflineOp;
}
