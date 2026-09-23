import { Layer, Source } from 'react-map-gl/maplibre';
import type { GpsRecordingState } from '../../types/gpsTrack';
import { createGeoJSONLineWidth, GEOJSON_LINE_LAYOUT, GEOJSON_LINE_SOURCE_OPTIONS } from '../../utils/geojsonLineRendering';

const SAVED_LINE_WIDTH = createGeoJSONLineWidth(6, 7);
const RECORDING_LINE_WIDTH = createGeoJSONLineWidth(4);

interface SavedGpsTrackLayerProps {
  featureCollection: GeoJSON.FeatureCollection;
}

function SavedGpsTrackLayer({ featureCollection }: SavedGpsTrackLayerProps) {
  if (featureCollection.features.length === 0) return null;
  return (
    <Source id="gps-tracks-source" type="geojson" data={featureCollection} {...GEOJSON_LINE_SOURCE_OPTIONS}>
      <Layer
        id="gps-tracks-line"
        type="line"
        layout={GEOJSON_LINE_LAYOUT}
        paint={{
          'line-color': ['coalesce', ['get', 'color'], '#38bdf8'],
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
  currentTrackFeatureCollection: GeoJSON.FeatureCollection;
  recordingState: GpsRecordingState;
}

export function GpsMapLayers({
  savedTrackFeatureCollection,
  currentTrackFeatureCollection,
  recordingState,
}: GpsMapLayersProps) {
  return (
    <>
      <SavedGpsTrackLayer featureCollection={savedTrackFeatureCollection} />
      <RecordingGpsTrackLayer
        featureCollection={currentTrackFeatureCollection}
        recordingState={recordingState}
      />
    </>
  );
}
