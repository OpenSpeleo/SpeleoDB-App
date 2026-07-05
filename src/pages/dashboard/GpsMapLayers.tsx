import { Layer, Source } from 'react-map-gl/maplibre';
import type { GpsRecordingState } from '../../types/gpsTrack';

interface SavedGpsTrackLayerProps {
  featureCollection: GeoJSON.FeatureCollection;
}

function SavedGpsTrackLayer({ featureCollection }: SavedGpsTrackLayerProps) {
  if (featureCollection.features.length === 0) return null;
  return (
    <Source id="gps-tracks-source" type="geojson" data={featureCollection}>
      <Layer
        id="gps-tracks-line"
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': ['coalesce', ['get', 'color'], '#38bdf8'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 14, 5, 18, 7],
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
    <Source id="gps-recording-track-source" type="geojson" data={featureCollection}>
      <Layer
        id="gps-recording-track-line"
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': '#ef4444',
          'line-width': 4,
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
