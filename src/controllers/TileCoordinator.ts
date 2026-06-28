import { DEFAULT_MAP_LAYER_ID, MAP_LAYERS, TILE_PREFETCH } from '../constants';
import { LazyTilePrefetchService } from '../services/LazyTilePrefetchService';
import { getMapLayerById } from '../services/MapLayersService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import {
  clearCachedTilesRuntime,
  clearPrefetchJobsRuntime,
  evictLayerTilesRuntime,
  setTileCacheOverLimitApprovedRuntime,
} from '../services/TileCacheRuntime';
import type { TilePrefetchServiceLike } from '../services/TilePrefetchService';
import {
  buildTileUrlsForPoints,
  computeTilePrefetchSignature,
  extractPointCoordinates,
} from '../services/tilePrefetchPlanner';
import type { MapLayerDefinition } from '../types/mapLayer';
import type { Project } from '../types/project';
import type {
  TilePrefetchJobState,
  TilePrefetchProjectInput,
  TilePrefetchRequest,
} from '../types/tilePrefetch';
import type { TilePrefetchPhaseResult } from '../types/sync';
import { isAbortError } from '../utils/abort';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { CancellationContext } from './CancellationContext';
import type { ProjectGeoJSONCoordinator } from './ProjectGeoJSONCoordinator';
import { createSkippedTilePrefetchPhase } from './ProjectSyncCoordinator';

interface TilePreferences {
  tileCacheOverLimitApproved?: boolean;
  tileCacheOverLimitPromptAcknowledged?: boolean;
  layerOfflineSync?: Record<string, boolean>;
}

interface TileCoordinatorDependencies {
  cache: ProjectCacheService;
  projectGeoJSON: ProjectGeoJSONCoordinator;
  preferences: {
    get(): TilePreferences;
    set(value: TilePreferences): void;
  };
  hasNetworkAccess(): boolean;
  getProjects(): Project[];
  notifyStateChanged(): void;
}

interface BuiltProjectInputs {
  inputs: TilePrefetchProjectInput[];
  eligibleCount: number;
  failedCount: number;
}

/** Owns tile prefetch lifecycle, consent, layer settings, and scheduling. */
export class TileCoordinator {
  private service: TilePrefetchServiceLike;
  private unsubscribe: (() => void) | null = null;
  private jobs: TilePrefetchJobState[] = [];
  private overflowApproved = false;
  private promptAcknowledged = false;
  private consentRequested = false;
  private warnedStuckWhileApproved = false;
  private nextRunId = 1;
  private readonly activeLayerContexts = new Set<CancellationContext>();

  constructor(
    private readonly dependencies: TileCoordinatorDependencies,
    service?: TilePrefetchServiceLike,
  ) {
    this.service = service ?? this.createService();
    this.attach(this.service);
    this.restoreConsent();
  }

  get prefetchJobs(): TilePrefetchJobState[] {
    return this.jobs;
  }

  get isOverflowApproved(): boolean {
    return this.overflowApproved;
  }

  get isOverLimit(): boolean {
    if (this.overflowApproved) return false;
    return this.jobs.some((job) => job.blockedByStorage === true);
  }

  get needsAutoPrompt(): boolean {
    return this.isOverLimit && !this.promptAcknowledged;
  }

  get isConsentRequested(): boolean {
    return this.consentRequested;
  }

  get isConsentRequired(): boolean {
    return this.needsAutoPrompt || this.consentRequested;
  }

  async preload(): Promise<void> {
    await this.service.preload?.();
  }

  requestConsent(): void {
    if (this.consentRequested) return;
    this.consentRequested = true;
    this.dependencies.notifyStateChanged();
  }

  dismissConsentRequest(): void {
    if (!this.consentRequested) return;
    this.consentRequested = false;
    this.dependencies.notifyStateChanged();
  }

  approveOverflow(): void {
    this.overflowApproved = true;
    this.promptAcknowledged = true;
    this.consentRequested = false;
    this.warnedStuckWhileApproved = false;
    this.persistConsent();
    setTileCacheOverLimitApprovedRuntime(true);
    this.service.resumeBlockedJobs();
    this.dependencies.notifyStateChanged();
  }

  dismissAutoPrompt(): void {
    this.promptAcknowledged = true;
    this.consentRequested = false;
    this.persistConsent();
    this.dependencies.notifyStateChanged();
  }

  revokeOverflow(): void {
    this.overflowApproved = false;
    this.warnedStuckWhileApproved = false;
    this.persistConsent();
    setTileCacheOverLimitApprovedRuntime(false);
    this.dependencies.notifyStateChanged();
  }

  async setLayerOfflineSync(layerId: string, enabled: boolean): Promise<void> {
    const layer = getMapLayerById(layerId);
    if (!layer || layer.forcedOffline) return;
    const current = this.dependencies.preferences.get().layerOfflineSync ?? {};
    this.dependencies.preferences.set({
      layerOfflineSync: { ...current, [layerId]: enabled },
    });
    this.dependencies.notifyStateChanged();
    if (enabled) {
      if (!this.dependencies.hasNetworkAccess()) return;
      await this.scheduleSingleLayer(layer);
    } else {
      await this.removeLayerData(layer);
    }
  }

