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
  // GPS tracks: a recorded track is uploaded to SpeleoDB as a GPX file via the
  // GPX import endpoint (PUT multipart `file`, optional `collection`). The
  // backend turns waypoints into Landmarks and tracks into GPSTrack rows and
  // returns `{ landmarks_created, gps_tracks_created }`. See docs/gps-tracks.md.
  GPX_IMPORT_ENDPOINT: BASE_PATH + '/import/gpx/',
  GPS_TRACKS_ENDPOINT: BASE_PATH + '/gps_tracks/',
  /** Detail endpoint for a single landmark (PATCH/DELETE). */
  landmarkDetailEndpoint(id: string): string {
    return `${BASE_PATH}/landmarks/${encodeURIComponent(id)}/`;
  },
  /** Detail endpoint for a single GPS track (GET/PATCH/DELETE). */
  gpsTrackDetailEndpoint(id: string): string {
    return `${BASE_PATH}/gps_tracks/${encodeURIComponent(id)}/`;
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
  // Provider payloads remain fresh for a deterministic 180 days from the
  // successful fetch time. Accessing a tile never extends this deadline.
  TILE_CACHE_MAX_AGE_MS: 180 * 24 * 60 * 60 * 1000,
  // A missing tile must not hold the MapLibre protocol request indefinitely on
  // a connected-but-stalled mobile network.
  TILE_FETCH_TIMEOUT_MS: 10_000,
  // Runtime browsing updates unpinned LRU metadata at most once per day.
  TILE_LRU_TOUCH_INTERVAL_MS: 24 * 60 * 60 * 1000,
  // Long-press to drop a map point / create a landmark. Raised from 300ms so the
  // circular loading ring has time to visibly fill before the modal opens.
  // See docs/landmark-crud.md.
  LONG_PRESS_DURATION_MS: 550,
  // Delay before showing the ring so normal quick taps do not flash an animation.
  LONG_PRESS_RING_REVEAL_DELAY_MS: 140,
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

// ==================== GPS ====================
// GPS track recording + high-confidence point averaging. See docs/gps-tracks.md.
export const GPS = {
  // App identity stamped into generated GPX files (creator attribute).
  GPX_CREATOR: 'SpeleoDB App',
  // MIME type for GPX documents (upload multipart part + share/download Blob).
  GPX_CONTENT_TYPE: 'application/gpx+xml',
  // Live position watch options shared by recording + averaging. High accuracy
  // is required for survey-grade work; the timeout guards against a watch that
  // never produces a first fix.
  WATCH_OPTIONS: {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 0,
  } as const,
  // Foreground My Location is a live UI mode rather than a recorder. Android
  // honors these interval hints; iOS delivers updates at its native cadence.
  LIVE_LOCATION_WATCH_OPTIONS: {
    enableHighAccuracy: true,
    timeout: 10_000,
    maximumAge: 0,
    interval: 1_000,
    minimumUpdateInterval: 1_000,
  } as const,
  HEADING_MIN_INTERVAL_MS: 100,
  HEADING_MIN_CHANGE_DEGREES: 2,
  // GPS fix timestamps can lag the JavaScript wall clock by a small amount when
  // a watch starts. Allow a short grace while still dropping the much older
  // last-known-location replay that mobile OSes commonly emit first.
  WATCH_START_STALE_FIX_GRACE_MS: 2_000,
  // Track recording cadence: keep at most one fix per this interval. A surface
  // walking path overlaid on a cave survey doesn't need sub-second density;
  // ~1 point / 15 s keeps tracks small and meaningful while still capturing the
  // route. The FIRST in-session fix is kept immediately (see shouldAcceptFix),
  // so recording starts as fast as the high-accuracy point collector. Track
  // recording shares the exact GPS gate with averaging -- only this interval
  // differs (averaging uses AVERAGING_MIN_SAMPLE_INTERVAL_MS).
  TRACK_SAMPLE_INTERVAL_MS: 15_000,
  // Persistent notification shown by the background-geolocation foreground
  // service while a track is recording (Android requires it; on iOS the status
  // bar turns blue). Tapping it returns to the app.
  BACKGROUND_TRACKING_TITLE: 'Recording GPS track',
  BACKGROUND_TRACKING_MESSAGE: 'SpeleoDB is recording your track. Tap to return; Stop in the app to finish.',
  // Averaging session: the user collects a single high-confidence point over a
  // 1-2 minute window. `MIN_MS`/`MIN_SAMPLES` gate the "good enough to save"
  // hint; `TARGET_MS`/`TARGET_SAMPLES` are where confidence reaches 100%.
  AVERAGING_MIN_MS: 60_000,
  AVERAGING_TARGET_MS: 120_000,
  AVERAGING_MIN_SAMPLES: 30,
  AVERAGING_TARGET_SAMPLES: 60,
  // Reject averaging samples worse than this horizontal accuracy (meters).
  AVERAGING_MAX_ACCURACY_METERS: 50,
  // Minimum spacing between accepted averaging samples. A warm GPS can emit
  // several fixes per second (and the OS bursts a few on watch start); those
  // sub-second fixes are highly correlated and don't improve the average, so we
  // keep at most ~1/sec. This makes the sample count tick up like seconds
  // instead of jumping to 3-4 immediately.
  AVERAGING_MIN_SAMPLE_INTERVAL_MS: 1000,
  // Accuracy band for the confidence model: <= GOOD scores 1.0, >= POOR scores
  // the floor; linear in between. Tuned for consumer phone GPS.
  AVERAGING_GOOD_ACCURACY_METERS: 5,
  AVERAGING_POOR_ACCURACY_METERS: 50,
  AVERAGING_ACCURACY_FLOOR_SCORE: 0.4,
  // Easing exponent applied to the confidence base (time+sample progress).
  // > 1 makes confidence grow slowly early and only climb near the targets, so
  // it does not race to a high value in the first few seconds. 100% still
  // requires reaching both the target time AND target sample count.
  AVERAGING_CONFIDENCE_EXPONENT: 2.2,
  // Constellations shown in the averaging UI's satellite checklist. Live in-use
  // status is only reportable on Android (see docs/gps-tracks.md); the order is
  // display order.
  CONSTELLATIONS: [
    { id: 'gps', label: 'GPS', region: 'USA' },
    { id: 'glonass', label: 'GLONASS', region: 'Russia' },
    { id: 'galileo', label: 'Galileo', region: 'EU' },
    { id: 'beidou', label: 'BeiDou', region: 'China' },
    { id: 'qzss', label: 'QZSS', region: 'Japan' },
    { id: 'sbas', label: 'SBAS', region: 'Augmentation' },
  ] as const,
  // Track line colors. Mirrors the server `ColorPalette` (used for project +
  // GPS track defaults) so a locally-assigned color matches what the backend
  // would have chosen, and the edit picker offers the same swatches. The
  // server assigns a random palette color on GPX import; the user can change it
  // via the edit (PATCH) path. See SpeleoDB `speleodb/common/enums.py`.
  TRACK_COLOR_PALETTE: [
    '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
    '#ffff33', '#a65628', '#f781bf', '#999999', '#66c2a5',
    '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f',
    '#e5c494', '#b3b3b3', '#1b9e77', '#d95f02', '#7570b3',
  ] as const,
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
    noDataSha256Hashes: MAP.MISSING_TILE_SHA256_HASHES,
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
    // The website fingerprint above is satellite-specific. Do not classify
    // hillshade bytes as authoritative absence without provider evidence.
    noDataSha256Hashes: [],
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
    noDataSha256Hashes: [],
    tileSize: 256,
    // See esri-world-hillshade: matched to satellite's z18 for offline parity.
    maxZoom: 18,
    attribution: 'Sources: Esri, USGS, NOAA',
    forcedOffline: false,
    isDefault: false,
  },
] as const;

