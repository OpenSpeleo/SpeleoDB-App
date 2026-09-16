import { chooseDownloadAreaColor } from '../downloadAreaColors';
import { downloadCoverage, downloadLayers } from '../downloadCoverage';
import {
  DownloadAreaType,
  type DownloadAreaCatalog,
} from '../../types/downloadArea';
import type { OfflineMapGenerationRecord } from '../../types/offlineMapSync';
import { parseDownloadAreaCatalog } from '../downloadAreaGeometry';
import {
  DOWNLOAD_AREA_SETTINGS_STORE,
  OFFLINE_MAP_GENERATION_STORE,
  openTileDB,
} from './TileCacheRepository';

const CATALOG_KEY = 'download-areas';
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error('Offline map settings were not saved.'));
  });
}
export async function readDownloadAreaCatalog(): Promise<DownloadAreaCatalog> {
  const db = await openTileDB();
  const tx = db.transaction(DOWNLOAD_AREA_SETTINGS_STORE, 'readwrite');
  const completion = done(tx);
  try {
    const store = tx.objectStore(DOWNLOAD_AREA_SETTINGS_STORE);
    const catalog = parseDownloadAreaCatalog(
      await result(store.get(CATALOG_KEY)),
    );
    let changed = false;
    for (const area of catalog.areas) {
      if (area.type !== DownloadAreaType.Manual) continue;
      if (!area.color) {
        area.color = chooseDownloadAreaColor(catalog.areas);
        changed = true;
      }
      if ('name' in area) {
        delete area.name;
        changed = true;
      }
    }
    // Presentation migration never changes coverage revisions or generation pins.
    if (changed) store.put(catalog, CATALOG_KEY);
    await completion;
    return catalog;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* settled */
    }
    await completion.catch(() => {});
    throw error;
  }
}

/** Catalog intent and invalidation commit together. Payload commits reject released generations. */
export async function mutateDownloadAreaCatalog(
  mutate: (current: DownloadAreaCatalog) => DownloadAreaCatalog,
): Promise<DownloadAreaCatalog> {
  const db = await openTileDB();
  const tx = db.transaction(
    [DOWNLOAD_AREA_SETTINGS_STORE, OFFLINE_MAP_GENERATION_STORE],
    'readwrite',
  );
  const completion = done(tx);
  try {
    const store = tx.objectStore(DOWNLOAD_AREA_SETTINGS_STORE);
    const current = parseDownloadAreaCatalog(
      await result(store.get(CATALOG_KEY)),
    );
    const generations = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
    const existing = (await result(
      generations.getAll(),
    )) as OfflineMapGenerationRecord[];
    // Invoke ownership validation after the last asynchronous read. No stale
    // source request can interleave between this callback and the writes.
    const next = parseDownloadAreaCatalog(mutate(current));
    const areas = new Map(next.areas.map((area) => [area.areaId, area]));
    const coverage = downloadCoverage(next.areas);
    for (const generation of existing) {
      if (generation.coverageKey) {
        if (
          !coverage.projects.length ||
          !downloadLayers(next).some((id) => id === generation.layerId) ||
          (generation.status !== 'active' &&
            generation.coverageKey !== coverage.key)
        ) {
          generations.put(
            { ...generation, status: 'releasing' },
            generation.id,
          );
        }
        continue;
      }
      if (!generation.areaId) continue; // Legacy ownership is retained until migration finishes.
      const area = areas.get(generation.areaId);
      if (
        !area ||
        !area.layerIds.includes(
          generation.layerId as (typeof area.layerIds)[number],
        ) ||
        (generation.status !== 'active' &&
          generation.areaRevision !== area.revision)
      ) {
        generations.put({ ...generation, status: 'releasing' }, generation.id);
      }
    }
    store.put({ ...next, revision: current.revision + 1 }, CATALOG_KEY);
    await completion;
    return { ...next, revision: current.revision + 1 };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* settled */
    }
    await completion.catch(() => {});
    throw error;
  }
}

