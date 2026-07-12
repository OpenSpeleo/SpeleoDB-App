export interface OfflineMapCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface OfflineMapPlanRecord {
  id: string;
  sourceRevision: string;
  coverageVersion: number;
  coordinateCount: number;
  chunkCount: number;
  createdAt: number;
}

export interface OfflineMapPlanChunkRecord {
  planId: string;
  index: number;
  /** Flat z/x/y triples. IndexedDB stores typed arrays without JSON expansion. */
  coordinates: Uint32Array;
}

/** Legacy v8 staging row retained only for upgrade/crash cleanup compatibility. */
export interface OfflineMapPlanCoordinateRecord extends OfflineMapCoordinate {
  buildId: string;
}

export type OfflineMapGenerationStatus =
  | 'pending'
  | 'active'
  | 'failed'
  | 'releasing';

export interface OfflineMapGenerationRecord {
  id: string;
  planId: string;
  layerId: string;
  status: OfflineMapGenerationStatus;
  totalTiles: number;
  completedTiles: number;
  failedTiles: number;
  bytesDownloaded: number;
  refreshAfter: number;
  updatedAt: number;
}

export interface OfflineMapMembershipRecord {
  generationId: string;
  layerId: string;
  url: string;
  updatedAt: number;
}

export type OfflineMapSyncPhase =
  | 'idle'
  | 'planning'
  | 'auditing'
  | 'downloading'
  | 'paused'
  | 'storage-blocked'
  | 'completed'
  | 'completed-with-errors'
  | 'cancelled';

export interface OfflineMapLayerProgress {
  layerId: string;
  totalTiles: number;
  completedTiles: number;
  failedTiles: number;
  cachedFreshTiles: number;
  auditedTiles: number;
  queuedTiles: number;
  downloadedTiles: number;
  bytesDownloaded: number;
  /** Tiles in the last committed generation; retained during rolling refresh. */
  usableTiles: number;
}

export interface OfflineMapSyncSnapshot {
  sessionId: string | null;
  phase: OfflineMapSyncPhase;
  coordinateCount: number | null;
  enabledLayerCount: number;
  totalTiles: number;
  completedTiles: number;
  failedTiles: number;
  cachedFreshTiles: number;
  auditedTiles: number;
  queuedTiles: number;
  downloadedTiles: number;
  activeDownloads: number;
  bytesDownloaded: number;
  tilesPerSecond: number;
  etaSeconds: number | null;
  cacheBytes: number;
  blockedByStorage: boolean;
  coverageTotalTiles: number;
  coverageCompletedTiles: number;
  layers: ReadonlyArray<OfflineMapLayerProgress>;
}

export interface OfflineMapPlanningInput {
  sourceRevision: string;
  projects: Array<{
    west: number;
    east: number;
    south: number;
    north: number;
    crossesDateline: boolean;
  }>;
  points: Array<[number, number]>;
  paths: Array<Array<[number, number]>>;
  minZoom: number;
  maxZoom: number;
  padMeters: number;
}

export interface OfflineMapLayerInput {
  id: string;
  tileUrlTemplate: string;
}

interface OfflineMapSyncRequestBase {
  layers: OfflineMapLayerInput[];
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export type OfflineMapSyncRequest = OfflineMapSyncRequestBase & (
  | { mode: 'rebuild'; plan: OfflineMapPlanningInput }
  | { mode: 'reuse-active-plan'; referenceLayerId: string }
);

export interface OfflineMapSyncResult {
  coordinateCount: number;
  scheduledTileCount: number;
  failedTileCount: number;
}
