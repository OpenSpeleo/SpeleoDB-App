import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { SessionStore } from '../services/SecureSessionStore';
import type { Project } from '../types/project';
import type {
  CacheLoadPhaseResult,
  ProjectRefreshPhaseResult,
  SyncPhaseStatus,
  SyncProjectsResult,
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
import {
  createQueuedTilePrefetchPhase,
  createSkippedTilePrefetchPhase,
} from './ProjectSyncPhases';
import { logPerformanceTiming } from '../utils/performanceTiming';

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
  queueTilePrefetch(projects: Project[], runId: number): void;
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
  elapsedNow(): number;
}

type TimedSyncPhase =
  | 'cache_load'
  | 'project_refresh'
  | 'geojson_sync'
  | 'overlay_sync'
  | 'gps_sync'
  | 'tile_prefetch';

interface SyncTimingOutcome {
  status: SyncPhaseStatus;
  reason: string;
}

interface SyncRunTiming {
  totalStartedAt: number;
  active: {
    phase: TimedSyncPhase;
    startedAt: number;
  } | null;
}

type MeasuredPhase<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: unknown; durationMs: number };

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status < 500;
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
    const timing: SyncRunTiming = {
      totalStartedAt: this.dependencies.elapsedNow(),
      active: null,
    };
    try {
      this.startPhase(timing, 'cache_load');
      result.phases.cacheLoad = await this.loadCachedProjects(context);
      this.finishPhase(context, timing, result.phases.cacheLoad);
      if (!this.dependencies.hooks.hasNetworkAccess()) {
        return this.syncWithoutRefresh(context, result, timing, 'offline_locked');
      }
      const session = this.dependencies.sessions.getSession();
      if (!session) {
        return this.syncWithoutRefresh(context, result, timing, 'missing_credentials');
      }

      this.setSyncStatus(context, 'syncing');
      this.startPhase(timing, 'project_refresh');
      const refresh = await this.refreshProjects(context, session.instance, session.token);
      this.finishPhase(context, timing, refresh.phase);
      result.phases.projectRefresh = refresh.phase;
      if (refresh.projects) {
        await this.syncFreshProjects(
          context,
          result,
          timing,
          refresh.projects,
          session.instance,
          session.token,
        );
      } else {
        await this.syncCachedFallback(context, result, timing);
      }
      const completed = this.complete(context, result);
      if (refresh.projects && this.isCurrent(context)) {
        result.phases.tilePrefetch = createQueuedTilePrefetchPhase(refresh.projects);
        this.logSkippedPhase(context, 'tile_prefetch', result.phases.tilePrefetch);
        this.dependencies.hooks.queueTilePrefetch(refresh.projects, context.runId);
      }
      return completed;
    } catch (error) {
      this.failActivePhase(context, timing, error);
      if (isAbortError(error) || !this.isCurrent(context)) {
        return this.finalizeAborted(result);
      }
      console.warn('syncProjects: unexpected sync failure:', error);
      return this.complete(context, result);
    } finally {
      this.logTiming(
        context.runId,
        'total',
        this.elapsedSince(timing.totalStartedAt),
        result.status,
      );
      if (this.activeContext === context) this.activeContext = null;
    }
  }

  private async syncWithoutRefresh(
    context: CancellationContext,
    result: SyncProjectsResult,
    timing: SyncRunTiming,
    reason: 'offline_locked' | 'missing_credentials',
  ): Promise<SyncProjectsResult> {
    result.phases.projectRefresh = this.skippedRefresh(reason);
    this.logSkippedPhase(context, 'project_refresh', result.phases.projectRefresh);
    this.startPhase(timing, 'geojson_sync');
    result.phases.geojsonSync = await this.dependencies.geoJSON.sync(
      context,
      this._projects,
      false,
    );
    this.finishPhase(context, timing, result.phases.geojsonSync);
    this.publishMapData(context);
    result.phases.overlaySync = createSkippedOverlaySyncPhase(reason);
    result.phases.tilePrefetch = createSkippedTilePrefetchPhase(reason);
    this.logSkippedPhase(context, 'overlay_sync', result.phases.overlaySync);
    this.logSkippedPhase(context, 'gps_sync', { status: 'skipped', reason });
    this.logSkippedPhase(context, 'tile_prefetch', result.phases.tilePrefetch);
    return this.complete(context, result);
  }

  private async syncFreshProjects(
    context: CancellationContext,
    result: SyncProjectsResult,
    timing: SyncRunTiming,
    projects: Project[],
    instance: string,
    token: string,
  ): Promise<void> {
    this.startPhase(timing, 'geojson_sync');
    result.phases.geojsonSync = await this.dependencies.geoJSON.sync(context, projects, true);
    this.finishPhase(context, timing, result.phases.geojsonSync);
    this.publishMapData(context);
    const [overlay, gps] = await Promise.all([
      this.measureConcurrentPhase(async () => {
        const phase = await this.dependencies.overlays.sync(context, instance, token);
        result.phases.overlaySync = phase;
        if (this.isCurrent(context) && phase.status !== 'skipped') {
          this.dependencies.hooks.bumpLandmarksRevision();
        }
        return phase;
      }),
      this.measureConcurrentPhase(
        () => this.dependencies.hooks.syncGpsTracks(context, instance, token),
      ),
    ]);

    this.logMeasuredPhase(
      context,
      'overlay_sync',
      overlay,
      (phase) => phase,
    );
    this.logMeasuredPhase(
      context,
      'gps_sync',
      gps,
      () => ({ status: 'applied', reason: 'gps_sync_completed' }),
    );
    if (!overlay.ok) throw overlay.error;
    if (!gps.ok) throw gps.error;
  }

  private async syncCachedFallback(
    context: CancellationContext,
    result: SyncProjectsResult,
    timing: SyncRunTiming,
  ): Promise<void> {
    this.startPhase(timing, 'geojson_sync');
    result.phases.geojsonSync = await this.dependencies.geoJSON.sync(
      context,
      this._projects,
      false,
    );
    this.finishPhase(context, timing, result.phases.geojsonSync);
    this.publishMapData(context);
    result.phases.overlaySync = createSkippedOverlaySyncPhase(
      result.phases.projectRefresh.reason,
    );
    result.phases.tilePrefetch = createSkippedTilePrefetchPhase(
      result.phases.projectRefresh.reason,
    );
    this.logSkippedPhase(context, 'overlay_sync', result.phases.overlaySync);
    this.logSkippedPhase(context, 'gps_sync', {
      status: 'skipped',
      reason: result.phases.projectRefresh.reason,
    });
    this.logSkippedPhase(context, 'tile_prefetch', result.phases.tilePrefetch);
  }

  private startPhase(
    timing: SyncRunTiming,
    phase: TimedSyncPhase,
  ): void {
    timing.active = { phase, startedAt: this.dependencies.elapsedNow() };
  }

  private finishPhase(
    context: CancellationContext,
    timing: SyncRunTiming,
    outcome: SyncTimingOutcome,
  ): void {
    if (!timing.active) return;
    this.logTiming(
      context.runId,
      timing.active.phase,
      this.elapsedSince(timing.active.startedAt),
      outcome.status,
      outcome.reason,
    );
    timing.active = null;
  }

  private failActivePhase(
    context: CancellationContext,
    timing: SyncRunTiming,
    error: unknown,
  ): void {
    if (!timing.active) return;
    const aborted = isAbortError(error) || context.signal.aborted;
    this.finishPhase(context, timing, {
      status: aborted ? 'aborted' : 'failed',
      reason: aborted ? 'aborted' : 'unexpected_failure',
    });
  }

  private async measureConcurrentPhase<T>(
    work: () => Promise<T>,
  ): Promise<MeasuredPhase<T>> {
    const startedAt = this.dependencies.elapsedNow();
    try {
      return {
        ok: true,
        value: await work(),
        durationMs: this.elapsedSince(startedAt),
      };
    } catch (error) {
      return {
        ok: false,
        error,
        durationMs: this.elapsedSince(startedAt),
      };
    }
  }

  private logMeasuredPhase<T>(
    context: CancellationContext,
    phase: TimedSyncPhase,
    measured: MeasuredPhase<T>,
    successOutcome: (value: T) => SyncTimingOutcome,
  ): void {
    const outcome = measured.ok
      ? successOutcome(measured.value)
      : {
        status: isAbortError(measured.error) || context.signal.aborted
          ? 'aborted' as const
          : 'failed' as const,
        reason: isAbortError(measured.error) || context.signal.aborted
          ? 'aborted'
          : 'unexpected_failure',
      };
    this.logTiming(
      context.runId,
      phase,
      measured.durationMs,
      outcome.status,
      outcome.reason,
    );
  }

  private logSkippedPhase(
    context: CancellationContext,
    phase: TimedSyncPhase,
    outcome: SyncTimingOutcome,
  ): void {
    this.logTiming(context.runId, phase, null, outcome.status, outcome.reason);
  }

  private elapsedSince(startedAt: number): number {
    const elapsed = Math.max(0, this.dependencies.elapsedNow() - startedAt);
    return Math.round(elapsed * 10) / 10;
  }

  private logTiming(
    runId: number,
    phase: TimedSyncPhase | 'total',
    durationMs: number | null,
    status: SyncPhaseStatus | SyncProjectsResult['status'],
    reason?: string,
  ): void {
    logPerformanceTiming('project-sync', {
      runId,
      phase,
      durationMs,
      status,
      ...(reason ? { reason } : {}),
    });
  }

  private complete(
    context: CancellationContext,
    result: SyncProjectsResult,
  ): SyncProjectsResult {
    const status = this.deriveCompletionStatus(result.phases.projectRefresh);
    if (this.isCurrent(context)) {
      this._syncStatus = status;
      this.dependencies.hooks.notifyStateChanged();
    }
    result.status = status;
    return result;
  }

  private publishMapData(context: CancellationContext): void {
    if (!this.isCurrent(context)) return;
    this._mapDataRevision += 1;
    this.dependencies.hooks.notifyStateChanged();
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
