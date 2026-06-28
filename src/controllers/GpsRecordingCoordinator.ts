import { GPS } from '../constants';
import type { LocationWatcher } from '../services/GeolocationWatcher';
import type { RecordingNotificationPermissionGuard } from '../services/RecordingNotificationPermissionGuard';
import type { GpsRecordingState, LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import { shouldAcceptFix } from '../utils/gpsSampling';
import { randomTrackColor } from '../utils/gpsTrackColors';

const PERMISSION_LOST_MESSAGE =
  'Location access was denied, so GPS recording stopped. Allow location ' +
  '(set to "Always" for background recording) and start again.';

interface GpsRecordingDependencies {
  watcher: LocationWatcher;
  notificationPermission: RecordingNotificationPermissionGuard;
  now(): number;
  generateId(): string;
  defaultName(timestamp: number): string;
  persist(track: LocalGpsTrack): Promise<void>;
  removePersisted(id: string): Promise<void>;
  waitForPersistence(): Promise<void>;
  invalidatePersistence(): void;
  addCompletedTrack(track: LocalGpsTrack): void;
  notifyStateChanged(): void;
}

function isFatalWatchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'NOT_AUTHORIZED' || code === 1 || code === '1';
}

/** Owns the GPS recording/watch state machine and force-quit recovery writes. */
export class GpsRecordingCoordinator {
  private state: GpsRecordingState = 'idle';
  private points: RecordedPoint[] = [];
  private pointsSnapshot: RecordedPoint[] = [];
  private trackId: string | null = null;
  private startedAt = 0;
  private activeElapsedMs = 0;
  private activeStartedAt: number | null = null;
  private watchSessionStartedAt = 0;
  private name = '';
  private color = '';
  private error: string | null = null;
  private elapsedMsSnapshot = 0;
  private elapsedUpdatedAtSnapshot: number | null = null;

  constructor(private readonly dependencies: GpsRecordingDependencies) {}

  get recordingState(): GpsRecordingState {
    return this.state;
  }

  get currentPoints(): RecordedPoint[] {
    return this.pointsSnapshot;
  }

  get recordingStartedAt(): number | null {
    return this.state === 'idle' ? null : this.startedAt;
  }

  get recordingElapsedMs(): number {
    return this.elapsedMsSnapshot;
  }

  get recordingElapsedUpdatedAt(): number | null {
    return this.elapsedUpdatedAtSnapshot;
  }

  get recordingError(): string | null {
    return this.error;
  }

  async start(): Promise<void> {
    if (this.state === 'recording') return;
    if (this.state === 'paused') return this.resume();
    const permission = await this.dependencies.watcher.requestPermissions();
    if (permission !== 'granted') {
      throw new Error('Location permission is required to record a GPS track.');
    }
    await this.dependencies.notificationPermission.requestPermission();
    const now = this.dependencies.now();
    this.trackId = this.dependencies.generateId();
    this.startedAt = now;
    this.activeElapsedMs = 0;
    this.activeStartedAt = now;
    this.watchSessionStartedAt = now;
    this.name = this.dependencies.defaultName(now);
    this.color = randomTrackColor();
    this.points = [];
    this.state = 'recording';
    this.error = null;
    this.notify();
    try {
      await this.startWatch();
    } catch (error) {
      await this.dependencies.watcher.stop();
      this.clearSession();
      this.notify();
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.state !== 'recording') return;
    await this.dependencies.watcher.stop();
    this.freezeElapsed();
    this.state = 'paused';
    this.notify();
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.dependencies.notificationPermission.requestPermission();
    const previousWatchStart = this.watchSessionStartedAt;
    const previousActiveStart = this.activeStartedAt;
    const now = this.dependencies.now();
    this.state = 'recording';
    this.activeStartedAt = now;
    this.watchSessionStartedAt = now;
    this.notify();
    try {
      await this.startWatch();
    } catch (error) {
      this.state = 'paused';
      this.watchSessionStartedAt = previousWatchStart;
      this.activeStartedAt = previousActiveStart;
      this.notify();
      throw error;
    }
  }

  async stop(finalName?: string): Promise<LocalGpsTrack | null> {
    if (this.state === 'idle') return null;
    await this.dependencies.watcher.stop();
    const points = this.points;
    const id = this.trackId as string;
    const startedAt = this.startedAt;
    const name = this.name;
    const color = this.color;
    this.freezeElapsed();
    await this.dependencies.waitForPersistence();
    this.clearSession();
    if (points.length === 0) {
      await this.removeBestEffort(id, 'Failed to discard empty GPS track:');
      this.notify();
      return null;
    }
    const track = this.finalizedTrack(id, finalName?.trim() || name, color, points, startedAt);
    await this.dependencies.persist(track);
    this.dependencies.addCompletedTrack(track);
    this.notify();
    return track;
  }

