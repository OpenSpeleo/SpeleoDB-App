import { MAP_LAYERS, MAP_OVERLAYS } from '../constants';
import type { OfflineMapSyncEngineLike } from '../services/OfflineMapSyncEngine';
import { LazyOfflineMapSyncEngine } from '../services/LazyOfflineMapSyncEngine';
import { DownloadAreaService } from '../services/DownloadAreaService';
import { automaticAreaInputs } from '../services/downloadAreaSources';
import { countAreaCoordinates } from '../services/downloadAreaGeometry';
import type { DownloadAreaInput } from '../types/downloadArea';
import { getMapLayerById } from '../services/MapLayersService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import {
  clearCachedTilesRuntime,
  setTileCacheOverLimitApprovedRuntime,
} from '../services/TileCacheRuntime';
import type { OfflineMapSyncSnapshot } from '../types/offlineMapSync';
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
import type { GisGeometryPrefetchSource } from '../types/gisGeometry';
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
  getGisPrefetchSources(signal?: AbortSignal): Promise<GisGeometryPrefetchSource[]>;
  foldLandmarks?(collection: GeoJSON.FeatureCollection): Promise<GeoJSON.FeatureCollection>;
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
  areas: DownloadAreaInput[];
  eligibleProjectCount: number;
  scheduledProjectCount: number;
  failedProjectCount: number;
  landmarkCount: number;
}

/** Owns offline-map lifecycle, consent, layer settings, and source collection. */
export class TileCoordinator {
  private engine: OfflineMapSyncEngineLike;
  areas: DownloadAreaService;
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
  private layerSettingsTail: Promise<void> = Promise.resolve();
  private readonly sourceWork = new Set<Promise<unknown>>();

  constructor(
    private readonly dependencies: TileCoordinatorDependencies,
    engine?: OfflineMapSyncEngineLike,
  ) {
    this.engine = engine ?? this.createEngine();
    this.areas = new DownloadAreaService(this.engine, () => this.dependencies.hasNetworkAccess(), () => this.getEnabledLayers().map((layer) => layer.id));
    this.attachEngineDiagnostics();
    this.restoreConsent();
  }

  get snapshot(): OfflineMapSyncSnapshot {
    return this.areas.getSyncSnapshot();
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
    await this.areas.preload();
    this.areas.resume();
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
    const areas = this.areas;
    // Serialize only preference commits, never downloads or tile cleanup.
    // A failed switch then rolls back its own state before the next one reads it.
    const operation = this.layerSettingsTail.then(async () => {
      const current = this.dependencies.preferences.get().layerOfflineSync ?? {};
      this.dependencies.preferences.set({
        layerOfflineSync: { ...current, [layerId]: enabled },
      });
      this.dependencies.notifyStateChanged();
      try {
        await areas.setLayers(this.getEnabledLayers().map((value) => value.id));
      } catch (error) {
        this.dependencies.preferences.set({ layerOfflineSync: current });
        this.dependencies.notifyStateChanged();
        throw error;
      }
    });
    this.layerSettingsTail = operation.catch(() => {});
    return operation;
  }

  scheduleSyncPhase(
    context: CancellationContext,
    projects: Project[],
    forceRefresh = false,
  ): Promise<TilePrefetchPhaseResult> {
    return this.trackSourceWork(this.runSyncPhase(context, projects, forceRefresh));
  }

