/**
 * Pure helpers for the "last known state" of a landmark.
 *
 * The offline queue stores a `LandmarkSnapshot` (the comparable fields) as the
 * baseline for each edit/delete. On replay we re-pull the server state, build a
 * snapshot from it, and compare: equal -> safe to push; different -> conflict.
 *
 * Kept free of React/network/storage so it is trivially testable and reused by
 * the ops, the queue, and the conflict UI.
 *
 * See docs/offline-op-queue.md.
 */

import type { LandmarkApiObject } from '../types/landmark';
import type {
  LandmarkSnapshot,
  OfflineOpConflictRow,
  OfflineOpFieldChange,
} from '../types/offlineOp';

/**
 * Footprint coordinate precision.
 *
 * The two server surfaces disagree on precision: the create/edit API
 * (`POST/PATCH /landmarks/`) returns 7 decimals, while the map
 * `/landmarks/geojson/` endpoint serializes 6. Comparing them raw flags a false
 * conflict on every edit/delete. 6 decimal degrees is ~0.11 m -- far finer than
 * any meaningful landmark move -- so rounding the footprint to 6 dp makes the
 * two surfaces agree without losing real-change sensitivity.
 */
export const FOOTPRINT_COORDINATE_PRECISION = 6;

export function roundCoordinate(value: number): number {
  return Number.isFinite(value)
    ? parseFloat(value.toFixed(FOOTPRINT_COORDINATE_PRECISION))
    : 0;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Normalize a collection id: empty string / null / undefined all mean "none". */
export function normalizeCollection(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

/** Resolve a landmark feature's stable id from `properties.id` or `feature.id`. */
export function featureLandmarkId(feature: GeoJSON.Feature): string {
  const props =
    feature.properties && typeof feature.properties === 'object'
      ? (feature.properties as Record<string, unknown>)
      : {};
  const fromProps = props.id;
  if (typeof fromProps === 'string' && fromProps !== '') return fromProps;
  if (typeof fromProps === 'number') return String(fromProps);
  if (typeof feature.id === 'string' && feature.id !== '') return feature.id;
  if (typeof feature.id === 'number') return String(feature.id);
  return '';
}

function pointCoordinates(feature: GeoJSON.Feature): [number, number] {
  const geometry = feature.geometry;
  if (geometry && geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    return [asNumber(lon), asNumber(lat)];
  }
  return [0, 0];
}

export function snapshotFromApi(landmark: LandmarkApiObject): LandmarkSnapshot {
  return {
    name: asString(landmark.name),
    description: asString(landmark.description),
    latitude: roundCoordinate(asNumber(landmark.latitude)),
    longitude: roundCoordinate(asNumber(landmark.longitude)),
    collection: normalizeCollection(landmark.collection),
  };
}

/**
 * Build a full `LandmarkApiObject` from a server geojson feature. Used when
 * adopting the server's version of a landmark during conflict resolution or
 * create-dedupe.
 */
export function landmarkApiObjectFromFeature(feature: GeoJSON.Feature): LandmarkApiObject {
  const props =
    feature.properties && typeof feature.properties === 'object'
      ? (feature.properties as Record<string, unknown>)
      : {};
  const [lon, lat] = pointCoordinates(feature);
  return {
    id: featureLandmarkId(feature),
    name: asString(props.name),
    description: asString(props.description),
    latitude: roundCoordinate(lat),
    longitude: roundCoordinate(lon),
    collection: normalizeCollection(props.collection) ?? '',
    collection_name: asString(props.collection_name),
    collection_color: asString(props.collection_color),
    is_personal_collection: props.is_personal_collection === true,
    can_write: props.can_write !== false,
    can_delete: props.can_delete !== false,
  };
}

export function snapshotFromFeature(feature: GeoJSON.Feature): LandmarkSnapshot {
  const props =
    feature.properties && typeof feature.properties === 'object'
      ? (feature.properties as Record<string, unknown>)
      : {};
  const [lon, lat] = pointCoordinates(feature);
  return {
    name: asString(props.name),
    description: asString(props.description),
    latitude: roundCoordinate(lat),
    longitude: roundCoordinate(lon),
    collection: normalizeCollection(props.collection),
  };
}

/**
 * Canonical string form used for exact comparison + hashing.
 *
 * `collection` is intentionally **excluded** from the footprint. The two server
 * surfaces represent it irreconcilably (the create/edit API returns the
 * personal collection's UUID; the `/landmarks/geojson/` endpoint empties it),
 * and there is no reliable client-side way to map between them, so including it
 * produced a false "changed on the server" conflict on every edit/delete. Name,
 * description, and 6-dp coordinates reliably detect a real server-side change; a
 * collection move on its own is treated as last-writer-wins (consistent with the
 * online eventual-consistency model in docs/landmark-crud.md).
 */
export function canonicalizeSnapshot(snapshot: LandmarkSnapshot): string {
  return JSON.stringify([
    snapshot.name,
    snapshot.description,
    roundCoordinate(snapshot.latitude),
    roundCoordinate(snapshot.longitude),
  ]);
}

/** Exact equality of two snapshots (canonical comparison, collision-free). */
export function snapshotsEqual(a: LandmarkSnapshot, b: LandmarkSnapshot): boolean {
  return canonicalizeSnapshot(a) === canonicalizeSnapshot(b);
}

/** Find a landmark feature by id within a FeatureCollection. */
export function findLandmarkFeature(
  collection: GeoJSON.FeatureCollection | null | undefined,
  id: string,
): GeoJSON.Feature | null {
  if (!collection || !Array.isArray(collection.features)) return null;
  for (const feature of collection.features) {
    if (featureLandmarkId(feature) === id) return feature;
  }
  return null;
}

/**
 * Find a landmark feature that matches a create op's identity
 * (collection + rounded coordinates). Used to dedupe a create replay when the
 * landmark already exists server-side (e.g. a "200 to nothing" tunnel).
 */
export function findLandmarkFeatureByIdentity(
  collection: GeoJSON.FeatureCollection | null | undefined,
  snapshot: LandmarkSnapshot,
): GeoJSON.Feature | null {
  if (!collection || !Array.isArray(collection.features)) return null;
  for (const feature of collection.features) {
    const candidate = snapshotFromFeature(feature);
    // Identity = name + 6-dp coordinates (collection is excluded for the same
    // representation reasons as the footprint comparison).
    if (
      candidate.name === snapshot.name &&
      candidate.latitude === roundCoordinate(snapshot.latitude) &&
      candidate.longitude === roundCoordinate(snapshot.longitude)
    ) {
      return feature;
    }
  }
  return null;
}

const FIELD_LABELS: Record<keyof LandmarkSnapshot, string> = {
  name: 'Name',
  description: 'Description',
  latitude: 'Latitude',
  longitude: 'Longitude',
  collection: 'Collection',
};

function displayValue(field: keyof LandmarkSnapshot, snapshot: LandmarkSnapshot): string {
  // Only ever called with FOOTPRINT_FIELDS (name/description/latitude/longitude);
  // `collection` is excluded from the footprint and the diff/conflict views.
  const value = snapshot[field];
  if (value === '' || value === null || value === undefined) return '\u2014';
  return String(value);
}

/** Human-readable field changes between two snapshots (only those that differ). */
/** Fields that make up the footprint (and the diff/conflict views). */
const FOOTPRINT_FIELDS: (keyof LandmarkSnapshot)[] = [
  'name',
  'description',
  'latitude',
  'longitude',
];

export function diffSnapshots(
  from: LandmarkSnapshot,
  to: LandmarkSnapshot,
): OfflineOpFieldChange[] {
  const fields = FOOTPRINT_FIELDS;
  const changes: OfflineOpFieldChange[] = [];
  for (const field of fields) {
    const before = displayValue(field, from);
    const after = displayValue(field, to);
    if (before !== after) {
      changes.push({ field, label: FIELD_LABELS[field], from: before, to: after });
    }
  }
  return changes;
}

/** Conflict diff rows (local vs server) for the conflict modal. */
export function conflictRows(
  local: LandmarkSnapshot | null,
  server: LandmarkSnapshot | null,
): OfflineOpConflictRow[] {
  const fields = FOOTPRINT_FIELDS;
  const rows: OfflineOpConflictRow[] = [];
  for (const field of fields) {
    const localValue = local ? displayValue(field, local) : '\u2014';
    const serverValue = server ? displayValue(field, server) : '\u2014';
    if (localValue !== serverValue) {
      rows.push({ field, label: FIELD_LABELS[field], local: localValue, server: serverValue });
    }
  }
  return rows;
}
