export type SyncPhaseStatus = 'applied' | 'skipped' | 'aborted' | 'failed'

export type SyncPhaseName =
  | 'cache_load'
  | 'project_refresh'
  | 'geojson_sync'
  | 'overlay_sync'
  | 'tile_prefetch'

export type SyncPhaseReason =
  | 'cached_projects_loaded'
  | 'no_cached_projects'
  | 'cache_load_failed'
  | 'offline_locked'
  | 'missing_credentials'
  | 'project_list_refreshed'
  | 'project_list_cache_write_failed'
  | 'project_refresh_rejected'
  | 'project_refresh_malformed'
  | 'no_geojson_candidates'
  | 'geojson_synced'
  | 'geojson_sync_partial_failure'
  | 'no_overlay_sync_needed'
  | 'overlays_synced'
  | 'overlay_sync_partial_failure'
  | 'no_prefetch_candidates'
  | 'tile_prefetch_scheduled'
  | 'tile_prefetch_queued'
  | 'tile_prefetch_failed'
  | 'aborted'

export interface SyncPhaseResult<TPhase extends SyncPhaseName> {
  phase: TPhase
  status: SyncPhaseStatus
  reason: SyncPhaseReason
}

export interface CacheLoadPhaseResult extends SyncPhaseResult<'cache_load'> {
  cachedProjectCount: number
}

export interface ProjectRefreshPhaseResult extends SyncPhaseResult<'project_refresh'> {
  projectCount: number
  httpStatus: number | null
  cacheWriteSucceeded: boolean
  preservedCachedProjects: boolean
}

export interface GeoJSONSyncPhaseResult extends SyncPhaseResult<'geojson_sync'> {
  eligibleProjectCount: number
  downloadedProjectCount: number
  validatedProjectCount: number
  quarantinedProjectCount: number
  skippedProjectCount: number
  failedProjectCount: number
}

export interface OverlaySyncPhaseResult extends SyncPhaseResult<'overlay_sync'> {
  attemptedOverlayCount: number
  syncedOverlayCount: number
  failedOverlayCount: number
}

export interface TilePrefetchPhaseResult extends SyncPhaseResult<'tile_prefetch'> {
  eligibleProjectCount: number
  scheduledProjectCount: number
  failedProjectCount: number
  /** Number of (deduped) satellite tiles scheduled for the combined landmarks job. */
  landmarkTileCount?: number
  /** True when a landmarks tile prefetch job was scheduled this sync. */
  landmarkScheduled?: boolean
}

export interface SyncProjectsResult {
  runId: number
  status: 'done' | 'error' | 'aborted'
  phases: {
    cacheLoad: CacheLoadPhaseResult
    projectRefresh: ProjectRefreshPhaseResult
    geojsonSync: GeoJSONSyncPhaseResult
    overlaySync: OverlaySyncPhaseResult
    tilePrefetch: TilePrefetchPhaseResult
  }
}
