import { MAP } from '../constants';
import type {
  OfflineMapGenerationRecord,
  OfflineMapLayerProgress,
  OfflineMapPlanRecord,
  OfflineMapSyncRequest,
  OfflineMapSyncResult,
  OfflineMapSyncSnapshot,
} from '../types/offlineMapSync';
import { isAbortError, throwIfAborted } from '../utils/abort';
import {
  claimCachedTilesForOfflineMap,
  fetchAndCacheOfflineMapTile,
  isTerminalTileFetchError,
} from './TileCacheService';
import {
  activateOfflineMapGeneration,
  commitOfflineMapPlan,
  deleteOfflineMapPlan,
  deleteOfflineMapPlanChunks,
  garbageCollectOfflineMapPlans,
  getOfflineMapGenerations,
  getOfflineMapPlanByRevision,
  getOfflineMapPlanById,
  getOfflineMapPlanChunk,
  getTileCacheStats,
  normalizeOfflineMapGenerationCounters,
  putOfflineMapPlanChunk,
  recoverOfflineMapPlanStorage,
  releaseOfflineMapGeneration,
  runOfflineMapV7Migration,
  setOfflineMapGeneration,
} from './tileCache/TileCacheRepository';
import {
  decodeOfflineMapCoordinateChunk,
  planOfflineMapInWorker,
} from './OfflineMapPlanner';
import {
  EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
  OfflineMapSyncStore,
} from './OfflineMapSyncStore';

const DOWNLOAD_CONCURRENCY = 6;
const CACHE_AUDIT_BATCH_SIZE = 16;
const MAX_READY_TASKS = 64;
const MAX_OUTSTANDING_TASKS = MAX_READY_TASKS;
const CHECKPOINT_INTERVAL_MS = 1_000;
const RETRY_DELAYS_MS = [500, 1_500, 3_500] as const;
const COVERAGE_VERSION = 2;

interface TileTask {
  url: string;
  layerId: string;
  generationId: string;
  attempt: number;
  previousSizeBytes: number;
}

interface MutableLayerProgress extends OfflineMapLayerProgress {
  generation: OfflineMapGenerationRecord | null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function applyTileTemplate(
  template: string,
  coordinate: { z: number; x: number; y: number },
): string {
  return template
    .replace('{z}', String(coordinate.z))
    .replace('{x}', String(coordinate.x))
    .replace('{y}', String(coordinate.y));
}

function isCapacityError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: string }).name === 'TileCacheCapacityError',
  );
}

function boundedProgress(value: number, total: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.floor(value)), Math.max(0, Math.floor(total)));
}

class TileWorkQueue {
  private readonly ready: TileTask[] = [];
  private readonly waiters: Array<(task: TileTask | null) => void> = [];
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly capacityWaiters: Array<() => void> = [];
  private outstanding = 0;
  private producerDone = false;
  private paused = false;
  private cancelled = false;

  async enqueue(task: TileTask): Promise<boolean> {
    while (
      !this.cancelled
      && (this.ready.length >= MAX_READY_TASKS || this.outstanding >= MAX_OUTSTANDING_TASKS)
    ) {
      await new Promise<void>((resolve) => this.capacityWaiters.push(resolve));
    }
    if (this.cancelled) return false;
    this.outstanding += 1;
    this.pushReady(task);
    return true;
  }

  requeue(task: TileTask): void {
    if (this.cancelled) return;
    this.pushReady(task);
  }

