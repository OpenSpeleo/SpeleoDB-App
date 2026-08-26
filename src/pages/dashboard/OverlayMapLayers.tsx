import { Layer, Source } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { COLORS, MAP_OVERLAYS } from '../../constants';
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

interface LandmarkMapLayersProps {
  visible: boolean;
  data?: GeoJSON.FeatureCollection;
}

function LandmarkMapLayers({ visible, data }: LandmarkMapLayersProps) {
  if (!visible || !data) return null;
  const sizes = overlaySizes('landmarks');
  return (
    <Source id="landmarks-source" type="geojson" data={data}>
      <Layer
        id="landmarks-layer"
        type="symbol"
        minzoom={markerMinZoom('landmarks')}
        layout={{
          'text-field': '▼',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': sizes.markerTextSize,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'text-color': LANDMARK_COLLECTION_COLOR_EXPRESSION,
          'text-halo-color': LANDMARK_COLLECTION_HALO_EXPRESSION,
          'text-halo-width': 2,
          'text-halo-blur': 0.5,
        }}
      />
      <Layer
        id="landmarks-labels"
        type="symbol"
        minzoom={labelMinZoom('landmarks')}
        layout={{
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.5],
          'text-size': sizes.labelTextSize,
          'text-anchor': 'top',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        }}
        paint={{
          'text-color': LANDMARK_COLLECTION_COLOR_EXPRESSION,
          'text-halo-color': LANDMARK_COLLECTION_HALO_EXPRESSION,
          'text-halo-width': 1.5,
        }}
      />
    </Source>
  );
}

function SurfaceStationMapLayers({ data }: { data?: GeoJSON.FeatureCollection }) {
  if (!data) return null;
  const sizes = overlaySizes('surfaceStations');
  return (
    <Source id="surface-stations-source" type="geojson" data={data}>
      <Layer
        id="surface-stations-layer"
        type="symbol"
        minzoom={markerMinZoom('surfaceStations')}
        layout={{
          'text-field': '◆',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': sizes.markerTextSize,
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
        minzoom={labelMinZoom('surfaceStations')}
        layout={{
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.2],
          'text-size': sizes.labelTextSize,
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
  );
}

const SUBSURFACE_ICON_LAYERS: ReadonlyArray<{
  layerId: string;
  stationType: string;
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
  data?: GeoJSON.FeatureCollection;
  iconsLoaded: boolean;
  iconAvailability: OverlayIconAvailability;
}

function SubsurfaceStationMapLayers({
  data,
  iconsLoaded,
  iconAvailability,
}: SubsurfaceStationMapLayersProps) {
  if (!data) return null;
  const sizes = overlaySizes('subsurfaceStations');
  return (
    <Source id="subsurface-stations-source" type="geojson" data={data}>
      <Layer
        id="subsurface-stations-circles"
        type="circle"
        filter={[
          'any',
          ['!', ['has', 'type']],
          ['==', ['get', 'type'], null],
          ['==', ['get', 'type'], 'sensor'],
        ]}
        minzoom={markerMinZoom('subsurfaceStations')}
        paint={{
          'circle-radius': sizes.markerCircleRadius,
          'circle-color': ['coalesce', ['get', 'color'], '#fb923c'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1,
        }}
      />
      {iconsLoaded && SUBSURFACE_ICON_LAYERS.map(({ layerId, stationType, iconId }) => (
        iconAvailability[iconId] ? (
          <Layer
            key={layerId}
            id={layerId}
            type="symbol"
            filter={['==', ['get', 'type'], stationType]}
            minzoom={markerMinZoom('subsurfaceStations')}
            layout={{
              'icon-image': iconId,
              'icon-size': sizes.markerIconSize,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
            paint={{ 'icon-opacity': 1 }}
          />
        ) : null
      ))}
      <Layer
        id="subsurface-stations-labels"
        type="symbol"
        minzoom={labelMinZoom('subsurfaceStations')}
        layout={{
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.2],
          'text-size': sizes.labelTextSize,
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
  );
}

interface IconFallbackMapLayerProps {
  data?: GeoJSON.FeatureCollection;
  iconsLoaded: boolean;
  iconAvailable: boolean;
}

function ExplorationLeadMapLayers({
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
          type="symbol"
          minzoom={markerMinZoom('explorationLeads')}
          layout={{
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
          type="circle"
          minzoom={markerMinZoom('explorationLeads')}
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
          type="symbol"
          minzoom={markerMinZoom('cylinderInstalls')}
          layout={{
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
          type="symbol"
          minzoom={markerMinZoom('cylinderInstalls')}
          layout={{
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
        type="symbol"
        minzoom={labelMinZoom('cylinderInstalls')}
        layout={{
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
  showLandmarks: boolean;
  iconsLoaded: boolean;
  iconAvailability: OverlayIconAvailability;
}

export function OverlayMapLayers({
  visibleOverlayGeoJsonData,
  visibleLandmarksGeoJSON,
  showLandmarks,
  iconsLoaded,
  iconAvailability,
}: OverlayMapLayersProps) {
  return (
    <>
      <LandmarkMapLayers visible={showLandmarks} data={visibleLandmarksGeoJSON} />
      <SurfaceStationMapLayers data={visibleOverlayGeoJsonData.surfaceStations} />
      <SubsurfaceStationMapLayers
        data={visibleOverlayGeoJsonData.subsurfaceStations}
        iconsLoaded={iconsLoaded}
        iconAvailability={iconAvailability}
      />
      <ExplorationLeadMapLayers
        data={visibleOverlayGeoJsonData.explorationLeads}
        iconsLoaded={iconsLoaded}
        iconAvailable={iconAvailability['exploration-lead-icon']}
      />
      <CylinderInstallMapLayers
        data={visibleOverlayGeoJsonData.cylinderInstalls}
        iconsLoaded={iconsLoaded}
        iconAvailable={iconAvailability['cylinder-icon']}
      />
    </>
  );
}
