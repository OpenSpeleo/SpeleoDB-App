/**
 * Centralized constants for API, HTTP, and preferences.
 * Add only what the app uses to keep the file maintainable.
 */

import type { MapOverlayDefinition, ProjectLayerConfig } from './types/mapOverlay';
import type { MapLayerDefinition } from './types/mapLayer';

// ==================== API ENDPOINTS ====================
const BASE_PATH = '/api/v2';
export const API = {
  BASE_PATH,
  AUTH_TOKEN_ENDPOINT: BASE_PATH + '/user/auth-token/',
  PROJECTS_GEOJSON_ENDPOINT: BASE_PATH + '/projects/geojson/',
  LANDMARKS_GEOJSON_ENDPOINT: BASE_PATH + '/landmarks/geojson/',
  // Landmark CRUD: POST creates, and `${LANDMARKS_ENDPOINT}${id}/` is the
  // detail endpoint for PATCH/DELETE. See docs/landmark-crud.md.
  LANDMARKS_ENDPOINT: BASE_PATH + '/landmarks/',
  LANDMARK_COLLECTIONS_ENDPOINT: BASE_PATH + '/landmark-collections/',
  SUBSURFACE_STATIONS_GEOJSON_ENDPOINT: BASE_PATH + '/stations/subsurface/geojson/',
  SURFACE_STATIONS_GEOJSON_ENDPOINT: BASE_PATH + '/stations/surface/geojson/',
  EXPLORATION_LEADS_GEOJSON_ENDPOINT: BASE_PATH + '/exploration-leads/geojson/',
  CYLINDER_INSTALLS_GEOJSON_ENDPOINT: BASE_PATH + '/cylinder-installs/geojson/',
  /** Detail endpoint for a single landmark (PATCH/DELETE). */
  landmarkDetailEndpoint(id: string): string {
    return `${BASE_PATH}/landmarks/${encodeURIComponent(id)}/`;
  },
} as const;

// ==================== HTTP STATUS CODES ====================
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  UNAUTHORIZED: 401,
  UNPROCESSABLE_ENTITY: 422,
} as const;

// ==================== HTTP HEADERS ====================
export const HEADERS = {
  CONTENT_TYPE: 'Content-Type',
  ACCEPT: 'Accept',
  AUTHORIZATION: 'Authorization',
  APPLICATION_JSON: 'application/json',
  APPLICATION_JSON_UTF8: 'application/json; charset=UTF-8',
  TOKEN_PREFIX: 'Token ',
} as const;

// ==================== USER PREFERENCES ====================
export const PREFERENCES = {
  STORAGE_KEY: 'speleo_user_preferences',
  PREF_EMAIL: 'email',
  PREF_TOKEN: 'token',
  PREF_INSTANCE: 'instance',
  DEFAULT_INSTANCE: 'https://www.speleodb.org',
} as const;

// ==================== NETWORK ====================
export const NETWORK = {
  REQUEST_TIMEOUT_MS: 10000,
  // Raised from 3s -> 10s so spotty mobile networks have time to respond at
  // startup before the app falls back to offline mode. See docs/offline-mode.md.
  STARTUP_AUTH_TIMEOUT_MS: 10000,
} as const;

