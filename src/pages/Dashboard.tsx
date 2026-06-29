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
import Map from 'react-map-gl/maplibre';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { useSpeleoDB } from '../context/useSpeleoDB';
import { DEFAULT_MAP_LAYER_ID, MAP, MAP_LAYERS } from '../constants';
import type { MapLayerId } from '../types/mapLayer';
import { registerTileCacheProtocol, getCachedLayerStyle } from '../services/TileCacheService';
import MapLayerControl from '../components/map/MapLayerControl';
import {
  setSelectedMapLayerId as persistSelectedMapLayerId,
} from '../services/PreferencesService';
import ProjectPanel from '../components/ProjectPanel';
import LandmarkPanel from '../components/LandmarkPanel';
import GpsPanel from '../components/GpsPanel';
import AppTabBar from '../components/AppTabBar';
import GeolocationErrorModal from '../components/GeolocationErrorModal';
import DistanceScale from '../components/map/DistanceScale';
import DepthGauge from '../components/map/DepthGauge';
import { PERMISSION_DENIED_SENTINEL } from '../utils/geolocationError';
import OverlayMarkerDetailsModal from '../components/OverlayMarkerDetailsModal';
import LandmarkFormModal from '../components/LandmarkFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import LongPressRing from '../components/LongPressRing';
import type { MapColorMode } from '../types/mapColorMode';
import type { MeasurementUnit } from '../types/measurementUnit';
import { useDepthProbe } from '../hooks/useDepthProbe';
import {
  DEFAULT_OVERLAY_ICON_AVAILABILITY,
  OVERLAY_ICON_SOURCES,
  computeBounds,
  loadMapImage,
  lockMapOrientation,
  type OverlayImageMap,
  type OverlayIconAvailability,
  type OverlayIconId,
} from './dashboard/dashboardMapUtils';
import { ProjectMapLayers } from './dashboard/ProjectMapLayers';
import { OverlayMapLayers } from './dashboard/OverlayMapLayers';
import { GpsMapLayers } from './dashboard/GpsMapLayers';
import { useDashboardMapInteractions } from './dashboard/useDashboardMapInteractions';
import { DashboardGpsActivity } from './dashboard/DashboardGpsActivity';
import { DashboardGpsTrackDialogs } from './dashboard/DashboardGpsTrackDialogs';
import { useDashboardGpsTrackActions } from './dashboard/useDashboardGpsTrackActions';
import { useDashboardGpsRecordingActions } from './dashboard/useDashboardGpsRecordingActions';
import { useDashboardLandmarkActions } from './dashboard/useDashboardLandmarkActions';
import { useDashboardProjectVisibility } from './dashboard/useDashboardProjectVisibility';
import {
  useDashboardMapData,
  useVisibleDashboardOverlays,
} from './dashboard/useDashboardMapData';

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
  const mapRef = useRef<MapRef>(null);

  const [mapViewMetrics, setMapViewMetrics] = useState<{ zoom: number; latitude: number }>(() => ({
    zoom: MAP.DEFAULT_ZOOM,
    latitude: MAP.DEFAULT_CENTER[1],
  }));

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

  const {
    sortedProjects,
    projectColorsById,
    geoJsonProjects,
    currentProjectMapData,
    geoJsonData,
    projectBounds,
    overlayGeoJsonData,
    landmarkCollectionGroups,
  } = useDashboardMapData({
    source: controller,
    projects,
    mapDataRevision,
    landmarksRevision,
  });
  const closeProjectPanel = useCallback(
    () => onProjectPanelChange(false),
    [onProjectPanelChange],
  );
  const {
    panelProjects,
    panelActiveProjectIds,
    effectiveActiveProjectIds,
    countryVisibility,
    countryCollapsed,
    toggleProject: handleToggleProject,
    showAll: handleShowAll,
    hideAll: handleHideAll,
    toggleCountry: handleToggleCountry,
    toggleCountryCollapsed: handleToggleCountryCollapsed,
    zoomToProject: handleZoomToProject,
  } = useDashboardProjectVisibility({
    projects: sortedProjects,
    eligibleProjects: geoJsonProjects,
    geoJsonData,
    projectBounds,
    mapRef,
    onClosePanel: closeProjectPanel,
  });
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

  const visibleOverlayGeoJsonData = useVisibleDashboardOverlays(
    overlayGeoJsonData,
    effectiveActiveProjectIds,
  );

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

  const {
    selectedMarkerDetail: selectedOverlayMarkerDetail,
    clearSelectedMarkerDetail,
    longPressRing,
    handleMapGestureStart,
    handleMapGestureMove,
    handleMapGestureEnd,
  } = useDashboardMapInteractions({
    mapRef,
    activeProjectIds: effectiveActiveProjectIds,
    projects: sortedProjects,
    clearProbedDepth,
    sampleDepthAtClientPoint,
  });
  const closeLandmarkPanel = useCallback(
    () => onLandmarkPanelChange(false),
    [onLandmarkPanelChange],
  );

  const {
    collectionVisibility: landmarkCollectionVisibility,
    collectionCollapsed: landmarkCollectionCollapsed,
    visibleLandmarks: visibleLandmarksGeoJSON,
    landmarkForm,
    landmarkCollections,
    landmarkFormBusy,
    landmarkFormError,
    landmarkDeleteTarget,
    landmarkDeleteBusy,
    landmarkToast,
    showToast: showLandmarkToast,
    toggleCollection: handleToggleLandmarkCollection,
    toggleCollectionCollapsed: handleToggleLandmarkCollectionCollapsed,
    showAll: handleLandmarkShowAll,
    hideAll: handleLandmarkHideAll,
    locateLandmark: handleLocateLandmark,
    openCreateFromSelected: handleOpenCreateLandmark,
    openCreateAtPoint: handleAveragingSave,
    openEditFromSelected: handleOpenEditLandmark,
    openDeleteFromSelected: handleOpenDeleteLandmark,
    cancelLandmarkForm: handleCancelLandmarkForm,
    submitLandmarkForm: handleSubmitLandmarkForm,
    cancelDeleteLandmark: handleCancelDeleteLandmark,
    confirmDeleteLandmark: handleConfirmDeleteLandmark,
  } = useDashboardLandmarkActions({
    controller,
    selectedMarkerDetail: selectedOverlayMarkerDetail,
    clearSelectedMarkerDetail,
    groups: landmarkCollectionGroups,
    landmarks: visibleOverlayGeoJsonData.landmarks,
    mapRef,
    onClosePanel: closeLandmarkPanel,
  });

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

  const closeGpsPanel = useCallback(() => onGpsPanelChange(false), [onGpsPanelChange]);
  const {
    trackVisibility: gpsTrackVisibility,
    loadingTrackIds,
    savedTrackFeatureCollection,
    uploadTarget,
    uploadBusy,
    deleteTarget,
    deleteBusy,
    editTarget,
    editName,
    editColor,
    editBusy,
    setEditName,
    setEditColor,
    shareTrack: handleShareTrack,
    toggleTrack: handleToggleGpsTrack,
    zoomToTrack: handleZoomToTrack,
    openUpload: handleUploadTrack,
    cancelUpload: handleCancelUploadTrack,
    confirmUpload: handleConfirmUploadTrack,
    openEdit: handleEditTrack,
    cancelEdit: handleCancelEditTrack,
    confirmEdit: handleConfirmEditTrack,
    openDelete: handleDeleteTrack,
    cancelDelete: handleCancelDeleteTrack,
    confirmDelete: handleConfirmDeleteTrack,
  } = useDashboardGpsTrackActions({
    controller,
    tracks: gpsTracks,
    mapRef,
    onClosePanel: closeGpsPanel,
    showToast: showLandmarkToast,
  });

  const {
    currentTrackPoints,
    currentTrackFeatureCollection,
    isRecorderOpen,
    showBatteryHint,
    recordingCancelOpen: showRecordingCancelConfirm,
    openRecorder: handleOpenRecorder,
    closeRecorder: handleCloseRecorder,
    startRecording: handleStartRecording,
    pauseRecording: handlePauseRecording,
    resumeRecording: handleResumeRecording,
    stopRecording: handleStopRecordingFromScreen,
    cancelRecording: handleCancelRecording,
    dismissRecordingCancel: handleDismissRecordingCancel,
    confirmRecordingCancel: handleConfirmRecordingCancel,
    fixBatteryOptimization: handleFixBatteryOptimization,
    dismissBatteryHint: handleDismissBatteryHint,
    isAveragingOpen,
    averagingPhase,
    averaging,
    averagingResetOpen: showAveragingResetConfirm,
    collectPoint: handleCollectPoint,
    startAveraging: handleStartAveraging,
    stopAveraging: handleStopAveraging,
    requestAveragingReset: handleRequestAveragingReset,
    cancelAveragingReset: handleCancelAveragingReset,
    confirmAveragingReset: handleConfirmAveragingReset,
    cancelAveraging: handleCancelAveraging,
    saveAveragedPoint,
    closeGpsOverlays,
  } = useDashboardGpsRecordingActions({
    controller,
    recordingState: gpsRecordingState,
    tracksRevision: gpsTracksRevision,
    showToast: showLandmarkToast,
    onSaveAveragedPoint: handleAveragingSave,
  });

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

          <DashboardGpsActivity
            recording={{
              isOpen: isRecorderOpen,
              recordingState: gpsRecordingState,
              recordingElapsedMs: gpsRecordingElapsedMs,
              recordingElapsedUpdatedAt: gpsRecordingElapsedUpdatedAt,
              currentPoints: currentTrackPoints,
              measurementUnit,
              onBack: handleCloseRecorder,
              onStart: handleStartRecording,
              onPause: handlePauseRecording,
              onResume: handleResumeRecording,
              onStop: handleStopRecordingFromScreen,
              onCancel: handleCancelRecording,
              showBatteryOptimizationHint: showBatteryHint,
              onFixBatteryOptimization: handleFixBatteryOptimization,
              onDismissBatteryOptimizationHint: handleDismissBatteryHint,
            }}
            recordingCancelOpen={showRecordingCancelConfirm}
            onConfirmRecordingCancel={handleConfirmRecordingCancel}
            onDismissRecordingCancel={handleDismissRecordingCancel}
            averaging={{
              isOpen: isAveragingOpen,
              status: averaging.status,
              result: averaging.result,
              gnss: averaging.gnss,
              measurementUnit,
              phase: averagingPhase,
              onStart: handleStartAveraging,
              onStop: handleStopAveraging,
              onReset: handleRequestAveragingReset,
              onCancel: handleCancelAveraging,
              onSave: saveAveragedPoint,
            }}
            averagingResetOpen={showAveragingResetConfirm}
            onConfirmAveragingReset={handleConfirmAveragingReset}
            onCancelAveragingReset={handleCancelAveragingReset}
          />

          <OverlayMarkerDetailsModal
            detail={selectedOverlayMarkerDetail}
            onClose={clearSelectedMarkerDetail}
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

          <DashboardGpsTrackDialogs
            uploadTarget={uploadTarget}
            uploadBusy={uploadBusy}
            onConfirmUpload={handleConfirmUploadTrack}
            onCancelUpload={handleCancelUploadTrack}
            deleteTarget={deleteTarget}
            deleteBusy={deleteBusy}
            onConfirmDelete={handleConfirmDeleteTrack}
            onCancelDelete={handleCancelDeleteTrack}
            editTarget={editTarget}
            editName={editName}
            editColor={editColor}
            editBusy={editBusy}
            onEditNameChange={setEditName}
            onEditColorChange={setEditColor}
            onConfirmEdit={handleConfirmEditTrack}
            onCancelEdit={handleCancelEditTrack}
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
