export const MAP_OVERLAY_IDS = [
  'landmarks',
  'subsurfaceStations',
  'surfaceStations',
  'explorationLeads',
  'cylinderInstalls',
] as const;

export type MapOverlayId = (typeof MAP_OVERLAY_IDS)[number];

export type MapOverlayLegendKind = 'text-symbol' | 'circle' | 'image';

export interface MapOverlayLegendItem {
  id: string;
  label: string;
  kind: MapOverlayLegendKind;
  symbol?: string;
  color?: string;
  imageId?: string;
}

export interface MapOverlayDefinition {
  id: MapOverlayId;
  label: string;
  endpoint: string;
  markerMinZoom: number;
  labelMinZoom: number | null;
  legendItems: MapOverlayLegendItem[];
}

export type MapOverlayGeoJsonRecord = Partial<Record<MapOverlayId, GeoJSON.FeatureCollection>>;
