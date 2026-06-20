/**
 * Queued offline "create landmark" operation.
 *
 * Holds a fully-formed optimistic `LandmarkApiObject` carrying a `local:<uuid>`
 * temp id so the map/panel can render it immediately. On replay the queue POSTs
 * it, captures the real server id, and rewrites any later ops that targeted the
 * temp id.
 */

import type { LandmarkApiObject } from '../../types/landmark';
import type { SerializedOfflineOp } from '../../types/offlineOp';
import { upsertLandmarkFeature } from '../../utils/landmarkMutations';
import { normalizeCollection } from '../landmarkSnapshot';
import { OfflineOp, type OfflineOpDescription, type OfflineOpInit } from './OfflineOp';

export class CreateLandmarkOp extends OfflineOp {
  readonly kind = 'create' as const;
  /** The optimistic landmark (temp id, display props resolved at enqueue time). */
  landmark: LandmarkApiObject;

  constructor(init: OfflineOpInit & { landmark: LandmarkApiObject }) {
    super(init);
    this.landmark = init.landmark;
  }

  subjectId(): string {
    return this.landmark.id;
  }

  applyTo(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    return upsertLandmarkFeature(collection, this.landmark);
  }

  describe(): OfflineOpDescription {
    const collection = normalizeCollection(this.landmark.collection);
    const where =
      this.landmark.collection_name && collection
        ? this.landmark.collection_name
        : 'Personal Landmarks';
    return {
      title: this.landmark.name || 'Untitled landmark',
      summary: `New landmark in ${where}`,
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
      created: this.landmark,
    };
  }
}
