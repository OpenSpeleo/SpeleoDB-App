import { MAP_LAYERS, TILE_PREFETCH } from '../constants';
import type { OfflineMapSyncEngineLike } from '../services/OfflineMapSyncEngine';
import { LazyOfflineMapSyncEngine } from '../services/LazyOfflineMapSyncEngine';
import { computeOfflineMapSourceRevision } from '../services/OfflineMapPlanner';
import { getMapLayerById } from '../services/MapLayersService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import {
  clearCachedTilesRuntime,
  evictLayerTilesRuntime,
  setTileCacheOverLimitApprovedRuntime,
} from '../services/TileCacheRuntime';
import { computeTilePrefetchSignature, extractPointCoordinates } from '../services/tilePrefetchPlanner';
import type { OfflineMapPlanningInput, OfflineMapSyncSnapshot } from '../types/offlineMapSync';
import type { LocalGpsTrack } from '../types/gpsTrack';
import type { MapLayerDefinition } from '../types/mapLayer';
import type { MapOverlayId } from '../types/mapOverlay';
import type { Project } from '../types/project';
import type { TilePrefetchProjectInput } from '../types/tilePrefetch';
import type { TilePrefetchPhaseResult } from '../types/sync';
import { isAbortError } from '../utils/abort';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { deferToNextTask, yieldToMainThread } from '../utils/yieldToMainThread';
import {
  logElapsedPerformanceTiming,
  type ActivePerformanceTiming,
} from '../utils/performanceTiming';
import type { GpsTrackPrefetchSource } from './GpsTrackCoordinator';
import { CancellationContext } from './CancellationContext';
import { createSkippedTilePrefetchPhase } from './ProjectSyncPhases';

interface TilePreferences {
  tileCacheOverLimitApproved?: boolean;
  tileCacheOverLimitPromptAcknowledged?: boolean;
  layerOfflineSync?: Record<string, boolean>;
}

interface TileCoordinatorDependencies {
  cache: ProjectCacheService;
  preferences: {
    get(): TilePreferences;
    set(value: TilePreferences): void;
  };
  hasNetworkAccess(): boolean;
  getProjects(): Project[];
  getGpsPrefetchSources(signal?: AbortSignal): Promise<GpsTrackPrefetchSource[]>;
  notifyStateChanged(): void;
  deferWork?(work: () => void): void;
  yieldToMainThread?(): Promise<void>;
}

interface BuiltProjectInputs {
  inputs: TilePrefetchProjectInput[];
  eligibleCount: number;
  failedCount: number;
}

interface CoverageSources {
  planning: OfflineMapPlanningInput;
  eligibleProjectCount: number;
  scheduledProjectCount: number;
  failedProjectCount: number;
  landmarkCount: number;
}

/** Owns offline-map lifecycle, consent, layer settings, and source collection. */
export class TileCoordinator {
  private engine: OfflineMapSyncEngineLike;
  private overflowApproved = false;
  private promptAcknowledged = false;
  private consentRequested = false;
  private nextRunId = 1;
  private readonly activeContexts = new Set<CancellationContext>();
  private refreshPromise: Promise<void> | null = null;
  private engineUnsubscribe: (() => void) | null = null;
  private warnedBlockedWhileApproved = false;
  private readonly progressListeners = new Set<() => void>();
  private coverageRequestVersion = 0;

  constructor(
    private readonly dependencies: TileCoordinatorDependencies,
    engine?: OfflineMapSyncEngineLike,
  ) {
    this.engine = engine ?? this.createEngine();
    this.attachEngineDiagnostics();
    this.restoreConsent();
  }

  get snapshot(): OfflineMapSyncSnapshot {
    return this.engine.getSnapshot();
  }

  subscribe(listener: () => void): () => void {
    this.progressListeners.add(listener);
    return () => { this.progressListeners.delete(listener); };
  }

  get isOverflowApproved(): boolean {
    return this.overflowApproved;
  }

