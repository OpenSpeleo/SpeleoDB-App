/**
 * Tile prefetch planner.
 *
 * The single, reusable seam that "collects the locations and zoom levels that
 * need to be downloaded and cached". Given prevalidated project bounds or a
 * set of landmark points plus a `TilePrefetchRequest`
 * (zoom range + padding + URL template), it produces the flat list of
 * `{z,x,y}` tile URLs to fetch.
 *
 * Two collectors share the same Web Mercator math:
 *  - `buildTileUrlsForProjectBounds`: one padded, prevalidated project bbox.
 *  - `buildTileUrlsForPoints`: a per-point padded box, unioned + deduped (used
 *    for landmarks, which are scattered globally, so a single bounding box over
 *    the whole set would span the planet).
 *
 * Pure module: no IndexedDB, no network, no service state. Heavily unit tested.
 */

import type { TilePrefetchRequest } from '../types/tilePrefetch';
import type { ProjectGeoJSONBounds } from '../types/projectGeoJSON';
import {
  clampWebMercatorLatitude,
  longitudeIntervalSpanDegrees,
  normalizeLongitude,
  shortestLongitudeInterval,
  type DirectedLongitudeInterval,
} from '../utils/geographicBounds';

// ==================== Constants ====================

const METERS_PER_DEGREE_LAT = 111_320;

// ==================== Types ====================

interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface Bounds extends DirectedLongitudeInterval {
  south: number;
  north: number;
  fullWorld: boolean;
}

// ==================== Geometry helpers ====================

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function metersToLatitudeDegrees(meters: number): number {
  return meters / METERS_PER_DEGREE_LAT;
}

function metersToLongitudeDegrees(meters: number, latitude: number): number {
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const safeCos = Math.max(Math.abs(cosLat), 1e-6);
  return meters / (METERS_PER_DEGREE_LAT * safeCos);
}

function expandLongitudeInterval(
  interval: DirectedLongitudeInterval,
  padDegrees: number,
): DirectedLongitudeInterval & { fullWorld: boolean } {
  const expandedSpan = longitudeIntervalSpanDegrees(interval) + 2 * padDegrees;
  if (expandedSpan >= 360) {
    return { west: -180, east: 180, crossesDateline: false, fullWorld: true };
  }

  const west = normalizeLongitude(interval.west - padDegrees);
  let east = normalizeLongitude(interval.east + padDegrees);
  // Preserve +180 for an ordinary arc ending at the dateline. The shared
  // utility uses a half-open canonical range, while bounds intentionally allow
  // +180 so [170, 180] does not masquerade as a wrapped 350-degree interval.
  if (east === -180 && west > -180 && expandedSpan <= 180) east = 180;

  return {
    west,
    east,
    crossesDateline: west > east,
    fullWorld: false,
  };
}

function computePaddedBoundsFromCoords(
  longitudes: number[],
  minLat: number,
  maxLat: number,
  padMeters: number,
): Bounds | null {
  if (longitudes.length === 0 || minLat === Infinity || maxLat === -Infinity) {
    return null;
  }

  const lngInterval = shortestLongitudeInterval(longitudes);
  const latPad = metersToLatitudeDegrees(padMeters);
  const south = clampWebMercatorLatitude(minLat - latPad);
  const north = clampWebMercatorLatitude(maxLat + latPad);
  const centerLat = (south + north) / 2;
  const lngPad = metersToLongitudeDegrees(padMeters, centerLat);
  const expandedLng = expandLongitudeInterval(lngInterval, lngPad);

  return {
    west: expandedLng.west,
    east: expandedLng.east,
    south,
    north,
    crossesDateline: expandedLng.crossesDateline,
    fullWorld: expandedLng.fullWorld,
  };
}

function longitudeToTileX(lng: number, zoom: number): number {
  const tilesPerAxis = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * tilesPerAxis);
  return clamp(x, 0, tilesPerAxis - 1);
}

