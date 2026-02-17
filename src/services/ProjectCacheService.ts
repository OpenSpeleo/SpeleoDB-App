/**
 * ProjectCacheService -- project-specific read/write layer on top of CacheStore.
 *
 * Knows the shape of project data and geojson entries; hides IndexedDB
 * details from the rest of the app.
 */

import { CacheStore } from './CacheStore';
import type { Project } from '../types/project';
import type { MapOverlayId } from '../types/mapOverlay';

// ==================== Internal keys ====================

/** The projects list is stored under a single well-known key. */
const PROJECTS_LIST_KEY = 'list';
const OVERLAY_KEY_PREFIX = 'overlay:';

// ==================== Service ====================

export class ProjectCacheService {
  private store: CacheStore;

  constructor(store?: CacheStore) {
    this.store = store ?? new CacheStore();
  }

  // ---- Projects list ----------------------------------------------------------

  /** Read the cached projects array, or null if nothing is cached. */
  async getProjects(): Promise<Project[] | null> {
    try {
      const entry = await this.store.get<Project[]>('projects', PROJECTS_LIST_KEY);
      return entry?.data ?? null;
    } catch (error) {
      console.error('ProjectCacheService.getProjects failed:', error);
      return null;
    }
  }

  /** Overwrite the cached projects list. */
  async setProjects(projects: Project[]): Promise<void> {
    try {
      await this.store.set('projects', PROJECTS_LIST_KEY, {
        data: projects,
        cachedAt: Date.now(),
      });
    } catch (error) {
      console.error('ProjectCacheService.setProjects failed:', error);
    }
  }

  // ---- GeoJSON files ----------------------------------------------------------

  /** Read a cached geojson payload for a project, or null if not cached. */
  async getGeoJSON(projectId: string): Promise<unknown | null> {
    try {
      const entry = await this.store.get('geojson', projectId);
      return entry?.data ?? null;
    } catch (error) {
      console.error(`ProjectCacheService.getGeoJSON(${projectId}) failed:`, error);
      return null;
    }
  }

  /** Write a geojson payload, tagged with the commit ID that produced it. */
  async setGeoJSON(projectId: string, data: unknown, commitId: string): Promise<void> {
    try {
      await this.store.set('geojson', projectId, {
        data,
        cachedAt: Date.now(),
        meta: { commitId },
      });
    } catch (error) {
      console.error(`ProjectCacheService.setGeoJSON(${projectId}) failed:`, error);
    }
  }

  /** Return the commit ID stored alongside a project's geojson, or null. */
  async getCachedCommitId(projectId: string): Promise<string | null> {
    try {
      const entry = await this.store.get('geojson', projectId);
      return entry?.meta?.commitId ?? null;
    } catch {
      return null;
    }
  }

  // ---- Shared read-only map overlays -----------------------------------------

  /** Read a cached overlay payload, or null if not cached. */
  async getOverlayGeoJSON(overlayId: MapOverlayId): Promise<unknown | null> {
    try {
      const entry = await this.store.get('geojson', this.getOverlayCacheKey(overlayId));
      return entry?.data ?? null;
    } catch (error) {
      console.error(`ProjectCacheService.getOverlayGeoJSON(${overlayId}) failed:`, error);
      return null;
    }
  }

  /** Write an overlay GeoJSON payload. */
  async setOverlayGeoJSON(overlayId: MapOverlayId, data: unknown): Promise<void> {
    try {
      await this.store.set('geojson', this.getOverlayCacheKey(overlayId), {
        data,
        cachedAt: Date.now(),
      });
    } catch (error) {
      console.error(`ProjectCacheService.setOverlayGeoJSON(${overlayId}) failed:`, error);
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