  get isOverLimit(): boolean {
    return !this.overflowApproved && this.snapshot.blockedByStorage;
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

  get isRefreshActive(): boolean {
    return this.refreshPromise !== null;
  }

  async preload(): Promise<void> {
    await this.engine.preload();
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
    this.persistConsent();
    setTileCacheOverLimitApprovedRuntime(true);
    this.engine.resumeBlocked();
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
    this.persistConsent();
    setTileCacheOverLimitApprovedRuntime(false);
    this.dependencies.notifyStateChanged();
  }

  async setLayerOfflineSync(layerId: string, enabled: boolean): Promise<void> {
    const layer = getMapLayerById(layerId);
    if (!layer || layer.forcedOffline) return;
    this.supersedeCoverageRequests();
    const current = this.dependencies.preferences.get().layerOfflineSync ?? {};
    this.dependencies.preferences.set({
      layerOfflineSync: { ...current, [layerId]: enabled },
    });
    this.dependencies.notifyStateChanged();
    try {
      if (!enabled) {
        await this.removeLayerData(layer);
        if (this.dependencies.hasNetworkAccess()) {
          await this.scheduleFromActivePlanOrRebuild('Layer offline-map removal');
        }
        return;
      }
      if (this.dependencies.hasNetworkAccess()) {
        await this.scheduleFromActivePlanOrRebuild('Layer offline-map sync');
      }
    } catch (error) {
      this.dependencies.preferences.set({ layerOfflineSync: current });
      this.dependencies.notifyStateChanged();
      throw error;
    }
  }

  async scheduleSyncPhase(
    context: CancellationContext,
    projects: Project[],
    forceRefresh = false,
  ): Promise<TilePrefetchPhaseResult> {
    const requestVersion = this.supersedeCoverageRequests();
    let activeTiming: ActivePerformanceTiming | null = null;
    if (!this.dependencies.hasNetworkAccess()) {
      return createSkippedTilePrefetchPhase('offline_locked');
    }
    try {
      activeTiming = {
        phase: 'coverage_source_collection',
        startedAt: performance.now(),
      };
      const sources = await this.collectCoverageSources(context, projects);
      logElapsedPerformanceTiming('offline-map', context.runId, activeTiming, 'applied');
      activeTiming = null;
      this.assertCoverageRequestCurrent(requestVersion, context);
      await this.yieldForRendering(context);
      activeTiming = { phase: 'plan_schedule', startedAt: performance.now() };
      const result = await this.engine.schedule({
        mode: 'rebuild',
        plan: sources.planning,
        layers: this.getEnabledLayers().map((layer) => ({
          id: layer.id,
          tileUrlTemplate: layer.tileUrlTemplate,
        })),
        forceRefresh,
        signal: context.signal,
      });
      context.throwIfAborted();
      logElapsedPerformanceTiming('offline-map', context.runId, activeTiming, 'applied');
      activeTiming = null;
      return {
        phase: 'tile_prefetch',
        status: sources.failedProjectCount > 0 ? 'failed' : 'applied',
        reason: sources.failedProjectCount > 0
          ? 'tile_prefetch_failed'
          : 'tile_prefetch_scheduled',
        eligibleProjectCount: sources.eligibleProjectCount,
        scheduledProjectCount: sources.scheduledProjectCount,
        failedProjectCount: sources.failedProjectCount,
        landmarkTileCount: sources.landmarkCount > 0 ? result.coordinateCount : 0,
        landmarkScheduled: sources.landmarkCount > 0,
      };
    } catch (error) {
      if (activeTiming) {
        logElapsedPerformanceTiming(
          'offline-map',
          context.runId,
          activeTiming,
          isAbortError(error) || context.signal.aborted ? 'aborted' : 'failed',
        );
      }
      if (isAbortError(error)) throw error;
      return {
        phase: 'tile_prefetch',
        status: 'failed',
        reason: 'tile_prefetch_failed',
        eligibleProjectCount: 0,
        scheduledProjectCount: 0,
        failedProjectCount: 1,
      };
    }
  }

  queueProjectSync(projects: Project[], runId: number): void {
    const context = this.beginContext('Project sync offline-map preparation', runId);
    const run = () => {
      if (context.signal.aborted) {
        this.activeContexts.delete(context);
        return;
      }
      void this.scheduleSyncPhase(context, projects)
        .catch((error) => {
          if (!isAbortError(error)) {
            console.warn('Background offline-map preparation failed:', error);
          }
        })
        .finally(() => this.activeContexts.delete(context));
    };
    (this.dependencies.deferWork ?? deferToNextTask)(run);
  }

  async refreshOfflineMaps(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.dependencies.hasNetworkAccess()) {
      throw new Error('Offline maps can only be refreshed while online.');
    }
    const run = async () => {
      const context = this.beginContext('Offline map refresh');
      try {
        await this.scheduleSyncPhase(context, this.dependencies.getProjects(), true);
        await this.engine.waitForIdle();
      } finally {
        this.activeContexts.delete(context);
      }
    };
    const promise = run().finally(() => {
      if (this.refreshPromise === promise) this.refreshPromise = null;
      this.dependencies.notifyStateChanged();
    });
    this.refreshPromise = promise;
    this.dependencies.notifyStateChanged();
    return promise;
  }

