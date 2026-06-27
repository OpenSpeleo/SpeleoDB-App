/**
 * GpsTrackStore -- durable persistence for recorded GPS tracks.
 *
 * Each track is stored as its own record (keyed by track id) in the
 * `gps_tracks` IndexedDB object store, so a force-quit or crash mid-recording
 * can only ever affect the single track being written -- never the whole list.
 * Records survive app shutdown, crash, and phone restart (IndexedDB is on-disk)
 * and are cleared on logout via `ProjectCacheService.clearAll()`.
 *
 * The store is intentionally dumb: it persists `LocalGpsTrack` records and
 * never makes network calls or business decisions. See docs/gps-tracks.md.
 */

import { CacheStore } from './CacheStore';
import type { LocalGpsTrack } from '../types/gpsTrack';
import { normalizeHexColor } from '../utils/gpsTrackColors';

const STORE_NAME = 'gps_tracks';

/**
 * Heal a loaded record: `color` was added to `LocalGpsTrack` by the GPS-sync
 * feature, so tracks recorded by an older build are persisted WITHOUT it.
 * Backfilling a valid hex here keeps the in-memory invariant "every track has a
 * color" so the panel dot, map line, and (critically) the edit modal's
 * `color.toLowerCase()` never see `undefined`.
 */
function withSafeColor(track: LocalGpsTrack): LocalGpsTrack {
  const safe = normalizeHexColor(track.color);
  return safe === track.color ? track : { ...track, color: safe };
}

export class GpsTrackStore {
  private store: CacheStore;

  constructor(store?: CacheStore) {
    this.store = store ?? new CacheStore();
  }

  /**
   * Load all persisted tracks, newest first (by `createdAt`).
   *
   * Any 0-point record is dropped and best-effort deleted: such a record can
   * only come from an older build that persisted an empty in-progress track up
   * front and was force-quit before the first fix. It is not uploadable and
   * would just clutter the list, so listing self-heals it away.
   */
  async list(): Promise<LocalGpsTrack[]> {
    const entries = await this.store.getAll<LocalGpsTrack>(STORE_NAME);
    const valid = entries
      .map((entry) => entry?.data)
      .filter((data): data is LocalGpsTrack => Boolean(data && typeof data === 'object' && data.id));
    const tracks: LocalGpsTrack[] = [];
    for (const track of valid) {
      if (Array.isArray(track.points) && track.points.length > 0) {
        tracks.push(withSafeColor(track));
      } else {
        void this.remove(track.id).catch(() => {
          // Best-effort cleanup; never block listing on it.
        });
      }
    }
    return tracks.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Read a single track by id, or null when absent. */
  async get(id: string): Promise<LocalGpsTrack | null> {
    const entry = await this.store.get<LocalGpsTrack>(STORE_NAME, id);
    const track = entry?.data ?? null;
    if (!track) return null;
    if (Array.isArray(track.points) && track.points.length > 0) return withSafeColor(track);
    await this.remove(id).catch(() => {
      // Best-effort cleanup; callers should not see unusable empty tracks.
    });
    return null;
  }

  /** Insert or replace a single track record. */
  async put(track: LocalGpsTrack): Promise<void> {
    await this.store.set(STORE_NAME, track.id, { data: track, cachedAt: Date.now() });
  }

  /** Remove a single track by id. */
  async remove(id: string): Promise<void> {
    await this.store.delete(STORE_NAME, id);
  }

  /** Wipe all persisted tracks (e.g. on logout). */
  async clear(): Promise<void> {
    await this.store.clear(STORE_NAME);
  }
}
