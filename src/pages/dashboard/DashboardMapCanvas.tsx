import { useCallback, type PointerEventHandler, type RefObject } from 'react';
import type { StyleSpecification } from 'maplibre-gl';
import Map from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre';
import { MAP, MAP_LAYERS } from '../../constants';
import MapLayerControl from '../../components/map/MapLayerControl';
import DistanceScale from '../../components/map/DistanceScale';
import DepthGauge from '../../components/map/DepthGauge';
import { UserLocationIndicator } from '../../components/map/UserLocationIndicator';
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
  mapRef: RefObject<MapRef | null>;
  mapStyle: Record<string, unknown> | null;
  projectLayers: ProjectMapLayersProps;
  overlayLayers: Omit<OverlayMapLayersProps, 'iconsLoaded' | 'iconAvailability'>;
  gpsLayers: GpsMapLayersProps;
  userLocation: UserMapLocation | null;
  headingActive: boolean;
  iconsLoaded: boolean;
  iconAvailability: OverlayMapLayersProps['iconAvailability'];
  gestures: DashboardMapGestures;
  onLoad: () => void;
  onMove: (event: Parameters<NonNullable<React.ComponentProps<typeof Map>['onMove']>>[0]) => void;
}

function MapViewport({
  mapRef,
  mapStyle,
  projectLayers,
  overlayLayers,
  gpsLayers,
  userLocation,
  headingActive,
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
      <ProjectMapLayers {...projectLayers} />
      <OverlayMapLayers
        {...overlayLayers}
        iconsLoaded={iconsLoaded}
        iconAvailability={iconAvailability}
      />
      <GpsMapLayers {...gpsLayers} />
      <UserLocationIndicator location={userLocation} headingActive={headingActive} />
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
      className={`absolute right-3 z-10 w-11 h-11 flex items-center justify-center
                 rounded-full backdrop-blur-sm border text-slate-100
                 transition-colors shadow-lg shadow-black/40
                 ${engaged
                   ? 'bg-blue-600 border-blue-400 hover:bg-blue-500'
                   : 'bg-slate-900/80 border-slate-600/60 hover:bg-slate-800/90'}`}
      style={{ top: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 12px)' }}
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
}: Pick<DashboardMapCanvasProps, 'selectedMapLayerId' | 'isOfflineLocked' | 'layerOfflineSync'> & {
  onSelectLayer: (layerId: string) => void;
  isLocating: boolean;
  isLocationModeActive: boolean;
  onLocate: () => void;
}) {
  return (
    <>
      <MyLocationButton
        isLocating={isLocating}
        isActive={isLocationModeActive}
        onClick={onLocate}
      />
      <div
        className="absolute right-3 z-10"
        style={{ top: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 64px)' }}
      >
        <MapLayerControl
          layers={MAP_LAYERS}
          selectedLayerId={selectedMapLayerId}
          isOfflineLocked={isOfflineLocked}
          layerOfflineSync={layerOfflineSync}
          onSelectLayer={onSelectLayer}
        />
      </div>
    </>
  );
}

export function DashboardMapCanvas({
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
        onPointerDownCapture={gestures.onStart}
        onPointerMoveCapture={gestures.onMove}
        onPointerUpCapture={gestures.onEnd}
        onPointerCancelCapture={gestures.onEnd}
      >
        <MapViewport
          mapRef={mapRef}
          mapStyle={shell.mapStyle}
          projectLayers={projectLayers}
          overlayLayers={overlayLayers}
          gpsLayers={gpsLayers}
          userLocation={userLocation}
          headingActive={headingActive}
          iconsLoaded={shell.overlayIconsLoaded}
          iconAvailability={shell.overlayIconAvailability}
          gestures={gestures}
          onLoad={handleMapLoad}
          onMove={shell.handleMapMove}
        />
        <div className="absolute bottom-2 left-2 z-10">
          <DistanceScale
            zoom={shell.mapViewMetrics.zoom}
            latitude={shell.mapViewMetrics.latitude}
            measurementUnit={measurementUnit}
          />
        </div>
        {colorMode === 'depth' && (
          <div
            className="absolute right-3 z-10"
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
      <MapChrome
        selectedMapLayerId={selectedMapLayerId}
        isOfflineLocked={isOfflineLocked}
        layerOfflineSync={layerOfflineSync}
        onSelectLayer={shell.selectMapLayer}
        isLocating={shell.isLocating}
        isLocationModeActive={shell.locationModeActive}
        onLocate={shell.toggleLocationMode}
      />
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
