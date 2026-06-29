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
  fetchAndCachePinnedTile,
  runTileCacheStartupMaintenance,
  setTileCacheOfflineMode,
} from './TileCacheService';
import { MAP } from '../constants';
import {
  __clearTileCacheRepositoryForTests,
  getTile,
  getTileCacheStats,
  getTileMetadata,
  upsertTile,
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
      await upsertTile(
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

  describe('prefetch pinning', () => {
    it('marks strict prefetch writes as pinned metadata', async () => {
      const payload = new Uint8Array([1, 2, 3]).buffer;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(payload),
      });

      await fetchAndCachePinnedTile('https://tiles.example.com/1/1/1.png');

      const metadata = await getTileMetadata('https://tiles.example.com/1/1/1.png');
      expect(metadata?.pinnedByAutoPrefetch).toBe(true);
    });

    it('does not attempt tile download when offline mode is forced', async () => {
      setTileCacheOfflineMode(true);
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      globalThis.fetch = vi.fn();

      await expect(
        fetchAndCachePinnedTile('https://tiles.example.com/1/1/1.png'),
      ).rejects.toThrow('Offline and no cached map');
      expect(globalThis.fetch).not.toHaveBeenCalled();
      onlineSpy.mockRestore();
    });

    it('bumps pinned access time during startup maintenance', async () => {
      await upsertTile('https://tiles.example.com/pinned.png', new Uint8Array([1]).buffer, {
        pinnedByAutoPrefetch: true,
        now: 10,
      });

      await runTileCacheStartupMaintenance();

      const metadata = await getTileMetadata('https://tiles.example.com/pinned.png');
      expect((metadata?.lastAccessedAt ?? 0) >= 10).toBe(true);
    });
  });

  describe('cache cleanup', () => {
    it('clears cached tiles and tile metadata', async () => {
      const tileUrl = 'https://tiles.example.com/clear-me.png';
      await upsertTile(tileUrl, new Uint8Array([1, 2, 3]).buffer, {
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

    it('prefetch: a magic-hash tile is treated as missing (0 bytes, not stored)', async () => {
      installDigest(MAGIC_HASH);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      });

      const bytes = await fetchAndCachePinnedTile(TILE_URL);

      expect(bytes).toBe(0);
      expect(await getTile(TILE_URL)).toBeNull();
      expect(await getTileMetadata(TILE_URL)).toBeNull();
    });

    it('prefetch: a non-matching tile is cached normally', async () => {
      installDigest('00'.repeat(32));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      });

      const bytes = await fetchAndCachePinnedTile(TILE_URL);

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

      const bytes = await fetchAndCachePinnedTile(nonTileUrl);

      // isLayerTileUrl is false, so the hash check is skipped and the tile cached.
      expect(bytes).toBe(2);
      expect(await getTile(nonTileUrl)).not.toBeNull();
    });
  });
});
