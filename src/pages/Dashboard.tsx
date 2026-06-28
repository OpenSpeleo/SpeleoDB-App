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
  IonModal,
} from '@ionic/react';
import Map from 'react-map-gl/maplibre';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { useSpeleoDB } from '../context/useSpeleoDB';
import { DEFAULT_MAP_LAYER_ID, MAP, MAP_LAYERS, MAP_OVERLAYS } from '../constants';
import type { MapOverlayGeoJsonRecord } from '../types/mapOverlay';
import type { MapLayerId } from '../types/mapLayer';
import type { ProjectGeoJSONBounds } from '../types/projectGeoJSON';
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
  getGpsTrackVisibilityPreferences,
  getLandmarkCollectionVisibilityPreferences,
  setGpsTrackVisibilityPreference,
  setLandmarkCollectionVisibilityPreference,
  setLandmarkCollectionVisibilityPreferences,
  getLandmarkCollectionCollapsedPreferences,
  setLandmarkCollectionCollapsedPreference,
} from '../services/PreferencesService';
import ProjectPanel from '../components/ProjectPanel';
import LandmarkPanel from '../components/LandmarkPanel';
import GpsPanel from '../components/GpsPanel';
import GpsRecordingScreen from '../components/GpsRecordingScreen';
import { BatteryOptimizationGuard } from '../services/BatteryOptimizationGuard';
import GpsAveragingModal, { type GpsAveragingPhase } from '../components/GpsAveragingModal';
import AppTabBar from '../components/AppTabBar';
import { useGpsAveraging } from '../hooks/useGpsAveraging';
import { GpxFileService } from '../services/GpxFileService';
import { errorToLogDetails } from '../utils/errorDiagnostics';
import type { GpsTrackListItem, RecordedPoint } from '../types/gpsTrack';
import { TRACK_COLOR_PALETTE, readableInkColor } from '../utils/gpsTrackColors';
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
import { createProjectColorState } from '../utils/projectColors';
import { trackPointsToFeatureCollection, trackPointsToLineStringFeature } from '../utils/gpsTrackGeoJson';
import type { MapColorMode } from '../types/mapColorMode';
import type { MeasurementUnit } from '../types/measurementUnit';
import {
  DEPTH_PROPERTY_KEY,
  attachDepthToFeatureCollection,
} from '../utils/depthColoring';
import { useDepthProbe } from '../hooks/useDepthProbe';
import {
  INTERACTIVE_OVERLAY_LAYER_IDS,
  formatLatLng,
} from '../utils/overlayMarkerDetails';
import type {
  InteractiveOverlayFeature,
  LandmarkDetails,
  MapLongPressDetails,
  MarkerParseContext,
  OverlayMarkerDetails,
} from '../utils/overlayMarkerDetails';
import {
  MAP_MARKER_HIT_RADIUS_PX_TOUCH,
  MAP_TOUCH_TAP_MAX_DURATION_MS,
  MAP_TOUCH_TAP_MAX_MOVEMENT_PX,
  DEFAULT_OVERLAY_ICON_AVAILABILITY,
  LONG_PRESS_BLOCKING_STATIC_LAYER_IDS,
  OVERLAY_ICON_SOURCES,
  boundsFromPoints,
  computeBounds,
  filterOverlayByProjectVisibility,
  getClickedOverlayMarkerDetails,
  getMarkerHitQueryBounds,
  loadMapImage,
  lockMapOrientation,
  normalizeOverlayGeoJSON,
  type MapPointerTapCandidate,
  type OverlayFeatureQueryMap,
  type OverlayImageMap,
  type OverlayIconAvailability,
  type OverlayIconId,
  type ProjectBoundsRecord,
} from './dashboard/dashboardMapUtils';
import { ProjectMapLayers } from './dashboard/ProjectMapLayers';
import { OverlayMapLayers } from './dashboard/OverlayMapLayers';
import { GpsMapLayers } from './dashboard/GpsMapLayers';

// ==================== GeoJSON type alias ====================

type GeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;
interface LoadedProjectMapData {
  commitId: string;
  featureCollection: GeoJSON.FeatureCollection;
  bounds: ProjectGeoJSONBounds;
}
type ProjectMapDataRecord = Record<string, LoadedProjectMapData>;

// ==================== Register tile caching protocol once ====================

registerTileCacheProtocol();

// ==================== Component ====================

