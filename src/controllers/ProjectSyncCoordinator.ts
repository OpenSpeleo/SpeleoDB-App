import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { SessionStore } from '../services/SecureSessionStore';
import type { Project } from '../types/project';
import type {
  CacheLoadPhaseResult,
  ProjectRefreshPhaseResult,
  SyncProjectsResult,
  TilePrefetchPhaseResult,
} from '../types/sync';
import { isAbortError } from '../utils/abort';
import { CancellationContext } from './CancellationContext';
import {
  ProjectGeoJSONCoordinator,
  createSkippedGeoJSONPhase,
} from './ProjectGeoJSONCoordinator';
import {
  ProjectOverlaySyncCoordinator,
  createSkippedOverlaySyncPhase,
} from './ProjectOverlaySyncCoordinator';

export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

interface SyncMetadataStore {
  getLastSyncedAt(): number | undefined;
  setLastSyncedAt(value: number): void;
}

interface ProjectSyncHooks {
  hasNetworkAccess(): boolean;
  markOnline(): void;
  enterOfflineMode(): void;
  notifyStateChanged(): void;
  bumpLandmarksRevision(): void;
  syncGpsTracks(context: CancellationContext, instance: string, token: string): Promise<void>;
  scheduleTilePrefetch(
    context: CancellationContext,
    projects: Project[],
  ): Promise<TilePrefetchPhaseResult>;
}

interface ProjectSyncCoordinatorDependencies {
  cache: ProjectCacheService;
  transport: SpeleoDBService;
  sessions: SessionStore;
  metadata: SyncMetadataStore;
  geoJSON: ProjectGeoJSONCoordinator;
  overlays: ProjectOverlaySyncCoordinator;
  hooks: ProjectSyncHooks;
  now(): number;
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

export function createSkippedTilePrefetchPhase(
  reason: TilePrefetchPhaseResult['reason'],
): TilePrefetchPhaseResult {
  return {
    phase: 'tile_prefetch',
    status: reason === 'aborted' ? 'aborted' : 'skipped',
    reason,
    eligibleProjectCount: 0,
    scheduledProjectCount: 0,
    failedProjectCount: 0,
  };
}

/** Owns project-list state, sync cancellation, phase ordering, and publication. */
export class ProjectSyncCoordinator {
  private _projects: Project[] = [];
  private _syncStatus: SyncStatus = 'idle';
  private _lastSyncedAt: number | null = null;
  private _mapDataRevision = 0;
  private nextRunId = 1;
  private activeContext: CancellationContext | null = null;

  constructor(private readonly dependencies: ProjectSyncCoordinatorDependencies) {
    this.restoreLastSyncedAt();
  }

  get projects(): Project[] {
    return this._projects;
  }

  get syncStatus(): SyncStatus {
    return this._syncStatus;
  }

  get lastSyncedAt(): number | null {
    return this._lastSyncedAt;
  }

  get mapDataRevision(): number {
    return this._mapDataRevision;
  }

  cancel(): void {
    this.activeContext?.abort('Async operations invalidated');
  }

  reset(): void {
    this._projects = [];
    this._syncStatus = 'idle';
    this._lastSyncedAt = null;
    this._mapDataRevision += 1;
    this.dependencies.geoJSON.reset();
  }

  async sync(): Promise<SyncProjectsResult> {
    const context = this.beginContext();
    const result = this.createResult(context.runId);
    try {
      result.phases.cacheLoad = await this.loadCachedProjects(context);
      if (!this.dependencies.hooks.hasNetworkAccess()) {
        return this.syncWithoutRefresh(context, result, 'offline_locked');
      }
      const session = this.dependencies.sessions.getSession();
      if (!session) return this.syncWithoutRefresh(context, result, 'missing_credentials');

      this.setSyncStatus(context, 'syncing');
      const refresh = await this.refreshProjects(context, session.instance, session.token);
      result.phases.projectRefresh = refresh.phase;
      if (refresh.projects) {
        await this.syncFreshProjects(context, result, refresh.projects, session.instance, session.token);
      } else {
        await this.syncCachedFallback(context, result);
      }
      return this.complete(context, result);
    } catch (error) {
      if (isAbortError(error) || !this.isCurrent(context)) {
        return this.finalizeAborted(result);
      }
      console.warn('syncProjects: unexpected sync failure:', error);
      return this.complete(context, result);
    } finally {
      if (this.activeContext === context) this.activeContext = null;
    }
  }

