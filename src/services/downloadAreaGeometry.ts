import { downloadAreaColor } from './downloadAreaColors';
import { MAP_LAYERS } from '../constants';
import {
  DownloadAreaType,
  type DownloadArea,
  type DownloadAreaCatalog,
  type LngLat,
} from '../types/downloadArea';
import type { ProjectGeoJSONBounds } from '../types/projectGeoJSON';
import {
  clampWebMercatorLatitude,
  longitudeIntervalSpanDegrees,
  normalizeLongitude,
  shortestLongitudeInterval,
  WEB_MERCATOR_MAX_LATITUDE,
} from '../utils/geographicBounds';

export const MAX_AREA_COORDINATES = 1_000_000;
export const AREA_MIN_ZOOM = 0;
export const AREA_MAX_ZOOM = 18;
export const FALLBACK_TILE_BYTES = 32 * 1024;

export function areaBounds(
  area: Pick<DownloadArea, 'topLeft' | 'bottomRight'>,
): ProjectGeoJSONBounds {
  return {
    west: area.topLeft[0],
    north: area.topLeft[1],
    east: area.bottomRight[0],
    south: area.bottomRight[1],
    crossesDateline: area.topLeft[0] > area.bottomRight[0],
  };
}

export function cornersForBounds(
  bounds: ProjectGeoJSONBounds,
  padding = 0,
): Pick<DownloadArea, 'topLeft' | 'bottomRight'> {
  // Geographic sources may lie beyond the projected map. Pad their clamped
  // location so a polar point still yields a positive-height edge rectangle.
  const south = clampWebMercatorLatitude(
    clampWebMercatorLatitude(bounds.south) - padding / 111_320,
  );
  const north = clampWebMercatorLatitude(
    clampWebMercatorLatitude(bounds.north) + padding / 111_320,
  );
  const longitudePadding =
    padding /
    (111_320 *
      Math.max(Math.cos((((south + north) / 2) * Math.PI) / 180), 1e-6));
  if (longitudeIntervalSpanDegrees(bounds) + longitudePadding * 2 >= 360) {
    return { topLeft: [-180, north], bottomRight: [180, south] };
  }
  const west = normalizeLongitude(bounds.west - longitudePadding);
  let east = normalizeLongitude(bounds.east + longitudePadding);
  if (
    east === -180 &&
    west > -180 &&
    longitudeIntervalSpanDegrees(bounds) + longitudePadding * 2 <= 180
  )
    east = 180;
  return { topLeft: [west, north], bottomRight: [east, south] };
}

export function boundsForCoordinates(
  points: readonly (readonly [number, number])[],
): ProjectGeoJSONBounds | null {
  const valid = points.filter(
    ([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 90,
  );
  if (!valid.length) return null;
  let south = 90;
  let north = -90;
  for (const [, lat] of valid) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return {
    ...shortestLongitudeInterval(valid.map(([lng]) => lng)),
    south,
    north,
  };
}

export function validAreaCorners(
  topLeft: unknown,
  bottomRight: unknown,
): boolean {
  const valid = (value: unknown): value is LngLat =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (coordinate) =>
        typeof coordinate === 'number' && Number.isFinite(coordinate),
    ) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= WEB_MERCATOR_MAX_LATITUDE;
  return (
    valid(topLeft) &&
    valid(bottomRight) &&
    topLeft[1] > bottomRight[1] &&
    longitudeIntervalSpanDegrees({
      west: topLeft[0],
      east: bottomRight[0],
      crossesDateline: topLeft[0] > bottomRight[0],
    }) > 0
  );
}

/** Constant-space preflight; never enumerate a world-sized rectangle. */
export function countAreaCoordinates(
  area: Pick<DownloadArea, 'topLeft' | 'bottomRight'>,
): number {
  if (!validAreaCorners(area.topLeft, area.bottomRight))
    throw new Error('Choose a rectangle with a positive width and height.');
  const bounds = areaBounds(area);
  let total = 0;
  for (let z = AREA_MIN_ZOOM; z <= AREA_MAX_ZOOM; z++) {
    const n = 2 ** z;
    const x = (lng: number) =>
      Math.max(0, Math.min(n - 1, Math.floor(((lng + 180) / 360) * n)));
    const y = (lat: number) =>
      Math.max(
        0,
        Math.min(
          n - 1,
          Math.floor(
            ((1 -
              Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) /
                Math.PI) /
              2) *
              n,
          ),
        ),
      );
    const width = bounds.crossesDateline
      ? Math.min(n, n - x(bounds.west) + x(bounds.east) + 1)
      : x(bounds.east) - x(bounds.west) + 1;
    total += width * (y(bounds.south) - y(bounds.north) + 1);
  }
  return total;
}

