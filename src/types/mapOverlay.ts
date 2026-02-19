import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

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

export type MarkerSizeExpression = number | ExpressionSpecification;

export interface MapOverlaySizes {
  markerTextSize?: MarkerSizeExpression;
  markerIconSize?: MarkerSizeExpression;
  markerCircleRadius?: MarkerSizeExpression;
  fallbackTextSize?: MarkerSizeExpression;
  fallbackCircleRadius?: MarkerSizeExpression;
  labelTextSize?: MarkerSizeExpression;
}

export interface MapOverlayDefinition {
  id: MapOverlayId;
  label: string;
  endpoint: string;
  markerMinZoom: number;
  labelMinZoom: number | null;
  sizes: MapOverlaySizes;
  legendItems: MapOverlayLegendItem[];
}

export interface ProjectLayerConfig {
  lineMinZoom: number;
  entrySymbolMinZoom: number;
  entrySymbolTextSize: MarkerSizeExpression;
}

export type MapOverlayGeoJsonRecord = Partial<Record<MapOverlayId, GeoJSON.FeatureCollection>>;
