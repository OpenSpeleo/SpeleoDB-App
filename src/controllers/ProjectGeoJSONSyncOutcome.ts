import type { GeoJSONSyncPhaseResult } from '../types/sync';

export interface ProjectGeoJSONOutcome {
  downloaded: number;
  validated: number;
  quarantined: number;
  skipped: number;
  failed: number;
  localWork: boolean;
}

export const NO_PROJECT_GEOJSON_OUTCOME: ProjectGeoJSONOutcome = {
  downloaded: 0,
  validated: 0,
  quarantined: 0,
  skipped: 0,
  failed: 0,
  localWork: false,
};

export function createSkippedGeoJSONPhase(
  reason: GeoJSONSyncPhaseResult['reason'],
): GeoJSONSyncPhaseResult {
  return {
    phase: 'geojson_sync',
    status: reason === 'aborted' ? 'aborted' : 'skipped',
    reason,
    eligibleProjectCount: 0,
    downloadedProjectCount: 0,
    validatedProjectCount: 0,
    quarantinedProjectCount: 0,
    skippedProjectCount: 0,
    failedProjectCount: 0,
  };
}