  retryLater(task: TileTask, delayMs: number): void {
    if (this.cancelled) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      this.pushReady(task);
    }, delayMs);
    this.retryTimers.add(timer);
  }

  complete(): void {
    this.outstanding = Math.max(0, this.outstanding - 1);
    this.releaseCapacity();
    this.settleIfDone();
  }

  finishProducing(): void {
    this.producerDone = true;
    this.settleIfDone();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused || this.cancelled) return;
    this.paused = false;
    this.drain();
  }

  take(): Promise<TileTask | null> {
    if (this.cancelled) return Promise.resolve(null);
    if (!this.paused && this.ready.length > 0) {
      const task = this.ready.shift()!;
      this.releaseCapacity();
      return Promise.resolve(task);
    }
    if (this.producerDone && this.outstanding === 0) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    this.ready.length = 0;
    this.releaseCapacity();
    while (this.waiters.length > 0) this.waiters.shift()!(null);
  }

  private pushReady(task: TileTask): void {
    this.ready.push(task);
    this.drain();
  }

  private drain(): void {
    if (this.paused || this.cancelled) return;
    while (this.ready.length > 0 && this.waiters.length > 0) {
      this.waiters.shift()!(this.ready.shift()!);
      this.releaseCapacity();
    }
  }

  private settleIfDone(): void {
    if (!this.producerDone || this.outstanding > 0) return;
    while (this.waiters.length > 0) this.waiters.shift()!(null);
  }

  private releaseCapacity(): void {
    while (this.capacityWaiters.length > 0) this.capacityWaiters.shift()!();
  }
}

export interface OfflineMapSyncEngineLike {
  subscribe(listener: () => void): () => void;
  getSnapshot(): OfflineMapSyncSnapshot;
  preload(): Promise<void>;
  schedule(request: OfflineMapSyncRequest): Promise<OfflineMapSyncResult>;
  waitForIdle(): Promise<void>;
  resumeBlocked(): void;
  releaseLayer(layerId: string): Promise<void>;
  refreshCacheStats?(): Promise<void>;
  cancel(): void;
  dispose(): void;
}

export interface OfflineMapSyncEngineDependencies {
  store: OfflineMapSyncStore;
  now(): number;
  isOnline(): boolean;
  getCacheStats: typeof getTileCacheStats;
  getPlan: typeof getOfflineMapPlanByRevision;
  getPlanById: typeof getOfflineMapPlanById;
  putPlanChunk: typeof putOfflineMapPlanChunk;
  commitPlan: typeof commitOfflineMapPlan;
  deletePlan: typeof deleteOfflineMapPlan;
  deletePlanChunks: typeof deleteOfflineMapPlanChunks;
  getPlanChunk: typeof getOfflineMapPlanChunk;
  getGenerations: typeof getOfflineMapGenerations;
  setGeneration: typeof setOfflineMapGeneration;
  activateGeneration: typeof activateOfflineMapGeneration;
  releaseGeneration: typeof releaseOfflineMapGeneration;
  normalizeGenerations: typeof normalizeOfflineMapGenerationCounters;
  recoverPlanStorage: typeof recoverOfflineMapPlanStorage;
  garbageCollectPlans: typeof garbageCollectOfflineMapPlans;
  claimCached: typeof claimCachedTilesForOfflineMap;
  fetchTile: typeof fetchAndCacheOfflineMapTile;
  plan: typeof planOfflineMapInWorker;
  isTerminalFetchError(error: unknown): boolean;
  migrate(): Promise<void>;
}

const defaultDependencies: OfflineMapSyncEngineDependencies = {
  store: new OfflineMapSyncStore(),
  now: () => Date.now(),
  isOnline: () => true,
  getCacheStats: getTileCacheStats,
  getPlan: getOfflineMapPlanByRevision,
  getPlanById: getOfflineMapPlanById,
  putPlanChunk: putOfflineMapPlanChunk,
  commitPlan: commitOfflineMapPlan,
  deletePlan: deleteOfflineMapPlan,
  deletePlanChunks: deleteOfflineMapPlanChunks,
  getPlanChunk: getOfflineMapPlanChunk,
  getGenerations: getOfflineMapGenerations,
  setGeneration: setOfflineMapGeneration,
  activateGeneration: activateOfflineMapGeneration,
  releaseGeneration: releaseOfflineMapGeneration,
  normalizeGenerations: normalizeOfflineMapGenerationCounters,
  recoverPlanStorage: recoverOfflineMapPlanStorage,
  garbageCollectPlans: garbageCollectOfflineMapPlans,
  claimCached: claimCachedTilesForOfflineMap,
  fetchTile: fetchAndCacheOfflineMapTile,
  plan: planOfflineMapInWorker,
  isTerminalFetchError: isTerminalTileFetchError,
  migrate: runOfflineMapV7Migration,
};

