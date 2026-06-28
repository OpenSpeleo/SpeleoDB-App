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

function UserLocationLayer({ location }: { location: { lng: number; lat: number } | null }) {
  if (!location) return null;
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
      properties: {},
    }],
  };
  return (
    <Source id="user-location-source" type="geojson" data={data}>
      <Layer
        id="user-location-dot"
        type="circle"
        paint={{
          'circle-radius': 8,
          'circle-color': '#4285F4',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
        }}
      />
    </Source>
  );
}

export interface GpsMapLayersProps {
  savedTrackFeatureCollection: GeoJSON.FeatureCollection;
  currentTrackFeatureCollection: GeoJSON.FeatureCollection;
  recordingState: GpsRecordingState;
  userLocation: { lng: number; lat: number } | null;
}

export function GpsMapLayers({
  savedTrackFeatureCollection,
  currentTrackFeatureCollection,
  recordingState,
  userLocation,
}: GpsMapLayersProps) {
  return (
    <>
      <SavedGpsTrackLayer featureCollection={savedTrackFeatureCollection} />
      <RecordingGpsTrackLayer
        featureCollection={currentTrackFeatureCollection}
        recordingState={recordingState}
      />
      <UserLocationLayer location={userLocation} />
    </>
  );
}
