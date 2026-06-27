import {
  deletePrefetchJobsByLayer as defaultDeletePrefetchJobsByLayer,
  deletePrefetchJobsByTarget as defaultDeletePrefetchJobsByTarget,
  fetchAndCachePinnedTile as defaultFetchAndCachePinnedTile,
  getAllPrefetchJobs as defaultGetAllPrefetchJobs,
  hasCachedTile as defaultHasCachedTile,
  setPrefetchJob as defaultSetPrefetchJob,
} from './TileCacheService';
import { DEFAULT_MAP_LAYER_ID } from '../constants';
import type {
  TilePrefetchEnqueueOptions,
  TilePrefetchJobState,
  TilePrefetchProjectInput,
  TilePrefetchRemoveOptions,
  TilePrefetchRequest,
  TilePrefetchStatus,
  TilePrefetchTileUrlsInput,
} from '../types/tilePrefetch';
import { isAbortError, throwIfAborted } from '../utils/abort';
import { getMapLayerById } from './MapLayersService';
import { prefetchJobKey } from './tileCache/TileCacheRepository';
import { buildTileUrlsForProjectBounds } from './tilePrefetchPlanner';

// Re-export the geometry/URL collectors from their dedicated planner module so
// existing importers (and tests) can keep importing them from here.
export {
  buildTileUrlsForProjectBounds,
  buildTileUrlsForPoints,
  computeTilePrefetchSignature,
  extractPointCoordinates,
} from './tilePrefetchPlanner';

// ==================== Constants ====================

const DEFAULT_ESTIMATED_TILE_BYTES = 45_000;
const RETRY_DELAYS_MS = [500, 1_500, 3_500];

// ==================== Types ====================

interface QueueEntry {
  url: string;
  /** Owners are generation-bound so removal invalidates every stale await. */
  owners: Map<string, JobOwner>;
}

interface JobMeta {
  zoomMin: number;
  zoomMax: number;
  padMeters: number;
}

interface JobOwner {
  targetId: string;
  commitId: string;
  generation: number;
}

export interface TilePrefetchDependencies {
  hasCachedTile: (url: string) => Promise<boolean>;
  fetchAndCacheTile: (url: string, signal?: AbortSignal) => Promise<number>;
  getAllPrefetchJobs: () => Promise<TilePrefetchJobState[]>;
  setPrefetchJob: (job: TilePrefetchJobState) => Promise<void>;
  deletePrefetchJobsByLayer: (layerId: string) => Promise<void>;
  deletePrefetchJobsByTarget: (targetId: string) => Promise<void>;
  isOnline: () => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

type JobsListener = (jobs: TilePrefetchJobState[]) => void;

type PrefetchOperationOptions = TilePrefetchEnqueueOptions;

export interface TilePrefetchServiceLike {
  subscribe(listener: (jobs: TilePrefetchJobState[]) => void): () => void
  preload?(): Promise<void>
  enqueueProjects(
    projects: TilePrefetchProjectInput[],
    request: TilePrefetchRequest,
    options?: TilePrefetchEnqueueOptions,
  ): Promise<void>
  enqueueTileUrls(
    target: TilePrefetchTileUrlsInput,
    options?: TilePrefetchEnqueueOptions,
  ): Promise<void>
  removeLayer(layerId: string): Promise<void>
  removeTarget(targetId: string, options?: TilePrefetchRemoveOptions): Promise<void>
  resumeBlockedJobs(): void
  waitForIdle(): Promise<void>
  dispose(): void
}

const defaultDeps: TilePrefetchDependencies = {
  hasCachedTile: defaultHasCachedTile,
  fetchAndCacheTile: (url, signal) => defaultFetchAndCachePinnedTile(url, signal),
  getAllPrefetchJobs: defaultGetAllPrefetchJobs,
  setPrefetchJob: defaultSetPrefetchJob,
  deletePrefetchJobsByLayer: defaultDeletePrefetchJobsByLayer,
  deletePrefetchJobsByTarget: defaultDeletePrefetchJobsByTarget,
  // Runtime should inject the app-level network gate.
  isOnline: () => true,
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Map prefetch failed';
}

/**
 * True when the error is the cache-capacity error raised by the tile cache when
 * pinned tiles prevent eviction. Detected by name to avoid coupling the service
 * to the maintenance module.
 */
function isTileCacheCapacityError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: string }).name === 'TileCacheCapacityError',
  );
}

