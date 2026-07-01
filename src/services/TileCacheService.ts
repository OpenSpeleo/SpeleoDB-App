/**
 * TileCacheService -- offline tile caching for maplibre-gl.
 *
 * Uses a dedicated IndexedDB (`speleo_tiles`) separate from the main
 * `speleo_cache` database to avoid schema migrations.
 *
 * Strategy:
 *   1. Register a custom `cached-https` protocol with maplibre-gl.
 *   2. Rewrite the map style so all tile/sprite/glyph URLs use this protocol.
 *   3. Serve fresh cache entries without touching the network.
 *   4. Serve stale entries immediately and refresh them in the background.
 *   5. Fetch a missing entry with a deadline and atomically cache it.
 */

import maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
import { MAP } from '../constants';
import type { TileMetadataRecord } from '../types/tileCache';
import {
  buildLayerStyle,
  getMapLayerByTileUrl,
  isLayerTileUrl,
} from './MapLayersService';
import {
  claimCachedTilesForOfflineGeneration,
  clearCachedTiles as clearCachedTilesFromStore,
  deleteTilesByUrlPrefixes as deleteTilesByUrlPrefixesFromStore,
  getTile,
  getTileEntry,
  touchTileAccess,
  writeNoDataTile,
  writeTileWithCapacity,
} from './tileCache/TileCacheRepository';

// ==================== Constants ====================

const STYLE_CACHE_KEY = '__style_json__';
let tileCacheOfflineMode = false;
// When true, pinned prefetch writes may exceed the 500 MB cap. Driven solely by
// explicit, persisted user consent (see SpeleoDBController + PreferencesService).
let tileCacheOverLimitApproved = false;
const refreshesInFlight = new Map<string, Promise<void>>();
const backgroundRefreshControllers = new Map<string, AbortController>();
let backgroundRefreshTail: Promise<void> = Promise.resolve();
let cacheEpoch = 0;
let cacheLifecycleController = new AbortController();

// Use explicit worker URL instead of inline/blob worker bootstrap.
// This avoids worker bootstrap runtime issues on some iOS devices.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

function throwIfSignalAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

export class TileHttpError extends Error {
  readonly status: number;

  constructor(url: string, status: number) {
    super(`HTTP ${status} while fetching ${url}`);
    this.name = 'TileHttpError';
    this.status = status;
  }
}

export function isTerminalTileFetchError(error: unknown): boolean {
  if (isMissingTileError(error) || error instanceof InvalidTilePayloadError) return true;
  return error instanceof TileHttpError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429;
}

/**
 * Raised when a downloaded raster tile matches a known "missing data" SHA-256
 * fingerprint. Offline-map synchronization persists a no-data tombstone; a
 * runtime request fails so maplibre renders nothing instead of the placeholder.
 */
export class MissingTileError extends Error {
  readonly responseBytes: number;

  constructor(url: string, responseBytes = 0) {
    super(`Tile matched known missing-data hash: ${url}`);
    this.name = 'MissingTileError';
    this.responseBytes = responseBytes;
  }
}

export class InvalidTilePayloadError extends Error {
  constructor(url: string, reason: string) {
    super(`Invalid tile payload for ${url}: ${reason}`);
    this.name = 'InvalidTilePayloadError';
  }
}

export function isMissingTileError(error: unknown): error is MissingTileError {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: string }).name === 'MissingTileError',
  );
}

function hexFromArrayBuffer(buffer: ArrayBuffer): string {
  let hex = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * True when `data` is a known provider "no data" placeholder tile, detected by
 * SHA-256 fingerprint. Cheap-guarded: skips entirely when no hashes are
 * configured or when the URL is not a configured raster tile. A configured
 * fingerprint fails closed when SHA-256 is unavailable.
 */
async function isMissingDataTile(url: string, data: ArrayBuffer): Promise<boolean> {
  const layer = getMapLayerByTileUrl(url);
  const hashes = layer?.noDataSha256Hashes ?? [];
  if (hashes.length === 0) return false;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new InvalidTilePayloadError(url, 'SHA-256 unavailable');
  }
  try {
    const digest = await subtle.digest('SHA-256', data);
    return hashes.includes(hexFromArrayBuffer(digest));
  } catch (error) {
    if (error instanceof InvalidTilePayloadError) throw error;
    throw new InvalidTilePayloadError(url, 'SHA-256 validation failed');
  }
}

function createOperationSignal(external?: AbortSignal): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const signals = [external, cacheLifecycleController.signal].filter(
    (signal): signal is AbortSignal => Boolean(signal),
  );
  const abort = (signal: AbortSignal) => {
    controller.abort(signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted', 'AbortError'));
  };
  const listeners = signals.map((signal) => {
    const listener = () => abort(signal);
    if (signal.aborted) abort(signal);
    else signal.addEventListener('abort', listener, { once: true });
    return { signal, listener };
  });
  return {
    signal: controller.signal,
    dispose: () => {
      for (const item of listeners) item.signal.removeEventListener('abort', item.listener);
    },
  };
}