/** Commit a union only when every enabled layer is ready; old coverage stays usable meanwhile. */
export async function activateDownloadCoverage(key: string): Promise<string[]> {
  const db = await openTileDB();
  const tx = db.transaction(
    [DOWNLOAD_AREA_SETTINGS_STORE, OFFLINE_MAP_GENERATION_STORE],
    'readwrite',
  );
  const completion = done(tx);
  try {
    const catalog = parseDownloadAreaCatalog(
      await result(
        tx.objectStore(DOWNLOAD_AREA_SETTINGS_STORE).get(CATALOG_KEY),
      ),
    );
    const store = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
    const all = (await result(store.getAll())) as OfflineMapGenerationRecord[];
    if (downloadCoverage(catalog.areas).key !== key)
      throw new DOMException('Offline coverage changed', 'AbortError');
    const layers = downloadLayers(catalog);
    const complete = all.filter(
      (g) =>
        g.coverageKey === key &&
        g.completedTiles === g.totalTiles &&
        !g.failedTiles,
    );
    const ready = layers.map(
      (layerId) =>
        complete.find((g) => g.layerId === layerId && g.status === 'pending') ??
        complete.find((g) => g.layerId === layerId && g.status === 'active'),
    );
    if (ready.some((g) => !g)) {
      await completion;
      return [];
    }
    const selected = new Set(ready.map((g) => g!.id));
    const retired: string[] = [];
    for (const generation of all) {
      if (selected.has(generation.id))
        store.put({ ...generation, status: 'active' }, generation.id);
      else if (generation.coverageKey && generation.status === 'active') {
        store.put({ ...generation, status: 'releasing' }, generation.id);
        retired.push(generation.id);
      }
    }
    await completion;
    return retired;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* settled */
    }
    await completion.catch(() => {});
    throw error;
  }
}

/** All layers of an area become authoritative in the same transaction. */
export async function activateDownloadAreaGenerations(
  areaId: string,
  revision: number,
  ids: string[],
): Promise<string[]> {
  const db = await openTileDB();
  const tx = db.transaction(
    [DOWNLOAD_AREA_SETTINGS_STORE, OFFLINE_MAP_GENERATION_STORE],
    'readwrite',
  );
  const completion = done(tx);
  try {
    const catalog = parseDownloadAreaCatalog(
      await result(
        tx.objectStore(DOWNLOAD_AREA_SETTINGS_STORE).get(CATALOG_KEY),
      ),
    );
    const area = catalog.areas.find(
      (item) => item.areaId === areaId && item.revision === revision,
    );
    if (!area) throw new DOMException('Offline area changed', 'AbortError');
    const store = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
    const all = (await result(store.getAll())) as OfflineMapGenerationRecord[];
    const selected = all.filter((item) => ids.includes(item.id));
    const complete = (g: OfflineMapGenerationRecord) =>
      g.completedTiles === g.totalTiles && g.failedTiles === 0;
    if (
      selected.length !== ids.length ||
      selected.some(
        (g) =>
          g.areaId !== areaId ||
          g.areaRevision !== revision ||
          g.status !== 'pending' ||
          !complete(g),
      ) ||
      area.layerIds.some(
        (layerId) =>
          !selected.some((g) => g.layerId === layerId) &&
          !all.some(
            (g) =>
              g.areaId === areaId &&
              g.areaRevision === revision &&
              g.layerId === layerId &&
              g.status === 'active' &&
              complete(g),
          ),
      )
    ) {
      throw new Error('Offline area layers are not complete.');
    }
    const retired: string[] = [];
    for (const generation of all) {
      if (generation.areaId !== areaId || ids.includes(generation.id)) continue;
      if (
        generation.status === 'active' &&
        selected.some((g) => g.layerId === generation.layerId)
      ) {
        store.put({ ...generation, status: 'releasing' }, generation.id);
        retired.push(generation.id);
      }
    }
    for (const generation of selected)
      store.put({ ...generation, status: 'active' }, generation.id);
    await completion;
    return retired;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* settled */
    }
    await completion.catch(() => {});
    throw error;
  }
}
