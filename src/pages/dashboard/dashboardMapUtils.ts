import type { MapRef } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { MAP } from '../../constants';
import type { MapOverlayId } from '../../types/mapOverlay';
import type { ProjectGeoJSONBounds } from '../../types/projectGeoJSON';
import type { RecordedPoint } from '../../types/gpsTrack';
import {
  WEB_MERCATOR_MAX_LATITUDE,
  clampWebMercatorLatitude,
  mergeLongitudeIntervals,
} from '../../utils/geographicBounds';
import {
  INTERACTIVE_OVERLAY_LAYER_IDS,
  parseOverlayMarkerDetails,
} from '../../utils/overlayMarkerDetails';
import type {
  InteractiveOverlayFeature,
  MarkerParseContext,
  OverlayMarkerDetails,
} from '../../utils/overlayMarkerDetails';
import artifactIcon from '../../assets/media/map-icons/artifact-icon.png';
import boneIcon from '../../assets/media/map-icons/bones-icon.png';
import biologyIcon from '../../assets/media/map-icons/fish-icon.png';
import geologyIcon from '../../assets/media/map-icons/rock-icon.png';
import explorationLeadIcon from '../../assets/media/map-icons/exploration-lead-icon.png';
import cylinderIcon from '../../assets/media/map-icons/cylinder-orange-icon.png';

export type ProjectBoundsRecord = Record<string, ProjectGeoJSONBounds>;
export type OverlayIconId =
  | 'biology-station-icon'
  | 'bone-station-icon'
  | 'artifact-station-icon'
  | 'geology-station-icon'
  | 'exploration-lead-icon'
  | 'cylinder-icon';
export type OverlayIconAvailability = Record<OverlayIconId, boolean>;
type ProjectLinkedOverlayId = 'subsurfaceStations' | 'explorationLeads' | 'cylinderInstalls';

export type OverlayFeatureQueryMap = {
  queryRenderedFeatures: (
    pointOrBox: { x: number; y: number } | [[number, number], [number, number]],
    options?: { layers?: string[] },
  ) => InteractiveOverlayFeature[];
  getCanvas: () => { getBoundingClientRect: () => DOMRect };
  getLayer: (id: string) => unknown;
  getZoom: () => number;
  unproject: (point: { x: number; y: number }) => { lng: number; lat: number };
};

export type MapPointerTapCandidate = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startedAtMs: number;
  moved: boolean;
};

export type OverlayImageMap = {
  hasImage: (id: string) => boolean;
  addImage: (id: string, image: unknown) => void;
  loadImage: (
    url: string,
    callback: (error?: Error | null, image?: unknown) => void,
  ) => void;
};

type OrientationLockMap = {
  touchZoomRotate?: { disableRotation?: () => void };
  setBearing?: (bearing: number) => void;
  setPitch?: (pitch: number) => void;
};

export const MAP_MARKER_HIT_RADIUS_PX_TOUCH = 26;
export const MAP_TOUCH_TAP_MAX_MOVEMENT_PX = 12;
export const MAP_TOUCH_TAP_MAX_DURATION_MS = 550;

export const OVERLAY_ICON_SOURCES: Record<OverlayIconId, string> = {
  'biology-station-icon': biologyIcon,
  'bone-station-icon': boneIcon,
  'artifact-station-icon': artifactIcon,
  'geology-station-icon': geologyIcon,
  'exploration-lead-icon': explorationLeadIcon,
  'cylinder-icon': cylinderIcon,
};

export const DEFAULT_OVERLAY_ICON_AVAILABILITY: OverlayIconAvailability = {
  'biology-station-icon': false,
  'bone-station-icon': false,
  'artifact-station-icon': false,
  'geology-station-icon': false,
  'exploration-lead-icon': false,
  'cylinder-icon': false,
};

const PROJECT_LINKED_OVERLAY_IDS = new Set<ProjectLinkedOverlayId>([
  'subsurfaceStations',
  'explorationLeads',
  'cylinderInstalls',
]);

export const LONG_PRESS_BLOCKING_STATIC_LAYER_IDS = [
  ...INTERACTIVE_OVERLAY_LAYER_IDS,
  'landmarks-labels',
  'surface-stations-labels',
  'subsurface-stations-labels',
  'cylinder-installs-labels',
] as const;

const warnedIconIds = new Set<OverlayIconId>();

function resolveFeatureColor(properties: Record<string, unknown>): string {
  if (typeof properties.color === 'string' && properties.color) return properties.color;
  const tag = properties.tag;
  if (tag && typeof tag === 'object') {
    const tagColor = (tag as { color?: unknown }).color;
    if (typeof tagColor === 'string' && tagColor) return tagColor;
  }
  return '#fb923c';
}

export function normalizeOverlayGeoJSON(
  overlayId: MapOverlayId,
  featureCollection: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  if (overlayId !== 'subsurfaceStations' && overlayId !== 'surfaceStations') {
    return featureCollection;
  }
  return {
    ...featureCollection,
    features: featureCollection.features.map((feature) => {
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      return {
        ...feature,
        properties: { ...properties, color: resolveFeatureColor(properties) },
      };
    }),
  };
}