  async scheduleSyncPhase(
    context: CancellationContext,
    projects: Project[],
  ): Promise<TilePrefetchPhaseResult> {
    if (!this.dependencies.hasNetworkAccess()) {
      return createSkippedTilePrefetchPhase('offline_locked');
    }
    const satellite = getMapLayerById(DEFAULT_MAP_LAYER_ID) ?? MAP_LAYERS[0];
    const landmarkPoints = await this.loadLandmarkPoints(context);
    const built = await this.buildProjectInputs(context, projects);
    const landmarkTileCount = await this.enqueueLandmarks(context, satellite, landmarkPoints);
    const projectResult = await this.enqueueProjects(context, satellite, built);
    for (const layer of this.getEnabledExtraLayers()) {
      context.throwIfAborted();
      await this.enqueueLandmarks(context, layer, landmarkPoints);
      await this.enqueueProjects(context, layer, built);
    }
    return {
      ...projectResult,
      landmarkTileCount,
      landmarkScheduled: landmarkTileCount > 0,
    };
  }

  async removeTarget(projectId: string, signal: AbortSignal): Promise<void> {
    await this.service.removeTarget(projectId, { signal });
  }

  cancel(): void {
    for (const context of this.activeLayerContexts) {
      context.abort('Async operations invalidated');
    }
    this.activeLayerContexts.clear();
  }

  stopForLogout(): Promise<void> | void {
    const current = this.service;
    this.unsubscribe?.();
    this.unsubscribe = null;
    current.dispose();
    this.jobs = [];
    this.overflowApproved = false;
    this.promptAcknowledged = false;
    this.consentRequested = false;
    this.warnedStuckWhileApproved = false;
    setTileCacheOverLimitApprovedRuntime(false);
    return current.waitForIdle?.();
  }

  persistentCleanupTasks(): Promise<void>[] {
    return [clearCachedTilesRuntime(), clearPrefetchJobsRuntime()];
  }

  restartAfterLogout(): void {
    this.attach(this.createService());
  }

  private attach(service: TilePrefetchServiceLike): void {
    this.service = service;
    this.warnedStuckWhileApproved = false;
    this.unsubscribe = service.subscribe((jobs) => {
      this.jobs = jobs;
      this.warnIfStuckWhileApproved(jobs);
      this.dependencies.notifyStateChanged();
    });
  }

  private createService(): TilePrefetchServiceLike {
    return new LazyTilePrefetchService({
      isOnline: () => this.dependencies.hasNetworkAccess(),
    });
  }

  private restoreConsent(): void {
    try {
      const prefs = this.dependencies.preferences.get();
      this.overflowApproved = prefs.tileCacheOverLimitApproved === true;
      this.promptAcknowledged = prefs.tileCacheOverLimitPromptAcknowledged === true;
      setTileCacheOverLimitApprovedRuntime(this.overflowApproved);
    } catch (error) {
      console.warn('Failed to restore tile-cache overflow consent:', error);
    }
  }

  private persistConsent(): void {
    try {
      this.dependencies.preferences.set({
        tileCacheOverLimitApproved: this.overflowApproved,
        tileCacheOverLimitPromptAcknowledged: this.promptAcknowledged,
      });
    } catch (error) {
      console.warn('Failed to persist tile-cache overflow consent:', error);
    }
  }

  private warnIfStuckWhileApproved(jobs: TilePrefetchJobState[]): void {
    const stuck = this.overflowApproved && jobs.some((job) => job.blockedByStorage === true);
    if (!stuck) {
      this.warnedStuckWhileApproved = false;
      return;
    }
    if (this.warnedStuckWhileApproved) return;
    this.warnedStuckWhileApproved = true;
    console.warn(
      'Tile prefetch is blocked by storage while overflow is approved; the cap-lift may not have reached the tile cache.',
    );
  }

  private getEnabledExtraLayers(): MapLayerDefinition[] {
    const sync = this.dependencies.preferences.get().layerOfflineSync ?? {};
    return MAP_LAYERS.filter((layer) => !layer.forcedOffline && sync[layer.id] === true);
  }

