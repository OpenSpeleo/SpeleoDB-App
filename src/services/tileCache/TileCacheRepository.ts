import type {
  TileCacheEntry,
  TileCacheEvictionResult,
  TileCacheStatsRecord,
  TileMetadataRecord,
  TileWriteOptions,
} from '../../types/tileCache';
import type {
  OfflineMapGenerationRecord,
  OfflineMapMembershipRecord,
  OfflineMapPlanCoordinateRecord,
  OfflineMapPlanChunkRecord,
  OfflineMapPlanRecord,
} from '../../types/offlineMapSync';

export const TILE_DB_NAME = 'speleo_tiles';
export const TILE_DB_VERSION = 8;
export const TILE_STORE = 'tiles';
export const PREFETCH_JOB_STORE = 'prefetch_jobs';
export const TILE_METADATA_STORE = 'tile_metadata';
export const TILE_STATS_STORE = 'tile_cache_stats';
export const TILE_OWNER_STORE = 'tile_prefetch_owners';
export const OFFLINE_MAP_PLAN_STORE = 'offline_map_plans';
export const OFFLINE_MAP_PLAN_CHUNK_STORE = 'offline_map_plan_chunks';
export const OFFLINE_MAP_PLAN_COORDINATE_STORE = 'offline_map_plan_coordinates';
export const OFFLINE_MAP_GENERATION_STORE = 'offline_map_generations';
export const OFFLINE_MAP_MEMBERSHIP_STORE = 'offline_map_memberships';

const TILE_STATS_KEY = 'global';
const LAST_ACCESSED_INDEX = 'last_accessed_at';
const OWNER_KEY_INDEX = 'owner_key';
const OWNER_URL_INDEX = 'owner_url';
const PLAN_REVISION_INDEX = 'source_revision';
const PLAN_CHUNK_PLAN_INDEX = 'plan_id';
const PLAN_COORDINATE_BUILD_INDEX = 'build_id';
const GENERATION_LAYER_INDEX = 'layer_id';
const GENERATION_PLAN_INDEX = 'plan_id';
const GENERATION_STATUS_INDEX = 'status';
const MEMBERSHIP_GENERATION_INDEX = 'generation_id';
const MEMBERSHIP_URL_INDEX = 'membership_url';
const LEGACY_OWNER_KEY = '__legacy_prefetch__';
const LEGACY_SATELLITE_LAYER_ID = 'esri-satellite';
const ACCESS_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LEGACY_FRESHNESS_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const PLAN_GC_GRACE_MS = 60 * 60 * 1000;
const V7_MIGRATION_KEY = '__offline_map_v7_migration__';
const V7_MIGRATION_BATCH_SIZE = 250;

interface OfflineMapV7MigrationState {
  metadataCursor?: IDBValidKey;
  ownerCursor?: IDBValidKey;
  metadataDone: boolean;
  ownersDone: boolean;
  completedAt?: number;
}

interface LegacyTileMetadataRecord extends Partial<TileMetadataRecord> {
  url: string;
  sizeBytes: number;
}

interface TilePrefetchOwnerRecord {
  ownerKey: string;
  url: string;
  generation: number;
  updatedAt: number;
}

function ownerRecordKey(ownerKey: string, generation: number, url: string): string {
  return `${ownerKey}\u0000${generation}\u0000${url}`;
}

