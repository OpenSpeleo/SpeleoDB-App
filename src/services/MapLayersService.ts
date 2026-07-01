/**
 * MapLayersService -- centralized access to map tile-layer definitions and
 * maplibre style construction.
 *
 * The app builds its raster map style from the bundled `MAP_LAYERS` config
 * rather than fetching a remote style document. Because the config ships in the
 * JS bundle, the selected layer's style is always available offline; only the
 * tiles themselves require network/cache (handled by the `cached-https`
 * protocol in TileCacheService).
 *
 * This module is pure config + style assembly (no IndexedDB, no network, no
 * protocol coupling) so it is trivially unit-testable. The `cached-https`
 * rewrite is applied separately by TileCacheService.getCachedLayerStyle.
 */

import { DEFAULT_MAP_LAYER_ID, MAP, MAP_LAYERS } from '../constants';
import type { MapLayerDefinition, MapLayerId } from '../types/mapLayer';
import { isMapLayerId } from '../types/mapLayer';

// Display layers can render past the source's native max zoom by overzooming
// the deepest available tiles. Capped at the app's hard zoom limit.
const DISPLAY_LAYER_MAX_ZOOM = Math.ceil(MAP.MAX_ZOOM);

export function getAllMapLayers(): readonly MapLayerDefinition[] {
  return MAP_LAYERS;
}

export function getMapLayerById(layerId: string): MapLayerDefinition | null {
  return MAP_LAYERS.find((layer) => layer.id === layerId) ?? null;
}

export function getDefaultMapLayer(): MapLayerDefinition {
  return getMapLayerById(DEFAULT_MAP_LAYER_ID) ?? MAP_LAYERS[0];
}

/**
 * Resolve a (possibly persisted/untrusted) layer id to a concrete definition,
 * falling back to the default layer when the id is unknown.
 */
export function resolveMapLayer(layerId: string | null | undefined): MapLayerDefinition {
  if (isMapLayerId(layerId)) {
    return getMapLayerById(layerId) ?? getDefaultMapLayer();
  }
  return getDefaultMapLayer();
}

export function getForcedOfflineLayerIds(): MapLayerId[] {
  return MAP_LAYERS.filter((layer) => layer.forcedOffline).map((layer) => layer.id);
}

/**
 * Whether a layer can be selected right now. Offline, only the forced layer and
 * layers whose tiles have been synced for offline use are selectable; others
 * would render blank.
 */
export function isLayerSelectable(
  layer: MapLayerDefinition,
  isOfflineLocked: boolean,
  layerOfflineSync: Record<string, boolean>,
): boolean {
  if (!isOfflineLocked) return true;
  if (layer.forcedOffline) return true;
  return layerOfflineSync[layer.id] === true;
}

// MAP_LAYERS is a bundled, immutable constant, so the prefix list never changes
// at runtime. Compute it once: `isLayerTileUrl` runs on every downloaded tile
// (runtime + prefetch hot path), so this avoids re-splitting per call.
const LAYER_TILE_URL_PREFIXES: readonly string[] = MAP_LAYERS.map(
  (layer) => layer.tileUrlTemplate.split('{z}')[0],
).filter((prefix) => prefix.length > 0);

/**
 * The static URL prefix (everything before `{z}`) for each layer's tile
 * template. Used to recognize raster tile requests for the missing-tile hash
 * check so non-tile resources (glyphs, sprites) are never affected.
 */
export function getLayerTileUrlPrefixes(): string[] {
  return [...LAYER_TILE_URL_PREFIXES];
}

/** Resolve the configured raster layer for a raw or cached-https tile URL. */
export function getMapLayerByTileUrl(url: string): MapLayerDefinition | null {
  const normalized = url.replace(/^cached-https:\/\//, 'https://');
  return MAP_LAYERS.find((layer) => (
    normalized.startsWith(layer.tileUrlTemplate.split('{z}')[0])
  )) ?? null;
}

/**
 * True when `url` points at one of the configured raster tile sources. Accepts
 * both raw `https://` and the rewritten `cached-https://` form.
 */
export function isLayerTileUrl(url: string): boolean {
  const normalized = url.replace(/^cached-https:\/\//, 'https://');
  return LAYER_TILE_URL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Build a maplibre raster style for a single layer. URLs are raw `https://`;
 * the `cached-https` rewrite is applied by TileCacheService before the style is
 * handed to maplibre.
 */
export function buildLayerStyle(layerId: string): Record<string, unknown> {
  const layer = resolveMapLayer(layerId);
  return {
    version: 8,
    name: `SpeleoDB ${layer.label}`,
    sources: {
      [layer.id]: {
        type: 'raster',
        tiles: [layer.tileUrlTemplate],
        tileSize: layer.tileSize,
        maxzoom: layer.maxZoom,
        attribution: layer.attribution,
      },
    },
    layers: [
      {
        id: layer.id,
        type: 'raster',
        source: layer.id,
        minzoom: 0,
        maxzoom: DISPLAY_LAYER_MAX_ZOOM,
        paint: {
          'raster-fade-duration': 0,
        },
      },
    ],
  };
}
