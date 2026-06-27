/**
 * Queued offline "create GPS track" operation == an upload of a recorded local
 * track as GPX.
 *
 * Holds the recorded local track id (plus its display name/color) so the queue
 * can build the GPX and upload it on replay. The recorded points themselves
 * stay in the `gps_tracks` store (force-quit safe); on a successful upload the
 * local copy is deleted and the server track is synced in. There is no conflict
 * path: the server dedupes GPX imports by file sha256, so a re-upload is
 * idempotent.
 *
 * See docs/offline-op-queue.md and docs/gps-tracks.md.
 */

import type { SerializedOfflineOp } from '../../types/offlineOp';
import { OfflineOp, type OfflineOpDescription, type OfflineOpInit } from './OfflineOp';

export class CreateGpsTrackOp extends OfflineOp {
  readonly entityType = 'gpsTrack' as const;
  readonly kind = 'create' as const;
  /** The recorded local track id this upload concerns. */
  localTrackId: string;
  name: string;
  color: string;

  constructor(init: OfflineOpInit & { localTrackId: string; name: string; color: string }) {
    super(init);
    this.localTrackId = init.localTrackId;
    this.name = init.name;
    this.color = init.color;
  }

  subjectId(): string {
    return this.localTrackId;
  }

  describe(): OfflineOpDescription {
    return {
      title: this.name || 'GPS track',
      summary: 'Upload GPS track',
      changes: [],
    };
  }

  serialize(): SerializedOfflineOp {
    return {
      id: this.id,
      entityType: this.entityType,
      kind: this.kind,
      seq: this.seq,
      createdAt: this.createdAt,
      status: this.status,
      lastError: this.lastError,
      createdGpsTrack: { id: this.localTrackId, name: this.name, color: this.color },
    };
  }
}