interface DashboardProps {
  isProjectPanelOpen: boolean;
  onProjectPanelChange: (open: boolean) => void;
  isLandmarkPanelOpen: boolean;
  onLandmarkPanelChange: (open: boolean) => void;
  isGpsPanelOpen: boolean;
  onGpsPanelChange: (open: boolean) => void;
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
  isGpsPanelOpen,
  onGpsPanelChange,
  showLandmarks,
  colorMode,
  measurementUnit,
  selectedMapLayerId,
  onSelectedMapLayerIdChange,
  layerOfflineSync,
}) => {
  const history = useHistory();
  const {
    controller,
    projects,
    tilePrefetchJobs,
    isOfflineLocked,
    landmarksRevision,
    mapDataRevision,
    pendingOpsCount,
    gpsTracks,
    gpsRecordingState,
    gpsRecordingElapsedMs,
    gpsRecordingElapsedUpdatedAt,
    gpsTracksRevision,
  } = useSpeleoDB();
  const didSyncRef = useRef(false);
  const didFitRef = useRef(false);
  const knownVisibilityProjectIdsRef = useRef<Set<string>>(new Set());
  const mapRef = useRef<MapRef>(null);
  const mapPointerTapCandidateRef = useRef<MapPointerTapCandidate | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ---- GPS state ------------------------------------------------------------
  // The dedicated full-screen recording screen (own page with a back button).
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [isAveragingOpen, setIsAveragingOpen] = useState(false);
  // Stopwatch-style session: idle (held) -> running -> stopped (paused, data
  // retained) -> running (resume/continue). Reset is the only thing that zeroes
  // (it bumps the nonce, which clears the hook's samples).
  const [averagingPhase, setAveragingPhase] = useState<GpsAveragingPhase>('idle');
  const [averagingNonce, setAveragingNonce] = useState(0);
  const [showAveragingResetConfirm, setShowAveragingResetConfirm] = useState(false);
  // Confirm before abandoning an in-progress recording via the Cancel button.
  const [showRecordingCancelConfirm, setShowRecordingCancelConfirm] = useState(false);
  // Edit (name + color) modal for a unified track. Replaces the old rename modal.
  const [editTarget, setEditTarget] = useState<GpsTrackListItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<GpsTrackListItem | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GpsTrackListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Per-track map visibility (default OFF) + lazily-loaded geometry for display.
  const [gpsTrackVisibility, setGpsTrackVisibility] = useState<Record<string, boolean>>(
    () => getGpsTrackVisibilityPreferences(),
  );
  const [gpsTrackPoints, setGpsTrackPoints] = useState<Record<string, RecordedPoint[]>>({});
  const [loadingTrackIds, setLoadingTrackIds] = useState<Set<string>>(() => new Set<string>());
  // Android-only nudge to exempt the app from battery optimization so OEM power
  // managers don't kill the recording service. Dismissal is per-session.
  const [showBatteryHint, setShowBatteryHint] = useState(false);
  const batteryHintDismissedRef = useRef(false);
  const batteryGuard = useMemo(() => new BatteryOptimizationGuard(), []);
  const gpxFileService = useMemo(() => new GpxFileService(), []);
  const averaging = useGpsAveraging(isAveragingOpen && averagingPhase === 'running', {
    restartNonce: averagingNonce,
  });

  // The live recording buffer lives on the controller; re-read it whenever the
  // GPS revision bumps (a new fix appended bumps it).
  const currentTrackPoints = useMemo(
    () => controller.currentTrackPoints,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, gpsTracksRevision],
  );
  const currentTrackFeatureCollection = useMemo(
    () => trackPointsToFeatureCollection(currentTrackPoints, { name: 'Current GPS recording' }),
    [currentTrackPoints],
  );
  // Saved/server tracks the user has toggled on: one dotted, data-driven-color
  // line per track. Geometry is loaded lazily into `gpsTrackPoints`.
  const savedTrackFeatureCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = gpsTracks.flatMap((track) => {
      if (gpsTrackVisibility[track.id] !== true) return [];
      const points = gpsTrackPoints[track.id];
      if (!points || points.length < 2) return [];
      const feature = trackPointsToLineStringFeature(points, {
        id: track.id,
        name: track.name,
        color: track.color,
      });
      return feature ? [feature as GeoJSON.Feature] : [];
    });
    return { type: 'FeatureCollection', features };
  }, [gpsTracks, gpsTrackVisibility, gpsTrackPoints]);
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

  // Loaded, commit-identified project map artifacts. Consumers derive their
  // GeoJSON and bounds from the same atomic record so commits cannot mix.
  const [projectMapData, setProjectMapData] = useState<ProjectMapDataRecord>({});
  const [overlayGeoJsonData, setOverlayGeoJsonData] = useState<MapOverlayGeoJsonRecord>({});
  const [overlayIconAvailability, setOverlayIconAvailability] = useState<OverlayIconAvailability>(
    DEFAULT_OVERLAY_ICON_AVAILABILITY,
  );
  const [overlayIconsLoaded, setOverlayIconsLoaded] = useState(false);

  // Map style (loaded from cache/network)
  const [mapStyle, setMapStyle] = useState<Record<string, unknown> | null>(null);

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
      void controller.syncProjects();
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
  useEffect(() => {
    const currentIds = new Set(geoJsonProjects.map((project) => project.id));
    const preferences = getProjectVisibilityPreferences();
    setActiveProjectIds((previous) => {
      const next = new Set([...previous].filter((id) => currentIds.has(id)));
      for (const project of geoJsonProjects) {
        if (
          !knownVisibilityProjectIdsRef.current.has(project.id)
          && preferences[project.id] !== false
        ) {
          next.add(project.id);
        }
      }
      return next;
    });
    knownVisibilityProjectIdsRef.current = currentIds;
  }, [geoJsonProjects]);
  const currentProjectMapData = useMemo<ProjectMapDataRecord>(() => {
    const next: ProjectMapDataRecord = {};
    for (const project of geoJsonProjects) {
      const loaded = projectMapData[project.id];
      if (loaded?.commitId === project.latest_commit.id) next[project.id] = loaded;
    }
    return next;
  }, [geoJsonProjects, projectMapData]);
  const geoJsonData = useMemo<GeoJsonRecord>(() => Object.fromEntries(
    Object.entries(currentProjectMapData).map(([id, data]) => [id, data.featureCollection]),
  ), [currentProjectMapData]);
  const projectBounds = useMemo<ProjectBoundsRecord>(() => Object.fromEntries(
    Object.entries(currentProjectMapData).map(([id, data]) => [id, data.bounds]),
  ), [currentProjectMapData]);
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
      if (!geoJsonData[project.id]) continue;
      const country = project.country || 'Unknown';
      if (countryVisibility[country] === false) continue;
      next.add(project.id);
    }
    return next;
  }, [sortedProjects, activeProjectIds, countryVisibility, geoJsonData]);
  // Project panel progress reflects the satellite layer only (extra layers have
  // their own per-layer progress in Settings).
  const tilePrefetchByProject = useMemo(
    () =>
      Object.fromEntries(
        tilePrefetchJobs
          .filter((job) =>
            job.layerId === DEFAULT_MAP_LAYER_ID
            && Boolean(currentProjectMapData[job.projectId]))
          .map((job) => [job.projectId, job] as const),
      ),
    [currentProjectMapData, tilePrefetchJobs],
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
    // Only load after a controller-owned map-data sync reaches a terminal state.
    if (mapDataRevision === 0) return;

    let stale = false;

    (async () => {
      const newData: ProjectMapDataRecord = {};

      // When geoJsonProjects is empty, the loop is a no-op and newData stays {},
      // which clears any previously-loaded data via the atomic state swap below.
      // Setting state inside this async callback avoids the cascading-render
      // cost of calling setState synchronously in the effect body.
      for (const project of geoJsonProjects) {
        try {
          const mapData = await controller.getProjectMapData(project.id);
          if (stale) return;

          const fc = normalizeGeoJSON(mapData?.featureCollection);
          if (
            fc
            && fc.features.length > 0
            && mapData?.commitId === project.latest_commit.id
          ) {
            newData[project.id] = {
              commitId: mapData.commitId,
              featureCollection: attachDepthToFeatureCollection(fc, DEPTH_PROPERTY_KEY),
              bounds: mapData.bounds,
            };
          }
        } catch (err) {
          console.warn('Failed to load project GeoJSON:', err);
        }
      }

      if (stale) return;

      setProjectMapData(newData);
    })();

    return () => { stale = true; };
  }, [mapDataRevision, controller, geoJsonProjects]);

  useEffect(() => {
    if (mapDataRevision === 0) return;

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
          console.warn('Failed to load a cached overlay:', error);
        }
      }

      if (stale) return;
      setOverlayGeoJsonData(nextData);
    })();

    return () => {
      stale = true;
    };
    // `landmarksRevision` bumps after a landmark create/edit/delete writes the
    // cached overlay; mapDataRevision changes only after a sync/resync finishes
    // its map-data phases. Re-read on either so the map + panel always reflect
    // the latest cached overlays.
  }, [controller, mapDataRevision, landmarksRevision]);

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

    const bounds = computeBounds(projectBounds, effectiveActiveProjectIds);
    if (bounds && mapRef.current) {
      didFitRef.current = true;
      mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 800 });
    }
  }, [effectiveActiveProjectIds, geoJsonData, projectBounds]);

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
        ...projectPointLayerIds,
      ] as readonly string[],
    [projectPointLayerIds],
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
    if (longPressRingTimerRef.current !== null) {
      clearTimeout(longPressRingTimerRef.current);
      longPressRingTimerRef.current = null;
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
        // Only arm the long-press when the map is
        // zoomed in far enough that a landmark can be created. Below the marker
        // interaction zoom, creation is impossible, so the ring must not appear
        // at all. The empty-spot requirement is enforced when the timer fires.
        if (isMarkerInteractionZoom()) {
          const pointerId = event.pointerId;
          longPressRingTimerRef.current = setTimeout(() => {
            longPressRingTimerRef.current = null;
            const candidate = mapPointerTapCandidateRef.current;
            if (!candidate || candidate.pointerId !== pointerId || candidate.moved) {
              return;
            }
            if (!isEmptyMapSpotAtClientPoint(cx, cy)) {
              return;
            }
            setLongPressRing({ x: cx, y: cy });
          }, MAP.LONG_PRESS_RING_REVEAL_DELAY_MS);
          longPressTimerRef.current = setTimeout(() => {
            clearLongPressTimer();
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

    // Step 2: Zoom using the persisted bounds validated during project sync.
    setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;

      const bounds = computeBounds(projectBounds, new Set([projectId]));
      if (bounds) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
      }
    }, 0);
  }, [onProjectPanelChange, sortedProjects, countryVisibility, projectBounds]);

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

  // ---- GPS handlers ---------------------------------------------------------

  const handleOpenRecorder = useCallback(() => {
    setIsRecorderOpen(true);
  }, []);

  // Collapse any full-screen GPS overlay (recorder / averaging) so a bottom-tab
  // press reveals that tab's normal view. Recording keeps running (it lives in
  // the controller); only the on-screen view is dismissed. If averaging has data,
  // tab collapse behaves like Stop (pause), not Reset.
  const closeGpsOverlays = useCallback(() => {
    setIsRecorderOpen(false);
    setIsAveragingOpen(false);
    setAveragingPhase((prev) => (prev === 'running' ? 'stopped' : prev));
  }, []);

  const handleStartRecording = useCallback(() => {
    void (async () => {
      try {
        await controller.startTrackRecording();
      } catch (error) {
        if (!isMountedRef.current) return;
        const message =
          error instanceof Error ? error.message : 'Could not start GPS recording.';
        showLandmarkToast(message, 'error');
        return;
      }
      // Once recording is live, nudge (Android only) to disable battery
      // optimization if it's still active and the user hasn't dismissed it.
      if (batteryHintDismissedRef.current) return;
      const active = await batteryGuard.isOptimizationActive();
      if (isMountedRef.current && active) setShowBatteryHint(true);
    })();
  }, [controller, showLandmarkToast, batteryGuard]);

  const handleFixBatteryOptimization = useCallback(() => {
    void (async () => {
      await batteryGuard.requestExemption();
      // Re-check after the system dialog returns; hide once exempted.
      const stillActive = await batteryGuard.isOptimizationActive();
      if (!isMountedRef.current) return;
      if (!stillActive) {
        setShowBatteryHint(false);
        batteryHintDismissedRef.current = true;
      }
    })();
  }, [batteryGuard]);

  const handleDismissBatteryHint = useCallback(() => {
    batteryHintDismissedRef.current = true;
    setShowBatteryHint(false);
  }, []);

  const handlePauseRecording = useCallback(() => {
    void controller.pauseTrackRecording();
  }, [controller]);

  const handleResumeRecording = useCallback(() => {
    void controller.resumeTrackRecording();
  }, [controller]);

  // Stop from the recording screen, then leave the screen (back to the map).
  const handleStopRecordingFromScreen = useCallback(() => {
    void (async () => {
      const track = await controller.stopTrackRecording();
      if (!isMountedRef.current) return;
      setIsRecorderOpen(false);
      showLandmarkToast(track ? 'Track saved' : 'No points were recorded', track ? 'success' : 'error');
    })();
  }, [controller, showLandmarkToast]);

  // Cancel from the recording screen: if a recording is in progress (recording
  // or paused) confirm before discarding; otherwise just close the screen.
  const handleCancelRecording = useCallback(() => {
    if (gpsRecordingState === 'idle') {
      setIsRecorderOpen(false);
      return;
    }
    setShowRecordingCancelConfirm(true);
  }, [gpsRecordingState]);

  const handleDismissRecordingCancel = useCallback(() => {
    setShowRecordingCancelConfirm(false);
  }, []);

  const handleConfirmRecordingCancel = useCallback(() => {
    setShowRecordingCancelConfirm(false);
    void controller.discardTrackRecording();
    setIsRecorderOpen(false);
  }, [controller]);

  const handleCollectPoint = useCallback(() => {
    if (averagingPhase === 'stopped' && averaging.result) {
      setIsAveragingOpen(true);
      return;
    }
    // Open held (no watch); bump the nonce so any prior session's data is
    // cleared. The user presses Start to begin collecting.
    setAveragingPhase('idle');
    setAveragingNonce((n) => n + 1);
    setIsAveragingOpen(true);
  }, [averaging.result, averagingPhase]);

  const handleStartAveraging = useCallback(() => {
    // Start (from held) or resume/continue (from stopped) -- both just run.
    if (averaging.status === 'permission-denied' || averaging.status === 'error') {
      setAveragingNonce((n) => n + 1);
    }
    setAveragingPhase('running');
  }, [averaging.status]);

  const handleStopAveraging = useCallback(() => {
    // Pause: stop reading but keep the collected data (stopwatch Stop).
    setAveragingPhase('stopped');
  }, []);

  // Reset is destructive, so confirm first.
  const handleRequestAveragingReset = useCallback(() => {
    setShowAveragingResetConfirm(true);
  }, []);

  const handleCancelAveragingReset = useCallback(() => {
    setShowAveragingResetConfirm(false);
  }, []);

  const handleConfirmAveragingReset = useCallback(() => {
    setShowAveragingResetConfirm(false);
    // Clear the collected fixes. If running, keep running (continue from zero);
    // if paused, drop back to the held/zero state.
    setAveragingNonce((n) => n + 1);
    setAveragingPhase((prev) => (prev === 'running' ? 'running' : 'idle'));
  }, []);

  const handleCancelAveraging = useCallback(() => {
    setIsAveragingOpen(false);
    setAveragingPhase('idle');
    setAveragingNonce((n) => n + 1);
  }, []);

  // Save an averaged point as a landmark by reusing the shared create form
  // (works online and offline via the controller's landmark seam).
  const handleAveragingSave = useCallback(
    (pointToSave: { latitude: number; longitude: number; altitude: number | null }) => {
      setIsAveragingOpen(false);
      setAveragingPhase('idle');
      setAveragingNonce((n) => n + 1);
      setLandmarkFormError(null);
      setLandmarkForm({
        mode: 'create',
        editId: null,
        initialValues: { latitude: pointToSave.latitude, longitude: pointToSave.longitude },
      });
      loadLandmarkCollections();
    },
    [loadLandmarkCollections],
  );

  const reportGpsTrackActionError = useCallback(
    (track: GpsTrackListItem, phase: 'gpx' | 'share' | 'upload' | 'edit' | 'delete', message: string, error: unknown) => {
      console.warn('GPS track action failed.', {
        phase,
        trackId: track.id,
        trackName: track.name,
        origin: track.origin,
        error: errorToLogDetails(error),
      });
      if (isMountedRef.current) showLandmarkToast(message, 'error');
    },
    [showLandmarkToast],
  );

  const prepareTrackGpxFile = useCallback(
    async (track: GpsTrackListItem) => {
      try {
        return await controller.buildGpxFileForTrack(track);
      } catch (error) {
        reportGpsTrackActionError(track, 'gpx', 'Could not create the GPX file for this track.', error);
        throw error;
      }
    },
    [controller, reportGpsTrackActionError],
  );

  const handleShareTrack = useCallback(
    (track: GpsTrackListItem) => {
      void (async () => {
        let gpxFile: Awaited<ReturnType<typeof prepareTrackGpxFile>>;
        try {
          gpxFile = await prepareTrackGpxFile(track);
        } catch {
          return;
        }
        try {
          await gpxFileService.shareGpx({ ...gpxFile, title: track.name });
        } catch (error) {
          reportGpsTrackActionError(track, 'share', 'Could not share the GPX file.', error);
        }
      })();
    },
    [gpxFileService, prepareTrackGpxFile, reportGpsTrackActionError],
  );

  /** Load a track's geometry into the points cache (local: instant; remote: download). */
  const loadGpsTrackPoints = useCallback(
    async (id: string) => {
      setLoadingTrackIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      try {
        const points = await controller.getGpsTrackPoints(id);
        if (!isMountedRef.current) return;
        setGpsTrackPoints((prev) => ({ ...prev, [id]: points }));
      } catch (error) {
        console.warn('Failed to load GPS track geometry.', { id, error: errorToLogDetails(error) });
      } finally {
        if (isMountedRef.current) {
          setLoadingTrackIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }
    },
    [controller],
  );

  const handleToggleGpsTrack = useCallback(
    (track: GpsTrackListItem, visible: boolean) => {
      setGpsTrackVisibility((prev) => ({ ...prev, [track.id]: visible }));
      setGpsTrackVisibilityPreference(track.id, visible);
      if (visible && !gpsTrackPoints[track.id]) {
        void loadGpsTrackPoints(track.id);
      }
    },
    [gpsTrackPoints, loadGpsTrackPoints],
  );

  // Tapping a track row shows it on the map (turning it on if needed) and zooms
  // to fit its geometry, then closes the panel so the map is fully visible.
  const handleZoomToTrack = useCallback(
    (track: GpsTrackListItem) => {
      if (gpsTrackVisibility[track.id] !== true) {
        setGpsTrackVisibility((prev) => ({ ...prev, [track.id]: true }));
        setGpsTrackVisibilityPreference(track.id, true);
      }
      void (async () => {
        let points = gpsTrackPoints[track.id];
        if (!points) {
          setLoadingTrackIds((prev) => new Set(prev).add(track.id));
          try {
            points = await controller.getGpsTrackPoints(track.id);
            if (isMountedRef.current && points) {
              const loaded = points;
              setGpsTrackPoints((prev) => ({ ...prev, [track.id]: loaded }));
            }
          } catch (error) {
            console.warn('Failed to load GPS track geometry.', { id: track.id, error: errorToLogDetails(error) });
          } finally {
            if (isMountedRef.current) {
              setLoadingTrackIds((prev) => {
                const next = new Set(prev);
                next.delete(track.id);
                return next;
              });
            }
          }
        }
        if (!isMountedRef.current || !points || points.length === 0) return;
        const bounds = boundsFromPoints(points);
        if (bounds && mapRef.current) {
          mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
          onGpsPanelChange(false);
        }
      })();
    },
    [controller, gpsTrackPoints, gpsTrackVisibility, onGpsPanelChange],
  );

  const handleUploadTrack = useCallback((track: GpsTrackListItem) => {
    setUploadTarget(track);
  }, []);

  const handleCancelUploadTrack = useCallback(() => {
    if (uploadBusy) return;
    setUploadTarget(null);
  }, [uploadBusy]);

  const handleConfirmUploadTrack = useCallback(() => {
    const target = uploadTarget;
    if (!target || uploadBusy) return;
    setUploadBusy(true);
    void (async () => {
      try {
        await controller.uploadGpsTrack(target.id);
        if (!isMountedRef.current) return;
        setUploadTarget(null);
        showLandmarkToast(
          controller.isOfflineLocked
            ? 'Offline — upload queued in Pending changes'
            : 'Track uploaded to SpeleoDB',
          controller.isOfflineLocked ? 'error' : 'success',
        );
      } catch (error) {
        if (isMountedRef.current) {
          setUploadTarget(null);
          reportGpsTrackActionError(target, 'upload', 'Could not upload the GPS track.', error);
        }
      } finally {
        if (isMountedRef.current) setUploadBusy(false);
      }
    })();
  }, [controller, reportGpsTrackActionError, showLandmarkToast, uploadBusy, uploadTarget]);

  const handleEditTrack = useCallback((track: GpsTrackListItem) => {
    setEditTarget(track);
    setEditName(track.name);
    setEditColor(track.color);
  }, []);

  const handleCancelEditTrack = useCallback(() => {
    if (editBusy) return;
    setEditTarget(null);
  }, [editBusy]);

  const handleConfirmEditTrack = useCallback(() => {
    const target = editTarget;
    if (!target || editBusy) return;
    const name = editName.trim();
    const color = editColor;
    if (!name || (name === target.name && color === target.color)) {
      setEditTarget(null);
      return;
    }
    setEditBusy(true);
    void (async () => {
      try {
        await controller.editGpsTrack(target.id, { name, color });
        if (isMountedRef.current) setEditTarget(null);
      } catch (error) {
        if (isMountedRef.current) {
          setEditTarget(null);
          reportGpsTrackActionError(target, 'edit', 'Could not save the track changes.', error);
        }
      } finally {
        if (isMountedRef.current) setEditBusy(false);
      }
    })();
  }, [controller, editBusy, editColor, editName, editTarget, reportGpsTrackActionError]);

  // Ensure geometry is loaded for every track currently toggled on (covers
  // visibility restored from preferences and tracks that appear after a sync).
  // Deferred past the synchronous effect body so the loader's setState does not
  // run inline (avoids a cascading render).
  useEffect(() => {
    const pending = gpsTracks
      .filter(
        (track) =>
          gpsTrackVisibility[track.id] === true &&
          !gpsTrackPoints[track.id] &&
          !loadingTrackIds.has(track.id),
      )
      .map((track) => track.id);
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      for (const id of pending) {
        if (cancelled) return;
        await loadGpsTrackPoints(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gpsTracks, gpsTrackVisibility, gpsTrackPoints, loadingTrackIds, loadGpsTrackPoints]);

  const handleDeleteTrack = useCallback((track: GpsTrackListItem) => {
    setDeleteTarget(track);
  }, []);

  const handleCancelDeleteTrack = useCallback(() => {
    if (deleteBusy) return;
    setDeleteTarget(null);
  }, [deleteBusy]);

  const handleConfirmDeleteTrack = useCallback(() => {
    const target = deleteTarget;
    if (!target || deleteBusy) return;
    setDeleteBusy(true);
    void (async () => {
      try {
        await controller.removeGpsTrack(target.id);
        if (!isMountedRef.current) return;
        setDeleteTarget(null);
        // Drop any loaded geometry/visibility for the removed track.
        setGpsTrackPoints((prev) => {
          if (!(target.id in prev)) return prev;
          const next = { ...prev };
          delete next[target.id];
          return next;
        });
      } catch (error) {
        if (isMountedRef.current) {
          setDeleteTarget(null);
          reportGpsTrackActionError(target, 'delete', 'Could not delete the GPS track.', error);
        }
      } finally {
        if (isMountedRef.current) setDeleteBusy(false);
      }
    })();
  }, [controller, deleteBusy, deleteTarget, reportGpsTrackActionError]);

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
                <ProjectMapLayers
                  projects={sortedProjects}
                  activeProjectIds={effectiveActiveProjectIds}
                  geoJsonData={geoJsonData}
                  projectColorsById={projectColorsById}
                  colorMode={colorMode}
                  depthDomain={depthDomain}
                />

                <OverlayMapLayers
                  visibleOverlayGeoJsonData={visibleOverlayGeoJsonData}
                  visibleLandmarksGeoJSON={visibleLandmarksGeoJSON}
                  showLandmarks={showLandmarks}
                  iconsLoaded={overlayIconsLoaded}
                  iconAvailability={overlayIconAvailability}
                />

                <GpsMapLayers
                  savedTrackFeatureCollection={savedTrackFeatureCollection}
                  currentTrackFeatureCollection={currentTrackFeatureCollection}
                  recordingState={gpsRecordingState}
                  userLocation={userLocation}
                />
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

          {/* ---- GPS panel ---- */}
          <GpsPanel
            isOpen={isGpsPanelOpen}
            onClose={() => onGpsPanelChange(false)}
            recordingState={gpsRecordingState}
            currentPoints={currentTrackPoints}
            tracks={gpsTracks}
            measurementUnit={measurementUnit}
            trackVisibility={gpsTrackVisibility}
            loadingTrackIds={loadingTrackIds}
            onOpenRecorder={handleOpenRecorder}
            onCollectPoint={handleCollectPoint}
            onTrackTap={handleZoomToTrack}
            onToggleTrackVisibility={handleToggleGpsTrack}
            onShareTrack={handleShareTrack}
            onUploadTrack={handleUploadTrack}
            onEditTrack={handleEditTrack}
            onDeleteTrack={handleDeleteTrack}
          />

          {/* ---- GPS recording screen (full-screen, with a back button) ---- */}
          <GpsRecordingScreen
            isOpen={isRecorderOpen}
            recordingState={gpsRecordingState}
            recordingElapsedMs={gpsRecordingElapsedMs}
            recordingElapsedUpdatedAt={gpsRecordingElapsedUpdatedAt}
            currentPoints={currentTrackPoints}
            measurementUnit={measurementUnit}
            onBack={() => setIsRecorderOpen(false)}
            onStart={handleStartRecording}
            onPause={handlePauseRecording}
            onResume={handleResumeRecording}
            onStop={handleStopRecordingFromScreen}
            onCancel={handleCancelRecording}
            showBatteryOptimizationHint={showBatteryHint}
            onFixBatteryOptimization={handleFixBatteryOptimization}
            onDismissBatteryOptimizationHint={handleDismissBatteryHint}
          />

          <ConfirmDialog
            isOpen={showRecordingCancelConfirm}
            title="Discard recording"
            message="This stops the current recording and discards the track. This cannot be undone."
            confirmLabel="Discard"
            cancelLabel="Keep recording"
            danger
            onConfirm={handleConfirmRecordingCancel}
            onCancel={handleDismissRecordingCancel}
            testId="gps-recording-cancel-confirm"
          />

          <GpsAveragingModal
            isOpen={isAveragingOpen}
            status={averaging.status}
            result={averaging.result}
            gnss={averaging.gnss}
            measurementUnit={measurementUnit}
            phase={averagingPhase}
            onStart={handleStartAveraging}
            onStop={handleStopAveraging}
            onReset={handleRequestAveragingReset}
            onCancel={handleCancelAveraging}
            onSave={handleAveragingSave}
          />

          <ConfirmDialog
            isOpen={showAveragingResetConfirm}
            title="Reset GPS Point"
            message="This clears all the GPS readings collected so far and starts the average over from zero."
            confirmLabel="Reset"
            cancelLabel="Cancel"
            danger
            onConfirm={handleConfirmAveragingReset}
            onCancel={handleCancelAveragingReset}
            testId="gps-averaging-reset-confirm"
          />

          <ConfirmDialog
            isOpen={uploadTarget !== null}
            title="Upload GPS Track"
            message={
              <>
                Upload{' '}
                <span className="font-semibold text-slate-100">
                  {uploadTarget?.name ?? 'this track'}
                </span>{' '}
                to SpeleoDB?
              </>
            }
            warning="This sends the GPX track to the active SpeleoDB instance. If you are offline, it will be queued and uploaded after reconnect."
            confirmLabel="Upload"
            cancelLabel="Cancel"
            busy={uploadBusy}
            busyLabel={'Uploading\u2026'}
            onConfirm={handleConfirmUploadTrack}
            onCancel={handleCancelUploadTrack}
            testId="gps-upload-confirm"
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

          <ConfirmDialog
            isOpen={deleteTarget !== null}
            title="Delete GPS Track"
            message={
              <>
                Are you sure you want to delete{' '}
                <span className="font-semibold text-slate-100">
                  {deleteTarget?.name ?? 'this track'}
                </span>
                {deleteTarget?.origin === 'remote' ? ' from SpeleoDB' : ''}?
              </>
            }
            warning={
              deleteTarget?.origin === 'remote'
                ? 'This removes the track from SpeleoDB. If you are offline it is queued in Pending changes.'
                : 'This removes the recording from this device. This action cannot be undone.'
            }
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            busy={deleteBusy}
            busyLabel={'Deleting\u2026'}
            onConfirm={handleConfirmDeleteTrack}
            onCancel={handleCancelDeleteTrack}
            testId="gps-delete-confirm"
          />

          {editTarget && (
            <IonModal
              isOpen
              onDidDismiss={() => { if (!editBusy) setEditTarget(null); }}
            >
              <IonContent className="ion-padding">
                {/* Top-anchored (NOT vertically centered): when the keyboard
                    opens, IonContent shrinks; a `justify-center` layout would
                    re-center the now-shorter form and make everything lurch.
                    Anchoring to the top keeps the Name field steady. */}
                <div
                  data-testid="gps-edit-modal"
                  className="flex flex-col h-full max-w-sm mx-auto"
                  // Clear the device safe area (notch/status bar) plus a generous
                  // gap so "Edit Track" never sits against the top "danger area".
                  style={{ paddingTop: 'calc(3.5rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))' }}
                >
                  <h2 className="text-xl font-semibold text-slate-100 mb-5 text-center">
                    Edit GPS Track
                  </h2>
                  <label className="text-xs font-medium text-slate-400 mb-1">Name</label>
                  <input
                    type="text"
                    value={editName}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    data-testid="gps-edit-name-input"
                    className="w-full px-4 py-2.5 text-sm text-slate-200 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500"
                    placeholder="Track name"
                  />
                  <label className="text-xs font-medium text-slate-400 mt-4 mb-2">Color</label>
                  <div className="grid grid-cols-10 gap-2.5" data-testid="gps-edit-color-swatches">
                    {TRACK_COLOR_PALETTE.map((color) => {
                      // `String(...)` guards against a track recorded by an older
                      // build whose persisted record has no `color` (undefined),
                      // which would otherwise throw on `.toLowerCase()`.
                      const selected = String(editColor).toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Color ${color}`}
                          aria-pressed={selected}
                          onClick={() => setEditColor(color)}
                          data-testid={`gps-edit-color-${color}`}
                          className="relative flex aspect-square w-full items-center justify-center rounded-full transition-transform"
                          style={{
                            backgroundColor: color,
                            // Selection cue that works on ANY swatch (dark or
                            // light): a contrasting checkmark inside, plus a
                            // dark-gap + white outer ring drawn with box-shadow
                            // (reliable on old Android WebViews, unlike a same-
                            // color border that vanishes on light swatches).
                            transform: selected ? 'scale(1.12)' : undefined,
                            boxShadow: selected
                              ? '0 0 0 2px #0f172a, 0 0 0 4px #f8fafc'
                              : undefined,
                          }}
                        >
                          {selected && (
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke={readableInkColor(color)}
                              strokeWidth={3.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    <button
                      type="button"
                      onClick={handleCancelEditTrack}
                      data-testid="gps-edit-cancel"
                      className="app-btn app-btn--secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmEditTrack}
                      disabled={editBusy}
                      data-testid="gps-edit-save"
                      className="app-btn app-btn--primary"
                    >
                      {editBusy ? 'Saving\u2026' : 'Save'}
                    </button>
                  </div>
                </div>
              </IonContent>
            </IonModal>
          )}

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
              durationMs={MAP.LONG_PRESS_DURATION_MS - MAP.LONG_PRESS_RING_REVEAL_DELAY_MS}
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
            isGpsPanelOpen={isGpsPanelOpen}
            onGpsPanelChange={onGpsPanelChange}
            isGpsRecording={gpsRecordingState !== 'idle'}
            onTabPress={closeGpsOverlays}
            pendingOpsCount={pendingOpsCount}
          />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
