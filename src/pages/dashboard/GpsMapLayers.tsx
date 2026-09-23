import { visibleRecordsFilter } from '../../utils/viewerFilters';
import { Layer, Source } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GpsRecordingState } from '../../types/gpsTrack';
import { createGeoJSONLineWidth, GEOJSON_LINE_LAYOUT, GEOJSON_LINE_SOURCE_OPTIONS } from '../../utils/geojsonLineRendering';

const SAVED_LINE_WIDTH = createGeoJSONLineWidth(6, 7);
const RECORDING_LINE_WIDTH = createGeoJSONLineWidth(4);

interface SavedGpsTrackLayerProps {
  featureCollection: GeoJSON.FeatureCollection;
  visibility?: Readonly<Record<string, boolean>>;
  colors?: Readonly<Record<string, string>>;
}

function SavedGpsTrackLayer({ featureCollection, visibility, colors }: SavedGpsTrackLayerProps) {
  if (featureCollection.features.length === 0) return null;
  const color: ExpressionSpecification = colors
    ? ['to-color', ['get', ['to-string', ['get', 'id']], ['literal', colors]], '#38bdf8']
    : ['coalesce', ['get', 'color'], '#38bdf8'];
  return (
    <Source id="gps-tracks-source" type="geojson" data={featureCollection} {...GEOJSON_LINE_SOURCE_OPTIONS}>
      <Layer
        id="gps-tracks-line"
        filter={visibility && visibleRecordsFilter(visibility)}
        type="line"
        layout={GEOJSON_LINE_LAYOUT}
        paint={{
          'line-color': color,
          'line-width': SAVED_LINE_WIDTH,
          'line-opacity': 1,
          // Units are line widths; sub-pixel dashes disappear in Android WebViews.
          'line-dasharray': [2, 2],
        }}
      />
    </Source>
  );
}

interface RecordingGpsTrackLayerProps extends SavedGpsTrackLayerProps {
  recordingState: GpsRecordingState;
}

function RecordingGpsTrackLayer({
  featureCollection,
  recordingState,
}: RecordingGpsTrackLayerProps) {
  if (recordingState === 'idle' || featureCollection.features.length === 0) return null;
  return (
    <Source id="gps-recording-track-source" type="geojson" data={featureCollection} {...GEOJSON_LINE_SOURCE_OPTIONS}>
      <Layer
        id="gps-recording-track-line"
        type="line"
        layout={GEOJSON_LINE_LAYOUT}
        paint={{
          'line-color': '#ef4444',
          'line-width': RECORDING_LINE_WIDTH,
          'line-opacity': 0.9,
        }}
      />
    </Source>
  );
}

export interface GpsMapLayersProps {
  savedTrackFeatureCollection: GeoJSON.FeatureCollection;
  savedTrackVisibility?: Readonly<Record<string, boolean>>;
  savedTrackColors?: Readonly<Record<string, string>>;
  currentTrackFeatureCollection: GeoJSON.FeatureCollection;
  recordingState: GpsRecordingState;
}

export function GpsMapLayers({
  savedTrackFeatureCollection,
  savedTrackVisibility,
  savedTrackColors,
  currentTrackFeatureCollection,
  recordingState,
}: GpsMapLayersProps) {
  return (
    <>
      <SavedGpsTrackLayer featureCollection={savedTrackFeatureCollection} visibility={savedTrackVisibility} colors={savedTrackColors} />
      <RecordingGpsTrackLayer
        featureCollection={currentTrackFeatureCollection}
        recordingState={recordingState}
      />
    </>
  );
}
