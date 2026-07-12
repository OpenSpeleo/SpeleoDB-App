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
export const OFFLINE_MAP_PLAN_MAX_COORDINATES = 1_000_000;
const COORDINATE_TEMPLATE = 'offline-map://{z}/{x}/{y}';
const COORDINATE_PREFIX = 'offline-map://';
const COORDINATE_BITS = 18;
const COORDINATE_BASE = 2 ** COORDINATE_BITS;
const Z_MULTIPLIER = COORDINATE_BASE ** 2;

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

/** Raw iterator used by the worker-local bounded deduplication pass. */
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

export function packOfflineMapCoordinate(coordinate: OfflineMapCoordinate): number {
  const { z, x, y } = coordinate;
  if (
    !Number.isSafeInteger(z)
    || !Number.isSafeInteger(x)
    || !Number.isSafeInteger(y)
    || z < 0
    || z > COORDINATE_BITS
    || x < 0
    || x >= COORDINATE_BASE
    || y < 0
    || y >= COORDINATE_BASE
  ) {
    throw new Error(`Invalid offline-map coordinate: ${z}/${x}/${y}`);
  }
  return z * Z_MULTIPLIER + x * COORDINATE_BASE + y;
}

function unpackOfflineMapCoordinate(key: number): OfflineMapCoordinate {
  const z = Math.floor(key / Z_MULTIPLIER);
  const remainder = key - z * Z_MULTIPLIER;
  const x = Math.floor(remainder / COORDINATE_BASE);
  const y = remainder - x * COORDINATE_BASE;
  return { z, x, y };
}

/**
 * Owns global plan deduplication in transient worker memory. The returned
 * typed array is sorted by z/x/y because the packed integer preserves that
 * ordering.
 */
export function collectUniqueOfflineMapCoordinateKeys(
  coordinates: Iterable<OfflineMapCoordinate>,
  maxCoordinates = OFFLINE_MAP_PLAN_MAX_COORDINATES,
): Float64Array {
  if (!Number.isSafeInteger(maxCoordinates) || maxCoordinates < 0) {
    throw new Error('Offline-map plan coordinate limit must be a non-negative integer');
  }
  const keys = new Set<number>();
  for (const coordinate of coordinates) {
    keys.add(packOfflineMapCoordinate(coordinate));
    if (keys.size > maxCoordinates) {
      throw new Error(
        `Offline-map plan exceeds the ${maxCoordinates} unique-tile limit`,
      );
    }
  }
  const sorted = Float64Array.from(keys);
  keys.clear();
  sorted.sort();
  return sorted;
}

export function encodePackedOfflineMapCoordinateChunk(
  keys: Float64Array,
  start: number,
  end: number,
): Uint32Array {
  const encoded = new Uint32Array((end - start) * 3);
  for (let sourceIndex = start, targetIndex = 0; sourceIndex < end; sourceIndex += 1) {
    const coordinate = unpackOfflineMapCoordinate(keys[sourceIndex]);
    encoded[targetIndex] = coordinate.z;
    encoded[targetIndex + 1] = coordinate.x;
    encoded[targetIndex + 2] = coordinate.y;
    targetIndex += 3;
  }
  return encoded;
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
