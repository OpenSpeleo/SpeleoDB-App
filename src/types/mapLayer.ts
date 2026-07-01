/**
 * Centralized map tile-layer definitions.
 *
 * Mirrors the website's `MAP_SOURCES` contract
 * (`SpeleoDB/frontend_private/static/private/js/map_viewer/config.js`) adapted
 * to the mobile app, which only ships ESRI raster sources (no Mapbox token).
 *
 * Each layer is a single XYZ raster source. The layer `id` is the stable key
 * used for:
 *  - persisting the selected layer + per-layer offline toggle in preferences,
 *  - namespacing offline-map generations,
 *  - building the maplibre style at runtime.
 */

export const MAP_LAYER_IDS = [
  'esri-satellite',
  'esri-world-hillshade',
  'esri-world-hillshade-dark',
] as const;

export type MapLayerId = (typeof MAP_LAYER_IDS)[number];

export interface MapLayerDefinition {
  /** Stable unique key (also the offline-generation + preference namespace). */
  id: MapLayerId;
  /** Human-readable label shown in the layer switcher and Settings. */
  label: string;
  /** XYZ raster tile URL template with `{z}`/`{x}`/`{y}` placeholders. */
  tileUrlTemplate: string;
  /** Provider-specific SHA-256 fingerprints for authoritative no-data rasters. */
  noDataSha256Hashes: readonly string[];
  /** Raster tile size in pixels (ESRI = 256). */
  tileSize: number;
  /** Native maximum zoom served by the provider for this layer. */
  maxZoom: number;
  /** Attribution string rendered by maplibre. */
  attribution: string;
  /**
   * When true, this layer's offline sync cannot be turned off and the layer is
   * always selectable, including offline. Exactly one layer is forced.
   */
  forcedOffline: boolean;
  /** When true, this is the default selected layer on first launch. */
  isDefault: boolean;
}

export function isMapLayerId(value: unknown): value is MapLayerId {
  return (
    typeof value === 'string' && (MAP_LAYER_IDS as readonly string[]).includes(value)
  );
}
