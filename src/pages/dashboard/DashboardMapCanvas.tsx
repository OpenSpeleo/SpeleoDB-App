import { DownloadAreaMapLayers } from './DownloadAreaMapLayers';
import type { DownloadArea } from '../../types/downloadArea';
import { useCallback, useState, type PointerEventHandler, type RefObject } from 'react';
import type { StyleSpecification } from 'maplibre-gl';
import Map from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre';
import { MAP, MAP_LAYERS } from '../../constants';
import MapLayerControl from '../../components/map/MapLayerControl';
import DistanceScale from '../../components/map/DistanceScale';
import DepthGauge from '../../components/map/DepthGauge';
import { UserLocationIndicator } from '../../components/map/UserLocationIndicator';
import { MapCompass } from '../../components/map/MapCompass';
import { MapControlLayout } from '../../components/map/MapControlLayout';
import GeolocationErrorModal from '../../components/GeolocationErrorModal';
import { useAppForeground } from '../../hooks/useAppForeground';
import type { MapColorMode } from '../../types/mapColorMode';
import type { MapLayerId } from '../../types/mapLayer';
import type { MeasurementUnit } from '../../types/measurementUnit';
import type { UserMapLocation } from '../../types/userLocation';
import { selectUserMapLocation } from '../../utils/userLocation';
import { GpsMapLayers, type GpsMapLayersProps } from './GpsMapLayers';
import { OverlayMapLayers, type OverlayMapLayersProps } from './OverlayMapLayers';
import { ProjectMapLayers, type ProjectMapLayersProps } from './ProjectMapLayers';
import {
  useDashboardMapShell,
  type DashboardMapShellDependencies,
} from './useDashboardMapShell';

interface DashboardMapGestures {
  onStart: PointerEventHandler<HTMLDivElement>;
  onMove: PointerEventHandler<HTMLDivElement>;
  onEnd: PointerEventHandler<HTMLDivElement>;
  onMouseMove: (event: MapLayerMouseEvent) => void;
  onMouseLeave: () => void;
}

interface DashboardMapCanvasProps {
  downloadAreas?: readonly DownloadArea[];
  editingArea?: boolean;
  onOpenOfflineMaps?: () => void;
  mapRef: RefObject<MapRef | null>;
  selectedMapLayerId: MapLayerId;
  onSelectedMapLayerIdChange: (layerId: MapLayerId) => void;
  isOfflineLocked: boolean;
  layerOfflineSync: Record<string, boolean>;
  projectLayers: ProjectMapLayersProps;
  overlayLayers: Omit<OverlayMapLayersProps, 'iconsLoaded' | 'iconAvailability'>;
  gpsLayers: GpsMapLayersProps;
  recordingLocation: UserMapLocation | null;
  isActive: boolean;
  gestures: DashboardMapGestures;
  colorMode: MapColorMode;
  measurementUnit: MeasurementUnit;
  probedDepth: number | null;
  onMapReady?: () => void;
  dependencies?: DashboardMapShellDependencies;
}

interface MapViewportProps {
  downloadAreas?: readonly DownloadArea[];
  mapRef: RefObject<MapRef | null>;
  mapStyle: Record<string, unknown> | null;
  projectLayers: ProjectMapLayersProps;
  overlayLayers: Omit<OverlayMapLayersProps, 'iconsLoaded' | 'iconAvailability'>;
  gpsLayers: GpsMapLayersProps;
  userLocation: UserMapLocation | null;
  headingActive: boolean;
  compassVisible: boolean;
  runtimeActive: boolean;
  depthMode: boolean;
  toolbarVisible: boolean;
  iconsLoaded: boolean;
  iconAvailability: OverlayMapLayersProps['iconAvailability'];
  gestures: DashboardMapGestures;
  onLoad: () => void;
  onMove: (event: Parameters<NonNullable<React.ComponentProps<typeof Map>['onMove']>>[0]) => void;
}

function MapViewport({
  downloadAreas = [],
  mapRef,
  mapStyle,
  projectLayers,
  overlayLayers,
  gpsLayers,
  userLocation,
  headingActive,
  compassVisible,
  runtimeActive,
  depthMode,
  toolbarVisible,
  iconsLoaded,
  iconAvailability,
  gestures,
  onLoad,
  onMove,
}: MapViewportProps) {
  if (!mapStyle) return null;
  return (
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
      doubleClickZoom={false}
      touchZoomRotate
      style={{ width: '100%', height: '100%' }}
      mapStyle={mapStyle as StyleSpecification}
      attributionControl={{ compact: true }}
      onLoad={onLoad}
      onMove={onMove}
      onMouseMove={gestures.onMouseMove}
      onMouseLeave={gestures.onMouseLeave}
    >
      <DownloadAreaMapLayers areas={downloadAreas} mapRef={mapRef} />
      <ProjectMapLayers {...projectLayers} />
      <OverlayMapLayers
        {...overlayLayers}
        iconsLoaded={iconsLoaded}
        iconAvailability={iconAvailability}
      />
      <GpsMapLayers {...gpsLayers} />
      <UserLocationIndicator location={userLocation} headingActive={headingActive} />
      {compassVisible && <MapCompass active={runtimeActive} />}
      <MapControlLayout compassVisible={compassVisible} depthMode={depthMode} toolbarVisible={toolbarVisible} />
    </Map>
  );
}

