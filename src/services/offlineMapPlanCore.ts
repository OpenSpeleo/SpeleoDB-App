import type { OfflineMapCoordinate, OfflineMapPlanningInput } from '../types/offlineMapSync';
import type { TilePrefetchRequest } from '../types/tilePrefetch';
import {
  buildTileUrlsForPaths,
  buildTileUrlsForPoints,
  buildTileUrlsForProjectBounds,
  iterateRawTileUrlsForPaths,
  iterateRawTileUrlsForPoints,
  iterateRawTileUrlsForProjectBounds,
  tileRangesForZoom,
  padTileBounds,
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

/**
 * Rectangle union by vertical strips. Memory scales with rectangle count, not
 * tile count: merge y intervals only at x boundaries, then emit sorted triples.
 * This preserves the per-area size limit without imposing a new aggregate cap.
 */
function* iterateRectangleUnion(input: OfflineMapPlanningInput): Generator<OfflineMapCoordinate> {
  const bounds = input.projects.map((project) => padTileBounds(project, 0));
  for (let z = input.minZoom; z <= input.maxZoom; z++) {
    const ranges = bounds.flatMap((rectangle) => tileRangesForZoom(rectangle, z));
    const events = new Map<number, Array<{ index: number; add: boolean }>>();
    const event = (x: number, index: number, add: boolean) => {
      const values = events.get(x) ?? [];
      values.push({ index, add });
      events.set(x, values);
    };
    ranges.forEach((range, index) => {
      event(range.xMin, index, true);
      event(range.xMax + 1, index, false);
    });
    const boundaries = [...events.keys()].sort((a, b) => a - b);
    const active = new Set<number>();
    for (let i = 0; i + 1 < boundaries.length; i++) {
      const start = boundaries[i];
      for (const change of events.get(start)!) {
        if (change.add) active.add(change.index);
        else active.delete(change.index);
      }
      const intervals = [...active].map((index) => ranges[index]).sort((a, b) => a.yMin - b.yMin);
      const merged: Array<{ min: number; max: number }> = [];
      for (const interval of intervals) {
        const last = merged.at(-1);
        if (last && interval.yMin <= last.max + 1) last.max = Math.max(last.max, interval.yMax);
        else merged.push({ min: interval.yMin, max: interval.yMax });
      }
      if (!merged.length) continue;
      for (let x = start; x < boundaries[i + 1]; x++) {
        for (const interval of merged) {
          for (let y = interval.min; y <= interval.max; y++) yield { z, x, y };
        }
      }
    }
  }
}

/** Shared worker/test seam. Every emitted chunk is final, sorted and duplicate-free. */
export function* iterateOfflineMapPlanChunks(input: OfflineMapPlanningInput): Generator<Uint32Array> {
  if (!input.points.length && !input.paths.length && input.padMeters === 0) {
    let chunk = new Uint32Array(OFFLINE_MAP_PLAN_CHUNK_SIZE * 3);
    let cursor = 0;
    for (const { z, x, y } of iterateRectangleUnion(input)) {
      chunk[cursor++] = z;
      chunk[cursor++] = x;
      chunk[cursor++] = y;
      if (cursor === chunk.length) {
        yield chunk;
        chunk = new Uint32Array(OFFLINE_MAP_PLAN_CHUNK_SIZE * 3);
        cursor = 0;
      }
    }
    if (cursor) yield chunk.slice(0, cursor);
    return;
  }
  // Compatibility for pre-area callers. Production areas all use rectangles.
  const keys = collectUniqueOfflineMapCoordinateKeys(iterateRawOfflineMapCoordinates(input));
  for (let start = 0; start < keys.length; start += OFFLINE_MAP_PLAN_CHUNK_SIZE) {
    yield encodePackedOfflineMapCoordinateChunk(keys, start, Math.min(keys.length, start + OFFLINE_MAP_PLAN_CHUNK_SIZE));
  }
}