function hasUsableNetwork(): boolean {
  return !tileCacheOfflineMode;
}

export function setTileCacheOfflineMode(isOffline: boolean): void {
  tileCacheOfflineMode = isOffline;
  if (isOffline) {
    for (const controller of backgroundRefreshControllers.values()) controller.abort();
  }
}

/**
 * Allow (or disallow) pinned prefetch writes to exceed the tile-cache cap.
 * Only ever set true after explicit user approval.
 */
export function setTileCacheOverLimitApproved(approved: boolean): void {
  tileCacheOverLimitApproved = approved;
}

export function isTileCacheOverLimitApproved(): boolean {
  return tileCacheOverLimitApproved;
}

async function upsertTileStrict(
  url: string,
  data: ArrayBuffer,
  signal?: AbortSignal,
): Promise<void> {
  await writeTileWithCapacity(url, data, {
    isOnline: hasUsableNetwork(),
    maxCacheBytes: MAP.TILE_CACHE_MAX_BYTES,
    allowPinnedOverflow: tileCacheOverLimitApproved,
    signal,
  });
}

async function upsertTileBestEffort(
  url: string,
  data: ArrayBuffer,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await upsertTileStrict(url, data, signal);
  } catch {
    // Runtime map caching is best-effort.
  }
}

/**
 * Force-download a tile and persist it. Throws when network or storage fails.
 * Returns the number of downloaded bytes.
 */
/** Test-only seam for the strict runtime download path. */
export async function __fetchAndCacheTileForTests(
  url: string,
  signal?: AbortSignal,
): Promise<number> {
  if (!hasUsableNetwork()) {
    throw new Error(`Offline and no cached map for ${url}`);
  }
  const operation = createOperationSignal(signal);
  try {
    const outcome = await downloadValidatedTile(url, operation.signal);
    if (outcome.kind === 'no-data') {
      await writeNoDataTile(url, { signal: operation.signal });
      throw new MissingTileError(url, outcome.responseBytes);
    }
    await upsertTileStrict(url, outcome.data, operation.signal);
    return outcome.data.byteLength;
  } finally {
    operation.dispose();
  }
}

export async function fetchAndCacheOfflineMapTile(
  url: string,
  generationId: string,
  layerId: string,
  signal?: AbortSignal,
  previousSizeBytes = 0,
): Promise<{ downloadedBytes: number; cacheDeltaBytes: number }> {
  if (!hasUsableNetwork()) {
    throw new Error(`Offline and no cached map for ${url}`);
  }
  const operation = createOperationSignal(signal);
  try {
    const outcome = await downloadValidatedTile(url, operation.signal);
    if (outcome.kind === 'no-data') {
      const result = await writeNoDataTile(url, {
        signal: operation.signal,
        offlineMembership: { generationId, layerId },
      });
      return {
        downloadedBytes: outcome.responseBytes,
        cacheDeltaBytes: result.cacheDeltaBytes,
      };
    }
    const eviction = await writeTileWithCapacity(url, outcome.data, {
      isOnline: hasUsableNetwork(),
      maxCacheBytes: MAP.TILE_CACHE_MAX_BYTES,
      allowPinnedOverflow: tileCacheOverLimitApproved,
      signal: operation.signal,
      offlineMembership: { generationId, layerId },
    });
    throwIfSignalAborted(operation.signal);
    return {
      downloadedBytes: outcome.data.byteLength,
      cacheDeltaBytes: outcome.data.byteLength - previousSizeBytes - eviction.freedBytes,
    };
  } finally {
    operation.dispose();
  }
}

export async function claimCachedTilesForOfflineMap(
  urls: readonly string[],
  generationId: string,
  layerId: string,
  signal?: AbortSignal,
): Promise<Array<TileMetadataRecord | null>> {
  return claimCachedTilesForOfflineGeneration(
    urls,
    generationId,
    layerId,
    Date.now(),
    signal,
  );
}

/**
 * Evict all cached tiles whose URL begins with any of the supplied prefixes
 * (used to reclaim space when a layer's offline sync is turned off).
 */
export async function evictLayerTiles(prefixes: string[]): Promise<void> {
  await deleteTilesByUrlPrefixesFromStore(prefixes);
}

export async function clearCachedTiles(): Promise<void> {
  cacheEpoch += 1;
  cacheLifecycleController.abort(new DOMException('Tile cache cleared', 'AbortError'));
  cacheLifecycleController = new AbortController();
  for (const controller of backgroundRefreshControllers.values()) controller.abort();
  backgroundRefreshControllers.clear();
  refreshesInFlight.clear();
  backgroundRefreshTail = Promise.resolve();
  await clearCachedTilesFromStore();
}

// ==================== Cache-first fetch with stale-while-revalidate ====================

type TileDownloadOutcome =
  | { kind: 'raster'; data: ArrayBuffer }
  | { kind: 'no-data'; responseBytes: number };

