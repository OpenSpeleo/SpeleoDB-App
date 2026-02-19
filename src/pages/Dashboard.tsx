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
  IonRefresher,
  IonRefresherContent,
  IonModal,
} from '@ionic/react';
import Map, { Layer, Source } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';

import { useSpeleoDB } from '../context/SpeleoDBProvider';
import { MAP, MAP_OVERLAYS } from '../constants';
import type { MapOverlayGeoJsonRecord, MapOverlayId } from '../types/mapOverlay';
import { registerTileCacheProtocol, getCachedStyle } from '../services/TileCacheService';
import {
  getProjectVisibilityPreferences,
  setProjectVisibilityPreference,
  setProjectVisibilityPreferences,
} from '../services/PreferencesService';
import ProjectPanel from '../components/ProjectPanel';
import OverlayMarkerDetailsModal from '../components/OverlayMarkerDetailsModal';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { createProjectColorState, getProjectColor } from '../utils/projectColors';
import { restartGuidedTourFromHelp } from '../onboarding/guidedTour/engine';
import { TOUR_EVENTS } from '../onboarding/guidedTour/selectors';
import {
  INTERACTIVE_OVERLAY_LAYER_IDS,
  parseOverlayMarkerDetails,
} from '../utils/overlayMarkerDetails';
import type {
  InteractiveOverlayFeature,
  OverlayMarkerDetails,
} from '../utils/overlayMarkerDetails';
import artifactIcon from '../assets/media/map-icons/artifact-icon.png';
import boneIcon from '../assets/media/map-icons/bones-icon.png';
import biologyIcon from '../assets/media/map-icons/fish-icon.png';
import geologyIcon from '../assets/media/map-icons/rock-icon.png';
import explorationLeadIcon from '../assets/media/map-icons/exploration-lead-icon.png';
import cylinderIcon from '../assets/media/map-icons/cylinder-orange-icon.png';

// ==================== GeoJSON type alias ====================

type GeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;
type IonRefreshEvent = CustomEvent<{ complete: () => void }>;
type OverlayIconId =
  | 'biology-station-icon'
  | 'bone-station-icon'
  | 'artifact-station-icon'
  | 'geology-station-icon'
  | 'exploration-lead-icon'
  | 'cylinder-icon';

type OverlayIconAvailability = Record<OverlayIconId, boolean>;

type ProjectLinkedOverlayId = 'subsurfaceStations' | 'explorationLeads' | 'cylinderInstalls';

