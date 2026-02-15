import type { TilePrefetchJobState } from '../../types/tilePrefetch';
import type {
  TileCacheEvictionResult,
  TileCacheStatsRecord,
  TileMetadataRecord,
} from '../../types/tileCache';

export const TILE_DB_NAME = 'speleo_tiles';
export const TILE_DB_VERSION = 3;
export const TILE_STORE = 'tiles';
export const PREFETCH_JOB_STORE = 'prefetch_jobs';
export const TILE_METADATA_STORE = 'tile_metadata';
export const TILE_STATS_STORE = 'tile_cache_stats';
const TILE_STATS_KEY = 'global';

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function buildEmptyStats(now: number): TileCacheStatsRecord {
  return {
    totalBytes: 0,
    tileCount: 0,
    pinnedBytes: 0,
    pinnedTileCount: 0,
    updatedAt: now,
  };
}

export function __resetTileCacheRepositoryForTests(): void {
  dbPromise = null;
}

export async function __closeTileCacheRepositoryForTests(): Promise<void> {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    db.close();
  } catch {
    // no-op
  } finally {
    dbPromise = null;
  }
}

export async function clearCachedTiles(now = Date.now()): Promise<void> {
  const db = await openTileDB();
  const tx = db.transaction(
    [TILE_STORE, TILE_METADATA_STORE, TILE_STATS_STORE],
    'readwrite',
  );
  tx.objectStore(TILE_STORE).clear();
  tx.objectStore(TILE_METADATA_STORE).clear();
  tx.objectStore(TILE_STATS_STORE).put(buildEmptyStats(now), TILE_STATS_KEY);
  await transactionDone(tx);
}

export async function __clearTileCacheRepositoryForTests(): Promise<void> {
  await clearCachedTiles(Date.now());
  const db = await openTileDB();
  const tx = db.transaction(PREFETCH_JOB_STORE, 'readwrite');
  tx.objectStore(PREFETCH_JOB_STORE).clear();
  await transactionDone(tx);
}

export async function openTileDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TILE_DB_NAME, TILE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE);
      }
      if (!db.objectStoreNames.contains(PREFETCH_JOB_STORE)) {
        db.createObjectStore(PREFETCH_JOB_STORE);
      }
      if (!db.objectStoreNames.contains(TILE_METADATA_STORE)) {
        db.createObjectStore(TILE_METADATA_STORE);
      }
      if (!db.objectStoreNames.contains(TILE_STATS_STORE)) {
        db.createObjectStore(TILE_STATS_STORE);
      }

      // v2 -> v3 migration: backfill metadata + stats for existing tile payloads.
      if (oldVersion < 3) {
        const tileStore = tx.objectStore(TILE_STORE);
        const metadataStore = tx.objectStore(TILE_METADATA_STORE);
        const statsStore = tx.objectStore(TILE_STATS_STORE);
        const now = Date.now();
        const stats = buildEmptyStats(now);

        const cursorReq = tileStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            stats.updatedAt = now;
            statsStore.put(stats, TILE_STATS_KEY);
            return;
          }

          const key = String(cursor.key);
          const value = cursor.value as ArrayBuffer;
          const sizeBytes = value?.byteLength ?? 0;
          const metadata: TileMetadataRecord = {
            url: key,
            sizeBytes,
            lastAccessedAt: now,
            pinnedByAutoPrefetch: false,
            createdAt: now,
            updatedAt: now,
          };
          metadataStore.put(metadata, key);
          stats.totalBytes += sizeBytes;
          stats.tileCount += 1;
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function getTile(url: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(TILE_STORE, 'readonly');
    const req = tx.objectStore(TILE_STORE).get(url);
    return (await requestToPromise(req)) ?? null;
  } catch {
    return null;
  }
}

export async function getTileMetadata(
  url: string,
): Promise<TileMetadataRecord | null> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(TILE_METADATA_STORE, 'readonly');
    const req = tx.objectStore(TILE_METADATA_STORE).get(url);
    return (await requestToPromise(req)) ?? null;
  } catch {
    return null;
  }
}