function membershipRecordKey(generationId: string, url: string): string {
  return `${generationId}\u0000${url}`;
}

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
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function bindAbortSignal(transaction: IDBTransaction, signal?: AbortSignal): () => void {
  if (!signal) return () => {};
  const abort = () => {
    try { transaction.abort(); } catch { /* already completed */ }
  };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function runMutation<T>(operation: () => Promise<T>): Promise<T> {
  // IndexedDB serializes overlapping read-write transactions itself. A second
  // JavaScript-wide queue made unrelated reads, ownership claims, and tile
  // writes wait behind one another before IndexedDB could schedule them.
  return operation();
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

function normalizeMetadata(
  value: LegacyTileMetadataRecord | null | undefined,
  now = Date.now(),
): TileMetadataRecord | null {
  if (!value) return null;
  const legacyPinned = value.pinnedByAutoPrefetch === true;
  const ownerCount = Number.isFinite(value.prefetchOwnerCount)
    ? Math.max(0, Math.floor(value.prefetchOwnerCount ?? 0))
    : legacyPinned ? 1 : 0;
  return {
    url: value.url,
    sizeBytes: Number.isFinite(value.sizeBytes) ? Math.max(0, value.sizeBytes) : 0,
    isNoData: value.isNoData === true,
    fetchedAt: Number.isFinite(value.fetchedAt) && (value.fetchedAt ?? 0) > 0
      ? value.fetchedAt!
      : now,
    lastAccessedAt: Number.isFinite(value.lastAccessedAt)
      ? Math.max(0, value.lastAccessedAt ?? 0)
      : now,
    prefetchOwnerCount: ownerCount,
    pinnedByAutoPrefetch: ownerCount > 0,
    createdAt: Number.isFinite(value.createdAt) ? Math.max(0, value.createdAt ?? 0) : now,
    updatedAt: Number.isFinite(value.updatedAt) ? Math.max(0, value.updatedAt ?? 0) : now,
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

export async function openTileDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TILE_DB_NAME, TILE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains(TILE_STORE)) db.createObjectStore(TILE_STORE);
      const metadataStore = db.objectStoreNames.contains(TILE_METADATA_STORE)
        ? tx.objectStore(TILE_METADATA_STORE)
        : db.createObjectStore(TILE_METADATA_STORE);
      if (!metadataStore.indexNames.contains(LAST_ACCESSED_INDEX)) {
        metadataStore.createIndex(LAST_ACCESSED_INDEX, 'lastAccessedAt');
      }
      if (!db.objectStoreNames.contains(TILE_STATS_STORE)) db.createObjectStore(TILE_STATS_STORE);
      const ownerStore = db.objectStoreNames.contains(TILE_OWNER_STORE)
        ? tx.objectStore(TILE_OWNER_STORE)
        : db.createObjectStore(TILE_OWNER_STORE);
      if (!ownerStore.indexNames.contains(OWNER_KEY_INDEX)) {
        ownerStore.createIndex(OWNER_KEY_INDEX, 'ownerKey');
      }
      if (!ownerStore.indexNames.contains(OWNER_URL_INDEX)) {
        ownerStore.createIndex(OWNER_URL_INDEX, 'url');
      }
      const planStore = db.objectStoreNames.contains(OFFLINE_MAP_PLAN_STORE)
        ? tx.objectStore(OFFLINE_MAP_PLAN_STORE)
        : db.createObjectStore(OFFLINE_MAP_PLAN_STORE);
      if (!planStore.indexNames.contains(PLAN_REVISION_INDEX)) {
        planStore.createIndex(PLAN_REVISION_INDEX, 'sourceRevision', { unique: true });
      }
      const planChunkStore = db.objectStoreNames.contains(OFFLINE_MAP_PLAN_CHUNK_STORE)
        ? tx.objectStore(OFFLINE_MAP_PLAN_CHUNK_STORE)
        : db.createObjectStore(OFFLINE_MAP_PLAN_CHUNK_STORE);
      if (!planChunkStore.indexNames.contains(PLAN_CHUNK_PLAN_INDEX)) {
        planChunkStore.createIndex(PLAN_CHUNK_PLAN_INDEX, 'planId');
      }
      const planCoordinateStore = db.objectStoreNames.contains(OFFLINE_MAP_PLAN_COORDINATE_STORE)
        ? tx.objectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE)
        : db.createObjectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE, {
          keyPath: ['buildId', 'z', 'x', 'y'],
        });
      if (!planCoordinateStore.indexNames.contains(PLAN_COORDINATE_BUILD_INDEX)) {
        planCoordinateStore.createIndex(PLAN_COORDINATE_BUILD_INDEX, 'buildId');
      }
      const generationStore = db.objectStoreNames.contains(OFFLINE_MAP_GENERATION_STORE)
        ? tx.objectStore(OFFLINE_MAP_GENERATION_STORE)
        : db.createObjectStore(OFFLINE_MAP_GENERATION_STORE);
      if (!generationStore.indexNames.contains(GENERATION_LAYER_INDEX)) {
        generationStore.createIndex(GENERATION_LAYER_INDEX, 'layerId');
      }
      if (!generationStore.indexNames.contains(GENERATION_PLAN_INDEX)) {
        generationStore.createIndex(GENERATION_PLAN_INDEX, 'planId');
      }
      if (!generationStore.indexNames.contains(GENERATION_STATUS_INDEX)) {
        generationStore.createIndex(GENERATION_STATUS_INDEX, 'status');
      }
      const membershipStore = db.objectStoreNames.contains(OFFLINE_MAP_MEMBERSHIP_STORE)
        ? tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE)
        : db.createObjectStore(OFFLINE_MAP_MEMBERSHIP_STORE);
      if (!membershipStore.indexNames.contains(MEMBERSHIP_GENERATION_INDEX)) {
        membershipStore.createIndex(MEMBERSHIP_GENERATION_INDEX, 'generationId');
      }
      if (!membershipStore.indexNames.contains(MEMBERSHIP_URL_INDEX)) {
        membershipStore.createIndex(MEMBERSHIP_URL_INDEX, 'url');
      }

      const now = Date.now();
      const stats = buildEmptyStats(now);

      if (oldVersion < 3) {
        const tileStore = tx.objectStore(TILE_STORE);
        const cursorRequest = tileStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            tx.objectStore(TILE_STATS_STORE).put(stats, TILE_STATS_KEY);
            return;
          }
          const url = String(cursor.key);
          const value = cursor.value as ArrayBuffer;
          const metadata: TileMetadataRecord = {
            url,
            sizeBytes: value?.byteLength ?? 0,
            isNoData: false,
            fetchedAt: now,
            lastAccessedAt: now,
            prefetchOwnerCount: 0,
            pinnedByAutoPrefetch: false,
            createdAt: now,
            updatedAt: now,
          };
          metadataStore.put(metadata, url);
          stats.totalBytes += metadata.sizeBytes;
          stats.tileCount += 1;
          cursor.continue();
        };
      } else if (oldVersion < 5) {
        const cursorRequest = metadataStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            stats.updatedAt = now;
            tx.objectStore(TILE_STATS_STORE).put(stats, TILE_STATS_KEY);
            return;
          }
          const metadata = normalizeMetadata(cursor.value as LegacyTileMetadataRecord, now);
          if (metadata) {
            if (metadata.pinnedByAutoPrefetch) {
              metadata.prefetchOwnerCount = 1;
              const owner: TilePrefetchOwnerRecord = {
                ownerKey: LEGACY_OWNER_KEY,
                url: metadata.url,
                generation: 0,
                updatedAt: now,
              };
              ownerStore.put(
                owner,
                ownerRecordKey(owner.ownerKey, owner.generation, owner.url),
              );
              stats.pinnedBytes += metadata.sizeBytes;
              stats.pinnedTileCount += 1;
            }
            metadata.fetchedAt = now;
            cursor.update(metadata);
            stats.totalBytes += metadata.sizeBytes;
            stats.tileCount += 1;
          }
          cursor.continue();
        };
      }

      if (oldVersion === 5) {
        const cursorRequest = metadataStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const metadata = cursor.value as LegacyTileMetadataRecord;
          if (!Number.isFinite(metadata.fetchedAt) || (metadata.fetchedAt ?? 0) <= 0) {
            cursor.update({ ...metadata, fetchedAt: now, updatedAt: now });
          }
          cursor.continue();
        };
      }

      // Per-target jobs are not part of v7. Their owner records are converted
      // incrementally after opening, but the obsolete job snapshots themselves
      // must not remain as a second synchronization authority.
      if (db.objectStoreNames.contains(PREFETCH_JOB_STORE)) {
        db.deleteObjectStore(PREFETCH_JOB_STORE);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open tile cache'));
  });

  const trackedOpening = opening.catch((error) => {
    if (dbPromise === trackedOpening) dbPromise = null;
    throw error;
  });
  dbPromise = trackedOpening;
  return trackedOpening;
}

export async function clearCachedTiles(now = Date.now()): Promise<void> {
  await runMutation(async () => {
    const db = await openTileDB();
    const tx = db.transaction(
      [
        TILE_STORE,
        TILE_METADATA_STORE,
        TILE_STATS_STORE,
        TILE_OWNER_STORE,
        OFFLINE_MAP_PLAN_STORE,
        OFFLINE_MAP_PLAN_CHUNK_STORE,
        OFFLINE_MAP_PLAN_COORDINATE_STORE,
        OFFLINE_MAP_GENERATION_STORE,
        OFFLINE_MAP_MEMBERSHIP_STORE,
      ],
      'readwrite',
    );
    tx.objectStore(TILE_STORE).clear();
    tx.objectStore(TILE_METADATA_STORE).clear();
    tx.objectStore(TILE_OWNER_STORE).clear();
    tx.objectStore(OFFLINE_MAP_PLAN_STORE).clear();
    tx.objectStore(OFFLINE_MAP_PLAN_CHUNK_STORE).clear();
    tx.objectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE).clear();
    tx.objectStore(OFFLINE_MAP_GENERATION_STORE).clear();
    tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE).clear();
    tx.objectStore(TILE_STATS_STORE).put(buildEmptyStats(now), TILE_STATS_KEY);
    await transactionDone(tx);
  });
}

export async function __clearTileCacheRepositoryForTests(): Promise<void> {
  await clearCachedTiles(Date.now());
}

export async function getTileEntry(url: string): Promise<TileCacheEntry | null> {
  try {
    const db = await openTileDB();
    const tx = db.transaction([TILE_STORE, TILE_METADATA_STORE], 'readonly');
    const tileRequest = tx.objectStore(TILE_STORE).get(url);
    const metadataRequest = tx.objectStore(TILE_METADATA_STORE).get(url);
    const [data, metadataValue] = await Promise.all([
      requestToPromise(tileRequest),
      requestToPromise(metadataRequest),
    ]);
    const metadata = normalizeMetadata(
      metadataValue as LegacyTileMetadataRecord | undefined,
    );
    if (data === undefined || data === null) {
      return metadata?.isNoData ? { data: null, metadata } : null;
    }
    return {
      data: data as ArrayBuffer,
      metadata,
    };
  } catch {
    return null;
  }
}