async function downloadValidatedTile(
  url: string,
  signal?: AbortSignal,
): Promise<TileDownloadOutcome> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation: ((error: unknown) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new DOMException('Tile fetch timed out', 'TimeoutError');
      controller.abort(error);
      reject(error);
    }, MAP.TILE_FETCH_TIMEOUT_MS);
  });
  const onAbort = () => {
    const error = signal?.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted', 'AbortError');
    controller.abort(error);
    rejectCancellation?.(error);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfSignalAborted(signal);
    const operation = (async (): Promise<TileDownloadOutcome> => {
      const response = await fetch(url, { signal: controller.signal });
      throwIfSignalAborted(signal);
      if (!response.ok) throw new TileHttpError(url, response.status);
      if (isLayerTileUrl(url)) {
        const contentType = response.headers?.get?.('content-type')?.toLowerCase() ?? '';
        if (
          !contentType.startsWith('image/')
          && !contentType.startsWith('application/octet-stream')
        ) {
          throw new InvalidTilePayloadError(
            url,
            contentType ? `unexpected content type ${contentType}` : 'missing content type',
          );
        }
      }
      const data = await response.arrayBuffer();
      throwIfSignalAborted(signal);
      if (data.byteLength === 0) throw new InvalidTilePayloadError(url, 'empty response');
      if (await isMissingDataTile(url, data)) {
        throwIfSignalAborted(signal);
        return { kind: 'no-data', responseBytes: data.byteLength };
      }
      throwIfSignalAborted(signal);
      return { kind: 'raster', data };
    })();
    return await Promise.race([
      operation,
      timeout,
      cancellation,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}

function maybeTouchTile(metadata: TileMetadataRecord | null, url: string, now: number): void {
  if (
    metadata
    && metadata.prefetchOwnerCount === 0
    && now - metadata.lastAccessedAt >= MAP.TILE_LRU_TOUCH_INTERVAL_MS
  ) {
    void touchTileAccess(url, now, MAP.TILE_LRU_TOUCH_INTERVAL_MS);
  }
}


function enqueueBackgroundRefresh(url: string): void {
  if (refreshesInFlight.has(url) || !hasUsableNetwork()) return;
  const epoch = cacheEpoch;
  const controller = new AbortController();
  backgroundRefreshControllers.set(url, controller);
  const refresh = backgroundRefreshTail
    .catch(() => undefined)
    .then(async () => {
      if (!hasUsableNetwork() || epoch !== cacheEpoch) return;
      const operation = createOperationSignal(controller.signal);
      try {
        const outcome = await downloadValidatedTile(url, operation.signal);
        if (epoch !== cacheEpoch) throw new DOMException('Tile cache cleared', 'AbortError');
        if (outcome.kind === 'no-data') {
          await writeNoDataTile(url, { signal: operation.signal });
        } else {
          await upsertTileBestEffort(url, outcome.data, operation.signal);
        }
      } finally {
        operation.dispose();
      }
    })
    .catch(() => undefined)
    .finally(() => {
      if (refreshesInFlight.get(url) === refresh) refreshesInFlight.delete(url);
      if (backgroundRefreshControllers.get(url) === controller) {
        backgroundRefreshControllers.delete(url);
      }
    });
  refreshesInFlight.set(url, refresh);
  backgroundRefreshTail = refresh;
}

async function fetchWithCache(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  throwIfSignalAborted(signal);
  const now = Date.now();
  const cached = await getTileEntry(url);
  throwIfSignalAborted(signal);
  if (cached) {
    maybeTouchTile(cached.metadata, url, now);
    const fetchedAt = cached.metadata?.fetchedAt ?? 0;
    if (cached.metadata?.isNoData) {
      if (fetchedAt <= 0 || now - fetchedAt >= MAP.TILE_CACHE_MAX_AGE_MS) {
        enqueueBackgroundRefresh(url);
      }
      throw new MissingTileError(url);
    }
    if (fetchedAt > 0 && now - fetchedAt < MAP.TILE_CACHE_MAX_AGE_MS) {
      return cached.data!;
    }
    enqueueBackgroundRefresh(url);
    return cached.data!;
  }
  if (!hasUsableNetwork()) throw new Error(`Offline and no cached map for ${url}`);

  const operation = createOperationSignal(signal);
  try {
    const outcome = await downloadValidatedTile(url, operation.signal);
    throwIfSignalAborted(operation.signal);
    if (outcome.kind === 'no-data') {
      await writeNoDataTile(url, { signal: operation.signal });
      throw new MissingTileError(url, outcome.responseBytes);
    }
    await upsertTileBestEffort(url, outcome.data, operation.signal);
    throwIfSignalAborted(operation.signal);
    return outcome.data;
  } finally {
    operation.dispose();
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
 * Build the maplibre style for a given layer from the bundled layer config and
 * rewrite its tile URLs to `cached-https://` so all tile requests flow through
 * the offline cache (and the magic-hash missing-tile check). The style itself
 * is bundled, so this resolves offline without any network or cached document.
 */
export async function getCachedLayerStyle(
  layerId: string,
): Promise<Record<string, unknown>> {
  return rewriteUrls(buildLayerStyle(layerId));
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