/** Invalid persisted catalogs fail closed: an unreadable catalog is never empty intent. */
export function parseDownloadAreaCatalog(value: unknown): DownloadAreaCatalog {
  if (value === undefined) return { schemaVersion: 1, revision: 0, areas: [] };
  const catalog = value as DownloadAreaCatalog;
  if (
    !catalog ||
    catalog.schemaVersion !== 1 ||
    !Number.isSafeInteger(catalog.revision) ||
    catalog.revision < 0 ||
    !Array.isArray(catalog.areas) ||
    (catalog.layerIds !== undefined &&
      (!Array.isArray(catalog.layerIds) ||
        !catalog.layerIds.includes('esri-satellite') ||
        new Set(catalog.layerIds).size !== catalog.layerIds.length ||
        catalog.layerIds.some(
          (id) => !MAP_LAYERS.some((layer) => layer.id === id),
        )))
  )
    throw new Error('Offline map settings could not be read.');
  const ids = new Set<string>();
  for (const area of catalog.areas) {
    if (
      !area ||
      typeof area.areaId !== 'string' ||
      !area.areaId ||
      ids.has(area.areaId) ||
      !Object.values(DownloadAreaType).includes(area.type) ||
      (area.objectId !== null && typeof area.objectId !== 'string') ||
      !validAreaCorners(area.topLeft, area.bottomRight) ||
      (area.type !== DownloadAreaType.Manual &&
        (typeof area.name !== 'string' ||
          !area.name.trim() ||
          area.name.length > 120)) ||
      (area.color !== undefined &&
        (typeof area.color !== 'string' ||
          !/^#[0-9a-f]{6}$/i.test(area.color))) ||
      typeof area.sourceKey !== 'string' ||
      !area.sourceKey ||
      (area.sourceRevision !== null &&
        typeof area.sourceRevision !== 'string') ||
      typeof area.visible !== 'boolean' ||
      (area.type !== DownloadAreaType.Manual && area.visible) ||
      !Number.isSafeInteger(area.revision) ||
      area.revision < 1 ||
      !Array.isArray(area.layerIds) ||
      !area.layerIds.length ||
      new Set(area.layerIds).size !== area.layerIds.length ||
      area.layerIds.some((id) => !MAP_LAYERS.some((layer) => layer.id === id))
    )
      throw new Error('Offline map settings contain an invalid area.');
    ids.add(area.areaId);
  }
  return catalog;
}

export function areaFeatureCollection(
  areas: readonly DownloadArea[],
): GeoJSON.FeatureCollection {
  const ring = (west: number, south: number, east: number, north: number) => [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
    [west, north],
  ];
  return {
    type: 'FeatureCollection',
    features: areas
      .filter((area) => area.type === DownloadAreaType.Manual && area.visible)
      .map((area) => {
        const b = areaBounds(area);
        return {
          type: 'Feature',
          id: area.areaId,
          properties: { color: downloadAreaColor(area) },
          geometry: b.crossesDateline
            ? {
                type: 'MultiPolygon',
                coordinates: [
                  [ring(b.west, b.south, 180, b.north)],
                  [ring(-180, b.south, b.east, b.north)],
                ],
              }
            : {
                type: 'Polygon',
                coordinates: [ring(b.west, b.south, b.east, b.north)],
              },
        };
      }),
  };
}
