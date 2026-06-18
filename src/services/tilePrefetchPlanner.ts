/**
 * Tile prefetch planner.
 *
 * The single, reusable seam that "collects the locations and zoom levels that
 * need to be downloaded and cached". Given geometry (a project's survey
 * FeatureCollection, or a set of landmark points) plus a `TilePrefetchRequest`
 * (zoom range + padding + URL template), it produces the flat list of
 * `{z,x,y}` tile URLs to fetch.
 *
 * Two collectors share the same Web Mercator math:
 *  - `buildTileUrlsForFeatureCollection`: one padded bounding box over all
 *    coordinates (used for projects, whose geometry is spatially compact).
 *  - `buildTileUrlsForPoints`: a per-point padded box, unioned + deduped (used
 *    for landmarks, which are scattered globally, so a single bounding box over
 *    the whole set would span the planet).
 *
 * Pure module: no IndexedDB, no network, no service state. Heavily unit tested.
 */

import type { TilePrefetchRequest } from '../types/tilePrefetch';

// ==================== Constants ====================

const MAX_MERCATOR_LAT = 85.05112878;
const MIN_MERCATOR_LAT = -85.05112878;
const METERS_PER_DEGREE_LAT = 111_320;

// ==================== Types ====================

interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface Bounds {
  west: number;
  east: number;
  south: number;
  north: number;
  crossesDateline: boolean;
  fullWorld: boolean;
}

// ==================== Geometry helpers ====================

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toDateline360(lng: number): number {
  return ((lng + 180) % 360 + 360) % 360;
}

function wrap360(value: number): number {
  return ((value % 360) + 360) % 360;
}

function fromDateline360(value: number): number {
  let normalized = value - 180;
  while (normalized < -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
}

function metersToLatitudeDegrees(meters: number): number {
  return meters / METERS_PER_DEGREE_LAT;
}

function metersToLongitudeDegrees(meters: number, latitude: number): number {
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const safeCos = Math.max(Math.abs(cosLat), 1e-6);
  return meters / (METERS_PER_DEGREE_LAT * safeCos);
}

function visitCoords(
  geometry: GeoJSON.Geometry,
  fn: (lng: number, lat: number) => void,
): void {
  switch (geometry.type) {
    case 'Point':
      fn(geometry.coordinates[0], geometry.coordinates[1]);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const c of geometry.coordinates) fn(c[0], c[1]);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates) {
        for (const c of ring) fn(c[0], c[1]);
      }
      break;
    case 'MultiPolygon':
      for (const poly of geometry.coordinates) {
        for (const ring of poly) {
          for (const c of ring) fn(c[0], c[1]);
        }
      }
      break;
    case 'GeometryCollection':
      for (const child of geometry.geometries) visitCoords(child, fn);
      break;
  }
}

function shortestLongitudeInterval(longitudes: number[]): {
  west: number;
  east: number;
  crossesDateline: boolean;
} {
  if (longitudes.length === 1) {
    const value = longitudes[0];
    return { west: value, east: value, crossesDateline: false };
  }

  const normalized = longitudes.map(toDateline360).sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const next = i === normalized.length - 1 ? normalized[0] + 360 : normalized[i + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = i;
    }
  }

  const start = normalized[(gapIndex + 1) % normalized.length];
  const end = normalized[gapIndex];
  const west = fromDateline360(start);
  const east = fromDateline360(end);
  const crossesDateline = start > end;

  return { west, east, crossesDateline };
}

function expandLongitudeInterval(
  west: number,
  east: number,
  padDegrees: number,
): { west: number; east: number; crossesDateline: boolean; fullWorld: boolean } {
  const start = toDateline360(west);
  let end = toDateline360(east);
  // Only wrap when the interval genuinely crosses the antimeridian (east is
  // "behind" west in 360-space). A zero-width interval (a single point, where
  // east === west) must NOT wrap, otherwise it expands to the full world.
  if (end < start) end += 360;

  const expandedStart = start - padDegrees;
  const expandedEnd = end + padDegrees;
  if (expandedEnd - expandedStart >= 360) {
    return { west: -180, east: 180, crossesDateline: false, fullWorld: true };
  }

  const wrappedStart = wrap360(expandedStart);
  const wrappedEnd = wrap360(expandedEnd);
  const crossesDateline = wrappedStart > wrappedEnd;

  return {
    west: fromDateline360(wrappedStart),
    east: fromDateline360(wrappedEnd),
    crossesDateline,
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
  const south = clamp(minLat - latPad, MIN_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const north = clamp(maxLat + latPad, MIN_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const centerLat = (south + north) / 2;
  const lngPad = metersToLongitudeDegrees(padMeters, centerLat);
  const expandedLng = expandLongitudeInterval(lngInterval.west, lngInterval.east, lngPad);

  return {
    west: expandedLng.west,
    east: expandedLng.east,
    south,
    north,
    crossesDateline: expandedLng.crossesDateline,
    fullWorld: expandedLng.fullWorld,
  };
}

export function computePaddedBounds(
  featureCollection: GeoJSON.FeatureCollection,
  padMeters: number,
): Bounds | null {
  const longitudes: number[] = [];
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of featureCollection.features) {
    if (!feature.geometry) continue;
    visitCoords(feature.geometry, (lng: number, lat: number) => {
      longitudes.push(lng);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  }

  return computePaddedBoundsFromCoords(longitudes, minLat, maxLat, padMeters);
}

function longitudeToTileX(lng: number, zoom: number): number {
  const tilesPerAxis = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * tilesPerAxis);
  return clamp(x, 0, tilesPerAxis - 1);
}

function latitudeToTileY(lat: number, zoom: number): number {
  const clampedLat = clamp(lat, MIN_MERCATOR_LAT, MAX_MERCATOR_LAT);
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

function collectTileUrls(
  bounds: Bounds,
  request: TilePrefetchRequest,
  sink: (url: string) => void,
): void {
  for (let zoom = request.minZoom; zoom <= request.maxZoom; zoom += 1) {
    const ranges = tileRangesForZoom(bounds, zoom);
    for (const range of ranges) {
      for (let x = range.xMin; x <= range.xMax; x += 1) {
        for (let y = range.yMin; y <= range.yMax; y += 1) {
          sink(applyTileTemplate(request.tileUrlTemplate, zoom, x, y));
        }
      }
    }
  }
}

/**
 * Project collector: padded bounding box over all coordinates of the
 * FeatureCollection. Suitable for spatially-compact geometry (a single survey).
 */
export function buildTileUrlsForFeatureCollection(
  featureCollection: GeoJSON.FeatureCollection,
  request: TilePrefetchRequest,
): string[] {
  const bounds = computePaddedBounds(featureCollection, request.padMeters);
  if (!bounds) return [];

  const urls: string[] = [];
  collectTileUrls(bounds, request, (url) => urls.push(url));
  return urls;
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
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
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
  const urls = new Set<string>();
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const bounds = computePaddedBoundsFromCoords([lng], lat, lat, request.padMeters);
    if (!bounds) continue;
    collectTileUrls(bounds, request, (url) => urls.add(url));
  }
  return Array.from(urls);
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
