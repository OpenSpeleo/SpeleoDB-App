/**
 * OfflineOpStore -- durable persistence for the offline mutation queue.
 *
 * Each op is stored as its own record (keyed by op id) in the `offline_ops`
 * IndexedDB object store. Replacing a coalesced intent removes the old key and
 * writes the new record in one transaction, so failure or process death cannot
 * leave zero/two durable intents for one subject. Records survive app shutdown,
 * crash, and phone restart (IndexedDB is on-disk).
 *
 * The store deals in serialized op records; rehydration into concrete op
 * classes is the queue's job (via `deserializeOfflineOp`).
 *
 * See docs/offline-op-queue.md.
 */

import { CacheStore } from '../services/CacheStore';
import type { SerializedOfflineOp } from '../types/offlineOp';

const STORE_NAME = 'offline_ops';

export class OfflineOpStore {
  private store: CacheStore;

  constructor(store?: CacheStore) {
    this.store = store ?? new CacheStore();
  }

  /** Load all persisted ops, ordered by `seq` (chronological). */
  async list(): Promise<SerializedOfflineOp[]> {
    const entries = await this.store.getAll<SerializedOfflineOp>(STORE_NAME);
    const ops = entries
      .map((entry) => entry?.data)
      .filter((data): data is SerializedOfflineOp => Boolean(data && typeof data === 'object'));
    return ops.sort((a, b) => a.seq - b.seq);
  }

  /** Insert or replace a single op record. */
  async put(op: SerializedOfflineOp): Promise<boolean> {
    await this.store.set(STORE_NAME, op.id, { data: op, cachedAt: Date.now() });
    return true;
  }

  /** Atomically remove one operation and persist its replacement. */
  async replace(removedId: string, op: SerializedOfflineOp): Promise<boolean> {
    await this.store.replace(
      STORE_NAME,
      removedId,
      op.id,
      { data: op, cachedAt: Date.now() },
    );
    return true;
  }

  /** Remove a single op record by id. */
  async remove(id: string): Promise<boolean> {
    await this.store.delete(STORE_NAME, id);
    return true;
  }

  /** Wipe all persisted ops (e.g. on logout). */
  async clear(): Promise<void> {
    await this.store.clear(STORE_NAME);
  }
}
