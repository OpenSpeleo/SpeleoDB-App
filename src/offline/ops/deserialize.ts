/**
 * Rehydrate a persisted op back into its concrete `OfflineOp` subclass.
 *
 * Kept separate from the base class to avoid an import cycle (base <- subclass
 * <- factory). Returns `null` for malformed/unknown records so a corrupted
 * entry can be skipped rather than crashing queue load.
 */

import type { SerializedOfflineOp } from '../../types/offlineOp';
import type { OfflineOp } from './OfflineOp';
import { CreateLandmarkOp } from './CreateLandmarkOp';
import { UpdateLandmarkOp } from './UpdateLandmarkOp';
import { DeleteLandmarkOp } from './DeleteLandmarkOp';

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