  async discard(): Promise<void> {
    if (this.state === 'idle') return;
    await this.dependencies.watcher.stop();
    this.dependencies.invalidatePersistence();
    await this.dependencies.waitForPersistence();
    const id = this.trackId as string;
    this.clearSession();
    await this.removeBestEffort(id, 'Failed to discard GPS track recording:');
    this.notify();
  }

  clearError(): void {
    if (this.error === null) return;
    this.error = null;
    this.notify();
  }

  stopForLogout(): Promise<void> {
    this.dependencies.invalidatePersistence();
    this.clearSession();
    this.error = null;
    return this.dependencies.watcher.stop();
  }

  private async startWatch(): Promise<void> {
    await this.dependencies.watcher.start(
      { ...GPS.WATCH_OPTIONS },
      (point) => this.appendPoint(point),
      (error) => this.handleWatchError(error),
    );
  }

  private handleWatchError(error: unknown): void {
    if (!isFatalWatchError(error)) {
      console.warn('GPS watch error during recording:', error);
      return;
    }
    if (this.state === 'idle') return;
    void this.dependencies.watcher.stop();
    const points = this.points;
    const id = this.trackId as string;
    const startedAt = this.startedAt;
    const name = this.name;
    const color = this.color;
    this.clearSession();
    this.error = points.length > 0
      ? `${PERMISSION_LOST_MESSAGE} Your ${points.length}-point track was saved.`
      : PERMISSION_LOST_MESSAGE;
    if (points.length > 0) {
      const track = this.finalizedTrack(id, name, color, points, startedAt);
      void this.dependencies.persist(track);
      this.dependencies.addCompletedTrack(track);
    } else {
      void this.removeBestEffort(id, 'Failed to discard empty GPS track:');
    }
    this.notify();
  }

  private appendPoint(point: RecordedPoint): void {
    if (this.state !== 'recording') return;
    const last = this.points[this.points.length - 1];
    if (!shouldAcceptFix(point.timestamp, {
      sessionStartMs: this.watchSessionStartedAt - GPS.WATCH_START_STALE_FIX_GRACE_MS,
      lastAcceptedMs: last ? last.timestamp : null,
      minIntervalMs: GPS.TRACK_SAMPLE_INTERVAL_MS,
    })) return;
    this.points = [...this.points, point];
    void this.dependencies.persist(this.recordingTrack());
    this.notify();
  }

  private finalizedTrack(
    id: string,
    name: string,
    color: string,
    points: RecordedPoint[],
    createdAt: number,
  ): LocalGpsTrack {
    return {
      id,
      name,
      color,
      points,
      createdAt,
      updatedAt: this.dependencies.now(),
    };
  }

  private recordingTrack(): LocalGpsTrack {
    return {
      id: this.trackId as string,
      name: this.name,
      color: this.color,
      points: this.points,
      createdAt: this.startedAt,
      updatedAt: this.dependencies.now(),
    };
  }

  private elapsedAt(now: number): number {
    if (this.state === 'idle') return 0;
    const active = this.state === 'recording' && this.activeStartedAt !== null
      ? Math.max(0, now - this.activeStartedAt)
      : 0;
    return this.activeElapsedMs + active;
  }

  private freezeElapsed(): void {
    this.activeElapsedMs = this.elapsedAt(this.dependencies.now());
    this.activeStartedAt = null;
  }

  private clearSession(): void {
    this.points = [];
    this.pointsSnapshot = [];
    this.trackId = null;
    this.startedAt = 0;
    this.activeElapsedMs = 0;
    this.activeStartedAt = null;
    this.watchSessionStartedAt = 0;
    this.name = '';
    this.color = '';
    this.state = 'idle';
    this.elapsedMsSnapshot = 0;
    this.elapsedUpdatedAtSnapshot = null;
  }

  private async removeBestEffort(id: string, message: string): Promise<void> {
    try {
      await this.dependencies.removePersisted(id);
    } catch (error) {
      console.warn(message, error);
    }
  }

  private notify(): void {
    const now = this.dependencies.now();
    this.pointsSnapshot = [...this.points];
    this.elapsedMsSnapshot = this.elapsedAt(now);
    this.elapsedUpdatedAtSnapshot = this.state === 'recording' ? now : null;
    this.dependencies.notifyStateChanged();
  }
}
