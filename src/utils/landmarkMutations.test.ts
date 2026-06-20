import { describe, it, expect } from 'vitest';
import {
  LANDMARK_NAME_MAX_LENGTH,
  WRITE_PERMISSION_LEVEL,
  validateLandmarkInput,
  buildLandmarkFeatureFromApi,
  upsertLandmarkFeature,
  removeLandmarkFeature,
  ensureLandmarkPropertyIds,
  mapLandmarkCollections,
  parseLandmarkMutationError,
} from './landmarkMutations';
import type { LandmarkApiObject } from '../types/landmark';
import { LandmarkMutationError } from '../types/landmark';

// ==================== validateLandmarkInput ====================

describe('validateLandmarkInput', () => {
  const valid = { name: 'Camp', description: 'desc', latitude: 45, longitude: -122 };

  it('accepts a fully valid input and normalizes values', () => {
    const result = validateLandmarkInput({ ...valid, collection: 'col-1' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      name: 'Camp',
      description: 'desc',
      latitude: 45,
      longitude: -122,
      collection: 'col-1',
    });
  });

  it('trims name and description', () => {
    const result = validateLandmarkInput({ ...valid, name: '  Camp  ', description: '  d  ' });
    expect(result.value?.name).toBe('Camp');
    expect(result.value?.description).toBe('d');
  });

  it('requires a non-empty name', () => {
    expect(validateLandmarkInput({ ...valid, name: '' }).fieldErrors.name).toBeDefined();
    expect(validateLandmarkInput({ ...valid, name: '   ' }).fieldErrors.name).toBeDefined();
  });

  it('rejects names over the max length', () => {
    const longName = 'x'.repeat(LANDMARK_NAME_MAX_LENGTH + 1);
    expect(validateLandmarkInput({ ...valid, name: longName }).fieldErrors.name).toBeDefined();
  });

  it('accepts a name exactly at the max length', () => {
    const maxName = 'x'.repeat(LANDMARK_NAME_MAX_LENGTH);
    expect(validateLandmarkInput({ ...valid, name: maxName }).ok).toBe(true);
  });

  it.each([-90, 90, 0, 45.1234567])('accepts latitude boundary %s', (lat) => {
    expect(validateLandmarkInput({ ...valid, latitude: lat }).ok).toBe(true);
  });

  it.each([-90.0001, 90.0001, 91, -1000])('rejects out-of-range latitude %s', (lat) => {
    expect(validateLandmarkInput({ ...valid, latitude: lat }).fieldErrors.latitude).toBeDefined();
  });

  it.each([-180, 180, 0])('accepts longitude boundary %s', (lon) => {
    expect(validateLandmarkInput({ ...valid, longitude: lon }).ok).toBe(true);
  });

  it.each([-180.0001, 180.0001, 999])('rejects out-of-range longitude %s', (lon) => {
    expect(validateLandmarkInput({ ...valid, longitude: lon }).fieldErrors.longitude).toBeDefined();
  });

  it('parses numeric strings from form inputs', () => {
    const result = validateLandmarkInput({ ...valid, latitude: '45.5', longitude: '-122.25' });
    expect(result.ok).toBe(true);
    expect(result.value?.latitude).toBe(45.5);
    expect(result.value?.longitude).toBe(-122.25);
  });

  it.each(['', '   ', 'abc', 'NaN', '12abc'])('rejects unparseable coordinate "%s"', (bad) => {
    const result = validateLandmarkInput({ ...valid, latitude: bad });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.latitude).toBeDefined();
  });

  it('rejects non-finite numeric coordinates (NaN/Infinity)', () => {
    expect(validateLandmarkInput({ ...valid, latitude: NaN }).fieldErrors.latitude).toBeDefined();
    expect(validateLandmarkInput({ ...valid, longitude: Infinity }).fieldErrors.longitude).toBeDefined();
  });

  it('treats empty/whitespace collection as null (personal)', () => {
    expect(validateLandmarkInput({ ...valid, collection: '' }).value?.collection).toBeNull();
    expect(validateLandmarkInput({ ...valid, collection: '   ' }).value?.collection).toBeNull();
    expect(validateLandmarkInput({ ...valid, collection: null }).value?.collection).toBeNull();
    expect(validateLandmarkInput({ ...valid }).value?.collection).toBeNull();
  });

  it('preserves unicode names', () => {
    const result = validateLandmarkInput({ ...valid, name: 'Grotte de Padirac 🕳️' });
    expect(result.value?.name).toBe('Grotte de Padirac 🕳️');
  });

  it('reports all invalid fields at once', () => {
    const result = validateLandmarkInput({ name: '', description: '', latitude: 999, longitude: 999 });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.fieldErrors).sort()).toEqual(['latitude', 'longitude', 'name']);
  });

  it('never returns a value when invalid', () => {
    expect(validateLandmarkInput({ name: '', description: '', latitude: 1, longitude: 1 }).value).toBeUndefined();
  });
});