export class OfflineMapSyncEngine implements OfflineMapSyncEngineLike {
  private readonly dependencies: OfflineMapSyncEngineDependencies;
  private activeController: AbortController | null = null;
  private activeQueue: TileWorkQueue | null = null;
  private activePromise: Promise<void> | null = null;
  private checkpointTail: Promise<void> = Promise.resolve();
  private readonly operations = new Set<Promise<void>>();
  private readonly cleanupOperations = new Set<Promise<void>>();
  private activeCoverage = new Map<string, OfflineMapGenerationRecord>();
  private sessionCounter = 1;
  private destroyed = false;
  private cacheBytes = 0;
  private lastCheckpointAt = 0;
  private migrationPromise: Promise<void> | null = null;

  constructor(dependencies: Partial<OfflineMapSyncEngineDependencies> = {}) {
    this.dependencies = {
      ...defaultDependencies,
      store: dependencies.store ?? new OfflineMapSyncStore(),
      ...dependencies,
    };
  }

  subscribe(listener: () => void): () => void {
    return this.dependencies.store.subscribe(listener);
  }

  getSnapshot(): OfflineMapSyncSnapshot {
    return this.dependencies.store.getSnapshot();
  }

  async preload(): Promise<void> {
    const stats = await this.dependencies.getCacheStats();
    this.cacheBytes = stats.totalBytes;
    this.dependencies.store.publish({
      ...EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
      phase: 'planning',
      cacheBytes: this.cacheBytes,
    }, true);
    await this.ensureMigrated();
    await this.dependencies.recoverPlanStorage();
    const generations = await this.dependencies.normalizeGenerations();
    this.activeCoverage = new Map(
      generations
        .filter((generation) => generation.status === 'active')
        .map((generation) => [generation.layerId, generation]),
    );
    this.publishCoverageSnapshot();
    for (const generation of generations.filter((item) => item.status !== 'active')) {
      this.trackCleanup(this.dependencies.releaseGeneration(generation.id));
    }
  }

  async schedule(request: OfflineMapSyncRequest): Promise<OfflineMapSyncResult> {
    if (this.destroyed) throw new Error('Offline-map synchronization is disposed');
    const layerIds = new Set(request.layers.map((layer) => layer.id));
    const templates = new Set(request.layers.map((layer) => layer.tileUrlTemplate));
    if (layerIds.size !== request.layers.length || templates.size !== request.layers.length) {
      throw new Error('Offline-map layers must have unique ids and tile URL namespaces');
    }
    this.cancel();

    const controller = new AbortController();
    this.activeController = controller;
    const onExternalAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', onExternalAbort, { once: true });
    if (request.signal?.aborted) controller.abort(request.signal.reason);

    const ready = deferred<OfflineMapSyncResult>();
    const promise = this.runSession(request, controller, ready)
      .catch((error) => {
        ready.reject(error);
        if (!isAbortError(error)) console.warn('Offline-map synchronization failed:', error);
      })
      .finally(() => {
        request.signal?.removeEventListener('abort', onExternalAbort);
        if (this.activeController === controller) {
          this.activeController = null;
          this.activeQueue = null;
        }
        if (this.activePromise === promise) this.activePromise = null;
        this.operations.delete(promise);
      });
    this.activePromise = promise;
    this.operations.add(promise);
    return ready.promise;
  }

  async waitForIdle(): Promise<void> {
    while (this.operations.size > 0) await Promise.allSettled([...this.operations]);
    await this.checkpointTail;
    while (this.cleanupOperations.size > 0) {
      await Promise.allSettled([...this.cleanupOperations]);
    }
  }

  resumeBlocked(): void {
    if (!this.dependencies.isOnline()) return;
    this.activeQueue?.resume();
    const current = this.getSnapshot();
    if (current.phase === 'storage-blocked' || current.phase === 'paused') {
      this.dependencies.store.publish({
        ...current,
        phase: 'downloading',
        blockedByStorage: false,
      }, true);
    }
  }

