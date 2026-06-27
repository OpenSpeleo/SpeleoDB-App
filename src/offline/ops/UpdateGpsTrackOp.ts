/**
 * Queued offline "edit GPS track" operation (name and/or color of a server
 * track). Mirrors `UpdateLandmarkOp`: stores the target server id, the
 * `baseline` (last known server state for conflict detection) and `next` (the
 * intended values). The fold replaces name/color of the matching track in the
 * cached server list.
 */

import type { GpsTrackSnapshot, RemoteGpsTrack } from '../../types/gpsTrack';
import type { SerializedOfflineOp } from '../../types/offlineOp';
import { diffSnapshots } from '../gpsTrackSnapshot';
import { OfflineOp, type OfflineOpDescription, type OfflineOpInit } from './OfflineOp';

export class UpdateGpsTrackOp extends OfflineOp {
  readonly entityType = 'gpsTrack' as const;
  readonly kind = 'update' as const;
  targetId: string;
  /** Last known server state. `null` => no reliable baseline, so push without conflict. */
  baseline: GpsTrackSnapshot | null;
  next: GpsTrackSnapshot;

  constructor(
    init: OfflineOpInit & {
      targetId: string;
      baseline: GpsTrackSnapshot | null;
      next: GpsTrackSnapshot;
    },
  ) {
    super(init);
    this.targetId = init.targetId;
    this.baseline = init.baseline;
    this.next = init.next;
  }

  subjectId(): string {
    return this.targetId;
  }

  applyToTrackList(tracks: RemoteGpsTrack[]): RemoteGpsTrack[] {
    let found = false;
    const next = tracks.map((track) => {
      if (track.id !== this.targetId) return track;
      found = true;
      return { ...track, name: this.next.name, color: this.next.color };
    });
    return found ? next : tracks;
  }

  describe(): OfflineOpDescription {
    const changes = this.baseline ? diffSnapshots(this.baseline, this.next) : [];
    const summary =
      changes.length === 0
        ? 'Edited GPS track'
        : `Edited ${changes.map((change) => change.label.toLowerCase()).join(', ')}`;
    return {
      title: this.next.name || 'GPS track',
      summary,
      changes,
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
      gpsNext: this.next,
    };
  }
}
