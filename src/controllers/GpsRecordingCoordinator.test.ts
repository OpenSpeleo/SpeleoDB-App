import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GPS } from '../constants';
import type {
  FixListener,
  LocationWatcher,
  WatchErrorListener,
  WatchOptions,
} from '../services/GeolocationWatcher';
import { allowConsoleWarn } from '../test/consoleGuard';
import type { LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import { GpsRecordingCoordinator } from './GpsRecordingCoordinator';

const STARTED_AT = 4_000_000_000_000;

function point(offset: number): RecordedPoint {
  return {
    latitude: 46 + offset / 1_000_000,
    longitude: 2,
    altitude: 10,
    accuracy: 5,
    altitudeAccuracy: 8,
    timestamp: STARTED_AT + offset,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createWatcher(permission = 'granted') {
  let fixListener: FixListener | undefined;
  let errorListener: WatchErrorListener | undefined;
  const watcher: LocationWatcher = {
    requestPermissions: vi.fn(async () => permission),
    start: vi.fn(async (
      _options: WatchOptions,
      onFix: FixListener,
      onError?: WatchErrorListener,
    ) => {
      fixListener = onFix;
      errorListener = onError;
    }),
    stop: vi.fn(async () => {}),
  };
  return {
    watcher,
    emitFix(next: RecordedPoint): void {
      fixListener?.(next);
    },
    emitError(error: unknown): void {
      errorListener?.(error);
    },
  };
}

function createHarness(options: {
  permission?: string;
  watcher?: ReturnType<typeof createWatcher>;
  removePersisted?: (id: string) => Promise<void>;
} = {}) {
  const watch = options.watcher ?? createWatcher(options.permission);
  let now = STARTED_AT;
  const completed: LocalGpsTrack[] = [];
  const dependencies = {
    watcher: watch.watcher,
    notificationPermission: {
      requestPermission: vi.fn(async (): Promise<'granted'> => 'granted'),
    },
    now: vi.fn(() => now),
    generateId: vi.fn(() => 'track-1'),
    defaultName: vi.fn(() => 'Track default'),
    persist: vi.fn(async (_track: LocalGpsTrack) => {}),
    removePersisted: vi.fn(options.removePersisted ?? (async (_id: string) => {})),
    waitForPersistence: vi.fn(async () => {}),
    invalidatePersistence: vi.fn(),
    addCompletedTrack: vi.fn((track: LocalGpsTrack) => completed.push(track)),
    notifyStateChanged: vi.fn(),
  };
  return {
    coordinator: new GpsRecordingCoordinator(dependencies),
    completed,
    dependencies,
    watch,
    setNow(next: number): void {
      now = next;
    },
  };
}

describe('GpsRecordingCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts idle and keeps idle operations side-effect free', async () => {
    const { coordinator, dependencies, watch } = createHarness();

    expect(coordinator.recordingState).toBe('idle');
    expect(coordinator.recordingStartedAt).toBeNull();
    expect(coordinator.recordingElapsedMs).toBe(0);
    expect(coordinator.recordingElapsedUpdatedAt).toBeNull();
    expect(coordinator.currentPoints).toEqual([]);
    expect(coordinator.recordingError).toBeNull();
    expect(await coordinator.stop()).toBeNull();
    await coordinator.pause();
    await coordinator.resume();
    await coordinator.discard();
    coordinator.clearError();

    expect(watch.watcher.stop).not.toHaveBeenCalled();
    expect(dependencies.notifyStateChanged).not.toHaveBeenCalled();
  });

  it('rejects denied location permission before starting a watch', async () => {
    const { coordinator, dependencies, watch } = createHarness({ permission: 'denied' });

    await expect(coordinator.start()).rejects.toThrow(/location permission/i);

    expect(watch.watcher.start).not.toHaveBeenCalled();
    expect(dependencies.notificationPermission.requestPermission).not.toHaveBeenCalled();
    expect(coordinator.recordingState).toBe('idle');
  });

  it('records, pauses, resumes, filters fixes, and finalizes through injected ports', async () => {
    const { coordinator, completed, dependencies, setNow, watch } = createHarness();

    await coordinator.start();
    await coordinator.start();
    expect(watch.watcher.start).toHaveBeenCalledWith(
      GPS.WATCH_OPTIONS,
      expect.any(Function),
      expect.any(Function),
    );
    expect(watch.watcher.requestPermissions).toHaveBeenCalledOnce();
    expect(coordinator.recordingStartedAt).toBe(STARTED_AT);
    expect(coordinator.recordingElapsedUpdatedAt).toBe(STARTED_AT);

    watch.emitFix(point(-GPS.WATCH_START_STALE_FIX_GRACE_MS - 1));
    watch.emitFix(point(0));
    watch.emitFix(point(GPS.TRACK_SAMPLE_INTERVAL_MS - 1));
    watch.emitFix(point(GPS.TRACK_SAMPLE_INTERVAL_MS));
    expect(coordinator.currentPoints).toHaveLength(2);
    expect(dependencies.persist).toHaveBeenCalledTimes(2);

    setNow(STARTED_AT + 60_000);
    expect(coordinator.recordingElapsedMs).toBe(0);
    await coordinator.pause();
    await coordinator.pause();
    expect(coordinator.recordingState).toBe('paused');
    expect(coordinator.recordingElapsedMs).toBe(60_000);
    expect(coordinator.recordingElapsedUpdatedAt).toBeNull();

    setNow(STARTED_AT + 600_000);
    await coordinator.start();
    expect(coordinator.recordingState).toBe('recording');
    expect(coordinator.recordingElapsedMs).toBe(60_000);

    setNow(STARTED_AT + 615_000);
    const track = await coordinator.stop('  Named track  ');
    expect(track).toMatchObject({
      id: 'track-1',
      name: 'Named track',
      points: [point(0), point(GPS.TRACK_SAMPLE_INTERVAL_MS)],
      createdAt: STARTED_AT,
      updatedAt: STARTED_AT + 615_000,
    });
    expect(track?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(completed).toEqual([track]);
    expect(dependencies.waitForPersistence).toHaveBeenCalledOnce();
    expect(coordinator.recordingState).toBe('idle');
  });

  it('rolls a failed initial watch back to idle', async () => {
    const watch = createWatcher();
    vi.mocked(watch.watcher.start).mockRejectedValueOnce(new Error('watch failed'));
    const { coordinator, dependencies } = createHarness({ watcher: watch });

    await expect(coordinator.start()).rejects.toThrow('watch failed');

    expect(watch.watcher.stop).toHaveBeenCalledOnce();
    expect(coordinator.recordingState).toBe('idle');
    expect(dependencies.notifyStateChanged).toHaveBeenCalledTimes(2);
  });

  it('rolls a failed resume back to paused without dropping points', async () => {
    const { coordinator, dependencies, watch } = createHarness();
    await coordinator.start();
    watch.emitFix(point(0));
    await coordinator.pause();
    vi.mocked(watch.watcher.start).mockRejectedValueOnce(new Error('resume failed'));

    await expect(coordinator.resume()).rejects.toThrow('resume failed');

    expect(coordinator.recordingState).toBe('paused');
    expect(coordinator.currentPoints).toEqual([point(0)]);
    expect(dependencies.notifyStateChanged).toHaveBeenCalled();
  });

  it('removes an empty recording and uses the default name for a non-empty one', async () => {
    const { coordinator, dependencies, watch } = createHarness();
    await coordinator.start();
    expect(await coordinator.stop()).toBeNull();
    expect(dependencies.removePersisted).toHaveBeenCalledWith('track-1');

    await coordinator.start();
    watch.emitFix(point(0));
    const track = await coordinator.stop('   ');
    expect(track?.name).toBe('Track default');
  });

  it('discards points, invalidates queued writes, and tolerates removal failure', async () => {
    const removalError = new Error('storage unavailable');
    allowConsoleWarn('Failed to discard GPS track recording:', removalError);
    const { coordinator, dependencies, watch } = createHarness({
      removePersisted: async () => { throw removalError; },
    });
    await coordinator.start();
    watch.emitFix(point(0));

    await coordinator.discard();

    expect(dependencies.invalidatePersistence).toHaveBeenCalledOnce();
    expect(dependencies.waitForPersistence).toHaveBeenCalledOnce();
    expect(coordinator.currentPoints).toEqual([]);
    expect(coordinator.recordingState).toBe('idle');
  });

  it('keeps transient errors active and finalizes data on fatal authorization loss', async () => {
    const transientError = 'signal lost';
    allowConsoleWarn('GPS watch error during recording:', transientError);
    const { coordinator, completed, dependencies, watch } = createHarness();
    await coordinator.start();

    watch.emitError(transientError);
    expect(coordinator.recordingState).toBe('recording');
    watch.emitFix(point(0));
    watch.emitError({ code: '1' });

    expect(coordinator.recordingState).toBe('idle');
    expect(coordinator.recordingError).toMatch(/1-point track was saved/i);
    expect(completed).toHaveLength(1);
    expect(dependencies.persist).toHaveBeenLastCalledWith(completed[0]);
    coordinator.clearError();
    expect(coordinator.recordingError).toBeNull();
  });

  it('removes an empty track after native fatal authorization loss', async () => {
    const removalError = new Error('remove failed');
    allowConsoleWarn('Failed to discard empty GPS track:', removalError);
    const { coordinator, dependencies, watch } = createHarness({
      removePersisted: async () => { throw removalError; },
    });
    await coordinator.start();

    watch.emitError({ code: 'NOT_AUTHORIZED' });
    await vi.waitFor(() => expect(dependencies.removePersisted).toHaveBeenCalledWith('track-1'));

    expect(coordinator.recordingState).toBe('idle');
    expect(coordinator.recordingError).toMatch(/location access was denied/i);
    await coordinator.stopForLogout();
    expect(coordinator.recordingError).toBeNull();
  });

  it('ignores a stale fatal callback after logout and returns the watcher stop promise directly', async () => {
    const stop = deferred<void>();
    const watch = createWatcher();
    vi.mocked(watch.watcher.stop).mockReturnValueOnce(stop.promise);
    const { coordinator, dependencies } = createHarness({ watcher: watch });
    await coordinator.start();

    const stopping = coordinator.stopForLogout();
    expect(dependencies.invalidatePersistence).toHaveBeenCalledOnce();
    expect(coordinator.recordingState).toBe('idle');
    watch.emitFix(point(0));
    watch.emitError({ code: 1 });
    expect(coordinator.currentPoints).toEqual([]);
    expect(coordinator.recordingError).toBeNull();

    stop.resolve();
    await expect(stopping).resolves.toBeUndefined();
  });
});
