/**
 * Dashboard -- full-screen map with per-project GeoJSON layers.
 *
 * Replaces the old card-based dashboard with a maplibre-gl map.
 * Each project's cached GeoJSON is rendered as a colored layer that
 * can be toggled on/off via the ProjectPanel.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
import AppTabBar from '../components/AppTabBar';
import type { MapColorMode } from '../types/mapColorMode';
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
  useVisibleDashboardOverlays,
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
  showLandmarks: boolean;
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
  } = useDashboardProjectVisibility({
    projects: sortedProjects,
    eligibleProjects: geoJsonProjects,
    geoJsonData,
    projectBounds,
    mapRef,
    onClosePanel: closeProjectPanel,
  });
  const visibleOverlayGeoJsonData = useVisibleDashboardOverlays(
    overlayGeoJsonData,
    effectiveActiveProjectIds,
  );

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
  });

  const closeGpsPanel = useCallback(
    () => onDashboardPanelChange(null),
    [onDashboardPanelChange],
  );
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
            selectedMapLayerId={selectedMapLayerId}
            onSelectedMapLayerIdChange={onSelectedMapLayerIdChange}
            isOfflineLocked={isOfflineLocked}
            layerOfflineSync={layerOfflineSync}
            projectLayers={{
              projects: sortedProjects,
              activeProjectIds: effectiveActiveProjectIds,
              geoJsonData,
              projectColorsById,
              colorMode,
              depthDomain,
            }}
            overlayLayers={{
              visibleOverlayGeoJsonData,
              visibleLandmarksGeoJSON,
              showLandmarks,
            }}
            gpsLayers={{
              savedTrackFeatureCollection,
              currentTrackFeatureCollection,
              recordingState: gpsRecordingState,
            }}
            recordingLocation={currentRecordingLocation}
            gestures={{
              onStart: handleMapGestureStart,
              onMove: handleMapGestureMove,
              onEnd: handleMapGestureEnd,
              onMouseMove: handleMapMouseMove,
              onMouseLeave: handleMapMouseLeave,
            }}
            colorMode={colorMode}
            measurementUnit={measurementUnit}
            probedDepth={probedDepth}
            onMapReady={fitInitialProjectBounds}
          />

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
              value: selectedOverlayMarkerDetail,
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
          <AppTabBar
            activeDashboardPanel={activeDashboardPanel}
            onDashboardPanelChange={onDashboardPanelChange}
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
