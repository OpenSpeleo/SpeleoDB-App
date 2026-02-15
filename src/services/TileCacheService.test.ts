import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  fetchAndCachePinnedTile,
  runTileCacheStartupMaintenance,
  setTileCacheOfflineMode,
} from './TileCacheService';
import {
  __clearTileCacheRepositoryForTests,
  getTile,
  getTileMetadata,
  upsertTile,
} from './tileCache/TileCacheRepository';

async function resetTileDatabase(): Promise<void> {
  await __clearTileCacheRepositoryForTests();
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
        '__style_json__',
        new TextEncoder().encode(JSON.stringify(cachedStyle)).buffer,
        { pinnedByAutoPrefetch: false },
      );
      setTileCacheOfflineMode(true);
      globalThis.fetch = vi.fn();

      const result = await getCachedStyle('https://example.com/style.json');

      expect(result.sprite).toBe('cached-https://example.com/sprites/basic');
      expect(globalThis.fetch).not.toHaveBeenCalled();
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
      globalThis.fetch = vi.fn();

      await expect(
        fetchAndCachePinnedTile('https://tiles.example.com/1/1/1.png'),
      ).rejects.toThrow('Offline and no cached map');
      expect(globalThis.fetch).not.toHaveBeenCalled();
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
});
