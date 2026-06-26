import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BackgroundGeolocationWatcher,
  type BackgroundGeolocationLike,
  type BackgroundLocation,
  type BackgroundWatcherError,
} from './BackgroundGeolocationWatcher';
import type { RecordedPoint } from '../types/gpsTrack';

type Cb = (location?: BackgroundLocation | null, error?: BackgroundWatcherError | null) => void;

/** Controllable fake of the @capacitor-community/background-geolocation plugin. */
function createFakePlugin(opts: { idDelayMs?: number } = {}) {
  let callback: Cb | null = null;
  const removed: string[] = [];
  let nextId = 1;
  const plugin: BackgroundGeolocationLike & {
    emit: Cb;
    removed: string[];
    addCalls: number;
  } = {
    addCalls: 0,
    removed,
    async addWatcher(_options, cb) {
      plugin.addCalls += 1;
      callback = cb;
      if (opts.idDelayMs) await new Promise((r) => setTimeout(r, opts.idDelayMs));
      return `bg-watch-${nextId++}`;
    },
    async removeWatcher({ id }) {
      removed.push(id);
    },
    emit(location, error) {
      callback?.(location, error);
    },
  };
  return plugin;
}

function loc(lat: number, lng: number, time = 1000): BackgroundLocation {
  return { latitude: lat, longitude: lng, accuracy: 6, altitude: 50, altitudeAccuracy: 9, time };
}

describe('BackgroundGeolocationWatcher', () => {
  let plugin: ReturnType<typeof createFakePlugin>;
  let watcher: BackgroundGeolocationWatcher;

  beforeEach(() => {
    plugin = createFakePlugin();
    watcher = new BackgroundGeolocationWatcher(plugin, async () => 'granted');
  });

  it('delegates permission requests to the injected requester', async () => {
    const denied = new BackgroundGeolocationWatcher(plugin, async () => 'denied');
    expect(await denied.requestPermissions()).toBe('denied');
  });

  it('normalizes background locations into RecordedPoint (time -> timestamp)', async () => {
    const fixes: RecordedPoint[] = [];
    await watcher.start({}, (p) => fixes.push(p));
    plugin.emit(loc(45, -73, 1234));

    expect(fixes).toEqual([
      { latitude: 45, longitude: -73, altitude: 50, accuracy: 6, altitudeAccuracy: 9, timestamp: 1234 },
    ]);
    expect(watcher.isWatching).toBe(true);
  });

  it('requests a background-capable watch (backgroundMessage drives background tracking)', async () => {
    const spy = vi.spyOn(plugin, 'addWatcher');
    await watcher.start({}, () => {});
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundMessage: expect.any(String),
        backgroundTitle: expect.any(String),
        requestPermissions: true,
      }),
      expect.any(Function),
    );
  });

  it('forwards watch errors to onError and not as a fix', async () => {
    const fixes: RecordedPoint[] = [];
    const errors: unknown[] = [];
    await watcher.start({}, (p) => fixes.push(p), (e) => errors.push(e));
    plugin.emit(null, { code: 'NOT_AUTHORIZED', message: 'denied' });
    expect(fixes).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('stop removes the active watcher (idempotent)', async () => {
    await watcher.start({}, () => {});
    await watcher.stop();
    expect(plugin.removed).toEqual(['bg-watch-1']);
    expect(watcher.isWatching).toBe(false);
    await watcher.stop(); // no-op, no throw
  });

  it('ignores stale callbacks after stop', async () => {
    const fixes: RecordedPoint[] = [];
    const errors: unknown[] = [];
    await watcher.start({}, (p) => fixes.push(p), (e) => errors.push(e));
    await watcher.stop();

    plugin.emit(loc(45, -73), null);
    plugin.emit(null, { code: 'NOT_AUTHORIZED' });

    expect(fixes).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('does not start a second watcher while one is active', async () => {
    await watcher.start({}, () => {});
    await watcher.start({}, () => {});
    expect(plugin.addCalls).toBe(1);
  });

  it('does not start a second watcher while one is still being created', async () => {
    const slow = createFakePlugin({ idDelayMs: 20 });
    const w = new BackgroundGeolocationWatcher(slow, async () => 'granted');

    const firstStart = w.start({}, () => {});
    const secondStart = w.start({}, () => {});
    await Promise.all([firstStart, secondStart]);

    expect(slow.addCalls).toBe(1);
    expect(w.isWatching).toBe(true);
  });

  it('tears down a watcher whose addWatcher resolves AFTER a stop() (no leak)', async () => {
    const slow = createFakePlugin({ idDelayMs: 20 });
    const w = new BackgroundGeolocationWatcher(slow, async () => 'granted');
    const starting = w.start({}, () => {});
    await w.stop(); // lands while addWatcher is still resolving
    await starting;
    // The just-created watcher is cleared rather than adopted.
    expect(slow.removed).toEqual(['bg-watch-1']);
    expect(w.isWatching).toBe(false);
  });

  it('drops fixes from a watcher that resolved after being superseded', async () => {
    const slow = createFakePlugin({ idDelayMs: 20 });
    const w = new BackgroundGeolocationWatcher(slow, async () => 'granted');
    const fixes: RecordedPoint[] = [];

    const starting = w.start({}, (p) => fixes.push(p));
    await w.stop(); // supersede the start mid-addWatcher
    await starting;

    // The superseded watcher delivers a late fix; the generation guard ignores it
    // so a stopped recording can't keep buffering points.
    slow.emit(loc(45, -73));
    expect(fixes).toHaveLength(0);
  });

  it('retries the transient service-binding startup failure', async () => {
    const flaky = createFakePlugin();
    const addWatcher = vi.spyOn(flaky, 'addWatcher');
    addWatcher.mockRejectedValueOnce(new Error('Service is not running'));
    const w = new BackgroundGeolocationWatcher(flaky, async () => 'granted');

    await w.start({}, () => {});

    expect(addWatcher).toHaveBeenCalledTimes(2);
    expect(w.isWatching).toBe(true);
  });

  it('gives up (throws) after exhausting service-binding retries', async () => {
    const flaky = createFakePlugin();
    const addWatcher = vi.spyOn(flaky, 'addWatcher');
    addWatcher.mockRejectedValue(new Error('Service is not running'));
    const w = new BackgroundGeolocationWatcher(flaky, async () => 'granted');

    await expect(w.start({}, () => {})).rejects.toThrow(/service is not running/i);
    expect(addWatcher).toHaveBeenCalledTimes(3);
    expect(w.isWatching).toBe(false);
  });

  it('does not retry a non-service-binding startup error', async () => {
    const flaky = createFakePlugin();
    const addWatcher = vi.spyOn(flaky, 'addWatcher');
    addWatcher.mockRejectedValue(new Error('Some other failure'));
    const w = new BackgroundGeolocationWatcher(flaky, async () => 'granted');

    await expect(w.start({}, () => {})).rejects.toThrow(/some other failure/i);
    expect(addWatcher).toHaveBeenCalledTimes(1);
  });
});