// ==================== Service ====================

export class TilePrefetchService implements TilePrefetchServiceLike {
  private deps: TilePrefetchDependencies;
  private listeners = new Set<JobsListener>();
  // Keyed by composite job key (`${layerId}::${targetId}`) so the same target
  // (project / landmarks) can have independent jobs per tile layer.
  private jobsByKey = new Map<string, TilePrefetchJobState>();
  private jobOwnersByKey = new Map<string, JobOwner>();
  /**
   * Monotonic target tombstones. Incrementing is removeTarget's in-memory
   * linearization point; work carrying an older generation can no longer
   * publish state or persistence writes.
   */
  private targetGenerations = new Map<string, number>();
  private cachePresence = new Map<string, boolean>();
  private queue: QueueEntry[] = [];
  private queueByUrl = new Map<string, QueueEntry>();
  private readyPromise: Promise<void>;
  private runningPromise: Promise<void> | null = null;
  private activeEntry: QueueEntry | null = null;
  private activeEntryAcceptsOwners = false;
  private activeDownloadController: AbortController | null = null;
  /** Serialize job-store writes/deletes so a target delete cannot be overtaken. */
  private persistenceTail: Promise<void> = Promise.resolve();
  private destroyed = false;
  // When true, processing is halted because a write hit the cache cap and pinned
  // tiles cannot be evicted. Cleared by resumeBlockedJobs() after user consent.
  private storageBlocked = false;

  constructor(customDeps: Partial<TilePrefetchDependencies> = {}) {
    this.deps = { ...defaultDeps, ...customDeps };
    this.readyPromise = this.bootstrap();
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.activeDownloadController?.abort();
    this.activeDownloadController = null;
    this.activeEntry = null;
    this.activeEntryAcceptsOwners = false;
    this.queue = [];
    this.queueByUrl.clear();
    this.cachePresence.clear();
    this.jobsByKey.clear();
    this.jobOwnersByKey.clear();
    this.targetGenerations.clear();
    this.notify();
    this.listeners.clear();
  }

  private keyForJob(job: TilePrefetchJobState): string {
    return prefetchJobKey(job.layerId, job.projectId);
  }

  subscribe(listener: JobsListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): TilePrefetchJobState[] {
    return this.snapshot();
  }

  async enqueueProjects(
    projects: TilePrefetchProjectInput[],
    request: TilePrefetchRequest,
    options: PrefetchOperationOptions = {},
  ): Promise<void> {
    await this.readyPromise;
    throwIfAborted(options.signal)
    if (this.destroyed || projects.length === 0) return;

    const layerId = options.layerId ?? DEFAULT_MAP_LAYER_ID;
    for (const project of projects) {
      throwIfAborted(options.signal)
      if (this.destroyed) return;
      await this.enqueueProject(layerId, project, request, options);
    }

    throwIfAborted(options.signal)
    this.notify();
    this.startProcessing();
  }

  /**
   * Enqueue a prefetch job from a precomputed list of tile URLs (e.g. the
   * combined landmarks job). Shares the same queue, dedupe, persistence, and
   * download path as project prefetch.
   */
  async enqueueTileUrls(
    target: TilePrefetchTileUrlsInput,
    options: PrefetchOperationOptions = {},
  ): Promise<void> {
    await this.readyPromise;
    throwIfAborted(options.signal)
    if (this.destroyed) return;

    const layerId = options.layerId ?? DEFAULT_MAP_LAYER_ID;
    await this.enqueueJobWithUrls(
      layerId,
      target.id,
      target.commitId,
      {
        zoomMin: target.zoomMin,
        zoomMax: target.zoomMax,
        padMeters: target.padMeters,
      },
      target.tileUrls,
      options,
    );

    throwIfAborted(options.signal)
    this.notify();
    this.startProcessing();
  }

