/**
 * Dashboard -- full-screen map with per-project GeoJSON layers.
 *
 * Replaces the old card-based dashboard with a maplibre-gl map.
 * Each project's cached GeoJSON is rendered as a colored layer that
 * can be toggled on/off via the ProjectPanel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
} from '@ionic/react';
import Map, { Layer, Source } from 'react-map-gl/maplibre';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike, Map as MaplibreMap } from 'maplibre-gl';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { useSpeleoDB } from '../context/useSpeleoDB';
import { COLORS, DEFAULT_MAP_LAYER_ID, MAP, MAP_LAYERS, MAP_OVERLAYS, PROJECT_LAYERS } from '../constants';
import type { MapOverlayGeoJsonRecord, MapOverlayId, MapOverlaySizes } from '../types/mapOverlay';
import type { MapLayerId } from '../types/mapLayer';
import { registerTileCacheProtocol, getCachedLayerStyle } from '../services/TileCacheService';
import MapLayerControl from '../components/map/MapLayerControl';
import {
  setSelectedMapLayerId as persistSelectedMapLayerId,
  getProjectVisibilityPreferences,
  setProjectVisibilityPreference,
  setProjectVisibilityPreferences,
  getCountryVisibilityPreferences,
  setCountryVisibilityPreference,
  setCountryVisibilityPreferences,
  getCountryCollapsedPreferences,
  setCountryCollapsedPreference,
  getLandmarkCollectionVisibilityPreferences,
  setLandmarkCollectionVisibilityPreference,
  setLandmarkCollectionVisibilityPreferences,
  getLandmarkCollectionCollapsedPreferences,
  setLandmarkCollectionCollapsedPreference,
} from '../services/PreferencesService';
import ProjectPanel from '../components/ProjectPanel';
import LandmarkPanel from '../components/LandmarkPanel';
import AppTabBar from '../components/AppTabBar';
import {
  buildLandmarkCollectionGroups,
  type LandmarkListItem,
} from '../utils/landmarkCollections';
import GeolocationErrorModal from '../components/GeolocationErrorModal';
import DistanceScale from '../components/map/DistanceScale';
import DepthGauge from '../components/map/DepthGauge';
import { PERMISSION_DENIED_SENTINEL } from '../utils/geolocationError';
import OverlayMarkerDetailsModal from '../components/OverlayMarkerDetailsModal';
import LandmarkFormModal from '../components/LandmarkFormModal';
import type { LandmarkFormInitialValues, LandmarkFormMode } from '../components/LandmarkFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import LongPressRing from '../components/LongPressRing';
import type { LandmarkCollection } from '../types/landmark';
import { LandmarkMutationError } from '../types/landmark';
import { ensureLandmarkPropertyIds, type NormalizedLandmarkInput } from '../utils/landmarkMutations';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { createProjectColorState, getProjectColor } from '../utils/projectColors';
import type { MapColorMode } from '../types/mapColorMode';
import type { MeasurementUnit } from '../types/measurementUnit';
import {
  DEPTH_PROPERTY_KEY,
  attachDepthToFeatureCollection,
  createDepthColorExpression,
} from '../utils/depthColoring';
import { useDepthProbe } from '../hooks/useDepthProbe';
import {
  INTERACTIVE_OVERLAY_LAYER_IDS,
  formatLatLng,
  parseOverlayMarkerDetails,
} from '../utils/overlayMarkerDetails';
import type {
  InteractiveOverlayFeature,
  LandmarkDetails,
  MapLongPressDetails,
  MarkerParseContext,
  OverlayMarkerDetails,
} from '../utils/overlayMarkerDetails';
import artifactIcon from '../assets/media/map-icons/artifact-icon.png';
import boneIcon from '../assets/media/map-icons/bones-icon.png';
import biologyIcon from '../assets/media/map-icons/fish-icon.png';
import geologyIcon from '../assets/media/map-icons/rock-icon.png';
import explorationLeadIcon from '../assets/media/map-icons/exploration-lead-icon.png';
import cylinderIcon from '../assets/media/map-icons/cylinder-orange-icon.png';

// Color landmark markers/labels by their collection color (mirrors the web map
// viewer). Falls back to the neutral palette color when a feature has no valid
// collection color. The halo flips to a dark slate when the marker itself is
// white so it stays visible against bright tiles.
const LANDMARK_COLLECTION_COLOR_EXPRESSION = [
  'coalesce',
  ['get', 'collection_color'],
  COLORS.FALLBACK,
] as ExpressionSpecification;

const LANDMARK_COLLECTION_HALO_EXPRESSION = [
  'case',
  // Case-insensitive + null-safe: a white marker (any hex casing) gets a dark
  // halo so labels stay visible against bright tiles.
  ['==', ['downcase', ['coalesce', ['get', 'collection_color'], '']], '#ffffff'],
  '#0f172a',
  '#ffffff',
] as ExpressionSpecification;

// ==================== GeoJSON type alias ====================

type GeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;
type OverlayIconId =
  | 'biology-station-icon'
  | 'bone-station-icon'
  | 'artifact-station-icon'
  | 'geology-station-icon'
  | 'exploration-lead-icon'
  | 'cylinder-icon';

type OverlayIconAvailability = Record<OverlayIconId, boolean>;

type ProjectLinkedOverlayId = 'subsurfaceStations' | 'explorationLeads' | 'cylinderInstalls';

const MAP_MARKER_HIT_RADIUS_PX_TOUCH = 26;
const MAP_TOUCH_TAP_MAX_MOVEMENT_PX = 12;
const MAP_TOUCH_TAP_MAX_DURATION_MS = 550;
const OVERLAY_ICON_SOURCES: Record<OverlayIconId, string> = {
  'biology-station-icon': biologyIcon,
  'bone-station-icon': boneIcon,
  'artifact-station-icon': artifactIcon,
  'geology-station-icon': geologyIcon,
  'exploration-lead-icon': explorationLeadIcon,
  'cylinder-icon': cylinderIcon,
};

const DEFAULT_OVERLAY_ICON_AVAILABILITY: OverlayIconAvailability = {
  'biology-station-icon': false,
  'bone-station-icon': false,
  'artifact-station-icon': false,
  'geology-station-icon': false,
  'exploration-lead-icon': false,
  'cylinder-icon': false,
};

const PROJECT_LINKED_OVERLAY_IDS = new Set<ProjectLinkedOverlayId>([
  'subsurfaceStations',
  'explorationLeads',
  'cylinderInstalls',
]);
const LONG_PRESS_BLOCKING_STATIC_LAYER_IDS = [
  ...INTERACTIVE_OVERLAY_LAYER_IDS,
  'landmarks-labels',
  'surface-stations-labels',
  'subsurface-stations-labels',
  'cylinder-installs-labels',
  'user-location-dot',
] as const;

const PROJECT_LAYER_ORDER_ANCHOR_SOURCE_ID = 'project-layer-order-anchor-source';
const PROJECT_LAYER_ORDER_ANCHOR_LAYER_ID = 'project-layer-order-anchor';
const OVERLAY_ICON_WARNED = new Set<OverlayIconId>();
const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// ==================== Helpers ====================

function getOverlayMarkerMinZoom(overlayId: MapOverlayId): number {
  return MAP_OVERLAYS.find((overlay) => overlay.id === overlayId)?.markerMinZoom ?? 12;
}

function getOverlayLabelMinZoom(overlayId: MapOverlayId): number | null {
  const zoom = MAP_OVERLAYS.find((overlay) => overlay.id === overlayId)?.labelMinZoom;
  return typeof zoom === 'number' ? zoom : null;
}

function getOverlaySizes(overlayId: MapOverlayId): MapOverlaySizes {
  return MAP_OVERLAYS.find((o) => o.id === overlayId)?.sizes ?? {};
}

function resolveFeatureColor(properties: Record<string, unknown>): string {
  if (typeof properties.color === 'string' && properties.color) {
    return properties.color;
  }
  const tag = properties.tag;
  if (tag && typeof tag === 'object') {
    const tagColor = (tag as { color?: unknown }).color;
    if (typeof tagColor === 'string' && tagColor) {
      return tagColor;
    }
  }
  return '#fb923c';
}

function normalizeOverlayGeoJSON(
  overlayId: MapOverlayId,
  featureCollection: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  if (overlayId !== 'subsurfaceStations' && overlayId !== 'surfaceStations') {
    return featureCollection;
  }

  return {
    ...featureCollection,
    features: featureCollection.features.map((feature) => {
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      return {
        ...feature,
        properties: {
          ...properties,
          color: resolveFeatureColor(properties),
        },
      };
    }),
  };
}

type OverlayImageMap = {
  hasImage: (id: string) => boolean;
  addImage: (id: string, image: unknown) => void;
  loadImage: (
    url: string,
    callback: (error?: Error | null, image?: unknown) => void,
  ) => void;
};

type OverlayFeatureQueryMap = {
  queryRenderedFeatures: (
    pointOrBox: { x: number; y: number } | [[number, number], [number, number]],
    options?: { layers?: string[] },
  ) => InteractiveOverlayFeature[];
  getCanvas: () => { getBoundingClientRect: () => DOMRect };
  getLayer: (id: string) => unknown;
  getZoom: () => number;
  unproject: (point: { x: number; y: number }) => { lng: number; lat: number };
};

type MapPointerTapCandidate = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startedAtMs: number;
  moved: boolean;
  pointerType: string;
};

function getClickedOverlayMarkerDetails(
  features: InteractiveOverlayFeature[],
  allInteractiveLayerIds: readonly string[],
  context?: MarkerParseContext,
): OverlayMarkerDetails | null {
  for (const layerId of allInteractiveLayerIds) {
    const feature = features.find((candidate) => candidate.layer?.id === layerId);
    if (!feature) {
      continue;
    }
    const details = parseOverlayMarkerDetails(feature, context);
    if (details) {
      return details;
    }
  }
  return null;
}

function getMarkerHitQueryBounds(
  point: { x: number; y: number },
  radiusPx: number,
): [[number, number], [number, number]] {
  return [
    [point.x - radiusPx, point.y - radiusPx],
    [point.x + radiusPx, point.y + radiusPx],
  ];
}

function getProjectLinkFromFeature(
  overlayId: ProjectLinkedOverlayId,
  feature: GeoJSON.Feature,
): string | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const candidate = overlayId === 'cylinderInstalls'
    ? properties.project_id
    : properties.project;
  if (typeof candidate === 'string' && candidate) {
    return candidate;
  }
  if (typeof candidate === 'number') {
    return String(candidate);
  }
  return null;
}

function filterOverlayByProjectVisibility(
  overlayId: MapOverlayId,
  featureCollection: GeoJSON.FeatureCollection,
  activeProjectIds: Set<string>,
): GeoJSON.FeatureCollection {
  if (!PROJECT_LINKED_OVERLAY_IDS.has(overlayId as ProjectLinkedOverlayId)) {
    return featureCollection;
  }

  const projectLinkedOverlayId = overlayId as ProjectLinkedOverlayId;
  return {
    ...featureCollection,
    features: featureCollection.features.filter((feature) => {
      const projectId = getProjectLinkFromFeature(projectLinkedOverlayId, feature);
      return Boolean(projectId && activeProjectIds.has(projectId));
    }),
  };
}

async function loadImageViaFetch(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image element failed to load'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadMapImage(
  map: OverlayImageMap,
  id: OverlayIconId,
  url: string,
): Promise<boolean> {
  if (map.hasImage(id)) {
    return true;
  }

  try {
    const image = await loadImageViaFetch(url);
    map.addImage(id, image);
    return true;
  } catch (fetchError) {
    return new Promise((resolve) => {
      map.loadImage(url, (error, image) => {
        if (error || !image) {
          if (!OVERLAY_ICON_WARNED.has(id)) {
            OVERLAY_ICON_WARNED.add(id);
            console.warn(`Failed to load map icon ${id} (${url})`, error ?? fetchError);
          }
          resolve(false);
          return;
        }
        map.addImage(id, image);
        resolve(true);
      });
    });
  }
}

/** Compute combined bounding box for the given project IDs. */
function computeBounds(
  geoJsonData: GeoJsonRecord,
  ids: Set<string>,
): LngLatBoundsLike | null {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let hasCoords = false;

  for (const id of ids) {
    const fc = geoJsonData[id];
    if (!fc?.features) continue;

    for (const feature of fc.features) {
      if (!feature.geometry) continue;
      visitCoords(feature.geometry, (lng: number, lat: number) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        hasCoords = true;
      });
    }
  }

  if (!hasCoords) return null;

  const lngPad = Math.max((maxLng - minLng) * 0.1, 0.01);
  const latPad = Math.max((maxLat - minLat) * 0.1, 0.01);

  return [
    [minLng - lngPad, minLat - latPad],
    [maxLng + lngPad, maxLat + latPad],
  ];
}