export async function getTile(url: string): Promise<ArrayBuffer | null> {
  return (await getTileEntry(url))?.data ?? null;
}

export async function getTileMetadata(url: string): Promise<TileMetadataRecord | null> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(TILE_METADATA_STORE, 'readonly');
    const value = await requestToPromise(tx.objectStore(TILE_METADATA_STORE).get(url));
    return normalizeMetadata(value as LegacyTileMetadataRecord | undefined);
  } catch {
    return null;
  }
}

async function readStats(store: IDBObjectStore, now: number): Promise<TileCacheStatsRecord> {
  const value = await requestToPromise(store.get(TILE_STATS_KEY));
  return (value as TileCacheStatsRecord | undefined) ?? buildEmptyStats(now);
}

export async function getTileCacheStats(now = Date.now()): Promise<TileCacheStatsRecord> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(TILE_STATS_STORE, 'readonly');
    return await readStats(tx.objectStore(TILE_STATS_STORE), now);
  } catch {
    return buildEmptyStats(now);
  }
}

function planChunkKey(planId: string, index: number): string {
  return `${planId}\u0000${String(index).padStart(8, '0')}`;
}

export async function getOfflineMapPlanByRevision(
  sourceRevision: string,
): Promise<OfflineMapPlanRecord | null> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(OFFLINE_MAP_PLAN_STORE, 'readonly');
    const value = await requestToPromise(
      tx.objectStore(OFFLINE_MAP_PLAN_STORE)
        .index(PLAN_REVISION_INDEX)
        .get(sourceRevision),
    );
    return (value as OfflineMapPlanRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function getOfflineMapPlanById(
  planId: string,
): Promise<OfflineMapPlanRecord | null> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(OFFLINE_MAP_PLAN_STORE, 'readonly');
    const value = await requestToPromise(
      tx.objectStore(OFFLINE_MAP_PLAN_STORE).get(planId),
    );
    return (value as OfflineMapPlanRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function stageOfflineMapCoordinates(
  buildId: string,
  coordinates: Uint32Array,
): Promise<void> {
  if (coordinates.length % 3 !== 0) {
    throw new Error('Offline-map staging coordinates must be z/x/y triples');
  }
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_PLAN_COORDINATE_STORE, 'readwrite');
  const store = tx.objectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE);
  for (let index = 0; index + 2 < coordinates.length; index += 3) {
    store.put({
      buildId,
      z: coordinates[index],
      x: coordinates[index + 1],
      y: coordinates[index + 2],
    } satisfies OfflineMapPlanCoordinateRecord);
  }
  await transactionDone(tx);
}

export async function countStagedOfflineMapCoordinates(buildId: string): Promise<number> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_PLAN_COORDINATE_STORE, 'readonly');
  return requestToPromise(
    tx.objectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE)
      .index(PLAN_COORDINATE_BUILD_INDEX)
      .count(IDBKeyRange.only(buildId)),
  );
}

export interface OfflineMapCoordinatePage {
  coordinates: Uint32Array;
  lastKey: IDBValidKey | null;
}

export async function getStagedOfflineMapCoordinatePage(
  buildId: string,
  afterKey: IDBValidKey | null,
  limit: number,
): Promise<OfflineMapCoordinatePage> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_PLAN_COORDINATE_STORE, 'readonly');
  const store = tx.objectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE);
  const range = afterKey === null
    ? IDBKeyRange.lowerBound([buildId, 0, 0, 0])
    : IDBKeyRange.lowerBound(afterKey, true);
  return new Promise<OfflineMapCoordinatePage>((resolve, reject) => {
    const values: number[] = [];
    let lastKey: IDBValidKey | null = null;
    const request = store.openCursor(range);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || values.length / 3 >= limit) {
        resolve({ coordinates: new Uint32Array(values), lastKey });
        return;
      }
      const value = cursor.value as OfflineMapPlanCoordinateRecord;
      if (value.buildId !== buildId) {
        resolve({ coordinates: new Uint32Array(values), lastKey });
        return;
      }
      values.push(value.z, value.x, value.y);
      lastKey = cursor.primaryKey;
      cursor.continue();
    };
  });
}

const PLAN_DELETE_BATCH_SIZE = 250;

export async function deleteStagedOfflineMapCoordinates(buildId: string): Promise<void> {
  while (true) {
    const db = await openTileDB();
    const tx = db.transaction(OFFLINE_MAP_PLAN_COORDINATE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE);
    const keys = await requestToPromise(
      store.index(PLAN_COORDINATE_BUILD_INDEX).getAllKeys(
        IDBKeyRange.only(buildId),
        PLAN_DELETE_BATCH_SIZE,
      ),
    );
    for (const key of keys) store.delete(key);
    await transactionDone(tx);
    if (keys.length < PLAN_DELETE_BATCH_SIZE) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** Startup-only recovery for raw staging left behind by a crashed planner. */
export async function recoverOfflineMapPlanStorage(): Promise<void> {
  let afterChunkKey: IDBValidKey | undefined;
  while (true) {
    const db = await openTileDB();
    const tx = db.transaction(OFFLINE_MAP_PLAN_COORDINATE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_MAP_PLAN_COORDINATE_STORE);
    const keys = await requestToPromise(store.getAllKeys(undefined, 250));
    for (const key of keys) store.delete(key);
    await transactionDone(tx);
    if (keys.length < 250) break;
  }

  while (true) {
    const db = await openTileDB();
    const readTx = db.transaction(
      [OFFLINE_MAP_PLAN_CHUNK_STORE, OFFLINE_MAP_PLAN_STORE],
      'readonly',
    );
    const chunkStore = readTx.objectStore(OFFLINE_MAP_PLAN_CHUNK_STORE);
    const range = afterChunkKey === undefined
      ? undefined
      : IDBKeyRange.lowerBound(afterChunkKey, true);
    const [keys, chunks] = await Promise.all([
      requestToPromise(chunkStore.getAllKeys(range, 250)),
      requestToPromise(chunkStore.getAll(range, 250)),
    ]);
    const orphanPlanIds = new Set<string>();
    for (const value of chunks) {
      const planId = (value as OfflineMapPlanChunkRecord).planId;
      if (typeof planId !== 'string') continue;
      const manifest = await requestToPromise(
        readTx.objectStore(OFFLINE_MAP_PLAN_STORE).get(planId),
      );
      if (!manifest) orphanPlanIds.add(planId);
    }
    await transactionDone(readTx);
    for (const planId of orphanPlanIds) await deleteOfflineMapPlanChunks(planId);
    if (keys.length < 250) break;
    afterChunkKey = keys.at(-1);
  }
}

export async function putOfflineMapPlanChunk(
  chunk: OfflineMapPlanChunkRecord,
): Promise<void> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_PLAN_CHUNK_STORE, 'readwrite');
  await requestToPromise(
    tx.objectStore(OFFLINE_MAP_PLAN_CHUNK_STORE)
      .put(chunk, planChunkKey(chunk.planId, chunk.index)),
  );
  await transactionDone(tx);
}

