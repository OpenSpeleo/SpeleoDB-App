/**
 * Rehydrate a persisted op back into its concrete `OfflineOp` subclass.
 *
 * Kept separate from the base class to avoid an import cycle (base <- subclass
 * <- factory). Returns `null` for malformed/unknown records so a corrupted
 * entry can be skipped rather than crashing queue load. Dispatches on
 * `entityType` (defaulting to `landmark` for records written before GPS tracks
 * joined the queue) then `kind`.
 */

import type { SerializedOfflineOp } from '../../types/offlineOp';
import type { OfflineOp } from './OfflineOp';
import { CreateLandmarkOp } from './CreateLandmarkOp';
import { UpdateLandmarkOp } from './UpdateLandmarkOp';
import { DeleteLandmarkOp } from './DeleteLandmarkOp';
import { CreateGpsTrackOp } from './CreateGpsTrackOp';
import { UpdateGpsTrackOp } from './UpdateGpsTrackOp';
import { DeleteGpsTrackOp } from './DeleteGpsTrackOp';

export function deserializeOfflineOp(raw: unknown): OfflineOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as SerializedOfflineOp;
  if (typeof record.id !== 'string' || typeof record.seq !== 'number') return null;

  const base = {
    id: record.id,
    seq: record.seq,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    status: record.status,
    lastError: record.lastError,
  };

  try {
    if (record.entityType === 'gpsTrack') {
      switch (record.kind) {
        case 'create':
          if (!record.createdGpsTrack || typeof record.createdGpsTrack.id !== 'string') return null;
          return new CreateGpsTrackOp({
            ...base,
            localTrackId: record.createdGpsTrack.id,
            name: record.createdGpsTrack.name ?? '',
            color: record.createdGpsTrack.color ?? '',
          });
        case 'update':
          if (!record.targetId || !record.gpsNext) return null;
          return new UpdateGpsTrackOp({
            ...base,
            targetId: record.targetId,
            baseline: record.gpsBaseline ?? null,
            next: record.gpsNext,
          });
        case 'delete':
          if (!record.targetId) return null;
          return new DeleteGpsTrackOp({
            ...base,
            targetId: record.targetId,
            baseline: record.gpsBaseline ?? null,
          });
        default:
          return null;
      }
    }

    // Default entity: landmark (covers records written before `entityType`).
    switch (record.kind) {
      case 'create':
        if (!record.created || typeof record.created.id !== 'string') return null;
        return new CreateLandmarkOp({ ...base, landmark: record.created });
      case 'update':
        if (!record.targetId || !record.next) return null;
        return new UpdateLandmarkOp({
          ...base,
          targetId: record.targetId,
          baseline: record.baseline ?? null,
          next: record.next,
        });
      case 'delete':
        if (!record.targetId) return null;
        return new DeleteLandmarkOp({
          ...base,
          targetId: record.targetId,
          baseline: record.baseline ?? null,
        });
      default:
        return null;
    }
  } catch {
    return null;
  }
}
