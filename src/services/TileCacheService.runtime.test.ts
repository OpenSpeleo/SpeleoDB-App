import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock maplibre-gl before importing the module under test so we can capture the
// `cached-https` protocol handler (the real runtime tile-fetch path).
vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
  },
}));

import maplibregl from 'maplibre-gl';
import {
  clearCachedTiles,
  registerTileCacheProtocol,
  setTileCacheOfflineMode,
  isMissingTileError,
} from './TileCacheService';
import { MAP } from '../constants';
import {
  __clearTileCacheRepositoryForTests,
  getTile,
  getTileCacheStats,
  getTileMetadata,
  __seedTileCacheEntryForTests,
} from './tileCache/TileCacheRepository';

type ProtocolHandler = (
  params: { url: string },
  abortController?: AbortController,
) => Promise<{ data: ArrayBuffer }>;

const TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/1/2';
const CACHED_TILE_URL = TILE_URL.replace('https://', 'cached-https://');

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

function installDigest(hex: string): void {
  Object.defineProperty(globalThis, 'crypto', {
    value: { subtle: { digest: vi.fn().mockResolvedValue(hexToArrayBuffer(hex)) } },
    configurable: true,
    writable: true,
  });
}

/** Capture the handler passed to maplibre's addProtocol (registered once). */
function getProtocolHandler(): ProtocolHandler {
  registerTileCacheProtocol();
  const calls = (maplibregl.addProtocol as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls.find((c) => c[0] === 'cached-https');
  if (!call) throw new Error('cached-https protocol was not registered');
  return call[1] as ProtocolHandler;
}

describe('TileCacheService runtime magic-hash (cached-https protocol)', () => {
  const MAGIC_HASH = MAP.MISSING_TILE_SHA256_HASHES[0];
  let originalCrypto: Crypto;

  beforeEach(async () => {
    originalCrypto = globalThis.crypto;
    setTileCacheOfflineMode(false);
    await __clearTileCacheRepositoryForTests();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  });

  it('persists a magic-hash tombstone and serves it offline without another request', async () => {
    installDigest(MAGIC_HASH);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });

    const handler = getProtocolHandler();
    await expect(handler({ url: CACHED_TILE_URL })).rejects.toSatisfy(isMissingTileError);

    // No provider bytes are retained; only the authoritative null answer is.
    expect(await getTile(TILE_URL)).toBeNull();
    expect(await getTileMetadata(TILE_URL)).toMatchObject({ isNoData: true, sizeBytes: 0 });

    setTileCacheOfflineMode(true);
    vi.mocked(globalThis.fetch).mockClear();
    await expect(handler({ url: CACHED_TILE_URL })).rejects.toSatisfy(isMissingTileError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('resolves and caches a normal (non-matching) tile', async () => {
    installDigest('00'.repeat(32));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: () => Promise.resolve(new Uint8Array([9, 9, 9, 9]).buffer),
    });

    const handler = getProtocolHandler();
    const result = await handler({ url: CACHED_TILE_URL });
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([9, 9, 9, 9]));

    // The tile is cached in the background (non-blocking). Wait for metadata
    // and stats too: seeing the payload alone does not prove that the IndexedDB
    // transaction has finished.
    await vi.waitFor(async () => {
      expect(await getTileMetadata(TILE_URL)).not.toBeNull();
      expect((await getTileCacheStats()).tileCount).toBe(1);
    });
  });

  it('serves a fresh online cache hit without issuing any network request', async () => {
    const bytes = new Uint8Array([7, 7, 7]).buffer;
    await __seedTileCacheEntryForTests(TILE_URL, bytes, { pinnedByAutoPrefetch: false, now: Date.now() });
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));

    const result = await getProtocolHandler()({ url: CACHED_TILE_URL });

    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([7, 7, 7]));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns a stale tile before its deduplicated refresh settles', async () => {
    const stale = new Uint8Array([4, 4, 4]).buffer;
    const fresh = new Uint8Array([8, 8, 8]).buffer;
    await __seedTileCacheEntryForTests(TILE_URL, stale, {
      pinnedByAutoPrefetch: false,
      now: Date.now() - MAP.TILE_CACHE_MAX_AGE_MS,
    });
    let resolveFetch: (value: Response) => void = () => {};
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));

    const handler = getProtocolHandler();
    const [first, second] = await Promise.all([
      handler({ url: CACHED_TILE_URL }),
      handler({ url: CACHED_TILE_URL }),
    ]);
    expect(new Uint8Array(first.data)).toEqual(new Uint8Array([4, 4, 4]));
    expect(new Uint8Array(second.data)).toEqual(new Uint8Array([4, 4, 4]));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(fresh, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    await vi.waitFor(async () => {
      expect(new Uint8Array((await getTile(TILE_URL))!)).toEqual(new Uint8Array([8, 8, 8]));
    });
  });

  it('preserves stale bytes when a background replacement fails', async () => {
    const stale = new Uint8Array([3, 2, 1]).buffer;
    await __seedTileCacheEntryForTests(TILE_URL, stale, {
      pinnedByAutoPrefetch: false,
      now: Date.now() - MAP.TILE_CACHE_MAX_AGE_MS - 1,
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    const result = await getProtocolHandler()({ url: CACHED_TILE_URL });
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([3, 2, 1]));
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(new Uint8Array((await getTile(TILE_URL))!)).toEqual(new Uint8Array([3, 2, 1]));
  });

  it('does not let a late stale refresh repopulate a cleared cache', async () => {
    installDigest('00'.repeat(32));
    await __seedTileCacheEntryForTests(TILE_URL, new Uint8Array([4]).buffer, {
      pinnedByAutoPrefetch: false,
      now: Date.now() - MAP.TILE_CACHE_MAX_AGE_MS - 1,
    });
    let resolveFetch: (value: Response) => void = () => {};
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));

    await getProtocolHandler()({ url: CACHED_TILE_URL });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
    await clearCachedTiles();
    resolveFetch(new Response(new Uint8Array([9]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));

    await Promise.resolve();
    await Promise.resolve();
    expect(await getTile(TILE_URL)).toBeNull();
    expect(await getTileMetadata(TILE_URL)).toBeNull();
  });

  it('does not let a late stale refresh write after offline logout begins', async () => {
    installDigest('00'.repeat(32));
    const stale = new Uint8Array([4]).buffer;
    await __seedTileCacheEntryForTests(TILE_URL, stale, {
      pinnedByAutoPrefetch: false,
      now: Date.now() - MAP.TILE_CACHE_MAX_AGE_MS - 1,
    });
    let resolveFetch: (value: Response) => void = () => {};
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));

    await getProtocolHandler()({ url: CACHED_TILE_URL });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
    setTileCacheOfflineMode(true);
    resolveFetch(new Response(new Uint8Array([9]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));

    await Promise.resolve();
    await Promise.resolve();
    expect(new Uint8Array((await getTile(TILE_URL))!)).toEqual(new Uint8Array([4]));
  });
});
