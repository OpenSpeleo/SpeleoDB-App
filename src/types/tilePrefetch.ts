export type TilePrefetchStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'done'
  | 'error';

export interface TilePrefetchJobState {
  projectId: string;
  commitId: string;
  status: TilePrefetchStatus;
  zoomMin: number;
  zoomMax: number;
  padMeters: number;
  totalTiles: number;
  completedTiles: number;
  failedTiles: number;
  bytesDownloaded: number;
  estimatedBytes: number;
  message?: string;
  /**
   * True when the job stalled because writing tiles would exceed the cache cap
   * and pinned tiles cannot be evicted. Cleared on the next successful write.
   * Drives the storage-consent prompt.
   */
  blockedByStorage?: boolean;
  updatedAt: number;
}

export interface TilePrefetchProjectInput {
  projectId: string;
  commitId: string;
  geojson: GeoJSON.FeatureCollection;
}

/**
 * Generic prefetch target driven by a precomputed list of tile URLs (rather
 * than geometry). Used for the combined landmarks job, whose tile set is the
 * deduped union of per-landmark padded boxes.
 */
export interface TilePrefetchTileUrlsInput {
  id: string;
  commitId: string;
  tileUrls: string[];
  zoomMin: number;
  zoomMax: number;
  padMeters: number;
}

export interface TilePrefetchRequest {
  tileUrlTemplate: string;
  minZoom: number;
  maxZoom: number;
  padMeters: number;
}
