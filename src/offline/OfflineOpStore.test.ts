import { describe, it, expect, beforeEach } from 'vitest';
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