  async scheduleLocalGpsTrack(_track: LocalGpsTrack): Promise<void> {
    if (!this.dependencies.hasNetworkAccess()) return;
    await this.scheduleCurrentCoverage('Local GPS offline-map sync');
  }

  async removeTarget(_projectId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason;
    // Target ownership no longer exists. The next canonical source revision
    // atomically replaces the union while the prior coverage remains usable.
  }

  cancel(): void {
    this.supersedeCoverageRequests();
    for (const context of this.activeContexts) context.abort('Async operations invalidated');
    this.activeContexts.clear();
    this.engine.cancel();
  }

  stopForLogout(): Promise<void> | void {
    const current = this.engine;
    current.dispose();
    this.engineUnsubscribe?.();
    this.engineUnsubscribe = null;
    this.overflowApproved = false;
    this.promptAcknowledged = false;
    this.consentRequested = false;
    setTileCacheOverLimitApprovedRuntime(false);
    return current.waitForIdle();
  }

  persistentCleanupTasks(): Promise<void>[] {
    return [clearCachedTilesRuntime()];
  }

  restartAfterLogout(): void {
    this.engine = this.createEngine();
    this.attachEngineDiagnostics();
  }

  private createEngine(): OfflineMapSyncEngineLike {
    return new LazyOfflineMapSyncEngine({
      isOnline: () => this.dependencies.hasNetworkAccess(),
    });
  }

  private beginContext(label: string, runId?: number): CancellationContext {
    for (const context of this.activeContexts) context.abort('Superseded offline-map request');
    this.activeContexts.clear();
    this.engine.cancel();
    const context = new CancellationContext(runId ?? this.nextRunId, label);
    if (runId === undefined) this.nextRunId += 1;
    this.activeContexts.add(context);
    return context;
  }

  private async scheduleCurrentCoverage(label: string): Promise<void> {
    const context = this.beginContext(label);
    try {
      await this.scheduleSyncPhase(context, this.dependencies.getProjects());
    } catch (error) {
      if (!isAbortError(error)) throw error;
    } finally {
      this.activeContexts.delete(context);
    }
  }

  private async scheduleFromActivePlanOrRebuild(label: string): Promise<void> {
    const context = this.beginContext(label);
    const requestVersion = this.supersedeCoverageRequests();
    try {
      try {
        await this.engine.schedule({
          mode: 'reuse-active-plan',
          layers: this.getEnabledLayers().map((layer) => ({
            id: layer.id,
            tileUrlTemplate: layer.tileUrlTemplate,
          })),
          referenceLayerId: 'esri-satellite',
          signal: context.signal,
        });
        this.assertCoverageRequestCurrent(requestVersion, context);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (!(error instanceof Error) || error.name !== 'OfflineMapPlanUnavailableError') {
          throw error;
        }
        this.assertCoverageRequestCurrent(requestVersion, context);
        const result = await this.scheduleSyncPhase(context, this.dependencies.getProjects());
        if (result.status === 'failed') {
          throw new Error('Offline-map planning inputs are incomplete');
        }
      }
    } finally {
      this.activeContexts.delete(context);
    }
  }

  private getEnabledLayers(): MapLayerDefinition[] {
    const sync = this.dependencies.preferences.get().layerOfflineSync ?? {};
    return MAP_LAYERS.filter((layer) => layer.forcedOffline || sync[layer.id] === true);
  }

  private supersedeCoverageRequests(): number {
    this.coverageRequestVersion += 1;
    return this.coverageRequestVersion;
  }

  private assertCoverageRequestCurrent(
    version: number,
    context: CancellationContext,
  ): void {
    context.throwIfAborted();
    if (version !== this.coverageRequestVersion) {
      throw new DOMException('Offline-map request was superseded', 'AbortError');
    }
  }

  private async removeLayerData(layer: MapLayerDefinition): Promise<void> {
    await this.engine.releaseLayer(layer.id);
    const prefix = layer.tileUrlTemplate.split('{z}')[0];
    if (prefix) await evictLayerTilesRuntime([prefix]);
    await this.engine.refreshCacheStats?.();
  }

