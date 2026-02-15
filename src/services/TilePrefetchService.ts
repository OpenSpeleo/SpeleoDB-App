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
} from '../types/tilePrefetch';

// ==================== Constants ====================

const MAX_MERCATOR_LAT = 85.05112878;
const MIN_MERCATOR_LAT = -85.05112878;
const METERS_PER_DEGREE_LAT = 111_320;
const DEFAULT_ESTIMATED_TILE_BYTES = 45_000;
const RETRY_DELAYS_MS = [500, 1_500, 3_500];

// ==================== Types ====================

interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface Bounds {
  west: number;
  east: number;
  south: number;
  north: number;
  crossesDateline: boolean;
  fullWorld: boolean;
}

interface QueueEntry {
  url: string;
  projectCommits: Map<string, string>;
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

const defaultDeps: TilePrefetchDependencies = {
  hasCachedTile: defaultHasCachedTile,
  fetchAndCacheTile: (url: string) => defaultFetchAndCachePinnedTile(url),
  getAllPrefetchJobs: defaultGetAllPrefetchJobs,
  setPrefetchJob: defaultSetPrefetchJob,
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// ==================== Geometry helpers ====================

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toDateline360(lng: number): number {
  return ((lng + 180) % 360 + 360) % 360;
}

function wrap360(value: number): number {
  return ((value % 360) + 360) % 360;
}

function fromDateline360(value: number): number {
  let normalized = value - 180;
  while (normalized < -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
}

function metersToLatitudeDegrees(meters: number): number {
  return meters / METERS_PER_DEGREE_LAT;
}

function metersToLongitudeDegrees(meters: number, latitude: number): number {
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const safeCos = Math.max(Math.abs(cosLat), 1e-6);
  return meters / (METERS_PER_DEGREE_LAT * safeCos);
}

function visitCoords(
  geometry: GeoJSON.Geometry,
  fn: (lng: number, lat: number) => void,
): void {
  switch (geometry.type) {
    case 'Point':
      fn(geometry.coordinates[0], geometry.coordinates[1]);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const c of geometry.coordinates) fn(c[0], c[1]);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates) {
        for (const c of ring) fn(c[0], c[1]);
      }
      break;
    case 'MultiPolygon':
      for (const poly of geometry.coordinates) {
        for (const ring of poly) {
          for (const c of ring) fn(c[0], c[1]);
        }
      }
      break;
    case 'GeometryCollection':
      for (const child of geometry.geometries) visitCoords(child, fn);
      break;
  }
}

function shortestLongitudeInterval(longitudes: number[]): {
  west: number;
  east: number;
  crossesDateline: boolean;
} {
  if (longitudes.length === 1) {
    const value = longitudes[0];
    return { west: value, east: value, crossesDateline: false };
  }

  const normalized = longitudes.map(toDateline360).sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const next = i === normalized.length - 1 ? normalized[0] + 360 : normalized[i + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = i;
    }
  }

  const start = normalized[(gapIndex + 1) % normalized.length];
  const end = normalized[gapIndex];
  const west = fromDateline360(start);
  const east = fromDateline360(end);
  const crossesDateline = start > end;

  return { west, east, crossesDateline };
}

function expandLongitudeInterval(
  west: number,
  east: number,
  padDegrees: number,
): { west: number; east: number; crossesDateline: boolean; fullWorld: boolean } {
  const start = toDateline360(west);
  let end = toDateline360(east);
  if (end <= start) end += 360;

  const expandedStart = start - padDegrees;
  const expandedEnd = end + padDegrees;
  if (expandedEnd - expandedStart >= 360) {
    return { west: -180, east: 180, crossesDateline: false, fullWorld: true };
  }

  const wrappedStart = wrap360(expandedStart);
  const wrappedEnd = wrap360(expandedEnd);
  const crossesDateline = wrappedStart > wrappedEnd;

  return {
    west: fromDateline360(wrappedStart),
    east: fromDateline360(wrappedEnd),
    crossesDateline,
    fullWorld: false,
  };
}