  /**
   * Remove all in-memory + persisted jobs for a layer and drop its queued
   * tiles. Used when a layer's offline sync is turned off. A tile shared with
   * another still-enabled layer is impossible here (URLs are per-layer), so
   * pruning by job key is sufficient.
   */
  async removeLayer(layerId: string): Promise<void> {
    await this.readyPromise;
    if (this.destroyed) return;

    const removedKeys = new Set<string>();
    for (const [key, job] of this.jobsByKey) {
      if (job.layerId === layerId) {
        this.jobsByKey.delete(key);
        this.jobOwnersByKey.delete(key);
        removedKeys.add(key);
      }
    }

    if (removedKeys.size > 0) {
      if (this.activeEntry) {
        for (const key of removedKeys) this.activeEntry.owners.delete(key);
        if (this.activeEntry.owners.size === 0) this.activeDownloadController?.abort();
      }
      const remaining: QueueEntry[] = [];
      for (const entry of this.queue) {
        for (const key of removedKeys) {
          entry.owners.delete(key);
        }
        if (entry.owners.size > 0) {
          remaining.push(entry);
        } else {
          this.queueByUrl.delete(entry.url);
        }
      }
      this.queue = remaining;
    }

    // Drop the in-memory cache-presence hints for this layer's tiles. The
    // controller evicts the layer's tiles from IndexedDB when sync is turned
    // off, so leaving stale `true` entries here would make a same-session
    // re-enable treat every tile as already cached (job auto-"done", zero
    // downloads, blank offline map). Prune by the layer's tile-URL prefix.
    const layer = getMapLayerById(layerId);
    const prefix = layer?.tileUrlTemplate.split('{z}')[0];
    if (prefix) {
      for (const url of this.cachePresence.keys()) {
        if (url.startsWith(prefix)) this.cachePresence.delete(url);
      }
    } else {
      // Unknown layer id: fall back to a full clear (correctness over speed;
      // entries are cheaply rebuilt from IndexedDB on the next enqueue).
      this.cachePresence.clear();
    }

    try {
      await this.deps.deletePrefetchJobsByLayer(layerId);
    } catch {
      // Persistence cleanup is best-effort; in-memory state is authoritative.
    }
    this.notify();
  }

  /**
   * Remove a project target across every layer. Shared queued/in-flight URLs
   * remain alive for their other owners; solely-owned in-flight work aborts.
   */
  async removeTarget(
    targetId: string,
    options: TilePrefetchRemoveOptions = {},
  ): Promise<void> {
    await this.readyPromise;
    throwIfAborted(options.signal);
    if (this.destroyed) return;

    const removedGeneration = this.currentTargetGeneration(targetId);
    this.targetGenerations.set(targetId, removedGeneration + 1);

    for (const [key, job] of this.jobsByKey) {
      const owner = this.jobOwnersByKey.get(key);
      if (
        job.projectId === targetId
        && (!owner || owner.generation <= removedGeneration)
      ) {
        this.jobsByKey.delete(key);
        this.jobOwnersByKey.delete(key);
      }
    }

    if (this.activeEntry) {
      this.removeOwnersForTarget(this.activeEntry, targetId, removedGeneration);
      if (this.activeEntry.owners.size === 0) {
        this.activeDownloadController?.abort();
      }
    }

    const remaining: QueueEntry[] = [];
    for (const entry of this.queue) {
      this.removeOwnersForTarget(entry, targetId, removedGeneration);
      if (entry.owners.size > 0) remaining.push(entry);
      else this.queueByUrl.delete(entry.url);
    }
    this.queue = remaining;
    this.notify();

    try {
      await this.serializePersistence(() => this.deps.deletePrefetchJobsByTarget(targetId));
    } catch (error) {
      // The generation tombstone keeps this runtime fail-closed even when the
      // durable cleanup fails. Surface the failure for diagnostics/recovery.
      console.error(`TilePrefetchService.removeTarget(${targetId}) failed:`, error);
    }
    throwIfAborted(options.signal);
  }

  async waitForIdle(): Promise<void> {
    await this.readyPromise;
    while (this.runningPromise) {
      await this.runningPromise;
    }
    // `resumeBlockedJobs` intentionally schedules best-effort persistence in
    // the background. Teardown callers use this barrier before clearing the
    // database, so include those serialized writes as well as network work.
    await this.persistenceTail;
  }

