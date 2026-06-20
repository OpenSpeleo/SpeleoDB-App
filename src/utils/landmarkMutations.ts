/**
 * Pure helpers for landmark create/edit/delete.
 *
 * Kept free of React, network, and storage so they are trivially testable and
 * reusable by both the online path and the offline queue.
 *
 * - Validation of user input.
 * - Building a GeoJSON Feature from an API landmark, matching the exact
 *   property shape the map + Landmark panel already consume
 *   (`src/utils/landmarkCollections.ts`, `src/utils/overlayMarkerDetails.ts`).
 * - Immutable upsert/remove of a single feature in the cached FeatureCollection.
 * - Mapping a backend error into a typed `LandmarkMutationError`.
 *
 * See docs/landmark-crud.md.
 */

import {
  LandmarkMutationError,
  type LandmarkApiObject,
  type LandmarkCollection,
} from '../types/landmark';

// ==================== Validation ====================

export const LANDMARK_NAME_MAX_LENGTH = 100;

/** Raw form values (lat/lon may still be strings from inputs). */
export interface LandmarkInputDraft {
  name: string;
  description?: string;
  latitude: string | number;
  longitude: string | number;
  collection?: string | null;
}

export interface NormalizedLandmarkInput {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  collection: string | null;
}

export interface LandmarkValidationResult {
  ok: boolean;
  fieldErrors: Record<string, string>;
  value?: NormalizedLandmarkInput;
}

function parseCoordinate(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Validate + normalize landmark form input. Pure; never throws.
 *
 * Mirrors the backend constraints so the user gets immediate feedback:
 * name required (<= 100 chars), latitude in [-90, 90], longitude in [-180, 180].
 */
export function validateLandmarkInput(draft: LandmarkInputDraft): LandmarkValidationResult {
  const fieldErrors: Record<string, string> = {};

  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (!name) {
    fieldErrors.name = 'Name is required.';
  } else if (name.length > LANDMARK_NAME_MAX_LENGTH) {
    fieldErrors.name = `Name must be ${LANDMARK_NAME_MAX_LENGTH} characters or fewer.`;
  }

  const description =
    typeof draft.description === 'string' ? draft.description.trim() : '';

  const latitude = parseCoordinate(draft.latitude);
  if (latitude === null) {
    fieldErrors.latitude = 'Latitude is required.';
  } else if (latitude < -90 || latitude > 90) {
    fieldErrors.latitude = 'Latitude must be between -90 and 90.';
  }

  const longitude = parseCoordinate(draft.longitude);
  if (longitude === null) {
    fieldErrors.longitude = 'Longitude is required.';
  } else if (longitude < -180 || longitude > 180) {
    fieldErrors.longitude = 'Longitude must be between -180 and 180.';
  }

  const collection =
    typeof draft.collection === 'string' && draft.collection.trim() !== ''
      ? draft.collection.trim()
      : null;

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    fieldErrors: {},
    value: {
      name,
      description,
      latitude: latitude as number,
      longitude: longitude as number,
      collection,
    },
  };
}

// ==================== GeoJSON feature construction ====================

function roundCoordinate(value: number): number {
  // Backend stores 7 decimal places; mirror that so the cached feature matches
  // what a subsequent geojson sync would return.
  return Number.isFinite(value) ? parseFloat(value.toFixed(7)) : value;
}

/**
 * Build a GeoJSON Feature from an API landmark object, matching the property
 * shape emitted by GET /api/v2/landmarks/geojson/ so the map color expressions,
 * the Landmark panel grouping, and the details parser all keep working.
 */
export function buildLandmarkFeatureFromApi(
  landmark: LandmarkApiObject,
): GeoJSON.Feature {
  const isPersonal = landmark.is_personal_collection === true;
  return {
    type: 'Feature',
    id: landmark.id,
    geometry: {
      type: 'Point',
      coordinates: [roundCoordinate(landmark.longitude), roundCoordinate(landmark.latitude)],
    },
    properties: {
      id: landmark.id,
      name: landmark.name,
      description: landmark.description ?? '',
      collection: landmark.collection,
      collection_name: landmark.collection_name ?? '',
      collection_color: landmark.collection_color ?? '',
      collection_type: isPersonal ? 'PERSONAL' : 'SHARED',
      is_personal_collection: isPersonal,
      can_write: landmark.can_write ?? false,
      can_delete: landmark.can_delete ?? false,
    },
  };
}

/**
 * Pull a `LandmarkApiObject` out of a mutation response body, accepting either
 * the `{ landmark: {...} }` envelope or a bare landmark object. Returns null if
 * no object with a string `id` is present (lenient; never throws). Used by the
 * offline replay path, which tolerates a malformed 2xx and falls back to the
 * locally intended values.
 */
export function extractLandmarkObject(data: unknown): LandmarkApiObject | null {
  const envelope = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const candidate =
    envelope.landmark && typeof envelope.landmark === 'object'
      ? (envelope.landmark as Record<string, unknown>)
      : envelope;
  if (typeof candidate.id !== 'string' || candidate.id === '') return null;
  return candidate as unknown as LandmarkApiObject;
}

