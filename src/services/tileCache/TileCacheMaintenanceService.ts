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
  return true;
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
  /**
   * When true, a pinned-blocked write that cannot be satisfied by evicting
   * unpinned tiles is permitted to exceed `maxCacheBytes` instead of throwing.
   * This is opt-in and driven by explicit user consent (see TileCacheService).
   */
  allowOverLimit: () => boolean;
}

const DEFAULT_DEPENDENCIES: TileCacheMaintenanceDependencies = {
  isOnline: defaultIsOnline,
  now: defaultNow,
  maxCacheBytes: MAP.TILE_CACHE_MAX_BYTES,
  allowOverLimit: () => false,
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
      // The cap cannot be honored because pinned (auto-prefetched) tiles are
      // not evictable. Only overflow when the user has explicitly approved it;
      // otherwise surface the capacity error so the consent flow can prompt.
      if (!this.deps.allowOverLimit()) {
        throw new TileCacheCapacityError(
          'Tile cache is full and pinned auto-prefetched maps prevent further eviction.',
        );
      }
      // Approved overflow: reclaim whatever unpinned space we can and let the
      // write proceed beyond the cap.
      return deleteTilesByMetadata(toEvict, this.deps.now());
    }

    return deleteTilesByMetadata(toEvict, this.deps.now());
  }
}