// ==================== buildLandmarkFeatureFromApi ====================

const apiLandmark: LandmarkApiObject = {
  id: 'lm-1',
  name: 'Camp',
  description: 'Base camp',
  latitude: 45.12345678,
  longitude: -122.7654321,
  collection: 'col-1',
  collection_name: 'Survey A',
  collection_color: '#3b82f6',
  is_personal_collection: false,
  can_write: true,
  can_delete: true,
};

describe('buildLandmarkFeatureFromApi', () => {
  it('produces a Point feature with id at feature + property level', () => {
    const feature = buildLandmarkFeatureFromApi(apiLandmark);
    expect(feature.type).toBe('Feature');
    expect(feature.id).toBe('lm-1');
    expect(feature.properties?.id).toBe('lm-1');
    expect(feature.geometry.type).toBe('Point');
  });

  it('orders coordinates [lon, lat] and rounds to 7 dp', () => {
    const feature = buildLandmarkFeatureFromApi(apiLandmark);
    const coords = (feature.geometry as GeoJSON.Point).coordinates;
    expect(coords[0]).toBe(-122.7654321);
    expect(coords[1]).toBe(45.1234568); // rounded
  });

  it('mirrors the geojson endpoint property shape consumed by the map/panel', () => {
    const props = buildLandmarkFeatureFromApi(apiLandmark).properties!;
    expect(props).toMatchObject({
      name: 'Camp',
      description: 'Base camp',
      collection: 'col-1',
      collection_name: 'Survey A',
      collection_color: '#3b82f6',
      collection_type: 'SHARED',
      is_personal_collection: false,
      can_write: true,
      can_delete: true,
    });
  });

  it('marks personal collections with collection_type PERSONAL', () => {
    const props = buildLandmarkFeatureFromApi({ ...apiLandmark, is_personal_collection: true }).properties!;
    expect(props.collection_type).toBe('PERSONAL');
    expect(props.is_personal_collection).toBe(true);
  });

  it('defaults missing optional fields safely', () => {
    const props = buildLandmarkFeatureFromApi({
      id: 'x',
      name: 'N',
      description: '',
      latitude: 1,
      longitude: 2,
      collection: 'c',
    }).properties!;
    expect(props.collection_name).toBe('');
    expect(props.collection_color).toBe('');
    expect(props.can_write).toBe(false);
    expect(props.can_delete).toBe(false);
  });
});

// ==================== upsert / remove ====================

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

describe('upsertLandmarkFeature', () => {
  it('appends a new feature when none matches', () => {
    const before = fc([]);
    const after = upsertLandmarkFeature(before, apiLandmark);
    expect(after.features).toHaveLength(1);
    expect(after.features[0].id).toBe('lm-1');
  });

  it('replaces an existing feature in place (by property id)', () => {
    const existing = buildLandmarkFeatureFromApi(apiLandmark);
    const before = fc([existing, buildLandmarkFeatureFromApi({ ...apiLandmark, id: 'lm-2' })]);
    const after = upsertLandmarkFeature(before, { ...apiLandmark, name: 'Renamed' });
    expect(after.features).toHaveLength(2);
    const updated = after.features.find((f) => f.id === 'lm-1');
    expect(updated?.properties?.name).toBe('Renamed');
  });

  it('matches features that only carry a feature-level id', () => {
    const legacy: GeoJSON.Feature = {
      type: 'Feature',
      id: 'lm-1',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { name: 'old' },
    };
    const after = upsertLandmarkFeature(fc([legacy]), { ...apiLandmark, name: 'new' });
    expect(after.features).toHaveLength(1);
    expect(after.features[0].properties?.name).toBe('new');
  });

  it('is immutable (does not mutate the input collection)', () => {
    const before = fc([]);
    upsertLandmarkFeature(before, apiLandmark);
    expect(before.features).toHaveLength(0);
  });

  it('tolerates null/undefined/garbage collections', () => {
    expect(upsertLandmarkFeature(null, apiLandmark).features).toHaveLength(1);
    expect(upsertLandmarkFeature(undefined, apiLandmark).features).toHaveLength(1);
    expect(
      upsertLandmarkFeature({ type: 'FeatureCollection' } as unknown as GeoJSON.FeatureCollection, apiLandmark)
        .features,
    ).toHaveLength(1);
  });
});

