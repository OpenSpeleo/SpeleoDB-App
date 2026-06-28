import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { GpsTrackStore } from '../services/GpsTrackStore';
import type { GpsTrackGpxFile, GpsTrackGpxService } from '../services/GpsTrackGpxService';
import type {
  GpsTrackListItem,
  GpsTrackSnapshot,
  LocalGpsTrack,
  RecordedPoint,
  RemoteGpsTrack,
} from '../types/gpsTrack';
import { gpsTrackGeoJsonToPoints } from '../utils/gpsTrackGeoJson';
import { normalizeHexColor } from '../utils/gpsTrackColors';
import { summarizeTrack } from '../utils/gpsTrackStats';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { parseRemoteGpsTrack } from '../utils/remoteGpsTrack';
import { snapshotFromRemote } from '../offline/gpsTrackSnapshot';
import { isAbortError } from '../utils/abort';
import type { OfflineMutationCoordinator } from './OfflineMutationCoordinator';

interface GpsTrackCoordinatorDependencies {
  store: GpsTrackStore;
  cache: ProjectCacheService;
  transport: Pick<SpeleoDBService, 'downloadJSON'>;
  gpx: GpsTrackGpxService;
  mutations: OfflineMutationCoordinator;
  hasNetworkAccess(): boolean;
  isSessionActive(): boolean;
  isPurging(): boolean;
  now(): number;
  notifyStateChanged(): void;
}

/** Owns local/remote GPS track state, persistence, geometry, and UI snapshots. */
export class GpsTrackCoordinator {
  private localTracks: LocalGpsTrack[] = [];
  private remoteTracks: RemoteGpsTrack[] = [];
  private trackSnapshot: GpsTrackListItem[] = [];
  private _revision = 0;
  private loadGeneration = 0;
  private persistGeneration = 0;
  private persistQueue: Promise<void> | null = null;

  constructor(private readonly dependencies: GpsTrackCoordinatorDependencies) {}

  get tracks(): GpsTrackListItem[] {
    return this.trackSnapshot;
  }

  get revision(): number {
    return this._revision;
  }

  get hasPendingPersistence(): boolean {
    return this.persistQueue !== null;
  }

  load(): Promise<void> {
    const generation = this.loadGeneration;
    const local = this.dependencies.store.list()
      .then((tracks) => {
        if (tracks.length > 0 && this.canPublishLoad(generation)) {
          this.localTracks = tracks;
          this.bump();
        }
      })
      .catch((error) => console.warn('Failed to load GPS tracks:', error));
    const remote = this.dependencies.cache.getGpsTracks()
      .then((tracks) => {
        if (tracks && tracks.length > 0 && this.canPublishLoad(generation)) {
          this.remoteTracks = tracks;
          this.bump();
        }
      })
      .catch((error) => console.warn('Failed to load cached GPS tracks:', error));
    return Promise.all([local, remote]).then(() => undefined);
  }

  localTrack(id: string): LocalGpsTrack | null {
    return this.localTracks.find((track) => track.id === id) ?? null;
  }

  remoteSnapshot(id: string): GpsTrackSnapshot | null {
    const track = this.remoteTracks.find((candidate) => candidate.id === id);
    return track ? snapshotFromRemote(track) : null;
  }

  addCompletedTrack(track: LocalGpsTrack): void {
    this.localTracks = [track, ...this.localTracks];
  }

  recordingStateChanged(): void {
    this.bump();
  }

  offlineMutationChanged(): void {
    this.bump(false);
  }

  enqueuePersist(track: LocalGpsTrack): Promise<void> {
    const run = () => this.persist(track);
    const queued = this.persistQueue ? this.persistQueue.then(run, run) : run();
    const trackedQueue = queued.finally(() => {
      if (this.persistQueue === trackedQueue) this.persistQueue = null;
    });
    this.persistQueue = trackedQueue;
    return queued;
  }

  removePersisted(id: string): Promise<void> {
    return this.dependencies.store.remove(id);
  }

  invalidatePersistence(): void {
    this.persistGeneration += 1;
  }

  async waitForPersistence(): Promise<void> {
    while (this.persistQueue) await this.persistQueue;
  }

  resetForLogout(): void {
    this.loadGeneration += 1;
    this.invalidatePersistence();
    this.localTracks = [];
    this.remoteTracks = [];
    this.bump(false);
  }

  async updateLocal(id: string, patch: Partial<LocalGpsTrack>): Promise<LocalGpsTrack | null> {
    const index = this.localTracks.findIndex((track) => track.id === id);
    if (index === -1) return null;
    const updated: LocalGpsTrack = {
      ...this.localTracks[index],
      ...patch,
      updatedAt: this.dependencies.now(),
    };
    await this.enqueuePersist(updated);
    this.localTracks = [
      ...this.localTracks.slice(0, index),
      updated,
      ...this.localTracks.slice(index + 1),
    ];
    this.bump();
    return updated;
  }

  async removeLocal(id: string): Promise<void> {
    try {
      await this.dependencies.store.remove(id);
    } catch (error) {
      console.warn('Failed to delete GPS track:', error);
    }
    const next = this.localTracks.filter((track) => track.id !== id);
    if (next.length === this.localTracks.length) return;
    this.localTracks = next;
    this.bump();
  }

  async replaceRemote(tracks: RemoteGpsTrack[]): Promise<void> {
    await this.cacheRemote(tracks);
    this.publishRemote(tracks);
  }

