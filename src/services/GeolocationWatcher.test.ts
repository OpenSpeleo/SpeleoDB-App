import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GeolocationWatcher,
  type GeolocationLike,
  type PluginPosition,
} from './GeolocationWatcher';
import type { RecordedPoint } from '../types/gpsTrack';

type WatchCallback = (position: PluginPosition | null, err?: unknown) => void;

/** A controllable fake of the Capacitor Geolocation plugin. */
function createFakeGeo() {
  let callback: WatchCallback | null = null;
  const cleared: string[] = [];
  const geo: GeolocationLike & {
    emit: (pos: PluginPosition | null, err?: unknown) => void;
    cleared: string[];
    permission: string;
  } = {
    permission: 'granted',
    cleared,
    async requestPermissions() {
      return { location: geo.permission };
    },
    async watchPosition(_options, cb) {
      callback = cb;
      return 'watch-1';
    },
    async clearWatch({ id }) {
      cleared.push(id);
    },
    emit(pos, err) {
      callback?.(pos, err);
    },
  };
  return geo;
}

function position(lat: number, lng: number, accuracy: number | null = 5, ts = 0): PluginPosition {
  return {
    coords: { latitude: lat, longitude: lng, accuracy, altitude: 100, altitudeAccuracy: 8 },
    timestamp: ts,
  };
}

