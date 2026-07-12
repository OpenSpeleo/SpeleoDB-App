import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OfflineOpStore } from './OfflineOpStore';
import { CacheStore } from '../services/CacheStore';
import { ProjectCacheService } from '../services/ProjectCacheService';
import type { SerializedOfflineOp } from '../types/offlineOp';

function createOp(id: string, seq: number): SerializedOfflineOp {
  return {
    id,
    entityType: 'landmark',
    kind: 'create',
    seq,
    createdAt: 1000 + seq,
    status: 'pending',
    created: {
      id: `local:${id}`,
      name: `Op ${id}`,
      description: '',
      latitude: 1,
      longitude: 2,
      collection: '',
    },
  };
}

describe('OfflineOpStore', () => {
  let store: OfflineOpStore;

  beforeEach(async () => {
    store = new OfflineOpStore();
    await store.clear();
  });

  it('persists ops and returns them ordered by seq', async () => {
    await store.put(createOp('b', 2));
    await store.put(createOp('a', 1));
    await store.put(createOp('c', 3));

    const list = await store.list();
    expect(list.map((op) => op.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces an op on put with the same id', async () => {
    await store.put(createOp('a', 1));
    await store.put({ ...createOp('a', 1), status: 'error', lastError: 'boom' });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('error');
  });

  it('atomically replaces an old operation id with a new record', async () => {
    await store.put(createOp('old', 1));

    await store.replace('old', createOp('new', 2));

    const reopened = new OfflineOpStore(new CacheStore());
    expect((await reopened.list()).map((op) => op.id)).toEqual(['new']);
  });

  it('preserves the old operation after an aborted replacement transaction', async () => {
    await store.put(createOp('old', 1));
    const originalPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
      this.transaction.abort();
      return request;
    });

    try {
      await expect(store.replace('old', createOp('new', 2))).rejects.toThrow(/aborted/i);
    } finally {
      putSpy.mockRestore();
    }

    const reopened = new OfflineOpStore(new CacheStore());
    expect((await reopened.list()).map((op) => op.id)).toEqual(['old']);
  });

  it('removes a single op and clears all', async () => {
    await store.put(createOp('a', 1));
    await store.put(createOp('b', 2));
    await store.remove('a');
    expect((await store.list()).map((op) => op.id)).toEqual(['b']);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('survives a fresh store instance (durable on-disk persistence)', async () => {
    await store.put(createOp('a', 1));
    const reopened = new OfflineOpStore(new CacheStore());
    expect((await reopened.list()).map((op) => op.id)).toEqual(['a']);
  });

  it('is cleared by ProjectCacheService.clearAll (logout purge)', async () => {
    await store.put(createOp('a', 1));
    const cache = new ProjectCacheService();
    await cache.clearAll();
    expect(await store.list()).toEqual([]);
  });
});
