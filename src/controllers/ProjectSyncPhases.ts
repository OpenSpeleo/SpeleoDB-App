import type { Project } from '../types/project';
import type { TilePrefetchPhaseResult } from '../types/sync';

export function createSkippedTilePrefetchPhase(
  reason: TilePrefetchPhaseResult['reason'],
): TilePrefetchPhaseResult {
  return {
    phase: 'tile_prefetch',
    status: reason === 'aborted' ? 'aborted' : 'skipped',
    reason,
    eligibleProjectCount: 0,
    scheduledProjectCount: 0,
    failedProjectCount: 0,
  };
}

export function createQueuedTilePrefetchPhase(
  projects: readonly Project[],
): TilePrefetchPhaseResult {
  return {
    phase: 'tile_prefetch',
    status: 'applied',
    reason: 'tile_prefetch_queued',
    eligibleProjectCount: projects.filter(
      (project) => Boolean(project.geojson_file) && !project.exclude_geojson,
    ).length,
    scheduledProjectCount: 0,
    failedProjectCount: 0,
  };
}