  private async collectCoverageSources(
    context: CancellationContext,
    projects: Project[],
  ): Promise<CoverageSources> {
    const [landmarks, stations, gpsSources, built] = await Promise.all([
      this.loadOverlayPoints(context, ['landmarks']),
      this.loadOverlayPoints(context, ['subsurfaceStations', 'surfaceStations']),
      this.dependencies.getGpsPrefetchSources(context.signal),
      this.buildProjectInputs(context, projects),
    ]);
    context.throwIfAborted();
    await this.yieldForRendering(context);
    const enabledLayers = this.getEnabledLayers();
    const maxZoom = Math.min(
      TILE_PREFETCH.PROJECT_REQUEST.maxZoom,
      ...enabledLayers.map((layer) => layer.maxZoom),
    );
    const revisionParts = [
      `coverage:${COVERAGE_REVISION}`,
      `zoom:${TILE_PREFETCH.PROJECT_REQUEST.minZoom}-${maxZoom}`,
      `padding:${TILE_PREFETCH.PROJECT_REQUEST.padMeters}`,
      `landmarks:${computeTilePrefetchSignature(landmarks)}`,
      `stations:${computeTilePrefetchSignature(stations)}`,
      ...built.inputs.map((input) => (
        `project:${input.projectId}:${input.commitId}:${JSON.stringify(input.bounds)}`
      )),
      ...gpsSources.map((source) => (
        `gps:${source.targetKind}:${source.targetId}:${source.sourceRevision}`
      )),
    ];
    const sourceRevision = await computeOfflineMapSourceRevision(revisionParts);
    context.throwIfAborted();
    return {
      planning: {
        sourceRevision,
        projects: built.inputs.map((input) => input.bounds),
        points: [...landmarks, ...stations],
        paths: gpsSources.flatMap((source) => source.paths),
        minZoom: TILE_PREFETCH.PROJECT_REQUEST.minZoom,
        maxZoom,
        padMeters: TILE_PREFETCH.PROJECT_REQUEST.padMeters,
      },
      eligibleProjectCount: built.eligibleCount,
      scheduledProjectCount: built.inputs.length,
      failedProjectCount: built.failedCount,
      landmarkCount: landmarks.length,
    };
  }

  private async loadOverlayPoints(
    context: CancellationContext,
    overlayIds: MapOverlayId[],
  ): Promise<[number, number][]> {
    try {
      const points: [number, number][] = [];
      for (const overlayId of overlayIds) {
        const raw = await this.dependencies.cache.getOverlayGeoJSONForOfflineMap(
          overlayId,
          { signal: context.signal },
        );
        context.throwIfAborted();
        if (raw === null) {
          throw new Error(`Required offline-map overlay is not cached: ${overlayId}`);
        }
        const collection = normalizeGeoJSON(raw);
        if (!collection) {
          throw new Error(`Required offline-map overlay is invalid: ${overlayId}`);
        }
        await this.yieldForRendering(context);
        points.push(...extractPointCoordinates(collection));
      }
      return points;
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw error;
    }
  }

  private async buildProjectInputs(
    context: CancellationContext,
    projects: Project[],
  ): Promise<BuiltProjectInputs> {
    const eligible = projects.filter((project) => project.geojson_file && !project.exclude_geojson);
    const inputs: Array<TilePrefetchProjectInput | undefined> = new Array(eligible.length);
    const failedCount = 0;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < eligible.length) {
        const index = cursor;
        cursor += 1;
        const project = eligible[index];
        context.throwIfAborted();
        const commitId = project.latest_commit.id;
        const record = await this.dependencies.cache.getProjectGeoJSONRecord(
          project.id,
          { signal: context.signal },
        );
        context.throwIfAborted();
        if (record.state === 'quarantined' && record.commitId === commitId) {
          continue;
        }
        if (record.state !== 'active' || record.commitId !== commitId) {
          throw new Error(`Current project geometry is unavailable: ${project.id}`);
        }
        inputs[index] = {
          projectId: project.id,
          commitId,
          bounds: record.analysis.bounds,
        };
      }
    };
    const workers = Array.from(
      { length: Math.min(4, eligible.length) },
      () => worker(),
    );
    const settled = await Promise.allSettled(workers);
    const failed = settled.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    if (failed) {
      throw failed.reason;
    }
    return {
      inputs: inputs.filter((input): input is TilePrefetchProjectInput => input !== undefined),
      eligibleCount: eligible.length,
      failedCount,
    };
  }

  private async yieldForRendering(context: CancellationContext): Promise<void> {
    await (this.dependencies.yieldToMainThread ?? yieldToMainThread)();
    context.throwIfAborted();
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

  private attachEngineDiagnostics(): void {
    this.engineUnsubscribe?.();
    this.engineUnsubscribe = this.engine.subscribe(() => {
      for (const listener of this.progressListeners) listener();
      const stuck = this.overflowApproved && this.engine.getSnapshot().blockedByStorage;
      if (!stuck) {
        this.warnedBlockedWhileApproved = false;
        return;
      }
      if (this.warnedBlockedWhileApproved) return;
      this.warnedBlockedWhileApproved = true;
      console.warn(
        'Offline-map synchronization is blocked by storage while overflow is approved.',
      );
    });
  }
}

const COVERAGE_REVISION = 1;
