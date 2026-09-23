import { OfflineMapsPanel } from '../components/map/OfflineMapsPanel';
import { useDownloadAreas } from '../context/useSpeleoDB';
import { EMPTY_DOWNLOAD_AREAS } from '../types/downloadArea';
/**
 * Dashboard -- full-screen map with per-project GeoJSON layers.
 *
 * Replaces the old card-based dashboard with a maplibre-gl map.
 * Each project's cached GeoJSON is rendered as a colored layer that
 * can be toggled on/off via the ProjectPanel.
 */

import { useAppliedViewerState } from '../hooks/useAppliedViewerState';
import { useAppForeground } from '../hooks/useAppForeground';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
} from '@ionic/react';
import type { MapRef } from 'react-map-gl/maplibre';

import { useSpeleoDB } from '../context/useSpeleoDB';
import type { MapLayerId } from '../types/mapLayer';
import type { DashboardPanel, DashboardPanelChange } from '../types/dashboardPanel';
import { registerTileCacheProtocol } from '../services/TileCacheService';
import ProjectPanel from '../components/ProjectPanel';
import LandmarkPanel from '../components/LandmarkPanel';
import GpsPanel from '../components/GpsPanel';
import { GisGeometryPanel } from '../components/GisGeometryPanel';
import { useGisGeometries } from '../hooks/useGisGeometries';
import { useDashboardGisGeometryActions } from './dashboard/useDashboardGisGeometryActions';
import AppTabBar from '../components/AppTabBar';
import type { MapColorMode } from '../types/mapColorMode';
import type { MapDisplayPreferences, MapDisplayPreferencesPatch } from '../types/mapDisplayPreferences';
import type { MeasurementUnit } from '../types/measurementUnit';
import { useDepthProbe } from '../hooks/useDepthProbe';
import { computeBounds } from './dashboard/dashboardMapUtils';
import { useDashboardMapInteractions } from './dashboard/useDashboardMapInteractions';
import { DashboardGpsActivity } from './dashboard/DashboardGpsActivity';
import { DashboardGpsTrackDialogs } from './dashboard/DashboardGpsTrackDialogs';
import { useDashboardGpsTrackActions } from './dashboard/useDashboardGpsTrackActions';
import { useDashboardGpsRecordingActions } from './dashboard/useDashboardGpsRecordingActions';
import { useDashboardLandmarkActions } from './dashboard/useDashboardLandmarkActions';
import { useDashboardProjectVisibility } from './dashboard/useDashboardProjectVisibility';
import {
  useDashboardMapData,
} from './dashboard/useDashboardMapData';
import { DashboardMapCanvas } from './dashboard/DashboardMapCanvas';
import {
  DashboardLandmarkDialogs,
  DashboardLandmarkFeedback,
} from './dashboard/DashboardLandmarkPresentation';

// ==================== Register tile caching protocol once ====================

registerTileCacheProtocol();

// ==================== Component ====================

interface DashboardProps {
  isActive: boolean;
  activeDashboardPanel: DashboardPanel;
  onDashboardPanelChange: DashboardPanelChange;
  mapDisplayPreferences: MapDisplayPreferences;
  onMapDisplayPreferencesChange: (patch: MapDisplayPreferencesPatch) => void;
  colorMode: MapColorMode;
  measurementUnit: MeasurementUnit;
  selectedMapLayerId: MapLayerId;
  onSelectedMapLayerIdChange: (layerId: MapLayerId) => void;
  layerOfflineSync: Record<string, boolean>;
}