// ==================== MAP ====================
export const MAP = {
  // Local style file with Esri satellite raster tiles.
  // Using a local style avoids provider key requirements while keeping
  // URLs rewriteable by TileCacheService for offline tile caching.
  STYLE_URL: '/map-style-satellite.json',
  // Tile URL template used for proactive offline prefetch jobs.
  TILE_URL_TEMPLATE:
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  // Known "missing data" tile fingerprints. When a downloaded raster tile's
  // SHA-256 matches one of these, the provider returned a placeholder
  // ("no data") tile rather than real imagery, so we treat it as a 404 and do
  // not cache it. Copied from the website map viewer
  // (DEFAULTS.MAP.MISSING_TILE_SHA256_HASHES). See docs/map-layers.md.
  MISSING_TILE_SHA256_HASHES: [
    '9eafd300d61393184a4abc1d458564cfd1cd9b6f9c4e9c74687045c0a0e5b858',
  ] as readonly string[],
  DEFAULT_CENTER: [2.3, 46.6] as [number, number], // France center
  DEFAULT_ZOOM: 5,
  NORTH_UP_ORIENTATION: {
    bearing: 0,
    pitch: 0,
  } as const,
  ROTATION_LOCK_INTERACTIONS: {
    dragRotate: false,
    touchPitch: false,
    pitchWithRotate: false,
    keyboard: false,
    maxPitch: 0,
  } as const,
  // Hard cap to avoid provider "map data not available" tiles.
  MAX_ZOOM: 19.9,
  // Hard cap for all cached tile payloads (prefetch + runtime map browsing).
  TILE_CACHE_MAX_BYTES: 500 * 1024 * 1024,
  // Long-press to drop a map point / create a landmark. Raised from 300ms so the
  // circular loading ring has time to visibly fill before the modal opens.
  // See docs/landmark-crud.md.
  LONG_PRESS_DURATION_MS: 550,
  LONG_PRESS_EMPTY_SPOT_RADIUS_PX: 18,
  // Diameter (px) of the circular long-press loading ring rendered at the touch
  // point while the user holds an empty spot.
  LONG_PRESS_RING_SIZE_PX: 64,
  LONG_PRESS_RING_STROKE_PX: 4,
  // Minimum zoom for any marker interaction that opens a modal
  // (marker taps, long-press GPS). Below this zoom, taps on markers
  // and long-press GPS are silently ignored to prevent accidental
  // triggers at region scale.
  MARKER_INTERACTION_MIN_ZOOM: 15,
} as const;

// ==================== MAP TILE LAYERS ====================
// Centralized, single-source-of-truth layer definitions for the layer switcher
// and offline sync. Mirrors the website's MAP_SOURCES (ESRI only; Mapbox is
// intentionally dropped because the app has no Mapbox token). The first entry
// is the forced/default satellite layer; see docs/map-layers.md.
export const MAP_LAYERS: readonly MapLayerDefinition[] = [
  {
    id: 'esri-satellite',
    label: 'ESRI - Satellite',
    tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
    tileSize: 256,
    maxZoom: 18,
    attribution: 'Sources: Esri, USGS, NOAA',
    forcedOffline: true,
    isDefault: true,
  },
  {
    id: 'esri-world-hillshade',
    label: 'ESRI - World Hillshade',
    tileUrlTemplate:
      'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    // The World_Hillshade cache exposes 24 LODs (0-23). Match satellite's z18
    // so offline prefetch depth + display sharpness reach parity with the
    // satellite layer (z16 left the layer heavily overzoomed/sparse when zoomed
    // in around projects/landmarks). Coverage is full-res only in select areas
    // above ~z16, but the service still returns valid tiles, so this never 404s.
    maxZoom: 18,
    attribution: 'Sources: Esri, USGS, NOAA',
    forcedOffline: false,
    isDefault: false,
  },
  {
    id: 'esri-world-hillshade-dark',
    label: 'ESRI - World Hillshade Dark',
    tileUrlTemplate:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    // See esri-world-hillshade: matched to satellite's z18 for offline parity.
    maxZoom: 18,
    attribution: 'Sources: Esri, USGS, NOAA',
    forcedOffline: false,
    isDefault: false,
  },
] as const;

export const DEFAULT_MAP_LAYER_ID = 'esri-satellite';

// ==================== TILE PREFETCH ====================
// Offline satellite tile pre-caching policy. Each "request" describes the zoom
// range + padding used to turn locations into the set of {z,x,y} tiles to
// download. Projects use the bounding box of their survey GeoJSON; landmarks
// use a per-point padded box (unioned + deduped) so a globally-scattered set of
// landmarks never produces a world-spanning bounding box.
export const TILE_PREFETCH = {
  PROJECT_REQUEST: {
    tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
    minZoom: 0,
    maxZoom: 18,
    padMeters: 50,
  },
  LANDMARK_REQUEST: {
    tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
    minZoom: 0,
    maxZoom: 18,
    padMeters: 50,
  },
  // Synthetic prefetch-job id for the single combined landmarks job.
  LANDMARK_TARGET_ID: 'landmarks',
} as const;

// ==================== COLORS ====================
// Project colors are model-driven (`project.color` from the API). The mobile
// app does not maintain a palette; see docs/project-colors.md.
export const COLORS = {
  // Neutral fallback when a project's `color` is missing or fails validation
  // (e.g. cached payload predates the backend `color` field). Mirrors the web
  // map viewer's FALLBACK_COLOR.
  FALLBACK: '#94a3b8',
} as const;

