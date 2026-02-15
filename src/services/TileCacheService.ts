/**
 * TileCacheService -- offline tile caching for maplibre-gl.
 *
 * Uses a dedicated IndexedDB (`speleo_tiles`) separate from the main
 * `speleo_cache` database to avoid schema migrations.
 *
 * Strategy:
 *   1. Register a custom `cached-https` protocol with maplibre-gl.
 *   2. Rewrite the map style so all tile/sprite/glyph URLs use this protocol.
 *   3. On every request the protocol handler tries the network first,
 *      caches the response in IndexedDB, and falls back to cache on failure.
 */

import maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
import type { TilePrefetchJobState } from '../types/tilePrefetch';

// ==================== Constants ====================

const TILE_DB_NAME = 'speleo_tiles';
const TILE_DB_VERSION = 2;
const TILE_STORE = 'tiles';
const PREFETCH_JOB_STORE = 'prefetch_jobs';
const STYLE_CACHE_KEY = '__style_json__';

// Use explicit worker URL instead of inline/blob worker bootstrap.
// This avoids worker bootstrap runtime issues on some iOS devices.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

// ==================== IndexedDB helpers ====================

let dbPromise: Promise<IDBDatabase> | null = null;

function openTileDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TILE_DB_NAME, TILE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE);
      }
      if (!db.objectStoreNames.contains(PREFETCH_JOB_STORE)) {
        db.createObjectStore(PREFETCH_JOB_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function idbGetFromStore<T>(store: string, key: string): Promise<T | null> {
  try {
    const db = await openTileDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSetInStore<T>(
  store: string,
  key: string,
  value: T,
): Promise<void> {
  const db = await openTileDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAllFromStore<T>(store: string): Promise<T[]> {
  try {
    const db = await openTileDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function idbClearStore(store: string): Promise<void> {
  const db = await openTileDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetTile(key: string): Promise<ArrayBuffer | null> {
  return idbGetFromStore<ArrayBuffer>(TILE_STORE, key);
}

async function idbSetTileBestEffort(key: string, value: ArrayBuffer): Promise<void> {
  try {
    await idbSetInStore(TILE_STORE, key, value);
  } catch {
    // Silently fail -- runtime caching is best-effort.
  }
}

async function idbSetTileStrict(key: string, value: ArrayBuffer): Promise<void> {
  await idbSetInStore(TILE_STORE, key, value);
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    typeof error === 'object' &&
    error &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError',
  );
}

// ==================== Public prefetch helpers ====================

/**
 * Returns true when the tile already exists in IndexedDB.
 */
export async function hasCachedTile(url: string): Promise<boolean> {
  return (await idbGetTile(url)) !== null;
}

/**
 * Force-download a tile and persist it. Throws when network or storage fails.
 * Returns the number of downloaded bytes.
 */
export async function fetchAndCacheTile(
  url: string,
  signal?: AbortSignal,
): Promise<number> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.arrayBuffer();
  await idbSetTileStrict(url, data);
  return data.byteLength;
}

export async function getPrefetchJob(
  projectId: string,
): Promise<TilePrefetchJobState | null> {
  return idbGetFromStore<TilePrefetchJobState>(PREFETCH_JOB_STORE, projectId);
}

export async function getAllPrefetchJobs(): Promise<TilePrefetchJobState[]> {
  return idbGetAllFromStore<TilePrefetchJobState>(PREFETCH_JOB_STORE);
}

export async function setPrefetchJob(job: TilePrefetchJobState): Promise<void> {
  await idbSetInStore(PREFETCH_JOB_STORE, job.projectId, job);
}

export async function clearPrefetchJobs(): Promise<void> {
  try {
    await idbClearStore(PREFETCH_JOB_STORE);
  } catch {
    // Best effort during logout/cleanup.
  }
}

// ==================== Network-first fetch with cache ====================

async function fetchWithCache(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  // Try network first
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();

    // Cache in background (don't await -- non-blocking)
    void idbSetTileBestEffort(url, data);

    return data;
  } catch (error) {
    if (isAbortError(error)) throw error;

    // Network failed -- try cache
    const cached = await idbGetTile(url);
    if (cached) return cached;
    throw new Error(`Offline and no cached map for ${url}`);
  }
}

// ==================== Protocol registration ====================

let protocolRegistered = false;

/**
 * Register the `cached-https` protocol with maplibre-gl.
 * Safe to call multiple times -- only registers once.
 */
export function registerTileCacheProtocol(): void {
  if (protocolRegistered) return;
  protocolRegistered = true;

  maplibregl.addProtocol('cached-https', (params, abortController) => {
    // Strip the custom protocol prefix to get the real URL
    const realUrl = params.url.replace('cached-https://', 'https://');

    return fetchWithCache(realUrl, abortController?.signal).then((data) => ({ data }));
  });
}

// ==================== Style rewriting ====================

/**
 * Fetch the map style JSON and rewrite all `https://` URLs to use
 * the `cached-https://` protocol so tile requests go through our cache.
 *
 * The style JSON itself is also cached in IndexedDB for offline use.
 */
export async function getCachedStyle(
  styleUrl: string,
): Promise<Record<string, unknown>> {
  let styleJson: Record<string, unknown>;

  try {
    const response = await fetch(styleUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    styleJson = await response.json();

    // Cache the raw style JSON for offline use
    const encoder = new TextEncoder();
    void idbSetTileBestEffort(
      STYLE_CACHE_KEY,
      encoder.encode(JSON.stringify(styleJson)).buffer,
    );
  } catch {
    // Try to load from cache
    const cached = await idbGetTile(STYLE_CACHE_KEY);
    if (!cached) throw new Error('Cannot load map style (offline, not cached)');
    const decoder = new TextDecoder();
    styleJson = JSON.parse(decoder.decode(cached));
  }

  return rewriteUrls(styleJson);
}

/**
 * Recursively rewrite `https://` URLs in the style JSON to `cached-https://`.
 */
function rewriteUrls(
  style: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...style };

  // Rewrite sprite URL
  if (typeof result.sprite === 'string') {
    result.sprite = (result.sprite as string).replace(
      /^https:\/\//,
      'cached-https://',
    );
  }

  // Rewrite glyphs URL
  if (typeof result.glyphs === 'string') {
    result.glyphs = (result.glyphs as string).replace(
      /^https:\/\//,
      'cached-https://',
    );
  }

  // Rewrite source tile URLs
  if (result.sources && typeof result.sources === 'object') {
    const sources = { ...(result.sources as Record<string, unknown>) };
    for (const [key, source] of Object.entries(sources)) {
      if (source && typeof source === 'object') {
        const s = { ...(source as Record<string, unknown>) };

        // Rewrite `tiles` array
        if (Array.isArray(s.tiles)) {
          s.tiles = (s.tiles as string[]).map((url: string) =>
            url.replace(/^https:\/\//, 'cached-https://'),
          );
        }

        // Rewrite `url` (TileJSON endpoint)
        if (typeof s.url === 'string') {
          s.url = (s.url as string).replace(/^https:\/\//, 'cached-https://');
        }

        sources[key] = s;
      }
    }
    result.sources = sources;
  }

  return result;
}
