import { createLandmarkLayers, createStationLayers, createSurfaceStationLayers } from '@speleodb/map-viewer';
import { Layer, Source } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { landmarkCollectionsFilter, visibleIdsFilter } from '../../utils/viewerFilters';
import { COLORS, MAP_OVERLAYS } from '../../constants';
import type { MapDisplayPreferences } from '../../types/mapDisplayPreferences';
import type {
  MapOverlayGeoJsonRecord,
  MapOverlayId,
  MapOverlaySizes,
} from '../../types/mapOverlay';
import type {
  OverlayIconAvailability,
  OverlayIconId,
} from './dashboardMapUtils';

const LANDMARK_COLLECTION_COLOR_EXPRESSION = [
  // Offline personal landmarks have no server-assigned collection color yet.
  // `to-color` skips blank/malformed values and keeps their symbols renderable.
  'to-color',
  ['get', 'collection_color'],
  COLORS.FALLBACK,
] as ExpressionSpecification;

const LANDMARK_COLLECTION_HALO_EXPRESSION = [
  'case',
  ['==', ['downcase', ['coalesce', ['get', 'collection_color'], '']], '#ffffff'],
  '#0f172a',
  '#ffffff',
] as ExpressionSpecification;

function markerMinZoom(overlayId: MapOverlayId): number {
  return MAP_OVERLAYS.find((overlay) => overlay.id === overlayId)!.markerMinZoom;
}

type LabeledOverlayId = Exclude<MapOverlayId, 'explorationLeads'>;

function labelMinZoom(overlayId: LabeledOverlayId): number {
  return MAP_OVERLAYS.find((overlay) => overlay.id === overlayId)!.labelMinZoom!;
}

function overlaySizes(overlayId: MapOverlayId): MapOverlaySizes {
  return MAP_OVERLAYS.find((overlay) => overlay.id === overlayId)!.sizes;
}

interface VisibleOverlayMapLayersProps {
  visible: boolean;
  filter?: ExpressionSpecification;
  data?: GeoJSON.FeatureCollection;
}

function LandmarkMapLayers({ visible, data, filter }: VisibleOverlayMapLayersProps) {
  if (!data) return null;
  const sizes = overlaySizes('landmarks');
  const layers = createLandmarkLayers({
    sourceId: 'landmarks-source', markerId: 'landmarks-layer', labelId: 'landmarks-labels',
    markerMinZoom: markerMinZoom('landmarks'), labelMinZoom: labelMinZoom('landmarks'),
    markerSize: sizes.markerTextSize!, labelSize: sizes.labelTextSize!,
    color: LANDMARK_COLLECTION_COLOR_EXPRESSION, haloColor: LANDMARK_COLLECTION_HALO_EXPRESSION,
    visible, filter,
  });
  return (
    <Source id="landmarks-source" type="geojson" data={data}>
      {layers.map(layer => <Layer key={layer.id} {...layer} />)}
    </Source>
  );
}

function SurfaceStationMapLayers({ visible, data }: VisibleOverlayMapLayersProps) {
  if (!data) return null;
  const sizes = overlaySizes('surfaceStations');
  const layers = createSurfaceStationLayers({
    sourceId: 'surface-stations-source', markerId: 'surface-stations-layer', labelId: 'surface-stations-labels',
    markerMinZoom: markerMinZoom('surfaceStations'), labelMinZoom: labelMinZoom('surfaceStations'),
    markerSize: sizes.markerTextSize!, labelSize: sizes.labelTextSize!,
    color: ['coalesce', ['get', 'color'], '#fb923c'], visible,
  });
  return (
    <Source id="surface-stations-source" type="geojson" data={data}>
      {layers.map(layer => <Layer key={layer.id} {...layer} />)}
    </Source>
  );
}

const SUBSURFACE_ICON_LAYERS: ReadonlyArray<{
  layerId: string;
  stationType: keyof MapDisplayPreferences['stationTypes'];
  iconId: OverlayIconId;
}> = [
  {
    layerId: 'subsurface-stations-biology-icons',
    stationType: 'biology',
    iconId: 'biology-station-icon',
  },
  {
    layerId: 'subsurface-stations-bone-icons',
    stationType: 'bone',
    iconId: 'bone-station-icon',
  },
  {
    layerId: 'subsurface-stations-artifact-icons',
    stationType: 'artifact',
    iconId: 'artifact-station-icon',
  },
  {
    layerId: 'subsurface-stations-geology-icons',
    stationType: 'geology',
    iconId: 'geology-station-icon',
  },
];

interface SubsurfaceStationMapLayersProps {
  visible: boolean;
  stationTypes: MapDisplayPreferences['stationTypes'];
  filter?: ExpressionSpecification;
  data?: GeoJSON.FeatureCollection;
  iconsLoaded: boolean;
  iconAvailability: OverlayIconAvailability;
}

function SubsurfaceStationMapLayers({
  visible,
  stationTypes,
  filter,
  data,
  iconsLoaded,
  iconAvailability,
}: SubsurfaceStationMapLayersProps) {
  if (!data) return null;
  const sizes = overlaySizes('subsurfaceStations');
  const layers = createStationLayers({
    sourceId: 'subsurface-stations-source', circleId: 'subsurface-stations-circles',
    labelId: 'subsurface-stations-labels', color: ['coalesce', ['get', 'color'], '#fb923c'],
    markerSize: sizes.markerCircleRadius!, iconSize: sizes.markerIconSize!, labelSize: sizes.labelTextSize!,
    markerMinZoom: markerMinZoom('subsurfaceStations'), labelMinZoom: labelMinZoom('subsurfaceStations'),
    visible, filter, stationTypes,
    icons: SUBSURFACE_ICON_LAYERS.map(icon => ({
      ...icon, available: iconsLoaded && iconAvailability[icon.iconId],
    })),
  });
  return (
    <Source id="subsurface-stations-source" type="geojson" data={data}>
      {layers.map(layer => <Layer key={layer.id} {...layer} />)}
    </Source>
  );
}