const REFRESH_SETTLE_MIN_DELAY_MS = 700;
const REFRESH_SETTLE_MAX_DELAY_MS = 2400;
const REFRESH_SETTLE_POLL_INTERVAL_MS = 80;
const REFRESH_SETTLE_REQUIRED_STABLE_SAMPLES = 4;
const REFRESH_SETTLE_POSITION_EPSILON_PX = 0.75;
const MAP_MARKER_HIT_RADIUS_PX_TOUCH = 26;
const MAP_TOUCH_TAP_MAX_MOVEMENT_PX = 12;
const MAP_TOUCH_TAP_MAX_DURATION_MS = 550;
const REFRESH_ACTIVE_CLASS_HINTS = [
  'refresher-active',
  'refresher-refreshing',
  'refresher-pulling',
  'refresher-ready',
];

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
): OverlayMarkerDetails | null {
  for (const layerId of INTERACTIVE_OVERLAY_LAYER_IDS) {
    const feature = features.find((candidate) => candidate.layer?.id === layerId);
    if (!feature) {
      continue;
    }
    const details = parseOverlayMarkerDetails(feature);
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

function isRefresherStillAnimating(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const className = target.className;
  if (typeof className !== 'string') return false;
  return REFRESH_ACTIVE_CLASS_HINTS.some((hint) => className.includes(hint));
}

function getDashboardVerticalPosition(): number {
  const mapContainer = document.querySelector('.dashboard-map-container');
  if (mapContainer instanceof HTMLElement) {
    return mapContainer.getBoundingClientRect().top;
  }

  const content = document.querySelector('ion-content');
  if (content instanceof HTMLElement) {
    return content.getBoundingClientRect().top;
  }

  return window.scrollY;
}

// ==================== Register tile caching protocol once ====================

registerTileCacheProtocol();

// ==================== Component ====================

const Dashboard: React.FC = () => {
  const history = useHistory();
  const { controller, projects, syncStatus, tilePrefetchJobs, isOfflineLocked } = useSpeleoDB();
  const didSyncRef = useRef(false);
  const didFitRef = useRef(false);
  const mapRef = useRef<MapRef>(null);
  const mapPointerTapCandidateRef = useRef<MapPointerTapCandidate | null>(null);

  // Panel state
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMapGestureActive, setIsMapGestureActive] = useState(false);
  const [isPanelGestureActive, setIsPanelGestureActive] = useState(false);
  const [isInitialSyncSettled, setIsInitialSyncSettled] = useState(false);
  const [selectedOverlayMarkerDetail, setSelectedOverlayMarkerDetail] =
    useState<OverlayMarkerDetails | null>(null);

  // Active projects (which layers are visible)
  const [activeProjectIds, setActiveProjectIds] = useState<Set<string>>(new Set());

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
    getCachedStyle(MAP.STYLE_URL)
      .then(setMapStyle)
      .catch((err) => console.error('Failed to load map style:', err));
  }, []);

  // ---- Sync projects on mount -----------------------------------------------

  useEffect(() => {
    if (!didSyncRef.current) {
      didSyncRef.current = true;
      let cancelled = false;
      controller.syncProjects()
        .then(() => {
          if (cancelled) return;
          setLoadTrigger((n) => n + 1);
        })
        .finally(() => {
          if (!cancelled) {
            setIsInitialSyncSettled(true);
          }
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
  const tilePrefetchByProject = useMemo(
    () =>
      Object.fromEntries(
        tilePrefetchJobs.map((job) => [job.projectId, job] as const),
      ),
    [tilePrefetchJobs],
  );
  const tilePrefetchSummary = useMemo(() => {
    if (tilePrefetchJobs.length === 0) return null;
    const activeJobs = tilePrefetchJobs.filter(
      (job) => job.status === 'queued' || job.status === 'downloading' || job.status === 'paused',
    );
    if (activeJobs.length === 0) return null;

    const totalTiles = activeJobs.reduce((sum, job) => sum + job.totalTiles, 0);
    const doneTiles = activeJobs.reduce(
      (sum, job) => sum + job.completedTiles + job.failedTiles,
      0,
    );
    const pct = totalTiles > 0 ? Math.floor((doneTiles / totalTiles) * 100) : 0;
    return `${pct}% offline maps`;
  }, [tilePrefetchJobs]);

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
    if (geoJsonProjects.length === 0) {
      setGeoJsonData({});
      return;
    }

    let stale = false;

    (async () => {
      const newData: GeoJsonRecord = {};

      for (const project of geoJsonProjects) {
        try {
          const raw = await controller.getProjectGeoJSON(project.id);
          if (stale) return;

          const fc = normalizeGeoJSON(raw);
          if (fc && fc.features.length > 0) {
            newData[project.id] = fc;
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
            nextData[overlay.id] = normalizeOverlayGeoJSON(overlay.id, featureCollection);
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
  }, [controller, loadTrigger]);

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
        activeProjectIds,
      );
      if (filtered.features.length > 0) {
        nextData[overlay.id] = filtered;
      }
    }
    return nextData;
  }, [activeProjectIds, overlayGeoJsonData]);

  // ---- Auto-fit bounds on first data load -----------------------------------

  useEffect(() => {
    if (didFitRef.current) return;
    if (activeProjectIds.size === 0 || Object.keys(geoJsonData).length === 0) return;

    const bounds = computeBounds(geoJsonData, activeProjectIds);
    if (bounds && mapRef.current) {
      didFitRef.current = true;
      mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 800 });
    }
  }, [activeProjectIds, geoJsonData]);

  // ---- Handlers -------------------------------------------------------------

  const handleRefresh = useCallback(async (event: IonRefreshEvent) => {
    const completeRefreshForTour = () => {
      event.detail.complete();
      const startedAt = Date.now();
      let stableSampleCount = 0;
      let previousVerticalPosition = getDashboardVerticalPosition();

      const tryDispatchWhenStable = () => {
        const elapsed = Date.now() - startedAt;
        const minDelayReached = elapsed >= REFRESH_SETTLE_MIN_DELAY_MS;
        const maxDelayReached = elapsed >= REFRESH_SETTLE_MAX_DELAY_MS;
        const isAnimating = isRefresherStillAnimating(event.target);
        const currentVerticalPosition = getDashboardVerticalPosition();
        const verticalDelta = Math.abs(currentVerticalPosition - previousVerticalPosition);
        const isPositionStable = verticalDelta <= REFRESH_SETTLE_POSITION_EPSILON_PX;
        previousVerticalPosition = currentVerticalPosition;

        if (minDelayReached && !isAnimating && isPositionStable) {
          stableSampleCount += 1;
        } else {
          stableSampleCount = 0;
        }

        if (
          maxDelayReached ||
          stableSampleCount >= REFRESH_SETTLE_REQUIRED_STABLE_SAMPLES
        ) {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              document.dispatchEvent(new CustomEvent(TOUR_EVENTS.refreshComplete));
            });
          });
          return;
        }

        window.setTimeout(tryDispatchWhenStable, REFRESH_SETTLE_POLL_INTERVAL_MS);
      };

      tryDispatchWhenStable();
    };

    didFitRef.current = false;
    if (isOfflineLocked) {
      const result = await controller.retryConnection();
      if (result === 'unauthorized') {
        history.replace('/');
        completeRefreshForTour();
        return;
      }
      if (result !== 'ok') {
        completeRefreshForTour();
        return;
      }
    }
    await controller.syncProjects();
    setLoadTrigger((n) => n + 1);
    completeRefreshForTour();
  }, [controller, history, isOfflineLocked]);

  const openOverlayMarkerDetailsAtMapPoint = useCallback((
    point: { x: number; y: number },
    hitRadiusPx: number,
  ) => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.queryRenderedFeatures || !map.getLayer) {
      return;
    }

    // Filter to only layers that currently exist on the map to avoid
    // maplibre-gl throwing on non-existent layer IDs (icon-layer and
    // fallback-layer are conditionally rendered, never both present).
    const existingLayers = INTERACTIVE_OVERLAY_LAYER_IDS.filter(
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

    const details = getClickedOverlayMarkerDetails(features);
    if (!details) {
      return;
    }

    setSelectedOverlayMarkerDetail(details);
  }, []);

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

  const handleMapGestureStart = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    setIsMapGestureActive(true);

    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      mapPointerTapCandidateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startedAtMs: Date.now(),
        moved: false,
        pointerType: event.pointerType,
      };
    } else {
      mapPointerTapCandidateRef.current = null;
    }
  }, []);

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
    }
  }, []);

  const handleMapGestureEnd = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    setIsMapGestureActive(false);

    const candidate = mapPointerTapCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) {
      return;
    }

    mapPointerTapCandidateRef.current = null;

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
  }, [openOverlayMarkerDetailsAtClientPoint]);

  const handlePanelGestureStart = useCallback(() => {
    setIsPanelGestureActive(true);
  }, []);

  const handlePanelGestureMove = useCallback(() => {
    setIsPanelGestureActive(true);
  }, []);

  const handlePanelGestureEnd = useCallback(() => {
    setIsPanelGestureActive(false);
  }, []);

  const handleLogout = useCallback(async () => {
    setShowLogoutConfirmModal(true);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await controller.logout();
      setShowLogoutConfirmModal(false);
      history.push('/');
    } finally {
      setIsLoggingOut(false);
    }
  }, [controller, history, isLoggingOut]);

  const handleToggleProject = useCallback((projectId: string) => {
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
  }, [panelProjects]);

  const handleHideAll = useCallback(() => {
    const nextIds = panelProjects.map((p) => p.id);
    setProjectVisibilityPreferences(
      Object.fromEntries(nextIds.map((projectId) => [projectId, false] as const)),
    );
    setActiveProjectIds(new Set());
  }, [panelProjects]);

  const handleZoomToProject = useCallback((projectId: string) => {
    const emitZoomComplete = () => {
      document.dispatchEvent(
        new CustomEvent(TOUR_EVENTS.projectZoomComplete, {
          detail: { projectId },
        }),
      );
    };

    // Step 0: Ensure the project layer is visible on the map
    setActiveProjectIds((prev) => {
      if (prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    setProjectVisibilityPreference(projectId, true);

    // Step 1: Close the panel so the map is unobstructed before animating
    setIsPanelOpen(false);

    // Step 2: Zoom to this project's bounds — read geoJsonData from the
    // latest state via a functional update trick: we schedule the zoom after
    // React processes the activation above.
    setTimeout(() => {
      // Access the ref-stable map and read geoJsonData at call time
      const map = mapRef.current;
      if (!map) {
        emitZoomComplete();
        return;
      }

      // Get the source data directly from the map if available
      setGeoJsonData((current) => {
        const fc = current[projectId];
        if (fc) {
          const bounds = computeBounds(current, new Set([projectId]));
          if (bounds) {
            let didEmitZoomComplete = false;
            const emitZoomCompleteOnce = () => {
              if (didEmitZoomComplete) return;
              didEmitZoomComplete = true;
              emitZoomComplete();
            };
            const mapInstance = map.getMap() as
              | { once?: (eventName: 'moveend', listener: () => void) => void }
              | undefined;
            mapInstance?.once?.('moveend', emitZoomCompleteOnce);
            map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
            window.setTimeout(emitZoomCompleteOnce, 1200);
            return current; // no change
          }
        }
        emitZoomComplete();
        return current; // no change
      });
    }, 0);
  }, []);

  const handleMapLoad = useCallback(() => {
    lockMapOrientation(mapRef.current);
    void loadOverlayIcons();
  }, [loadOverlayIcons]);

  const handleRestartGuidedTour = useCallback(() => {
    void restartGuidedTourFromHelp();
  }, []);

  const handleDismissOverlayMarkerDetailsModal = useCallback(() => {
    setSelectedOverlayMarkerDetail(null);
  }, []);

  useEffect(() => {
    if (!isPanelOpen) {
      setIsPanelGestureActive(false);
    }
  }, [isPanelOpen]);

  // ---- Render ---------------------------------------------------------------

  if (!controller.isAuthenticated()) return null;

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding" scrollY={false}>
        <IonRefresher
          className="dashboard-refresher"
          disabled={isMapGestureActive || isPanelGestureActive}
          slot="fixed"
          onIonRefresh={handleRefresh}
          pullFactor={0.5}
          pullMin={60}
          pullMax={200}
        >
          <IonRefresherContent
            pullingIcon="arrow-down-outline"
            pullingText="Pull down to refresh"
            refreshingSpinner="crescent"
            refreshingText="Syncing projects…"
          />
        </IonRefresher>

        <div className="relative w-full h-full dashboard-map-container" style={{ height: '100dvh' }}>
          <div
            className="w-full h-full dashboard-map-touch-surface"
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

                {/* GeoJSON layers for each active project */}
                {sortedProjects.map((project) => {
                  if (!activeProjectIds.has(project.id) || !geoJsonData[project.id]) {
                    return null;
                  }
                  const color = getProjectColor(project.id, projectColorsById);
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
                          'fill-color': color,
                          'fill-opacity': 0.25,
                        }}
                      />

                      {/* Lines + polygon outlines */}
                      <Layer
                        id={`${sourceId}-line`}
                        type="line"
                        beforeId={PROJECT_LAYER_ORDER_ANCHOR_LAYER_ID}
                        minzoom={MAP.PROJECT_LAYER_ZOOMS.LINE_MIN}
                        filter={[
                          'match',
                          ['geometry-type'],
                          ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
                          true,
                          false,
                        ]}
                        paint={{
                          'line-color': color,
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
                        minzoom={MAP.PROJECT_LAYER_ZOOMS.ENTRY_SYMBOL_MIN}
                        layout={{
                          'text-field': '★',
                          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 18, 14, 24],
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

                {visibleOverlayGeoJsonData.landmarks && (
                  <Source
                    id="landmarks-source"
                    type="geojson"
                    data={visibleOverlayGeoJsonData.landmarks}
                  >
                    <Layer
                      id="landmarks-layer"
                      type="symbol"
                      minzoom={getOverlayMarkerMinZoom('landmarks')}
                      layout={{
                        'text-field': '▼',
                        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 14, 14, 20, 18, 28],
                        'text-allow-overlap': true,
                        'text-ignore-placement': true,
                      }}
                      paint={{
                        'text-color': '#3b82f6',
                        'text-halo-color': '#ffffff',
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
                        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12, 18, 14],
                        'text-anchor': 'top',
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                      }}
                      paint={{
                        'text-color': '#3b82f6',
                        'text-halo-color': '#ffffff',
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
                        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 16, 18, 24],
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
                        'text-size': 12,
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
                        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 5, 18, 8],
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
                          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 1.0],
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
                          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 1.0],
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
                          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 1.0],
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
                          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 1.0],
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
                        'text-size': 12,
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
                          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 18, 0.6],
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
                          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 8, 18, 12],
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
                          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 1.2],
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
                          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 18, 18, 26],
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
                        'text-size': 11,
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
              </Map>
            )}
          </div>

          {/* ---- Floating header ---- */}
          <div
            data-tour="header"
            data-tour-sync-ready={isInitialSyncSettled ? 'true' : 'false'}
            className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between
                        px-3 py-2 bg-slate-900/70 backdrop-blur-sm border-b border-slate-700/30"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
          >
            {/* Menu toggle */}
            <button
              onClick={() => setIsPanelOpen(true)}
              data-tour="menu-toggle"
              className="w-10 h-10 flex items-center justify-center rounded-xl
                         bg-slate-800/60 text-slate-200 border-2 border-solid 
                         border-slate-500/70 hover:bg-slate-700/60 transition-colors"
              aria-label="Open project panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Sync status */}
            <div className="flex items-center gap-2">
              {syncStatus === 'syncing' && (
                <span
                  data-tour="header-sync-status"
                  className="flex items-center gap-1.5 text-xs text-slate-300"
                >
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  Syncing…
                </span>
              )}
              {tilePrefetchSummary && (
                <span className="text-xs text-emerald-300">{tilePrefetchSummary}</span>
              )}
              {panelProjects.length > 0 && (
                <span data-tour="header-project-count" className="text-xs text-slate-400">
                  {panelProjects.length} project{panelProjects.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Logout */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleRestartGuidedTour}
                className="w-10 h-10 text-sm font-bold text-slate-100 hover:text-white
                           rounded-xl border border-slate-100/70 bg-slate-700/70
                           hover:bg-slate-600/80 transition-colors shadow-sm shadow-black/30"
                aria-label="Start guided tour"
                title="Start guided tour"
              >
                ?
              </button>
              <button
                onClick={handleLogout}
                className="px-3 py-2 h-10 text-xs font-medium text-slate-300 hover:text-white
                           rounded-xl border-2 border-solid border-slate-500/70 bg-slate-800/60
                           hover:bg-slate-700/60 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* ---- Project panel ---- */}
          <ProjectPanel
            projects={panelProjects}
            activeProjectIds={panelActiveProjectIds}
            geoJsonData={geoJsonData}
            projectColorsById={projectColorsById}
            tilePrefetchByProject={tilePrefetchByProject}
            onToggleProject={handleToggleProject}
            onZoomToProject={handleZoomToProject}
            onShowAll={handleShowAll}
            onHideAll={handleHideAll}
            onClose={() => setIsPanelOpen(false)}
            onGestureStart={handlePanelGestureStart}
            onGestureMove={handlePanelGestureMove}
            onGestureEnd={handlePanelGestureEnd}
            isOpen={isPanelOpen}
          />

          <OverlayMarkerDetailsModal
            detail={selectedOverlayMarkerDetail}
            onClose={handleDismissOverlayMarkerDetailsModal}
          />

          <IonModal
            isOpen={showLogoutConfirmModal}
            onDidDismiss={() => setShowLogoutConfirmModal(false)}
            canDismiss={!isLoggingOut}
            backdropDismiss={!isLoggingOut}
          >
            <IonContent className="ion-padding">
              <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
                <div className="mb-6">
                  <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/20 text-red-300 mb-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.33 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </span>
                  <h2 className="text-xl font-semibold text-slate-100 mb-2">Clear local data and sign out?</h2>
                  <p className="text-slate-300 text-sm mb-2">
                    All local data will be cleared immediately from this device.
                  </p>
                  <p className="text-slate-400 text-sm">
                    This includes cached maps, GeoJSON, projects, and offline credentials. You will not be able to reconnect without network access.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    disabled={isLoggingOut}
                    onClick={() => setShowLogoutConfirmModal(false)}
                    className="px-4 py-3 rounded-xl bg-slate-800/70 text-slate-200 hover:bg-slate-700/70 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isLoggingOut}
                    onClick={handleConfirmLogout}
                    className="px-4 py-3 rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                  >
                    {isLoggingOut ? 'Clearing data…' : 'Wipe local data & Sign Out'}
                  </button>
                </div>
              </div>
            </IonContent>
          </IonModal>

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
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
