/**
 * Queued offline "delete GPS track" operation for a server track. Mirrors
 * `DeleteLandmarkOp`: stores the target server id and the `baseline` so a replay
 * can detect whether the track changed on the server since the user decided to
 * delete it (conflict). The fold removes the matching track from the cached
 * server list.
 */

import type { GpsTrackSnapshot, RemoteGpsTrack } from '../../types/gpsTrack';
import type { SerializedOfflineOp } from '../../types/offlineOp';
import { OfflineOp, type OfflineOpDescription, type OfflineOpInit } from './OfflineOp';

export class DeleteGpsTrackOp extends OfflineOp {
  readonly entityType = 'gpsTrack' as const;
  readonly kind = 'delete' as const;
  targetId: string;
  baseline: GpsTrackSnapshot | null;

  constructor(init: OfflineOpInit & { targetId: string; baseline: GpsTrackSnapshot | null }) {
    super(init);
    this.targetId = init.targetId;
    this.baseline = init.baseline;
  }

  subjectId(): string {
    return this.targetId;
  }

  applyToTrackList(tracks: RemoteGpsTrack[]): RemoteGpsTrack[] {
    return tracks.filter((track) => track.id !== this.targetId);
  }

  describe(): OfflineOpDescription {
    return {
      title: this.baseline?.name || 'GPS track',
      summary: 'Delete GPS track',
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
      targetId: this.targetId,
      gpsBaseline: this.baseline,
    };
  }
}
