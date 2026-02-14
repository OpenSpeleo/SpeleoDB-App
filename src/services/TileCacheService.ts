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

// ==================== Constants ====================

const TILE_DB_NAME = 'speleo_tiles';
const TILE_DB_VERSION = 1;
const TILE_STORE = 'tiles';
const STYLE_CACHE_KEY = '__style_json__';

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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openTileDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TILE_STORE, 'readonly');
      const req = tx.objectStore(TILE_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: ArrayBuffer): Promise<void> {
  try {
    const db = await openTileDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TILE_STORE, 'readwrite');
      tx.objectStore(TILE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently fail -- caching is best-effort.
  }
}

// ==================== Network-first fetch with cache ====================

async function fetchWithCache(url: string): Promise<ArrayBuffer> {
  // Try network first
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();

    // Cache in background (don't await -- non-blocking)
    idbSet(url, data);

    return data;
  } catch {
    // Network failed -- try cache
    const cached = await idbGet(url);
    if (cached) return cached;
    throw new Error(`Offline and no cached tile for ${url}`);
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

    return fetchWithCache(realUrl).then((data) => ({ data }));
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
    idbSet(STYLE_CACHE_KEY, encoder.encode(JSON.stringify(styleJson)).buffer);
  } catch {
    // Try to load from cache
    const cached = await idbGet(STYLE_CACHE_KEY);
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
