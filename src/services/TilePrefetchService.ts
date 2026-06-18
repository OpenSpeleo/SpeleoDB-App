import {
  fetchAndCachePinnedTile as defaultFetchAndCachePinnedTile,
  getAllPrefetchJobs as defaultGetAllPrefetchJobs,
  hasCachedTile as defaultHasCachedTile,
  setPrefetchJob as defaultSetPrefetchJob,
} from './TileCacheService';
import type {
  TilePrefetchJobState,
  TilePrefetchProjectInput,
  TilePrefetchRequest,
  TilePrefetchStatus,
  TilePrefetchTileUrlsInput,
} from '../types/tilePrefetch';
import { isAbortError, throwIfAborted } from '../utils/abort';
import { buildTileUrlsForFeatureCollection } from './tilePrefetchPlanner';

// Re-export the geometry/URL collectors from their dedicated planner module so
// existing importers (and tests) can keep importing them from here.
export {
  buildTileUrlsForFeatureCollection,
  buildTileUrlsForPoints,
  computePaddedBounds,
  computeTilePrefetchSignature,
  extractPointCoordinates,
} from './tilePrefetchPlanner';

// ==================== Constants ====================

const DEFAULT_ESTIMATED_TILE_BYTES = 45_000;
const RETRY_DELAYS_MS = [500, 1_500, 3_500];

// ==================== Types ====================

interface QueueEntry {
  url: string;
  projectCommits: Map<string, string>;
}

interface JobMeta {
  zoomMin: number;
  zoomMax: number;
  padMeters: number;
}

