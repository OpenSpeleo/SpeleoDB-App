/**
 * Queued offline "delete landmark" operation.
 *
 * Stores the target server id and the `baseline` (last known server state) so a
 * replay can detect whether the server changed the landmark since the user
 * decided to delete it (conflict).
 */

import type { LandmarkSnapshot, SerializedOfflineOp } from '../../types/offlineOp';
import { removeLandmarkFeature } from '../../utils/landmarkMutations';
import { OfflineOp, type OfflineOpDescription, type OfflineOpInit } from './OfflineOp';

export class DeleteLandmarkOp extends OfflineOp {
  readonly kind = 'delete' as const;
  targetId: string;
  /**
   * Last known server state ("footprint"). `null` means we never had a reliable
   * upstream snapshot, so no conflict can be claimed and the delete is pushed.
   */
  baseline: LandmarkSnapshot | null;

  constructor(init: OfflineOpInit & { targetId: string; baseline: LandmarkSnapshot | null }) {
    super(init);
    this.targetId = init.targetId;
    this.baseline = init.baseline;
  }

  subjectId(): string {
    return this.targetId;
  }

  applyTo(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    return removeLandmarkFeature(collection, this.targetId);
  }

  describe(): OfflineOpDescription {
    return {
      title: this.baseline?.name || 'Untitled landmark',
      summary: 'Delete landmark',
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
      baseline: this.baseline,
    };
  }
}
