import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('maplibre-gl', () => ({
  addProtocol: vi.fn(),
  setWorkerUrl: vi.fn(),
}));

// Empty the missing-tile hash list so the magic-hash check must short-circuit
// (cheap guard): a tile is cached normally even if its digest "would" match.
vi.mock('../constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants')>();
  return {
    ...actual,
    MAP: { ...actual.MAP, MISSING_TILE_SHA256_HASHES: [] as readonly string[] },
    MAP_LAYERS: actual.MAP_LAYERS.map((layer) => ({
      ...layer,
      noDataSha256Hashes: [],
    })),
  };
});

import { __fetchAndCacheTileForTests, setTileCacheOfflineMode } from './TileCacheService';
import { __clearTileCacheRepositoryForTests, getTile } from './tileCache/TileCacheRepository';

const TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/1/2';

describe('TileCacheService magic-hash with an empty hash list', () => {
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

  it('skips hashing entirely and caches the tile (digest never consulted)', async () => {
    // A digest spy that would throw if called, proving the empty-list guard
    // short-circuits before any crypto work.
    const digest = vi.fn(() => {
      throw new Error('digest should not be called when the hash list is empty');
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { digest } },
      configurable: true,
      writable: true,
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4, 5]).buffer),
    });

    const bytes = await __fetchAndCacheTileForTests(TILE_URL);

    expect(bytes).toBe(5);
    expect(digest).not.toHaveBeenCalled();
    expect(await getTile(TILE_URL)).not.toBeNull();
  });
});
