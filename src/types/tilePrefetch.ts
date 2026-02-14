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
  updatedAt: number;
}

export interface TilePrefetchProjectInput {
  projectId: string;
  commitId: string;
  geojson: GeoJSON.FeatureCollection;
}

export interface TilePrefetchRequest {
  tileUrlTemplate: string;
  minZoom: number;
  maxZoom: number;
  padMeters: number;
}
