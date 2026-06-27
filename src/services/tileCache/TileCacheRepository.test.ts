import { describe, it, expect, beforeEach } from 'vitest';

import {
  TILE_DB_NAME,
  TILE_STORE,
  PREFETCH_JOB_STORE,
  TILE_METADATA_STORE,
  TILE_STATS_STORE,
  __resetTileCacheRepositoryForTests,
  __closeTileCacheRepositoryForTests,
  deletePrefetchJobsByLayer,
  deletePrefetchJobsByTarget,
  deleteTilesByUrlPrefixes,
  getAllPrefetchJobs,
  getPrefetchJob,
  getManualTileCount,
  getTile,
  getTileCacheStats,
  getTotalCacheBytes,
  prefetchJobKey,
  setPrefetchJob,
  upsertTile,
} from './TileCacheRepository';
import type { TilePrefetchJobState } from '../../types/tilePrefetch';

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

function makeJob(overrides: Partial<TilePrefetchJobState> = {}): TilePrefetchJobState {
  return {
    layerId: 'esri-satellite',
    projectId: 'p1',
    commitId: 'c1',
    status: 'queued',
    zoomMin: 0,
    zoomMax: 18,
    padMeters: 50,
    totalTiles: 1,
    completedTiles: 0,
    failedTiles: 0,
    bytesDownloaded: 0,
    estimatedBytes: 0,
    updatedAt: 1,
    ...overrides,
  };
}

describe('TileCacheRepository', () => {
  beforeEach(async () => {
    await __closeTileCacheRepositoryForTests();
    await deleteDatabase();
    __resetTileCacheRepositoryForTests();
  });

  describe('prefetchJobKey + composite keying', () => {
    it('namespaces jobs by layer so same target stays distinct per layer', async () => {
      expect(prefetchJobKey('esri-satellite', 'p1')).toBe('esri-satellite::p1');

      await setPrefetchJob(makeJob({ layerId: 'esri-satellite', projectId: 'p1' }));
      await setPrefetchJob(makeJob({ layerId: 'esri-world-hillshade', projectId: 'p1' }));

      const all = await getAllPrefetchJobs();
      expect(all.length).toBe(2);

      const sat = await getPrefetchJob('esri-satellite', 'p1');
      const hill = await getPrefetchJob('esri-world-hillshade', 'p1');
      expect(sat?.layerId).toBe('esri-satellite');
      expect(hill?.layerId).toBe('esri-world-hillshade');
    });
  });

  describe('deletePrefetchJobsByLayer', () => {
    it('removes only the targeted layer jobs', async () => {
      await setPrefetchJob(makeJob({ layerId: 'esri-satellite', projectId: 'p1' }));
      await setPrefetchJob(makeJob({ layerId: 'esri-world-hillshade', projectId: 'p1' }));
      await setPrefetchJob(makeJob({ layerId: 'esri-world-hillshade', projectId: 'landmarks' }));

      await deletePrefetchJobsByLayer('esri-world-hillshade');

      const all = await getAllPrefetchJobs();
      expect(all.map((j) => j.layerId)).toEqual(['esri-satellite']);
    });
  });

  describe('deletePrefetchJobsByTarget', () => {
    it('removes the target across layers without deleting other jobs', async () => {
      await setPrefetchJob(makeJob({ layerId: 'esri-satellite', projectId: 'p1' }));
      await setPrefetchJob(makeJob({ layerId: 'esri-world-hillshade', projectId: 'p1' }));
      await setPrefetchJob(makeJob({ layerId: 'esri-satellite', projectId: 'p2' }));

      await deletePrefetchJobsByTarget('p1');

      const all = await getAllPrefetchJobs();
      expect(all.map((job) => job.projectId)).toEqual(['p2']);
    });
  });

  describe('deleteTilesByUrlPrefixes', () => {
    it('evicts matching tiles (incl. pinned) and updates stats', async () => {
      const satUrl = 'https://services.arcgisonline.com/sat/5/1/2';
      const hillUrl = 'https://server.arcgisonline.com/hill/5/1/2';
      await upsertTile(satUrl, new ArrayBuffer(100), { pinnedByAutoPrefetch: true });
      await upsertTile(hillUrl, new ArrayBuffer(50), { pinnedByAutoPrefetch: true });

      expect(await getTotalCacheBytes()).toBe(150);

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
      expect(await getTotalCacheBytes()).toBe(100);
      expect(await getManualTileCount()).toBe(0); // both were pinned

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

  describe('v3 -> v4 migration', () => {
    it('namespaces legacy bare-keyed jobs to the satellite layer', async () => {
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

      // Opening through the repository (v4) triggers the migration.
      const all = await getAllPrefetchJobs();
      expect(all.length).toBe(1);
      expect(all[0].layerId).toBe('esri-satellite');
      expect(all[0].projectId).toBe('legacy-project');

      const migrated = await getPrefetchJob('esri-satellite', 'legacy-project');
      expect(migrated?.commitId).toBe('legacy-commit');
    });

    it('is a no-op when the legacy prefetch store is empty', async () => {
      // Seed a v3 DB with the stores but no jobs, then open via the repository.
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(TILE_DB_NAME, 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(TILE_STORE)) db.createObjectStore(TILE_STORE);
          if (!db.objectStoreNames.contains(PREFETCH_JOB_STORE)) {
            db.createObjectStore(PREFETCH_JOB_STORE);
          }
          if (!db.objectStoreNames.contains(TILE_METADATA_STORE)) {
            db.createObjectStore(TILE_METADATA_STORE);
          }
          if (!db.objectStoreNames.contains(TILE_STATS_STORE)) {
            db.createObjectStore(TILE_STATS_STORE);
          }
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });

      expect(await getAllPrefetchJobs()).toEqual([]);
    });

    it('does not double-namespace a job that already carries a layerId', async () => {
      // A job written with a composite key + layerId (as if a partial/older v4
      // already ran) must survive the migration unchanged (idempotent re-key).
      await seedLegacyV3Database(
        {
          layerId: 'esri-world-hillshade',
          projectId: 'p9',
          commitId: 'c9',
          status: 'done',
          zoomMin: 0,
          zoomMax: 18,
          padMeters: 50,
          totalTiles: 1,
          completedTiles: 1,
          failedTiles: 0,
          bytesDownloaded: 10,
          estimatedBytes: 10,
          updatedAt: 7,
        },
        prefetchJobKey('esri-world-hillshade', 'p9'),
      );

      const all = await getAllPrefetchJobs();
      expect(all).toHaveLength(1);
      expect(all[0].layerId).toBe('esri-world-hillshade');
      expect(await getPrefetchJob('esri-world-hillshade', 'p9')).not.toBeNull();
      // It must NOT have been re-keyed under the satellite layer.
      expect(await getPrefetchJob('esri-satellite', 'p9')).toBeNull();
    });
  });
});
