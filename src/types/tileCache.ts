export interface TileMetadataRecord {
  url: string;
  sizeBytes: number;
  lastAccessedAt: number;
  pinnedByAutoPrefetch: boolean;
  createdAt: number;
  updatedAt: number;
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

export interface TileCacheCapacityPlan {
  projectedBytesAfterWrite: number;
  bytesThatMustBeFreed: number;
}
