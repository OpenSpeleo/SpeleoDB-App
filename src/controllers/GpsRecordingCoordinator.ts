import { GPS } from '../constants';
import type { LocationWatcher } from '../services/GeolocationWatcher';
import type { RecordingNotificationPermissionGuard } from '../services/RecordingNotificationPermissionGuard';
import type { GpsRecordingState, LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import { shouldAcceptFix } from '../utils/gpsSampling';
import { randomTrackColor } from '../utils/gpsTrackColors';

const PERMISSION_LOST_MESSAGE =
  'Location access was denied, so GPS recording stopped. Allow location ' +
  '(set to "Always" for background recording) and start again.';
const INCREMENTAL_SAVE_MESSAGE =
  'Could not save the latest GPS points to this device. Keep the app open and retry stopping the recording.';

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

export class GpsRecordingTransitionError extends Error {
  constructor(command: string, state: GpsRecordingState) {
    super(`Cannot ${command} GPS recording while it is ${state}.`);
    this.name = 'GpsRecordingTransitionError';
  }
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
  private transitionTail: Promise<void> = Promise.resolve();
  private transitionFlights = new Map<string, Promise<unknown>>();

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

  start(): Promise<void> {
    return this.enqueueTransition('start', () => this.startCommand());
  }

  private async startCommand(): Promise<void> {
    this.requireState('start', 'idle');
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
      try {
        await this.dependencies.watcher.stop();
      } catch {
        // Preserve the start failure while still resetting local ownership.
      } finally {
        this.clearSession();
        this.notify();
      }
      throw error;
    }
  }

  pause(): Promise<void> {
    return this.enqueueTransition('pause', () => this.pauseCommand());
  }

  private async pauseCommand(): Promise<void> {
    this.requireState('pause', 'recording');
    await this.dependencies.watcher.stop();
    this.freezeElapsed();
    this.state = 'paused';
    this.notify();
  }

  resume(): Promise<void> {
    return this.enqueueTransition('resume', () => this.resumeCommand());
  }

  private async resumeCommand(): Promise<void> {
    this.requireState('resume', 'paused');
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

  stop(finalName?: string): Promise<LocalGpsTrack | null> {
    const normalizedName = finalName?.trim() ?? '';
    return this.enqueueTransition(
      `stop:${normalizedName}`,
      () => this.stopCommand(normalizedName),
    );
  }

  private async stopCommand(finalName: string): Promise<LocalGpsTrack | null> {
    this.requireState('stop', 'recording', 'paused');
    await this.dependencies.watcher.stop();
    const points = this.points;
    const id = this.trackId as string;
    const startedAt = this.startedAt;
    const name = this.name;
    const color = this.color;
    this.freezeElapsed();
    this.state = 'paused';
    try {
      await this.dependencies.waitForPersistence();
      if (points.length === 0) {
        await this.dependencies.removePersisted(id);
        this.clearSession();
        this.notify();
        return null;
      }
      const track = this.finalizedTrack(id, finalName || name, color, points, startedAt);
      await this.dependencies.persist(track);
      this.clearSession();
      this.dependencies.addCompletedTrack(track);
      this.notify();
      return track;
    } catch (error) {
      this.notify();
      throw error;
    }
  }

  discard(): Promise<void> {
    return this.enqueueTransition('discard', () => this.discardCommand());
  }

  private async discardCommand(): Promise<void> {
    this.requireState('discard', 'recording', 'paused');
    await this.dependencies.watcher.stop();
    this.dependencies.invalidatePersistence();
    const id = this.trackId as string;
    this.freezeElapsed();
    this.state = 'paused';
    try {
      await this.dependencies.waitForPersistence();
      await this.dependencies.removePersisted(id);
      this.clearSession();
      this.notify();
    } catch (error) {
      this.notify();
      throw error;
    }
  }

  clearError(): void {
    if (this.error === null) return;
    this.error = null;
    this.notify();
  }

  stopForLogout(): Promise<void> {
    return this.enqueueTransition('logout', () => this.stopForLogoutCommand());
  }

  private stopForLogoutCommand(): Promise<void> {
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
    void this.enqueueTransition('fatal-watch-error', () => this.handleFatalWatchError());
  }

  private async handleFatalWatchError(): Promise<void> {
    if (this.state === 'idle') return;
    try {
      await this.dependencies.watcher.stop();
    } catch {
      // Authorization loss already ended usable location delivery. Continue
      // finalization and surface its durable outcome through recordingError.
    }
    const points = this.points;
    const id = this.trackId as string;
    const startedAt = this.startedAt;
    const name = this.name;
    const color = this.color;
    this.freezeElapsed();
    this.state = 'paused';
    this.error = points.length > 0
      ? `${PERMISSION_LOST_MESSAGE} Saving your ${points.length}-point track…`
      : null;
    this.notify();
    if (points.length > 0) {
      const track = this.finalizedTrack(id, name, color, points, startedAt);
      await this.finalizeAfterFatalError(track);
    } else {
      await this.removeEmptyAfterFatalError(id);
    }
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
    const trackId = this.trackId;
    void this.dependencies.persist(this.recordingTrack()).catch(() => {
      if (this.trackId !== trackId || this.state === 'idle') return;
      this.error = INCREMENTAL_SAVE_MESSAGE;
      this.notify();
    });
    this.notify();
  }

  private async finalizeAfterFatalError(track: LocalGpsTrack): Promise<void> {
    try {
      await this.dependencies.persist(track);
      if (this.trackId !== track.id || this.state === 'idle') return;
      this.clearSession();
      this.dependencies.addCompletedTrack(track);
      this.error = `${PERMISSION_LOST_MESSAGE} Your ${track.points.length}-point track was saved.`;
      this.notify();
    } catch {
      if (this.trackId !== track.id || this.state === 'idle') return;
      this.error = `${PERMISSION_LOST_MESSAGE} Your ${track.points.length}-point track could not be saved. The captured points are still available to retry.`;
      this.notify();
    }
  }

  private async removeEmptyAfterFatalError(id: string): Promise<void> {
    try {
      await this.dependencies.removePersisted(id);
      if (this.trackId !== id || this.state === 'idle') return;
      this.clearSession();
      this.error = PERMISSION_LOST_MESSAGE;
      this.notify();
    } catch {
      if (this.trackId !== id || this.state === 'idle') return;
      this.error = `${PERMISSION_LOST_MESSAGE} Incomplete local recording data could not be removed; retry Cancel.`;
      this.notify();
    }
  }

  private requireState(
    command: string,
    ...allowed: GpsRecordingState[]
  ): void {
    if (!allowed.includes(this.state)) {
      throw new GpsRecordingTransitionError(command, this.state);
    }
  }

  /**
   * Admit transitions synchronously, share compatible duplicate commands, and
   * keep incompatible commands ordered even after a rejection.
   */
  private enqueueTransition<T>(key: string, transition: () => Promise<T>): Promise<T> {
    const existing = this.transitionFlights.get(key);
    if (existing) return existing as Promise<T>;

    const result = this.transitionTail.then(transition, transition);
    this.transitionTail = result.then(
      () => undefined,
      () => undefined,
    );
    this.transitionFlights.set(key, result);
    const clearFlight = () => {
      if (this.transitionFlights.get(key) === result) {
        this.transitionFlights.delete(key);
      }
    };
    void result.then(clearFlight, clearFlight);
    return result;
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
    this.error = null;
    this.elapsedMsSnapshot = 0;
    this.elapsedUpdatedAtSnapshot = null;
  }

  private notify(): void {
    const now = this.dependencies.now();
    this.pointsSnapshot = [...this.points];
    this.elapsedMsSnapshot = this.elapsedAt(now);
    this.elapsedUpdatedAtSnapshot = this.state === 'recording' ? now : null;
    this.dependencies.notifyStateChanged();
  }
}