export async function commitOfflineMapPlan(plan: OfflineMapPlanRecord): Promise<void> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_PLAN_STORE, 'readwrite');
  await requestToPromise(tx.objectStore(OFFLINE_MAP_PLAN_STORE).put(plan, plan.id));
  await transactionDone(tx);
}

export async function getOfflineMapPlanChunk(
  planId: string,
  index: number,
): Promise<OfflineMapPlanChunkRecord | null> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_PLAN_CHUNK_STORE, 'readonly');
  const value = await requestToPromise(
    tx.objectStore(OFFLINE_MAP_PLAN_CHUNK_STORE).get(planChunkKey(planId, index)),
  );
  return (value as OfflineMapPlanChunkRecord | undefined) ?? null;
}

export async function deleteOfflineMapPlanChunks(planId: string): Promise<void> {
  while (true) {
    const db = await openTileDB();
    const tx = db.transaction(OFFLINE_MAP_PLAN_CHUNK_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_MAP_PLAN_CHUNK_STORE);
    const keys = await requestToPromise(
      store.index(PLAN_CHUNK_PLAN_INDEX).getAllKeys(
        IDBKeyRange.only(planId),
        PLAN_DELETE_BATCH_SIZE,
      ),
    );
    for (const key of keys) store.delete(key);
    await transactionDone(tx);
    if (keys.length < PLAN_DELETE_BATCH_SIZE) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

export async function deleteOfflineMapPlan(planId: string): Promise<void> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_PLAN_STORE, 'readwrite');
  tx.objectStore(OFFLINE_MAP_PLAN_STORE).delete(planId);
  await transactionDone(tx);
  await deleteOfflineMapPlanChunks(planId);
}

export async function setOfflineMapGeneration(
  generation: OfflineMapGenerationRecord,
): Promise<void> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_GENERATION_STORE, 'readwrite');
  await requestToPromise(
    tx.objectStore(OFFLINE_MAP_GENERATION_STORE).put(generation, generation.id),
  );
  await transactionDone(tx);
}

export async function getOfflineMapGenerations(): Promise<OfflineMapGenerationRecord[]> {
  try {
    const db = await openTileDB();
    const tx = db.transaction(OFFLINE_MAP_GENERATION_STORE, 'readonly');
    return await requestToPromise(
      tx.objectStore(OFFLINE_MAP_GENERATION_STORE).getAll(),
    ) as OfflineMapGenerationRecord[];
  } catch {
    return [];
  }
}

/** Persist only corrupt counters; valid manifest reads remain write-free. */
export async function normalizeOfflineMapGenerationCounters(
  now = Date.now(),
): Promise<OfflineMapGenerationRecord[]> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_GENERATION_STORE, 'readwrite');
  const store = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
  const generations = await requestToPromise(store.getAll()) as OfflineMapGenerationRecord[];
  for (const generation of generations) {
    const totalTiles = Math.max(0, Math.floor(generation.totalTiles || 0));
    const completedTiles = Math.min(
      totalTiles,
      Math.max(0, Math.floor(generation.completedTiles || 0)),
    );
    const failedTiles = Math.min(
      totalTiles - completedTiles,
      Math.max(0, Math.floor(generation.failedTiles || 0)),
    );
    if (
      totalTiles === generation.totalTiles
      && completedTiles === generation.completedTiles
      && failedTiles === generation.failedTiles
    ) continue;
    Object.assign(generation, { totalTiles, completedTiles, failedTiles, updatedAt: now });
    store.put(generation, generation.id);
  }
  await transactionDone(tx);
  return generations;
}

function legacyLayerId(ownerKey: string): string {
  if (ownerKey === LEGACY_OWNER_KEY) return LEGACY_SATELLITE_LAYER_ID;
  const [layerId] = ownerKey.split('::');
  return layerId || LEGACY_SATELLITE_LAYER_ID;
}

/**
 * Incremental v6-to-v7 data migration. The schema upgrade creates only stores
 * and indexes; payload metadata and legacy ownership are converted in short
 * transactions after startup so opening IndexedDB never freezes the WebView.
 */
export async function runOfflineMapV7Migration(now = Date.now()): Promise<void> {
  while (true) {
    const db = await openTileDB();
    const readTx = db.transaction(OFFLINE_MAP_PLAN_STORE, 'readonly');
    const existing = await requestToPromise(
      readTx.objectStore(OFFLINE_MAP_PLAN_STORE).get(V7_MIGRATION_KEY),
    ) as OfflineMapV7MigrationState | undefined;
    const state: OfflineMapV7MigrationState = existing ?? {
      metadataDone: false,
      ownersDone: false,
    };
    if (state.metadataDone && state.ownersDone) return;

    if (!state.metadataDone) {
      const tx = db.transaction(
        [TILE_METADATA_STORE, OFFLINE_MAP_PLAN_STORE],
        'readwrite',
      );
      const metadataStore = tx.objectStore(TILE_METADATA_STORE);
      const range = state.metadataCursor === undefined
        ? undefined
        : IDBKeyRange.lowerBound(state.metadataCursor, true);
      const [keys, values] = await Promise.all([
        requestToPromise(metadataStore.getAllKeys(range, V7_MIGRATION_BATCH_SIZE)),
        requestToPromise(metadataStore.getAll(range, V7_MIGRATION_BATCH_SIZE)),
      ]);
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index] as LegacyTileMetadataRecord;
        if (!Number.isFinite(value.fetchedAt) || (value.fetchedAt ?? 0) <= 0) {
          metadataStore.put({ ...value, fetchedAt: now, updatedAt: now }, keys[index]);
        }
      }
      state.metadataDone = keys.length < V7_MIGRATION_BATCH_SIZE;
      state.metadataCursor = state.metadataDone ? undefined : keys.at(-1);
      tx.objectStore(OFFLINE_MAP_PLAN_STORE).put(state, V7_MIGRATION_KEY);
      await transactionDone(tx);
      if (!state.metadataDone) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        continue;
      }
    }

    if (!state.ownersDone) {
      const tx = db.transaction(
        [
          TILE_OWNER_STORE,
          TILE_METADATA_STORE,
          OFFLINE_MAP_MEMBERSHIP_STORE,
          OFFLINE_MAP_GENERATION_STORE,
          OFFLINE_MAP_PLAN_STORE,
        ],
        'readwrite',
      );
      const ownerStore = tx.objectStore(TILE_OWNER_STORE);
      const metadataStore = tx.objectStore(TILE_METADATA_STORE);
      const membershipStore = tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE);
      const generationStore = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
      const range = state.ownerCursor === undefined
        ? undefined
        : IDBKeyRange.lowerBound(state.ownerCursor, true);
      const [keys, owners] = await Promise.all([
        requestToPromise(ownerStore.getAllKeys(range, V7_MIGRATION_BATCH_SIZE)),
        requestToPromise(ownerStore.getAll(range, V7_MIGRATION_BATCH_SIZE)),
      ]) as [IDBValidKey[], TilePrefetchOwnerRecord[]];
      const generations = new Map<string, OfflineMapGenerationRecord>();

      for (let index = 0; index < owners.length; index += 1) {
        const owner = owners[index];
        const layerId = legacyLayerId(owner.ownerKey);
        const generationId = `legacy-v7:${layerId}`;
        let generation = generations.get(generationId);
        if (!generation) {
          generation = (await requestToPromise(generationStore.get(generationId)) as
            | OfflineMapGenerationRecord
            | undefined) ?? {
            id: generationId,
            planId: generationId,
            layerId,
            status: 'active',
            totalTiles: 0,
            completedTiles: 0,
            failedTiles: 0,
            bytesDownloaded: 0,
            refreshAfter: now + LEGACY_FRESHNESS_WINDOW_MS,
            updatedAt: now,
          };
          generations.set(generationId, generation);
        }

        const membershipKey = membershipRecordKey(generationId, owner.url);
        const membershipExists = Boolean(await requestToPromise(
          membershipStore.get(membershipKey),
        ));
        const metadata = normalizeMetadata(
          await requestToPromise(metadataStore.get(owner.url)) as
            | LegacyTileMetadataRecord
            | undefined,
          now,
        );
        if (!membershipExists) {
          membershipStore.put({
            generationId,
            layerId,
            url: owner.url,
            updatedAt: now,
          } satisfies OfflineMapMembershipRecord, membershipKey);
          generation.totalTiles += 1;
          generation.completedTiles += 1;
        }
        if (metadata) {
          metadata.prefetchOwnerCount = Math.max(
            0,
            metadata.prefetchOwnerCount - 1 + (membershipExists ? 0 : 1),
          );
          metadata.pinnedByAutoPrefetch = metadata.prefetchOwnerCount > 0;
          metadata.updatedAt = now;
          metadataStore.put(metadata, owner.url);
        }
        ownerStore.delete(keys[index]);
      }
      for (const generation of generations.values()) {
        generation.updatedAt = now;
        generationStore.put(generation, generation.id);
      }
      state.ownersDone = keys.length < V7_MIGRATION_BATCH_SIZE;
      state.ownerCursor = state.ownersDone ? undefined : keys.at(-1);
      if (state.metadataDone && state.ownersDone) state.completedAt = now;
      tx.objectStore(OFFLINE_MAP_PLAN_STORE).put(state, V7_MIGRATION_KEY);
      await transactionDone(tx);
      if (!state.ownersDone) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }
}