/** Walk every coordinate in a GeoJSON geometry. */
function visitCoords(
  geometry: GeoJSON.Geometry,
  fn: (lng: number, lat: number) => void,
): void {
  switch (geometry.type) {
    case 'Point':
      fn(geometry.coordinates[0], geometry.coordinates[1]);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const c of geometry.coordinates) fn(c[0], c[1]);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates)
        for (const c of ring) fn(c[0], c[1]);
      break;
    case 'MultiPolygon':
      for (const poly of geometry.coordinates)
        for (const ring of poly)
          for (const c of ring) fn(c[0], c[1]);
      break;
    case 'GeometryCollection':
      for (const g of geometry.geometries) visitCoords(g, fn);
      break;
  }
}

type OrientationLockMap = {
  touchZoomRotate?: { disableRotation?: () => void };
  setBearing?: (bearing: number) => void;
  setPitch?: (pitch: number) => void;
};

/** Keep the map north-up and disable touch rotation. */
function lockMapOrientation(mapRef: MapRef | null): void {
  if (!mapRef) return;

  const map = mapRef.getMap() as unknown as OrientationLockMap;
  map.touchZoomRotate?.disableRotation?.();
  map.setBearing?.(MAP.NORTH_UP_ORIENTATION.bearing);
  map.setPitch?.(MAP.NORTH_UP_ORIENTATION.pitch);
}

// ==================== Register tile caching protocol once ====================

registerTileCacheProtocol();

// ==================== Component ====================

interface DashboardProps {
  isProjectPanelOpen: boolean;
  onProjectPanelChange: (open: boolean) => void;
  isLandmarkPanelOpen: boolean;
  onLandmarkPanelChange: (open: boolean) => void;
  showLandmarks: boolean;
  colorMode: MapColorMode;
  measurementUnit: MeasurementUnit;
  selectedMapLayerId: MapLayerId;
  onSelectedMapLayerIdChange: (layerId: MapLayerId) => void;
  layerOfflineSync: Record<string, boolean>;
}

