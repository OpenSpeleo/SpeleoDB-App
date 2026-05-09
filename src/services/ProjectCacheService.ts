/**
 * ProjectCacheService -- project-specific read/write layer on top of CacheStore.
 *
 * Knows the shape of project data and geojson entries; hides IndexedDB
 * details from the rest of the app.
 */

import { CacheStore } from './CacheStore';
import type { Project } from '../types/project';
import type { MapOverlayId } from '../types/mapOverlay';
import { isAbortError, throwIfAborted } from '../utils/abort';

// ==================== Internal keys ====================

/** The projects list is stored under a single well-known key. */
const PROJECTS_LIST_KEY = 'list';
const OVERLAY_KEY_PREFIX = 'overlay:';

// ==================== Service ====================

export interface CacheOperationOptions {
  signal?: AbortSignal
}

export class ProjectCacheService {
  private store: CacheStore;

  constructor(store?: CacheStore) {
    this.store = store ?? new CacheStore();
  }

  // ---- Projects list ----------------------------------------------------------

  /** Read the cached projects array, or null if nothing is cached. */
  async getProjects(options: CacheOperationOptions = {}): Promise<Project[] | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get<Project[]>('projects', PROJECTS_LIST_KEY);
      throwIfAborted(options.signal)
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.getProjects failed:', error);
      return null;
    }
  }

  /** Overwrite the cached projects list. */
  async setProjects(projects: Project[], options: CacheOperationOptions = {}): Promise<boolean> {
    throwIfAborted(options.signal)
    try {
      await this.store.set('projects', PROJECTS_LIST_KEY, {
        data: projects,
        cachedAt: Date.now(),
      });
      throwIfAborted(options.signal)
      return true
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error('ProjectCacheService.setProjects failed:', error);
      return false
    }
  }

  // ---- GeoJSON files ----------------------------------------------------------

  /** Read a cached geojson payload for a project, or null if not cached. */
  async getGeoJSON(projectId: string, options: CacheOperationOptions = {}): Promise<unknown | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get('geojson', projectId);
      throwIfAborted(options.signal)
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error(`ProjectCacheService.getGeoJSON(${projectId}) failed:`, error);
      return null;
    }
  }

  /** Write a geojson payload, tagged with the commit ID that produced it. */
  async setGeoJSON(
    projectId: string,
    data: unknown,
    commitId: string,
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal)
    try {
      await this.store.set('geojson', projectId, {
        data,
        cachedAt: Date.now(),
        meta: { commitId },
      });
      throwIfAborted(options.signal)
      return true
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error(`ProjectCacheService.setGeoJSON(${projectId}) failed:`, error);
      return false
    }
  }

  /** Return the commit ID stored alongside a project's geojson, or null. */
  async getCachedCommitId(projectId: string, options: CacheOperationOptions = {}): Promise<string | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get('geojson', projectId);
      throwIfAborted(options.signal)
      return entry?.meta?.commitId ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      return null;
    }
  }

  // ---- Shared read-only map overlays -----------------------------------------

  /** Read a cached overlay payload, or null if not cached. */
  async getOverlayGeoJSON(
    overlayId: MapOverlayId,
    options: CacheOperationOptions = {},
  ): Promise<unknown | null> {
    throwIfAborted(options.signal)
    try {
      const entry = await this.store.get('geojson', this.getOverlayCacheKey(overlayId));
      throwIfAborted(options.signal)
      return entry?.data ?? null;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error(`ProjectCacheService.getOverlayGeoJSON(${overlayId}) failed:`, error);
      return null;
    }
  }

  /** Write an overlay GeoJSON payload. */
  async setOverlayGeoJSON(
    overlayId: MapOverlayId,
    data: unknown,
    options: CacheOperationOptions = {},
  ): Promise<boolean> {
    throwIfAborted(options.signal)
    try {
      await this.store.set('geojson', this.getOverlayCacheKey(overlayId), {
        data,
        cachedAt: Date.now(),
      });
      throwIfAborted(options.signal)
      return true
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throwIfAborted(options.signal)
      }
      console.error(`ProjectCacheService.setOverlayGeoJSON(${overlayId}) failed:`, error);
      return false
    }
  }

  // ---- Housekeeping -----------------------------------------------------------

  /** Wipe all cached projects and geojson data (e.g. on logout). */
  async clearAll(): Promise<void> {
    await this.store.clear('projects');
    await this.store.clear('geojson');
  }

  private getOverlayCacheKey(overlayId: MapOverlayId): string {
    return `${OVERLAY_KEY_PREFIX}${overlayId}`;
  }
}
