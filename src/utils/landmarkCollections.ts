/**
 * Landmark collection grouping (read-only, derived entirely from the cached
 * landmarks GeoJSON FeatureCollection).
 *
 * The backend `/api/v2/landmarks/geojson/` endpoint embeds collection metadata
 * on every feature (`collection`, `collection_name`, `collection_color`,
 * `collection_type`, `is_personal_collection`). Because all of that travels
 * with the cached payload, the app can build the full collection grouping for
 * the Landmark panel offline without any extra endpoint, cache key, or sync.
 *
 * Mirrors the web map viewer's `LandmarkUI.getLandmarkCollectionGroups`:
 * personal collections first, then alphabetical; landmarks alphabetical within
 * each group; safe color fallback.
 */

import { COLORS } from '../constants';

const PERSONAL_COLLECTION_ID = '__personal__';
const PERSONAL_COLLECTION_NAME = 'Personal Landmarks';
const UNNAMED_COLLECTION_NAME = 'Unnamed Collection';
const UNNAMED_LANDMARK_NAME = 'Unnamed Landmark';

export interface LandmarkListItem {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  collectionId: string;
  collectionName: string;
  collectionColor: string;
  isPersonalCollection: boolean;
}

export interface LandmarkCollectionGroup {
  id: string;
  name: string;
  color: string;
  isPersonal: boolean;
  count: number;
  landmarks: LandmarkListItem[];
}

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function safeColor(value: unknown): string {
  return isValidHex(value) ? value : COLORS.FALLBACK;
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function readFeatureItem(feature: unknown): LandmarkListItem | null {
  if (!feature || typeof feature !== 'object') return null;
  const f = feature as {
    id?: unknown;
    properties?: Record<string, unknown> | null;
    geometry?: { type?: unknown; coordinates?: unknown } | null;
  };

  const properties = f.properties ?? {};
  const geometry = f.geometry ?? null;
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const coords = geometry.coordinates as unknown[];
  const longitude = Number(coords[0]);
  const latitude = Number(coords[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }

  const id = toStringValue(properties.id) || toStringValue(f.id);
  if (!id) return null;

  const isPersonal =
    properties.is_personal_collection === true || properties.collection_type === 'PERSONAL';
  const collectionId = toStringValue(properties.collection) || PERSONAL_COLLECTION_ID;
  const collectionName =
    toStringValue(properties.collection_name)
    || (isPersonal ? PERSONAL_COLLECTION_NAME : UNNAMED_COLLECTION_NAME);

  return {
    id,
    name: toStringValue(properties.name) || UNNAMED_LANDMARK_NAME,
    description: toStringValue(properties.description),
    latitude,
    longitude,
    collectionId,
    collectionName,
    collectionColor: safeColor(properties.collection_color),
    isPersonalCollection: isPersonal,
  };
}

/**
 * Group the landmark features of a FeatureCollection by their collection.
 *
 * @param featureCollection Cached landmarks GeoJSON (or null/undefined).
 * @returns Collection groups, personal-first then alphabetical by name, with
 *          landmarks sorted alphabetically inside each group.
 */
export function buildLandmarkCollectionGroups(
  featureCollection: GeoJSON.FeatureCollection | null | undefined,
): LandmarkCollectionGroup[] {
  const features = Array.isArray(featureCollection?.features)
    ? featureCollection.features
    : [];

  const groups = new Map<string, LandmarkCollectionGroup>();
  for (const feature of features) {
    const item = readFeatureItem(feature);
    if (!item) continue;

    const existing = groups.get(item.collectionId);
    if (existing) {
      existing.landmarks.push(item);
      existing.count += 1;
    } else {
      groups.set(item.collectionId, {
        id: item.collectionId,
        name: item.collectionName,
        color: item.collectionColor,
        isPersonal: item.isPersonalCollection,
        count: 1,
        landmarks: [item],
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      landmarks: group.landmarks.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      ),
    }))
    .sort((a, b) => {
      if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
}
