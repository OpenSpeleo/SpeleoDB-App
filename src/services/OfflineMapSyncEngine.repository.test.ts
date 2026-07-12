import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineMapSyncEngine } from './OfflineMapSyncEngine';
import { OfflineMapSyncStore } from './OfflineMapSyncStore';
import { MAP } from '../constants';
import {
  TILE_DB_NAME,
  __closeTileCacheRepositoryForTests,
  __resetTileCacheRepositoryForTests,
  commitOfflineMapPlan,
  getOfflineMapPlanByRevision,
  getOfflineMapGenerations,
  getTile,
  getTileCacheStats,
  getTileMetadata,
  putOfflineMapPlanChunk,
} from './tileCache/TileCacheRepository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(TILE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe('OfflineMapSyncEngine repository integration', () => {
  beforeEach(async () => {
    await __closeTileCacheRepositoryForTests();
    await deleteDatabase();
    __resetTileCacheRepositoryForTests();
    vi.restoreAllMocks();
  });

  it('drains hundreds of tiles through real v7 membership and payload transactions', async () => {
    const count = 300;
    const encoded = new Uint32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      encoded[index * 3] = 18;
      encoded[index * 3 + 1] = index;
      encoded[index * 3 + 2] = index;
    }
    await putOfflineMapPlanChunk({ planId: 'integration-plan', index: 0, coordinates: encoded });
    await commitOfflineMapPlan({
      id: 'integration-plan',
      sourceRevision: 'integration-revision',
      coverageVersion: 2,
      coordinateCount: count,
      chunkCount: 1,
      createdAt: Date.now(),
    });

    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = new OfflineMapSyncStore((callback) => {
      queueMicrotask(callback);
      return () => {};
    });
    const engine = new OfflineMapSyncEngine({ store, isOnline: () => true });

    await engine.schedule({
      mode: 'rebuild',
      plan: {
        sourceRevision: 'integration-revision',
        projects: [],
        points: [],
        paths: [],
        minZoom: 0,
        maxZoom: 18,
        padMeters: 50,
      },
      layers: [{
        id: 'esri-satellite',
        tileUrlTemplate: 'https://tiles.example.com/{z}/{x}/{y}.png',
      }],
    });
    await engine.waitForIdle();

    expect(fetchMock).toHaveBeenCalledTimes(count);
    expect(store.getSnapshot()).toMatchObject({
      phase: 'completed',
      totalTiles: count,
      completedTiles: count,
      failedTiles: 0,
    });
    expect(await getTileCacheStats()).toMatchObject({
      tileCount: count,
      pinnedTileCount: count,
    });
    expect(await getOfflineMapGenerations()).toEqual([
      expect.objectContaining({
        layerId: 'esri-satellite',
        status: 'active',
        totalTiles: count,
        completedTiles: count,
      }),
    ]);
  });

  it('counts a valid forbidden-hash answer as completed without retaining its payload', async () => {
    const encoded = new Uint32Array([18, 1, 2]);
    await putOfflineMapPlanChunk({
      planId: 'no-data-plan',
      index: 0,
      coordinates: encoded,
    });
    await commitOfflineMapPlan({
      id: 'no-data-plan',
      sourceRevision: 'no-data-revision',
      coverageVersion: 2,
      coordinateCount: 1,
      chunkCount: 1,
      createdAt: Date.now(),
    });
    const originalCrypto = globalThis.crypto;
    const digest = new Uint8Array(
      MAP.MISSING_TILE_SHA256_HASHES[0].match(/.{2}/g)!.map((hex) => parseInt(hex, 16)),
    ).buffer;
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { digest: vi.fn(async () => digest) } },
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    )));
    try {
      const store = new OfflineMapSyncStore((callback) => {
        queueMicrotask(callback);
        return () => {};
      });
      const engine = new OfflineMapSyncEngine({ store, isOnline: () => true });
      await engine.schedule({
        mode: 'rebuild',
        plan: {
          sourceRevision: 'no-data-revision',
          projects: [],
          points: [],
          paths: [],
          minZoom: 0,
          maxZoom: 18,
          padMeters: 50,
        },
        layers: [{
          id: 'esri-satellite',
          tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
        }],
      });
      await engine.waitForIdle();

      const url = MAP.TILE_URL_TEMPLATE
        .replace('{z}', '18')
        .replace('{x}', '1')
        .replace('{y}', '2');
      expect(store.getSnapshot()).toMatchObject({
        phase: 'completed',
        totalTiles: 1,
        completedTiles: 1,
        failedTiles: 0,
      });
      expect(await getTile(url)).toBeNull();
      expect(await getTileMetadata(url)).toMatchObject({
        isNoData: true,
        sizeBytes: 0,
        prefetchOwnerCount: 1,
      });
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  it('builds a missing plan from final compact worker chunks before downloading', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([7]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));
    const engine = new OfflineMapSyncEngine({
      store: new OfflineMapSyncStore((callback) => {
        queueMicrotask(callback);
        return () => {};
      }),
      isOnline: () => true,
    });

    await engine.schedule({
      mode: 'rebuild',
      plan: {
        sourceRevision: 'compact-plan-revision',
        projects: [],
        points: [[1, 1], [1, 1]],
        paths: [],
        minZoom: 0,
        maxZoom: 0,
        padMeters: 0,
      },
      layers: [{ id: 'esri-satellite', tileUrlTemplate: MAP.TILE_URL_TEMPLATE }],
    });
    await engine.waitForIdle();

    expect(await getOfflineMapPlanByRevision('compact-plan-revision')).toMatchObject({
      coverageVersion: 2,
      coordinateCount: 1,
      chunkCount: 1,
    });
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'completed', completedTiles: 1, totalTiles: 1,
    });
  });

  it('deletes and rebuilds a structurally corrupt published manifest', async () => {
    await commitOfflineMapPlan({
      id: 'corrupt-plan', sourceRevision: 'corrupt-revision', coverageVersion: 2,
      coordinateCount: 1, chunkCount: 0, createdAt: 1,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([7]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));
    const engine = new OfflineMapSyncEngine({ isOnline: () => true });

    await engine.schedule({
      mode: 'rebuild',
      plan: {
        sourceRevision: 'corrupt-revision', projects: [], points: [[1, 1]], paths: [],
        minZoom: 0, maxZoom: 0, padMeters: 0,
      },
      layers: [{ id: 'esri-satellite', tileUrlTemplate: MAP.TILE_URL_TEMPLATE }],
    });
    await engine.waitForIdle();

    expect(await getOfflineMapPlanByRevision('corrupt-revision')).toMatchObject({
      coordinateCount: 1, chunkCount: 1,
    });
    expect(await getOfflineMapPlanByRevision('corrupt-revision'))
      .not.toMatchObject({ id: 'corrupt-plan' });
  });
});