export async function activateOfflineMapGeneration(
  generationId: string,
  now = Date.now(),
): Promise<string[]> {
  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_GENERATION_STORE, 'readwrite');
  const store = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
  const next = await requestToPromise(store.get(generationId)) as
    | OfflineMapGenerationRecord
    | undefined;
  if (!next) {
    tx.abort();
    throw new Error(`Offline-map generation does not exist: ${generationId}`);
  }
  const layerGenerations = await requestToPromise(
    store.index(GENERATION_LAYER_INDEX).getAll(IDBKeyRange.only(next.layerId)),
  ) as OfflineMapGenerationRecord[];
  const previousActiveIds: string[] = [];
  for (const generation of layerGenerations) {
    if (generation.id === generationId) continue;
    if (generation.status === 'active') {
      generation.status = 'releasing';
      generation.updatedAt = now;
      store.put(generation, generation.id);
      previousActiveIds.push(generation.id);
    }
  }
  next.status = 'active';
  next.updatedAt = now;
  store.put(next, next.id);
  await transactionDone(tx);
  return previousActiveIds;
}

export async function garbageCollectOfflineMapPlans(now = Date.now()): Promise<void> {
  let afterKey: IDBValidKey | undefined;
  while (true) {
    const db = await openTileDB();
    const tx = db.transaction(
      [OFFLINE_MAP_PLAN_STORE, OFFLINE_MAP_GENERATION_STORE],
      'readonly',
    );
    const range = afterKey === undefined ? undefined : IDBKeyRange.lowerBound(afterKey, true);
    const planStore = tx.objectStore(OFFLINE_MAP_PLAN_STORE);
    const [keys, values] = await Promise.all([
      requestToPromise(planStore.getAllKeys(range, 100)),
      requestToPromise(planStore.getAll(range, 100)),
    ]);
    const obsolete: string[] = [];
    for (const value of values) {
      const plan = value as OfflineMapPlanRecord;
      if (typeof plan?.id !== 'string' || typeof plan.sourceRevision !== 'string') continue;
      if (Number.isFinite(plan.createdAt) && now - plan.createdAt < PLAN_GC_GRACE_MS) continue;
      const references = await requestToPromise(
        tx.objectStore(OFFLINE_MAP_GENERATION_STORE)
          .index(GENERATION_PLAN_INDEX)
          .count(IDBKeyRange.only(plan.id)),
      );
      if (references === 0) obsolete.push(plan.id);
    }
    await transactionDone(tx);
    for (const planId of obsolete) await deleteOfflineMapPlan(planId);
    if (keys.length < 100) break;
    afterKey = keys.at(-1);
  }
}

export async function claimCachedTilesForOfflineGeneration(
  urls: readonly string[],
  generationId: string,
  layerId: string,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<Array<TileMetadataRecord | null>> {
  if (urls.length === 0) return [];
  if (signal?.aborted) throw signal.reason;
  const db = await openTileDB();
  const tx = db.transaction(
    [
      TILE_STORE,
      TILE_METADATA_STORE,
      TILE_STATS_STORE,
      OFFLINE_MAP_MEMBERSHIP_STORE,
      OFFLINE_MAP_GENERATION_STORE,
    ],
    'readwrite',
  );
  const tileStore = tx.objectStore(TILE_STORE);
  const metadataStore = tx.objectStore(TILE_METADATA_STORE);
  const statsStore = tx.objectStore(TILE_STATS_STORE);
  const membershipStore = tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE);
  const releaseAbort = bindAbortSignal(tx, signal);
  try {
  const generation = await requestToPromise(
    tx.objectStore(OFFLINE_MAP_GENERATION_STORE).get(generationId),
  ) as OfflineMapGenerationRecord | undefined;
  if (!generation || generation.status !== 'pending') {
    try { tx.abort(); } catch { /* already settled */ }
    throw new DOMException('Offline-map generation is no longer active', 'AbortError');
  }
  const stats = await readStats(statsStore, now);
  let statsChanged = false;
  const results: Array<TileMetadataRecord | null> = [];

  for (const url of urls) {
    const [data, metadataValue] = await Promise.all([
      requestToPromise(tileStore.get(url)),
      requestToPromise(metadataStore.get(url)),
    ]);
    const storedMetadata = normalizeMetadata(
      metadataValue as LegacyTileMetadataRecord | undefined,
      now,
    );
    if ((data === undefined || data === null) && !storedMetadata?.isNoData) {
      results.push(null);
      continue;
    }
    const metadata = storedMetadata ?? {
      url,
      sizeBytes: (data as ArrayBuffer).byteLength,
      isNoData: false,
      fetchedAt: now,
      lastAccessedAt: now,
      prefetchOwnerCount: 0,
      pinnedByAutoPrefetch: false,
      createdAt: now,
      updatedAt: now,
    };
    const key = membershipRecordKey(generationId, url);
    const existing = await requestToPromise(membershipStore.get(key));
    if (!existing) {
      const wasPinned = metadata.prefetchOwnerCount > 0;
      metadata.prefetchOwnerCount += 1;
      metadata.pinnedByAutoPrefetch = true;
      metadata.updatedAt = now;
      await requestToPromise(metadataStore.put(metadata, url));
      await requestToPromise(membershipStore.put({
        generationId,
        layerId,
        url,
        updatedAt: now,
      } satisfies OfflineMapMembershipRecord, key));
      if (!wasPinned) {
        stats.pinnedBytes += metadata.sizeBytes;
        stats.pinnedTileCount += 1;
        statsChanged = true;
      }
    }
    results.push(metadata);
  }

  if (statsChanged) {
    stats.updatedAt = now;
    await requestToPromise(statsStore.put(stats, TILE_STATS_KEY));
  }
  await transactionDone(tx);
  return results;
  } finally {
    releaseAbort();
  }
}

