import { beforeEach, describe, expect, it } from 'vitest';
import { GpsTrackStore } from './GpsTrackStore';
import { ProjectCacheService } from './ProjectCacheService';
import { isValidHexColor } from '../utils/gpsTrackColors';
import type { LocalGpsTrack } from '../types/gpsTrack';

function makeTrack(overrides: Partial<LocalGpsTrack> = {}): LocalGpsTrack {
  return {
    id: 'trk-1',
    name: 'Track 1',
    color: '#e41a1c',
    points: [{ latitude: 1, longitude: 2, timestamp: 0 }],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('GpsTrackStore', () => {
  let store: GpsTrackStore;

  beforeEach(async () => {
    store = new GpsTrackStore();
    await store.clear();
  });

  it('puts and gets a single track', async () => {
    const track = makeTrack();
    await store.put(track);
    expect(await store.get('trk-1')).toEqual(track);
  });

  it('returns null for a missing track', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('lists tracks newest-first by createdAt', async () => {
    await store.put(makeTrack({ id: 'a', createdAt: 100 }));
    await store.put(makeTrack({ id: 'b', createdAt: 300 }));
    await store.put(makeTrack({ id: 'c', createdAt: 200 }));

    const list = await store.list();
    expect(list.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('replaces an existing track on put', async () => {
    await store.put(makeTrack({ name: 'Old' }));
    await store.put(makeTrack({ name: 'New', color: '#377eb8' }));
    const got = await store.get('trk-1');
    expect(got?.name).toBe('New');
    expect(got?.color).toBe('#377eb8');
  });

  it('removes a track by id', async () => {
    await store.put(makeTrack());
    await store.remove('trk-1');
    expect(await store.get('trk-1')).toBeNull();
  });

  it('clears all tracks', async () => {
    await store.put(makeTrack({ id: 'a' }));
    await store.put(makeTrack({ id: 'b' }));
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('ignores malformed records when listing', async () => {
    await store.put(makeTrack({ id: 'good' }));
    // Write a junk record directly through the shared cache store.
    const cacheStore = (store as unknown as { store: { set: (s: string, k: string, v: unknown) => Promise<void> } }).store;
    await cacheStore.set('gps_tracks', 'junk', { data: null, cachedAt: Date.now() });

    const list = await store.list();
    expect(list.map((t) => t.id)).toEqual(['good']);
  });

  it('drops and self-heals 0-point records when listing', async () => {
    await store.put(makeTrack({ id: 'good', points: [{ latitude: 1, longitude: 2, timestamp: 0 }] }));
    // A 0-point record can only come from an older build that persisted an
    // empty in-progress track up front and was force-quit before the first fix.
    await store.put(makeTrack({ id: 'empty', points: [] }));

    const list = await store.list();
    expect(list.map((t) => t.id)).toEqual(['good']);

    // The empty record is best-effort deleted so it cannot accumulate.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await store.get('empty')).toBeNull();
    expect(await store.get('good')).not.toBeNull();
  });

  it('drops and self-heals a 0-point record when reading by id', async () => {
    await store.put(makeTrack({ id: 'empty', points: [] }));

    expect(await store.get('empty')).toBeNull();
    expect(await store.get('empty')).toBeNull();
  });

  it('backfills a valid color for records persisted without one (older build)', async () => {
    // `color` was added to LocalGpsTrack by the GPS-sync feature, so a track
    // recorded by an older build has no `color`. Loading it must never yield
    // `undefined` (the edit modal calls `color.toLowerCase()` and would crash).
    const colorless = {
      id: 'legacy',
      name: 'Legacy Track',
      points: [{ latitude: 1, longitude: 2, timestamp: 0 }],
      createdAt: 100,
      updatedAt: 100,
    } as unknown as LocalGpsTrack;
    await store.put(colorless);

    const listed = (await store.list()).find((t) => t.id === 'legacy');
    expect(listed).toBeDefined();
    expect(isValidHexColor(listed!.color)).toBe(true);

    const fetched = await store.get('legacy');
    expect(fetched).not.toBeNull();
    expect(isValidHexColor(fetched!.color)).toBe(true);
  });
});

describe('GpsTrackStore + ProjectCacheService logout purge', () => {
  it('clearAll() wipes recorded tracks while preserving the additive migration', async () => {
    const store = new GpsTrackStore();
    const cache = new ProjectCacheService();
    await store.clear();

    await store.put(makeTrack({ id: 'keep-until-logout' }));
    // Seed unrelated stores to prove the migration kept them independent.
    await cache.setProjects([]);
    await cache.setOverlayGeoJSON('landmarks', { type: 'FeatureCollection', features: [] });

    await cache.clearAll();

    expect(await store.list()).toEqual([]);
    expect(await cache.getProjects()).toBeNull();
    expect(await cache.getOverlayGeoJSON('landmarks')).toBeNull();
  });
});