function featureId(feature: GeoJSON.Feature): string {
  const fromProps =
    feature.properties && typeof feature.properties === 'object'
      ? (feature.properties as Record<string, unknown>).id
      : undefined;
  if (typeof fromProps === 'string' && fromProps !== '') return fromProps;
  if (typeof fromProps === 'number') return String(fromProps);
  if (typeof feature.id === 'string' && feature.id !== '') return feature.id;
  if (typeof feature.id === 'number') return String(feature.id);
  return '';
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Return a new FeatureCollection with the given landmark inserted or, if a
 * feature with the same id already exists, replaced in place. Immutable.
 */
export function upsertLandmarkFeature(
  collection: GeoJSON.FeatureCollection | null | undefined,
  landmark: LandmarkApiObject,
): GeoJSON.FeatureCollection {
  const base = collection && Array.isArray(collection.features)
    ? collection
    : emptyCollection();
  const feature = buildLandmarkFeatureFromApi(landmark);
  const id = landmark.id;

  let replaced = false;
  const features = base.features.map((existing) => {
    if (featureId(existing) === id) {
      replaced = true;
      return feature;
    }
    return existing;
  });
  if (!replaced) {
    features.push(feature);
  }

  return { ...base, type: 'FeatureCollection', features };
}

/**
 * Return a new FeatureCollection without the feature matching `id`. Immutable.
 * A no-op (still returns a fresh collection) when the id is absent.
 */
export function removeLandmarkFeature(
  collection: GeoJSON.FeatureCollection | null | undefined,
  id: string,
): GeoJSON.FeatureCollection {
  const base = collection && Array.isArray(collection.features)
    ? collection
    : emptyCollection();
  const features = base.features.filter((existing) => featureId(existing) !== id);
  return { ...base, type: 'FeatureCollection', features };
}

/**
 * Guarantee every landmark feature carries `properties.id`.
 *
 * The backend GeoJSON puts the landmark id only at the FEATURE level
 * (`feature.id = str(uuid)`), never in `properties`. MapLibre does not reliably
 * expose non-numeric feature ids through `queryRenderedFeatures`, so a tapped
 * landmark would otherwise resolve to an unknown id and edit/delete would target
 * the wrong record. Copying the feature id into `properties.id` (which MapLibre
 * always preserves) makes the id survive rendering + querying. Immutable; only
 * allocates new objects for features that were missing `properties.id`.
 */
export function ensureLandmarkPropertyIds(
  collection: GeoJSON.FeatureCollection | null | undefined,
): GeoJSON.FeatureCollection | null | undefined {
  if (!collection || !Array.isArray(collection.features)) return collection;

  let changed = false;
  const features = collection.features.map((feature) => {
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const hasPropertyId =
      (typeof properties.id === 'string' && properties.id !== '')
      || typeof properties.id === 'number';
    if (hasPropertyId) return feature;

    const featureLevelId = feature.id;
    if (
      featureLevelId === undefined
      || featureLevelId === null
      || featureLevelId === ''
    ) {
      return feature;
    }

    changed = true;
    return {
      ...feature,
      properties: { ...properties, id: String(featureLevelId) },
    };
  });

  return changed ? { ...collection, features } : collection;
}

// ==================== Collections mapping ====================

/** Backend `user_permission_level` granting write access (READ_AND_WRITE). */
export const WRITE_PERMISSION_LEVEL = 2;

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * Map the raw GET /api/v2/landmark-collections/ payload into the app's
 * `LandmarkCollection[]`, keeping only collections the user can write to (so the
 * picker never offers a collection that would 400 on assignment). Personal
 * collections are listed first, then alphabetical.
 */
export function mapLandmarkCollections(data: unknown): LandmarkCollection[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { results?: unknown[] }).results)
      ? (data as { results: unknown[] }).results
      : [];

  const collections: LandmarkCollection[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : typeof e.id === 'number' ? String(e.id) : '';
    if (!id) continue;

    const permissionLevel = readNumber(e.user_permission_level);
    const canWrite = permissionLevel >= WRITE_PERMISSION_LEVEL;
    if (!canWrite) continue;

    const isPersonal = e.is_personal === true;
    const name =
      typeof e.name === 'string' && e.name.trim()
        ? e.name.trim()
        : isPersonal
          ? 'Personal Landmarks'
          : 'Unnamed Collection';
    const color = typeof e.color === 'string' ? e.color : '';

    collections.push({ id, name, color, isPersonal, canWrite });
  }

  return collections.sort((a, b) => {
    if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// ==================== Error mapping ====================

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  return null;
}

function collectFieldErrors(errors: unknown): Record<string, string[]> | undefined {
  if (!errors || typeof errors !== 'object') return undefined;
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[key] = value.map((v) => String(v));
    } else if (typeof value === 'string') {
      out[key] = [value];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Map an HTTP status + body into a typed `LandmarkMutationError` with a
 * user-facing message. Pure; safe with any payload shape.
 */
export function parseLandmarkMutationError(
  status: number,
  data: unknown,
): LandmarkMutationError {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const topError = firstString(body.error) ?? firstString(body.detail) ?? firstString(body.message);

  if (status === 403 || status === 401) {
    return new LandmarkMutationError(
      'permission',
      topError ?? 'You do not have permission to modify this landmark.',
      { status },
    );
  }

  if (status === 404) {
    return new LandmarkMutationError(
      'not_found',
      topError ?? 'This landmark no longer exists.',
      { status },
    );
  }

  if (status === 400 || status === 422) {
    if (topError && /already exists/i.test(topError)) {
      return new LandmarkMutationError('duplicate', topError, { status });
    }
    const fieldErrors = collectFieldErrors(body.errors);
    if (fieldErrors) {
      const firstFieldMsg = Object.values(fieldErrors)[0]?.[0];
      return new LandmarkMutationError(
        'validation',
        firstFieldMsg ?? 'Some fields are invalid.',
        { status, fieldErrors },
      );
    }
    return new LandmarkMutationError(
      'validation',
      topError ?? 'Some fields are invalid.',
      { status },
    );
  }

  return new LandmarkMutationError(
    'unknown',
    topError ?? `Request failed (status ${status}).`,
    { status },
  );
}