export interface TilePrefetchDependencies {
  hasCachedTile: (url: string) => Promise<boolean>;
  fetchAndCacheTile: (url: string) => Promise<number>;
  getAllPrefetchJobs: () => Promise<TilePrefetchJobState[]>;
  setPrefetchJob: (job: TilePrefetchJobState) => Promise<void>;
  isOnline: () => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

type JobsListener = (jobs: TilePrefetchJobState[]) => void;

interface PrefetchOperationOptions {
  signal?: AbortSignal
}

export interface TilePrefetchServiceLike {
  subscribe(listener: (jobs: TilePrefetchJobState[]) => void): () => void
  preload?(): Promise<void>
  enqueueProjects(
    projects: TilePrefetchProjectInput[],
    request: TilePrefetchRequest,
    options?: { signal?: AbortSignal },
  ): Promise<void>
  enqueueTileUrls(
    target: TilePrefetchTileUrlsInput,
    options?: { signal?: AbortSignal },
  ): Promise<void>
  resumeBlockedJobs(): void
  waitForIdle(): Promise<void>
  dispose(): void
}

const defaultDeps: TilePrefetchDependencies = {
  hasCachedTile: defaultHasCachedTile,
  fetchAndCacheTile: (url: string) => defaultFetchAndCachePinnedTile(url),
  getAllPrefetchJobs: defaultGetAllPrefetchJobs,
  setPrefetchJob: defaultSetPrefetchJob,
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
  private jobsByProject = new Map<string, TilePrefetchJobState>();
  private cachePresence = new Map<string, boolean>();
  private queue: QueueEntry[] = [];
  private queueByUrl = new Map<string, QueueEntry>();
  private readyPromise: Promise<void>;
  private runningPromise: Promise<void> | null = null;
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
    this.queue = [];
    this.queueByUrl.clear();
    this.cachePresence.clear();
    this.jobsByProject.clear();
    this.notify();
    this.listeners.clear();
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

    for (const project of projects) {
      throwIfAborted(options.signal)
      if (this.destroyed) return;
      await this.enqueueProject(project, request, options);
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

    await this.enqueueJobWithUrls(
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

  async waitForIdle(): Promise<void> {
    await this.readyPromise;
    while (this.runningPromise) {
      await this.runningPromise;
    }
  }

  private async bootstrap(): Promise<void> {
    if (this.destroyed) return;
    try {
      const jobs = await this.deps.getAllPrefetchJobs();
      if (this.destroyed) return;
      for (const job of jobs) {
        this.jobsByProject.set(job.projectId, job);
      }
      this.notify();
    } catch {
      // The feature remains operational without persisted progress.
    }
  }

  private async enqueueProject(
    project: TilePrefetchProjectInput,
    request: TilePrefetchRequest,
    options: PrefetchOperationOptions = {},
  ): Promise<void> {
    const urls = buildTileUrlsForFeatureCollection(project.geojson, request);
    await this.enqueueJobWithUrls(
      project.projectId,
      project.commitId,
      {
        zoomMin: request.minZoom,
        zoomMax: request.maxZoom,
        padMeters: request.padMeters,
      },
      urls,
      options,
    );
  }

  /**
   * Shared queueing path for any prefetch target (projects or landmarks). Given
   * a target id + commit + a precomputed list of tile URLs, it dedupes, counts
   * already-cached tiles, persists the job, and queues the uncached URLs.
   */
  private async enqueueJobWithUrls(
    id: string,
    commitId: string,
    meta: JobMeta,
    urls: string[],
    options: PrefetchOperationOptions = {},
  ): Promise<void> {
    throwIfAborted(options.signal)
    const existing = this.jobsByProject.get(id);
    if (existing && existing.commitId === commitId && existing.status === 'done') {
      return;
    }

    const uniqueUrls = Array.from(new Set(urls));

    if (uniqueUrls.length === 0) {
      const doneJob = this.buildBaseJob(id, commitId, meta, 0);
      doneJob.status = 'done';
      await this.upsertJob(doneJob);
      return;
    }

    const uncachedUrls: string[] = [];
    let completedTiles = 0;

    for (const url of uniqueUrls) {
      throwIfAborted(options.signal)
      const cached = await this.checkTileCache(url, options.signal);
      if (cached) {
        completedTiles += 1;
      } else {
        uncachedUrls.push(url);
      }
    }

    const estimatedBytes = uncachedUrls.length * DEFAULT_ESTIMATED_TILE_BYTES;
    const job = this.buildBaseJob(id, commitId, meta, uniqueUrls.length);
    job.completedTiles = completedTiles;
    job.estimatedBytes = estimatedBytes;
    job.status = completedTiles >= uniqueUrls.length ? 'done' : 'queued';
    await this.upsertJob(job, options.signal);

    for (const url of uncachedUrls) {
      throwIfAborted(options.signal)
      this.queueUrl(url, id, commitId);
    }
  }

  private buildBaseJob(
    id: string,
    commitId: string,
    meta: JobMeta,
    totalTiles: number,
  ): TilePrefetchJobState {
    return {
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

  private queueUrl(url: string, projectId: string, commitId: string): void {
    const entry = this.queueByUrl.get(url);
    if (entry) {
      entry.projectCommits.set(projectId, commitId);
      return;
    }

    const nextEntry: QueueEntry = {
      url,
      projectCommits: new Map([[projectId, commitId]]),
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
      const downloadingProjects = this.resolveActiveProjectIds(entry.projectCommits);
      if (downloadingProjects.size === 0) continue;
      await this.markProjectsStatus(downloadingProjects, 'downloading');

      const result = await this.downloadWithRetry(entry.url);
      if (this.destroyed) return;
      const completionProjects = this.resolveActiveProjectIds(entry.projectCommits);
      if (completionProjects.size === 0) {
        this.notify();
        continue;
      }
      if (result.success) {
        this.cachePresence.set(entry.url, true);
        await this.applySuccess(completionProjects, result.bytes);
      } else if (result.capacityBlocked) {
        // The write would exceed the cache cap and pinned tiles cannot be
        // evicted. Preserve this tile + the rest of the queue, flag the jobs,
        // and halt so we don't hammer writes that will all fail identically.
        this.requeueFront(entry);
        this.storageBlocked = true;
        await this.markJobsBlockedByStorage(completionProjects);
        this.notify();
        return;
      } else {
        await this.applyFailure(completionProjects, result.message);
      }
      this.notify();
    }
  }

  private resolveActiveProjectIds(projectCommits: Map<string, string>): Set<string> {
    const activeProjectIds = new Set<string>();
    for (const [projectId, commitId] of projectCommits) {
      const current = this.jobsByProject.get(projectId);
      if (!current) continue;
      if (current.commitId !== commitId) continue;
      activeProjectIds.add(projectId);
    }
    return activeProjectIds;
  }

  private async downloadWithRetry(
    url: string,
  ): Promise<
    | { success: true; bytes: number }
    | { success: false; message: string; capacityBlocked?: boolean }
  > {
    if (this.destroyed) {
      return { success: false, message: 'Tile prefetch cancelled' };
    }
    if (await this.checkTileCache(url)) {
      return { success: true, bytes: 0 };
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (this.destroyed) {
        return { success: false, message: 'Tile prefetch cancelled' };
      }
      try {
        const bytes = await this.deps.fetchAndCacheTile(url);
        return { success: true, bytes };
      } catch (error) {
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
        await this.deps.sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    return { success: false, message: 'Tile prefetch exhausted retries' };
  }

  private async applySuccess(projectIds: Set<string>, bytes: number): Promise<void> {
    if (this.destroyed) return;
    const bytesPerProject = projectIds.size > 0 ? Math.floor(bytes / projectIds.size) : bytes;
    const writes: Promise<void>[] = [];
    for (const projectId of projectIds) {
      const current = this.jobsByProject.get(projectId);
      if (!current) continue;

      current.completedTiles += 1;
      current.bytesDownloaded += bytesPerProject;
      current.message = undefined;
      current.blockedByStorage = false;
      current.updatedAt = this.deps.now();
      this.updateStatusFromProgress(current);
      writes.push(this.persistJob(current));
    }
    await Promise.all(writes);
  }

  private async applyFailure(projectIds: Set<string>, message: string): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const projectId of projectIds) {
      const current = this.jobsByProject.get(projectId);
      if (!current) continue;

      current.failedTiles += 1;
      current.message = message;
      current.updatedAt = this.deps.now();
      this.updateStatusFromProgress(current);
      writes.push(this.persistJob(current));
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

  private async markJobsBlockedByStorage(projectIds: Set<string>): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const projectId of projectIds) {
      const current = this.jobsByProject.get(projectId);
      if (!current) continue;
      if (current.status === 'done') continue;
      current.blockedByStorage = true;
      current.status = 'paused';
      current.message = 'Storage limit reached';
      current.updatedAt = this.deps.now();
      writes.push(this.persistJob(current));
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
    for (const job of this.jobsByProject.values()) {
      if (!job.blockedByStorage) continue;
      job.blockedByStorage = false;
      if (job.status === 'paused') job.status = 'queued';
      job.updatedAt = this.deps.now();
      void this.persistJob(job);
    }
    this.notify();
    this.startProcessing();
  }

  private async pausePendingJobs(): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const job of this.jobsByProject.values()) {
      if (job.status === 'queued' || job.status === 'downloading') {
        job.status = 'paused';
        job.updatedAt = this.deps.now();
        writes.push(this.persistJob(job));
      }
    }
    await Promise.all(writes);
    this.notify();
  }

  private async markProjectsStatus(projectIds: Set<string>, status: TilePrefetchStatus): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const projectId of projectIds) {
      const current = this.jobsByProject.get(projectId);
      if (!current) continue;
      if (current.status === 'done' || current.status === 'error') continue;
      current.status = status;
      current.updatedAt = this.deps.now();
      writes.push(this.persistJob(current));
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

  private async upsertJob(job: TilePrefetchJobState, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (this.destroyed) return;
    job.updatedAt = this.deps.now();
    this.jobsByProject.set(job.projectId, job);
    await this.persistJob(job, signal);
  }

  private async persistJob(job: TilePrefetchJobState, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (this.destroyed) return;
    try {
      await this.deps.setPrefetchJob(job);
      throwIfAborted(signal)
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throwIfAborted(signal)
      }
      // Progress persistence is best-effort; runtime state still updates.
    }
  }

  private snapshot(): TilePrefetchJobState[] {
    return [...this.jobsByProject.values()].sort((a, b) =>
      a.projectId.localeCompare(b.projectId),
    );
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
