export interface TileMetadataRecord {
  url: string;
  sizeBytes: number;
  /** Authoritative provider response indicating that no raster exists here. */
  isNoData: boolean;
  /** Time the payload was last successfully fetched from the tile provider. */
  fetchedAt: number;
  lastAccessedAt: number;
  /** Number of durable offline-prefetch owners currently claiming this tile. */
  prefetchOwnerCount: number;
  /**
   * Compatibility projection retained in persisted metadata across the v5/v6
   * migrations. New code derives this from `prefetchOwnerCount`.
   */
  pinnedByAutoPrefetch: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TileCacheEntry {
  /** Null only for a durable no-data tombstone. */
  data: ArrayBuffer | null;
  metadata: TileMetadataRecord | null;
}

export interface TileCacheStatsRecord {
  totalBytes: number;
  tileCount: number;
  pinnedBytes: number;
  pinnedTileCount: number;
  updatedAt: number;
}

export interface TileCacheEvictionResult {
  evictedTileCount: number;
  freedBytes: number;
}

export interface TileWriteOptions {
  now?: number;
  isOnline: boolean;
  maxCacheBytes: number;
  allowPinnedOverflow: boolean;
  signal?: AbortSignal;
  offlineMembership?: {
    generationId: string;
    layerId: string;
  };
}