const OFFLINE_MAP_RELEASE_BATCH_SIZE = 250;

export async function releaseOfflineMapGeneration(
  generationId: string,
  now = Date.now(),
): Promise<void> {
  while (true) {
    const db = await openTileDB();
    const tx = db.transaction(
      [TILE_METADATA_STORE, TILE_STATS_STORE, OFFLINE_MAP_MEMBERSHIP_STORE],
      'readwrite',
    );
    const membershipStore = tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE);
    const metadataStore = tx.objectStore(TILE_METADATA_STORE);
    const statsStore = tx.objectStore(TILE_STATS_STORE);
    const memberships = await requestToPromise(
      membershipStore.index(MEMBERSHIP_GENERATION_INDEX).getAll(
        IDBKeyRange.only(generationId),
        OFFLINE_MAP_RELEASE_BATCH_SIZE,
      ),
    ) as OfflineMapMembershipRecord[];
    const stats = await readStats(statsStore, now);
    let statsChanged = false;
    for (const membership of memberships) {
      const metadata = normalizeMetadata(
        await requestToPromise(metadataStore.get(membership.url)) as LegacyTileMetadataRecord | undefined,
        now,
      );
      membershipStore.delete(membershipRecordKey(generationId, membership.url));
      if (!metadata) continue;
      const wasPinned = metadata.prefetchOwnerCount > 0;
      metadata.prefetchOwnerCount = Math.max(0, metadata.prefetchOwnerCount - 1);
      metadata.pinnedByAutoPrefetch = metadata.prefetchOwnerCount > 0;
      metadata.updatedAt = now;
      metadataStore.put(metadata, membership.url);
      if (wasPinned && metadata.prefetchOwnerCount === 0) {
        stats.pinnedBytes = Math.max(0, stats.pinnedBytes - metadata.sizeBytes);
        stats.pinnedTileCount = Math.max(0, stats.pinnedTileCount - 1);
        statsChanged = true;
      }
    }
    if (statsChanged) {
      stats.updatedAt = now;
      statsStore.put(stats, TILE_STATS_KEY);
    }
    await transactionDone(tx);
    if (memberships.length < OFFLINE_MAP_RELEASE_BATCH_SIZE) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const db = await openTileDB();
  const tx = db.transaction(OFFLINE_MAP_GENERATION_STORE, 'readwrite');
  tx.objectStore(OFFLINE_MAP_GENERATION_STORE).delete(generationId);
  await transactionDone(tx);
}

/** Explicit integrity repair; never run on the cache-hit or startup path. */
export async function repairTileCacheStats(now = Date.now()): Promise<TileCacheStatsRecord> {
  return runMutation(async () => {
    const db = await openTileDB();
    const tx = db.transaction([TILE_METADATA_STORE, TILE_STATS_STORE], 'readwrite');
    const values = await requestToPromise(
      tx.objectStore(TILE_METADATA_STORE).getAll(),
    ) as LegacyTileMetadataRecord[];
    const stats = buildEmptyStats(now);
    for (const value of values) {
      const metadata = normalizeMetadata(value, now);
      if (!metadata) continue;
      stats.totalBytes += metadata.sizeBytes;
      stats.tileCount += 1;
      if (metadata.prefetchOwnerCount > 0) {
        stats.pinnedBytes += metadata.sizeBytes;
        stats.pinnedTileCount += 1;
      }
    }
    await requestToPromise(tx.objectStore(TILE_STATS_STORE).put(stats, TILE_STATS_KEY));
    await transactionDone(tx);
    return stats;
  });
}

function capacityError(message: string): Error {
  const error = new Error(message);
  error.name = 'TileCacheCapacityError';
  return error;
}

