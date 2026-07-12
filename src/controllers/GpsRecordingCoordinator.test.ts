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
  persist?: (track: LocalGpsTrack) => Promise<void>;
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
    persist: vi.fn(options.persist ?? (async (_track: LocalGpsTrack) => {})),
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

  it('starts idle with side-effect-free state reads', () => {
    const { coordinator, dependencies, watch } = createHarness();

    expect(coordinator.recordingState).toBe('idle');
    expect(coordinator.recordingStartedAt).toBeNull();
    expect(coordinator.recordingElapsedMs).toBe(0);
    expect(coordinator.recordingElapsedUpdatedAt).toBeNull();
    expect(coordinator.currentPoints).toEqual([]);
    expect(coordinator.recordingError).toBeNull();
    coordinator.clearError();

    expect(watch.watcher.stop).not.toHaveBeenCalled();
    expect(dependencies.notifyStateChanged).not.toHaveBeenCalled();
  });

  it('coalesces overlapping start admission before permission resolves', async () => {
    const permission = deferred<string>();
    const watch = createWatcher();
    vi.mocked(watch.watcher.requestPermissions).mockReturnValue(permission.promise);
    const { coordinator } = createHarness({ watcher: watch });

    const first = coordinator.start();
    const duplicate = coordinator.start();

    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(watch.watcher.requestPermissions).toHaveBeenCalledOnce());
    permission.resolve('granted');
    await Promise.all([first, duplicate]);
    expect(watch.watcher.start).toHaveBeenCalledOnce();
  });

  it('coalesces overlapping pause and resume native transitions', async () => {
    const watch = createWatcher();
    const { coordinator, dependencies } = createHarness({ watcher: watch });
    await coordinator.start();
    const pauseGate = deferred<void>();
    vi.mocked(watch.watcher.stop).mockReturnValue(pauseGate.promise);

    const pause = coordinator.pause();
    const duplicatePause = coordinator.pause();
    expect(duplicatePause).toBe(pause);
    await vi.waitFor(() => expect(watch.watcher.stop).toHaveBeenCalledOnce());
    pauseGate.resolve();
    await Promise.all([pause, duplicatePause]);

    const notificationGate = deferred<'granted'>();
    dependencies.notificationPermission.requestPermission.mockClear();
    dependencies.notificationPermission.requestPermission.mockReturnValue(
      notificationGate.promise,
    );
    const resume = coordinator.resume();
    const duplicateResume = coordinator.resume();
    expect(duplicateResume).toBe(resume);
    await vi.waitFor(() => (
      expect(dependencies.notificationPermission.requestPermission).toHaveBeenCalledOnce()
    ));
    notificationGate.resolve('granted');
    await Promise.all([resume, duplicateResume]);
    expect(watch.watcher.start).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping stop finalization and publishes one track', async () => {
    const watch = createWatcher();
    const finalWrite = deferred<void>();
    const { coordinator, completed, dependencies } = createHarness({ watcher: watch });
    await coordinator.start();
    watch.emitFix(point(0));
    dependencies.persist.mockReturnValueOnce(finalWrite.promise);

    const stop = coordinator.stop();
    const duplicateStop = coordinator.stop();
    expect(duplicateStop).toBe(stop);
    finalWrite.resolve();
    const [track, duplicateTrack] = await Promise.all([stop, duplicateStop]);

    expect(duplicateTrack).toBe(track);
    expect(completed).toHaveLength(1);
  });

  it('coalesces overlapping discard deletion into one native transition', async () => {
    const removal = deferred<void>();
    const { coordinator, dependencies, watch } = createHarness({
      removePersisted: async () => removal.promise,
    });
    await coordinator.start();
    watch.emitFix(point(0));

    const discard = coordinator.discard();
    const duplicateDiscard = coordinator.discard();
    expect(duplicateDiscard).toBe(discard);
    removal.resolve();
    await Promise.all([discard, duplicateDiscard]);

    expect(dependencies.removePersisted).toHaveBeenCalledOnce();
    expect(coordinator.recordingState).toBe('idle');
  });

  it('serializes incompatible commands and validates state when admitted', async () => {
    const permission = deferred<string>();
    const watch = createWatcher();
    vi.mocked(watch.watcher.requestPermissions).mockReturnValue(permission.promise);
    const { coordinator } = createHarness({ watcher: watch });

    const start = coordinator.start();
    const pause = coordinator.pause();
    permission.resolve('granted');
    await start;
    await pause;

    expect(watch.watcher.start).toHaveBeenCalledOnce();
    expect(watch.watcher.stop).toHaveBeenCalledOnce();
    expect(coordinator.recordingState).toBe('paused');
  });

  it('rejects commands that are invalid for the admitted state', async () => {
    const { coordinator } = createHarness();

    await expect(coordinator.pause()).rejects.toThrow(/cannot pause/i);
    await expect(coordinator.resume()).rejects.toThrow(/cannot resume/i);
    await expect(coordinator.stop()).rejects.toThrow(/cannot stop/i);
    await expect(coordinator.discard()).rejects.toThrow(/cannot discard/i);
    await expect(coordinator.start()).resolves.toBeUndefined();
    expect(coordinator.recordingState).toBe('recording');
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
    await expect(coordinator.start()).rejects.toThrow(/cannot start/i);
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
    await expect(coordinator.pause()).rejects.toThrow(/cannot pause/i);
    expect(coordinator.recordingState).toBe('paused');
    expect(coordinator.recordingElapsedMs).toBe(60_000);
    expect(coordinator.recordingElapsedUpdatedAt).toBeNull();

    setNow(STARTED_AT + 600_000);
    await coordinator.resume();
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
    vi.mocked(watch.watcher.stop).mockRejectedValueOnce(new Error('cleanup failed'));
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

  it('retains a recoverable recording when explicit discard deletion fails', async () => {
    const removalError = new Error('storage unavailable');
    const { coordinator, dependencies, watch } = createHarness({
      removePersisted: async () => { throw removalError; },
    });
    await coordinator.start();
    watch.emitFix(point(0));

    await expect(coordinator.discard()).rejects.toBe(removalError);

    expect(dependencies.invalidatePersistence).toHaveBeenCalledOnce();
    expect(dependencies.waitForPersistence).toHaveBeenCalledOnce();
    expect(coordinator.currentPoints).toEqual([point(0)]);
    expect(coordinator.recordingState).toBe('paused');
  });

  it('retains points and reports a final-save failure for retry', async () => {
    const storageError = new Error('final write failed');
    const persist = vi
      .fn<(track: LocalGpsTrack) => Promise<void>>()
      .mockResolvedValue(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(storageError);
    const { coordinator, completed, watch } = createHarness({ persist });
    await coordinator.start();
    watch.emitFix(point(0));

    await expect(coordinator.stop()).rejects.toBe(storageError);

    expect(coordinator.recordingState).toBe('paused');
    expect(coordinator.currentPoints).toEqual([point(0)]);
    expect(completed).toEqual([]);

    await expect(coordinator.stop()).resolves.toMatchObject({ id: 'track-1' });
    expect(coordinator.recordingState).toBe('idle');
    expect(coordinator.currentPoints).toEqual([]);
    expect(completed).toHaveLength(1);
  });

  it('reports incremental persistence failure without dropping captured points', async () => {
    const storageError = new Error('incremental write failed');
    const { coordinator, watch } = createHarness({
      persist: async () => { throw storageError; },
    });
    await coordinator.start();

    watch.emitFix(point(0));
    await vi.waitFor(() => expect(coordinator.recordingError).toMatch(/could not save/i));

    expect(coordinator.recordingState).toBe('recording');
    expect(coordinator.currentPoints).toEqual([point(0)]);
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

    await vi.waitFor(() => expect(completed).toHaveLength(1));
    expect(coordinator.recordingState).toBe('idle');
    expect(coordinator.recordingError).toMatch(/1-point track was saved/i);
    expect(dependencies.persist).toHaveBeenLastCalledWith(completed[0]);
    coordinator.clearError();
    expect(coordinator.recordingError).toBeNull();
  });

  it('does not claim fatal-error recovery was saved when persistence fails', async () => {
    const storageError = new Error('fatal final write failed');
    const persist = vi
      .fn<(track: LocalGpsTrack) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(storageError);
    const { coordinator, completed, watch } = createHarness({ persist });
    await coordinator.start();
    watch.emitFix(point(0));

    watch.emitError({ code: 'NOT_AUTHORIZED' });
    await vi.waitFor(() => expect(coordinator.recordingError).toMatch(/could not be saved/i));

    expect(coordinator.recordingError).not.toMatch(/was saved/i);
    expect(coordinator.recordingState).toBe('paused');
    expect(coordinator.currentPoints).toEqual([point(0)]);
    expect(completed).toEqual([]);
  });

  it('reports failed empty-track cleanup after native fatal authorization loss', async () => {
    const removalError = new Error('remove failed');
    const { coordinator, dependencies, watch } = createHarness({
      removePersisted: async () => { throw removalError; },
    });
    await coordinator.start();

    watch.emitError({ code: 'NOT_AUTHORIZED' });
    await vi.waitFor(() => expect(dependencies.removePersisted).toHaveBeenCalledWith('track-1'));

    await vi.waitFor(() => expect(coordinator.recordingError).toMatch(/could not be removed/i));
    expect(coordinator.recordingState).toBe('paused');
    await coordinator.stopForLogout();
    expect(coordinator.recordingError).toBeNull();
  });

  it('serializes logout teardown ahead of a stale fatal callback', async () => {
    const stop = deferred<void>();
    const watch = createWatcher();
    vi.mocked(watch.watcher.stop).mockReturnValueOnce(stop.promise);
    const { coordinator, dependencies } = createHarness({ watcher: watch });
    await coordinator.start();

    const stopping = coordinator.stopForLogout();
    await vi.waitFor(() => expect(dependencies.invalidatePersistence).toHaveBeenCalledOnce());
    expect(coordinator.recordingState).toBe('idle');
    watch.emitFix(point(0));
    watch.emitError({ code: 1 });
    expect(coordinator.currentPoints).toEqual([]);
    expect(coordinator.recordingError).toBeNull();

    stop.resolve();
    await expect(stopping).resolves.toBeUndefined();
  });
});