async function writeStats(
  statsStore: IDBObjectStore,
  stats: TileCacheStatsRecord,
): Promise<void> {
  await requestToPromise(statsStore.put(stats, TILE_STATS_KEY));
}

async function readStats(
  statsStore: IDBObjectStore,
  now: number,
): Promise<TileCacheStatsRecord> {
  const stats = (await requestToPromise(
    statsStore.get(TILE_STATS_KEY),
  )) as TileCacheStatsRecord | null;
  return stats ?? buildEmptyStats(now);
}

export async function getTileCacheStats(
  now = Date.now(),
): Promise<TileCacheStatsRecord> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(TILE_STATS_STORE, 'readonly');
    const stats = (await requestToPromise(
      tx.objectStore(TILE_STATS_STORE).get(TILE_STATS_KEY),
    )) as TileCacheStatsRecord | null;
    if (stats) return stats;
    return buildEmptyStats(now);
  } catch {
    return buildEmptyStats(now);
  }
}

export async function upsertTile(
  url: string,
  value: ArrayBuffer,
  options: { pinnedByAutoPrefetch: boolean; now?: number },
): Promise<void> {
  const now = options.now ?? Date.now();
  const db = await openTileDB();
  const tx = db.transaction(
    [TILE_STORE, TILE_METADATA_STORE, TILE_STATS_STORE],
    'readwrite',
  );
  const tileStore = tx.objectStore(TILE_STORE);
  const metadataStore = tx.objectStore(TILE_METADATA_STORE);
  const statsStore = tx.objectStore(TILE_STATS_STORE);

  const previousMetadata = (await requestToPromise(
    metadataStore.get(url),
  )) as TileMetadataRecord | null;
  const previousTile = previousMetadata
    ? null
    : ((await requestToPromise(tileStore.get(url))) as ArrayBuffer | null);

  const previousSizeBytes =
    previousMetadata?.sizeBytes ?? previousTile?.byteLength ?? 0;
  const hadExistingTile = previousMetadata !== null || previousTile !== null;
  const wasPinned = previousMetadata?.pinnedByAutoPrefetch ?? false;

  await requestToPromise(tileStore.put(value, url));

  const nextPinned = wasPinned || options.pinnedByAutoPrefetch;
  const nextMetadata: TileMetadataRecord = {
    url,
    sizeBytes: value.byteLength,
    lastAccessedAt: now,
    pinnedByAutoPrefetch: nextPinned,
    createdAt: previousMetadata?.createdAt ?? now,
    updatedAt: now,
  };
  await requestToPromise(metadataStore.put(nextMetadata, url));

  const stats = await readStats(statsStore, now);
  stats.totalBytes += value.byteLength - previousSizeBytes;
  if (!hadExistingTile) {
    stats.tileCount += 1;
  }
  const previousPinnedBytes = wasPinned ? previousSizeBytes : 0;
  const nextPinnedBytes = nextPinned ? value.byteLength : 0;
  stats.pinnedBytes += nextPinnedBytes - previousPinnedBytes;
  if (!wasPinned && nextPinned) {
    stats.pinnedTileCount += 1;
  }
  stats.updatedAt = now;
  await writeStats(statsStore, stats);
  await transactionDone(tx);
}

export async function touchTileAccess(
  url: string,
  now = Date.now(),
): Promise<void> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(TILE_METADATA_STORE, 'readwrite');
    const store = tx.objectStore(TILE_METADATA_STORE);
    const metadata = (await requestToPromise(store.get(url))) as
      | TileMetadataRecord
      | null;
    if (!metadata) {
      await transactionDone(tx);
      return;
    }
    metadata.lastAccessedAt = now;
    metadata.updatedAt = now;
    await requestToPromise(store.put(metadata, url));
    await transactionDone(tx);
  } catch {
    // Best effort to preserve read-path speed.
  }
}