async function oldestUnpinnedCandidates(
  store: IDBObjectStore,
  skipUrl: string,
  bytesNeeded: number,
): Promise<{ candidates: TileMetadataRecord[]; bytes: number }> {
  if (bytesNeeded <= 0) return { candidates: [], bytes: 0 };
  return new Promise((resolve, reject) => {
    const candidates: TileMetadataRecord[] = [];
    let bytes = 0;
    const request = store.index(LAST_ACCESSED_INDEX).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || bytes >= bytesNeeded) {
        resolve({ candidates, bytes });
        return;
      }
      const metadata = normalizeMetadata(cursor.value as LegacyTileMetadataRecord);
      if (metadata && metadata.url !== skipUrl && metadata.prefetchOwnerCount === 0) {
        candidates.push(metadata);
        bytes += metadata.sizeBytes;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function writeTileWithCapacity(
  url: string,
  value: ArrayBuffer,
  options: TileWriteOptions,
): Promise<TileCacheEvictionResult> {
  return runMutation(async () => {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('The operation was aborted', 'AbortError');
    }
    const now = options.now ?? Date.now();
    const db = await openTileDB();
    const tx = db.transaction(
      [
        TILE_STORE,
        TILE_METADATA_STORE,
        TILE_STATS_STORE,
        OFFLINE_MAP_MEMBERSHIP_STORE,
        OFFLINE_MAP_GENERATION_STORE,
      ],
      'readwrite',
    );
    const tileStore = tx.objectStore(TILE_STORE);
    const metadataStore = tx.objectStore(TILE_METADATA_STORE);
    const statsStore = tx.objectStore(TILE_STATS_STORE);
    const membershipStore = tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE);
    const generationStore = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
    const releaseAbort = bindAbortSignal(tx, options.signal);

    try {
      const previousMetadata = normalizeMetadata(
        await requestToPromise(metadataStore.get(url)) as LegacyTileMetadataRecord | undefined,
        now,
      );
      const previousTile = previousMetadata
        ? null
        : ((await requestToPromise(tileStore.get(url))) as ArrayBuffer | undefined) ?? null;
      const previousBytes = previousMetadata?.sizeBytes ?? previousTile?.byteLength ?? 0;
      const hadExistingTile = previousMetadata !== null || previousTile !== null;
      const stats = await readStats(statsStore, now);

      let addedOwnerCount = 0;
      const requestedMembership = options.offlineMembership;
      if (requestedMembership) {
        const generation = await requestToPromise(
          generationStore.get(requestedMembership.generationId),
        ) as OfflineMapGenerationRecord | undefined;
        if (!generation || generation.status !== 'pending') {
          throw new DOMException('Offline-map generation is no longer active', 'AbortError');
        }
      }
      const membershipKey = requestedMembership
        ? membershipRecordKey(requestedMembership.generationId, url)
        : null;
      const membershipPresent = membershipKey
        ? Boolean(await requestToPromise(membershipStore.get(membershipKey)))
        : false;
      if (requestedMembership && !membershipPresent) addedOwnerCount += 1;
      const previousOwnerCount = previousMetadata?.prefetchOwnerCount ?? 0;
      const nextOwnerCount = previousOwnerCount + addedOwnerCount;
      const projected = stats.totalBytes - previousBytes + value.byteLength;
      const bytesNeeded = Math.max(0, projected - options.maxCacheBytes);

      let eviction = { candidates: [] as TileMetadataRecord[], bytes: 0 };
      if (bytesNeeded > 0) {
        if (!options.isOnline) {
          throw capacityError('Tile cache write would exceed limit while offline; eviction is disabled.');
        }
        eviction = await oldestUnpinnedCandidates(metadataStore, url, bytesNeeded);
        if (
          eviction.bytes < bytesNeeded
          && !(nextOwnerCount > 0 && options.allowPinnedOverflow)
        ) {
          throw capacityError(
            'Tile cache is full and pinned auto-prefetched maps prevent further eviction.',
          );
        }
      }

      let freedBytes = 0;
      let evictedTileCount = 0;
      for (const candidate of eviction.candidates) {
        await requestToPromise(tileStore.delete(candidate.url));
        await requestToPromise(metadataStore.delete(candidate.url));
        freedBytes += candidate.sizeBytes;
        evictedTileCount += 1;
      }

      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('The operation was aborted', 'AbortError');
      }
      await requestToPromise(tileStore.put(value, url));
      if (requestedMembership && membershipKey) {
        const membership: OfflineMapMembershipRecord = {
          generationId: requestedMembership.generationId,
          layerId: requestedMembership.layerId,
          url,
          updatedAt: now,
        };
        await requestToPromise(membershipStore.put(membership, membershipKey));
      }

      const metadata: TileMetadataRecord = {
        url,
        sizeBytes: value.byteLength,
        isNoData: false,
        fetchedAt: now,
        lastAccessedAt: now,
        prefetchOwnerCount: nextOwnerCount,
        pinnedByAutoPrefetch: nextOwnerCount > 0,
        createdAt: previousMetadata?.createdAt ?? now,
        updatedAt: now,
      };
      await requestToPromise(metadataStore.put(metadata, url));

      stats.totalBytes = Math.max(0, stats.totalBytes - freedBytes - previousBytes + value.byteLength);
      stats.tileCount = Math.max(0, stats.tileCount - evictedTileCount + (hadExistingTile ? 0 : 1));
      const wasPinned = previousOwnerCount > 0;
      const isPinned = nextOwnerCount > 0;
      stats.pinnedBytes = Math.max(
        0,
        stats.pinnedBytes - (wasPinned ? previousBytes : 0) + (isPinned ? value.byteLength : 0),
      );
      stats.pinnedTileCount = Math.max(
        0,
        stats.pinnedTileCount + (!wasPinned && isPinned ? 1 : 0),
      );
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('The operation was aborted', 'AbortError');
      }
      stats.updatedAt = now;
      await requestToPromise(statsStore.put(stats, TILE_STATS_KEY));
      await transactionDone(tx);
      return { evictedTileCount, freedBytes };
    } catch (error) {
      try { tx.abort(); } catch { /* already settled */ }
      throw error;
    } finally {
      releaseAbort();
    }
  });
}

/**
 * Persist an authoritative provider no-data result without storing its bytes.
 * When supplied, generation membership is validated and committed in the same
 * transaction so a cancelled/superseded download cannot publish coverage.
 */
export async function writeNoDataTile(
  url: string,
  options: {
    now?: number;
    signal?: AbortSignal;
    offlineMembership?: { generationId: string; layerId: string };
  } = {},
): Promise<{ cacheDeltaBytes: number }> {
  return runMutation(async () => {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('The operation was aborted', 'AbortError');
    }
    const now = options.now ?? Date.now();
    const db = await openTileDB();
    const tx = db.transaction(
      [
        TILE_STORE,
        TILE_METADATA_STORE,
        TILE_STATS_STORE,
        OFFLINE_MAP_MEMBERSHIP_STORE,
        OFFLINE_MAP_GENERATION_STORE,
      ],
      'readwrite',
    );
    const tileStore = tx.objectStore(TILE_STORE);
    const metadataStore = tx.objectStore(TILE_METADATA_STORE);
    const statsStore = tx.objectStore(TILE_STATS_STORE);
    const membershipStore = tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE);
    const generationStore = tx.objectStore(OFFLINE_MAP_GENERATION_STORE);
    const releaseAbort = bindAbortSignal(tx, options.signal);

    try {
      const [metadataValue, payloadValue] = await Promise.all([
        requestToPromise(metadataStore.get(url)),
        requestToPromise(tileStore.get(url)),
      ]);
      const previousMetadata = normalizeMetadata(
        metadataValue as LegacyTileMetadataRecord | undefined,
        now,
      );
      const previousPayload = payloadValue as ArrayBuffer | undefined;
      const previousBytes = previousMetadata?.sizeBytes ?? previousPayload?.byteLength ?? 0;
      const hadExistingEntry = previousMetadata !== null || previousPayload !== undefined;
      const previousOwnerCount = previousMetadata?.prefetchOwnerCount ?? 0;
      const requestedMembership = options.offlineMembership;
      let membershipPresent = false;
      let membershipKey: string | null = null;
      if (requestedMembership) {
        const generation = await requestToPromise(
          generationStore.get(requestedMembership.generationId),
        ) as OfflineMapGenerationRecord | undefined;
        if (!generation || generation.status !== 'pending') {
          throw new DOMException('Offline-map generation is no longer active', 'AbortError');
        }
        membershipKey = membershipRecordKey(requestedMembership.generationId, url);
        membershipPresent = Boolean(await requestToPromise(membershipStore.get(membershipKey)));
      }
      const nextOwnerCount = previousOwnerCount + (
        requestedMembership && !membershipPresent ? 1 : 0
      );

      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('The operation was aborted', 'AbortError');
      }
      await requestToPromise(tileStore.delete(url));
      if (requestedMembership && membershipKey && !membershipPresent) {
        await requestToPromise(membershipStore.put({
          generationId: requestedMembership.generationId,
          layerId: requestedMembership.layerId,
          url,
          updatedAt: now,
        } satisfies OfflineMapMembershipRecord, membershipKey));
      }
      const metadata: TileMetadataRecord = {
        url,
        sizeBytes: 0,
        isNoData: true,
        fetchedAt: now,
        lastAccessedAt: now,
        prefetchOwnerCount: nextOwnerCount,
        pinnedByAutoPrefetch: nextOwnerCount > 0,
        createdAt: previousMetadata?.createdAt ?? now,
        updatedAt: now,
      };
      await requestToPromise(metadataStore.put(metadata, url));

      const stats = await readStats(statsStore, now);
      const wasPinned = previousOwnerCount > 0;
      const isPinned = nextOwnerCount > 0;
      stats.totalBytes = Math.max(0, stats.totalBytes - previousBytes);
      stats.tileCount = Math.max(0, stats.tileCount + (hadExistingEntry ? 0 : 1));
      stats.pinnedBytes = Math.max(
        0,
        stats.pinnedBytes - (wasPinned ? previousBytes : 0),
      );
      stats.pinnedTileCount = Math.max(
        0,
        stats.pinnedTileCount + (!wasPinned && isPinned ? 1 : 0),
      );
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('The operation was aborted', 'AbortError');
      }
      stats.updatedAt = now;
      await requestToPromise(statsStore.put(stats, TILE_STATS_KEY));
      await transactionDone(tx);
      return { cacheDeltaBytes: -previousBytes };
    } catch (error) {
      try { tx.abort(); } catch { /* already settled */ }
      throw error;
    } finally {
      releaseAbort();
    }
  });
}