describe('removeLandmarkFeature', () => {
  it('removes the matching feature', () => {
    const before = fc([
      buildLandmarkFeatureFromApi(apiLandmark),
      buildLandmarkFeatureFromApi({ ...apiLandmark, id: 'lm-2' }),
    ]);
    const after = removeLandmarkFeature(before, 'lm-1');
    expect(after.features.map((f) => f.id)).toEqual(['lm-2']);
  });

  it('is a no-op for an unknown id (returns a fresh collection)', () => {
    const before = fc([buildLandmarkFeatureFromApi(apiLandmark)]);
    const after = removeLandmarkFeature(before, 'does-not-exist');
    expect(after.features).toHaveLength(1);
    expect(after).not.toBe(before);
  });

  it('is immutable', () => {
    const before = fc([buildLandmarkFeatureFromApi(apiLandmark)]);
    removeLandmarkFeature(before, 'lm-1');
    expect(before.features).toHaveLength(1);
  });

  it('tolerates null/garbage', () => {
    expect(removeLandmarkFeature(null, 'x').features).toEqual([]);
    expect(removeLandmarkFeature(undefined, 'x').features).toEqual([]);
  });
});

// ==================== ensureLandmarkPropertyIds ====================

describe('ensureLandmarkPropertyIds', () => {
  it('copies the feature-level id into properties.id (server GeoJSON shape)', () => {
    // The backend emits id only at feature level, with no id in properties.
    const server = fc([
      {
        type: 'Feature',
        id: '550e8400-e29b-41d4-a716-446655440000',
        properties: { name: 'Camp' },
        geometry: { type: 'Point', coordinates: [2.3, 46.6] },
      },
    ]);
    const result = ensureLandmarkPropertyIds(server)!;
    expect(result.features[0].properties?.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    // Other properties preserved.
    expect(result.features[0].properties?.name).toBe('Camp');
  });

  it('stringifies a numeric feature id', () => {
    const result = ensureLandmarkPropertyIds(
      fc([{ type: 'Feature', id: 42, properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]),
    )!;
    expect(result.features[0].properties?.id).toBe('42');
  });

  it('leaves features that already have properties.id untouched (same reference)', () => {
    const feature: GeoJSON.Feature = {
      type: 'Feature',
      id: 'x',
      properties: { id: 'x', name: 'A' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };
    const collection = fc([feature]);
    const result = ensureLandmarkPropertyIds(collection)!;
    // No change needed -> same collection + feature references.
    expect(result).toBe(collection);
    expect(result.features[0]).toBe(feature);
  });

  it('skips features with no id at all', () => {
    const feature: GeoJSON.Feature = {
      type: 'Feature',
      properties: { name: 'no id' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };
    const result = ensureLandmarkPropertyIds(fc([feature]))!;
    expect(result.features[0].properties?.id).toBeUndefined();
  });

  it('is immutable for changed features', () => {
    const server = fc([
      { type: 'Feature', id: 'a', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ]);
    const result = ensureLandmarkPropertyIds(server)!;
    expect(result).not.toBe(server);
    expect(server.features[0].properties?.id).toBeUndefined();
  });

  it('tolerates null/undefined/garbage', () => {
    expect(ensureLandmarkPropertyIds(null)).toBeNull();
    expect(ensureLandmarkPropertyIds(undefined)).toBeUndefined();
    expect(
      ensureLandmarkPropertyIds({ type: 'FeatureCollection' } as unknown as GeoJSON.FeatureCollection),
    ).toEqual({ type: 'FeatureCollection' });
  });

  it('makes a built-from-api feature round-trip with a stable id', () => {
    const built = buildLandmarkFeatureFromApi(apiLandmark);
    const result = ensureLandmarkPropertyIds(fc([built]))!;
    // Already had properties.id, so it stays and matches the api id.
    expect(result.features[0].properties?.id).toBe(apiLandmark.id);
  });
});

// ==================== mapLandmarkCollections ====================

describe('mapLandmarkCollections', () => {
  const raw = [
    { id: 'c1', name: 'Survey A', color: '#111111', is_personal: false, user_permission_level: 2 },
    { id: 'c2', name: 'Read Only', color: '#222222', is_personal: false, user_permission_level: 1 },
    { id: 'c3', name: 'My Stuff', color: '#333333', is_personal: true, user_permission_level: 3 },
  ];

  it('keeps only writable collections (level >= WRITE_PERMISSION_LEVEL)', () => {
    const result = mapLandmarkCollections(raw);
    expect(result.map((c) => c.id)).toEqual(['c3', 'c1']); // personal first, then alpha
    expect(result.every((c) => c.canWrite)).toBe(true);
    expect(WRITE_PERMISSION_LEVEL).toBe(2);
  });

  it('sorts personal first, then alphabetical', () => {
    const result = mapLandmarkCollections([
      { id: 'b', name: 'Bravo', is_personal: false, user_permission_level: 2 },
      { id: 'a', name: 'Alpha', is_personal: false, user_permission_level: 2 },
      { id: 'p', name: 'Zebra', is_personal: true, user_permission_level: 2 },
    ]);
    expect(result.map((c) => c.id)).toEqual(['p', 'a', 'b']);
  });

  it('unwraps a paginated { results } payload', () => {
    expect(mapLandmarkCollections({ results: raw })).toHaveLength(2);
  });

  it('falls back to default names', () => {
    const result = mapLandmarkCollections([
      { id: 'x', is_personal: true, user_permission_level: 2 },
      { id: 'y', is_personal: false, user_permission_level: 2 },
    ]);
    expect(result.find((c) => c.id === 'x')?.name).toBe('Personal Landmarks');
    expect(result.find((c) => c.id === 'y')?.name).toBe('Unnamed Collection');
  });

  it('returns [] for non-array / garbage payloads', () => {
    expect(mapLandmarkCollections(null)).toEqual([]);
    expect(mapLandmarkCollections('nope')).toEqual([]);
    expect(mapLandmarkCollections({})).toEqual([]);
    expect(mapLandmarkCollections([null, 42, 'x'])).toEqual([]);
  });

  it('skips entries without an id', () => {
    expect(mapLandmarkCollections([{ name: 'No Id', user_permission_level: 2 }])).toEqual([]);
  });
});

// ==================== parseLandmarkMutationError ====================

describe('parseLandmarkMutationError', () => {
  it('maps 403/401 to a permission error', () => {
    expect(parseLandmarkMutationError(403, {}).kind).toBe('permission');
    expect(parseLandmarkMutationError(401, {}).kind).toBe('permission');
  });

  it('maps 404 to not_found', () => {
    expect(parseLandmarkMutationError(404, {}).kind).toBe('not_found');
  });

  it('detects a duplicate-coordinate 400 from the error message', () => {
    const err = parseLandmarkMutationError(400, {
      error: 'A landmark for GPS coordinate (1, 2) already exists or is invalid.',
    });
    expect(err.kind).toBe('duplicate');
    expect(err.message).toMatch(/already exists/i);
  });

  it('maps field validation 400 with the first field message', () => {
    const err = parseLandmarkMutationError(400, {
      errors: { latitude: ['Too big'], name: ['Required'] },
    });
    expect(err.kind).toBe('validation');
    expect(err.fieldErrors).toEqual({ latitude: ['Too big'], name: ['Required'] });
    expect(typeof err.message).toBe('string');
  });

  it('handles 422 like 400', () => {
    expect(parseLandmarkMutationError(422, { errors: { name: ['x'] } }).kind).toBe('validation');
  });

  it('falls back to unknown for unexpected statuses', () => {
    const err = parseLandmarkMutationError(500, {});
    expect(err.kind).toBe('unknown');
    expect(err.message).toContain('500');
  });

  it('prefers detail/message fields when error is absent', () => {
    expect(parseLandmarkMutationError(400, { detail: 'bad' }).message).toBe('bad');
    expect(parseLandmarkMutationError(400, { message: 'nope' }).message).toBe('nope');
  });

  it('never throws on weird payloads', () => {
    expect(() => parseLandmarkMutationError(400, null)).not.toThrow();
    expect(() => parseLandmarkMutationError(400, 'string body')).not.toThrow();
    expect(() => parseLandmarkMutationError(400, [1, 2, 3])).not.toThrow();
    expect(parseLandmarkMutationError(400, null)).toBeInstanceOf(LandmarkMutationError);
  });
});