  async releaseLayer(layerId: string): Promise<void> {
    this.cancel();
    if (this.activePromise) await this.activePromise;
    const generations = await this.dependencies.getGenerations();
    await Promise.all(generations
      .filter((generation) => generation.layerId === layerId)
      .map((generation) => this.dependencies.releaseGeneration(generation.id)));
    this.activeCoverage.delete(layerId);
    this.cacheBytes = (await this.dependencies.getCacheStats()).totalBytes;
    this.publishCoverageSnapshot();
  }

  async refreshCacheStats(): Promise<void> {
    this.cacheBytes = (await this.dependencies.getCacheStats()).totalBytes;
    this.publishCoverageSnapshot();
  }

  cancel(): void {
    this.activeController?.abort(new DOMException('Offline-map sync superseded', 'AbortError'));
    this.activeQueue?.cancel();
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancel();
    this.dependencies.store.reset();
  }

  private async runSession(
    request: OfflineMapSyncRequest,
    controller: AbortController,
    ready: Deferred<OfflineMapSyncResult>,
  ): Promise<void> {
    const signal = controller.signal;
    await this.ensureMigrated();
    throwIfAborted(signal);
    this.lastCheckpointAt = 0;
    const sessionId = `offline-map-${this.dependencies.now()}-${this.sessionCounter++}`;
    const startedAt = this.dependencies.now();
    const layers = new Map<string, MutableLayerProgress>();
    let phase: OfflineMapSyncSnapshot['phase'] = 'planning';
    let activeDownloads = 0;
    let downloadedTiles = 0;
    let bytesDownloaded = 0;
    let auditedTiles = 0;
    let queuedTiles = 0;
    let coordinateCount: number | null = null;
    const pendingGenerations: OfflineMapGenerationRecord[] = [];

    const publish = (immediate = false) => {
      if (this.destroyed || this.activeController !== controller) return;
      const layerValues = [...layers.values()].map(({ generation: _generation, ...layer }) => {
        const completed = boundedProgress(layer.completedTiles, layer.totalTiles);
        return {
          ...layer,
          completedTiles: completed,
          failedTiles: boundedProgress(layer.failedTiles, layer.totalTiles - completed),
          usableTiles: boundedProgress(layer.usableTiles, layer.totalTiles),
        };
      });
      const elapsedSeconds = Math.max(0.001, (this.dependencies.now() - startedAt) / 1_000);
      const tilesPerSecond = downloadedTiles / elapsedSeconds;
      const totalTiles = coordinateCount === null ? 0 : coordinateCount * request.layers.length;
      const completedTiles = layerValues.reduce((sum, layer) => sum + layer.completedTiles, 0);
      const failedTiles = layerValues.reduce((sum, layer) => sum + layer.failedTiles, 0);
      const remaining = Math.max(0, totalTiles - completedTiles - failedTiles);
      const coverageValues = [...this.activeCoverage.values()];
      this.dependencies.store.publish({
        sessionId,
        phase,
        coordinateCount,
        enabledLayerCount: request.layers.length,
        totalTiles,
        completedTiles,
        failedTiles,
        cachedFreshTiles: layerValues.reduce((sum, layer) => sum + layer.cachedFreshTiles, 0),
        auditedTiles,
        queuedTiles,
        downloadedTiles,
        activeDownloads,
        bytesDownloaded,
        tilesPerSecond,
        etaSeconds: tilesPerSecond > 0 ? Math.ceil(remaining / tilesPerSecond) : null,
        cacheBytes: this.cacheBytes,
        blockedByStorage: phase === 'storage-blocked',
        coverageTotalTiles: coverageValues.reduce((sum, generation) => sum + generation.totalTiles, 0),
        coverageCompletedTiles: coverageValues.reduce(
          (sum, generation) => sum + boundedProgress(
            generation.completedTiles,
            generation.totalTiles,
          ),
          0,
        ),
        layers: layerValues,
      }, immediate);
    };

    publish(true);
    try {
      const plan = await this.resolvePlan(request, signal, (lockedCount) => {
        coordinateCount = lockedCount;
        publish(true);
      });
      throwIfAborted(signal);
      coordinateCount = plan.coordinateCount;

      const existingGenerations = await this.dependencies.getGenerations();
      await Promise.all(existingGenerations
        .filter((generation) => generation.status !== 'active')
        .map((generation) => this.dependencies.releaseGeneration(generation.id)));
      throwIfAborted(signal);
      const currentActive = new Map(
        existingGenerations
          .filter((generation) => generation.status === 'active')
          .map((generation) => [generation.layerId, generation]),
      );
      this.activeCoverage = new Map(currentActive);

      for (const layer of request.layers) {
        const active = currentActive.get(layer.id);
        const usableTiles = active?.completedTiles ?? 0;
        const progress: MutableLayerProgress = {
          layerId: layer.id,
          totalTiles: plan.coordinateCount,
          completedTiles: 0,
          failedTiles: 0,
          cachedFreshTiles: 0,
          auditedTiles: 0,
          queuedTiles: 0,
          downloadedTiles: 0,
          bytesDownloaded: 0,
          usableTiles,
          generation: null,
        };
        layers.set(layer.id, progress);

        if (
          !request.forceRefresh
          && active?.planId === plan.id
          && active.completedTiles === plan.coordinateCount
          && active.failedTiles === 0
          && active.refreshAfter > this.dependencies.now()
        ) {
          progress.completedTiles = plan.coordinateCount;
          progress.cachedFreshTiles = plan.coordinateCount;
          continue;
        }

        const generation: OfflineMapGenerationRecord = {
          id: `${sessionId}:${layer.id}`,
          planId: plan.id,
          layerId: layer.id,
          status: 'pending',
          totalTiles: plan.coordinateCount,
          completedTiles: 0,
          failedTiles: 0,
          bytesDownloaded: 0,
          refreshAfter: 0,
          updatedAt: this.dependencies.now(),
        };
        progress.generation = generation;
        pendingGenerations.push(generation);
      }

      await Promise.all(pendingGenerations.map(
        (generation) => this.dependencies.setGeneration(generation),
      ));
      throwIfAborted(signal);
      publish(true);
      ready.resolve({
        coordinateCount: plan.coordinateCount,
        scheduledTileCount: plan.coordinateCount * request.layers.length,
        failedTileCount: 0,
      });

      if (pendingGenerations.length === 0) {
        phase = 'completed';
        publish(true);
        return;
      }

      const queue = new TileWorkQueue();
      this.activeQueue = queue;
      const workers = Array.from({ length: DOWNLOAD_CONCURRENCY }, () => (async () => {
        while (!signal.aborted) {
          const task = await queue.take();
          if (!task) return;
          if (!this.dependencies.isOnline()) {
            phase = 'paused';
            queue.pause();
            queue.requeue(task);
            publish(true);
            this.checkpoint(pendingGenerations, layers, true);
            continue;
          }
          phase = 'downloading';
          activeDownloads += 1;
          publish();
          try {
            const result = await this.dependencies.fetchTile(
              task.url,
              task.generationId,
              task.layerId,
              signal,
              task.previousSizeBytes,
            );
            throwIfAborted(signal);
            const layer = layers.get(task.layerId)!;
            layer.completedTiles += 1;
            layer.downloadedTiles += 1;
            layer.bytesDownloaded += result.downloadedBytes;
            downloadedTiles += 1;
            bytesDownloaded += result.downloadedBytes;
            layer.queuedTiles = Math.max(0, (layer.queuedTiles ?? 0) - 1);
            queuedTiles = Math.max(0, queuedTiles - 1);
            this.cacheBytes = Math.max(0, this.cacheBytes + result.cacheDeltaBytes);
            queue.complete();
            this.checkpoint(pendingGenerations, layers);
          } catch (error) {
            if (signal.aborted || isAbortError(error)) {
              const layer = layers.get(task.layerId)!;
              layer.queuedTiles = Math.max(0, (layer.queuedTiles ?? 0) - 1);
              queuedTiles = Math.max(0, queuedTiles - 1);
              queue.complete();
              continue;
            }
            if (isCapacityError(error)) {
              phase = 'storage-blocked';
              queue.pause();
              queue.requeue(task);
              publish(true);
              this.checkpoint(pendingGenerations, layers, true);
              continue;
            }
            if (
              !this.dependencies.isTerminalFetchError(error)
              && task.attempt < RETRY_DELAYS_MS.length
            ) {
              queue.retryLater(
                { ...task, attempt: task.attempt + 1 },
                RETRY_DELAYS_MS[task.attempt],
              );
              continue;
            }
            const layer = layers.get(task.layerId)!;
            layer.failedTiles += 1;
            layer.queuedTiles = Math.max(0, (layer.queuedTiles ?? 0) - 1);
            queuedTiles = Math.max(0, queuedTiles - 1);
            queue.complete();
            this.checkpoint(pendingGenerations, layers);
          } finally {
            activeDownloads = Math.max(0, activeDownloads - 1);
            publish();
          }
        }
      })());

      phase = 'auditing';
      publish(true);
      for (const layerInput of request.layers) {
        const layer = layers.get(layerInput.id)!;
        const generation = layer.generation;
        if (!generation) continue;
        for (let chunkIndex = 0; chunkIndex < plan.chunkCount; chunkIndex += 1) {
          throwIfAborted(signal);
          const chunk = await this.dependencies.getPlanChunk(plan.id, chunkIndex);
          if (!chunk) throw new Error(`Offline-map plan chunk ${chunkIndex} is missing`);
          const coordinates = decodeOfflineMapCoordinateChunk(chunk.coordinates);
          for (let start = 0; start < coordinates.length; start += CACHE_AUDIT_BATCH_SIZE) {
            const batchCoordinates = coordinates.slice(start, start + CACHE_AUDIT_BATCH_SIZE);
            const urls = batchCoordinates.map((coordinate) => (
              applyTileTemplate(layerInput.tileUrlTemplate, coordinate)
            ));
            const metadata = await this.dependencies.claimCached(
              urls,
              generation.id,
              layerInput.id,
              signal,
            );
            throwIfAborted(signal);
            for (let index = 0; index < urls.length; index += 1) {
              const url = urls[index];
              const cached = metadata[index];
              layer.auditedTiles = (layer.auditedTiles ?? 0) + 1;
              auditedTiles += 1;
              const fresh = Boolean(
                cached
                && cached.fetchedAt > 0
                && this.dependencies.now() - cached.fetchedAt < MAP.TILE_CACHE_MAX_AGE_MS,
              );
              if (fresh && !request.forceRefresh) {
                layer.completedTiles += 1;
                layer.cachedFreshTiles += 1;
              } else {
                const enqueued = await queue.enqueue({
                  url,
                  layerId: layerInput.id,
                  generationId: generation.id,
                  attempt: 0,
                  previousSizeBytes: cached?.sizeBytes ?? 0,
                });
                if (!enqueued) throwIfAborted(signal);
                layer.queuedTiles = (layer.queuedTiles ?? 0) + 1;
                queuedTiles += 1;
              }
              publish();
            }
          }
        }
      }
      queue.finishProducing();
      await Promise.all(workers);
      throwIfAborted(signal);

      await this.writeCheckpoint(pendingGenerations, layers, true);
      throwIfAborted(signal);
      let hasFailures = false;
      for (const generation of pendingGenerations) {
        const layer = layers.get(generation.layerId)!;
        if (layer.failedTiles > 0 || layer.completedTiles !== layer.totalTiles) {
          hasFailures = true;
          generation.status = 'failed';
          generation.updatedAt = this.dependencies.now();
          await this.dependencies.setGeneration(generation);
          this.trackCleanup(this.dependencies.releaseGeneration(generation.id));
          continue;
        }
        generation.completedTiles = layer.completedTiles;
        generation.failedTiles = 0;
        generation.bytesDownloaded = layer.bytesDownloaded;
        generation.refreshAfter = this.dependencies.now() + MAP.TILE_CACHE_MAX_AGE_MS;
        generation.updatedAt = this.dependencies.now();
        await this.dependencies.setGeneration(generation);
        const previousActive = await this.dependencies.activateGeneration(generation.id);
        generation.status = 'active';
        this.activeCoverage.set(generation.layerId, { ...generation });
        layer.usableTiles = layer.totalTiles;
        for (const previousGenerationId of previousActive) {
          this.trackCleanup(this.dependencies.releaseGeneration(previousGenerationId));
        }
      }
      this.trackCleanup(this.dependencies.garbageCollectPlans());
      phase = hasFailures ? 'completed-with-errors' : 'completed';
      publish(true);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        phase = 'cancelled';
        queuedTiles = 0;
        for (const layer of layers.values()) layer.queuedTiles = 0;
        publish(true);
      }
      await this.checkpointTail;
      for (const generation of pendingGenerations) {
        generation.status = 'failed';
        generation.updatedAt = this.dependencies.now();
        await this.dependencies.setGeneration(generation).catch(() => {});
        this.trackCleanup(this.dependencies.releaseGeneration(generation.id));
      }
      throw error;
    }
  }

  private async resolvePlan(
    request: OfflineMapSyncRequest,
    signal: AbortSignal,
    onTotalLocked: (coordinateCount: number) => void,
  ): Promise<OfflineMapPlanRecord> {
    if (request.mode === 'reuse-active-plan') {
      const reference = (await this.dependencies.getGenerations()).find((generation) => (
        generation.layerId === request.referenceLayerId
        && generation.status === 'active'
      ));
      const reused = reference
        ? await this.dependencies.getPlanById(reference.planId)
        : null;
      if (!reused || !this.isValidPlanManifest(reused)) {
        const error = new Error('No reusable active offline-map plan is available');
        error.name = 'OfflineMapPlanUnavailableError';
        throw error;
      }
      onTotalLocked(reused.coordinateCount);
      return reused;
    }

    const existing = await this.dependencies.getPlan(request.plan.sourceRevision);
    if (existing && this.isValidPlanManifest(existing)) {
      onTotalLocked(existing.coordinateCount);
      return existing;
    }
    if (existing) await this.dependencies.deletePlan(existing.id);

    const buildSuffix = `${this.dependencies.now()}:${this.sessionCounter++}`;
    const planId = `offline-plan:${COVERAGE_VERSION}:${request.plan.sourceRevision}:${buildSuffix}`;
    let chunkCount = 0;
    try {
      await this.dependencies.deletePlanChunks(planId);
      const coordinateCount = await this.dependencies.plan(
        request.plan,
        async (coordinates, index) => {
          throwIfAborted(signal);
          if (index !== chunkCount) {
            throw new Error(`Offline-map planner returned out-of-order chunk ${index}`);
          }
          await this.dependencies.putPlanChunk({ planId, index, coordinates });
          chunkCount += 1;
        },
        signal,
      );
      throwIfAborted(signal);
      if (chunkCount !== Math.ceil(coordinateCount / 2_048)) {
        throw new Error('Offline-map planner returned an inconsistent coordinate count');
      }
      onTotalLocked(coordinateCount);
      const plan: OfflineMapPlanRecord = {
        id: planId,
        sourceRevision: request.plan.sourceRevision,
        coverageVersion: COVERAGE_VERSION,
        coordinateCount,
        chunkCount,
        createdAt: this.dependencies.now(),
      };
      try {
        await this.dependencies.commitPlan(plan);
      } catch (error) {
        const winner = await this.dependencies.getPlan(request.plan.sourceRevision);
        if (winner && this.isValidPlanManifest(winner)) {
          await this.dependencies.deletePlanChunks(planId).catch(() => {});
          return winner;
        }
        throw error;
      }
      return plan;
    } catch (error) {
      await this.dependencies.deletePlanChunks(planId).catch(() => {});
      throw error;
    }
  }

  private isValidPlanManifest(plan: OfflineMapPlanRecord): boolean {
    return plan.coverageVersion === COVERAGE_VERSION
      && Number.isSafeInteger(plan.coordinateCount)
      && plan.coordinateCount >= 0
      && Number.isSafeInteger(plan.chunkCount)
      && plan.chunkCount === Math.ceil(plan.coordinateCount / 2_048);
  }

  private checkpoint(
    generations: OfflineMapGenerationRecord[],
    layers: Map<string, MutableLayerProgress>,
    immediate = false,
  ): void {
    if (
      !immediate
      && this.dependencies.now() - this.lastCheckpointAt < CHECKPOINT_INTERVAL_MS
    ) return;
    this.lastCheckpointAt = this.dependencies.now();
    void this.writeCheckpoint(generations, layers, false);
  }

  private writeCheckpoint(
    generations: OfflineMapGenerationRecord[],
    layers: Map<string, MutableLayerProgress>,
    force: boolean,
  ): Promise<void> {
    const snapshots = generations.map((generation) => {
      const layer = layers.get(generation.layerId)!;
      return {
        ...generation,
        completedTiles: boundedProgress(layer.completedTiles, layer.totalTiles),
        failedTiles: boundedProgress(
          layer.failedTiles,
          layer.totalTiles - boundedProgress(layer.completedTiles, layer.totalTiles),
        ),
        bytesDownloaded: layer.bytesDownloaded,
        updatedAt: this.dependencies.now(),
      };
    });
    const persist = async () => {
      await Promise.all(snapshots.map((snapshot) => this.dependencies.setGeneration(snapshot)));
    };
    const result = this.checkpointTail.then(persist, persist);
    this.checkpointTail = result.catch(() => {});
    return force ? result : Promise.resolve();
  }

  private publishCoverageSnapshot(): void {
    const generations = [...this.activeCoverage.values()];
    if (generations.length === 0) {
      this.dependencies.store.publish({
        ...EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
        cacheBytes: this.cacheBytes,
      }, true);
      return;
    }
    const coordinateCount = Math.max(...generations.map((generation) => generation.totalTiles));
    const layers: OfflineMapLayerProgress[] = generations.map((generation) => ({
      layerId: generation.layerId,
      totalTiles: generation.totalTiles,
      completedTiles: boundedProgress(generation.completedTiles, generation.totalTiles),
      failedTiles: boundedProgress(
        generation.failedTiles,
        generation.totalTiles - boundedProgress(
          generation.completedTiles,
          generation.totalTiles,
        ),
      ),
      cachedFreshTiles: boundedProgress(generation.completedTiles, generation.totalTiles),
      auditedTiles: boundedProgress(generation.completedTiles, generation.totalTiles),
      queuedTiles: 0,
      downloadedTiles: 0,
      bytesDownloaded: 0,
      usableTiles: boundedProgress(generation.completedTiles, generation.totalTiles),
    }));
    const completedTiles = layers.reduce((sum, layer) => sum + layer.completedTiles, 0);
    const totalTiles = layers.reduce((sum, layer) => sum + layer.totalTiles, 0);
    this.dependencies.store.publish({
      ...EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
      coordinateCount,
      enabledLayerCount: layers.length,
      totalTiles,
      completedTiles,
      cachedFreshTiles: completedTiles,
      auditedTiles: completedTiles,
      cacheBytes: this.cacheBytes,
      coverageTotalTiles: totalTiles,
      coverageCompletedTiles: completedTiles,
      layers,
    }, true);
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = this.dependencies.migrate().catch((error) => {
        this.migrationPromise = null;
        throw error;
      });
    }
    await this.migrationPromise;
  }

  private trackCleanup(operation: Promise<void>): void {
    const tracked = operation
      .catch((error) => {
        console.warn('Offline-map cleanup will be retried after restart:', error);
      })
      .finally(() => this.cleanupOperations.delete(tracked));
    this.cleanupOperations.add(tracked);
  }
}