  private async scheduleSingleLayer(layer: MapLayerDefinition): Promise<void> {
    const context = new CancellationContext(this.nextRunId, 'Layer prefetch');
    this.nextRunId += 1;
    this.activeLayerContexts.add(context);
    try {
      const points = await this.loadLandmarkPoints(context);
      await this.enqueueLandmarks(context, layer, points);
      const built = await this.buildProjectInputs(context, this.dependencies.getProjects());
      await this.enqueueProjects(context, layer, built);
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn(`Failed scheduling prefetch for layer ${layer.id}:`, error);
      }
    } finally {
      this.activeLayerContexts.delete(context);
    }
  }

  private async removeLayerData(layer: MapLayerDefinition): Promise<void> {
    try {
      await this.service.removeLayer(layer.id);
    } catch (error) {
      console.warn(`Failed removing prefetch jobs for layer ${layer.id}:`, error);
    }
    try {
      const prefix = layer.tileUrlTemplate.split('{z}')[0];
      if (prefix) await evictLayerTilesRuntime([prefix]);
    } catch (error) {
      console.warn(`Failed evicting tiles for layer ${layer.id}:`, error);
    }
  }

  private buildRequest(
    layer: MapLayerDefinition,
    base: TilePrefetchRequest,
  ): TilePrefetchRequest {
    return {
      tileUrlTemplate: layer.tileUrlTemplate,
      minZoom: base.minZoom,
      maxZoom: Math.min(base.maxZoom, layer.maxZoom),
      padMeters: base.padMeters,
    };
  }

  private async loadLandmarkPoints(context: CancellationContext): Promise<[number, number][]> {
    try {
      const raw = await this.dependencies.cache.getOverlayGeoJSON('landmarks');
      context.throwIfAborted();
      const collection = normalizeGeoJSON(raw);
      if (!collection) return [];
      return extractPointCoordinates(collection);
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('Loading landmark prefetch points failed:', error);
      return [];
    }
  }

  private async enqueueLandmarks(
    context: CancellationContext,
    layer: MapLayerDefinition,
    points: [number, number][],
  ): Promise<number> {
    if (points.length === 0) return 0;
    try {
      const request = this.buildRequest(layer, TILE_PREFETCH.LANDMARK_REQUEST);
      const tileUrls = buildTileUrlsForPoints(points, request);
      if (tileUrls.length === 0) return 0;
      await this.service.enqueueTileUrls(
        {
          id: TILE_PREFETCH.LANDMARK_TARGET_ID,
          commitId: computeTilePrefetchSignature(points),
          tileUrls,
          zoomMin: request.minZoom,
          zoomMax: request.maxZoom,
          padMeters: request.padMeters,
        },
        { signal: context.signal, layerId: layer.id },
      );
      context.throwIfAborted();
      return tileUrls.length;
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn(`Landmark map prefetch scheduling failed for layer ${layer.id}:`, error);
      return 0;
    }
  }

  private async buildProjectInputs(
    context: CancellationContext,
    projects: Project[],
  ): Promise<BuiltProjectInputs> {
    const eligible = projects.filter((project) => project.geojson_file && !project.exclude_geojson);
    const inputs: TilePrefetchProjectInput[] = [];
    let failedCount = 0;
    for (const project of eligible) {
      try {
        context.throwIfAborted();
        const commitId = project.latest_commit.id;
        if (this.dependencies.projectGeoJSON.isBlocked(project.id, commitId)) {
          failedCount += 1;
          continue;
        }
        const record = await this.dependencies.cache.getProjectGeoJSONRecord(
          project.id,
          { signal: context.signal },
        );
        context.throwIfAborted();
        if (record.state !== 'active' || record.commitId !== commitId) {
          failedCount += 1;
          continue;
        }
        inputs.push({ projectId: project.id, commitId, bounds: record.analysis.bounds });
      } catch (error) {
        if (isAbortError(error)) throw error;
        failedCount += 1;
        console.warn('Failed preparing project map prefetch:', error);
      }
    }
    return { inputs, eligibleCount: eligible.length, failedCount };
  }

  private async enqueueProjects(
    context: CancellationContext,
    layer: MapLayerDefinition,
    built: BuiltProjectInputs,
  ): Promise<TilePrefetchPhaseResult> {
    const { inputs, eligibleCount, failedCount } = built;
    if (eligibleCount === 0) return createSkippedTilePrefetchPhase('no_prefetch_candidates');
    if (inputs.length === 0) {
      return {
        phase: 'tile_prefetch',
        status: failedCount > 0 ? 'failed' : 'skipped',
        reason: failedCount > 0 ? 'tile_prefetch_failed' : 'no_prefetch_candidates',
        eligibleProjectCount: eligibleCount,
        scheduledProjectCount: 0,
        failedProjectCount: failedCount,
      };
    }
    try {
      const request = this.buildRequest(layer, TILE_PREFETCH.PROJECT_REQUEST);
      await this.service.enqueueProjects(inputs, request, {
        signal: context.signal,
        layerId: layer.id,
      });
      context.throwIfAborted();
      return {
        phase: 'tile_prefetch',
        status: failedCount > 0 ? 'failed' : 'applied',
        reason: failedCount > 0 ? 'tile_prefetch_failed' : 'tile_prefetch_scheduled',
        eligibleProjectCount: eligibleCount,
        scheduledProjectCount: inputs.length,
        failedProjectCount: failedCount,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn(`Map prefetch scheduling failed for layer ${layer.id}:`, error);
      return {
        phase: 'tile_prefetch',
        status: 'failed',
        reason: 'tile_prefetch_failed',
        eligibleProjectCount: eligibleCount,
        scheduledProjectCount: inputs.length,
        failedProjectCount: failedCount + inputs.length,
      };
    }
  }
}
