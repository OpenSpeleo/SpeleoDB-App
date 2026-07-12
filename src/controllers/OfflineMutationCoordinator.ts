import {
  OfflineOpQueue,
  type OfflineReplayPort,
  type OfflineSyncSummary,
} from '../offline/OfflineOpQueue';
import type { OfflineOpStore } from '../offline/OfflineOpStore';
import type {
  GpsTrackPendingState,
  GpsTrackSnapshot,
  RemoteGpsTrack,
} from '../types/gpsTrack';
import type {
  LandmarkApiObject,
} from '../types/landmark';
import type { LandmarkSnapshot, OfflineConflictChoice, OfflineOpView } from '../types/offlineOp';

interface OfflineMutationCoordinatorDependencies {
  store: OfflineOpStore;
  replay: OfflineReplayPort;
  onStateChanged(): void;
}

/**
 * Owns the persistent offline queue lifecycle and exposes domain-oriented
 * mutation operations without leaking the queue implementation to controllers.
 */
export class OfflineMutationCoordinator {
  private queue: OfflineOpQueue;
  private queueGeneration = 0;
  private _revision = 0;
  private restoredStatePublished = false;

  constructor(private readonly dependencies: OfflineMutationCoordinatorDependencies) {
    this.queue = this.createQueue();
  }

  get count(): number {
    return this.queue.count;
  }

  get revision(): number {
    return this._revision;
  }

  get isReplaying(): boolean {
    return this.queue.isReplaying;
  }

  async load(): Promise<void> {
    await this.queue.load();
    if (this.queue.count > 0 && !this.restoredStatePublished) {
      this.restoredStatePublished = true;
      this._revision += 1;
      this.dependencies.onStateChanged();
    }
  }

  reset(): void {
    this.queueGeneration += 1;
    this.queue = this.createQueue();
    this.restoredStatePublished = false;
    this._revision += 1;
  }

  foldLandmarks(
    base: GeoJSON.FeatureCollection | null | undefined,
  ): GeoJSON.FeatureCollection {
    return this.queue.foldOver(base);
  }

  foldGpsTracks(base: readonly RemoteGpsTrack[] | null | undefined): RemoteGpsTrack[] {
    return this.queue.foldGpsTracks(base);
  }

  gpsPendingBySubject(): Map<
    string,
    { state: GpsTrackPendingState; error?: string | null }
  > {
    return this.queue.gpsPendingBySubject();
  }

  views(): OfflineOpView[] {
    return this.queue.views();
  }

  async enqueueLandmarkCreate(landmark: LandmarkApiObject): Promise<void> {
    await this.queue.enqueueCreate(landmark);
  }

  async enqueueLandmarkUpdate(
    id: string,
    baseline: LandmarkSnapshot | null,
    next: LandmarkSnapshot,
  ): Promise<void> {
    await this.queue.enqueueUpdate(id, baseline, next);
  }

  async enqueueLandmarkDelete(
    id: string,
    baseline: LandmarkSnapshot | null,
  ): Promise<void> {
    await this.queue.enqueueDelete(id, baseline);
  }

  async enqueueGpsCreate(track: { id: string; name: string; color: string }): Promise<void> {
    await this.queue.enqueueGpsCreate(track);
  }

  async enqueueGpsUpdate(
    id: string,
    baseline: GpsTrackSnapshot | null,
    next: GpsTrackSnapshot,
  ): Promise<void> {
    await this.queue.enqueueGpsUpdate(id, baseline, next);
  }

  async enqueueGpsDelete(id: string, baseline: GpsTrackSnapshot | null): Promise<void> {
    await this.queue.enqueueGpsDelete(id, baseline);
  }

  hasGpsCreateFor(id: string): boolean {
    return this.queue.hasGpsCreateFor(id);
  }

  async discardGpsTrackOpsForSubject(id: string): Promise<void> {
    await this.queue.discardGpsTrackOpsForSubject(id);
  }

  async syncAll(): Promise<OfflineSyncSummary> {
    return this.queue.syncAll();
  }

  async syncOne(id: string): Promise<OfflineSyncSummary> {
    return this.queue.syncOne(id);
  }

  async discard(id: string): Promise<void> {
    await this.queue.discard(id);
  }

  async resolveConflict(
    id: string,
    choice: OfflineConflictChoice,
  ): Promise<OfflineSyncSummary> {
    return this.queue.resolveConflict(id, choice);
  }

  private createQueue(): OfflineOpQueue {
    const generation = this.queueGeneration;
    return new OfflineOpQueue(
      this.dependencies.store,
      this.dependencies.replay,
      () => {
        if (generation !== this.queueGeneration) return;
        this._revision += 1;
        this.dependencies.onStateChanged();
      },
    );
  }
}
