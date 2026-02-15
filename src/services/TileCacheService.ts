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
import { TileCacheMaintenanceService } from './tileCache/TileCacheMaintenanceService';
import {
  clearCachedTiles as clearCachedTilesFromStore,
  clearPrefetchJobs as clearPrefetchJobsFromStore,
  getAllPrefetchJobs as getAllPrefetchJobsFromStore,
  getPrefetchJob as getPrefetchJobFromStore,
  getTile,
  hasTile,
  setPrefetchJob as setPrefetchJobInStore,
  touchTileAccess,
  upsertTile,
} from './tileCache/TileCacheRepository';

// ==================== Constants ====================

const STYLE_CACHE_KEY = '__style_json__';
const tileCacheMaintenance = new TileCacheMaintenanceService();
let tileCacheOfflineMode = false;

// Use explicit worker URL instead of inline/blob worker bootstrap.
// This avoids worker bootstrap runtime issues on some iOS devices.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

function isAbortError(error: unknown): boolean {
  return Boolean(
    typeof error === 'object' &&
    error &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError',
  );
}

function hasUsableNetwork(): boolean {
  const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  return browserOnline && !tileCacheOfflineMode;
}

export function setTileCacheOfflineMode(isOffline: boolean): void {
  tileCacheOfflineMode = isOffline;
}

// ==================== Public prefetch helpers ====================

/**
 * Returns true when the tile already exists in IndexedDB.
 */
export async function hasCachedTile(url: string): Promise<boolean> {
  return hasTile(url);
}

async function upsertTileStrict(
  url: string,
  data: ArrayBuffer,
  pinnedByAutoPrefetch: boolean,
): Promise<void> {
  await tileCacheMaintenance.ensureCapacityBeforeWrite(url, data.byteLength);
  await upsertTile(url, data, { pinnedByAutoPrefetch });
}

async function upsertTileBestEffort(
  url: string,
  data: ArrayBuffer,
  pinnedByAutoPrefetch: boolean,
): Promise<void> {
  try {
    await tileCacheMaintenance.ensureCapacityBeforeWrite(url, data.byteLength);
    await upsertTile(url, data, { pinnedByAutoPrefetch });
  } catch {
    // Runtime map caching is best-effort.
  }
}

/**
 * Force-download a tile and persist it. Throws when network or storage fails.
 * Returns the number of downloaded bytes.
 */
export async function fetchAndCacheTile(
  url: string,
  signal?: AbortSignal,
  pinnedByAutoPrefetch = false,
): Promise<number> {
  if (!hasUsableNetwork()) {
    throw new Error(`Offline and no cached map for ${url}`);
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.arrayBuffer();
  await upsertTileStrict(url, data, pinnedByAutoPrefetch);
  return data.byteLength;
}

export async function fetchAndCachePinnedTile(
  url: string,
  signal?: AbortSignal,
): Promise<number> {
  const bytes = await fetchAndCacheTile(url, signal, true);
  return bytes;
}

export async function getPrefetchJob(
  projectId: string,
): Promise<TilePrefetchJobState | null> {
  return getPrefetchJobFromStore(projectId);
}

export async function getAllPrefetchJobs(): Promise<TilePrefetchJobState[]> {
  return getAllPrefetchJobsFromStore();
}

export async function setPrefetchJob(job: TilePrefetchJobState): Promise<void> {
  await setPrefetchJobInStore(job);
}

export async function clearPrefetchJobs(): Promise<void> {
  await clearPrefetchJobsFromStore();
}

export async function clearCachedTiles(): Promise<void> {
  await clearCachedTilesFromStore();
}

export async function runTileCacheStartupMaintenance(): Promise<void> {
  try {
    await tileCacheMaintenance.runStartupMaintenance();
  } catch {
    // Startup maintenance should not block app initialization.
  }
}

// ==================== Network-first fetch with cache ====================

async function fetchWithCache(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!hasUsableNetwork()) {
    const cached = await getTile(url);
    if (cached) {
      void touchTileAccess(url);
      return cached;
    }
    throw new Error(`Offline and no cached map for ${url}`);
  }

  // Try network first
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();

    // Cache in background (don't await -- non-blocking)
    void upsertTileBestEffort(url, data, false);

    return data;
  } catch (error) {
    if (isAbortError(error)) throw error;

    // Network failed -- try cache
    const cached = await getTile(url);
    if (cached) {
      void touchTileAccess(url);
      return cached;
    }
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
    if (!hasUsableNetwork()) {
      throw new Error('Offline mode active');
    }
    const response = await fetch(styleUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    styleJson = await response.json();

    // Cache the raw style JSON for offline use
    const encoder = new TextEncoder();
    void upsertTileBestEffort(
      STYLE_CACHE_KEY,
      encoder.encode(JSON.stringify(styleJson)).buffer,
      false,
    );
  } catch {
    // Try to load from cache
    const cached = await getTile(STYLE_CACHE_KEY);
    if (!cached) throw new Error('Cannot load map style (offline, not cached)');
    const decoder = new TextDecoder();
    void touchTileAccess(STYLE_CACHE_KEY);
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