const Dashboard: React.FC<DashboardProps> = ({
  isProjectPanelOpen,
  onProjectPanelChange,
  isLandmarkPanelOpen,
  onLandmarkPanelChange,
  showLandmarks,
  colorMode,
  measurementUnit,
  selectedMapLayerId,
  onSelectedMapLayerIdChange,
  layerOfflineSync,
}) => {
  const history = useHistory();
  const { controller, projects, tilePrefetchJobs, isOfflineLocked, landmarksRevision, lastSyncedAt } = useSpeleoDB();
  const didSyncRef = useRef(false);
  const didFitRef = useRef(false);
  const mapRef = useRef<MapRef>(null);
  const mapPointerTapCandidateRef = useRef<MapPointerTapCandidate | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedOverlayMarkerDetail, setSelectedOverlayMarkerDetail] =
    useState<OverlayMarkerDetails | null>(null);

  // ---- Landmark CRUD state --------------------------------------------------
  // Circular long-press loading ring position (viewport px), null when idle.
  const [longPressRing, setLongPressRing] = useState<{ x: number; y: number } | null>(null);
  // Create/edit form: non-null means open. Delete confirm target: non-null open.
  const [landmarkForm, setLandmarkForm] = useState<
    { mode: LandmarkFormMode; initialValues: LandmarkFormInitialValues; editId: string | null } | null
  >(null);
  const [landmarkCollections, setLandmarkCollections] = useState<LandmarkCollection[]>([]);
  const [landmarkFormBusy, setLandmarkFormBusy] = useState(false);
  const [landmarkFormError, setLandmarkFormError] = useState<string | null>(null);
  const [landmarkDeleteTarget, setLandmarkDeleteTarget] = useState<LandmarkDetails | null>(null);
  const [landmarkDeleteBusy, setLandmarkDeleteBusy] = useState(false);
  const [landmarkToast, setLandmarkToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const landmarkToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const [mapViewMetrics, setMapViewMetrics] = useState<{ zoom: number; latitude: number }>(() => ({
    zoom: MAP.DEFAULT_ZOOM,
    latitude: MAP.DEFAULT_CENTER[1],
  }));

  // Active projects (which layers are visible)
  const [activeProjectIds, setActiveProjectIds] = useState<Set<string>>(new Set());

  // Country gate (overlays the per-project preference; restored from prefs once on mount).
  const [countryVisibility, setCountryVisibility] = useState<Record<string, boolean>>(
    () => getCountryVisibilityPreferences(),
  );
  const [countryCollapsed, setCountryCollapsed] = useState<Record<string, boolean>>(
    () => getCountryCollapsedPreferences(),
  );

  // Per-landmark-collection visibility + collapse (restored from prefs once on
  // mount). Missing keys imply visible / expanded.
  const [landmarkCollectionVisibility, setLandmarkCollectionVisibility] = useState<
    Record<string, boolean>
  >(() => getLandmarkCollectionVisibilityPreferences());
  const [landmarkCollectionCollapsed, setLandmarkCollectionCollapsed] = useState<
    Record<string, boolean>
  >(() => getLandmarkCollectionCollapsedPreferences());

  // Loaded GeoJSON keyed by project ID
  const [geoJsonData, setGeoJsonData] = useState<GeoJsonRecord>({});
  const [overlayGeoJsonData, setOverlayGeoJsonData] = useState<MapOverlayGeoJsonRecord>({});
  const [overlayIconAvailability, setOverlayIconAvailability] = useState<OverlayIconAvailability>(
    DEFAULT_OVERLAY_ICON_AVAILABILITY,
  );
  const [overlayIconsLoaded, setOverlayIconsLoaded] = useState(false);

  // Map style (loaded from cache/network)
  const [mapStyle, setMapStyle] = useState<Record<string, unknown> | null>(null);

  // Monotonic counter -- incremented after each sync to trigger a reload.
  const [loadTrigger, setLoadTrigger] = useState(0);

  // ---- Auth guard -----------------------------------------------------------

  useEffect(() => {
    if (!controller.isAuthenticated()) {
      history.push('/login');
    }
  }, [history, controller]);

  // ---- Load map style -------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    getCachedLayerStyle(selectedMapLayerId)
      .then((style) => {
        if (!cancelled) setMapStyle(style);
      })
      .catch((err) => console.error('Failed to load map style:', err));
    return () => {
      cancelled = true;
    };
  }, [selectedMapLayerId]);

  const handleSelectMapLayer = useCallback(
    (layerId: string) => {
      const nextLayerId = (MAP_LAYERS.find((layer) => layer.id === layerId)?.id ??
        DEFAULT_MAP_LAYER_ID) as MapLayerId;
      persistSelectedMapLayerId(nextLayerId);
      onSelectedMapLayerIdChange(nextLayerId);
    },
    [onSelectedMapLayerIdChange],
  );

  // ---- Sync projects on mount -----------------------------------------------

  useEffect(() => {
    if (!didSyncRef.current) {
      didSyncRef.current = true;
      let cancelled = false;
      controller.syncProjects()
        .then((result) => {
          if (cancelled) return;
          if (result.status === 'aborted') return;
          setLoadTrigger((n) => n + 1);
        })
        .finally(() => {
          if (cancelled) return;
        });

      return () => {
        cancelled = true;
      };
    }
  }, [controller]);

  // ---- Load GeoJSON from cache after sync completes -------------------------

  const { sortedProjects, projectColorsById } = useMemo(
    () => createProjectColorState(projects),
    [projects],
  );
  const geoJsonProjects = useMemo(
    () => sortedProjects.filter((p) => !p.exclude_geojson && Boolean(p.geojson_file)),
    [sortedProjects],
  );
  const panelProjects = useMemo(
    () => sortedProjects.filter((p) => Boolean(geoJsonData[p.id])),
    [sortedProjects, geoJsonData],
  );
  const panelActiveProjectIds = useMemo(
    () =>
      new Set(
        [...activeProjectIds].filter((projectId) => Boolean(geoJsonData[projectId])),
      ),
    [activeProjectIds, geoJsonData],
  );
  // Effective visibility = individual toggle ON AND country gate ON.
  // Every map-side consumer (layer mount, overlay filter, depth probe,
  // fit-bounds, projectPoint/Geometry layer ids) reads from this set.
  // Only the panel itself keeps the raw `activeProjectIds` so its toggle
  // reflects user intent independent of country gates.
  const effectiveActiveProjectIds = useMemo(() => {
    const next = new Set<string>();
    for (const project of sortedProjects) {
      if (!activeProjectIds.has(project.id)) continue;
      const country = project.country || 'Unknown';
      if (countryVisibility[country] === false) continue;
      next.add(project.id);
    }
    return next;
  }, [sortedProjects, activeProjectIds, countryVisibility]);
  // Project panel progress reflects the satellite layer only (extra layers have
  // their own per-layer progress in Settings).
  const tilePrefetchByProject = useMemo(
    () =>
      Object.fromEntries(
        tilePrefetchJobs
          .filter((job) => job.layerId === DEFAULT_MAP_LAYER_ID)
          .map((job) => [job.projectId, job] as const),
      ),
    [tilePrefetchJobs],
  );
  const loadOverlayIcons = useCallback(async () => {
    const map = mapRef.current?.getMap() as unknown as OverlayImageMap | undefined;
    if (!map) return;

    setOverlayIconsLoaded(false);
    const availability: OverlayIconAvailability = { ...DEFAULT_OVERLAY_ICON_AVAILABILITY };
    const iconEntries = Object.entries(OVERLAY_ICON_SOURCES) as Array<[OverlayIconId, string]>;
    for (const [iconId, iconSrc] of iconEntries) {
      availability[iconId] = await loadMapImage(map, iconId, iconSrc);
    }
    setOverlayIconAvailability(availability);
    setOverlayIconsLoaded(true);
  }, []);

  useEffect(() => {
    // Only load when triggered (after sync completes)
    if (loadTrigger === 0) return;

    let stale = false;

    (async () => {
      const newData: GeoJsonRecord = {};

      // When geoJsonProjects is empty, the loop is a no-op and newData stays {},
      // which clears any previously-loaded data via the setGeoJsonData call below.
      // Setting state inside this async callback avoids the cascading-render
      // cost of calling setState synchronously in the effect body.
      for (const project of geoJsonProjects) {
        try {
          const raw = await controller.getProjectGeoJSON(project.id);
          if (stale) return;

          const fc = normalizeGeoJSON(raw);
          if (fc && fc.features.length > 0) {
            newData[project.id] = attachDepthToFeatureCollection(fc, DEPTH_PROPERTY_KEY);
          }
        } catch (err) {
          console.warn(`Failed to load GeoJSON for ${project.id}:`, err);
        }
      }

      if (stale) return;

      setGeoJsonData(newData);

      // On first meaningful load, restore persisted visibility per project.
      setActiveProjectIds((prev) => {
        if (prev.size === 0) {
          const visibilityPrefs = getProjectVisibilityPreferences();
          const visibleIds = Object.keys(newData).filter(
            (projectId) => visibilityPrefs[projectId] !== false,
          );
          return new Set(visibleIds);
        }
        return prev;
      });
    })();

    return () => { stale = true; };
  }, [loadTrigger, controller, geoJsonProjects]);

  useEffect(() => {
    if (loadTrigger === 0) return;

    let stale = false;
    (async () => {
      const nextData: MapOverlayGeoJsonRecord = {};
      for (const overlay of MAP_OVERLAYS) {
        try {
          const raw = await controller.getOverlayGeoJSON(overlay.id);
          if (stale) return;

          const featureCollection = normalizeGeoJSON(raw);
          if (featureCollection && featureCollection.features.length > 0) {
            const normalized = normalizeOverlayGeoJSON(overlay.id, featureCollection);
            nextData[overlay.id] =
              overlay.id === 'landmarks'
                ? (ensureLandmarkPropertyIds(normalized) as GeoJSON.FeatureCollection)
                : normalized;
          }
        } catch (error) {
          console.warn(`Failed to load cached overlay ${overlay.id}:`, error);
        }
      }

      if (stale) return;
      setOverlayGeoJsonData(nextData);
    })();

    return () => {
      stale = true;
    };
    // `landmarksRevision` bumps after a landmark create/edit/delete writes the
    // cached overlay; `lastSyncedAt` changes after any sync/resync rewrites the
    // overlay cache (e.g. a landmark deleted on the web). Re-read on either so
    // the map + panel always reflect the latest cached overlays.
  }, [controller, loadTrigger, landmarksRevision, lastSyncedAt]);

  const visibleOverlayGeoJsonData = useMemo(() => {
    const nextData: MapOverlayGeoJsonRecord = {};
    for (const overlay of MAP_OVERLAYS) {
      const featureCollection = overlayGeoJsonData[overlay.id];
      if (!featureCollection || featureCollection.features.length === 0) {
        continue;
      }
      const filtered = filterOverlayByProjectVisibility(
        overlay.id,
        featureCollection,
        effectiveActiveProjectIds,
      );
      if (filtered.features.length > 0) {
        nextData[overlay.id] = filtered;
      }
    }
    return nextData;
  }, [effectiveActiveProjectIds, overlayGeoJsonData]);

  // Landmark collection groups for the panel, derived entirely from the cached
  // landmarks GeoJSON (fully offline -- no extra endpoint).
  const landmarkCollectionGroups = useMemo(
    () => buildLandmarkCollectionGroups(overlayGeoJsonData.landmarks ?? null),
    [overlayGeoJsonData],
  );

  // Landmarks actually drawn on the map: only those whose collection is visible
  // (missing key implies visible). The whole layer is additionally gated behind
  // the global `showLandmarks` master toggle at render time.
  const visibleLandmarksGeoJSON = useMemo(() => {
    const featureCollection = visibleOverlayGeoJsonData.landmarks;
    if (!featureCollection) return undefined;
    const features = featureCollection.features.filter((feature) => {
      const collectionId = String(feature.properties?.collection ?? '') || '__personal__';
      return landmarkCollectionVisibility[collectionId] !== false;
    });
    return { ...featureCollection, features };
  }, [visibleOverlayGeoJsonData, landmarkCollectionVisibility]);

  // ---- Auto-fit bounds on first data load -----------------------------------

  useEffect(() => {
    if (didFitRef.current) return;
    if (effectiveActiveProjectIds.size === 0 || Object.keys(geoJsonData).length === 0) return;

    const bounds = computeBounds(geoJsonData, effectiveActiveProjectIds);
    if (bounds && mapRef.current) {
      didFitRef.current = true;
      mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 800 });
    }
  }, [effectiveActiveProjectIds, geoJsonData]);

  // ---- Handlers -------------------------------------------------------------

  const projectPointLayerIds = useMemo(
    () => [...effectiveActiveProjectIds].map((id) => `project-${id}-point`),
    [effectiveActiveProjectIds],
  );
  const projectGeometryLayerIds = useMemo(
    () =>
      [...effectiveActiveProjectIds].flatMap((id) => [
        `project-${id}-point`,
        `project-${id}-line`,
        `project-${id}-fill`,
      ]),
    [effectiveActiveProjectIds],
  );

  const {
    probedDepth,
    depthDomain,
    clearProbedDepth,
    sampleDepthAtClientPoint,
    handleMapMouseMove,
    handleMapMouseLeave,
  } = useDepthProbe(
    mapRef,
    colorMode,
    effectiveActiveProjectIds,
    geoJsonData,
    projectGeometryLayerIds,
  );

  const allInteractiveLayerIds = useMemo(
    () => [...INTERACTIVE_OVERLAY_LAYER_IDS, ...projectPointLayerIds] as readonly string[],
    [projectPointLayerIds],
  );
  const longPressBlockingLayerIds = useMemo(
    () =>
      [
        ...LONG_PRESS_BLOCKING_STATIC_LAYER_IDS,
        ...projectGeometryLayerIds,
      ] as readonly string[],
    [projectGeometryLayerIds],
  );

  const markerParseContext = useMemo<MarkerParseContext>(() => {
    const nameByLayer = new globalThis.Map<string, string>();
    for (const project of sortedProjects) {
      nameByLayer.set(`project-${project.id}-point`, project.name);
    }
    return { projectNameByPointLayerId: nameByLayer };
  }, [sortedProjects]);

  const openOverlayMarkerDetailsAtMapPoint = useCallback((
    point: { x: number; y: number },
    hitRadiusPx: number,
  ) => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.queryRenderedFeatures || !map.getLayer || !map.getZoom) {
      return;
    }

    const zoom = map.getZoom();
    if (!Number.isFinite(zoom) || zoom < MAP.MARKER_INTERACTION_MIN_ZOOM) {
      return;
    }

    // Filter to only layers that currently exist on the map to avoid
    // maplibre-gl throwing on non-existent layer IDs (icon-layer and
    // fallback-layer are conditionally rendered, never both present).
    const existingLayers = allInteractiveLayerIds.filter(
      (id) => map.getLayer(id) != null,
    );

    if (existingLayers.length === 0) {
      return;
    }

    let features: InteractiveOverlayFeature[];
    try {
      features = map.queryRenderedFeatures(
        getMarkerHitQueryBounds(point, hitRadiusPx),
        { layers: existingLayers as string[] },
      );
    } catch (err) {
      console.warn('[overlay-tap] queryRenderedFeatures error', err);
      return;
    }

    if (!features || features.length === 0) {
      return;
    }

    const details = getClickedOverlayMarkerDetails(features, allInteractiveLayerIds, markerParseContext);
    if (!details) {
      return;
    }

    setSelectedOverlayMarkerDetail(details);
  }, [allInteractiveLayerIds, markerParseContext]);

  const openOverlayMarkerDetailsAtClientPoint = useCallback((
    clientX: number,
    clientY: number,
    hitRadiusPx: number,
  ) => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    const canvasRect = map?.getCanvas()?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }

    openOverlayMarkerDetailsAtMapPoint({
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    }, hitRadiusPx);
  }, [openOverlayMarkerDetailsAtMapPoint]);

  const openLongPressGpsDetail = useCallback((clientX: number, clientY: number) => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.getCanvas || !map.unproject) {
      return;
    }
    const canvasRect = map.getCanvas()?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }
    const mapPoint = {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    };
    const lngLat = map.unproject(mapPoint);
    const detail: MapLongPressDetails = {
      type: 'mapLongPress',
      gpsCoordinate: formatLatLng(lngLat.lat, lngLat.lng),
      latitude: lngLat.lat,
      longitude: lngLat.lng,
    };
    setSelectedOverlayMarkerDetail(detail);
  }, []);

  const isMarkerInteractionZoom = useCallback((): boolean => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.getZoom) {
      return false;
    }
    const zoom = map.getZoom();
    return Number.isFinite(zoom) && zoom >= MAP.MARKER_INTERACTION_MIN_ZOOM;
  }, []);

  const isEmptyMapSpotAtClientPoint = useCallback((clientX: number, clientY: number): boolean => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.queryRenderedFeatures || !map.getLayer || !map.getCanvas || !map.getZoom) {
      return false;
    }
    const zoom = map.getZoom();
    if (!Number.isFinite(zoom) || zoom < MAP.MARKER_INTERACTION_MIN_ZOOM) {
      return false;
    }

    const canvasRect = map.getCanvas()?.getBoundingClientRect();
    if (!canvasRect) {
      return false;
    }
    const mapPoint = {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    };

    const existingLayers = longPressBlockingLayerIds.filter(
      (id) => map.getLayer(id) != null,
    );
    if (existingLayers.length === 0) {
      return true;
    }

    try {
      const features = map.queryRenderedFeatures(
        getMarkerHitQueryBounds(mapPoint, MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX),
        { layers: existingLayers as string[] },
      );
      return features.length === 0;
    } catch {
      return false;
    }
  }, [longPressBlockingLayerIds]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  const handleMapGestureStart = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    clearLongPressTimer();

    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      const isMultiTouch = mapPointerTapCandidateRef.current !== null;
      mapPointerTapCandidateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startedAtMs: Date.now(),
        moved: false,
        pointerType: event.pointerType,
      };

      if (!isMultiTouch) {
        sampleDepthAtClientPoint(event.clientX, event.clientY);
        const cx = event.clientX;
        const cy = event.clientY;
        // Only arm the long-press (and show its loading ring) when the map is
        // zoomed in far enough that a landmark can be created. Below the marker
        // interaction zoom, creation is impossible, so the ring must not appear
        // at all. The empty-spot requirement is enforced when the timer fires.
        if (isMarkerInteractionZoom()) {
          setLongPressRing({ x: cx, y: cy });
          longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            mapPointerTapCandidateRef.current = null;
            setLongPressRing(null);
            if (!isEmptyMapSpotAtClientPoint(cx, cy)) {
              return;
            }
            Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
            openLongPressGpsDetail(cx, cy);
          }, MAP.LONG_PRESS_DURATION_MS);
        }
      } else {
        setLongPressRing(null);
        clearProbedDepth();
      }
    } else {
      mapPointerTapCandidateRef.current = null;
    }
  }, [clearLongPressTimer, clearProbedDepth, isEmptyMapSpotAtClientPoint, isMarkerInteractionZoom, openLongPressGpsDetail, sampleDepthAtClientPoint]);

  const handleMapGestureMove = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const candidate = mapPointerTapCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - candidate.startClientX,
      event.clientY - candidate.startClientY,
    );
    if (distance > MAP_TOUCH_TAP_MAX_MOVEMENT_PX) {
      candidate.moved = true;
      clearLongPressTimer();
      setLongPressRing(null);
    }
    if (candidate.pointerType === 'touch' || candidate.pointerType === 'pen') {
      sampleDepthAtClientPoint(event.clientX, event.clientY);
    }
  }, [clearLongPressTimer, sampleDepthAtClientPoint]);

  const handleMapGestureEnd = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    clearLongPressTimer();
    setLongPressRing(null);

    const candidate = mapPointerTapCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }

    mapPointerTapCandidateRef.current = null;
    if (candidate.pointerType === 'touch' || candidate.pointerType === 'pen') {
      clearProbedDepth();
    }

    if (event.type !== 'pointerup') {
      return;
    }

    const durationMs = Date.now() - candidate.startedAtMs;
    const distance = Math.hypot(
      event.clientX - candidate.startClientX,
      event.clientY - candidate.startClientY,
    );
    const isTap = !candidate.moved
      && distance <= MAP_TOUCH_TAP_MAX_MOVEMENT_PX
      && durationMs <= MAP_TOUCH_TAP_MAX_DURATION_MS;

    if (!isTap || (candidate.pointerType !== 'touch' && candidate.pointerType !== 'pen')) {
      return;
    }

    openOverlayMarkerDetailsAtClientPoint(
      event.clientX,
      event.clientY,
      MAP_MARKER_HIT_RADIUS_PX_TOUCH,
    );
  }, [clearLongPressTimer, clearProbedDepth, openOverlayMarkerDetailsAtClientPoint]);

  const handleToggleProject = useCallback((projectId: string) => {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    setActiveProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      setProjectVisibilityPreference(projectId, next.has(projectId));
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => {
    // Activate only projects that currently have loaded GeoJSON.
    const nextIds = panelProjects.map((p) => p.id);
    setProjectVisibilityPreferences(
      Object.fromEntries(nextIds.map((projectId) => [projectId, true] as const)),
    );
    setActiveProjectIds(new Set(nextIds));

    // Show all is symmetric with the AND gate: it must also re-enable any
    // country gate that was previously OFF, otherwise the user can hit
    // "Show all" and still see nothing.
    const countries = Array.from(
      new Set(panelProjects.map((p) => p.country || 'Unknown')),
    );
    if (countries.length > 0) {
      const countryUpdate = Object.fromEntries(
        countries.map((c) => [c, true] as const),
      );
      setCountryVisibilityPreferences(countryUpdate);
      setCountryVisibility((prev) => ({ ...prev, ...countryUpdate }));
    }
  }, [panelProjects]);

  const handleHideAll = useCallback(() => {
    const nextIds = panelProjects.map((p) => p.id);
    setProjectVisibilityPreferences(
      Object.fromEntries(nextIds.map((projectId) => [projectId, false] as const)),
    );
    setActiveProjectIds(new Set());
    // Country gates are intentionally left untouched — the AND naturally
    // hides everything once individual toggles are OFF, and we want the
    // user's per-country choices to survive a temporary "Hide all".
  }, [panelProjects]);

  const handleToggleCountry = useCallback((country: string, visible: boolean) => {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    setCountryVisibility((prev) => ({ ...prev, [country]: visible }));
    setCountryVisibilityPreference(country, visible);
  }, []);

  const handleToggleCountryCollapsed = useCallback(
    (country: string, collapsed: boolean) => {
      // No haptic: collapse is a UI affordance, not a visibility change.
      setCountryCollapsed((prev) => ({ ...prev, [country]: collapsed }));
      setCountryCollapsedPreference(country, collapsed);
    },
    [],
  );

  const handleZoomToProject = useCallback((projectId: string) => {
    // Step 0a: Ensure the project layer is visible on the map.
    setActiveProjectIds((prev) => {
      if (prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    setProjectVisibilityPreference(projectId, true);

    // Step 0b: If the target project's country gate is OFF, force it ON —
    // otherwise the AND keeps the project hidden and the zoom flies to an
    // empty viewport.
    const project = sortedProjects.find((p) => p.id === projectId);
    if (project) {
      const country = project.country || 'Unknown';
      if (countryVisibility[country] === false) {
        setCountryVisibility((prev) => ({ ...prev, [country]: true }));
        setCountryVisibilityPreference(country, true);
      }
    }

    // Step 1: Close the panel so the map is unobstructed before animating.
    onProjectPanelChange(false);

    // Step 2: Zoom to this project's bounds — read geoJsonData from the
    // latest state via a functional update trick so we always operate on
    // the current snapshot.
    setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;

      setGeoJsonData((current) => {
        const fc = current[projectId];
        if (fc) {
          const bounds = computeBounds(current, new Set([projectId]));
          if (bounds) {
            map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
          }
        }
        return current;
      });
    }, 0);
  }, [onProjectPanelChange, sortedProjects, countryVisibility]);

  const handleMapLoad = useCallback(() => {
    lockMapOrientation(mapRef.current);
    void loadOverlayIcons();
  }, [loadOverlayIcons]);

  const handleMapMove = useCallback((event: ViewStateChangeEvent) => {
    const { zoom, latitude } = event.viewState;
    if (!Number.isFinite(zoom) || !Number.isFinite(latitude)) {
      return;
    }
    setMapViewMetrics((prev) => {
      if (prev.zoom === zoom && prev.latitude === latitude) {
        return prev;
      }
      return { zoom, latitude };
    });
  }, []);

  const [isLocating, setIsLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [geoError, setGeoError] = useState<unknown>(null);
  const handleGoToMyLocation = useCallback(async () => {
    setIsLocating(true);
    try {
      const perms = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (perms.location !== 'granted') {
        setGeoError(PERMISSION_DENIED_SENTINEL);
        return;
      }
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10_000,
      });
      const lng = position.coords.longitude;
      const lat = position.coords.latitude;
      setUserLocation({ lng, lat });
      const map = mapRef.current;
      if (map) {
        (map.getMap() as MaplibreMap).flyTo({
          center: [lng, lat],
          zoom: 15,
          duration: 1200,
        });
      }
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    } catch (err: unknown) {
      setGeoError(err);
    } finally {
      setIsLocating(false);
    }
  }, []);

  const handleToggleLandmarkCollection = useCallback(
    (collectionId: string, visible: boolean) => {
      setLandmarkCollectionVisibility((prev) => ({ ...prev, [collectionId]: visible }));
      setLandmarkCollectionVisibilityPreference(collectionId, visible);
    },
    [],
  );

  const handleToggleLandmarkCollectionCollapsed = useCallback(
    (collectionId: string, collapsed: boolean) => {
      setLandmarkCollectionCollapsed((prev) => ({ ...prev, [collectionId]: collapsed }));
      setLandmarkCollectionCollapsedPreference(collectionId, collapsed);
    },
    [],
  );

  const handleLandmarkShowAll = useCallback(() => {
    const updates: Record<string, boolean> = {};
    for (const group of landmarkCollectionGroups) updates[group.id] = true;
    if (Object.keys(updates).length === 0) return;
    setLandmarkCollectionVisibility((prev) => ({ ...prev, ...updates }));
    setLandmarkCollectionVisibilityPreferences(updates);
  }, [landmarkCollectionGroups]);

  const handleLandmarkHideAll = useCallback(() => {
    const updates: Record<string, boolean> = {};
    for (const group of landmarkCollectionGroups) updates[group.id] = false;
    if (Object.keys(updates).length === 0) return;
    setLandmarkCollectionVisibility((prev) => ({ ...prev, ...updates }));
    setLandmarkCollectionVisibilityPreferences(updates);
  }, [landmarkCollectionGroups]);

  const handleLocateLandmark = useCallback(
    (landmark: LandmarkListItem) => {
      // Close the panel so the map is unobstructed before animating.
      onLandmarkPanelChange(false);
      const map = mapRef.current;
      if (map) {
        (map.getMap() as MaplibreMap).flyTo({
          center: [landmark.longitude, landmark.latitude],
          zoom: 16,
          duration: 1000,
        });
      }
      // NOTE: intentionally do NOT open the details modal here. The landmark
      // details modal is only reachable by physically tapping the marker on
      // the map; a panel-row tap just flies to the landmark.
    },
    [onLandmarkPanelChange],
  );

  const handleDismissOverlayMarkerDetailsModal = useCallback(() => {
    setSelectedOverlayMarkerDetail(null);
  }, []);

  // ---- Landmark CRUD handlers -----------------------------------------------

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (landmarkToastTimerRef.current !== null) {
        clearTimeout(landmarkToastTimerRef.current);
      }
    };
  }, []);

  const showLandmarkToast = useCallback((message: string, tone: 'success' | 'error') => {
    if (landmarkToastTimerRef.current !== null) {
      clearTimeout(landmarkToastTimerRef.current);
    }
    setLandmarkToast({ message, tone });
    landmarkToastTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) setLandmarkToast(null);
      landmarkToastTimerRef.current = null;
    }, 3000);
  }, []);

  // Load the writable collection list for the picker (best-effort, online only).
  const loadLandmarkCollections = useCallback(() => {
    void (async () => {
      try {
        const collections = await controller.getLandmarkCollections();
        if (isMountedRef.current) setLandmarkCollections(collections);
      } catch {
        if (isMountedRef.current) setLandmarkCollections([]);
      }
    })();
  }, [controller]);

  const handleOpenCreateLandmark = useCallback(() => {
    const detail = selectedOverlayMarkerDetail;
    if (!detail || detail.type !== 'mapLongPress') return;
    setSelectedOverlayMarkerDetail(null);
    setLandmarkFormError(null);
    setLandmarkForm({
      mode: 'create',
      editId: null,
      initialValues: {
        latitude: detail.latitude,
        longitude: detail.longitude,
      },
    });
    loadLandmarkCollections();
  }, [selectedOverlayMarkerDetail, loadLandmarkCollections]);

  const handleOpenEditLandmark = useCallback(() => {
    const detail = selectedOverlayMarkerDetail;
    if (!detail || detail.type !== 'landmark') return;
    setSelectedOverlayMarkerDetail(null);
    setLandmarkFormError(null);
    setLandmarkForm({
      mode: 'edit',
      editId: detail.id,
      initialValues: {
        name: detail.name === 'N/A' ? '' : detail.name,
        description: detail.description === 'N/A' ? '' : detail.description,
        latitude: detail.latitude,
        longitude: detail.longitude,
        collectionId: detail.collectionId,
        collectionName: detail.collectionName === 'N/A' ? null : detail.collectionName,
      },
    });
    loadLandmarkCollections();
  }, [selectedOverlayMarkerDetail, loadLandmarkCollections]);

  const handleOpenDeleteLandmark = useCallback(() => {
    const detail = selectedOverlayMarkerDetail;
    if (!detail || detail.type !== 'landmark') return;
    setSelectedOverlayMarkerDetail(null);
    setLandmarkDeleteTarget(detail);
  }, [selectedOverlayMarkerDetail]);

  const handleCancelLandmarkForm = useCallback(() => {
    if (landmarkFormBusy) return;
    setLandmarkForm(null);
    setLandmarkFormError(null);
  }, [landmarkFormBusy]);

  const handleSubmitLandmarkForm = useCallback(
    (value: NormalizedLandmarkInput) => {
      const form = landmarkForm;
      if (!form || landmarkFormBusy) return;
      setLandmarkFormBusy(true);
      setLandmarkFormError(null);
      void (async () => {
        try {
          if (form.mode === 'create') {
            await controller.createLandmark({
              name: value.name,
              description: value.description,
              latitude: value.latitude,
              longitude: value.longitude,
              collection: value.collection,
            });
          } else if (form.editId) {
            await controller.updateLandmark(form.editId, {
              name: value.name,
              description: value.description,
              latitude: value.latitude,
              longitude: value.longitude,
              collection: value.collection,
            });
          }
          if (!isMountedRef.current) return;
          setLandmarkForm(null);
          showLandmarkToast(
            form.mode === 'create' ? 'Landmark created' : 'Landmark updated',
            'success',
          );
        } catch (error) {
          if (!isMountedRef.current) return;
          const message =
            error instanceof LandmarkMutationError
              ? error.message
              : 'Something went wrong. Please try again.';
          setLandmarkFormError(message);
        } finally {
          if (isMountedRef.current) setLandmarkFormBusy(false);
        }
      })();
    },
    [controller, landmarkForm, landmarkFormBusy, showLandmarkToast],
  );

  const handleCancelDeleteLandmark = useCallback(() => {
    if (landmarkDeleteBusy) return;
    setLandmarkDeleteTarget(null);
  }, [landmarkDeleteBusy]);

  const handleConfirmDeleteLandmark = useCallback(() => {
    const target = landmarkDeleteTarget;
    if (!target || landmarkDeleteBusy) return;
    setLandmarkDeleteBusy(true);
    void (async () => {
      try {
        await controller.deleteLandmark(target.id);
        if (!isMountedRef.current) return;
        setLandmarkDeleteTarget(null);
        showLandmarkToast('Landmark deleted', 'success');
      } catch (error) {
        if (!isMountedRef.current) return;
        const isGone = error instanceof LandmarkMutationError && error.kind === 'not_found';
        setLandmarkDeleteTarget(null);
        showLandmarkToast(
          isGone
            ? 'Landmark already removed'
            : error instanceof LandmarkMutationError
              ? error.message
              : 'Could not delete the landmark. Please try again.',
          isGone ? 'success' : 'error',
        );
      } finally {
        if (isMountedRef.current) setLandmarkDeleteBusy(false);
      }
    })();
  }, [controller, landmarkDeleteTarget, landmarkDeleteBusy, showLandmarkToast]);

  // ---- Render ---------------------------------------------------------------

  if (!controller.isAuthenticated()) return null;

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding" scrollY={false}>
        <div className="flex flex-col w-full h-full">
          <div className="relative flex-1 min-h-0 dashboard-map-container">
          <div
            className="relative w-full h-full dashboard-map-touch-surface"
            onPointerDownCapture={handleMapGestureStart}
            onPointerMoveCapture={handleMapGestureMove}
            onPointerUpCapture={handleMapGestureEnd}
            onPointerCancelCapture={handleMapGestureEnd}
          >
            {/* ---- Map ---- */}
            {mapStyle && (
              <Map
                ref={mapRef}
                initialViewState={{
                  longitude: MAP.DEFAULT_CENTER[0],
                  latitude: MAP.DEFAULT_CENTER[1],
                  zoom: MAP.DEFAULT_ZOOM,
                  ...MAP.NORTH_UP_ORIENTATION,
                }}
                maxZoom={MAP.MAX_ZOOM}
                {...MAP.ROTATION_LOCK_INTERACTIONS}
                style={{ width: '100%', height: '100%' }}
                mapStyle={mapStyle as maplibregl.StyleSpecification}
                attributionControl={{ compact: true }}
                onLoad={handleMapLoad}
                onMove={handleMapMove}
                onMouseMove={handleMapMouseMove}
                onMouseLeave={handleMapMouseLeave}
              >
                <Source
                  id={PROJECT_LAYER_ORDER_ANCHOR_SOURCE_ID}
                  type="geojson"
                  data={EMPTY_FEATURE_COLLECTION}
                >
                  <Layer
                    id={PROJECT_LAYER_ORDER_ANCHOR_LAYER_ID}
                    type="circle"
                    paint={{
                      'circle-opacity': 0,
                      'circle-radius': 0,
                    }}
                  />
                </Source>

                {/* GeoJSON layers for each effectively-visible project */}
                {sortedProjects.map((project) => {
                  if (!effectiveActiveProjectIds.has(project.id) || !geoJsonData[project.id]) {
                    return null;
                  }
                  const color = getProjectColor(project.id, projectColorsById);
                  const lineAndFillColor = colorMode === 'depth'
                    ? createDepthColorExpression(depthDomain, color, DEPTH_PROPERTY_KEY)
                    : color;
                  const sourceId = `project-${project.id}`;

                  return (
                    <Source
                      key={project.id}
                      id={sourceId}
                      type="geojson"
                      data={geoJsonData[project.id]}
                    >
                      {/* Polygon fills */}
                      <Layer
                        id={`${sourceId}-fill`}
                        type="fill"
                        beforeId={PROJECT_LAYER_ORDER_ANCHOR_LAYER_ID}
                        filter={[
                          'match',
                          ['geometry-type'],
                          ['Polygon', 'MultiPolygon'],
                          true,
                          false,
                        ]}
                        paint={{
                          'fill-color': lineAndFillColor,
                          'fill-opacity': 0.25,
                        }}
                      />

                      {/* Lines + polygon outlines */}
                      <Layer
                        id={`${sourceId}-line`}
                        type="line"
                        beforeId={PROJECT_LAYER_ORDER_ANCHOR_LAYER_ID}
                        minzoom={PROJECT_LAYERS.lineMinZoom}
                        filter={[
                          'match',
                          ['geometry-type'],
                          ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
                          true,
                          false,
                        ]}
                        paint={{
                          'line-color': lineAndFillColor,
                          'line-width': 2.5,
                        }}
                      />

                      {/* Point entries: Django parity star symbol */}
                      <Layer
                        id={`${sourceId}-point`}
                        type="symbol"
                        beforeId={PROJECT_LAYER_ORDER_ANCHOR_LAYER_ID}
                        filter={[
                          'match',
                          ['geometry-type'],
                          ['Point', 'MultiPoint'],
                          true,
                          false,
                        ]}
                        minzoom={PROJECT_LAYERS.entrySymbolMinZoom}
                        layout={{
                          'text-field': '★',
                          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                          'text-size': PROJECT_LAYERS.entrySymbolTextSize,
                          'text-allow-overlap': true,
                          'text-ignore-placement': true,
                        }}
                        paint={{
                          'text-color': '#F5E027',
                          'text-halo-color': '#000000',
                          'text-halo-width': 1.5,
                        }}
                      />
                    </Source>
                  );
                })}

                {showLandmarks && visibleLandmarksGeoJSON && (
                  <Source
                    id="landmarks-source"
                    type="geojson"
                    data={visibleLandmarksGeoJSON}
                  >
                    <Layer
                      id="landmarks-layer"
                      type="symbol"
                      minzoom={getOverlayMarkerMinZoom('landmarks')}
                      layout={{
                        'text-field': '▼',
                        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                        'text-size': getOverlaySizes('landmarks').markerTextSize,
                        'text-allow-overlap': true,
                        'text-ignore-placement': true,
                      }}
                      paint={{
                        'text-color': LANDMARK_COLLECTION_COLOR_EXPRESSION,
                        'text-halo-color': LANDMARK_COLLECTION_HALO_EXPRESSION,
                        'text-halo-width': 2,
                        'text-halo-blur': 0.5,
                      }}
                    />
                    <Layer
                      id="landmarks-labels"
                      type="symbol"
                      minzoom={getOverlayLabelMinZoom('landmarks') ?? 16}
                      layout={{
                        'text-field': ['get', 'name'],
                        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                        'text-offset': [0, 1.5],
                        'text-size': getOverlaySizes('landmarks').labelTextSize,
                        'text-anchor': 'top',
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                      }}
                      paint={{
                        'text-color': LANDMARK_COLLECTION_COLOR_EXPRESSION,
                        'text-halo-color': LANDMARK_COLLECTION_HALO_EXPRESSION,
                        'text-halo-width': 1.5,
                      }}
                    />
                  </Source>
                )}

                {visibleOverlayGeoJsonData.surfaceStations && (
                  <Source
                    id="surface-stations-source"
                    type="geojson"
                    data={visibleOverlayGeoJsonData.surfaceStations}
                  >
                    <Layer
                      id="surface-stations-layer"
                      type="symbol"
                      minzoom={getOverlayMarkerMinZoom('surfaceStations')}
                      layout={{
                        'text-field': '◆',
                        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                        'text-size': getOverlaySizes('surfaceStations').markerTextSize,
                        'text-allow-overlap': true,
                        'text-ignore-placement': true,
                      }}
                      paint={{
                        'text-color': ['coalesce', ['get', 'color'], '#fb923c'],
                        'text-halo-color': '#ffffff',
                        'text-halo-width': 2,
                        'text-halo-blur': 0.5,
                      }}
                    />
                    <Layer
                      id="surface-stations-labels"
                      type="symbol"
                      minzoom={getOverlayLabelMinZoom('surfaceStations') ?? 16}
                      layout={{
                        'text-field': ['get', 'name'],
                        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                        'text-offset': [0, 1.2],
                        'text-size': getOverlaySizes('surfaceStations').labelTextSize,
                        'text-anchor': 'top',
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                      }}
                      paint={{
                        'text-color': '#222',
                        'text-halo-color': '#ffffff',
                        'text-halo-width': 2,
                      }}
                    />
                  </Source>
                )}

                {visibleOverlayGeoJsonData.subsurfaceStations && (
                  <Source
                    id="subsurface-stations-source"
                    type="geojson"
                    data={visibleOverlayGeoJsonData.subsurfaceStations}
                  >
                    <Layer
                      id="subsurface-stations-circles"
                      type="circle"
                      filter={[
                        'any',
                        ['!', ['has', 'type']],
                        ['==', ['get', 'type'], null],
                        ['==', ['get', 'type'], 'sensor'],
                      ]}
                      minzoom={getOverlayMarkerMinZoom('subsurfaceStations')}
                      paint={{
                        'circle-radius': getOverlaySizes('subsurfaceStations').markerCircleRadius,
                        'circle-color': ['coalesce', ['get', 'color'], '#fb923c'],
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#ffffff',
                        'circle-opacity': 1,
                      }}
                    />

                    {overlayIconsLoaded && overlayIconAvailability['biology-station-icon'] && (
                      <Layer
                        id="subsurface-stations-biology-icons"
                        type="symbol"
                        filter={['==', ['get', 'type'], 'biology']}
                        minzoom={getOverlayMarkerMinZoom('subsurfaceStations')}
                        layout={{
                          'icon-image': 'biology-station-icon',
                          'icon-size': getOverlaySizes('subsurfaceStations').markerIconSize,
                          'icon-allow-overlap': true,
                          'icon-ignore-placement': true,
                        }}
                        paint={{ 'icon-opacity': 1 }}
                      />
                    )}

                    {overlayIconsLoaded && overlayIconAvailability['bone-station-icon'] && (
                      <Layer
                        id="subsurface-stations-bone-icons"
                        type="symbol"
                        filter={['==', ['get', 'type'], 'bone']}
                        minzoom={getOverlayMarkerMinZoom('subsurfaceStations')}
                        layout={{
                          'icon-image': 'bone-station-icon',
                          'icon-size': getOverlaySizes('subsurfaceStations').markerIconSize,
                          'icon-allow-overlap': true,
                          'icon-ignore-placement': true,
                        }}
                        paint={{ 'icon-opacity': 1 }}
                      />
                    )}

                    {overlayIconsLoaded && overlayIconAvailability['artifact-station-icon'] && (
                      <Layer
                        id="subsurface-stations-artifact-icons"
                        type="symbol"
                        filter={['==', ['get', 'type'], 'artifact']}
                        minzoom={getOverlayMarkerMinZoom('subsurfaceStations')}
                        layout={{
                          'icon-image': 'artifact-station-icon',
                          'icon-size': getOverlaySizes('subsurfaceStations').markerIconSize,
                          'icon-allow-overlap': true,
                          'icon-ignore-placement': true,
                        }}
                        paint={{ 'icon-opacity': 1 }}
                      />
                    )}

                    {overlayIconsLoaded && overlayIconAvailability['geology-station-icon'] && (
                      <Layer
                        id="subsurface-stations-geology-icons"
                        type="symbol"
                        filter={['==', ['get', 'type'], 'geology']}
                        minzoom={getOverlayMarkerMinZoom('subsurfaceStations')}
                        layout={{
                          'icon-image': 'geology-station-icon',
                          'icon-size': getOverlaySizes('subsurfaceStations').markerIconSize,
                          'icon-allow-overlap': true,
                          'icon-ignore-placement': true,
                        }}
                        paint={{ 'icon-opacity': 1 }}
                      />
                    )}

                    <Layer
                      id="subsurface-stations-labels"
                      type="symbol"
                      minzoom={getOverlayLabelMinZoom('subsurfaceStations') ?? 16}
                      layout={{
                        'text-field': ['get', 'name'],
                        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                        'text-offset': [0, 1.2],
                        'text-size': getOverlaySizes('subsurfaceStations').labelTextSize,
                        'text-anchor': 'top',
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                      }}
                      paint={{
                        'text-color': '#222',
                        'text-halo-color': '#ffffff',
                        'text-halo-width': 2,
                      }}
                    />
                  </Source>
                )}

                {visibleOverlayGeoJsonData.explorationLeads && (
                  <Source
                    id="exploration-leads-source"
                    type="geojson"
                    data={visibleOverlayGeoJsonData.explorationLeads}
                  >
                    {overlayIconsLoaded && overlayIconAvailability['exploration-lead-icon'] && (
                      <Layer
                        id="exploration-leads-icon-layer"
                        type="symbol"
                        minzoom={getOverlayMarkerMinZoom('explorationLeads')}
                        layout={{
                          'icon-image': 'exploration-lead-icon',
                          'icon-size': getOverlaySizes('explorationLeads').markerIconSize,
                          'icon-allow-overlap': true,
                          'icon-ignore-placement': true,
                        }}
                        paint={{ 'icon-opacity': 1 }}
                      />
                    )}
                    {overlayIconsLoaded && !overlayIconAvailability['exploration-lead-icon'] && (
                      <Layer
                        id="exploration-leads-fallback-layer"
                        type="circle"
                        minzoom={getOverlayMarkerMinZoom('explorationLeads')}
                        paint={{
                          'circle-radius': getOverlaySizes('explorationLeads').fallbackCircleRadius,
                          'circle-color': '#EF4444',
                          'circle-stroke-width': 2,
                          'circle-stroke-color': '#ffffff',
                          'circle-opacity': 1,
                        }}
                      />
                    )}
                  </Source>
                )}

                {visibleOverlayGeoJsonData.cylinderInstalls && (
                  <Source
                    id="cylinder-installs-source"
                    type="geojson"
                    data={visibleOverlayGeoJsonData.cylinderInstalls}
                  >
                    {overlayIconsLoaded && overlayIconAvailability['cylinder-icon'] && (
                      <Layer
                        id="cylinder-installs-icon-layer"
                        type="symbol"
                        minzoom={getOverlayMarkerMinZoom('cylinderInstalls')}
                        layout={{
                          'icon-image': 'cylinder-icon',
                          'icon-size': getOverlaySizes('cylinderInstalls').markerIconSize,
                          'icon-allow-overlap': true,
                          'icon-ignore-placement': true,
                        }}
                        paint={{ 'icon-opacity': 1 }}
                      />
                    )}
                    {overlayIconsLoaded && !overlayIconAvailability['cylinder-icon'] && (
                      <Layer
                        id="cylinder-installs-fallback-layer"
                        type="symbol"
                        minzoom={getOverlayMarkerMinZoom('cylinderInstalls')}
                        layout={{
                          'text-field': '●',
                          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                          'text-size': getOverlaySizes('cylinderInstalls').fallbackTextSize,
                          'text-allow-overlap': true,
                          'text-ignore-placement': true,
                        }}
                        paint={{
                          'text-color': '#FF6B00',
                          'text-halo-color': '#ffffff',
                          'text-halo-width': 2,
                        }}
                      />
                    )}

                    <Layer
                      id="cylinder-installs-labels"
                      type="symbol"
                      minzoom={getOverlayLabelMinZoom('cylinderInstalls') ?? 16}
                      layout={{
                        'text-field': [
                          'concat',
                          ['coalesce', ['to-string', ['get', 'install_date']], ''],
                          ' @ ',
                          ['coalesce', ['to-string', ['get', 'pressure']], ''],
                          ' ',
                          [
                            'case',
                            ['==', ['get', 'pressure_unit_system'], 'imperial'],
                            'PSI',
                            'BAR',
                          ],
                        ],
                        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                        'text-size': getOverlaySizes('cylinderInstalls').labelTextSize,
                        'text-offset': [0, 1.5],
                        'text-anchor': 'top',
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                      }}
                      paint={{
                        'text-color': '#000000',
                        'text-halo-color': '#ffffff',
                        'text-halo-width': 1.5,
                      }}
                    />
                  </Source>
                )}

                {userLocation && (
                  <Source
                    id="user-location-source"
                    type="geojson"
                    data={{
                      type: 'FeatureCollection',
                      features: [{
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] },
                        properties: {},
                      }],
                    }}
                  >
                    <Layer
                      id="user-location-dot"
                      type="circle"
                      paint={{
                        'circle-radius': 8,
                        'circle-color': '#4285F4',
                        'circle-stroke-width': 3,
                        'circle-stroke-color': '#ffffff',
                        'circle-opacity': 0.9,
                      }}
                    />
                  </Source>
                )}
              </Map>
            )}

            <div
              className="absolute bottom-2 left-2 z-10"
            >
              <DistanceScale
                zoom={mapViewMetrics.zoom}
                latitude={mapViewMetrics.latitude}
                measurementUnit={measurementUnit}
              />
            </div>

            {colorMode === 'depth' && (
              <div
                className="absolute right-3 z-10"
                style={{ top: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 64px)' }}
              >
                <DepthGauge
                  depthDomain={depthDomain}
                  currentDepth={probedDepth}
                  measurementUnit={measurementUnit}
                />
              </div>
            )}

          </div>

          {/* ---- My Location FAB ---- */}
          <button
            onClick={handleGoToMyLocation}
            disabled={isLocating}
            className="absolute right-3 z-10 w-11 h-11 flex items-center justify-center
                       rounded-full bg-slate-900/80 backdrop-blur-sm border border-slate-600/60
                       text-slate-200 hover:bg-slate-800/90 disabled:opacity-50
                       transition-colors shadow-lg shadow-black/40"
            style={{ top: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 12px)' }}
            aria-label="Go to my location"
            data-testid="my-location-button"
          >
            {isLocating ? (
              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 2v2m0 16v2m10-10h-2M4 12H2" />
              </svg>
            )}
          </button>

          {/* ---- Map Layer switcher (under My Location FAB) ---- */}
          <div
            className="absolute right-3 z-10"
            style={{ top: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 64px)' }}
          >
            <MapLayerControl
              layers={MAP_LAYERS}
              selectedLayerId={selectedMapLayerId}
              isOfflineLocked={isOfflineLocked}
              layerOfflineSync={layerOfflineSync}
              onSelectLayer={handleSelectMapLayer}
            />
          </div>

          {/* ---- Project panel ---- */}
          <ProjectPanel
            projects={panelProjects}
            activeProjectIds={panelActiveProjectIds}
            geoJsonData={geoJsonData}
            projectColorsById={projectColorsById}
            tilePrefetchByProject={tilePrefetchByProject}
            countryVisibility={countryVisibility}
            countryCollapsed={countryCollapsed}
            onToggleProject={handleToggleProject}
            onZoomToProject={handleZoomToProject}
            onShowAll={handleShowAll}
            onHideAll={handleHideAll}
            onToggleCountry={handleToggleCountry}
            onToggleCountryCollapsed={handleToggleCountryCollapsed}
            onClose={() => onProjectPanelChange(false)}
            isOpen={isProjectPanelOpen}
          />

          {/* ---- Landmark panel ---- */}
          <LandmarkPanel
            groups={landmarkCollectionGroups}
            collectionVisibility={landmarkCollectionVisibility}
            collectionCollapsed={landmarkCollectionCollapsed}
            onToggleCollection={handleToggleLandmarkCollection}
            onToggleCollectionCollapsed={handleToggleLandmarkCollectionCollapsed}
            onLocateLandmark={handleLocateLandmark}
            onShowAll={handleLandmarkShowAll}
            onHideAll={handleLandmarkHideAll}
            onClose={() => onLandmarkPanelChange(false)}
            isOpen={isLandmarkPanelOpen}
          />

          <OverlayMarkerDetailsModal
            detail={selectedOverlayMarkerDetail}
            onClose={handleDismissOverlayMarkerDetailsModal}
            onCreateLandmark={handleOpenCreateLandmark}
            onEditLandmark={handleOpenEditLandmark}
            onDeleteLandmark={handleOpenDeleteLandmark}
          />

          {landmarkForm && (
            <LandmarkFormModal
              isOpen
              mode={landmarkForm.mode}
              initialValues={landmarkForm.initialValues}
              collections={landmarkCollections}
              busy={landmarkFormBusy}
              submitError={landmarkFormError}
              onSubmit={handleSubmitLandmarkForm}
              onCancel={handleCancelLandmarkForm}
            />
          )}

          <ConfirmDialog
            isOpen={landmarkDeleteTarget !== null}
            title="Delete Landmark"
            message={
              <>
                Are you sure you want to delete{' '}
                <span className="font-semibold text-slate-100">
                  {landmarkDeleteTarget && landmarkDeleteTarget.name !== 'N/A'
                    ? landmarkDeleteTarget.name
                    : 'this landmark'}
                </span>
                ?
              </>
            }
            warning="This action cannot be undone."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            busy={landmarkDeleteBusy}
            busyLabel={'Deleting\u2026'}
            onConfirm={handleConfirmDeleteLandmark}
            onCancel={handleCancelDeleteLandmark}
            testId="delete-landmark-confirm"
          />

          {landmarkToast && (
            <div
              data-testid="landmark-toast"
              className={`fixed left-1/2 -translate-x-1/2 bottom-24 z-[10000] px-4 py-2 rounded-lg text-sm text-white shadow-lg ${
                landmarkToast.tone === 'success' ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            >
              {landmarkToast.message}
            </div>
          )}

          {longPressRing && (
            <LongPressRing
              x={longPressRing.x}
              y={longPressRing.y}
              durationMs={MAP.LONG_PRESS_DURATION_MS}
              sizePx={MAP.LONG_PRESS_RING_SIZE_PX}
              strokePx={MAP.LONG_PRESS_RING_STROKE_PX}
            />
          )}

          <GeolocationErrorModal error={geoError} onDismiss={() => setGeoError(null)} />

          {/* ---- Loading state when style not yet loaded ---- */}
          {!mapStyle && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading map…</span>
              </div>
            </div>
          )}
          </div>
          <AppTabBar
            isProjectPanelOpen={isProjectPanelOpen}
            onProjectPanelChange={onProjectPanelChange}
            isLandmarkPanelOpen={isLandmarkPanelOpen}
            onLandmarkPanelChange={onLandmarkPanelChange}
          />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
