import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { DEFAULT_MAP_LAYER_ID, MAP, MAP_LAYERS } from '../../constants';
import { useLiveUserLocation } from '../../hooks/useLiveUserLocation';
import { GeolocationWatcher, type LocationWatcher } from '../../services/GeolocationWatcher';
import { getCachedLayerStyle } from '../../services/TileCacheService';
import {
  setSelectedMapLayerId as persistSelectedMapLayerId,
} from '../../services/PreferencesService';
import type { MapLayerId } from '../../types/mapLayer';
import type { UserMapLocation } from '../../types/userLocation';
import {
  DEFAULT_OVERLAY_ICON_AVAILABILITY,
  OVERLAY_ICON_SOURCES,
  loadMapImage,
  lockMapOrientation,
  type OverlayIconAvailability,
  type OverlayIconId,
  type OverlayImageMap,
} from './dashboardMapUtils';

export interface DashboardMapShellDependencies {
  getLayerStyle: (layerId: MapLayerId) => Promise<Record<string, unknown>>;
  persistLayerId: (layerId: MapLayerId) => void;
  locationWatcher: LocationWatcher;
  impact: () => Promise<void>;
  loadIcons: (map: OverlayImageMap) => Promise<OverlayIconAvailability>;
  lockOrientation: (mapRef: MapRef | null) => void;
  reportStyleError: (error: unknown) => void;
}

async function loadOverlayIcons(map: OverlayImageMap): Promise<OverlayIconAvailability> {
  const availability: OverlayIconAvailability = { ...DEFAULT_OVERLAY_ICON_AVAILABILITY };
  const iconEntries = Object.entries(OVERLAY_ICON_SOURCES) as Array<[OverlayIconId, string]>;
  for (const [iconId, iconSrc] of iconEntries) {
    availability[iconId] = await loadMapImage(map, iconId, iconSrc);
  }
  return availability;
}

const DEFAULT_DEPENDENCIES: DashboardMapShellDependencies = {
  getLayerStyle: getCachedLayerStyle,
  persistLayerId: persistSelectedMapLayerId,
  locationWatcher: new GeolocationWatcher(),
  impact: () => Haptics.impact({ style: ImpactStyle.Light }),
  loadIcons: loadOverlayIcons,
  lockOrientation: lockMapOrientation,
  reportStyleError: (error) => console.error('Failed to load map style:', error),
};

export interface DashboardMapShellOptions {
  mapRef: RefObject<MapRef | null>;
  selectedMapLayerId: MapLayerId;
  onSelectedMapLayerIdChange: (layerId: MapLayerId) => void;
  runtimeActive?: boolean;
  dependencies?: DashboardMapShellDependencies;
}

function useMapStyle(
  selectedMapLayerId: MapLayerId,
  dependencies: DashboardMapShellDependencies,
) {
  const [mapStyle, setMapStyle] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void dependencies.getLayerStyle(selectedMapLayerId).then((style) => {
      if (!cancelled) setMapStyle(style);
    }).catch(dependencies.reportStyleError);
    return () => { cancelled = true; };
  }, [dependencies, selectedMapLayerId]);
  return mapStyle;
}

function useMapIcons(
  mapRef: RefObject<MapRef | null>,
  dependencies: DashboardMapShellDependencies,
) {
  const [availability, setAvailability] =
    useState<OverlayIconAvailability>(DEFAULT_OVERLAY_ICON_AVAILABILITY);
  const [loaded, setLoaded] = useState(false);
  const loadIcons = useCallback(async () => {
    const map = mapRef.current?.getMap() as unknown as OverlayImageMap | undefined;
    if (!map) return;
    setLoaded(false);
    setAvailability(await dependencies.loadIcons(map));
    setLoaded(true);
  }, [dependencies, mapRef]);
  const handleMapLoad = useCallback(() => {
    dependencies.lockOrientation(mapRef.current);
    void loadIcons();
  }, [dependencies, loadIcons, mapRef]);
  return { availability, loaded, handleMapLoad };
}

function useMapLocation(
  mapRef: RefObject<MapRef | null>,
  runtimeActive: boolean,
  dependencies: DashboardMapShellDependencies,
) {
  const handleFirstFix = useCallback((location: UserMapLocation) => {
    const map = mapRef.current?.getMap() as MaplibreMap | undefined;
    map?.flyTo({ center: [location.lng, location.lat], zoom: 15, duration: 1200 });
    dependencies.impact().catch(() => {});
  }, [dependencies, mapRef]);
  return useLiveUserLocation({
    runtimeActive,
    watcher: dependencies.locationWatcher,
    onFirstFix: handleFirstFix,
  });
}

export function useDashboardMapShell({
  mapRef,
  selectedMapLayerId,
  onSelectedMapLayerIdChange,
  runtimeActive = true,
  dependencies = DEFAULT_DEPENDENCIES,
}: DashboardMapShellOptions) {
  const [mapViewMetrics, setMapViewMetrics] = useState<{ zoom: number; latitude: number }>(() => ({
    zoom: MAP.DEFAULT_ZOOM,
    latitude: MAP.DEFAULT_CENTER[1],
  }));
  const mapStyle = useMapStyle(selectedMapLayerId, dependencies);
  const icons = useMapIcons(mapRef, dependencies);
  const location = useMapLocation(mapRef, runtimeActive, dependencies);

  const selectMapLayer = useCallback((layerId: string) => {
    const nextLayerId = (MAP_LAYERS.find((layer) => layer.id === layerId)?.id
      ?? DEFAULT_MAP_LAYER_ID) as MapLayerId;
    dependencies.persistLayerId(nextLayerId);
    onSelectedMapLayerIdChange(nextLayerId);
  }, [dependencies, onSelectedMapLayerIdChange]);

  const handleMapMove = useCallback((event: ViewStateChangeEvent) => {
    const { zoom, latitude } = event.viewState;
    if (!Number.isFinite(zoom) || !Number.isFinite(latitude)) return;
    setMapViewMetrics((previous) => (
      previous.zoom === zoom && previous.latitude === latitude
        ? previous
        : { zoom, latitude }
    ));
  }, []);

  return {
    mapViewMetrics,
    mapStyle,
    overlayIconAvailability: icons.availability,
    overlayIconsLoaded: icons.loaded,
    isLocating: location.isLocating,
    locationModeActive: location.locationModeActive,
    userLocation: location.location,
    geoError: location.error,
    selectMapLayer,
    handleMapLoad: icons.handleMapLoad,
    handleMapMove,
    toggleLocationMode: location.toggleLocationMode,
    dismissGeoError: location.dismissError,
  };
}