  private async syncWithoutRefresh(
    context: CancellationContext,
    result: SyncProjectsResult,
    reason: 'offline_locked' | 'missing_credentials',
  ): Promise<SyncProjectsResult> {
    result.phases.projectRefresh = this.skippedRefresh(reason);
    result.phases.geojsonSync = await this.dependencies.geoJSON.sync(
      context,
      this._projects,
      false,
    );
    result.phases.overlaySync = createSkippedOverlaySyncPhase(reason);
    result.phases.tilePrefetch = createSkippedTilePrefetchPhase(reason);
    return this.complete(context, result);
  }

  private async syncFreshProjects(
    context: CancellationContext,
    result: SyncProjectsResult,
    projects: Project[],
    instance: string,
    token: string,
  ): Promise<void> {
    result.phases.geojsonSync = await this.dependencies.geoJSON.sync(context, projects, true);
    result.phases.overlaySync = await this.dependencies.overlays.sync(
      context,
      instance,
      token,
    );
    if (this.isCurrent(context) && result.phases.overlaySync.status !== 'skipped') {
      this.dependencies.hooks.bumpLandmarksRevision();
    }
    await this.dependencies.hooks.syncGpsTracks(context, instance, token);
    result.phases.tilePrefetch = await this.dependencies.hooks.scheduleTilePrefetch(
      context,
      projects,
    );
  }

  private async syncCachedFallback(
    context: CancellationContext,
    result: SyncProjectsResult,
  ): Promise<void> {
    result.phases.geojsonSync = await this.dependencies.geoJSON.sync(
      context,
      this._projects,
      false,
    );
    result.phases.overlaySync = createSkippedOverlaySyncPhase(
      result.phases.projectRefresh.reason,
    );
    result.phases.tilePrefetch = createSkippedTilePrefetchPhase(
      result.phases.projectRefresh.reason,
    );
  }

  private complete(
    context: CancellationContext,
    result: SyncProjectsResult,
  ): SyncProjectsResult {
    const status = this.deriveCompletionStatus(result.phases.projectRefresh);
    if (this.isCurrent(context)) {
      this._mapDataRevision += 1;
      this._syncStatus = status;
      this.dependencies.hooks.notifyStateChanged();
    }
    result.status = status;
    return result;
  }

