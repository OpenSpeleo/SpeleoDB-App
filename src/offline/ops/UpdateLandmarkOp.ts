/**
 * Queued offline "edit landmark" operation.
 *
 * Stores the target server id, the `baseline` (last known server state, used to
 * detect drift on replay), and `next` (the values the user intends). The fold
 * preserves display-only properties (collection name/color, permissions) from
 * the existing feature while overriding the editable fields.
 */

import type { LandmarkApiObject } from '../../types/landmark';
import type { LandmarkSnapshot, SerializedOfflineOp } from '../../types/offlineOp';
import { upsertLandmarkFeature } from '../../utils/landmarkMutations';
import { diffSnapshots, findLandmarkFeature } from '../landmarkSnapshot';
import { OfflineOp, type OfflineOpDescription, type OfflineOpInit } from './OfflineOp';

export class UpdateLandmarkOp extends OfflineOp {
  readonly kind = 'update' as const;
  targetId: string;
  /**
   * Last known server state ("footprint"). `null` means we never had a reliable
   * upstream snapshot, so no conflict can be claimed and the edit is pushed.
   */
  baseline: LandmarkSnapshot | null;
  next: LandmarkSnapshot;

  constructor(
    init: OfflineOpInit & {
      targetId: string;
      baseline: LandmarkSnapshot | null;
      next: LandmarkSnapshot;
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

  applyTo(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    const existing = findLandmarkFeature(collection, this.targetId);
    const props =
      existing && existing.properties && typeof existing.properties === 'object'
        ? (existing.properties as Record<string, unknown>)
        : {};
    const merged: LandmarkApiObject = {
      id: this.targetId,
      name: this.next.name,
      description: this.next.description,
      latitude: this.next.latitude,
      longitude: this.next.longitude,
      collection: this.next.collection ?? '',
      collection_name: typeof props.collection_name === 'string' ? props.collection_name : '',
      collection_color: typeof props.collection_color === 'string' ? props.collection_color : '',
      is_personal_collection: props.is_personal_collection === true,
      can_write: props.can_write !== false,
      can_delete: props.can_delete !== false,
    };
    return upsertLandmarkFeature(collection, merged);
  }

  describe(): OfflineOpDescription {
    const changes = this.baseline ? diffSnapshots(this.baseline, this.next) : [];
    const summary =
      changes.length === 0
        ? 'Edited landmark'
        : `Edited ${changes.map((change) => change.label.toLowerCase()).join(', ')}`;
    return {
      title: this.next.name || 'Untitled landmark',
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
      baseline: this.baseline,
      next: this.next,
    };
  }
}