  private async runSyncPhase(
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
      await this.areas.reconcileAutomatic(sources.areas, () => this.assertCoverageRequestCurrent(requestVersion, context), forceRefresh);
      const coordinateCount = sources.areas.reduce((count, area) => count + countAreaCoordinates(area), 0);
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
        landmarkTileCount: sources.landmarkCount > 0 ? coordinateCount : 0,
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
      if (requestVersion === this.coverageRequestVersion && !context.signal.aborted) this.areas.reportAutomaticError();
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
    this.areas.resumeManual();
    const context = this.beginContext('Project sync offline-map preparation', runId);
    let started = false;
    let complete!: () => void;
    this.trackSourceWork(new Promise<void>((resolve) => { complete = resolve; }));
    const finish = () => {
      context.signal.removeEventListener('abort', cancelDeferred);
      this.activeContexts.delete(context);
      complete();
    };
    const cancelDeferred = () => { if (!started) finish(); };
    context.signal.addEventListener('abort', cancelDeferred, { once: true });
    const run = () => {
      if (started) return;
      started = true;
      context.signal.removeEventListener('abort', cancelDeferred);
      if (context.signal.aborted) {
        finish();
        return;
      }
      void this.scheduleSyncPhase(context, projects)
        .catch((error) => {
          if (!isAbortError(error)) {
            console.warn('Background offline-map preparation failed:', error);
          }
        })
        .finally(finish);
    };
    try {
      (this.dependencies.deferWork ?? deferToNextTask)(run);
    } catch (error) {
      finish();
      throw error;
    }
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
        await this.areas.waitForIdle();
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

  /** Revoked GIS access cannot wait for unrelated source reads to succeed. */
  async removeGisGeometrySources(
    ids: readonly string[],
    validate: () => void = () => {},
  ): Promise<void> {
    if (!ids.length) return;
    this.supersedeCoverageRequests();
    for (const context of this.activeContexts) context.abort('GIS geometry access changed');
    this.activeContexts.clear();
    await this.trackSourceWork(this.areas.removeGisGeometrySources(ids, validate));
  }

  cancel(): void {
    this.supersedeCoverageRequests();
    for (const context of this.activeContexts) context.abort('Async operations invalidated');
    this.activeContexts.clear();
    this.areas.cancel();
    this.engine.cancel();
  }

  stopForLogout(): Promise<void> | void {
    this.cancel();
    const current = this.engine;
    this.areas.dispose();
    current.dispose();
    this.engineUnsubscribe?.();
    this.engineUnsubscribe = null;
    this.overflowApproved = false;
    this.promptAcknowledged = false;
    this.consentRequested = false;
    setTileCacheOverLimitApprovedRuntime(false);
    return Promise.all([current.waitForIdle(), this.waitForIdle()]).then(() => {});
  }

  /** Includes work admitted before its deferred callback or source reads settle. */
  async waitForIdle(): Promise<void> {
    let preferences: Promise<void>;
    do {
      preferences = this.layerSettingsTail;
      await Promise.allSettled([...this.sourceWork, preferences]);
      await this.areas.waitForIdle();
    } while (this.sourceWork.size > 0 || preferences !== this.layerSettingsTail);
  }

  private trackSourceWork<T>(work: Promise<T>): Promise<T> {
    this.sourceWork.add(work);
    const complete = () => { this.sourceWork.delete(work); };
    void work.then(complete, complete);
    return work;
  }

  persistentCleanupTasks(): Promise<void>[] {
    return [clearCachedTilesRuntime()];
  }

  restartAfterLogout(): void {
    this.engine = this.createEngine();
    this.areas = new DownloadAreaService(this.engine, () => this.dependencies.hasNetworkAccess(), () => this.getEnabledLayers().map((layer) => layer.id));
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

  private async collectCoverageSources(
    context: CancellationContext,
    projects: Project[],
  ): Promise<CoverageSources> {
    const [overlays, gpsSources, built, geometries] = await Promise.all([
      Promise.all(MAP_OVERLAYS.map(async (overlay) => ({ id: overlay.id, collection: await this.trackSourceWork(this.loadOverlay(context, overlay.id)) }))),
      this.trackSourceWork(this.dependencies.getGpsPrefetchSources(context.signal)),
      this.trackSourceWork(this.buildProjectInputs(context, projects)),
      this.trackSourceWork(this.dependencies.getGisPrefetchSources(context.signal)),
    ]);
    context.throwIfAborted();
    await this.yieldForRendering(context);
    return {
      areas: automaticAreaInputs(built.inputs, overlays, gpsSources, this.getEnabledLayers().map((layer) => layer.id), geometries),
      eligibleProjectCount: built.eligibleCount,
      scheduledProjectCount: built.inputs.length,
      failedProjectCount: built.failedCount,
      landmarkCount: overlays.find((overlay) => overlay.id === 'landmarks')?.collection.features.length ?? 0,
    };
  }

  private async loadOverlay(context: CancellationContext, id: MapOverlayId): Promise<GeoJSON.FeatureCollection> {
    const raw = await this.dependencies.cache.getOverlayGeoJSONForOfflineMap(id, { signal: context.signal });
    context.throwIfAborted();
    const collection = normalizeGeoJSON(raw);
    if (!collection) throw new Error(`Required offline-map overlay is unavailable: ${id}`);
    return id === 'landmarks' && this.dependencies.foldLandmarks
      ? this.dependencies.foldLandmarks(collection) : collection;
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
    this.engineUnsubscribe = this.areas.subscribeSync(() => {
      for (const listener of this.progressListeners) listener();
      const stuck = this.overflowApproved && this.snapshot.blockedByStorage;
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
