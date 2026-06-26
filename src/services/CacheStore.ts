/**
 * CacheStore -- thin Promise-based wrapper around IndexedDB.
 *
 * Provides a simple key-value interface with timestamps.  No external
 * dependencies; the raw IndexedDB API is wrapped just enough to keep
 * call-sites readable.
 *
 * Database : "speleo_cache"  (version 3)
 * Stores   : "projects", "geojson", "offline_ops", "gps_tracks"
 *
 * Version history:
 * - v1: "projects", "geojson".
 * - v2: added "offline_ops" for the offline mutation queue. The migration is
 *   purely additive (`createObjectStore` for the missing store); existing
 *   "projects"/"geojson" data is preserved with zero loss.
 * - v3: added "gps_tracks" for recorded GPS tracks (record offline, upload on
 *   reconnect). Same additive migration; all existing data is preserved.
 */

// ==================== Stored entry shape ====================

export interface CacheEntry<T = unknown> {
  data: T;
  cachedAt: number;
  meta?: Record<string, string>;
}

// ==================== Constants ====================

const DB_NAME = 'speleo_cache';
const DB_VERSION = 3;
const STORE_NAMES = ['projects', 'geojson', 'offline_ops', 'gps_tracks'] as const;

export type StoreName = (typeof STORE_NAMES)[number];

// ==================== CacheStore ====================

export class CacheStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Open (or create) the IndexedDB database.
   * The returned promise is cached so only one connection is ever created.
   */
  open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  /**
   * Read a single entry from a store by key.
   */
  async get<T = unknown>(store: StoreName, key: string): Promise<CacheEntry<T> | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as CacheEntry<T>) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Read every entry value from a store. Used by the offline queue to load all
   * persisted ops at once. Order is not guaranteed; callers sort as needed.
   */
  async getAll<T = unknown>(store: StoreName): Promise<CacheEntry<T>[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as CacheEntry<T>[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Write an entry to a store under the given key.
   */
  async set<T = unknown>(store: StoreName, key: string, value: CacheEntry<T>): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Delete a single entry from a store.
   */
  async delete(store: StoreName, key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Remove all entries from a store.
   */
  async clear(store: StoreName): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
