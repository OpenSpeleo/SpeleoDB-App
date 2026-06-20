import { describe, it, expect } from 'vitest';
import {
  canonicalizeSnapshot,
  conflictRows,
  diffSnapshots,
  findLandmarkFeature,
  findLandmarkFeatureByIdentity,
  landmarkApiObjectFromFeature,
  normalizeCollection,
  roundCoordinate,
  snapshotFromApi,
  snapshotFromFeature,
  snapshotsEqual,
} from './landmarkSnapshot';
import type { LandmarkSnapshot } from '../types/offlineOp';

function feature(id: string, props: Record<string, unknown>, lon: number, lat: number): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    properties: { id, ...props },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  };
}

const baseSnapshot: LandmarkSnapshot = {
  name: 'Camp',
  description: 'Base',
  latitude: 45.5,
  longitude: -122.25,
  collection: 'col-1',
};

describe('landmarkSnapshot', () => {
  it('rounds coordinates to 6 decimals (the geojson precision)', () => {
    expect(roundCoordinate(1.123456789)).toBe(1.123457);
    // The 7th decimal (the create/edit API precision) is dropped, so a value
    // differing only there is treated as the same point.
    expect(roundCoordinate(20.3027113)).toBe(roundCoordinate(20.302711));
    expect(roundCoordinate(Number.NaN)).toBe(0);
  });

  it('normalizes empty/whitespace collection to null', () => {
    expect(normalizeCollection('')).toBeNull();
    expect(normalizeCollection('   ')).toBeNull();
    expect(normalizeCollection('col-1')).toBe('col-1');
    expect(normalizeCollection(null)).toBeNull();
  });

  it('builds equal snapshots from an api object and its rendered feature', () => {
    const api = {
      id: 'lm-1',
      name: 'Camp',
      description: 'Base',
      latitude: 45.5,
      longitude: -122.25,
      collection: 'col-1',
    };
    const fromApi = snapshotFromApi(api);
    const fromFeature = snapshotFromFeature(
      feature('lm-1', { name: 'Camp', description: 'Base', collection: 'col-1' }, -122.25, 45.5),
    );
    expect(snapshotsEqual(fromApi, fromFeature)).toBe(true);
  });

  it('treats canonicalization as stable and order-independent of object keys', () => {
    const a: LandmarkSnapshot = { ...baseSnapshot };
    const b: LandmarkSnapshot = {
      collection: 'col-1',
      longitude: -122.25,
      latitude: 45.5,
      description: 'Base',
      name: 'Camp',
    };
    expect(canonicalizeSnapshot(a)).toBe(canonicalizeSnapshot(b));
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it('detects difference when any footprint field changes (collection excluded)', () => {
    expect(snapshotsEqual(baseSnapshot, { ...baseSnapshot, name: 'Other' })).toBe(false);
    expect(snapshotsEqual(baseSnapshot, { ...baseSnapshot, description: 'Other' })).toBe(false);
    expect(snapshotsEqual(baseSnapshot, { ...baseSnapshot, latitude: 45.5001 })).toBe(false);
    // collection is intentionally NOT part of the footprint.
    expect(snapshotsEqual(baseSnapshot, { ...baseSnapshot, collection: null })).toBe(true);
  });

  it('excludes collection from the footprint (UUID vs empty are equal)', () => {
    // The create/edit API returns the personal collection UUID; the geojson
    // endpoint leaves it empty. These are irreconcilable, so collection is NOT
    // part of the footprint -- otherwise every edit/delete would falsely
    // conflict. Same name/description/coords -> equal footprints.
    const apiShape = snapshotFromFeature(
      feature('lm-1', { name: 'Camp', description: 'Base', collection: '1b6b338e-uuid' }, -122.25, 45.5),
    );
    const geojsonShape = snapshotFromFeature(
      feature('lm-1', { name: 'Camp', description: 'Base', collection: '' }, -122.25, 45.5),
    );
    expect(snapshotsEqual(apiShape, geojsonShape)).toBe(true);

    const fromApi = snapshotFromApi({
      id: 'lm-1',
      name: 'Camp',
      description: 'Base',
      latitude: 45.5,
      longitude: -122.25,
      collection: '1b6b338e-uuid',
    });
    expect(snapshotsEqual(fromApi, geojsonShape)).toBe(true);
  });

  it('treats 7-decimal (API) and 6-decimal (geojson) coordinates as equal', () => {
    // The create/edit API returns 7dp; the geojson serializes 6dp. The footprint
    // rounds both to 6dp so the same point is not a false conflict.
    const apiShape = snapshotFromFeature(
      feature('lm-1', { name: 'Bbb456', description: 'Bbb', collection: '' }, -87.4376589, 20.3027113),
    );
    const geojsonShape = snapshotFromFeature(
      feature('lm-1', { name: 'Bbb456', description: 'Bbb', collection: '' }, -87.437659, 20.302711),
    );
    expect(snapshotsEqual(apiShape, geojsonShape)).toBe(true);
    expect(apiShape.latitude).toBe(20.302711);
  });

  it('reproduces the reported footprint mismatch as EQUAL (7dp+UUID vs 6dp+empty)', () => {
    // Exact reported console data: baseline 7dp + personal UUID, server 6dp +
    // empty collection, same name/description. Must be equal (no false conflict).
    const baseline = snapshotFromFeature(
      feature('lm-1', { name: 'Bbb456', description: 'Bbb', collection: '1b6b338e-35b7-4a81-a982-c166e4301793' }, -87.4376589, 20.3027113),
    );
    const server = snapshotFromFeature(
      feature('lm-1', { name: 'Bbb456', description: 'Bbb', collection: '' }, -87.437659, 20.302711),
    );
    expect(snapshotsEqual(baseline, server)).toBe(true);
  });

  it('does not treat a collection-only change as a footprint change', () => {
    const a = snapshotFromFeature(feature('lm-1', { name: 'Camp', collection: 'col-1' }, 1, 2));
    const b = snapshotFromFeature(feature('lm-1', { name: 'Camp', collection: 'col-2' }, 1, 2));
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it('still detects name/description/coordinate changes', () => {
    const base = snapshotFromFeature(feature('lm-1', { name: 'Camp', description: 'A' }, 1, 2));
    expect(snapshotsEqual(base, snapshotFromFeature(feature('lm-1', { name: 'Other', description: 'A' }, 1, 2)))).toBe(false);
    expect(snapshotsEqual(base, snapshotFromFeature(feature('lm-1', { name: 'Camp', description: 'B' }, 1, 2)))).toBe(false);
    expect(snapshotsEqual(base, snapshotFromFeature(feature('lm-1', { name: 'Camp', description: 'A' }, 1.001, 2)))).toBe(false);
  });

  it('finds a feature by id and by identity (name + rounded coords)', () => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        feature('lm-1', { name: 'A', collection: 'col-1' }, -122.25, 45.5),
        feature('lm-2', { name: 'B', collection: 'col-2' }, 1, 2),
      ],
    };
    expect(findLandmarkFeature(fc, 'lm-2')?.id).toBe('lm-2');
    expect(findLandmarkFeature(fc, 'missing')).toBeNull();
    const found = findLandmarkFeatureByIdentity(fc, {
      name: 'A',
      description: '',
      latitude: 45.5,
      longitude: -122.25,
      collection: 'whatever-collection',
    });
    expect(found?.id).toBe('lm-1');
  });

  it('builds a full api object from a server feature', () => {
    const api = landmarkApiObjectFromFeature(
      feature(
        'lm-9',
        {
          name: 'Spring',
          description: 'desc',
          collection: 'col-1',
          collection_name: 'Survey A',
          collection_color: '#fff',
          is_personal_collection: false,
          can_write: true,
          can_delete: true,
        },
        3,
        4,
      ),
    );
    expect(api).toMatchObject({ id: 'lm-9', name: 'Spring', latitude: 4, longitude: 3, collection: 'col-1' });
  });

  it('produces human-readable field diffs and conflict rows', () => {
    const next: LandmarkSnapshot = { ...baseSnapshot, name: 'New Camp', latitude: 46 };
    const changes = diffSnapshots(baseSnapshot, next);
    expect(changes.map((c) => c.field).sort()).toEqual(['latitude', 'name']);

    const rows = conflictRows(next, baseSnapshot);
    expect(rows.map((r) => r.field).sort()).toEqual(['latitude', 'name']);
    expect(rows[0]).toHaveProperty('local');
    expect(rows[0]).toHaveProperty('server');
  });
});
