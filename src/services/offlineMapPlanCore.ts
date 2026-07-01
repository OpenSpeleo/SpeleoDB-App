import type { OfflineMapCoordinate, OfflineMapPlanningInput } from '../types/offlineMapSync';
import type { TilePrefetchRequest } from '../types/tilePrefetch';
import {
  buildTileUrlsForPaths,
  buildTileUrlsForPoints,
  buildTileUrlsForProjectBounds,
  iterateRawTileUrlsForPaths,
  iterateRawTileUrlsForPoints,
  iterateRawTileUrlsForProjectBounds,
} from './tilePrefetchPlanner';

export const OFFLINE_MAP_PLAN_CHUNK_SIZE = 2_048;
const COORDINATE_TEMPLATE = 'offline-map://{z}/{x}/{y}';
const COORDINATE_PREFIX = 'offline-map://';

function requestFor(input: OfflineMapPlanningInput): TilePrefetchRequest {
  return {
    tileUrlTemplate: COORDINATE_TEMPLATE,
    minZoom: input.minZoom,
    maxZoom: input.maxZoom,
    padMeters: input.padMeters,
  };
}

function coordinateFromUrl(url: string): OfflineMapCoordinate {
  const [z, x, y] = url.slice(COORDINATE_PREFIX.length).split('/').map(Number);
  if (![z, x, y].every(Number.isSafeInteger)) {
    throw new Error(`Invalid canonical offline-map coordinate: ${url}`);
  }
  return { z, x, y };
}

export function collectOfflineMapCoordinates(
  input: OfflineMapPlanningInput,
): OfflineMapCoordinate[] {
  const request = requestFor(input);
  const urls = new Set<string>();
  for (const bounds of input.projects) {
    for (const url of buildTileUrlsForProjectBounds(bounds, request)) urls.add(url);
  }
  for (const url of buildTileUrlsForPoints(input.points, request)) urls.add(url);
  for (const url of buildTileUrlsForPaths(input.paths, request)) urls.add(url);
  return [...urls]
    .map(coordinateFromUrl)
    .sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
}

/**
 * Bounded raw iterator used by the worker. Coordinates may repeat across
 * sources; the v8 staging object store owns global uniqueness.
 */
export function* iterateRawOfflineMapCoordinates(
  input: OfflineMapPlanningInput,
): Generator<OfflineMapCoordinate> {
  const request = requestFor(input);
  for (const bounds of input.projects) {
    for (const url of iterateRawTileUrlsForProjectBounds(bounds, request)) {
      yield coordinateFromUrl(url);
    }
  }
  for (const url of iterateRawTileUrlsForPoints(input.points, request)) {
    yield coordinateFromUrl(url);
  }
  for (const url of iterateRawTileUrlsForPaths(input.paths, request)) {
    yield coordinateFromUrl(url);
  }
}

export function encodeOfflineMapCoordinateChunk(
  coordinates: readonly OfflineMapCoordinate[],
): Uint32Array {
  const encoded = new Uint32Array(coordinates.length * 3);
  for (let index = 0; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index];
    encoded[index * 3] = coordinate.z;
    encoded[index * 3 + 1] = coordinate.x;
    encoded[index * 3 + 2] = coordinate.y;
  }
  return encoded;
}

export function decodeOfflineMapCoordinateChunk(
  encoded: Uint32Array,
): OfflineMapCoordinate[] {
  const coordinates: OfflineMapCoordinate[] = [];
  for (let index = 0; index + 2 < encoded.length; index += 3) {
    coordinates.push({ z: encoded[index], x: encoded[index + 1], y: encoded[index + 2] });
  }
  return coordinates;
}
