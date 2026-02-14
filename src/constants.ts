/**
 * Centralized constants for API, HTTP, and preferences.
 * Add only what the app uses to keep the file maintainable.
 */

// ==================== API ENDPOINTS ====================
const BASE_PATH = '/api/v1';
export const API = {
  BASE_PATH,
  AUTH_TOKEN_ENDPOINT: BASE_PATH + '/user/auth-token/',
  PROJECTS_GEOJSON_ENDPOINT: BASE_PATH + '/projects/geojson/',
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
  // Hard cap to avoid provider "map data not available" tiles.
  MAX_ZOOM: 18,
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
