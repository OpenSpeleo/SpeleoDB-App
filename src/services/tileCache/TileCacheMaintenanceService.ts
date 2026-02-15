import { MAP } from '../../constants';
import type {
  TileCacheCapacityPlan,
  TileCacheEvictionResult,
  TileMetadataRecord,
} from '../../types/tileCache';
import {
  deleteTilesByMetadata,
  getTileCacheStats,
  getTileMetadata,
  listUnpinnedTilesOldestFirst,
  touchPinnedTiles,
} from './TileCacheRepository';

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function defaultNow(): number {
  return Date.now();
}

export class TileCacheCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TileCacheCapacityError';
  }
}

export interface TileCacheMaintenanceDependencies {
  isOnline: () => boolean;
  now: () => number;
  maxCacheBytes: number;
}

const DEFAULT_DEPENDENCIES: TileCacheMaintenanceDependencies = {
  isOnline: defaultIsOnline,
  now: defaultNow,
  maxCacheBytes: MAP.TILE_CACHE_MAX_BYTES,
};

export class TileCacheMaintenanceService {
  private deps: TileCacheMaintenanceDependencies;

  constructor(customDeps: Partial<TileCacheMaintenanceDependencies> = {}) {
    this.deps = { ...DEFAULT_DEPENDENCIES, ...customDeps };
  }

  async runStartupMaintenance(): Promise<void> {
    const now = this.deps.now();
    await touchPinnedTiles(now);
  }

  async ensureCapacityBeforeWrite(
    url: string,
    incomingBytes: number,
  ): Promise<TileCacheEvictionResult> {
    const plan = await this.getCapacityPlan(url, incomingBytes);
    if (plan.bytesThatMustBeFreed <= 0) {
      return { evictedTileCount: 0, freedBytes: 0 };
    }
    if (!this.deps.isOnline()) {
      throw new TileCacheCapacityError(
        'Tile cache write would exceed limit while offline; eviction is disabled.',
      );
    }
    return this.evictOldestUnpinned(plan.bytesThatMustBeFreed, new Set([url]));
  }

  async pruneToLimit(): Promise<TileCacheEvictionResult> {
    const stats = await getTileCacheStats(this.deps.now());
    const bytesOverLimit = stats.totalBytes - this.deps.maxCacheBytes;
    if (bytesOverLimit <= 0) {
      return { evictedTileCount: 0, freedBytes: 0 };
    }
    if (!this.deps.isOnline()) {
      return { evictedTileCount: 0, freedBytes: 0 };
    }
    return this.evictOldestUnpinned(bytesOverLimit);
  }

  private async getCapacityPlan(
    url: string,
    incomingBytes: number,
  ): Promise<TileCacheCapacityPlan> {
    const [stats, existing] = await Promise.all([
      getTileCacheStats(this.deps.now()),
      getTileMetadata(url),
    ]);
    const existingBytes = existing?.sizeBytes ?? 0;
    const projectedBytesAfterWrite =
      stats.totalBytes - existingBytes + incomingBytes;
    return {
      projectedBytesAfterWrite,
      bytesThatMustBeFreed: Math.max(
        0,
        projectedBytesAfterWrite - this.deps.maxCacheBytes,
      ),
    };
  }

  private async evictOldestUnpinned(
    bytesThatMustBeFreed: number,
    skipUrls = new Set<string>(),
  ): Promise<TileCacheEvictionResult> {
    if (bytesThatMustBeFreed <= 0) {
      return { evictedTileCount: 0, freedBytes: 0 };
    }

    const candidates = await listUnpinnedTilesOldestFirst();
    const toEvict: TileMetadataRecord[] = [];
    let bytesPlanned = 0;

    for (const candidate of candidates) {
      if (skipUrls.has(candidate.url)) continue;
      toEvict.push(candidate);
      bytesPlanned += candidate.sizeBytes;
      if (bytesPlanned >= bytesThatMustBeFreed) break;
    }

    if (bytesPlanned < bytesThatMustBeFreed) {
      throw new TileCacheCapacityError(
        'Tile cache is full and pinned auto-prefetched maps prevent further eviction.',
      );
    }

    return deleteTilesByMetadata(toEvict, this.deps.now());
  }
}
