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

import { createAbortError, throwIfAborted } from '../utils/abort';

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

export interface CacheStoreWriteOptions {
  signal?: AbortSignal;
}

function abortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof signal?.reason === 'string' && signal.reason.trim()) {
    return createAbortError(signal.reason);
  }
  return createAbortError();
}

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
  async set<T = unknown>(
    store: StoreName,
    key: string,
    value: CacheEntry<T>,
    options: CacheStoreWriteOptions = {},
  ): Promise<void> {
    return this.write(
      store,
      (objectStore) => objectStore.put(value, key),
      'write',
      options,
    );
  }

  /**
   * Atomically remove one key and write another entry in the same read-write
   * transaction. If either request or the transaction fails, IndexedDB rolls
   * both changes back.
   */
  async replace<T = unknown>(
    store: StoreName,
    removedKey: string,
    writtenKey: string,
    value: CacheEntry<T>,
    options: CacheStoreWriteOptions = {},
  ): Promise<void> {
    return this.write(
      store,
      (objectStore) => {
        if (removedKey !== writtenKey) objectStore.delete(removedKey);
        objectStore.put(value, writtenKey);
      },
      'replace',
      options,
    );
  }

  /**
   * Atomically read and conditionally replace one entry in a single
   * read-write transaction. Returning null leaves the current value intact.
   */
  async update<T = unknown>(
    store: StoreName,
    key: string,
    updater: (current: CacheEntry<T> | null) => CacheEntry<T> | null,
    options: CacheStoreWriteOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal);
    const db = await this.open();
    throwIfAborted(options.signal);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      let updated = false;
      let updaterError: unknown;
      const cleanup = () => options.signal?.removeEventListener('abort', onSignalAbort);
      const onSignalAbort = () => {
        try {
          tx.abort();
        } catch {
          // See set(): cancellation still wins at the service boundary.
        }
        cleanup();
        reject(abortReason(options.signal));
      };
      options.signal?.addEventListener('abort', onSignalAbort, { once: true });
      if (options.signal?.aborted) {
        onSignalAbort();
        return;
      }

      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => {
        try {
          const current = (request.result as CacheEntry<T> | undefined) ?? null;
          const next = updater(current);
          if (next) {
            tx.objectStore(store).put(next, key);
            updated = true;
          }
        } catch (error) {
          updaterError = error;
          try {
            tx.abort();
          } catch {
            // The abort event below reports the captured updater failure.
          }
        }
      };
      tx.oncomplete = () => {
        cleanup();
        resolve(updated);
      };
      tx.onabort = () => {
        cleanup();
        reject(updaterError
          ?? (options.signal?.aborted
            ? abortReason(options.signal)
            : tx.error ?? new Error(`IndexedDB ${store} update was aborted.`)));
      };
    });
  }

  /**
   * Delete a single entry from a store.
   */
  async delete(
    store: StoreName,
    key: string,
    options: CacheStoreWriteOptions = {},
  ): Promise<void> {
    return this.write(store, (objectStore) => objectStore.delete(key), 'delete', options);
  }

  /**
   * Remove all entries from a store.
   */
  async clear(store: StoreName, options: CacheStoreWriteOptions = {}): Promise<void> {
    return this.write(store, (objectStore) => objectStore.clear(), 'clear', options);
  }

  private async write(
    store: StoreName,
    operation: (objectStore: IDBObjectStore) => unknown,
    operationName: string,
    options: CacheStoreWriteOptions,
  ): Promise<void> {
    throwIfAborted(options.signal);
    const db = await this.open();
    throwIfAborted(options.signal);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const cleanup = () => options.signal?.removeEventListener('abort', onSignalAbort);
      const onSignalAbort = () => {
        try {
          tx.abort();
        } catch {
          // The transaction may already have completed between the signal and
          // this callback. The caller still observes cancellation.
        }
        cleanup();
        reject(abortReason(options.signal));
      };
      tx.oncomplete = () => {
        cleanup();
        resolve();
      };
      tx.onabort = () => {
        cleanup();
        reject(options.signal?.aborted
          ? abortReason(options.signal)
          : tx.error ?? new Error(`IndexedDB ${store} ${operationName} was aborted.`));
      };
      options.signal?.addEventListener('abort', onSignalAbort, { once: true });
      if (options.signal?.aborted) {
        onSignalAbort();
        return;
      }
      try {
        operation(tx.objectStore(store));
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // Reject with the original synchronous IndexedDB error.
        }
        cleanup();
        reject(error);
      }
    });
  }
}