  private async loadCachedProjects(
    context: CancellationContext,
  ): Promise<CacheLoadPhaseResult> {
    try {
      const cached = await this.dependencies.cache.getProjects({ signal: context.signal });
      context.throwIfAborted();
      if (cached === null) {
        return {
          phase: 'cache_load',
          status: 'skipped',
          reason: 'no_cached_projects',
          cachedProjectCount: 0,
        };
      }
      this._projects = cached;
      this.dependencies.hooks.notifyStateChanged();
      return {
        phase: 'cache_load',
        status: 'applied',
        reason: 'cached_projects_loaded',
        cachedProjectCount: cached.length,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('Failed to load cached projects:', error);
      return {
        phase: 'cache_load',
        status: 'failed',
        reason: 'cache_load_failed',
        cachedProjectCount: 0,
      };
    }
  }

  private async refreshProjects(
    context: CancellationContext,
    instance: string,
    token: string,
  ): Promise<{ phase: ProjectRefreshPhaseResult; projects: Project[] | null }> {
    try {
      const response = await this.dependencies.transport.getProjectsGeoJSON(
        instance,
        token,
        { signal: context.signal },
      );
      context.throwIfAborted();
      if (!isSuccessfulStatus(response.status)) {
        console.warn(
          `syncProjects: refresh skipped (status=${response.status}); preserving cached projects.`,
        );
        if (!isClientErrorStatus(response.status)) this.dependencies.hooks.enterOfflineMode();
        return this.rejectedRefresh(response.status);
      }
      if (!Array.isArray(response.data)) {
        console.warn(
          `syncProjects: refresh skipped (status=${response.status}); preserving cached projects.`,
        );
        return this.malformedRefresh(response.status);
      }
      return this.publishFreshProjects(context, response.status, response.data);
    } catch (error) {
      if (isAbortError(error)) throw error;
      context.throwIfAborted();
      console.warn('syncProjects: API fetch failed:', error);
      this.dependencies.hooks.enterOfflineMode();
      return this.rejectedRefresh(null);
    }
  }

  private async publishFreshProjects(
    context: CancellationContext,
    status: number,
    projects: Project[],
  ): Promise<{ phase: ProjectRefreshPhaseResult; projects: Project[] }> {
    this._projects = projects;
    this.dependencies.hooks.markOnline();
    const cached = await this.dependencies.cache.setProjects(
      projects,
      { signal: context.signal },
    );
    context.throwIfAborted();
    if (cached) this.recordSuccessfulSync();
    this.dependencies.hooks.notifyStateChanged();
    return {
      phase: {
        phase: 'project_refresh',
        status: cached ? 'applied' : 'failed',
        reason: cached ? 'project_list_refreshed' : 'project_list_cache_write_failed',
        projectCount: projects.length,
        httpStatus: status,
        cacheWriteSucceeded: cached,
        preservedCachedProjects: false,
      },
      projects,
    };
  }

  private createResult(runId: number): SyncProjectsResult {
    return {
      runId,
      status: 'done',
      phases: {
        cacheLoad: {
          phase: 'cache_load',
          status: 'skipped',
          reason: 'no_cached_projects',
          cachedProjectCount: 0,
        },
        projectRefresh: this.skippedRefresh('missing_credentials'),
        geojsonSync: createSkippedGeoJSONPhase('no_geojson_candidates'),
        overlaySync: createSkippedOverlaySyncPhase('no_overlay_sync_needed'),
        tilePrefetch: createSkippedTilePrefetchPhase('no_prefetch_candidates'),
      },
    };
  }

  private finalizeAborted(result: SyncProjectsResult): SyncProjectsResult {
    if (result.phases.projectRefresh.status === 'skipped') {
      result.phases.projectRefresh = {
        ...this.skippedRefresh('aborted'),
        status: 'aborted',
      };
    }
    if (result.phases.geojsonSync.status === 'skipped') {
      result.phases.geojsonSync = createSkippedGeoJSONPhase('aborted');
    }
    if (result.phases.overlaySync.status === 'skipped') {
      result.phases.overlaySync = createSkippedOverlaySyncPhase('aborted');
    }
    if (result.phases.tilePrefetch.status === 'skipped') {
      result.phases.tilePrefetch = createSkippedTilePrefetchPhase('aborted');
    }
    result.status = 'aborted';
    return result;
  }

  private skippedRefresh(
    reason: ProjectRefreshPhaseResult['reason'],
  ): ProjectRefreshPhaseResult {
    return {
      phase: 'project_refresh',
      status: 'skipped',
      reason,
      projectCount: 0,
      httpStatus: null,
      cacheWriteSucceeded: false,
      preservedCachedProjects: this._projects.length > 0,
    };
  }

  private rejectedRefresh(
    status: number | null,
  ): { phase: ProjectRefreshPhaseResult; projects: null } {
    return {
      phase: {
        phase: 'project_refresh',
        status: 'failed',
        reason: 'project_refresh_rejected',
        projectCount: 0,
        httpStatus: status,
        cacheWriteSucceeded: false,
        preservedCachedProjects: this._projects.length > 0,
      },
      projects: null,
    };
  }

  private malformedRefresh(status: number): { phase: ProjectRefreshPhaseResult; projects: null } {
    return {
      phase: {
        phase: 'project_refresh',
        status: 'failed',
        reason: 'project_refresh_malformed',
        projectCount: 0,
        httpStatus: status,
        cacheWriteSucceeded: false,
        preservedCachedProjects: this._projects.length > 0,
      },
      projects: null,
    };
  }

  private deriveCompletionStatus(phase: ProjectRefreshPhaseResult): 'done' | 'error' {
    if (
      phase.status === 'applied'
      || (phase.status === 'failed' && phase.reason === 'project_list_cache_write_failed')
    ) {
      return 'done';
    }
    return this._projects.length > 0 ? 'done' : 'error';
  }

  private setSyncStatus(context: CancellationContext, status: SyncStatus): void {
    if (!this.isCurrent(context)) return;
    this._syncStatus = status;
    this.dependencies.hooks.notifyStateChanged();
  }

  private beginContext(): CancellationContext {
    this.activeContext?.abort('Project sync superseded');
    const context = new CancellationContext(this.nextRunId, 'Project sync');
    this.nextRunId += 1;
    this.activeContext = context;
    return context;
  }

  private isCurrent(context: CancellationContext): boolean {
    return this.activeContext === context;
  }

  private restoreLastSyncedAt(): void {
    try {
      const lastSyncedAt = this.dependencies.metadata.getLastSyncedAt();
      if (
        typeof lastSyncedAt === 'number'
        && Number.isFinite(lastSyncedAt)
        && lastSyncedAt > 0
      ) {
        this._lastSyncedAt = lastSyncedAt;
      }
    } catch (error) {
      console.error('Failed to load last sync state:', error);
    }
  }

  private recordSuccessfulSync(): void {
    this._lastSyncedAt = this.dependencies.now();
    try {
      this.dependencies.metadata.setLastSyncedAt(this._lastSyncedAt);
    } catch (error) {
      console.warn('Failed to persist lastSyncedAt:', error);
    }
  }
}