export const DEFAULT_MAP_LAYER_ID = 'esri-satellite';

// ==================== PROJECT GEOJSON VALIDATION ====================

/**
 * Safety boundary for project survey GeoJSON. Bounds are measured before map
 * or tile padding. Only content proven unsafe is quarantined; worker/bootstrap
 * deadlines are transient validation failures and are retried later.
 */
export const PROJECT_GEOJSON_VALIDATION = {
  MAX_WIDTH_KM: 100,
  MAX_HEIGHT_KM: 100,
  // A physically compact polar survey can still expand to a world-scale
  // Web-Mercator footprint. Apply the same safety envelope to the projected
  // consumer span before map display or tile planning is allowed.
  // Web Mercator uses a slightly larger spherical radius than the geodesic
  // measurement below. The 0.12 km allowance preserves an exact 100 km raw
  // equatorial bbox while still rejecting projection-amplified polar spans.
  MAX_MERCATOR_X_SPAN_KM: 100.12,
  MAX_MERCATOR_Y_SPAN_KM: 100.12,
  // Keep the computation off the main thread, but allow realistic mobile
  // hardware and large valid surveys enough time to complete validation.
  TIMEOUT_MS: 10_000,
  CACHE_SCHEMA_VERSION: 2,
} as const;

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
  STATION_REQUEST: {
    tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
    minZoom: 0,
    maxZoom: 18,
    padMeters: 50,
  },
  GPS_TRACK_REQUEST: {
    tileUrlTemplate: MAP.TILE_URL_TEMPLATE,
    minZoom: 0,
    maxZoom: 18,
    padMeters: 50,
  },
  // Synthetic prefetch-job id for the single combined landmarks job.
  LANDMARK_TARGET_ID: 'landmarks',
  STATION_TARGET_ID: 'stations',
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
