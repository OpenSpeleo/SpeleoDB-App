export interface TilePrefetchProjectInput {
  projectId: string;
  commitId: string;
  bounds: import('./projectGeoJSON').ProjectGeoJSONBounds;
}

export interface TilePrefetchRequest {
  tileUrlTemplate: string;
  minZoom: number;
  maxZoom: number;
  padMeters: number;
}
