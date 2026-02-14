import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock maplibre-gl before importing the module under test
vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: vi.fn(),
  },
}));

import maplibregl from 'maplibre-gl';
import { registerTileCacheProtocol, getCachedStyle } from './TileCacheService';

// ==================== Tests ====================

describe('TileCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        getCachedStyle('https://example.com/style.json'),
      ).rejects.toThrow();
    });
  });
});