  async cacheRemote(tracks: RemoteGpsTrack[]): Promise<void> {
    await this.dependencies.cache.setGpsTracks(tracks);
  }

  publishRemote(tracks: RemoteGpsTrack[]): void {
    this.remoteTracks = tracks;
    this.bump();
  }

  async applyRemoteUpsert(track: RemoteGpsTrack): Promise<void> {
    const list = (await this.dependencies.cache.getGpsTracks()) ?? [];
    const index = list.findIndex((candidate) => candidate.id === track.id);
    const next = index === -1
      ? [track, ...list]
      : [...list.slice(0, index), { ...list[index], ...track }, ...list.slice(index + 1)];
    await this.dependencies.cache.setGpsTracks(next);
    this.remoteTracks = next;
    this.bump();
  }

  async applyRemoteRemoval(id: string): Promise<void> {
    const list = (await this.dependencies.cache.getGpsTracks()) ?? [];
    const next = list.filter((track) => track.id !== id);
    await this.dependencies.cache.setGpsTracks(next);
    this.remoteTracks = next;
    await this.dependencies.cache.removeGpsTrackGeoJSON(id);
    this.bump();
  }

  mergeRemote(
    id: string,
    next: GpsTrackSnapshot,
    responseData: unknown,
  ): RemoteGpsTrack {
    const parsed = parseRemoteGpsTrack(responseData);
    const existing = this.remoteTracks.find((track) => track.id === id) ?? null;
    const base: RemoteGpsTrack = existing ?? {
      id,
      name: next.name,
      color: next.color,
      fileUrl: '',
      sha256: '',
      createdAt: 0,
      updatedAt: 0,
    };
    return {
      ...base,
      id,
      name: next.name,
      color: next.color,
      fileUrl: base.fileUrl || parsed?.fileUrl || '',
      sha256: base.sha256 || parsed?.sha256 || '',
      updatedAt: parsed?.updatedAt || this.dependencies.now(),
    };
  }

  buildLocalGpx(track: LocalGpsTrack): Promise<GpsTrackGpxFile> {
    return this.dependencies.gpx.buildFile(track);
  }

  async buildGpxFile(item: GpsTrackListItem): Promise<GpsTrackGpxFile> {
    const local = this.localTrack(item.id);
    if (local) return this.buildLocalGpx(local);
    const points = await this.getPoints(item.id);
    return this.buildLocalGpx({
      id: item.id,
      name: item.name,
      color: item.color,
      points,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  async getPoints(id: string): Promise<RecordedPoint[]> {
    const local = this.localTrack(id);
    if (local) return [...local.points];
    const geojson = await this.getGeoJSON(id);
    return geojson ? gpsTrackGeoJsonToPoints(geojson) : [];
  }

  async getGeoJSON(id: string): Promise<GeoJSON.FeatureCollection | null> {
    if (this.localTrack(id)) return null;
    const cached = await this.dependencies.cache.getGpsTrackGeoJSON(id);
    if (cached) {
      const normalizedCache = normalizeGeoJSON(cached);
      if (normalizedCache) return normalizedCache;
    }
    const remote = this.remoteTracks.find((track) => track.id === id);
    if (!remote?.fileUrl || !this.dependencies.hasNetworkAccess()) return null;
    try {
      const response = await this.dependencies.transport.downloadJSON(remote.fileUrl);
      if (!isSuccessfulStatus(response.status)) return null;
      const normalized = normalizeGeoJSON(response.data);
      if (!normalized) return null;
      await this.dependencies.cache.setGpsTrackGeoJSON(id, normalized);
      return normalized;
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('Failed to download GPS track GeoJSON:', error);
      return null;
    }
  }

  private canPublishLoad(generation: number): boolean {
    return generation === this.loadGeneration &&
      this.dependencies.isSessionActive() &&
      !this.dependencies.isPurging();
  }

  private async persist(track: LocalGpsTrack): Promise<void> {
    const generation = this.persistGeneration;
    if (this.dependencies.isPurging() || !this.dependencies.isSessionActive()) return;
    try {
      await this.dependencies.store.put(track);
      if (
        generation !== this.persistGeneration ||
        this.dependencies.isPurging() ||
        !this.dependencies.isSessionActive()
      ) {
        try {
          await this.dependencies.store.remove(track.id);
        } catch {
          // Best-effort cleanup of a write that finished after logout/discard.
        }
      }
    } catch (error) {
      console.warn('Failed to persist GPS track:', error);
    }
  }

  private bump(publish = true): void {
    this._revision += 1;
    this.trackSnapshot = this.buildSnapshot();
    if (publish) this.dependencies.notifyStateChanged();
  }

  private buildSnapshot(): GpsTrackListItem[] {
    const pending = this.dependencies.mutations.gpsPendingBySubject();
    const items = this.localTracks.map((track): GpsTrackListItem => {
      const summary = summarizeTrack(track.points);
      const state = pending.get(track.id);
      return {
        id: track.id,
        name: track.name,
        color: normalizeHexColor(track.color),
        origin: 'local',
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        pointCount: summary.pointCount,
        distanceMeters: summary.distanceMeters,
        durationMs: summary.durationMs,
        pending: state?.state,
        pendingError: state?.error ?? null,
      };
    });
    const remote = this.dependencies.mutations.foldGpsTracks(this.remoteTracks);
    for (const track of remote) {
      const state = pending.get(track.id);
      items.push({
        id: track.id,
        name: track.name,
        color: track.color,
        origin: 'remote',
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        pending: state?.state,
        pendingError: state?.error ?? null,
      });
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
