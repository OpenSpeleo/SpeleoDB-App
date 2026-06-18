import { beforeEach, describe, expect, it } from 'vitest';
import { TileCacheCapacityError, TileCacheMaintenanceService } from './TileCacheMaintenanceService';
import {
  __clearTileCacheRepositoryForTests,
  getTile,
  getTileMetadata,
  getTileCacheStats,
  upsertTile,
} from './TileCacheRepository';

async function resetTileDatabase(): Promise<void> {
  await __clearTileCacheRepositoryForTests();
}

function createBuffer(size: number): ArrayBuffer {
  return new Uint8Array(size).buffer;
}

describe('TileCacheMaintenanceService', () => {
  beforeEach(async () => {
    await resetTileDatabase();
  });

  it('evicts oldest unpinned tiles first to satisfy capacity', async () => {
    await upsertTile('tile-a', createBuffer(50), {
      pinnedByAutoPrefetch: false,
      now: 100,
    });
    await upsertTile('tile-b', createBuffer(50), {
      pinnedByAutoPrefetch: false,
      now: 200,
    });
    await upsertTile('tile-c', createBuffer(50), {
      pinnedByAutoPrefetch: true,
      now: 300,
    });

    const service = new TileCacheMaintenanceService({
      isOnline: () => true,
      now: () => 400,
      maxCacheBytes: 120,
    });

    const result = await service.ensureCapacityBeforeWrite('tile-d', 40);
    expect(result.evictedTileCount).toBe(2);
    expect(result.freedBytes).toBe(100);

    expect(await getTile('tile-a')).toBeNull();
    expect(await getTile('tile-b')).toBeNull();
    expect(await getTile('tile-c')).not.toBeNull();
  });

  it('bumps access time for pinned tiles at startup', async () => {
    await upsertTile('tile-pinned', createBuffer(20), {
      pinnedByAutoPrefetch: true,
      now: 100,
    });
    await upsertTile('tile-regular', createBuffer(20), {
      pinnedByAutoPrefetch: false,
      now: 200,
    });

    const service = new TileCacheMaintenanceService({
      isOnline: () => false,
      now: () => 9999,
      maxCacheBytes: 100,
    });
    await service.runStartupMaintenance();

    const pinned = await getTileMetadata('tile-pinned');
    const regular = await getTileMetadata('tile-regular');
    expect(pinned?.lastAccessedAt).toBe(9999);
    expect(regular?.lastAccessedAt).toBe(200);
  });

  it('does not prune while offline', async () => {
    await upsertTile('tile-a', createBuffer(60), {
      pinnedByAutoPrefetch: false,
      now: 100,
    });
    await upsertTile('tile-b', createBuffer(60), {
      pinnedByAutoPrefetch: false,
      now: 200,
    });

    const service = new TileCacheMaintenanceService({
      isOnline: () => false,
      now: () => 300,
      maxCacheBytes: 100,
    });
    const result = await service.pruneToLimit();

    expect(result.evictedTileCount).toBe(0);
    expect(await getTile('tile-a')).not.toBeNull();
    expect(await getTile('tile-b')).not.toBeNull();
  });

  it('throws when only pinned tiles can be removed', async () => {
    await upsertTile('tile-a', createBuffer(60), {
      pinnedByAutoPrefetch: true,
      now: 100,
    });
    await upsertTile('tile-b', createBuffer(60), {
      pinnedByAutoPrefetch: true,
      now: 200,
    });

    const service = new TileCacheMaintenanceService({
      isOnline: () => true,
      now: () => 300,
      maxCacheBytes: 100,
    });

    await expect(
      service.ensureCapacityBeforeWrite('tile-c', 10),
    ).rejects.toBeInstanceOf(TileCacheCapacityError);

    const stats = await getTileCacheStats();
    expect(stats.totalBytes).toBe(120);
    expect(stats.pinnedTileCount).toBe(2);
  });

  it('permits overflow instead of throwing when allowOverLimit is approved', async () => {
    await upsertTile('tile-a', createBuffer(60), {
      pinnedByAutoPrefetch: true,
      now: 100,
    });
    await upsertTile('tile-b', createBuffer(60), {
      pinnedByAutoPrefetch: true,
      now: 200,
    });

    const service = new TileCacheMaintenanceService({
      isOnline: () => true,
      now: () => 300,
      maxCacheBytes: 100,
      allowOverLimit: () => true,
    });

    // The pinned tiles cannot be evicted, but approval allows the write through.
    const result = await service.ensureCapacityBeforeWrite('tile-c', 10);
    expect(result.evictedTileCount).toBe(0);
    expect(result.freedBytes).toBe(0);

    const stats = await getTileCacheStats();
    expect(stats.totalBytes).toBe(120);
  });

  it('still evicts unpinned tiles opportunistically even when overflow is approved', async () => {
    await upsertTile('tile-old', createBuffer(40), {
      pinnedByAutoPrefetch: false,
      now: 100,
    });
    await upsertTile('tile-pinned', createBuffer(70), {
      pinnedByAutoPrefetch: true,
      now: 200,
    });

    const service = new TileCacheMaintenanceService({
      isOnline: () => true,
      now: () => 300,
      maxCacheBytes: 100,
      allowOverLimit: () => true,
    });

    // 110 existing + 30 incoming = 140, must free 40; the only unpinned tile is
    // reclaimed and the write proceeds without throwing.
    const result = await service.ensureCapacityBeforeWrite('tile-new', 30);
    expect(result.evictedTileCount).toBe(1);
    expect(await getTile('tile-old')).toBeNull();
    expect(await getTile('tile-pinned')).not.toBeNull();
  });
});
