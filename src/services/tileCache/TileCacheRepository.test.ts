import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  TILE_DB_NAME,
  TILE_STORE,
  PREFETCH_JOB_STORE,
  TILE_METADATA_STORE,
  TILE_OWNER_STORE,
  TILE_STATS_STORE,
  OFFLINE_MAP_PLAN_STORE,
  OFFLINE_MAP_PLAN_CHUNK_STORE,
  OFFLINE_MAP_PLAN_COORDINATE_STORE,
  OFFLINE_MAP_GENERATION_STORE,
  OFFLINE_MAP_MEMBERSHIP_STORE,
  __resetTileCacheRepositoryForTests,
  __closeTileCacheRepositoryForTests,
  __seedTileCacheEntryForTests,
  deleteTilesByUrlPrefixes,
  claimCachedTilesForOfflineGeneration,
  activateOfflineMapGeneration,
  commitOfflineMapPlan,
  countStagedOfflineMapCoordinates,
  deleteStagedOfflineMapCoordinates,
  getTile,
  getTileCacheStats,
  getTileMetadata,
  getOfflineMapGenerations,
  getOfflineMapPlanByRevision,
  getOfflineMapPlanById,
  getOfflineMapPlanChunk,
  getStagedOfflineMapCoordinatePage,
  openTileDB,
  garbageCollectOfflineMapPlans,
  normalizeOfflineMapGenerationCounters,
  recoverOfflineMapPlanStorage,
  repairTileCacheStats,
  releaseOfflineMapGeneration,
  runOfflineMapV7Migration,
  setOfflineMapGeneration,
  putOfflineMapPlanChunk,
  stageOfflineMapCoordinates,
  writeNoDataTile,
  writeTileWithCapacity,
} from './TileCacheRepository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(TILE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** Seed a legacy (v3) database with a bare-keyed prefetch job (no layerId). */
function seedLegacyV3Database(legacyJob: Record<string, unknown>, bareKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TILE_DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) db.createObjectStore(TILE_STORE);
      if (!db.objectStoreNames.contains(PREFETCH_JOB_STORE)) db.createObjectStore(PREFETCH_JOB_STORE);
      if (!db.objectStoreNames.contains(TILE_METADATA_STORE)) db.createObjectStore(TILE_METADATA_STORE);
      if (!db.objectStoreNames.contains(TILE_STATS_STORE)) db.createObjectStore(TILE_STATS_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(PREFETCH_JOB_STORE, 'readwrite');
      tx.objectStore(PREFETCH_JOB_STORE).put(legacyJob, bareKey);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function seedLegacyV4Tile(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TILE_DB_NAME, 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) db.createObjectStore(TILE_STORE);
      if (!db.objectStoreNames.contains(PREFETCH_JOB_STORE)) db.createObjectStore(PREFETCH_JOB_STORE);
      if (!db.objectStoreNames.contains(TILE_METADATA_STORE)) db.createObjectStore(TILE_METADATA_STORE);
      if (!db.objectStoreNames.contains(TILE_STATS_STORE)) db.createObjectStore(TILE_STATS_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(
        [TILE_STORE, TILE_METADATA_STORE, TILE_STATS_STORE],
        'readwrite',
      );
      tx.objectStore(TILE_STORE).put(new ArrayBuffer(25), url);
      tx.objectStore(TILE_METADATA_STORE).put({
        url,
        sizeBytes: 25,
        lastAccessedAt: 10,
        pinnedByAutoPrefetch: false,
        createdAt: 10,
        updatedAt: 10,
      }, url);
      tx.objectStore(TILE_STATS_STORE).put({
        totalBytes: 999,
        tileCount: 99,
        pinnedBytes: 0,
        pinnedTileCount: 0,
        updatedAt: 10,
      }, 'global');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function seedBrokenV5Tile(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TILE_DB_NAME, 5);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) db.createObjectStore(TILE_STORE);
      if (!db.objectStoreNames.contains(PREFETCH_JOB_STORE)) db.createObjectStore(PREFETCH_JOB_STORE);
      if (!db.objectStoreNames.contains(TILE_METADATA_STORE)) db.createObjectStore(TILE_METADATA_STORE);
      if (!db.objectStoreNames.contains(TILE_STATS_STORE)) db.createObjectStore(TILE_STATS_STORE);
      if (!db.objectStoreNames.contains(TILE_OWNER_STORE)) db.createObjectStore(TILE_OWNER_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(
        [TILE_STORE, TILE_METADATA_STORE, TILE_STATS_STORE],
        'readwrite',
      );
      tx.objectStore(TILE_STORE).put(new ArrayBuffer(25), url);
      tx.objectStore(TILE_METADATA_STORE).put({
        url,
        sizeBytes: 25,
        fetchedAt: 0,
        lastAccessedAt: 10,
        prefetchOwnerCount: 0,
        pinnedByAutoPrefetch: false,
        createdAt: 10,
        updatedAt: 10,
      }, url);
      tx.objectStore(TILE_STATS_STORE).put({
        totalBytes: 25,
        tileCount: 1,
        pinnedBytes: 0,
        pinnedTileCount: 0,
        updatedAt: 10,
      }, 'global');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function seedLegacyV6Ownership(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TILE_DB_NAME, 6);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) db.createObjectStore(TILE_STORE);
      if (!db.objectStoreNames.contains(PREFETCH_JOB_STORE)) db.createObjectStore(PREFETCH_JOB_STORE);
      if (!db.objectStoreNames.contains(TILE_METADATA_STORE)) db.createObjectStore(TILE_METADATA_STORE);
      if (!db.objectStoreNames.contains(TILE_STATS_STORE)) db.createObjectStore(TILE_STATS_STORE);
      if (!db.objectStoreNames.contains(TILE_OWNER_STORE)) db.createObjectStore(TILE_OWNER_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(
        [TILE_STORE, TILE_METADATA_STORE, TILE_STATS_STORE, TILE_OWNER_STORE],
        'readwrite',
      );
      tx.objectStore(TILE_STORE).put(new ArrayBuffer(25), url);
      tx.objectStore(TILE_METADATA_STORE).put({
        url,
        sizeBytes: 25,
        fetchedAt: 0,
        lastAccessedAt: 10,
        prefetchOwnerCount: 2,
        pinnedByAutoPrefetch: true,
        createdAt: 10,
        updatedAt: 10,
      }, url);
      tx.objectStore(TILE_STATS_STORE).put({
        totalBytes: 25,
        tileCount: 1,
        pinnedBytes: 25,
        pinnedTileCount: 1,
        updatedAt: 10,
      }, 'global');
      const ownerStore = tx.objectStore(TILE_OWNER_STORE);
      ownerStore.put({
        ownerKey: 'esri-satellite::project::p1',
        generation: 1,
        url,
        updatedAt: 10,
      }, `a\u0000${url}`);
      ownerStore.put({
        ownerKey: 'esri-satellite::landmarks::landmarks',
        generation: 2,
        url,
        updatedAt: 10,
      }, `b\u0000${url}`);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('TileCacheRepository', () => {
  beforeEach(async () => {
    await __closeTileCacheRepositoryForTests();
    await deleteDatabase();
    __resetTileCacheRepositoryForTests();
  });

  describe('v8 offline-map model', () => {
    it('persists compact immutable plans and their coordinate chunks', async () => {
      await openTileDB();
      await putOfflineMapPlanChunk({
        planId: 'plan-1',
        index: 0,
        coordinates: new Uint32Array([1, 2, 3, 4, 5, 6]),
      });
      await commitOfflineMapPlan({
        id: 'plan-1',
        sourceRevision: 'revision-1',
        coverageVersion: 1,
        coordinateCount: 2,
        chunkCount: 1,
        createdAt: 100,
      });

      expect(await getOfflineMapPlanByRevision('revision-1')).toMatchObject({
        id: 'plan-1',
        coordinateCount: 2,
      });
      const chunk = await getOfflineMapPlanChunk('plan-1', 0);
      expect([...chunk!.coordinates]).toEqual([1, 2, 3, 4, 5, 6]);

      const db = await openTileDB();
      expect([...db.objectStoreNames]).toEqual(expect.arrayContaining([
        OFFLINE_MAP_PLAN_STORE,
        OFFLINE_MAP_PLAN_CHUNK_STORE,
        OFFLINE_MAP_PLAN_COORDINATE_STORE,
        OFFLINE_MAP_GENERATION_STORE,
        OFFLINE_MAP_MEMBERSHIP_STORE,
      ]));
    });

    it('deduplicates raw coordinates in bounded staging and pages them in key order', async () => {
      await stageOfflineMapCoordinates(
        'build-1',
        new Uint32Array([18, 2, 3, 5, 1, 1, 18, 2, 3]),
      );

      expect(await countStagedOfflineMapCoordinates('build-1')).toBe(2);
      const first = await getStagedOfflineMapCoordinatePage('build-1', null, 1);
      const second = await getStagedOfflineMapCoordinatePage('build-1', first.lastKey, 1);
      expect([...first.coordinates]).toEqual([5, 1, 1]);
      expect([...second.coordinates]).toEqual([18, 2, 3]);

      await deleteStagedOfflineMapCoordinates('build-1');
      expect(await countStagedOfflineMapCoordinates('build-1')).toBe(0);
    });

    it('marks and returns every previous active generation during activation', async () => {
      const base = {
        planId: 'plan-1', totalTiles: 1, completedTiles: 1, failedTiles: 0,
        bytesDownloaded: 0, refreshAfter: 1000, updatedAt: 1,
      };
      await setOfflineMapGeneration({
        ...base, id: 'old-1', layerId: 'esri-satellite', status: 'active',
      });
      await setOfflineMapGeneration({
        ...base, id: 'old-2', layerId: 'esri-satellite', status: 'active',
      });
      await setOfflineMapGeneration({
        ...base, id: 'next', layerId: 'esri-satellite', status: 'pending',
      });

      await expect(activateOfflineMapGeneration('next', 2)).resolves.toEqual([
        'old-1', 'old-2',
      ]);
      expect(await getOfflineMapGenerations()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'old-1', status: 'releasing' }),
        expect.objectContaining({ id: 'old-2', status: 'releasing' }),
        expect.objectContaining({ id: 'next', status: 'active' }),
      ]));
    });

    it('garbage-collects only plans with no generation references', async () => {
      await putOfflineMapPlanChunk({
        planId: 'retained-plan', index: 0, coordinates: new Uint32Array([1, 2, 3]),
      });
      await putOfflineMapPlanChunk({
        planId: 'obsolete-plan', index: 0, coordinates: new Uint32Array([1, 2, 3]),
      });
      await commitOfflineMapPlan({
        id: 'retained-plan', sourceRevision: 'retained-revision', coverageVersion: 2,
        coordinateCount: 1, chunkCount: 1, createdAt: 1,
      });
      await commitOfflineMapPlan({
        id: 'obsolete-plan', sourceRevision: 'obsolete-revision', coverageVersion: 2,
        coordinateCount: 1, chunkCount: 1, createdAt: 1,
      });
      await setOfflineMapGeneration({
        id: 'active', planId: 'retained-plan', layerId: 'esri-satellite',
        status: 'active', totalTiles: 0, completedTiles: 0, failedTiles: 0,
        bytesDownloaded: 0, refreshAfter: 1, updatedAt: 1,
      });

      await garbageCollectOfflineMapPlans();

      expect(await getOfflineMapPlanById('retained-plan')).not.toBeNull();
      expect(await getOfflineMapPlanById('obsolete-plan')).toBeNull();
      expect(await getOfflineMapPlanChunk('retained-plan', 0)).not.toBeNull();
      expect(await getOfflineMapPlanChunk('obsolete-plan', 0)).toBeNull();
    });

    it('removes crashed staging and chunks that were never published', async () => {
      await stageOfflineMapCoordinates('crashed-build', new Uint32Array([1, 2, 3]));
      await putOfflineMapPlanChunk({
        planId: 'crashed-plan', index: 0, coordinates: new Uint32Array([1, 2, 3]),
      });

      await recoverOfflineMapPlanStorage();

      expect(await countStagedOfflineMapCoordinates('crashed-build')).toBe(0);
      expect(await getOfflineMapPlanChunk('crashed-plan', 0)).toBeNull();
    });

    it('persists normalized generation counters instead of repeatedly clamping views', async () => {
      await setOfflineMapGeneration({
        id: 'corrupt-counters', planId: 'plan', layerId: 'esri-satellite',
        status: 'active', totalTiles: 3.8, completedTiles: 9,
        failedTiles: Number.NaN, bytesDownloaded: 0, refreshAfter: 0, updatedAt: 1,
      });

      await normalizeOfflineMapGenerationCounters(10);

      expect(await getOfflineMapGenerations()).toEqual([
        expect.objectContaining({
          id: 'corrupt-counters', totalTiles: 3, completedTiles: 3,
          failedTiles: 0, updatedAt: 10,
        }),
      ]);
    });

    it.each(['payload', 'tombstone'] as const)(
      'aborts a real IndexedDB %s write transaction before commit',
      async (kind) => {
        const url = `https://tiles.example.com/abort-${kind}`;
        const generationId = `generation-abort-${kind}`;
        await setOfflineMapGeneration({
          id: generationId, planId: 'plan', layerId: 'esri-satellite',
          status: 'pending', totalTiles: 1, completedTiles: 0, failedTiles: 0,
          bytesDownloaded: 0, refreshAfter: 0, updatedAt: 1,
        });
        const db = await openTileDB();
        const probe = db.transaction(TILE_STORE, 'readonly');
        const prototype = Object.getPrototypeOf(probe.objectStore(TILE_STORE)) as IDBObjectStore;
        const originalPut = prototype.put;
        const controller = new AbortController();
        let aborted = false;
        const spy = vi.spyOn(prototype, 'put').mockImplementation(function (
          this: IDBObjectStore,
          ...args
        ) {
          const request = originalPut.apply(this, args as Parameters<IDBObjectStore['put']>);
          if (!aborted) {
            aborted = true;
            queueMicrotask(() => controller.abort());
          }
          return request;
        });
        try {
          const options = {
            signal: controller.signal,
            offlineMembership: { generationId, layerId: 'esri-satellite' },
          };
          const write = kind === 'payload'
            ? writeTileWithCapacity(url, new ArrayBuffer(8), {
              ...options, isOnline: true, maxCacheBytes: 100, allowPinnedOverflow: false,
            })
            : writeNoDataTile(url, options);
          await expect(write).rejects.toMatchObject({ name: 'AbortError' });
        } finally {
          spy.mockRestore();
        }
        expect(await getTile(url)).toBeNull();
        expect(await getTileMetadata(url)).toBeNull();
        expect(await getTileCacheStats()).toMatchObject({ totalBytes: 0, tileCount: 0 });
      },
    );

    it('migrates v6 ownership by layer without deleting payloads or forcing stale freshness', async () => {
      const url = 'https://tiles.example.com/legacy-v6.png';
      const migrationTime = 123_456;
      await seedLegacyV6Ownership(url);
      __resetTileCacheRepositoryForTests();

      await runOfflineMapV7Migration(migrationTime);

      expect((await getTile(url))?.byteLength).toBe(25);
      expect(await getTileMetadata(url)).toMatchObject({
        fetchedAt: migrationTime,
        prefetchOwnerCount: 1,
        pinnedByAutoPrefetch: true,
      });
      expect(await getOfflineMapGenerations()).toEqual([
        expect.objectContaining({
          id: 'legacy-v7:esri-satellite',
          layerId: 'esri-satellite',
          status: 'active',
          totalTiles: 1,
          completedTiles: 1,
        }),
      ]);
    });

    it('promotes cached tiles to a layer generation and releases them without touching bytes', async () => {
      const url = 'https://tiles.example.com/generation.png';
      await __seedTileCacheEntryForTests(
        url, new ArrayBuffer(25), { pinnedByAutoPrefetch: false, now: 100 },
      );
      await setOfflineMapGeneration({
        id: 'generation-1',
        planId: 'plan-1',
        layerId: 'esri-satellite',
        status: 'pending',
        totalTiles: 1,
        completedTiles: 0,
        failedTiles: 0,
        bytesDownloaded: 0,
        refreshAfter: 0,
        updatedAt: 100,
      });

      const claimed = await claimCachedTilesForOfflineGeneration(
        [url],
        'generation-1',
        'esri-satellite',
        101,
      );
      expect(claimed[0]).toMatchObject({ prefetchOwnerCount: 1 });
      expect(await activateOfflineMapGeneration('generation-1', 102)).toEqual([]);
      await releaseOfflineMapGeneration('generation-1', 103);

      expect((await getTile(url))?.byteLength).toBe(25);
      expect(await getTileMetadata(url)).toMatchObject({
        prefetchOwnerCount: 0,
        pinnedByAutoPrefetch: false,
      });
    });

    it('rejects a cancelled generation write inside the atomic transaction', async () => {
      const url = 'https://tiles.example.com/cancelled-generation.png';
      await setOfflineMapGeneration({
        id: 'generation-cancelled',
        planId: 'plan-1',
        layerId: 'esri-satellite',
        status: 'pending',
        totalTiles: 1,
        completedTiles: 0,
        failedTiles: 0,
        bytesDownloaded: 0,
        refreshAfter: 0,
        updatedAt: 100,
      });
      const controller = new AbortController();
      controller.abort();

      await expect(writeTileWithCapacity(url, new ArrayBuffer(25), {
        isOnline: true,
        maxCacheBytes: 1_000,
        allowPinnedOverflow: false,
        signal: controller.signal,
        offlineMembership: {
          generationId: 'generation-cancelled',
          layerId: 'esri-satellite',
        },
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(await getTile(url)).toBeNull();
    });

    it('commits and reclaims a zero-byte no-data tombstone with generation ownership', async () => {
      const url = 'https://tiles.example.com/no-data.png';
      await __seedTileCacheEntryForTests(
        url, new ArrayBuffer(25), { pinnedByAutoPrefetch: false, now: 100 },
      );
      await setOfflineMapGeneration({
        id: 'generation-no-data',
        planId: 'plan-1',
        layerId: 'esri-world-hillshade',
        status: 'pending',
        totalTiles: 1,
        completedTiles: 0,
        failedTiles: 0,
        bytesDownloaded: 0,
        refreshAfter: 0,
        updatedAt: 100,
      });

      await expect(writeNoDataTile(url, {
        now: 101,
        offlineMembership: {
          generationId: 'generation-no-data',
          layerId: 'esri-world-hillshade',
        },
      })).resolves.toEqual({ cacheDeltaBytes: -25 });

      expect(await getTile(url)).toBeNull();
      expect(await getTileMetadata(url)).toMatchObject({
        isNoData: true,
        sizeBytes: 0,
        fetchedAt: 101,
        prefetchOwnerCount: 1,
      });
      expect(await getTileCacheStats()).toMatchObject({
        totalBytes: 0,
        tileCount: 1,
        pinnedBytes: 0,
        pinnedTileCount: 1,
      });
      expect((await claimCachedTilesForOfflineGeneration(
        [url],
        'generation-no-data',
        'esri-world-hillshade',
        102,
      ))[0]).toMatchObject({ isNoData: true, prefetchOwnerCount: 1 });

      await releaseOfflineMapGeneration('generation-no-data', 103);
      expect(await getTileMetadata(url)).toMatchObject({
        isNoData: true,
        prefetchOwnerCount: 0,
      });
      expect(await getTileCacheStats()).toMatchObject({ pinnedTileCount: 0 });
    });
  });

  describe('test cache seeding', () => {
    it('replaces a pinned tile without double-counting or dropping its pin', async () => {
      const url = 'https://tiles.example.com/replaced.png';
      await __seedTileCacheEntryForTests(url, new ArrayBuffer(100), {
        pinnedByAutoPrefetch: true,
        now: 1,
      });

      await __seedTileCacheEntryForTests(url, new ArrayBuffer(40), {
        pinnedByAutoPrefetch: false,
        now: 2,
      });

      expect((await getTile(url))?.byteLength).toBe(40);
      expect(await getTileMetadata(url)).toEqual({
        url,
        sizeBytes: 40,
        isNoData: false,
        fetchedAt: 2,
        lastAccessedAt: 2,
        prefetchOwnerCount: 1,
        pinnedByAutoPrefetch: true,
        createdAt: 1,
        updatedAt: 2,
      });
      expect(await getTileCacheStats()).toEqual({
        totalBytes: 40,
        tileCount: 1,
        pinnedBytes: 40,
        pinnedTileCount: 1,
        updatedAt: 2,
      });
    });
  });

  describe('deleteTilesByUrlPrefixes', () => {
    it('evicts matching tiles (incl. pinned) and updates stats', async () => {
      const satUrl = 'https://services.arcgisonline.com/sat/5/1/2';
      const hillUrl = 'https://server.arcgisonline.com/hill/5/1/2';
      await __seedTileCacheEntryForTests(
        satUrl, new ArrayBuffer(100), { pinnedByAutoPrefetch: true },
      );
      await __seedTileCacheEntryForTests(
        hillUrl, new ArrayBuffer(50), { pinnedByAutoPrefetch: true },
      );

      expect((await getTileCacheStats()).totalBytes).toBe(150);

      // The tile_cache_stats store (read by getTileCacheStats, NOT the metadata
      // cursor) must also reflect both pinned upserts.
      const statsBefore = await getTileCacheStats();
      expect(statsBefore.totalBytes).toBe(150);
      expect(statsBefore.tileCount).toBe(2);
      expect(statsBefore.pinnedBytes).toBe(150);
      expect(statsBefore.pinnedTileCount).toBe(2);

      const result = await deleteTilesByUrlPrefixes(['https://server.arcgisonline.com/hill/']);

      expect(result.evictedTileCount).toBe(1);
      expect(result.freedBytes).toBe(50);
      expect(await getTile(hillUrl)).toBeNull();
      expect(await getTile(satUrl)).not.toBeNull();

      // Only the satellite tile remains (its bytes), confirmed via the
      // metadata-cursor totals used by Settings.
      expect((await getTileCacheStats()).totalBytes).toBe(100);
      expect((await getTileCacheStats()).pinnedTileCount).toBe(1);

      // The stats store must be decremented in lock-step with the eviction
      // (this is the accounting the author could not verify under fake-indexeddb).
      const statsAfter = await getTileCacheStats();
      expect(statsAfter.totalBytes).toBe(100);
      expect(statsAfter.tileCount).toBe(1);
      expect(statsAfter.pinnedBytes).toBe(100);
      expect(statsAfter.pinnedTileCount).toBe(1);
    });

    it('is a no-op for empty prefixes', async () => {
      const result = await deleteTilesByUrlPrefixes([]);
      expect(result).toEqual({ evictedTileCount: 0, freedBytes: 0 });
    });
  });

  describe('legacy job retirement', () => {
    it('drops obsolete per-target job snapshots during the v7 upgrade', async () => {
      await seedLegacyV3Database(
        {
          projectId: 'legacy-project',
          commitId: 'legacy-commit',
          status: 'done',
          zoomMin: 0,
          zoomMax: 18,
          padMeters: 50,
          totalTiles: 3,
          completedTiles: 3,
          failedTiles: 0,
          bytesDownloaded: 1000,
          estimatedBytes: 1000,
          updatedAt: 5,
        },
        'legacy-project',
      );

      const db = await openTileDB();
      expect(db.objectStoreNames.contains(PREFETCH_JOB_STORE)).toBe(false);
    });
  });

  describe('legacy tile migration', () => {
    it('keeps v4 bytes, treats unknown fetch dates as fresh, and rebuilds stats', async () => {
      const url = 'https://tiles.example.com/legacy-v4';
      const migratedAfter = Date.now();
      await seedLegacyV4Tile(url);

      expect((await getTile(url))?.byteLength).toBe(25);
      const metadata = await getTileMetadata(url);
      expect(metadata?.fetchedAt).toBeGreaterThanOrEqual(migratedAfter);
      expect(metadata).toMatchObject({ prefetchOwnerCount: 0 });
      expect(await getTileCacheStats()).toMatchObject({
        totalBytes: 25,
        tileCount: 1,
        pinnedBytes: 0,
        pinnedTileCount: 0,
      });
    });

    it('repairs zero fetch dates from the previous v5 migration without deleting bytes', async () => {
      const url = 'https://tiles.example.com/legacy-v5';
      const migratedAfter = Date.now();
      await seedBrokenV5Tile(url);

      expect((await getTile(url))?.byteLength).toBe(25);
      expect((await getTileMetadata(url))?.fetchedAt).toBeGreaterThanOrEqual(migratedAfter);
      expect(await getTileCacheStats()).toMatchObject({ totalBytes: 25, tileCount: 1 });
    });
  });

  describe('serialized atomic capacity writes', () => {
    it('keeps concurrent browsing writes within the cap and consistent with stats', async () => {
      const options = {
        isOnline: true,
        maxCacheBytes: 100,
        allowPinnedOverflow: false,
      };
      await Promise.all([
        writeTileWithCapacity('https://tiles.example.com/a', new ArrayBuffer(80), options),
        writeTileWithCapacity('https://tiles.example.com/b', new ArrayBuffer(80), options),
      ]);

      const stats = await getTileCacheStats();
      expect(stats.totalBytes).toBe(80);
      expect(stats.tileCount).toBe(1);
      const resident = [
        await getTile('https://tiles.example.com/a'),
        await getTile('https://tiles.example.com/b'),
      ].filter(Boolean);
      expect(resident).toHaveLength(1);
    });

    it('never applies approved overflow to an ordinary browsing tile', async () => {
      await __seedTileCacheEntryForTests(
        'https://tiles.example.com/pinned',
        new ArrayBuffer(80),
        { pinnedByAutoPrefetch: true },
      );

      await expect(writeTileWithCapacity(
        'https://tiles.example.com/runtime',
        new ArrayBuffer(80),
        {
          isOnline: true,
          maxCacheBytes: 100,
          allowPinnedOverflow: true,
        },
      )).rejects.toMatchObject({ name: 'TileCacheCapacityError' });
      expect((await getTileCacheStats()).totalBytes).toBe(80);
    });
  });

  it('recovers in-process after a transient database-open failure', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, 'open', {
      value: () => { throw new Error('transient open failure'); },
      configurable: true,
    });
    await expect(openTileDB()).rejects.toThrow('transient open failure');
    Object.defineProperty(indexedDB, 'open', {
      value: originalOpen,
      configurable: true,
    });

    await expect(openTileDB()).resolves.toBeDefined();
  });

  it('repairs aggregate statistics from authoritative metadata', async () => {
    await __seedTileCacheEntryForTests('https://tiles.example.com/repair', new ArrayBuffer(42), {
      pinnedByAutoPrefetch: true,
      now: 10,
    });
    const db = await openTileDB();
    const tx = db.transaction(TILE_STATS_STORE, 'readwrite');
    tx.objectStore(TILE_STATS_STORE).put({
      totalBytes: 0,
      tileCount: 0,
      pinnedBytes: 0,
      pinnedTileCount: 0,
      updatedAt: 0,
    }, 'global');
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await expect(repairTileCacheStats(20)).resolves.toMatchObject({
      totalBytes: 42,
      tileCount: 1,
      pinnedBytes: 42,
      pinnedTileCount: 1,
      updatedAt: 20,
    });
  });
});