interface IconFallbackMapLayerProps {
  visible: boolean;
  filter?: ExpressionSpecification;
  data?: GeoJSON.FeatureCollection;
  iconsLoaded: boolean;
  iconAvailable: boolean;
}

function ExplorationLeadMapLayers({
  filter,
  visible,
  data,
  iconsLoaded,
  iconAvailable,
}: IconFallbackMapLayerProps) {
  if (!data) return null;
  const sizes = overlaySizes('explorationLeads');
  return (
    <Source id="exploration-leads-source" type="geojson" data={data}>
      {iconsLoaded && iconAvailable && (
        <Layer
          id="exploration-leads-icon-layer"
        filter={filter}
          type="symbol"
          minzoom={markerMinZoom('explorationLeads')}
          layout={{
            visibility: visible ? 'visible' : 'none',
            'icon-image': 'exploration-lead-icon',
            'icon-size': sizes.markerIconSize,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
          paint={{ 'icon-opacity': 1 }}
        />
      )}
      {iconsLoaded && !iconAvailable && (
        <Layer
          id="exploration-leads-fallback-layer"
        filter={filter}
          type="circle"
          minzoom={markerMinZoom('explorationLeads')}
          layout={{ visibility: visible ? 'visible' : 'none' }}
          paint={{
            'circle-radius': sizes.fallbackCircleRadius,
            'circle-color': '#EF4444',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 1,
          }}
        />
      )}
    </Source>
  );
}

function CylinderInstallMapLayers({
  filter,
  visible,
  data,
  iconsLoaded,
  iconAvailable,
}: IconFallbackMapLayerProps) {
  if (!data) return null;
  const sizes = overlaySizes('cylinderInstalls');
  return (
    <Source id="cylinder-installs-source" type="geojson" data={data}>
      {iconsLoaded && iconAvailable && (
        <Layer
          id="cylinder-installs-icon-layer"
        filter={filter}
          type="symbol"
          minzoom={markerMinZoom('cylinderInstalls')}
          layout={{
            visibility: visible ? 'visible' : 'none',
            'icon-image': 'cylinder-icon',
            'icon-size': sizes.markerIconSize,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
          paint={{ 'icon-opacity': 1 }}
        />
      )}
      {iconsLoaded && !iconAvailable && (
        <Layer
          id="cylinder-installs-fallback-layer"
        filter={filter}
          type="symbol"
          minzoom={markerMinZoom('cylinderInstalls')}
          layout={{
            visibility: visible ? 'visible' : 'none',
            'text-field': '●',
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': sizes.fallbackTextSize,
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
        filter={filter}
        type="symbol"
        minzoom={labelMinZoom('cylinderInstalls')}
        layout={{
          visibility: visible ? 'visible' : 'none',
          'text-field': [
            'concat',
            ['coalesce', ['to-string', ['get', 'install_date']], ''],
            ' @ ',
            ['coalesce', ['to-string', ['get', 'pressure']], ''],
            ' ',
            ['case', ['==', ['get', 'pressure_unit_system'], 'imperial'], 'PSI', 'BAR'],
          ],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': sizes.labelTextSize,
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
  );
}

export interface OverlayMapLayersProps {
  visibleOverlayGeoJsonData: MapOverlayGeoJsonRecord;
  visibleLandmarksGeoJSON?: GeoJSON.FeatureCollection;
  mapDisplayPreferences: MapDisplayPreferences;
  activeProjectIds?: ReadonlySet<string>;
  collectionVisibility?: Readonly<Record<string, boolean>>;
  iconsLoaded: boolean;
  iconAvailability: OverlayIconAvailability;
}

export function OverlayMapLayers({
  visibleOverlayGeoJsonData,
  visibleLandmarksGeoJSON,
  activeProjectIds,
  collectionVisibility = {},
  mapDisplayPreferences,
  iconsLoaded,
  iconAvailability,
}: OverlayMapLayersProps) {
  return (
    <>
      <LandmarkMapLayers visible={mapDisplayPreferences.categories.landmarks} data={visibleLandmarksGeoJSON} filter={landmarkCollectionsFilter(collectionVisibility)} />
      <SurfaceStationMapLayers
        visible={mapDisplayPreferences.categories.surfaceStations}
        data={visibleOverlayGeoJsonData.surfaceStations}
      />
      <SubsurfaceStationMapLayers
        visible={mapDisplayPreferences.categories.surveyStations}
        stationTypes={mapDisplayPreferences.stationTypes}
        filter={activeProjectIds && visibleIdsFilter(activeProjectIds, 'project')}
        data={visibleOverlayGeoJsonData.subsurfaceStations}
        iconsLoaded={iconsLoaded}
        iconAvailability={iconAvailability}
      />
      <ExplorationLeadMapLayers
        visible={mapDisplayPreferences.categories.explorationLeads}
        data={visibleOverlayGeoJsonData.explorationLeads}
        filter={activeProjectIds && visibleIdsFilter(activeProjectIds, 'project')}
        iconsLoaded={iconsLoaded}
        iconAvailable={iconAvailability['exploration-lead-icon']}
      />
      <CylinderInstallMapLayers
        visible={mapDisplayPreferences.categories.cylinders}
        data={visibleOverlayGeoJsonData.cylinderInstalls}
        filter={activeProjectIds && visibleIdsFilter(activeProjectIds, 'project_id')}
        iconsLoaded={iconsLoaded}
        iconAvailable={iconAvailability['cylinder-icon']}
      />
    </>
  );
}
