import { describe, it, expect } from 'vitest';
import { buildLandmarkCollectionGroups } from './landmarkCollections';
import { COLORS } from '../constants';

function feature(
  id: string,
  properties: Record<string, unknown>,
  coordinates: [number, number] = [2.3, 46.6],
): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    properties,
    geometry: { type: 'Point', coordinates },
  };
}

function collection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

describe('buildLandmarkCollectionGroups', () => {
  it('returns an empty array for null/empty input', () => {
    expect(buildLandmarkCollectionGroups(null)).toEqual([]);
    expect(buildLandmarkCollectionGroups(undefined)).toEqual([]);
    expect(buildLandmarkCollectionGroups(collection([]))).toEqual([]);
  });

  it('groups landmarks by collection with count and color', () => {
    const groups = buildLandmarkCollectionGroups(
      collection([
        feature('a', {
          name: 'Alpha',
          collection: 'col-1',
          collection_name: 'Survey A',
          collection_color: '#ff0000',
        }),
        feature('b', {
          name: 'Bravo',
          collection: 'col-1',
          collection_name: 'Survey A',
          collection_color: '#ff0000',
        }),
      ]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'col-1',
      name: 'Survey A',
      color: '#ff0000',
      isPersonal: false,
      count: 2,
    });
    expect(groups[0].landmarks.map((lm) => lm.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('sorts personal collections first, then alphabetically', () => {
    const groups = buildLandmarkCollectionGroups(
      collection([
        feature('a', { name: 'a', collection: 'shared-z', collection_name: 'Zeta' }),
        feature('b', { name: 'b', collection: 'shared-a', collection_name: 'Alpha' }),
        feature('c', {
          name: 'c',
          collection: 'mine',
          collection_name: 'Personal Landmarks',
          is_personal_collection: true,
        }),
      ]),
    );

    expect(groups.map((g) => g.name)).toEqual(['Personal Landmarks', 'Alpha', 'Zeta']);
    expect(groups[0].isPersonal).toBe(true);
  });

  it('treats collection_type PERSONAL as personal', () => {
    const groups = buildLandmarkCollectionGroups(
      collection([
        feature('a', { name: 'a', collection: 'mine', collection_type: 'PERSONAL' }),
      ]),
    );
    expect(groups[0].isPersonal).toBe(true);
  });

  it('falls back to the neutral color for missing/invalid collection color', () => {
    const groups = buildLandmarkCollectionGroups(
      collection([
        feature('a', { name: 'a', collection: 'col-1', collection_color: 'not-a-color' }),
      ]),
    );
    expect(groups[0].color).toBe(COLORS.FALLBACK);
  });

  it('sorts landmarks alphabetically within a group (case-insensitive)', () => {
    const groups = buildLandmarkCollectionGroups(
      collection([
        feature('a', { name: 'banana', collection: 'col-1' }),
        feature('b', { name: 'Apple', collection: 'col-1' }),
        feature('c', { name: 'cherry', collection: 'col-1' }),
      ]),
    );
    expect(groups[0].landmarks.map((lm) => lm.name)).toEqual(['Apple', 'banana', 'cherry']);
  });

  it('skips malformed features (no geometry, bad coords, no id)', () => {
    const groups = buildLandmarkCollectionGroups(
      collection([
        { type: 'Feature', id: 'a', properties: { name: 'no geometry' }, geometry: null } as unknown as GeoJSON.Feature,
        feature('b', { name: 'bad coords', collection: 'col-1' }, ['x', 'y'] as unknown as [number, number]),
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } } as GeoJSON.Feature,
        feature('d', { id: 'd', name: 'good', collection: 'col-1' }),
      ]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
    expect(groups[0].landmarks[0].name).toBe('good');
  });

  it('defaults names for unnamed landmarks and collections', () => {
    const personal = buildLandmarkCollectionGroups(
      collection([feature('a', { is_personal_collection: true })]),
    );
    expect(personal[0].name).toBe('Personal Landmarks');
    expect(personal[0].landmarks[0].name).toBe('Unnamed Landmark');

    const shared = buildLandmarkCollectionGroups(
      collection([feature('b', { collection: 'col-9' })]),
    );
    expect(shared[0].name).toBe('Unnamed Collection');
  });

  it('groups landmarks without a collection id under a personal bucket', () => {
    const groups = buildLandmarkCollectionGroups(
      collection([feature('a', { name: 'orphan' })]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('__personal__');
    expect(groups[0].landmarks[0].latitude).toBe(46.6);
    expect(groups[0].landmarks[0].longitude).toBe(2.3);
  });
});