export async function touchPinnedTiles(
  now = Date.now(),
): Promise<number> {
  const db = await openTileDB();
  const tx = db.transaction(TILE_METADATA_STORE, 'readwrite');
  const store = tx.objectStore(TILE_METADATA_STORE);

  return new Promise<number>((resolve, reject) => {
    const request = store.openCursor();
    let touched = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const metadata = cursor.value as TileMetadataRecord;
      if (metadata.pinnedByAutoPrefetch) {
        metadata.lastAccessedAt = now;
        metadata.updatedAt = now;
        cursor.update(metadata);
        touched += 1;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(touched);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listUnpinnedTilesOldestFirst(): Promise<
  TileMetadataRecord[]
> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(TILE_METADATA_STORE, 'readonly');
    const store = tx.objectStore(TILE_METADATA_STORE);
    const request = store.getAll();
    const result = ((await requestToPromise(request)) as TileMetadataRecord[]) ?? [];
    return result
      .filter((metadata) => !metadata.pinnedByAutoPrefetch)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  } catch {
    return [];
  }
}

export async function deleteTilesByMetadata(
  candidates: TileMetadataRecord[],
  now = Date.now(),
): Promise<TileCacheEvictionResult> {
  if (candidates.length === 0) {
    return { evictedTileCount: 0, freedBytes: 0 };
  }

  const db = await openTileDB();
  const tx = db.transaction(
    [TILE_STORE, TILE_METADATA_STORE, TILE_STATS_STORE],
    'readwrite',
  );
  const tileStore = tx.objectStore(TILE_STORE);
  const metadataStore = tx.objectStore(TILE_METADATA_STORE);
  const statsStore = tx.objectStore(TILE_STATS_STORE);

  let freedBytes = 0;
  let evictedTileCount = 0;
  let pinnedBytesFreed = 0;
  let pinnedTilesFreed = 0;

  for (const metadata of candidates) {
    await requestToPromise(tileStore.delete(metadata.url));
    await requestToPromise(metadataStore.delete(metadata.url));
    freedBytes += metadata.sizeBytes;
    evictedTileCount += 1;
    if (metadata.pinnedByAutoPrefetch) {
      pinnedBytesFreed += metadata.sizeBytes;
      pinnedTilesFreed += 1;
    }
  }

  const stats = await readStats(statsStore, now);
  stats.totalBytes = Math.max(0, stats.totalBytes - freedBytes);
  stats.tileCount = Math.max(0, stats.tileCount - evictedTileCount);
  stats.pinnedBytes = Math.max(0, stats.pinnedBytes - pinnedBytesFreed);
  stats.pinnedTileCount = Math.max(0, stats.pinnedTileCount - pinnedTilesFreed);
  stats.updatedAt = now;
  await writeStats(statsStore, stats);
  await transactionDone(tx);

  return { evictedTileCount, freedBytes };
}

export async function hasTile(url: string): Promise<boolean> {
  return (await getTile(url)) !== null;
}

export async function getPrefetchJob(
  projectId: string,
): Promise<TilePrefetchJobState | null> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(PREFETCH_JOB_STORE, 'readonly');
    const req = tx.objectStore(PREFETCH_JOB_STORE).get(projectId);
    return (await requestToPromise(req)) ?? null;
  } catch {
    return null;
  }
}

export async function getAllPrefetchJobs(): Promise<TilePrefetchJobState[]> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(PREFETCH_JOB_STORE, 'readonly');
    const req = tx.objectStore(PREFETCH_JOB_STORE).getAll();
    return ((await requestToPromise(req)) as TilePrefetchJobState[]) ?? [];
  } catch {
    return [];
  }
}

export async function setPrefetchJob(job: TilePrefetchJobState): Promise<void> {
  const db = await openTileDB();
  const tx = db.transaction(PREFETCH_JOB_STORE, 'readwrite');
  await requestToPromise(tx.objectStore(PREFETCH_JOB_STORE).put(job, job.projectId));
  await transactionDone(tx);
}

export async function clearPrefetchJobs(): Promise<void> {
  const db = await openTileDB();
  const tx = db.transaction(PREFETCH_JOB_STORE, 'readwrite');
  await requestToPromise(tx.objectStore(PREFETCH_JOB_STORE).clear());
  await transactionDone(tx);
}