function latitudeToTileY(lat: number, zoom: number): number {
  const clampedLat = clampWebMercatorLatitude(lat);
  const rad = (clampedLat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  const tilesPerAxis = 2 ** zoom;
  const y = Math.floor((1 - mercN / Math.PI) / 2 * tilesPerAxis);
  return clamp(y, 0, tilesPerAxis - 1);
}

function tileRangesForZoom(bounds: Bounds, zoom: number): TileRange[] {
  const tilesPerAxis = 2 ** zoom;
  const yMin = latitudeToTileY(bounds.north, zoom);
  const yMax = latitudeToTileY(bounds.south, zoom);
  const safeYMin = Math.min(yMin, yMax);
  const safeYMax = Math.max(yMin, yMax);

  if (bounds.fullWorld) {
    return [{ xMin: 0, xMax: tilesPerAxis - 1, yMin: safeYMin, yMax: safeYMax }];
  }

  if (!bounds.crossesDateline) {
    const xMin = longitudeToTileX(bounds.west, zoom);
    const xMax = longitudeToTileX(bounds.east, zoom);
    return [
      {
        xMin: Math.min(xMin, xMax),
        xMax: Math.max(xMin, xMax),
        yMin: safeYMin,
        yMax: safeYMax,
      },
    ];
  }

  const firstXMin = longitudeToTileX(bounds.west, zoom);
  const secondXMax = longitudeToTileX(bounds.east, zoom);
  return [
    { xMin: firstXMin, xMax: tilesPerAxis - 1, yMin: safeYMin, yMax: safeYMax },
    { xMin: 0, xMax: secondXMax, yMin: safeYMin, yMax: safeYMax },
  ];
}

function applyTileTemplate(
  template: string,
  zoom: number,
  x: number,
  y: number,
): string {
  return template
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

function* iterateTileUrlsForBounds(
  bounds: Bounds,
  request: TilePrefetchRequest,
): Generator<string> {
  for (let zoom = request.minZoom; zoom <= request.maxZoom; zoom += 1) {
    const ranges = tileRangesForZoom(bounds, zoom);
    for (const range of ranges) {
      for (let x = range.xMin; x <= range.xMax; x += 1) {
        for (let y = range.yMin; y <= range.yMax; y += 1) {
          yield applyTileTemplate(request.tileUrlTemplate, zoom, x, y);
        }
      }
    }
  }
}

/**
 * Project collector for bounds that already passed GeoJSON validation. This is
 * the only project-prefetch entry point used by runtime code; it cannot rescan
 * or accidentally accept quarantined geometry.
 */
export function buildTileUrlsForProjectBounds(
  projectBounds: ProjectGeoJSONBounds,
  request: TilePrefetchRequest,
): string[] {
  const urls: string[] = [];
  visitTileUrlsForProjectBounds(projectBounds, request, (url) => urls.push(url));
  return urls;
}

export function visitTileUrlsForProjectBounds(
  projectBounds: ProjectGeoJSONBounds,
  request: TilePrefetchRequest,
  sink: (url: string) => void,
): void {
  const seen = new Set<string>();
  for (const url of iterateRawTileUrlsForProjectBounds(projectBounds, request)) {
    if (seen.has(url)) continue;
    seen.add(url);
    sink(url);
  }
}

/** Raw iterator for the offline planner; durable staging owns global dedupe. */
export function* iterateRawTileUrlsForProjectBounds(
  projectBounds: ProjectGeoJSONBounds,
  request: TilePrefetchRequest,
): Generator<string> {
  const latPad = metersToLatitudeDegrees(request.padMeters);
  const south = clampWebMercatorLatitude(projectBounds.south - latPad);
  const north = clampWebMercatorLatitude(projectBounds.north + latPad);
  const centerLat = (south + north) / 2;
  const lngPad = metersToLongitudeDegrees(request.padMeters, centerLat);
  const expandedLng = expandLongitudeInterval(projectBounds, lngPad);
  const bounds: Bounds = {
    ...expandedLng,
    south,
    north,
  };
  yield* iterateTileUrlsForBounds(bounds, request);
}

// ==================== Point collectors (landmarks) ====================

/**
 * Collect the [lng, lat] coordinates of every valid `Point` feature in a
 * FeatureCollection. Non-Point geometries and malformed coordinates are
 * skipped. Used to feed `buildTileUrlsForPoints`.
 */
export function extractPointCoordinates(
  featureCollection: GeoJSON.FeatureCollection | null | undefined,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const features = Array.isArray(featureCollection?.features)
    ? featureCollection.features
    : [];

  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry || geometry.type !== 'Point') continue;
    const coords = (geometry as GeoJSON.Point).coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    if (
      typeof lng !== 'number'
      || typeof lat !== 'number'
      || !Number.isFinite(lng)
      || !Number.isFinite(lat)
      || lng < -180
      || lng > 180
      || lat < -90
      || lat > 90
    ) continue;
    points.push([lng, lat]);
  }

  return points;
}