export function computePaddedBounds(
  featureCollection: GeoJSON.FeatureCollection,
  padMeters: number,
): Bounds | null {
  const longitudes: number[] = [];
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of featureCollection.features) {
    if (!feature.geometry) continue;
    visitCoords(feature.geometry, (lng: number, lat: number) => {
      longitudes.push(lng);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  }

  if (longitudes.length === 0 || minLat === Infinity || maxLat === -Infinity) {
    return null;
  }

  const lngInterval = shortestLongitudeInterval(longitudes);
  const latPad = metersToLatitudeDegrees(padMeters);
  const south = clamp(minLat - latPad, MIN_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const north = clamp(maxLat + latPad, MIN_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const centerLat = (south + north) / 2;
  const lngPad = metersToLongitudeDegrees(padMeters, centerLat);
  const expandedLng = expandLongitudeInterval(lngInterval.west, lngInterval.east, lngPad);

  return {
    west: expandedLng.west,
    east: expandedLng.east,
    south,
    north,
    crossesDateline: expandedLng.crossesDateline,
    fullWorld: expandedLng.fullWorld,
  };
}

function longitudeToTileX(lng: number, zoom: number): number {
  const tilesPerAxis = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * tilesPerAxis);
  return clamp(x, 0, tilesPerAxis - 1);
}

function latitudeToTileY(lat: number, zoom: number): number {
  const clampedLat = clamp(lat, MIN_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const rad = (clampedLat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  const tilesPerAxis = 2 ** zoom;
  const y = Math.floor((1 - mercN / Math.PI) / 2 * tilesPerAxis);
  return clamp(y, 0, tilesPerAxis - 1);
}

function tileRangesForZoom(bounds: Bounds, zoom: number): TileRange[] {
  const tilesPerAxis = 2 ** zoom;
  const yMin = latitudeToTileY(bounds.north, zoom);
  const yMax = latitudeToTileY(bounds.south, zoom);
  const safeYMin = Math.min(yMin, yMax);
  const safeYMax = Math.max(yMin, yMax);

  if (bounds.fullWorld) {
    return [{ xMin: 0, xMax: tilesPerAxis - 1, yMin: safeYMin, yMax: safeYMax }];
  }

  if (!bounds.crossesDateline) {
    const xMin = longitudeToTileX(bounds.west, zoom);
    const xMax = longitudeToTileX(bounds.east, zoom);
    return [
      {
        xMin: Math.min(xMin, xMax),
        xMax: Math.max(xMin, xMax),
        yMin: safeYMin,
        yMax: safeYMax,
      },
    ];
  }

  const firstXMin = longitudeToTileX(bounds.west, zoom);
  const secondXMax = longitudeToTileX(bounds.east, zoom);
  return [
    { xMin: firstXMin, xMax: tilesPerAxis - 1, yMin: safeYMin, yMax: safeYMax },
    { xMin: 0, xMax: secondXMax, yMin: safeYMin, yMax: safeYMax },
  ];
}

function applyTileTemplate(
  template: string,
  zoom: number,
  x: number,
  y: number,
): string {
  return template
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

export function buildTileUrlsForFeatureCollection(
  featureCollection: GeoJSON.FeatureCollection,
  request: TilePrefetchRequest,
): string[] {
  const bounds = computePaddedBounds(featureCollection, request.padMeters);
  if (!bounds) return [];

  const urls: string[] = [];
  for (let zoom = request.minZoom; zoom <= request.maxZoom; zoom += 1) {
    const ranges = tileRangesForZoom(bounds, zoom);
    for (const range of ranges) {
      for (let x = range.xMin; x <= range.xMax; x += 1) {
        for (let y = range.yMin; y <= range.yMax; y += 1) {
          urls.push(applyTileTemplate(request.tileUrlTemplate, zoom, x, y));
        }
      }
    }
  }

  return urls;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Map prefetch failed';
}

// ==================== Service ====================

export class TilePrefetchService {
  private deps: TilePrefetchDependencies;
  private listeners = new Set<JobsListener>();
  private jobsByProject = new Map<string, TilePrefetchJobState>();
  private cachePresence = new Map<string, boolean>();
  private queue: QueueEntry[] = [];
  private queueByUrl = new Map<string, QueueEntry>();
  private readyPromise: Promise<void>;
  private runningPromise: Promise<void> | null = null;
  private destroyed = false;
  private readonly onlineListener: () => void;

  constructor(customDeps: Partial<TilePrefetchDependencies> = {}) {
    this.deps = { ...defaultDeps, ...customDeps };
    this.onlineListener = () => {
      void this.resumePausedJobs();
    };
    this.readyPromise = this.bootstrap();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineListener);
    }
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineListener);
    }
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
  ): Promise<void> {
    await this.readyPromise;
    if (this.destroyed || projects.length === 0) return;

    for (const project of projects) {
      if (this.destroyed) return;
      await this.enqueueProject(project, request);
    }

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
  ): Promise<void> {
    const existing = this.jobsByProject.get(project.projectId);
    if (
      existing &&
      existing.commitId === project.commitId &&
      existing.status === 'done'
    ) {
      return;
    }

    const allUrls = buildTileUrlsForFeatureCollection(project.geojson, request);
    const uniqueUrls = Array.from(new Set(allUrls));

    if (uniqueUrls.length === 0) {
      const doneJob = this.buildBaseJob(project, request, 0);
      doneJob.status = 'done';
      await this.upsertJob(doneJob);
      return;
    }

    const uncachedUrls: string[] = [];
    let completedTiles = 0;

    for (const url of uniqueUrls) {
      const cached = await this.checkTileCache(url);
      if (cached) {
        completedTiles += 1;
      } else {
        uncachedUrls.push(url);
      }
    }

    const estimatedBytes = uncachedUrls.length * DEFAULT_ESTIMATED_TILE_BYTES;
    const job = this.buildBaseJob(project, request, uniqueUrls.length);
    job.completedTiles = completedTiles;
    job.estimatedBytes = estimatedBytes;
    job.status = completedTiles >= uniqueUrls.length ? 'done' : 'queued';
    await this.upsertJob(job);

    for (const url of uncachedUrls) {
      this.queueUrl(url, project.projectId, project.commitId);
    }
  }

  private buildBaseJob(
    project: TilePrefetchProjectInput,
    request: TilePrefetchRequest,
    totalTiles: number,
  ): TilePrefetchJobState {
    return {
      projectId: project.projectId,
      commitId: project.commitId,
      status: 'queued',
      zoomMin: request.minZoom,
      zoomMax: request.maxZoom,
      padMeters: request.padMeters,
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
  ): Promise<{ success: true; bytes: number } | { success: false; message: string }> {
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

  private async resumePausedJobs(): Promise<void> {
    if (this.destroyed) return;
    const writes: Promise<void>[] = [];
    for (const job of this.jobsByProject.values()) {
      if (job.status === 'paused') {
        const processed = job.completedTiles + job.failedTiles;
        job.status = processed >= job.totalTiles ? (job.failedTiles > 0 ? 'error' : 'done') : 'queued';
        job.updatedAt = this.deps.now();
        writes.push(this.persistJob(job));
      }
    }
    await Promise.all(writes);
    this.notify();
    this.startProcessing();
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

  private async checkTileCache(url: string): Promise<boolean> {
    if (this.destroyed) return false;
    const known = this.cachePresence.get(url);
    if (known !== undefined) return known;
    const cached = await this.deps.hasCachedTile(url);
    if (this.destroyed) return false;
    this.cachePresence.set(url, cached);
    return cached;
  }

  private async upsertJob(job: TilePrefetchJobState): Promise<void> {
    if (this.destroyed) return;
    job.updatedAt = this.deps.now();
    this.jobsByProject.set(job.projectId, job);
    await this.persistJob(job);
  }

  private async persistJob(job: TilePrefetchJobState): Promise<void> {
    if (this.destroyed) return;
    try {
      await this.deps.setPrefetchJob(job);
    } catch {
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