// ==================== PROJECT LAYERS ====================

export const PROJECT_LAYERS: ProjectLayerConfig = {
  lineMinZoom: 0,
  entrySymbolMinZoom: 5,
  entrySymbolTextSize: ['interpolate', ['linear'], ['zoom'], 8, 18, 14, 24],
} as const;

// ==================== MAP OVERLAYS ====================

export const MAP_OVERLAYS: readonly MapOverlayDefinition[] = [
  {
    id: 'landmarks',
    label: 'Landmarks',
    endpoint: API.LANDMARKS_GEOJSON_ENDPOINT,
    markerMinZoom: 12,
    labelMinZoom: 14,
    sizes: {
      markerTextSize: ['interpolate', ['linear'], ['zoom'], 6, 8, 10, 12, 14, 16, 18, 22],
      labelTextSize: ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12, 18, 14],
    },
    legendItems: [
      {
        id: 'landmark',
        label: 'Landmark',
        kind: 'text-symbol',
        symbol: '▼',
        color: '#3b82f6',
      },
    ],
  },
  {
    id: 'subsurfaceStations',
    label: 'Subsurface Stations',
    endpoint: API.SUBSURFACE_STATIONS_GEOJSON_ENDPOINT,
    markerMinZoom: 12,
    labelMinZoom: 14,
    sizes: {
      markerCircleRadius: ['interpolate', ['linear'], ['zoom'], 14, 5, 18, 8],
      markerIconSize: ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 1.0],
      labelTextSize: 12,
    },
    legendItems: [
      {
        id: 'subsurface-sensor',
        label: 'Sensor station',
        kind: 'circle',
        color: '#fb923c',
      },
      {
        id: 'subsurface-biology',
        label: 'Biology station',
        kind: 'image',
        imageId: 'biology-station-icon',
      },
      {
        id: 'subsurface-bone',
        label: 'Bone station',
        kind: 'image',
        imageId: 'bone-station-icon',
      },
      {
        id: 'subsurface-artifact',
        label: 'Artifact station',
        kind: 'image',
        imageId: 'artifact-station-icon',
      },
      {
        id: 'subsurface-geology',
        label: 'Geology station',
        kind: 'image',
        imageId: 'geology-station-icon',
      },
    ],
  },
  {
    id: 'surfaceStations',
    label: 'Surface Stations',
    endpoint: API.SURFACE_STATIONS_GEOJSON_ENDPOINT,
    markerMinZoom: 12,
    labelMinZoom: 14,
    sizes: {
      markerTextSize: ['interpolate', ['linear'], ['zoom'], 14, 16, 18, 24],
      labelTextSize: 12,
    },
    legendItems: [
      {
        id: 'surface-station',
        label: 'Surface station',
        kind: 'text-symbol',
        symbol: '◆',
        color: '#fb923c',
      },
    ],
  },
  {
    id: 'explorationLeads',
    label: 'Exploration Leads',
    endpoint: API.EXPLORATION_LEADS_GEOJSON_ENDPOINT,
    markerMinZoom: 12,
    labelMinZoom: null,
    sizes: {
      markerIconSize: ['interpolate', ['linear'], ['zoom'], 14, 0.4, 18, 0.6],
      fallbackCircleRadius: ['interpolate', ['linear'], ['zoom'], 14, 8, 18, 12],
    },
    legendItems: [
      {
        id: 'exploration-lead',
        label: 'Exploration lead',
        kind: 'image',
        imageId: 'exploration-lead-icon',
      },
    ],
  },
  {
    id: 'cylinderInstalls',
    label: 'Cylinder Installs',
    endpoint: API.CYLINDER_INSTALLS_GEOJSON_ENDPOINT,
    markerMinZoom: 12,
    labelMinZoom: 14,
    sizes: {
      markerIconSize: ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 1.2],
      fallbackTextSize: ['interpolate', ['linear'], ['zoom'], 14, 18, 18, 26],
      labelTextSize: 11,
    },
    legendItems: [
      {
        id: 'cylinder-install',
        label: 'Cylinder install',
        kind: 'image',
        imageId: 'cylinder-icon',
      },
    ],
  },
] as const;