/**
 * Landmark collector: a padded box around each point individually, unioned and
 * deduped by URL. Avoids the world-spanning bounding box that would result from
 * boxing a globally-scattered set of points together.
 */
export function buildTileUrlsForPoints(
  points: ReadonlyArray<readonly [number, number]>,
  request: TilePrefetchRequest,
): string[] {
  const urls: string[] = [];
  visitTileUrlsForPoints(points, request, (url) => urls.push(url));
  return urls;
}

export function visitTileUrlsForPoints(
  points: ReadonlyArray<readonly [number, number]>,
  request: TilePrefetchRequest,
  sink: (url: string) => void,
): void {
  const seen = new Set<string>();
  for (const url of iterateRawTileUrlsForPoints(points, request)) {
    if (seen.has(url)) continue;
    seen.add(url);
    sink(url);
  }
}

/** Raw iterator for the offline planner; durable staging owns global dedupe. */
export function* iterateRawTileUrlsForPoints(
  points: ReadonlyArray<readonly [number, number]>,
  request: TilePrefetchRequest,
): Generator<string> {
  for (const [lng, lat] of points) {
    if (
      !Number.isFinite(lng)
      || !Number.isFinite(lat)
      || lng < -180
      || lng > 180
      || lat < -90
      || lat > 90
    ) continue;
    const bounds = computePaddedBoundsFromCoords([lng], lat, lat, request.padMeters);
    if (!bounds) continue;
    yield* iterateTileUrlsForBounds(bounds, request);
  }
}

function longitudeToFractionalTileX(lng: number, zoom: number): number {
  return ((normalizeLongitude(lng) + 180) / 360) * 2 ** zoom;
}

function latitudeToFractionalTileY(lat: number, zoom: number): number {
  const rad = clampWebMercatorLatitude(lat) * Math.PI / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI)
    / 2 * 2 ** zoom;
}

function* iteratePathTilesWithPadding(
  request: TilePrefetchRequest,
  zoom: number,
  x: number,
  y: number,
  latitude: number,
): Generator<string> {
  const count = 2 ** zoom;
  const metersPerTile = 40_075_016.686 * Math.max(Math.cos(latitude * Math.PI / 180), 1e-6)
    / count;
  const radius = Math.max(0, Math.ceil(request.padMeters / metersPerTile));
  for (let dx = -radius; dx <= radius; dx += 1) {
    const wrappedX = ((x + dx) % count + count) % count;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const tileY = y + dy;
      if (tileY < 0 || tileY >= count) continue;
      yield applyTileTemplate(request.tileUrlTemplate, zoom, wrappedX, tileY);
    }
  }
}

/**
 * Path-aware GPS collector. Each segment is traversed in Web-Mercator tile
 * space at every requested zoom and expanded only by the configured padding.
 * This avoids the enormous mostly-empty rectangle produced by a track bbox,
 * including for tracks that cross the antimeridian.
 */
