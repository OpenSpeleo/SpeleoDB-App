import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { DEFAULT_MAP_LAYER_ID, MAP, MAP_LAYERS } from '../../constants';
import { getCachedLayerStyle } from '../../services/TileCacheService';
import {
  setSelectedMapLayerId as persistSelectedMapLayerId,
} from '../../services/PreferencesService';
import type { MapLayerId } from '../../types/mapLayer';
import { PERMISSION_DENIED_SENTINEL } from '../../utils/geolocationError';
import {
  DEFAULT_OVERLAY_ICON_AVAILABILITY,
  OVERLAY_ICON_SOURCES,
  loadMapImage,
  lockMapOrientation,
  type OverlayIconAvailability,
  type OverlayIconId,
  type OverlayImageMap,
} from './dashboardMapUtils';

interface LocationPosition {
  coords: { longitude: number; latitude: number };
}

export interface DashboardMapShellDependencies {
  getLayerStyle: (layerId: MapLayerId) => Promise<Record<string, unknown>>;
  persistLayerId: (layerId: MapLayerId) => void;
  requestLocationPermission: () => Promise<string | undefined>;
  getCurrentLocation: () => Promise<LocationPosition>;
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
  requestLocationPermission: async () => (
    await Geolocation.requestPermissions({ permissions: ['location'] })
  ).location,
  getCurrentLocation: () => Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 10_000,
  }),
  impact: () => Haptics.impact({ style: ImpactStyle.Light }),
  loadIcons: loadOverlayIcons,
  lockOrientation: lockMapOrientation,
  reportStyleError: (error) => console.error('Failed to load map style:', error),
};

export interface DashboardMapShellOptions {
  mapRef: RefObject<MapRef | null>;
  selectedMapLayerId: MapLayerId;
  onSelectedMapLayerIdChange: (layerId: MapLayerId) => void;
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
  dependencies: DashboardMapShellDependencies,
) {
  const [isLocating, setIsLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [geoError, setGeoError] = useState<unknown>(null);
  const goToMyLocation = useCallback(async () => {
    setIsLocating(true);
    try {
      if (await dependencies.requestLocationPermission() !== 'granted') {
        setGeoError(PERMISSION_DENIED_SENTINEL);
        return;
      }
      const position = await dependencies.getCurrentLocation();
      const lng = position.coords.longitude;
      const lat = position.coords.latitude;
      setUserLocation({ lng, lat });
      const map = mapRef.current?.getMap() as MaplibreMap | undefined;
      map?.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 });
      dependencies.impact().catch(() => {});
    } catch (error: unknown) {
      setGeoError(error);
    } finally {
      setIsLocating(false);
    }
  }, [dependencies, mapRef]);
  const dismissGeoError = useCallback(() => setGeoError(null), []);
  return { isLocating, userLocation, geoError, goToMyLocation, dismissGeoError };
}

export function useDashboardMapShell({
  mapRef,
  selectedMapLayerId,
  onSelectedMapLayerIdChange,
  dependencies = DEFAULT_DEPENDENCIES,
}: DashboardMapShellOptions) {
  const [mapViewMetrics, setMapViewMetrics] = useState<{ zoom: number; latitude: number }>(() => ({
    zoom: MAP.DEFAULT_ZOOM,
    latitude: MAP.DEFAULT_CENTER[1],
  }));
  const mapStyle = useMapStyle(selectedMapLayerId, dependencies);
  const icons = useMapIcons(mapRef, dependencies);
  const location = useMapLocation(mapRef, dependencies);

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
    userLocation: location.userLocation,
    geoError: location.geoError,
    selectMapLayer,
    handleMapLoad: icons.handleMapLoad,
    handleMapMove,
    goToMyLocation: location.goToMyLocation,
    dismissGeoError: location.dismissGeoError,
  };
}
