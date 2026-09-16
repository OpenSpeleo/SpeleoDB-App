import {
  planOfflineMapInWorker,
  collectOfflineMapCoordinates,
} from './OfflineMapPlanner';
import { areaBounds } from './downloadAreaGeometry';
import { automaticAreaInputs } from './downloadAreaSources';
import * as tileRepository from './tileCache/TileCacheRepository';
import { DOWNLOAD_AREA_COLORS } from './downloadAreaColors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadAreaService } from './DownloadAreaService';
import { OfflineMapSyncEngine } from './OfflineMapSyncEngine';
import { OfflineMapSyncStore } from './OfflineMapSyncStore';
import {
  DownloadAreaType,
  type DownloadAreaInput,
} from '../types/downloadArea';
import { MAP_LAYERS } from '../constants';
import {
  __closeTileCacheRepositoryForTests,
  clearCachedTiles,
  getOfflineMapGenerations,
  getTile,
  getTileCacheStats,
  openTileDB,
  DOWNLOAD_AREA_SETTINGS_STORE,
} from './tileCache/TileCacheRepository';
import { readDownloadAreaCatalog } from './tileCache/DownloadAreaRepository';

const small = {
  name: 'Expedition',
  topLeft: [2.00001, 46.00002] as [number, number],
  bottomRight: [2.00002, 46.00001] as [number, number],
};
const automatic = (
  overrides: Partial<DownloadAreaInput> = {},
): DownloadAreaInput => ({
  ...small,
  objectId: 'project-1',
  type: DownloadAreaType.Project,
  visible: false,
  layerIds: ['esri-satellite'],
  sourceKey: 'project:project-1',
  sourceRevision: 'commit-1',
  ...overrides,
});
let online = true;
let service: DownloadAreaService;
let engine: OfflineMapSyncEngine;
let fetchMock: ReturnType<typeof vi.fn>;
let planMock: ReturnType<typeof vi.fn<typeof planOfflineMapInWorker>>;
beforeEach(async () => {
  await clearCachedTiles();
  online = true;
  fetchMock = vi.fn(
    async () =>
      new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  planMock = vi.fn(planOfflineMapInWorker);
  engine = new OfflineMapSyncEngine({
    plan: planMock,
    isOnline: () => online,
    store: new OfflineMapSyncStore((callback) => {
      queueMicrotask(callback);
      return () => {};
    }),
  });
  service = new DownloadAreaService(
    engine,
    () => online,
    () => MAP_LAYERS.map((layer) => layer.id),
  );
});
afterEach(async () => {
  service.dispose();
  engine.dispose();
  await service.waitForIdle();
  await engine.waitForIdle();
  await __closeTileCacheRepositoryForTests();
  vi.unstubAllGlobals();
});

describe('download area production lifecycle', () => {
  it('downloads ordinary and polar sources together without rejecting the catalog', async () => {
    const polar = automaticAreaInputs(
      [],
      [{
        id: 'landmarks',
        collection: {
          type: 'FeatureCollection',
          features: [89, -89].map((latitude) => ({
            type: 'Feature' as const,
            properties: { id: `polar-${latitude}` },
            geometry: { type: 'Point' as const, coordinates: [2, latitude] },
          })),
        },
      }],
      [],
      ['esri-satellite'],
    );
    await service.reconcileAutomatic([automatic(), ...polar]);
    await service.waitForIdle();
    const catalog = await readDownloadAreaCatalog();
    expect(catalog.areas).toHaveLength(3);
    expect(catalog.areas.every(
      (area) => service.getSnapshot().progress[area.areaId].status === 'downloaded',
    )).toBe(true);
    expect(
      (await getOfflineMapGenerations()).filter((g) => g.status === 'active'),
    ).toHaveLength(3);
  });
  it('creates multiple unnamed areas with distinct persisted colors and stable identity/order through edits and deletion', async () => {
    online = false;
    const first = await service.saveManual({
      topLeft: small.topLeft,
      bottomRight: small.bottomRight,
    });
    const second = await service.saveManual({
      topLeft: [3.00001, 47.00002],
      bottomRight: [3.00002, 47.00001],
    });
    const before = (await readDownloadAreaCatalog()).areas;
    expect(before.map((area) => area.areaId)).toEqual([first, second]);
    expect(new Set(before.map((area) => area.color)).size).toBe(2);
    expect(
      before.every(
        (area) =>
          !('name' in area) &&
          DOWNLOAD_AREA_COLORS.includes(
            area.color as (typeof DOWNLOAD_AREA_COLORS)[number],
          ),
      ),
    ).toBe(true);
    await service.saveManual(
      { topLeft: [4.00001, 48.00002], bottomRight: [4.00002, 48.00001] },
      first,
    );
    await service.setVisible(first, false);
    const restored = new DownloadAreaService(engine, () => online);
    try {
      await restored.preload();
      const after = restored.getSnapshot().areas;
      expect(after.map((area) => area.areaId)).toEqual([first, second]);
      expect(after.map((area) => area.color)).toEqual(
        before.map((area) => area.color),
      );
      expect(after[0]).toMatchObject({ revision: 2, visible: false });
      expect(after[1]).toEqual(before[1]);
      await restored.deleteManual(first);
      expect((await readDownloadAreaCatalog()).areas).toEqual([before[1]]);
    } finally {
      restored.dispose();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses every palette color before balancing reuse', async () => {
    online = false;
    for (let i = 0; i <= DOWNLOAD_AREA_COLORS.length; i++)
      await service.saveManual(small);
    const colors = service.getSnapshot().areas.map((area) => area.color);
    expect(new Set(colors.slice(0, -1)).size).toBe(DOWNLOAD_AREA_COLORS.length);
    expect(colors.filter((color) => color === colors.at(-1))).toHaveLength(2);
  });
  it('upgrades legacy names/colors once under concurrent reads without touching tile coverage', async () => {
    await service.saveManual(small);
    await service.waitForIdle();
    const catalog = await readDownloadAreaCatalog();
    catalog.areas[0].name = 'Legacy camp';
    delete catalog.areas[0].color;
    const db = await openTileDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOWNLOAD_AREA_SETTINGS_STORE, 'readwrite');
      tx.objectStore(DOWNLOAD_AREA_SETTINGS_STORE).put(
        catalog,
        'download-areas',
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const generations = await getOfflineMapGenerations();
    const pins = (await getTileCacheStats()).pinnedTileCount;
    const [first, second] = await Promise.all([
      readDownloadAreaCatalog(),
      readDownloadAreaCatalog(),
    ]);
    expect(first).toEqual(second);
    expect(first.areas[0]).not.toHaveProperty('name');
    expect(first.areas[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(first.areas[0].revision).toBe(catalog.areas[0].revision);
    expect(await getOfflineMapGenerations()).toEqual(generations);
    expect((await getTileCacheStats()).pinnedTileCount).toBe(pins);
    const raw = await new Promise((resolve, reject) => {
      const request = db
        .transaction(DOWNLOAD_AREA_SETTINGS_STORE)
        .objectStore(DOWNLOAD_AREA_SETTINGS_STORE)
        .get('download-areas');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(raw).toEqual(first);
  });
  it('saving an incomplete area resumes the download without a separate retry action', async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 404 }),
    );
    const id = await service.saveManual(small);
    await service.waitForIdle();
    expect(service.getSnapshot().progress[id].status).toBe('incomplete');
    fetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array([7]), {
          headers: { 'content-type': 'image/png' },
        }),
    );
    await service.saveManual(small, id);
    await service.waitForIdle();
    expect(service.getSnapshot().progress[id].status).toBe('downloaded');
    expect(service.getSnapshot().areas[0].revision).toBe(1);
  });
  it('downloads enabled layers once for overlapping automatic and manual areas and restores the union', async () => {
    await service.reconcileAutomatic([automatic()]);
    await service.waitForIdle();
    const automaticCalls = fetchMock.mock.calls.length;
    expect(automaticCalls).toBeGreaterThanOrEqual(19);
    const id = await service.saveManual(small);
    await service.waitForIdle();
    expect(service.getSnapshot().progress[id].status).toBe('downloaded');
    expect(service.getSnapshot().availableLayerIds).toEqual(
      expect.arrayContaining(MAP_LAYERS.map((layer) => layer.id)),
    );
    expect(fetchMock).toHaveBeenCalledTimes(automaticCalls);
    expect(
      (await getOfflineMapGenerations()).filter((g) => g.status === 'active'),
    ).toHaveLength(3);
    const bytes = (await getTileCacheStats()).totalBytes;
    await service.deleteManual(id);
    expect((await getTileCacheStats()).totalBytes).toBe(bytes);
    expect((await getTileCacheStats()).pinnedTileCount).toBe(automaticCalls);
    const url = MAP_LAYERS[1].tileUrlTemplate
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0');
    expect(await getTile(url)).not.toBeNull();
    const restored = new DownloadAreaService(engine, () => online);
    await restored.preload();
    expect(restored.getSnapshot().areas).toHaveLength(1);
    expect(
      restored.getSnapshot().progress[restored.getSnapshot().areas[0].areaId]
        .status,
    ).toBe('downloaded');
    restored.dispose();
  });
  it('saves and refines offline intent, then downloads only the latest rectangle', async () => {
    online = false;
    const id = await service.saveManual(small);
    await service.saveManual(
      {
        ...small,
        topLeft: [3.00001, 47.00002],
        bottomRight: [3.00002, 47.00001],
      },
      id,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await readDownloadAreaCatalog()).areas[0]).toMatchObject({
      areaId: id,
      revision: 2,
    });
    expect(service.getSnapshot().progress[id].status).toBe('waiting');
    online = true;
    service.resume();
    await service.waitForIdle();
    expect(service.getSnapshot().progress[id].status).toBe('downloaded');
    expect(
      (await getOfflineMapGenerations()).every((g) =>
        g.coverageKey?.includes('3.00001'),
      ),
    ).toBe(true);
  });
  it('saving unchanged bounds and visibility leave the coverage revision and downloader unchanged', async () => {
    const id = await service.saveManual(small);
    await service.waitForIdle();
    const calls = fetchMock.mock.calls.length;
    const generationIds = (await getOfflineMapGenerations()).map((g) => g.id);
    await service.setVisible(id, false);
    await service.saveManual(small, id);
    await service.waitForIdle();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect((await getOfflineMapGenerations()).map((g) => g.id)).toEqual(
      generationIds,
    );
    expect((await readDownloadAreaCatalog()).areas[0]).toMatchObject({
      revision: 1,
      visible: false,
    });
  });
  it('keeps manual records during automatic reconciliation and never exposes automatic areas', async () => {
    online = false;
    const id = await service.saveManual(small);
    await service.reconcileAutomatic([automatic()]);
    const auto = service
      .getSnapshot()
      .areas.find((a) => a.type === DownloadAreaType.Project)!;
    await expect(service.setVisible(auto.areaId, true)).rejects.toThrow(
      'Only manual',
    );
    await expect(service.deleteManual(auto.areaId)).rejects.toThrow(
      'Only manual',
    );
    await expect(service.saveManual(small, auto.areaId)).rejects.toThrow(
      'Only saved manual',
    );
    await service.reconcileAutomatic([
      automatic({ sourceRevision: 'commit-2' }),
    ]);
    expect(
      service
        .getSnapshot()
        .areas.find((a) => a.type === DownloadAreaType.Project)?.areaId,
    ).toBe(auto.areaId);
    await service.reconcileAutomatic([]);
    expect(service.getSnapshot().areas.map((a) => a.areaId)).toEqual([id]);
  });
  it('retains all previous layers if replacement fails on one provider', async () => {
    const id = await service.saveManual(small);
    await service.waitForIdle();
    const previousIds = (await getOfflineMapGenerations()).map((g) => g.id);
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(new Uint8Array([1]), {
          status: url.includes('Hillshade_Dark') ? 404 : 200,
          headers: { 'content-type': 'image/png' },
        }),
    );
    await service.saveManual(
      {
        ...small,
        topLeft: [8.00001, 46.00002],
        bottomRight: [8.00002, 46.00001],
      },
      id,
    );
    await service.waitForIdle();
    expect(service.getSnapshot().progress[id].status).toBe('incomplete');
    expect(
      (await getOfflineMapGenerations())
        .filter((g) => g.status === 'active')
        .map((g) => g.id),
    ).toEqual(previousIds);
  });
  it('deleting overlapping areas leaves the union intact and final deletion releases pins after catalog commit', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      ids.push(await service.saveManual(small));
      await service.waitForIdle();
    }
    const before = await getTileCacheStats();
    const generations = await getOfflineMapGenerations();
    expect(generations).toHaveLength(3);
    await Promise.all(ids.slice(0, 2).map((id) => service.deleteManual(id)));
    await service.waitForIdle();
    expect(await getOfflineMapGenerations()).toEqual(generations);
    expect((await getTileCacheStats()).pinnedTileCount).toBe(
      before.pinnedTileCount,
    );
    let allowCleanup!: () => void;
    let cleanupStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      allowCleanup = resolve;
    });
    const started = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    const release = tileRepository.releaseOfflineMapGeneration;
    const delayed = vi
      .spyOn(tileRepository, 'releaseOfflineMapGeneration')
      .mockImplementation(async (id) => {
        cleanupStarted();
        await gate;
        await release(id);
      });
    const deletion = service.deleteManual(ids[2]);
    try {
      await started;
      expect((await readDownloadAreaCatalog()).areas).toEqual([]);
      expect(service.getSnapshot().areas).toEqual([]);
      expect(
        (await getOfflineMapGenerations()).every(
          (g) => g.status === 'releasing',
        ),
      ).toBe(true);
    } finally {
      allowCleanup();
      await deletion;
      delayed.mockRestore();
    }
    expect((await getTileCacheStats()).pinnedTileCount).toBe(0);
    expect((await getTileCacheStats()).totalBytes).toBe(before.totalBytes);
  });
  it('deletes an area while transport ignores abort without resurrecting a tile claim', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await gate;
      return new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png' },
      });
    });
    const id = await service.saveManual(small);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await service.deleteManual(id);
    release();
    await service.waitForIdle();
    expect((await readDownloadAreaCatalog()).areas).toEqual([]);
    expect(
      (await getOfflineMapGenerations()).filter((g) => g.areaId === id),
    ).toEqual([]);
    expect((await getTileCacheStats()).pinnedTileCount).toBe(0);
  });
  it('layer preferences apply equally to manual and automatic areas while retaining cached bytes', async () => {
    await service.reconcileAutomatic([
      automatic({ layerIds: MAP_LAYERS.map((layer) => layer.id) }),
    ]);
    await service.saveManual(small);
    await service.waitForIdle();
    const before = await getTileCacheStats();
    await service.setLayers(['esri-satellite']);
    await service.waitForIdle();
    expect((await getTileCacheStats()).totalBytes).toBe(before.totalBytes);
    expect(
      service
        .getSnapshot()
        .areas.every(
          (area) => area.layerIds.length === 1 && area.revision === 1,
        ),
    ).toBe(true);
    expect(
      (await getOfflineMapGenerations()).filter(
        (g) => g.coverageKey && g.status === 'active',
      ),
    ).toHaveLength(1);
  });
  it('rejects oversized manual areas before persisting, while oversized automatic areas do not block others', async () => {
    const large = {
      ...small,
      topLeft: [-100, 60] as [number, number],
      bottomRight: [100, -60] as [number, number],
    };
    await expect(service.saveManual(large)).rejects.toThrow('smaller');
    expect((await readDownloadAreaCatalog()).areas).toEqual([]);
    await service.reconcileAutomatic([automatic(large)]);
    const id = await service.saveManual(small);
    await service.waitForIdle();
    expect(service.getSnapshot().progress[id].status).toBe('downloaded');
    const auto = service
      .getSnapshot()
      .areas.find((a) => a.type !== DownloadAreaType.Manual)!;
    expect(service.getSnapshot().progress[auto.areaId].status).toBe(
      'too-large',
    );
  });
  it('fails closed on a corrupt catalog without clearing existing storage', async () => {
    const db = await openTileDB();
    const tx = db.transaction(DOWNLOAD_AREA_SETTINGS_STORE, 'readwrite');
    tx.objectStore(DOWNLOAD_AREA_SETTINGS_STORE).put(
      { schemaVersion: 99 },
      'download-areas',
    );
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    await expect(service.preload()).rejects.toThrow('could not be read');
    expect(service.getSnapshot().error).toBeTruthy();
    await expect(readDownloadAreaCatalog()).rejects.toThrow();
  });
  it('stops foreground work and resumes from cached tiles', async () => {
    service.setForeground(false);
    const id = await service.saveManual(small);
    expect(fetchMock).not.toHaveBeenCalled();
    service.setForeground(true);
    await service.waitForIdle();
    expect(service.getSnapshot().progress[id].status).toBe('downloaded');
  });
  it('does not commit stale automatic source collection', async () => {
    online = false;
    await service.reconcileAutomatic([automatic()]);
    await expect(
      service.reconcileAutomatic([], () => {
        throw new DOMException('Superseded', 'AbortError');
      }),
    ).rejects.toThrow('Superseded');
    expect((await readDownloadAreaCatalog()).areas).toHaveLength(1);
  });
  it('keeps legacy pins until every automatic replacement succeeds, then retires legacy ownership', async () => {
    await engine.schedule({
      mode: 'rebuild',
      plan: {
        sourceRevision: 'legacy',
        projects: [],
        points: [[2, 46]],
        paths: [],
        minZoom: 0,
        maxZoom: 18,
        padMeters: 50,
      },
      layers: [
        {
          id: MAP_LAYERS[0].id,
          tileUrlTemplate: MAP_LAYERS[0].tileUrlTemplate,
        },
      ],
    });
    await engine.waitForIdle();
    const legacy = (await getOfflineMapGenerations()).filter((g) => !g.areaId);
    expect(legacy).toHaveLength(1);
    const bytes = (await getTileCacheStats()).totalBytes;
    online = false;
    await service.preload();
    expect(
      (await getOfflineMapGenerations()).some((g) => g.id === legacy[0].id),
    ).toBe(true);
    await service.reconcileAutomatic([
      automatic({
        topLeft: [8.00001, 46.00002],
        bottomRight: [8.00002, 46.00001],
      }),
    ]);
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 404 }),
    );
    online = true;
    service.resume();
    await service.waitForIdle();
    expect(
      (await getOfflineMapGenerations()).some((g) => g.id === legacy[0].id),
    ).toBe(true);
    fetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array([7, 8, 9]), {
          headers: { 'content-type': 'image/png' },
        }),
    );
    service.resume();
    await service.waitForIdle();
    expect(
      (await getOfflineMapGenerations()).every((g) => !!g.coverageKey),
    ).toBe(true);
    expect((await getTileCacheStats()).totalBytes).toBeGreaterThanOrEqual(
      bytes,
    );
  });
  it('restores separate per-layer coverage totals across overlapping areas', async () => {
    await service.reconcileAutomatic([automatic()]);
    await service.waitForIdle();
    await service.saveManual(small);
    await service.waitForIdle();
    await engine.preload();
    const state = engine.getSnapshot();
    expect(new Set(state.layers.map((layer) => layer.layerId)).size).toBe(3);
    expect(state.layers).toHaveLength(3);
    const generations = await getOfflineMapGenerations();
    for (const layer of state.layers)
      expect(layer.totalTiles).toBe(
        generations
          .filter((g) => g.layerId === layer.layerId)
          .reduce((total, g) => total + g.totalTiles, 0),
      );
    expect(state.coordinateCount).toBeGreaterThan(0);
  });
  it('clears catalog intent along with the tile cache on signout', async () => {
    await service.saveManual(small);
    await service.waitForIdle();
    service.dispose();
    engine.dispose();
    await clearCachedTiles();
    expect((await readDownloadAreaCatalog()).areas).toEqual([]);
    expect(await getOfflineMapGenerations()).toEqual([]);
    expect((await getTileCacheStats()).tileCount).toBe(0);
  });

  it('retires legacy-only pins after authoritative empty reconciliation', async () => {
    await engine.schedule({
      mode: 'rebuild',
      plan: {
        sourceRevision: 'legacy-empty',
        projects: [],
        points: [[2, 46]],
        paths: [],
        minZoom: 0,
        maxZoom: 1,
        padMeters: 50,
      },
      layers: [
        {
          id: MAP_LAYERS[0].id,
          tileUrlTemplate: MAP_LAYERS[0].tileUrlTemplate,
        },
      ],
    });
    await engine.waitForIdle();
    expect((await getTileCacheStats()).pinnedTileCount).toBeGreaterThan(0);
    await service.reconcileAutomatic([]);
    expect(await getOfflineMapGenerations()).toEqual([]);
    expect((await getTileCacheStats()).pinnedTileCount).toBe(0);
    expect((await getTileCacheStats()).tileCount).toBeGreaterThan(0);
  });
  it('serializes startup recovery before admitting user-created generations', async () => {
    const originalPreload = engine.preload.bind(engine);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const preload = vi.spyOn(engine, 'preload').mockImplementation(async () => {
      await gate;
      await originalPreload();
    });
    const startup = service.preload();
    const save = service.saveManual(small);
    expect(preload).toHaveBeenCalledOnce();
    expect((await readDownloadAreaCatalog()).areas).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    await startup;
    const id = await save;
    await service.waitForIdle();
    expect(preload).toHaveBeenCalledOnce();
    expect(service.getSnapshot().progress[id].status).toBe('downloaded');
    expect(
      (await getOfflineMapGenerations()).filter((g) => !!g.coverageKey),
    ).toHaveLength(3);
  });
  it('deduplicates the coordinate lists for every area type and reuses the immutable union on every layer toggle', async () => {
    online = false;
    const sources = Object.values(DownloadAreaType)
      .filter((type) => type !== DownloadAreaType.Manual)
      .map((type, index) =>
        automatic({
          type,
          sourceKey: `${type}:${index}`,
          objectId: `${index}`,
          topLeft: [2.00001 + index * 0.0001, 46.00002],
          bottomRight: [2.00002 + index * 0.0001, 46.00001],
        }),
      );
    await service.reconcileAutomatic(sources);
    const manual = await service.saveManual(small);
    const expected = new Set(
      service.getSnapshot().areas.flatMap((area) =>
        collectOfflineMapCoordinates({
          sourceRevision: 'expected',
          projects: [areaBounds(area)],
          points: [],
          paths: [],
          minZoom: 0,
          maxZoom: 18,
          padMeters: 0,
        }).map(({ z, x, y }) => `${z}/${x}/${y}`),
      ),
    );
    online = true;
    service.resume();
    await service.waitForIdle();
    expect(planMock).toHaveBeenCalledOnce();
    expect(service.getSyncSnapshot().coordinateCount).toBe(expected.size);
    expect(service.getSyncSnapshot().totalTiles).toBe(expected.size * 3);
    expect(fetchMock).toHaveBeenCalledTimes(expected.size * 3);
    expect(new Set(fetchMock.mock.calls.map(([url]) => url)).size).toBe(
      expected.size * 3,
    );
    const generations = await getOfflineMapGenerations();
    const satelliteId = generations.find(
      (g) => g.layerId === 'esri-satellite',
    )!.id;
    const revisions = service.getSnapshot().areas.map((area) => area.revision);
    await service.setLayers(['esri-satellite']);
    await service.waitForIdle();
    await service.setLayers(MAP_LAYERS.map((layer) => layer.id));
    await service.waitForIdle();
    await service.setVisible(manual, false);
    await service.saveManual(small, manual);
    await service.reconcileAutomatic(
      [...sources]
        .reverse()
        .map((input) => ({
          ...input,
          name: 'Renamed',
          sourceRevision: 'new provenance',
        })),
    );
    service.setForeground(false);
    service.setForeground(true);
    await service.waitForIdle();
    expect(planMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(expected.size * 3);
    expect(service.getSnapshot().areas.map((area) => area.revision)).toEqual(
      revisions,
    );
    expect(
      (await getOfflineMapGenerations()).find(
        (g) => g.layerId === 'esri-satellite',
      )!.id,
    ).toBe(satelliteId);
    expect(
      service
        .getSyncSnapshot()
        .layers.every((layer) => layer.completedTiles === expected.size),
    ).toBe(true);
  });

  it('changing enabled layers during satellite download neither aborts it nor resets its progress', async () => {
    await service.setLayers(['esri-satellite']);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      if (++calls > 8) {
        started();
        await gate;
      }
      return new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png' },
      });
    });
    const schedule = vi.spyOn(engine, 'schedule');
    await service.saveManual(small);
    try {
      await blocked;
      await vi.waitFor(() =>
        expect(service.getSyncSnapshot().completedTiles).toBeGreaterThan(0),
      );
      const before = service.getSyncSnapshot().layers[0];
      const request = schedule.mock.calls[0][0];
      await service.setLayers(['esri-satellite', 'esri-world-hillshade']);
      await service.setLayers(['esri-satellite']);
      await service.setLayers(['esri-satellite', 'esri-world-hillshade-dark']);
      expect(request.signal?.aborted).toBe(false);
      expect(schedule).toHaveBeenCalledOnce();
      const after = service.getSyncSnapshot().layers[0];
      expect(after.totalTiles).toBe(before.totalTiles);
      expect(after.completedTiles).toBeGreaterThanOrEqual(
        before.completedTiles,
      );
      expect(service.getSyncSnapshot().totalTiles).toBe(before.totalTiles * 2);
    } finally {
      release();
    }
    await service.waitForIdle();
    expect(planMock).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(
      schedule.mock.calls.map(([request]) => request.layers[0].id),
    ).toEqual(['esri-satellite', 'esri-world-hillshade-dark']);
    expect(service.getSyncSnapshot().completedTiles).toBe(
      service.getSyncSnapshot().totalTiles,
    );
  });

  it('disabling the active layer rejects late transport commits and leaves satellite generation unchanged', async () => {
    await service.setLayers(['esri-satellite']);
    await service.saveManual(small);
    await service.waitForIdle();
    const satellite = (await getOfflineMapGenerations())[0];
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    fetchMock.mockImplementation(async () => {
      started();
      await gate;
      return new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png' },
      });
    });
    const schedule = vi.spyOn(engine, 'schedule');
    await service.setLayers(['esri-satellite', 'esri-world-hillshade']);
    try {
      await blocked;
      await service.setLayers(['esri-satellite']);
      expect(schedule.mock.calls[0][0].signal?.aborted).toBe(true);
      expect(
        service.getSyncSnapshot().layers.map((layer) => layer.layerId),
      ).toEqual(['esri-satellite']);
      expect(service.getSyncSnapshot().completedTiles).toBe(
        satellite.totalTiles,
      );
    } finally {
      release();
    }
    await service.waitForIdle();
    expect(await getOfflineMapGenerations()).toEqual([satellite]);
    expect(planMock).toHaveBeenCalledOnce();
    expect((await getTileCacheStats()).pinnedTileCount).toBe(
      satellite.totalTiles,
    );
  });

  it('rebuilds coverage only for changed rectangles and restores the shared plan across restart', async () => {
    const id = await service.saveManual(small);
    await service.waitForIdle();
    expect(planMock).toHaveBeenCalledOnce();
    await service.saveManual(
      { topLeft: [3.00001, 47.00002], bottomRight: [3.00002, 47.00001] },
      id,
    );
    await service.waitForIdle();
    expect(planMock).toHaveBeenCalledTimes(2);
    const before = await getOfflineMapGenerations();
    service.dispose();
    engine.dispose();
    engine = new OfflineMapSyncEngine({
      plan: planMock,
      isOnline: () => online,
    });
    service = new DownloadAreaService(engine, () => online);
    await service.preload();
    service.resume();
    await service.waitForIdle();
    expect(await getOfflineMapGenerations()).toEqual(before);
    await service.setLayers(['esri-satellite']);
    await service.waitForIdle();
    await service.setLayers(MAP_LAYERS.map((layer) => layer.id));
    await service.waitForIdle();
    expect(planMock).toHaveBeenCalledTimes(2);
    expect(service.getSyncSnapshot().layers).toHaveLength(3);
  });
  it('editing one rectangle keeps other downloaded rectangles ready and rejects stale generation commits', async () => {
    const first = await service.saveManual(small);
    const second = await service.saveManual(small);
    await service.waitForIdle();
    const before = await getOfflineMapGenerations();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocked = new Promise<void>((resolve) => { started = resolve; });
    fetchMock.mockImplementation(async () => {
      started(); await gate;
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
    });
    await service.saveManual({ topLeft: [8.00001, 46.00002], bottomRight: [8.00002, 46.00001] }, first);
    try {
      await blocked;
      expect(service.getSnapshot().progress[second].status).toBe('downloaded');
      expect((await getOfflineMapGenerations()).filter((g) => g.status === 'active')).toEqual(before);
      await service.saveManual({ topLeft: [9.00001, 46.00002], bottomRight: [9.00002, 46.00001] }, first);
    } finally { release(); }
    await service.waitForIdle();
    const generations = await getOfflineMapGenerations();
    expect(generations).toHaveLength(3);
    expect(generations.every((g) => g.coverageKey?.includes('9.00001') && !g.coverageKey.includes('8.00001'))).toBe(true);
    expect(service.getSnapshot().progress[first].status).toBe('downloaded');
    expect(service.getSnapshot().progress[second].status).toBe('downloaded');
    expect(planMock).toHaveBeenCalledTimes(3);
  });

  it('audits incomplete restored coverage without rebuilding unchanged geometry or refetching fresh bytes', async () => {
    await service.saveManual(small);
    await service.waitForIdle();
    const original = (await getOfflineMapGenerations()).find((g) => g.layerId === 'esri-satellite')!;
    await tileRepository.setOfflineMapGeneration({ ...original, completedTiles: 0 });
    const requests = fetchMock.mock.calls.length;
    service.dispose();
    engine.dispose();
    engine = new OfflineMapSyncEngine({ plan: planMock, isOnline: () => online });
    service = new DownloadAreaService(engine, () => online);
    await service.preload();
    expect(service.getSnapshot().progress[service.getSnapshot().areas[0].areaId].status).not.toBe('downloaded');
    service.resume();
    await service.waitForIdle();
    expect(planMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    expect(service.getSyncSnapshot().completedTiles).toBe(service.getSyncSnapshot().totalTiles);
    expect((await getOfflineMapGenerations()).find((g) => g.layerId === 'esri-satellite')?.id).not.toBe(original.id);
  });

});
