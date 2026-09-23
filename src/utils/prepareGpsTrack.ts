import type { RecordedPoint } from '../types/gpsTrack';
import { isValidLatLng } from './coordinates';
import { yieldToMainThread } from './yieldToMainThread';
import { recordViewerWork } from './viewerWorkTiming';

export interface PreparedGpsTrack {
  revision: string;
  feature: GeoJSON.Feature<GeoJSON.LineString> | null;
  bounds: [[number, number], [number, number]] | null;
}

/** Convert each geometry revision once, yielding between bounded vertex batches. */
export async function prepareGpsTrack(
  points: readonly RecordedPoint[],
  revision: string,
  isCurrent: () => boolean,
  yieldWork = yieldToMainThread,
): Promise<PreparedGpsTrack | undefined> {
  const coordinates: GeoJSON.Position[] = [];
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  for (let offset = 0; offset < points.length; offset += 1000) {
    await yieldWork();
    if (!isCurrent()) return;
    const sliceStartedAt = performance.now();
    for (let index = offset; index < Math.min(offset + 1000, points.length); index++) {
      const point = points[index];
      if (!isValidLatLng(point.latitude, point.longitude)) continue;
      const position = [point.longitude, point.latitude];
      if (typeof point.altitude === 'number' && Number.isFinite(point.altitude)) position.push(point.altitude);
      coordinates.push(position);
      west = Math.min(west, point.longitude); east = Math.max(east, point.longitude);
      south = Math.min(south, point.latitude); north = Math.max(north, point.latitude);
    }
    recordViewerWork('gps-geometry', sliceStartedAt);
  }
  if (!isCurrent()) return;
  const longitudePadding = Math.max((east - west) * 0.1, 0.0005);
  const latitudePadding = Math.max((north - south) * 0.1, 0.0005);
  return {
    revision,
    feature: coordinates.length < 2 ? null : {
      type: 'Feature', properties: { pointCount: coordinates.length },
      geometry: { type: 'LineString', coordinates },
    },
    bounds: coordinates.length ? [
      [west - longitudePadding, south - latitudePadding],
      [east + longitudePadding, north + latitudePadding],
    ] : null,
  };
}
