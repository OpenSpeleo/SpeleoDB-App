import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

// Apply to every line-bearing GeoJSON source: the default simplifier can drop
// whole short features at overview zooms, not just intermediate vertices.
export const GEOJSON_LINE_SOURCE_OPTIONS = { tolerance: 0 } as const;

export const GEOJSON_LINE_LAYOUT = {
  'line-cap': 'round',
  'line-join': 'round',
} as const;

/** Shared overview policy, with each layer retaining its close-up emphasis. */
export function createGeoJSONLineWidth(detailWidth: number, maxWidth = detailWidth): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    0, Math.min(1, detailWidth),
    8, Math.min(1, detailWidth),
    12, Math.min(1.5, detailWidth),
    14, Math.min(2, detailWidth),
    16, detailWidth,
    18, maxWidth,
  ];
}
