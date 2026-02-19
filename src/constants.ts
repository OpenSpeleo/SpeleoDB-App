/**
 * Centralized constants for API, HTTP, and preferences.
 * Add only what the app uses to keep the file maintainable.
 */

import type { MapOverlayDefinition, ProjectLayerConfig } from './types/mapOverlay';

// ==================== API ENDPOINTS ====================
const BASE_PATH = '/api/v1';
export const API = {
  BASE_PATH,
  AUTH_TOKEN_ENDPOINT: BASE_PATH + '/user/auth-token/',
  PROJECTS_GEOJSON_ENDPOINT: BASE_PATH + '/projects/geojson/',
  LANDMARKS_GEOJSON_ENDPOINT: BASE_PATH + '/landmarks/geojson/',
  SUBSURFACE_STATIONS_GEOJSON_ENDPOINT: BASE_PATH + '/stations/subsurface/geojson/',
  SURFACE_STATIONS_GEOJSON_ENDPOINT: BASE_PATH + '/stations/surface/geojson/',
  EXPLORATION_LEADS_GEOJSON_ENDPOINT: BASE_PATH + '/exploration-leads/geojson/',
  CYLINDER_INSTALLS_GEOJSON_ENDPOINT: BASE_PATH + '/cylinder-installs/geojson/',
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
  STARTUP_AUTH_TIMEOUT_MS: 3000,
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
  LONG_PRESS_DURATION_MS: 300,
} as const;

// ==================== COLOR PALETTE ====================
// Maximally distinguishable color palette based on perceptual color theory
// These 20 colors are optimized for maximum visual distinction
export const COLOR_PALETTE = [
  '#e41a1c', // Red
  '#377eb8', // Blue
  '#4daf4a', // Green
  '#984ea3', // Purple
  '#ff7f00', // Orange
  '#ffff33', // Yellow
  '#a65628', // Brown
  '#f781bf', // Pink
  '#999999', // Gray
  '#66c2a5', // Teal
  '#fc8d62', // Salmon
  '#8da0cb', // Lavender
  '#e78ac3', // Rose
  '#a6d854', // Lime
  '#ffd92f', // Gold
  '#e5c494', // Tan
  '#b3b3b3', // Light Gray
  '#1b9e77', // Dark Teal
  '#d95f02', // Dark Orange
  '#7570b3', // Slate Blue
] as const;

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
