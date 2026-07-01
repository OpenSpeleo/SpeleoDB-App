import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock maplibre-gl before importing the module under test
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
  getCachedStyle,
  getCachedLayerStyle,
  __fetchAndCacheTileForTests,
  InvalidTilePayloadError,
  isMissingTileError,
  isTerminalTileFetchError,
  setTileCacheOfflineMode,
  TileHttpError,
} from './TileCacheService';
import { MAP } from '../constants';
import {
  __clearTileCacheRepositoryForTests,
  getTile,
  getTileCacheStats,
  getTileMetadata,
  __seedTileCacheEntryForTests,
} from './tileCache/TileCacheRepository';

const STYLE_CACHE_KEY = '__style_json__';

async function resetTileDatabase(): Promise<void> {
  await __clearTileCacheRepositoryForTests();
}

async function expectBackgroundWriteToFinish(url: string): Promise<void> {
  await vi.waitFor(async () => {
    expect(await getTileMetadata(url)).not.toBeNull();
    expect((await getTileCacheStats()).tileCount).toBe(1);
  });
}

// ==================== Tests ====================

describe('TileCacheService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setTileCacheOfflineMode(false);
    await resetTileDatabase();
  });

  it('times out a tile transport that ignores abort', async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));
      const pending = __fetchAndCacheTileForTests('https://tiles.example.com/stuck.png');
      const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });

      await vi.advanceTimersByTimeAsync(MAP.TILE_FETCH_TIMEOUT_MS);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out when response headers arrive but the body never settles', async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
      } as Response));
      const pending = __fetchAndCacheTileForTests('https://tiles.example.com/stuck-body.png');
      const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(MAP.TILE_FETCH_TIMEOUT_MS);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the same deadline when SHA-256 validation never settles', async () => {
    vi.useFakeTimers();
    const originalCrypto = globalThis.crypto;
    const url = MAP.TILE_URL_TEMPLATE
      .replace('{z}', '5').replace('{x}', '1').replace('{y}', '2');
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { digest: () => new Promise<ArrayBuffer>(() => {}) } },
      configurable: true,
      writable: true,
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    try {
      const pending = __fetchAndCacheTileForTests(url);
      const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(MAP.TILE_FETCH_TIMEOUT_MS);
      await rejection;
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto, configurable: true, writable: true,
      });
      vi.useRealTimers();
    }
  });

  it('rejects an HTTP 200 non-raster body without caching it', async () => {
    const url = MAP.TILE_URL_TEMPLATE
      .replace('{z}', '5').replace('{x}', '1').replace('{y}', '2');
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>nope</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    await expect(__fetchAndCacheTileForTests(url)).rejects.toMatchObject({
      name: 'InvalidTilePayloadError',
    });
    expect(await getTile(url)).toBeNull();
  });

  it('fails closed when a configured no-data hash cannot be verified', async () => {
    const originalCrypto = globalThis.crypto;
    const url = MAP.TILE_URL_TEMPLATE
      .replace('{z}', '5').replace('{x}', '1').replace('{y}', '2');
    Object.defineProperty(globalThis, 'crypto', {
      value: {}, configurable: true, writable: true,
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    try {
      await expect(__fetchAndCacheTileForTests(url)).rejects.toMatchObject({
        name: 'InvalidTilePayloadError',
      });
      expect(await getTile(url)).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto, configurable: true, writable: true,
      });
    }
  });

  it('does not apply the satellite no-data fingerprint to hillshade', async () => {
    const originalCrypto = globalThis.crypto;
    const digest = vi.fn(() => { throw new Error('hillshade must not be hashed'); });
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { digest } }, configurable: true, writable: true,
    });
    const url = 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/5/1/2';
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    try {
      await expect(__fetchAndCacheTileForTests(url)).resolves.toBe(2);
      expect(digest).not.toHaveBeenCalled();
      expect(await getTile(url)).not.toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto, configurable: true, writable: true,
      });
    }
  });

  it('classifies an empty raster response as terminal and never stores it', async () => {
    const url = 'https://tiles.example.com/empty.png';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    await expect(__fetchAndCacheTileForTests(url)).rejects.toSatisfy(isTerminalTileFetchError);
    expect(await getTile(url)).toBeNull();
  });

  it.each([
    [408, false],
    [429, false],
    [500, false],
    [503, false],
    [400, true],
    [404, true],
  ])('classifies HTTP %i retryability explicitly', (status, terminal) => {
    expect(isTerminalTileFetchError(new TileHttpError('https://tile', status))).toBe(terminal);
  });

  it('treats invalid raster validation as terminal and transport errors as retryable', () => {
    expect(isTerminalTileFetchError(
      new InvalidTilePayloadError('https://tile', 'invalid'),
    )).toBe(true);
    expect(isTerminalTileFetchError(new TypeError('network failed'))).toBe(false);
  });

  describe('registerTileCacheProtocol', () => {
    it('calls maplibregl.addProtocol with "cached-https"', () => {
      // Reset module to clear the `protocolRegistered` flag.
      // Since it's a module-level singleton, we test the mock was called.
      // The module registers once on import from Dashboard, so addProtocol
      // may have been called already. Check it was called at least once.
      registerTileCacheProtocol();
      expect(maplibregl.addProtocol).toHaveBeenCalledWith(
        'cached-https',
        expect.any(Function),
      );
    });
  });

  describe('getCachedStyle', () => {
    it('fetches and rewrites URLs to cached-https protocol', async () => {
      const mockStyle = {
        version: 8,
        sprite: 'https://example.com/sprites/basic',
        glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
        sources: {
          openmaptiles: {
            type: 'vector',
            tiles: ['https://example.com/tiles/{z}/{x}/{y}.pbf'],
          },
        },
        layers: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStyle),
      });

      const result = await getCachedStyle('https://example.com/style.json');

      expect(result.sprite).toBe('cached-https://example.com/sprites/basic');
      expect(result.glyphs).toBe(
        'cached-https://example.com/fonts/{fontstack}/{range}.pbf',
      );

      const sources = result.sources as Record<
        string,
        { tiles: string[] }
      >;
      expect(sources.openmaptiles.tiles[0]).toBe(
        'cached-https://example.com/tiles/{z}/{x}/{y}.pbf',
      );
      await expectBackgroundWriteToFinish(STYLE_CACHE_KEY);
    });

    it('preserves non-https URLs unchanged', async () => {
      const mockStyle = {
        version: 8,
        sprite: 'http://local.dev/sprites',
        glyphs: 'http://local.dev/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStyle),
      });

      const result = await getCachedStyle('https://example.com/style.json');

      // http:// URLs should not be rewritten (only https://)
      expect(result.sprite).toBe('http://local.dev/sprites');
      expect(result.glyphs).toBe(
        'http://local.dev/fonts/{fontstack}/{range}.pbf',
      );
      await expectBackgroundWriteToFinish(STYLE_CACHE_KEY);
    });

    it('throws when offline and no cache available', async () => {
      await Promise.resolve();
      await resetTileDatabase();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        getCachedStyle('https://example.com/style.json'),
      ).rejects.toThrow();
    });

    it('uses cached style without network calls when offline mode is forced', async () => {
      const cachedStyle = {
        version: 8,
        sprite: 'https://example.com/sprites/basic',
        glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [],
      };
      await __seedTileCacheEntryForTests(
        STYLE_CACHE_KEY,
        new TextEncoder().encode(JSON.stringify(cachedStyle)).buffer,
        { pinnedByAutoPrefetch: false, now: 1 },
      );
      setTileCacheOfflineMode(true);
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      globalThis.fetch = vi.fn();

      const result = await getCachedStyle('https://example.com/style.json');

      expect(result.sprite).toBe('cached-https://example.com/sprites/basic');
      expect(globalThis.fetch).not.toHaveBeenCalled();
      await vi.waitFor(async () => {
        expect((await getTileMetadata(STYLE_CACHE_KEY))?.lastAccessedAt).toBeGreaterThan(1);
      });
      onlineSpy.mockRestore();
    });
  });

  describe('strict downloads', () => {
    it('leaves browsing downloads eligible for normal LRU eviction', async () => {
      const payload = new Uint8Array([1, 2, 3]).buffer;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(payload),
      });

      await __fetchAndCacheTileForTests('https://tiles.example.com/1/1/1.png');

      const metadata = await getTileMetadata('https://tiles.example.com/1/1/1.png');
      expect(metadata?.pinnedByAutoPrefetch).toBe(false);
    });

    it('does not attempt tile download when offline mode is forced', async () => {
      setTileCacheOfflineMode(true);
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      globalThis.fetch = vi.fn();

      await expect(
        __fetchAndCacheTileForTests('https://tiles.example.com/1/1/1.png'),
      ).rejects.toThrow('Offline and no cached map');
      expect(globalThis.fetch).not.toHaveBeenCalled();
      onlineSpy.mockRestore();
    });

  });

  describe('cache cleanup', () => {
    it('clears cached tiles and tile metadata', async () => {
      const tileUrl = 'https://tiles.example.com/clear-me.png';
      await __seedTileCacheEntryForTests(tileUrl, new Uint8Array([1, 2, 3]).buffer, {
        pinnedByAutoPrefetch: false,
      });

      expect(await getTile(tileUrl)).not.toBeNull();
      expect(await getTileMetadata(tileUrl)).not.toBeNull();

      await clearCachedTiles();

      expect(await getTile(tileUrl)).toBeNull();
      expect(await getTileMetadata(tileUrl)).toBeNull();
    });
  });

  describe('getCachedLayerStyle', () => {
    it('builds a raster style for the layer with cached-https tile URLs', async () => {
      const style = await getCachedLayerStyle('esri-satellite');
      const sources = style.sources as Record<string, { tiles: string[] }>;
      const tiles = sources['esri-satellite'].tiles;
      expect(tiles[0].startsWith('cached-https://')).toBe(true);
      expect(tiles[0]).toContain('World_Imagery');
    });

    it('falls back to the satellite layer for an unknown id', async () => {
      const style = await getCachedLayerStyle('bogus-layer');
      expect(Object.keys(style.sources as object)).toEqual(['esri-satellite']);
    });
  });

  describe('magic-hash missing-tile detection', () => {
    const MAGIC_HASH = MAP.MISSING_TILE_SHA256_HASHES[0];
    const TILE_URL =
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/1/2';
    let originalCrypto: Crypto;

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

    beforeEach(() => {
      originalCrypto = globalThis.crypto;
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    });

    it('stores only a no-data tombstone for a magic-hash response', async () => {
      installDigest(MAGIC_HASH);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      });

      await expect(__fetchAndCacheTileForTests(TILE_URL)).rejects.toSatisfy(isMissingTileError);
      expect(await getTile(TILE_URL)).toBeNull();
      expect(await getTileMetadata(TILE_URL)).toMatchObject({
        isNoData: true,
        sizeBytes: 0,
      });
      expect(await getTileCacheStats()).toMatchObject({ totalBytes: 0, tileCount: 1 });
    });

    it('does not create a no-data tombstone for an HTTP 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      await expect(__fetchAndCacheTileForTests(TILE_URL)).rejects.toMatchObject({
        name: 'TileHttpError',
        status: 404,
      });
      expect(await getTile(TILE_URL)).toBeNull();
      expect(await getTileMetadata(TILE_URL)).toBeNull();
    });

    it('a non-matching tile is cached normally', async () => {
      installDigest('00'.repeat(32));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      });

      const bytes = await __fetchAndCacheTileForTests(TILE_URL);

      expect(bytes).toBe(3);
      expect(await getTile(TILE_URL)).not.toBeNull();
    });

    it('does not hash non-tile URLs (caches them even if digest would match)', async () => {
      installDigest(MAGIC_HASH);
      const nonTileUrl = 'https://fonts.example.com/glyphs/0-255.pbf';
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([7, 7]).buffer),
      });

      const bytes = await __fetchAndCacheTileForTests(nonTileUrl);

      // isLayerTileUrl is false, so the hash check is skipped and the tile cached.
      expect(bytes).toBe(2);
      expect(await getTile(nonTileUrl)).not.toBeNull();
    });
  });
});