export function getClickedOverlayMarkerDetails(
  features: InteractiveOverlayFeature[],
  allInteractiveLayerIds: readonly string[],
  context?: MarkerParseContext,
): OverlayMarkerDetails | null {
  for (const layerId of allInteractiveLayerIds) {
    const feature = features.find((candidate) => candidate.layer?.id === layerId);
    if (!feature) continue;
    const details = parseOverlayMarkerDetails(feature, context);
    if (details) return details;
  }
  return null;
}

export function getMarkerHitQueryBounds(
  point: { x: number; y: number },
  radiusPx: number,
): [[number, number], [number, number]] {
  return [
    [point.x - radiusPx, point.y - radiusPx],
    [point.x + radiusPx, point.y + radiusPx],
  ];
}

function getProjectLinkFromFeature(
  overlayId: ProjectLinkedOverlayId,
  feature: GeoJSON.Feature,
): string | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const candidate = overlayId === 'cylinderInstalls' ? properties.project_id : properties.project;
  if (typeof candidate === 'string' && candidate) return candidate;
  return typeof candidate === 'number' ? String(candidate) : null;
}

export function filterOverlayByProjectVisibility(
  overlayId: MapOverlayId,
  featureCollection: GeoJSON.FeatureCollection,
  activeProjectIds: Set<string>,
): GeoJSON.FeatureCollection {
  if (!PROJECT_LINKED_OVERLAY_IDS.has(overlayId as ProjectLinkedOverlayId)) {
    return featureCollection;
  }
  const projectLinkedOverlayId = overlayId as ProjectLinkedOverlayId;
  return {
    ...featureCollection,
    features: featureCollection.features.filter((feature) => {
      const projectId = getProjectLinkFromFeature(projectLinkedOverlayId, feature);
      return Boolean(projectId && activeProjectIds.has(projectId));
    }),
  };
}

async function loadImageViaFetch(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image element failed to load'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function loadMapImage(
  map: OverlayImageMap,
  id: OverlayIconId,
  url: string,
): Promise<boolean> {
  if (map.hasImage(id)) return true;
  try {
    const image = await loadImageViaFetch(url);
    map.addImage(id, image);
    return true;
  } catch (fetchError) {
    return new Promise((resolve) => {
      map.loadImage(url, (error, image) => {
        if (error || !image) {
          if (!warnedIconIds.has(id)) {
            warnedIconIds.add(id);
            console.warn('Failed to load a map icon.', error ?? fetchError);
          }
          resolve(false);
          return;
        }
        map.addImage(id, image);
        resolve(true);
      });
    });
  }
}

export function computeBounds(
  projectBounds: ProjectBoundsRecord,
  ids: Set<string>,
): LngLatBoundsLike | null {
  const intervals: ProjectGeoJSONBounds[] = [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const id of ids) {
    const bounds = projectBounds[id];
    if (!bounds) continue;
    intervals.push(bounds);
    minLat = Math.min(minLat, bounds.south);
    maxLat = Math.max(maxLat, bounds.north);
  }
  if (intervals.length === 0) return null;
  // The non-empty interval guard above makes merge failure impossible.
  const merged = mergeLongitudeIntervals(intervals)!;
  const minLng = merged.west;
  const maxLng = merged.crossesDateline ? merged.east + 360 : merged.east;
  const lngPad = Math.max((maxLng - minLng) * 0.1, 0.01);
  const latPad = Math.max((maxLat - minLat) * 0.1, 0.01);
  const paddedSouth = clampWebMercatorLatitude(minLat - latPad);
  const paddedNorth = clampWebMercatorLatitude(maxLat + latPad);
  return [
    [minLng - lngPad, Math.max(-WEB_MERCATOR_MAX_LATITUDE, paddedSouth)],
    [maxLng + lngPad, Math.min(WEB_MERCATOR_MAX_LATITUDE, paddedNorth)],
  ];
}

export function boundsFromPoints(points: readonly RecordedPoint[]): LngLatBoundsLike | null {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let hasCoords = false;
  for (const point of points) {
    const { latitude: lat, longitude: lng } = point;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    hasCoords = true;
  }
  if (!hasCoords) return null;
  const lngPad = Math.max((maxLng - minLng) * 0.1, 0.0005);
  const latPad = Math.max((maxLat - minLat) * 0.1, 0.0005);
  return [
    [minLng - lngPad, minLat - latPad],
    [maxLng + lngPad, maxLat + latPad],
  ];
}

export function lockMapOrientation(mapRef: MapRef | null): void {
  if (!mapRef) return;
  const map = mapRef.getMap() as unknown as OrientationLockMap;
  map.touchZoomRotate?.disableRotation?.();
  map.setBearing?.(MAP.NORTH_UP_ORIENTATION.bearing);
  map.setPitch?.(MAP.NORTH_UP_ORIENTATION.pitch);
}
