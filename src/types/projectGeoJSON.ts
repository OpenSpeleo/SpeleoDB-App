export interface ProjectGeoJSONBounds {
  west: number;
  east: number;
  south: number;
  north: number;
  crossesDateline: boolean;
}

export interface ProjectGeoJSONAnalysis {
  bounds: ProjectGeoJSONBounds;
  widthKm: number;
  heightKm: number;
  durationMs: number;
}

export type ProjectGeoJSONFileFailureReason =
  | 'bbox_too_large'
  | 'bbox_timeout'
  | 'invalid_geojson'
  | 'no_coordinates'
  | 'bbox_error';

export type ProjectGeoJSONInfrastructureFailureReason = 'validation_unavailable';

export type ProjectGeoJSONFailureReason =
  | ProjectGeoJSONFileFailureReason
  | ProjectGeoJSONInfrastructureFailureReason;

/**
 * Best information available for a failed analysis. File failures that occur
 * before dimensions exist still retain their measured wall-clock duration.
 */
export interface ProjectGeoJSONFailureDiagnostics {
  bounds: ProjectGeoJSONBounds | null;
  widthKm: number | null;
  heightKm: number | null;
  durationMs: number | null;
}

export interface ProjectGeoJSONActiveRecord {
  state: 'active';
  commitId: string;
  data: GeoJSON.FeatureCollection;
  analysis: ProjectGeoJSONAnalysis;
}

export interface ProjectGeoJSONQuarantinedRecord {
  state: 'quarantined';
  commitId: string;
  data: null;
  reason: ProjectGeoJSONFileFailureReason;
  diagnostics: ProjectGeoJSONFailureDiagnostics;
  warningAcknowledged: boolean;
}

export interface ProjectGeoJSONLegacyRecord {
  state: 'legacy';
  commitId: string | null;
  data: unknown;
}

export interface ProjectGeoJSONMissingRecord {
  state: 'missing';
  commitId: null;
  data: null;
}

export type ProjectGeoJSONCacheRecord =
  | ProjectGeoJSONActiveRecord
  | ProjectGeoJSONQuarantinedRecord
  | ProjectGeoJSONLegacyRecord
  | ProjectGeoJSONMissingRecord;

export interface ProjectGeoJSONMapData {
  commitId: string;
  featureCollection: GeoJSON.FeatureCollection;
  bounds: ProjectGeoJSONBounds;
}

export interface ProjectGeoJSONWarning {
  projectId: string;
  projectName: string;
  commitId: string;
  reason: ProjectGeoJSONFailureReason;
  widthKm: number | null;
  heightKm: number | null;
  durationMs: number | null;
  persistent: boolean;
}

export interface ProjectGeoJSONAcknowledgementResult {
  acknowledgedCount: number;
  failedCount: number;
}