const Dashboard: React.FC<DashboardProps> = ({
  isActive,
  activeDashboardPanel,
  onDashboardPanelChange,
  mapDisplayPreferences,
  onMapDisplayPreferencesChange,
  colorMode,
  measurementUnit,
  selectedMapLayerId,
  onSelectedMapLayerIdChange,
  layerOfflineSync,
}) => {
  const downloadAreas = useDownloadAreas();
  const foreground = useAppForeground();
  const runtimeActive = isActive && foreground;
  const offlineMapsOpen = isActive && activeDashboardPanel === 'offline-maps';
  const [editingArea, setEditingArea] = useState(false);
  const effectiveLayerSync = useMemo(() => ({ ...layerOfflineSync, ...Object.fromEntries(downloadAreas.availableLayerIds.map((id) => [id, true])) }), [layerOfflineSync, downloadAreas.availableLayerIds]);
  const history = useHistory();
  const {
    controller,
    projects,
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

  // ---- Auth guard -----------------------------------------------------------

  useEffect(() => {
    if (!controller.isAuthenticated()) {
      history.push('/login');
    }
  }, [history, controller]);

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
    geoJsonData,
    projectBounds,
    projectDepthDomains,
    overlayGeoJsonData,
    landmarkCollectionGroups,
  } = useDashboardMapData({
    source: controller,
    projects,
    mapDataRevision,
    landmarksRevision,
  });
  const closeProjectPanel = useCallback(
    () => onDashboardPanelChange(null),
    [onDashboardPanelChange],
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
    cancelPendingZoom: cancelProjectZoom,
  } = useDashboardProjectVisibility({
    projects: sortedProjects,
    eligibleProjects: geoJsonProjects,
    geoJsonData,
    projectBounds,
    mapRef,
    onClosePanel: closeProjectPanel,
    cameraActive: runtimeActive && (activeDashboardPanel === null || activeDashboardPanel === 'projects'),
  });
  const displayIntent = useMemo(() => ({
    activeProjectIds: effectiveActiveProjectIds, mapDisplayPreferences, colorMode, measurementUnit,
  }), [effectiveActiveProjectIds, mapDisplayPreferences, colorMode, measurementUnit]);
  const appliedDisplay = useAppliedViewerState(displayIntent, runtimeActive);
  // Authoritative data removal/revision gating remains immediate; only display intent lags.
  const appliedProjectIds = useMemo(() => new Set([...appliedDisplay.activeProjectIds]
    .filter(id => Boolean(geoJsonData[id]))), [appliedDisplay.activeProjectIds, geoJsonData]);
  const visibleOverlayGeoJsonData = overlayGeoJsonData;

  // ---- Auto-fit bounds on first data load -----------------------------------

  const fitInitialProjectBounds = useCallback(() => {
    if (didFitRef.current) return;
    if (effectiveActiveProjectIds.size === 0 || Object.keys(geoJsonData).length === 0) return;

    const bounds = computeBounds(projectBounds, effectiveActiveProjectIds);
    if (bounds && mapRef.current) {
      didFitRef.current = true;
      mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 0 });
    }
  }, [effectiveActiveProjectIds, geoJsonData, projectBounds]);

  useEffect(() => {
    fitInitialProjectBounds();
  }, [fitInitialProjectBounds]);
  const fitInitialProjectBoundsRef = useRef(fitInitialProjectBounds);
  useLayoutEffect(() => { fitInitialProjectBoundsRef.current = fitInitialProjectBounds; }, [fitInitialProjectBounds]);
  const handleMapReady = useCallback(() => fitInitialProjectBoundsRef.current(), []);

  // ---- Handlers -------------------------------------------------------------

  const projectGeometryLayerIds = useMemo(
    () =>
      [...appliedProjectIds].flatMap((id) => [
        ...(appliedDisplay.mapDisplayPreferences.categories.caveEntrances ? [`project-${id}-point`] : []),
        `project-${id}-line`,
        `project-${id}-fill`,
      ]),
    [appliedProjectIds, appliedDisplay.mapDisplayPreferences.categories.caveEntrances],
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
    appliedDisplay.colorMode,
    appliedProjectIds,
    geoJsonData,
    projectGeometryLayerIds,
    appliedDisplay.mapDisplayPreferences.depthLimitFeet,
    projectDepthDomains,
  );

  const {
    selectedMarkerDetail: selectedOverlayMarkerDetail,
    clearSelectedMarkerDetail,
    cancelMapInteractions,
    longPressRing,
    handleMapGestureStart,
    handleMapGestureMove,
    handleMapGestureEnd,
  } = useDashboardMapInteractions({
    mapRef,
    activeProjectIds: appliedProjectIds,
    projects: sortedProjects,
    clearProbedDepth,
    sampleDepthAtClientPoint,
  });
  useEffect(() => {
    if (!isActive) {
      cancelMapInteractions();
      clearProbedDepth();
    }
  }, [isActive, cancelMapInteractions, clearProbedDepth]);
  const revealLandmarks = useCallback(
    () => onMapDisplayPreferencesChange({ categories: { landmarks: true } }),
    [onMapDisplayPreferencesChange],
  );
  const closeLandmarkPanel = useCallback(
    () => onDashboardPanelChange(null),
    [onDashboardPanelChange],
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
    onRevealLandmarks: revealLandmarks,
  });

  const closeGpsPanel = useCallback(
    () => onDashboardPanelChange(null),
    [onDashboardPanelChange],
  );
  const {
    trackVisibility: gpsTrackVisibility,
    appliedTrackVisibility,
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
    cancelPendingZoom: cancelGpsZoom,
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
    panelActive: isActive && activeDashboardPanel === 'gps',
    runtimeActive,
    mapRef,
    onClosePanel: closeGpsPanel,
    showToast: showLandmarkToast,
  });

  const {
    currentTrackPoints,
    currentTrackFeatureCollection,
    currentRecordingLocation,
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

  const gisGeometrySnapshot = useGisGeometries(controller);
  const closeGisPanel = useCallback(() => onDashboardPanelChange(null), [onDashboardPanelChange]);
  const gisActions = useDashboardGisGeometryActions({
    source: controller,
    snapshot: gisGeometrySnapshot,
    mapRef,
    panelActive: isActive && activeDashboardPanel === 'gis-geometries',
    runtimeActive,
    onClosePanel: closeGisPanel,
  });
  const refreshGisGeometries = useCallback(() => {
    void controller.refreshGisGeometries().catch(() => {});
  }, [controller]);

  const appliedCollectionVisibility = useAppliedViewerState(landmarkCollectionVisibility, runtimeActive);
  const projectLayers = useMemo(() => ({
    projects: sortedProjects, activeProjectIds: appliedProjectIds, geoJsonData, projectColorsById,
    colorMode: appliedDisplay.colorMode, depthDomain,
    showCaveEntrances: appliedDisplay.mapDisplayPreferences.categories.caveEntrances,
    runtimeActive,
  }), [sortedProjects, appliedProjectIds, geoJsonData, projectColorsById, appliedDisplay, depthDomain, runtimeActive]);
  const overlayLayers = useMemo(() => ({
    visibleOverlayGeoJsonData, visibleLandmarksGeoJSON,
    mapDisplayPreferences: appliedDisplay.mapDisplayPreferences,
    activeProjectIds: appliedProjectIds, collectionVisibility: appliedCollectionVisibility,
  }), [visibleOverlayGeoJsonData, visibleLandmarksGeoJSON, appliedDisplay, appliedProjectIds, appliedCollectionVisibility]);
  const gpsTrackColors = useMemo(() => Object.fromEntries(gpsTracks.map(track => [track.id, track.color])), [gpsTracks]);
  const appliedGpsTrackColors = useAppliedViewerState(gpsTrackColors, runtimeActive);
  const gpsLayers = useMemo(() => ({
    savedTrackFeatureCollection, savedTrackVisibility: appliedTrackVisibility, savedTrackColors: appliedGpsTrackColors,
    currentTrackFeatureCollection, recordingState: gpsRecordingState,
  }), [savedTrackFeatureCollection, appliedTrackVisibility, appliedGpsTrackColors, currentTrackFeatureCollection, gpsRecordingState]);
  const gisLayers = useMemo(() => ({
    featureCollection: gisActions.featureCollection, visibility: gisActions.appliedVisibility,
  }), [gisActions.featureCollection, gisActions.appliedVisibility]);
  const cancelGisZoom = gisActions.cancelPendingZoom;
  const handleUserNavigation = useCallback(() => {
    didFitRef.current = true;
    cancelProjectZoom();
    cancelGpsZoom();
    cancelGisZoom();
  }, [cancelProjectZoom, cancelGpsZoom, cancelGisZoom]);
  const gestures = useMemo(() => ({
    onStart: handleMapGestureStart, onMove: handleMapGestureMove, onEnd: handleMapGestureEnd,
    onMouseMove: handleMapMouseMove, onMouseLeave: handleMapMouseLeave,
  }), [handleMapGestureStart, handleMapGestureMove, handleMapGestureEnd, handleMapMouseMove, handleMapMouseLeave]);
  const openOfflineMaps = useCallback(() => onDashboardPanelChange('offline-maps'), [onDashboardPanelChange]);

  // ---- Render ---------------------------------------------------------------

  if (!controller.isAuthenticated()) return null;

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding" scrollY={false}>
        <div className="flex flex-col w-full h-full">
          <div className="relative flex-1 min-h-0 dashboard-map-container">
          <DashboardMapCanvas
            mapRef={mapRef}
            isActive={isActive}
            runtimeActive={runtimeActive}
            selectedMapLayerId={selectedMapLayerId}
            onSelectedMapLayerIdChange={onSelectedMapLayerIdChange}
            isOfflineLocked={isOfflineLocked}
            layerOfflineSync={effectiveLayerSync}
            downloadAreas={offlineMapsOpen ? downloadAreas.areas : EMPTY_DOWNLOAD_AREAS.areas}
            editingArea={editingArea}
            onOpenOfflineMaps={openOfflineMaps}
            gisLayers={gisLayers}
            projectLayers={projectLayers}
            overlayLayers={overlayLayers}
            gpsLayers={gpsLayers}
            recordingLocation={currentRecordingLocation}
            gestures={gestures}
            onUserNavigation={handleUserNavigation}
            colorMode={appliedDisplay.colorMode}
            measurementUnit={appliedDisplay.measurementUnit}
            probedDepth={probedDepth}
            depthLimitFeet={appliedDisplay.mapDisplayPreferences.depthLimitFeet}
            onMapReady={handleMapReady}
          />

          {offlineMapsOpen && <OfflineMapsPanel controller={controller} snapshot={downloadAreas} mapRef={mapRef} offline={isOfflineLocked} onClose={() => onDashboardPanelChange(null)} onEditingChange={setEditingArea} />}
          {/* ---- Project panel ---- */}
          <ProjectPanel
            projects={panelProjects}
            activeProjectIds={panelActiveProjectIds}
            geoJsonData={geoJsonData}
            projectColorsById={projectColorsById}
            countryVisibility={countryVisibility}
            countryCollapsed={countryCollapsed}
            onToggleProject={handleToggleProject}
            onZoomToProject={handleZoomToProject}
            onShowAll={handleShowAll}
            onHideAll={handleHideAll}
            onToggleCountry={handleToggleCountry}
            onToggleCountryCollapsed={handleToggleCountryCollapsed}
            onClose={closeProjectPanel}
            isOpen={activeDashboardPanel === 'projects'}
          />

          <GisGeometryPanel
            isOpen={activeDashboardPanel === 'gis-geometries'}
            onClose={closeGisPanel}
            snapshot={gisGeometrySnapshot}
            offline={isOfflineLocked}
            visibility={gisActions.visibility}
            visibleCount={gisActions.visibleCount}
            onToggle={gisActions.toggle}
            onZoom={gisActions.zoom}
            onRetry={gisActions.retry}
            onRefresh={refreshGisGeometries}
            onShowAll={gisActions.showAll}
            onHideAll={gisActions.hideAll}
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
            onClose={closeLandmarkPanel}
            isOpen={activeDashboardPanel === 'landmarks'}
          />

          {/* ---- GPS panel ---- */}
          <GpsPanel
            isOpen={activeDashboardPanel === 'gps'}
            onClose={closeGpsPanel}
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

          <DashboardLandmarkDialogs
            detail={{
              value: isActive ? selectedOverlayMarkerDetail : null,
              onClose: clearSelectedMarkerDetail,
              onCreate: handleOpenCreateLandmark,
              onEdit: handleOpenEditLandmark,
              onDelete: handleOpenDeleteLandmark,
            }}
            form={{
              value: landmarkForm,
              collections: landmarkCollections,
              busy: landmarkFormBusy,
              error: landmarkFormError,
              onSubmit: handleSubmitLandmarkForm,
              onCancel: handleCancelLandmarkForm,
            }}
            deletion={{
              target: landmarkDeleteTarget,
              busy: landmarkDeleteBusy,
              onConfirm: handleConfirmDeleteLandmark,
              onCancel: handleCancelDeleteLandmark,
            }}
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

          <DashboardLandmarkFeedback toast={landmarkToast} longPressRing={longPressRing} />

          </div>
          {!editingArea && <AppTabBar
            activeDashboardPanel={activeDashboardPanel}
            onDashboardPanelChange={onDashboardPanelChange}
            isGpsRecording={gpsRecordingState !== 'idle'}
            onTabPress={closeGpsOverlays}
            pendingOpsCount={pendingOpsCount}
          />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