/** Test-only seed helper; production writes use generation memberships. */
export async function __seedTileCacheEntryForTests(
  url: string,
  value: ArrayBuffer,
  options: { pinnedByAutoPrefetch: boolean; now?: number },
): Promise<void> {
  await writeTileWithCapacity(url, value, {
    now: options.now,
    isOnline: true,
    maxCacheBytes: Number.MAX_SAFE_INTEGER,
    allowPinnedOverflow: true,
  });
  if (!options.pinnedByAutoPrefetch) return;
  const now = options.now ?? Date.now();
  const db = await openTileDB();
  const tx = db.transaction(
    [TILE_METADATA_STORE, TILE_STATS_STORE, TILE_OWNER_STORE],
    'readwrite',
  );
  const metadataStore = tx.objectStore(TILE_METADATA_STORE);
  const metadata = normalizeMetadata(
    await requestToPromise(metadataStore.get(url)) as LegacyTileMetadataRecord,
    now,
  )!;
  metadata.prefetchOwnerCount = 1;
  metadata.pinnedByAutoPrefetch = true;
  metadata.updatedAt = now;
  metadataStore.put(metadata, url);
  tx.objectStore(TILE_OWNER_STORE).put({
    ownerKey: LEGACY_OWNER_KEY,
    url,
    generation: 0,
    updatedAt: now,
  } satisfies TilePrefetchOwnerRecord, ownerRecordKey(LEGACY_OWNER_KEY, 0, url));
  const stats = await readStats(tx.objectStore(TILE_STATS_STORE), now);
  stats.pinnedBytes += value.byteLength;
  stats.pinnedTileCount += 1;
  stats.updatedAt = now;
  tx.objectStore(TILE_STATS_STORE).put(stats, TILE_STATS_KEY);
  await transactionDone(tx);
}

export async function touchTileAccess(
  url: string,
  now = Date.now(),
  minIntervalMs = ACCESS_TOUCH_INTERVAL_MS,
): Promise<void> {
  await runMutation(async () => {
    try {
      const db = await openTileDB();
      const tx = db.transaction(TILE_METADATA_STORE, 'readwrite');
      const store = tx.objectStore(TILE_METADATA_STORE);
      const metadata = normalizeMetadata(
        await requestToPromise(store.get(url)) as LegacyTileMetadataRecord | undefined,
        now,
      );
      if (
        !metadata
        || metadata.prefetchOwnerCount > 0
        || now - metadata.lastAccessedAt < minIntervalMs
      ) {
        await transactionDone(tx);
        return;
      }
      metadata.lastAccessedAt = now;
      metadata.updatedAt = now;
      await requestToPromise(store.put(metadata, url));
      await transactionDone(tx);
    } catch {
      // Best effort; cache reads must stay authoritative.
    }
  });
}

export async function deleteTilesByMetadata(
  candidates: TileMetadataRecord[],
  now = Date.now(),
): Promise<TileCacheEvictionResult> {
  if (candidates.length === 0) return { evictedTileCount: 0, freedBytes: 0 };
  return runMutation(async () => {
    const db = await openTileDB();
    const tx = db.transaction(
      [
        TILE_STORE,
        TILE_METADATA_STORE,
        TILE_STATS_STORE,
        TILE_OWNER_STORE,
        OFFLINE_MAP_MEMBERSHIP_STORE,
      ],
      'readwrite',
    );
    const tileStore = tx.objectStore(TILE_STORE);
    const metadataStore = tx.objectStore(TILE_METADATA_STORE);
    const ownerStore = tx.objectStore(TILE_OWNER_STORE);
    const membershipStore = tx.objectStore(OFFLINE_MAP_MEMBERSHIP_STORE);
    const statsStore = tx.objectStore(TILE_STATS_STORE);
    const stats = await readStats(statsStore, now);
    let freedBytes = 0;
    let evictedTileCount = 0;
    let pinnedBytes = 0;
    let pinnedCount = 0;
    for (const candidate of candidates) {
      const actual = normalizeMetadata(
        await requestToPromise(metadataStore.get(candidate.url)) as LegacyTileMetadataRecord | undefined,
        now,
      );
      if (!actual) continue;
      const owners = await requestToPromise(
        ownerStore.index(OWNER_URL_INDEX).getAll(IDBKeyRange.only(candidate.url)),
      ) as TilePrefetchOwnerRecord[];
      for (const owner of owners) {
        await requestToPromise(ownerStore.delete(
          ownerRecordKey(owner.ownerKey, owner.generation, owner.url),
        ));
      }
      const memberships = await requestToPromise(
        membershipStore.index(MEMBERSHIP_URL_INDEX).getAll(IDBKeyRange.only(candidate.url)),
      ) as OfflineMapMembershipRecord[];
      for (const membership of memberships) {
        membershipStore.delete(membershipRecordKey(membership.generationId, membership.url));
      }
      await requestToPromise(tileStore.delete(candidate.url));
      await requestToPromise(metadataStore.delete(candidate.url));
      freedBytes += actual.sizeBytes;
      evictedTileCount += 1;
      if (actual.prefetchOwnerCount > 0) {
        pinnedBytes += actual.sizeBytes;
        pinnedCount += 1;
      }
    }
    stats.totalBytes = Math.max(0, stats.totalBytes - freedBytes);
    stats.tileCount = Math.max(0, stats.tileCount - evictedTileCount);
    stats.pinnedBytes = Math.max(0, stats.pinnedBytes - pinnedBytes);
    stats.pinnedTileCount = Math.max(0, stats.pinnedTileCount - pinnedCount);
    stats.updatedAt = now;
    await requestToPromise(statsStore.put(stats, TILE_STATS_KEY));
    await transactionDone(tx);
    return { evictedTileCount, freedBytes };
  });
}

export async function deleteTilesByUrlPrefixes(
  prefixes: string[],
  now = Date.now(),
): Promise<TileCacheEvictionResult> {
  if (prefixes.length === 0) return { evictedTileCount: 0, freedBytes: 0 };
  const db = await openTileDB();
  const tx = db.transaction(TILE_METADATA_STORE, 'readonly');
  const values = await requestToPromise(tx.objectStore(TILE_METADATA_STORE).getAll());
  const candidates = (values as LegacyTileMetadataRecord[])
    .map((value) => normalizeMetadata(value, now))
    .filter((value): value is TileMetadataRecord => Boolean(
      value && prefixes.some((prefix) => value.url.startsWith(prefix)),
    ));
  return deleteTilesByMetadata(candidates, now);
}