  private async bootstrap(): Promise<void> {
    if (this.destroyed) return;
    try {
      const jobs = await this.deps.getAllPrefetchJobs();
      if (this.destroyed) return;
      for (const job of jobs) {
        const key = this.keyForJob(job);
        this.jobsByKey.set(key, job);
        this.jobOwnersByKey.set(key, {
          targetId: job.projectId,
          commitId: job.commitId,
          generation: this.currentTargetGeneration(job.projectId),
        });
      }
      this.notify();
    } catch {
      // The feature remains operational without persisted progress.
    }
  }

  private async enqueueProject(
    layerId: string,
    project: TilePrefetchProjectInput,
    request: TilePrefetchRequest,
    options: PrefetchOperationOptions = {},
  ): Promise<void> {
    const generation = this.currentTargetGeneration(project.projectId);
    const urls = buildTileUrlsForProjectBounds(project.bounds, request);
    await this.enqueueJobWithUrls(
      layerId,
      project.projectId,
      project.commitId,
      {
        zoomMin: request.minZoom,
        zoomMax: request.maxZoom,
        padMeters: request.padMeters,
      },
      urls,
      options,
      generation,
    );
  }

  /**
   * Shared queueing path for any prefetch target (projects or landmarks). Given
   * a target id + commit + a precomputed list of tile URLs, it dedupes, counts
   * already-cached tiles, persists the job, and queues the uncached URLs.
   */
  private async enqueueJobWithUrls(
    layerId: string,
    id: string,
    commitId: string,
    meta: JobMeta,
    urls: string[],
    options: PrefetchOperationOptions = {},
    generation = this.currentTargetGeneration(id),
  ): Promise<void> {
    throwIfAborted(options.signal)
    if (!this.isTargetGenerationCurrent(id, generation)) return;
    const jobKey = prefetchJobKey(layerId, id);
    const existing = this.jobsByKey.get(jobKey);
    if (existing && existing.commitId === commitId && existing.status === 'done') {
      return;
    }

    const uniqueUrls = Array.from(new Set(urls));

    if (uniqueUrls.length === 0) {
      const doneJob = this.buildBaseJob(layerId, id, commitId, meta, 0);
      doneJob.status = 'done';
      await this.upsertJob(doneJob, generation, options.signal);
      return;
    }

    const uncachedUrls: string[] = [];
    let completedTiles = 0;

    for (const url of uniqueUrls) {
      throwIfAborted(options.signal)
      if (!this.isTargetGenerationCurrent(id, generation)) return;
      const cached = await this.checkTileCache(url, options.signal);
      if (!this.isTargetGenerationCurrent(id, generation)) return;
      if (cached) {
        completedTiles += 1;
      } else {
        uncachedUrls.push(url);
      }
    }

    const estimatedBytes = uncachedUrls.length * DEFAULT_ESTIMATED_TILE_BYTES;
    const job = this.buildBaseJob(layerId, id, commitId, meta, uniqueUrls.length);
    job.completedTiles = completedTiles;
    job.estimatedBytes = estimatedBytes;
    job.status = completedTiles >= uniqueUrls.length ? 'done' : 'queued';
    const published = await this.upsertJob(job, generation, options.signal);
    if (!published) return;
    const owner = this.jobOwnersByKey.get(jobKey);
    if (!owner) return;

    for (const url of uncachedUrls) {
      throwIfAborted(options.signal)
      if (!this.isTargetGenerationCurrent(id, generation)) return;
      this.queueUrl(url, jobKey, owner);
    }
  }

  private buildBaseJob(
    layerId: string,
    id: string,
    commitId: string,
    meta: JobMeta,
    totalTiles: number,
  ): TilePrefetchJobState {
    return {
      layerId,
      projectId: id,
      commitId,
      status: 'queued',
      zoomMin: meta.zoomMin,
      zoomMax: meta.zoomMax,
      padMeters: meta.padMeters,
      totalTiles,
      completedTiles: 0,
      failedTiles: 0,
      bytesDownloaded: 0,
      estimatedBytes: 0,
      updatedAt: this.deps.now(),
    };
  }