export function buildTileUrlsForPaths(
  paths: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  request: TilePrefetchRequest,
): string[] {
  const urls: string[] = [];
  visitTileUrlsForPaths(paths, request, (url) => urls.push(url));
  return urls;
}

export function visitTileUrlsForPaths(
  paths: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  request: TilePrefetchRequest,
  sink: (url: string) => void,
): void {
  const seen = new Set<string>();
  for (const url of iterateRawTileUrlsForPaths(paths, request)) {
    if (seen.has(url)) continue;
    seen.add(url);
    sink(url);
  }
}

/** Raw iterator for the offline planner; durable staging owns global dedupe. */
export function* iterateRawTileUrlsForPaths(
  paths: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  request: TilePrefetchRequest,
): Generator<string> {
  for (const path of paths) {
    let previous: readonly [number, number] | null = null;
    let emittedSegment = false;
    for (const coordinate of path) {
      const [endLng, endLat] = coordinate;
      if (
        !Number.isFinite(endLng)
        || !Number.isFinite(endLat)
        || endLng < -180
        || endLng > 180
        || endLat < -90
        || endLat > 90
      ) continue;
      if (!previous) {
        previous = coordinate;
        continue;
      }
      const [startLng, startLat] = previous;
      for (let zoom = request.minZoom; zoom <= request.maxZoom; zoom += 1) {
        const count = 2 ** zoom;
        let startX = longitudeToFractionalTileX(startLng, zoom);
        let endX = longitudeToFractionalTileX(endLng, zoom);
        if (Math.abs(endX - startX) > count / 2) {
          if (startX < endX) startX += count;
          else endX += count;
        }
        const startY = latitudeToFractionalTileY(startLat, zoom);
        const endY = latitudeToFractionalTileY(endLat, zoom);
        const steps = Math.max(1, Math.ceil(
          Math.max(Math.abs(endX - startX), Math.abs(endY - startY)) * 2,
        ));
        for (let step = 0; step <= steps; step += 1) {
          const ratio = step / steps;
          const x = Math.floor(startX + (endX - startX) * ratio);
          const y = Math.floor(startY + (endY - startY) * ratio);
          const latitude = startLat + (endLat - startLat) * ratio;
          yield* iteratePathTilesWithPadding(request, zoom, x, y, latitude);
        }
      }
      emittedSegment = true;
      previous = coordinate;
    }
    if (previous && !emittedSegment) {
      yield* iterateRawTileUrlsForPoints([previous], request);
    }
  }
}

/** Extract LineString/MultiLineString coordinates without joining disjoint paths. */
export function extractLineCoordinatePaths(
  featureCollection: GeoJSON.FeatureCollection | null | undefined,
): Array<Array<[number, number]>> {
  const paths: Array<Array<[number, number]>> = [];
  for (const feature of featureCollection?.features ?? []) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const candidates = geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
    for (const candidate of candidates) {
      const path = candidate
        .filter((position) => Array.isArray(position) && position.length >= 2)
        .map((position) => [position[0], position[1]] as [number, number])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      if (path.length > 0) paths.push(path);
    }
  }
  return paths;
}

/**
 * Stable, order-independent signature for a set of prefetch points. Used as the
 * tile prefetch job's `commitId` so re-syncing an unchanged set is idempotent
 * (the job is skipped) while an edited set triggers a fresh prefetch.
 *
 * Coordinates are rounded to ~1e-5 deg (~1m) so insignificant float noise does
 * not invalidate the job.
 */
export function computeTilePrefetchSignature(
  points: ReadonlyArray<readonly [number, number]>,
): string {
  const normalized = points
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    .map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
    .sort();

  let hash = 2166136261;
  const payload = `${normalized.length}|${normalized.join(';')}`;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sig-${normalized.length}-${(hash >>> 0).toString(16)}`;
}