describe('GeolocationWatcher', () => {
  let geo: ReturnType<typeof createFakeGeo>;
  let watcher: GeolocationWatcher;

  beforeEach(() => {
    geo = createFakeGeo();
    watcher = new GeolocationWatcher(geo);
  });

  it('reports the granted permission state', async () => {
    geo.permission = 'denied';
    expect(await watcher.requestPermissions()).toBe('denied');
  });

  it('normalizes positions into RecordedPoint and emits them', async () => {
    const fixes: RecordedPoint[] = [];
    await watcher.start({}, (p) => fixes.push(p));
    geo.emit(position(45, -73, 4, 1234));

    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toEqual({
      latitude: 45,
      longitude: -73,
      altitude: 100,
      accuracy: 4,
      altitudeAccuracy: 8,
      timestamp: 1234,
    });
    expect(watcher.isWatching).toBe(true);
  });

  it('forwards every fix without filtering (gating lives in shouldAcceptFix)', async () => {
    const fixes: RecordedPoint[] = [];
    await watcher.start({ enableHighAccuracy: true }, (p) => fixes.push(p));
    // Poor accuracy and a near-stationary repeat are NOT dropped here; the
    // shared time gate at the call site decides what to keep.
    geo.emit(position(45, -73, 50));
    geo.emit(position(45, -73, 5));
    geo.emit(position(45, -73, 5));
    expect(fixes.map((f) => f.accuracy)).toEqual([50, 5, 5]);
  });

  it('forwards watch errors to onError and does not emit a fix', async () => {
    const fixes: RecordedPoint[] = [];
    const onError = vi.fn();
    await watcher.start({}, (p) => fixes.push(p), onError);
    geo.emit(null, new Error('permission revoked'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(fixes).toHaveLength(0);
  });

  it('ignores null positions without error', async () => {
    const fixes: RecordedPoint[] = [];
    await watcher.start({}, (p) => fixes.push(p));
    geo.emit(null);
    expect(fixes).toHaveLength(0);
  });

  it('start is a no-op while already watching', async () => {
    const spy = vi.spyOn(geo, 'watchPosition');
    await watcher.start({}, () => {});
    await watcher.start({}, () => {});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('start is a no-op while a watch is still being created', async () => {
    let resolveWatch: (id: string) => void = () => {};
    const racingGeo = {
      requestPermissions: vi.fn(async () => ({ location: 'granted' })),
      watchPosition: vi.fn(
        () => new Promise<string>((resolve) => { resolveWatch = resolve; }),
      ),
      clearWatch: vi.fn(async () => {}),
    } as unknown as GeolocationLike;
    const racingWatcher = new GeolocationWatcher(racingGeo);

    const firstStart = racingWatcher.start({}, () => {});
    const secondStart = racingWatcher.start({}, () => {});
    resolveWatch('watch-1');
    await Promise.all([firstStart, secondStart]);

    expect(racingGeo.watchPosition).toHaveBeenCalledTimes(1);
    expect(racingWatcher.isWatching).toBe(true);
  });

  it('stop clears the active watch and resets state', async () => {
    await watcher.start({}, () => {});
    await watcher.stop();
    expect(geo.cleared).toEqual(['watch-1']);
    expect(watcher.isWatching).toBe(false);
  });

  it('ignores stale fix callbacks after stop', async () => {
    const fixes: RecordedPoint[] = [];
    await watcher.start({}, (p) => fixes.push(p));
    await watcher.stop();

    geo.emit(position(45, -73, 5));

    expect(fixes).toHaveLength(0);
  });

  it('stop is safe when not watching', async () => {
    await expect(watcher.stop()).resolves.toBeUndefined();
    expect(geo.cleared).toEqual([]);
  });

  it('swallows clearWatch failures during teardown', async () => {
    geo.clearWatch = vi.fn(async () => {
      throw new Error('clear failed');
    });
    await watcher.start({}, () => {});
    await expect(watcher.stop()).resolves.toBeUndefined();
    expect(watcher.isWatching).toBe(false);
  });

  it('does NOT leak a watch when stop() races a start() that is still resolving', async () => {
    // watchPosition resolves slowly so we can stop() mid-start (the real race
    // on Reset / quick Stop). The just-created watch must be cleared, not left
    // running in the background.
    let resolveWatch: (id: string) => void = () => {};
    const cleared: string[] = [];
    const racingGeo = {
      requestPermissions: vi.fn(async () => ({ location: 'granted' })),
      watchPosition: vi.fn(
        () => new Promise<string>((resolve) => { resolveWatch = resolve; }),
      ),
      clearWatch: vi.fn(async ({ id }: { id: string }) => { cleared.push(id); }),
    } as unknown as GeolocationLike;
    const racingWatcher = new GeolocationWatcher(racingGeo);

    const startPromise = racingWatcher.start({}, () => {});
    // Stop before the watch id is delivered.
    await racingWatcher.stop();
    // Now the watch id arrives late.
    resolveWatch('late-watch');
    await startPromise;

    // The superseded watch was cleared, and we are not watching.
    expect(cleared).toEqual(['late-watch']);
    expect(racingWatcher.isWatching).toBe(false);
  });

  it('drops fixes delivered by a watch that resolved after being superseded', async () => {
    // Beyond clearing the leaked watch, the generation guard must also swallow
    // any fix the late callback delivers, so a superseded start never feeds the
    // averaging/recording buffer.
    let resolveWatch: (id: string) => void = () => {};
    const captured: { cb: WatchCallback | null } = { cb: null };
    const racingGeo = {
      requestPermissions: vi.fn(async () => ({ location: 'granted' })),
      watchPosition: vi.fn((_options: unknown, cb: WatchCallback) => {
        captured.cb = cb;
        return new Promise<string>((resolve) => { resolveWatch = resolve; });
      }),
      clearWatch: vi.fn(async () => {}),
    } as unknown as GeolocationLike;
    const racingWatcher = new GeolocationWatcher(racingGeo);
    const fixes: RecordedPoint[] = [];

    const startPromise = racingWatcher.start({}, (p) => fixes.push(p));
    await racingWatcher.stop();
    resolveWatch('late-watch');
    await startPromise;

    // The superseded watch fires a fix late; it must be ignored.
    captured.cb?.(position(45, -73, 5));
    expect(fixes).toHaveLength(0);
  });

  it('keeps watching after a Reset-style stop()+start() restart', async () => {
    // Mirrors the hook re-running its effect on Reset: stop() then start().
    await watcher.start({}, () => {});
    await watcher.stop();
    await watcher.start({}, () => {});
    expect(watcher.isWatching).toBe(true);
    // A fix still flows to the new listener.
    const fixes: unknown[] = [];
    await watcher.stop();
    await watcher.start({}, (p) => fixes.push(p));
    geo.emit(position(45, -73, 5));
    expect(fixes).toHaveLength(1);
  });
});