  private queueUrl(url: string, jobKey: string, owner: JobOwner): void {
    if (
      this.activeEntryAcceptsOwners
      && !this.activeDownloadController?.signal.aborted
      && this.activeEntry?.url === url
    ) {
      this.activeEntry.owners.set(jobKey, owner);
      return;
    }

    const entry = this.queueByUrl.get(url);
    if (entry) {
      entry.owners.set(jobKey, owner);
      return;
    }

    const nextEntry: QueueEntry = {
      url,
      owners: new Map([[jobKey, owner]]),
    };
    this.queueByUrl.set(url, nextEntry);
    this.queue.push(nextEntry);
  }

  private startProcessing(): void {
    if (this.runningPromise || this.destroyed) return;
    if (this.storageBlocked) return;
    if (!this.deps.isOnline() || this.queue.length === 0) return;

    this.runningPromise = this.processQueue().finally(() => {
      this.runningPromise = null;
      if (!this.destroyed && this.queue.length > 0 && this.deps.isOnline()) {
        this.startProcessing();
      }
    });
  }

  private async processQueue(): Promise<void> {
    while (!this.destroyed && this.queue.length > 0) {
      if (!this.deps.isOnline()) {
        await this.pausePendingJobs();
        return;
      }

      const entry = this.queue.shift();
      if (!entry) continue;
      this.queueByUrl.delete(entry.url);
      if (this.destroyed) return;
      const downloadController = new AbortController();
      this.activeEntry = entry;
      this.activeEntryAcceptsOwners = true;
      this.activeDownloadController = downloadController;
      try {
        const downloadingJobs = this.resolveActiveJobKeys(entry.owners);
        if (downloadingJobs.size === 0) continue;
        await this.markJobsStatus(downloadingJobs, 'downloading');
        if (this.resolveActiveJobKeys(entry.owners).size === 0) continue;

        const result = await this.downloadWithRetry(
          entry.url,
          downloadController.signal,
          () => this.resolveActiveJobKeys(entry.owners).size > 0,
        );
        this.activeEntryAcceptsOwners = false;
        if (this.destroyed) return;
        const completionJobs = this.resolveActiveJobKeys(entry.owners);
        if (completionJobs.size === 0) {
          this.notify();
          continue;
        }
        if (result.success) {
          this.cachePresence.set(entry.url, true);
          await this.applySuccess(completionJobs, result.bytes);
        } else if (result.capacityBlocked) {
          // The write would exceed the cache cap and pinned tiles cannot be
          // evicted. Preserve this tile + the rest of the queue, flag the jobs,
          // and halt so we don't hammer writes that will all fail identically.
          this.requeueFront(entry);
          this.storageBlocked = true;
          await this.markJobsBlockedByStorage(completionJobs);
          this.notify();
          return;
        } else {
          await this.applyFailure(completionJobs, result.message);
        }
      } finally {
        if (this.activeEntry === entry) {
          this.activeEntry = null;
          this.activeEntryAcceptsOwners = false;
          this.activeDownloadController = null;
        }
      }
      this.notify();
    }
  }

  private resolveActiveJobKeys(owners: Map<string, JobOwner>): Set<string> {
    const activeJobKeys = new Set<string>();
    for (const [jobKey, owner] of owners) {
      const current = this.jobsByKey.get(jobKey);
      if (!current) continue;
      if (current.commitId !== owner.commitId) continue;
      if (!this.isOwnerCurrent(jobKey, owner)) continue;
      activeJobKeys.add(jobKey);
    }
    return activeJobKeys;
  }