function MyLocationButton({
  isLocating,
  isActive,
  onClick,
}: {
  isLocating: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  const engaged = isActive || isLocating;
  return (
    <button
      onClick={onClick}
      aria-pressed={engaged}
      className={`map-control-button${engaged ? ' map-control-button--active' : ''}`}
      aria-label={engaged ? 'Turn off live location' : 'Turn on live location'}
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
  );
}

function MapChrome({
  selectedMapLayerId,
  isOfflineLocked,
  layerOfflineSync,
  onSelectLayer,
  isLocating,
  isLocationModeActive,
  onLocate,
  onOpenOfflineMaps,
  compassVisible,
  onToggleCompass,
}: Pick<DashboardMapCanvasProps, 'selectedMapLayerId' | 'isOfflineLocked' | 'layerOfflineSync' | 'onOpenOfflineMaps'> & {
  onSelectLayer: (layerId: string) => void;
  isLocating: boolean;
  isLocationModeActive: boolean;
  onLocate: () => void;
  compassVisible: boolean;
  onToggleCompass: () => void;
}) {
  return (
    <div className="map-control-stack">
      <MyLocationButton
        isLocating={isLocating}
        isActive={isLocationModeActive}
        onClick={onLocate}
      />
      <div className="map-layer-control-slot">
        <MapLayerControl
          layers={MAP_LAYERS}
          selectedLayerId={selectedMapLayerId}
          isOfflineLocked={isOfflineLocked}
          layerOfflineSync={layerOfflineSync}
          onSelectLayer={onSelectLayer}
        />
      </div>
      {onOpenOfflineMaps && (
        <button type="button" className="map-control-button" onClick={onOpenOfflineMaps} aria-label="Offline Maps">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
        </button>
      )}
      <button
        type="button"
        className={`map-control-button${compassVisible ? ' map-control-button--active' : ''}`}
        onClick={onToggleCompass}
        aria-label={compassVisible ? 'Hide compass' : 'Show compass'}
        aria-pressed={compassVisible}
        data-testid="compass-toggle"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
          {compassVisible && <path d="m3 3 18 18" strokeWidth="2.25" data-testid="compass-toggle-slash" />}
        </svg>
      </button>
    </div>
  );
}

export function DashboardMapCanvas({
  downloadAreas,
  editingArea = false,
  onOpenOfflineMaps,
  mapRef,
  selectedMapLayerId,
  onSelectedMapLayerIdChange,
  isOfflineLocked,
  layerOfflineSync,
  projectLayers,
  overlayLayers,
  gpsLayers,
  recordingLocation,
  isActive,
  gestures,
  colorMode,
  measurementUnit,
  probedDepth,
  onMapReady,
  dependencies,
}: DashboardMapCanvasProps) {
  const [compassVisible, setCompassVisible] = useState(false);
  const appForeground = useAppForeground();
  const runtimeActive = isActive && appForeground;
  const shell = useDashboardMapShell({
    mapRef,
    selectedMapLayerId,
    onSelectedMapLayerIdChange,
    runtimeActive,
    dependencies,
  });
  const userLocation = selectUserMapLocation(shell.userLocation, recordingLocation);
  const headingActive = runtimeActive && (
    shell.locationModeActive || gpsLayers.recordingState === 'recording'
  );
  const handleShellMapLoad = shell.handleMapLoad;
  const handleMapLoad = useCallback(() => {
    handleShellMapLoad();
    onMapReady?.();
  }, [handleShellMapLoad, onMapReady]);
  return (
    <>
      <div
        className="relative w-full h-full dashboard-map-touch-surface"
        onPointerDownCapture={editingArea ? undefined : gestures.onStart}
        onPointerMoveCapture={editingArea ? undefined : gestures.onMove}
        onPointerUpCapture={editingArea ? undefined : gestures.onEnd}
        onPointerCancelCapture={editingArea ? undefined : gestures.onEnd}
      >
        <MapViewport
          downloadAreas={downloadAreas}
          mapRef={mapRef}
          mapStyle={shell.mapStyle}
          projectLayers={projectLayers}
          overlayLayers={overlayLayers}
          gpsLayers={gpsLayers}
          userLocation={userLocation}
          headingActive={headingActive}
          compassVisible={compassVisible && !editingArea}
          runtimeActive={runtimeActive}
          depthMode={colorMode === 'depth'}
          toolbarVisible={!editingArea}
          iconsLoaded={shell.overlayIconsLoaded}
          iconAvailability={shell.overlayIconAvailability}
          gestures={gestures}
          onLoad={handleMapLoad}
          onMove={shell.handleMapMove}
        />
        <div className="absolute bottom-2 left-2 z-10 dashboard-map-distance-scale">
          <DistanceScale
            zoom={shell.mapViewMetrics.zoom}
            latitude={shell.mapViewMetrics.latitude}
            measurementUnit={measurementUnit}
          />
        </div>
        {colorMode === 'depth' && (
          <div
            className="absolute right-[68px] z-10 dashboard-map-depth-gauge"
            style={{ top: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 64px)' }}
          >
            <DepthGauge
              depthDomain={projectLayers.depthDomain}
              currentDepth={probedDepth}
              measurementUnit={measurementUnit}
            />
          </div>
        )}
      </div>
      {!editingArea && <MapChrome
        selectedMapLayerId={selectedMapLayerId}
        isOfflineLocked={isOfflineLocked}
        layerOfflineSync={layerOfflineSync}
        onSelectLayer={shell.selectMapLayer}
        isLocating={shell.isLocating}
        isLocationModeActive={shell.locationModeActive}
        onLocate={shell.toggleLocationMode}
        onOpenOfflineMaps={onOpenOfflineMaps}
        compassVisible={compassVisible}
        onToggleCompass={() => setCompassVisible((visible) => !visible)}
      />}

      <GeolocationErrorModal error={shell.geoError} onDismiss={shell.dismissGeoError} />
      {!shell.mapStyle && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-slate-400">Loading map…</span>
          </div>
        </div>
      )}
    </>
  );
}
