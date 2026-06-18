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
  registerTileCacheProtocol,
  setTileCacheOfflineMode,
  isMissingTileError,
} from './TileCacheService';
import { MAP } from '../constants';
import { __clearTileCacheRepositoryForTests, getTile } from './tileCache/TileCacheRepository';

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

  it('rejects (treats as 404) and does not cache a magic-hash tile', async () => {
    installDigest(MAGIC_HASH);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });

    const handler = getProtocolHandler();
    await expect(handler({ url: CACHED_TILE_URL })).rejects.toSatisfy(isMissingTileError);

    // Critically: a missing-data tile is never written to the cache, so it can
    // never be served stale on a later offline read.
    expect(await getTile(TILE_URL)).toBeNull();
  });

  it('resolves and caches a normal (non-matching) tile', async () => {
    installDigest('00'.repeat(32));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([9, 9, 9, 9]).buffer),
    });

    const handler = getProtocolHandler();
    const result = await handler({ url: CACHED_TILE_URL });
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([9, 9, 9, 9]));

    // The tile is cached in the background (non-blocking); allow the microtask
    // queue to drain so the upsert lands.
    await vi.waitFor(async () => {
      expect(await getTile(TILE_URL)).not.toBeNull();
    });
  });
});