  private async downloadWithRetry(
    url: string,
    signal: AbortSignal | undefined,
    hasActiveOwner: () => boolean,
  ): Promise<
    | { success: true; bytes: number }
    | { success: false; message: string; capacityBlocked?: boolean }
  > {
    if (this.destroyed) {
      return { success: false, message: 'Tile prefetch cancelled' };
    }
    if (signal?.aborted || !hasActiveOwner()) {
      return { success: false, message: 'Tile prefetch cancelled' };
    }
    try {
      if (await this.checkTileCache(url, signal)) {
        return { success: true, bytes: 0 };
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error) || !hasActiveOwner()) {
        return { success: false, message: 'Tile prefetch cancelled' };
      }
      return { success: false, message: normalizeErrorMessage(error) };
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (this.destroyed || !hasActiveOwner()) {
        return { success: false, message: 'Tile prefetch cancelled' };
      }
      try {
        const bytes = await this.deps.fetchAndCacheTile(url, signal);
        return { success: true, bytes };
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return { success: false, message: 'Tile prefetch cancelled' };
        }
        // A capacity block will not resolve by retrying; surface it immediately
        // so the queue can halt and the consent flow can prompt.
        if (isTileCacheCapacityError(error)) {
          return {
            success: false,
            message: normalizeErrorMessage(error),
            capacityBlocked: true,
          };
        }
        if (!this.deps.isOnline()) {
          return { success: false, message: 'Offline while prefetching tiles' };
        }
        if (attempt >= RETRY_DELAYS_MS.length) {
          return { success: false, message: normalizeErrorMessage(error) };
        }
        try {
          await this.sleepWithAbort(RETRY_DELAYS_MS[attempt], signal);
        } catch (sleepError) {
          if (signal?.aborted || isAbortError(sleepError) || !hasActiveOwner()) {
            return { success: false, message: 'Tile prefetch cancelled' };
          }
          return { success: false, message: normalizeErrorMessage(sleepError) };
        }
      }
    }

    return { success: false, message: 'Tile prefetch exhausted retries' };
  }

  private async applySuccess(jobKeys: Set<string>, bytes: number): Promise<void> {
    if (this.destroyed) return;
    const bytesPerJob = jobKeys.size > 0 ? Math.floor(bytes / jobKeys.size) : bytes;
    const writes: Promise<void>[] = [];
    for (const jobKey of jobKeys) {
      const current = this.jobsByKey.get(jobKey);
      if (!current) continue;

      current.completedTiles += 1;
      current.bytesDownloaded += bytesPerJob;
      current.message = undefined;
      current.blockedByStorage = false;
      current.updatedAt = this.deps.now();
      this.updateStatusFromProgress(current);
      writes.push(this.persistJob(current, undefined, this.jobOwnersByKey.get(jobKey)));
    }
    await Promise.all(writes);
  }

  private async applyFailure(jobKeys: Set<string>, message: string): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const jobKey of jobKeys) {
      const current = this.jobsByKey.get(jobKey);
      if (!current) continue;

      current.failedTiles += 1;
      current.message = message;
      current.updatedAt = this.deps.now();
      this.updateStatusFromProgress(current);
      writes.push(this.persistJob(current, undefined, this.jobOwnersByKey.get(jobKey)));
    }
    await Promise.all(writes);
  }

  private updateStatusFromProgress(job: TilePrefetchJobState): void {
    const processedTiles = job.completedTiles + job.failedTiles;
    if (processedTiles >= job.totalTiles) {
      job.status = job.failedTiles > 0 ? 'error' : 'done';
      return;
    }

    if (!this.deps.isOnline()) {
      job.status = 'paused';
      return;
    }

    job.status = 'downloading';
  }

  private requeueFront(entry: QueueEntry): void {
    if (this.queueByUrl.has(entry.url)) return;
    this.queueByUrl.set(entry.url, entry);
    this.queue.unshift(entry);
  }

  private async markJobsBlockedByStorage(jobKeys: Set<string>): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const jobKey of jobKeys) {
      const current = this.jobsByKey.get(jobKey);
      if (!current) continue;
      if (current.status === 'done') continue;
      current.blockedByStorage = true;
      current.status = 'paused';
      current.message = 'Storage limit reached';
      current.updatedAt = this.deps.now();
      writes.push(this.persistJob(current, undefined, this.jobOwnersByKey.get(jobKey)));
    }
    await Promise.all(writes);
  }

  /**
   * Resume processing after the user approves exceeding the cache cap. Clears
   * the storage-block flags and restarts the (preserved) queue.
   */
  resumeBlockedJobs(): void {
    if (this.destroyed) return;
    this.storageBlocked = false;
    for (const job of this.jobsByKey.values()) {
      if (!job.blockedByStorage) continue;
      job.blockedByStorage = false;
      if (job.status === 'paused') job.status = 'queued';
      job.updatedAt = this.deps.now();
      const jobKey = this.keyForJob(job);
      void this.persistJob(job, undefined, this.jobOwnersByKey.get(jobKey));
    }
    this.notify();
    this.startProcessing();
  }

  private async pausePendingJobs(): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const job of this.jobsByKey.values()) {
      if (job.status === 'queued' || job.status === 'downloading') {
        job.status = 'paused';
        job.updatedAt = this.deps.now();
        const jobKey = this.keyForJob(job);
        writes.push(this.persistJob(job, undefined, this.jobOwnersByKey.get(jobKey)));
      }
    }
    await Promise.all(writes);
    this.notify();
  }

  private async markJobsStatus(jobKeys: Set<string>, status: TilePrefetchStatus): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const jobKey of jobKeys) {
      const current = this.jobsByKey.get(jobKey);
      if (!current) continue;
      if (current.status === 'done' || current.status === 'error') continue;
      current.status = status;
      current.updatedAt = this.deps.now();
      writes.push(this.persistJob(current, undefined, this.jobOwnersByKey.get(jobKey)));
    }
    await Promise.all(writes);
  }

  private async checkTileCache(url: string, signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal)
    if (this.destroyed) return false;
    const known = this.cachePresence.get(url);
    if (known !== undefined) return known;
    const cached = await this.deps.hasCachedTile(url);
    throwIfAborted(signal)
    if (this.destroyed) return false;
    this.cachePresence.set(url, cached);
    return cached;
  }

  private async upsertJob(
    job: TilePrefetchJobState,
    generation: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal)
    if (this.destroyed || !this.isTargetGenerationCurrent(job.projectId, generation)) {
      return false;
    }
    job.updatedAt = this.deps.now();
    const key = this.keyForJob(job);
    const owner = { targetId: job.projectId, commitId: job.commitId, generation };
    this.jobsByKey.set(key, job);
    this.jobOwnersByKey.set(key, owner);
    await this.persistJob(job, signal, owner);
    return this.isOwnerCurrent(key, owner);
  }

  private async persistJob(
    job: TilePrefetchJobState,
    signal?: AbortSignal,
    owner?: JobOwner,
  ): Promise<void> {
    throwIfAborted(signal)
    if (this.destroyed) return;
    const key = this.keyForJob(job);
    const snapshot = { ...job };
    try {
      await this.serializePersistence(async () => {
        throwIfAborted(signal);
        if (this.destroyed) return;
        if (owner && !this.isOwnerCurrent(key, owner)) return;
        await this.deps.setPrefetchJob(snapshot);
      });
      throwIfAborted(signal)
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throwIfAborted(signal)
      }
      // Progress persistence is best-effort; runtime state still updates.
    }
  }

  private currentTargetGeneration(targetId: string): number {
    return this.targetGenerations.get(targetId) ?? 0;
  }

  private isTargetGenerationCurrent(targetId: string, generation: number): boolean {
    return !this.destroyed && this.currentTargetGeneration(targetId) === generation;
  }

  private isOwnerCurrent(jobKey: string, owner: JobOwner): boolean {
    const currentOwner = this.jobOwnersByKey.get(jobKey);
    return currentOwner === owner
      && this.isTargetGenerationCurrent(owner.targetId, owner.generation);
  }

  private removeOwnersForTarget(
    entry: QueueEntry,
    targetId: string,
    removedGeneration: number,
  ): void {
    for (const [jobKey, owner] of entry.owners) {
      if (owner.targetId === targetId && owner.generation <= removedGeneration) {
        entry.owners.delete(jobKey);
      }
    }
  }

  private serializePersistence<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.persistenceTail.then(operation, operation);
    this.persistenceTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!signal) {
      await this.deps.sleep(ms);
      return;
    }

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<void>((_resolve, reject) => {
      onAbort = () => {
        try {
          throwIfAborted(signal);
        } catch (error) {
          reject(error);
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      await Promise.race([this.deps.sleep(ms), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private snapshot(): TilePrefetchJobState[] {
    return [...this.jobsByKey.values()].sort((a, b) =>
      this.keyForJob(a).localeCompare(this.keyForJob(b)),
    );
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
