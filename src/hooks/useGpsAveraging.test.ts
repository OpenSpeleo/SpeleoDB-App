import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGpsAveraging } from './useGpsAveraging';
import type { GeolocationWatcher } from '../services/GeolocationWatcher';
import type { RecordedPoint } from '../types/gpsTrack';

function createFakeWatcher(permission = 'granted') {
  let onFix: ((p: RecordedPoint) => void) | undefined;
  const watcher = {
    permission,
    requestPermissions: vi.fn(async () => watcher.permission),
    start: vi.fn(async (_opts: unknown, fix: (p: RecordedPoint) => void) => {
      onFix = fix;
    }),
    stop: vi.fn(async () => {}),
    emit(p: RecordedPoint) {
      onFix?.(p);
    },
  };
  return watcher as unknown as GeolocationWatcher & {
    permission: string;
    emit: (p: RecordedPoint) => void;
    requestPermissions: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
}

// Fixes carry epoch-style timestamps; the hook drops any older than the session
// start (minus a grace), so tests anchor timestamps to a realistic NOW.
const NOW = 1_700_000_000_000;

function fix(lat: number, lng: number, ts: number, accuracy = 5): RecordedPoint {
  return { latitude: lat, longitude: lng, altitude: 100, accuracy, altitudeAccuracy: 8, timestamp: ts };
}

describe('useGpsAveraging', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it('is idle and produces no result when inactive', () => {
    const watcher = createFakeWatcher();
    const { result } = renderHook(() => useGpsAveraging(false, { watcher }));
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(watcher.requestPermissions).not.toHaveBeenCalled();
  });

  it('collects fixes and aggregates a result when active', async () => {
    const watcher = createFakeWatcher();
    let now = 1000;
    const { result } = renderHook(() =>
      useGpsAveraging(true, { watcher, nowFn: () => now }),
    );

    await waitFor(() => expect(watcher.start).toHaveBeenCalled());

    act(() => {
      now = 1000;
      watcher.emit(fix(45, -73, 1000));
      now = 2000;
      watcher.emit(fix(45.0001, -73, 2000));
    });

    await waitFor(() => expect(result.current.sampleCount).toBe(2));
    expect(result.current.status).toBe('collecting');
    expect(result.current.result?.latitude).toBeCloseTo(45.00005, 4);
  });

  it('drops the OS last-known (stale) fix replayed on watch start; timer stays at 0', async () => {
    const watcher = createFakeWatcher();
    let now = NOW;
    const { result } = renderHook(() => useGpsAveraging(true, { watcher, nowFn: () => now }));
    await waitFor(() => expect(watcher.start).toHaveBeenCalled());

    act(() => {
      // iOS replays a 60s-old cached fix first -> must be ignored.
      watcher.emit(fix(45, -73, NOW - 60_000));
      // ...followed by an 8s-old one -> also ignored.
      watcher.emit(fix(45, -73, NOW - 8_000));
    });
    // Neither stale fix is counted, so the session has not really started.
    expect(result.current.sampleCount).toBe(0);
    expect(result.current.result).toBeNull();

    // The first genuinely fresh fix is accepted and the timer starts near 0.
    act(() => {
      now = NOW + 500;
      watcher.emit(fix(45.0001, -73, NOW + 500));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(1));
    expect(result.current.result?.elapsedMs ?? 0).toBeLessThan(2000);
  });

  it('throttles a sub-second burst to ~1 sample/sec (no jump to 3)', async () => {
    const watcher = createFakeWatcher();
    let now = NOW;
    const { result } = renderHook(() => useGpsAveraging(true, { watcher, nowFn: () => now }));
    await waitFor(() => expect(watcher.start).toHaveBeenCalled());

    act(() => {
      // A warm-GPS burst: 3 fixes within ~150ms of each other, all fresh.
      watcher.emit(fix(45, -73, NOW));
      watcher.emit(fix(45.00001, -73, NOW + 50));
      watcher.emit(fix(45.00002, -73, NOW + 150));
    });
    // Only the first is kept; the sub-second followers are throttled.
    await waitFor(() => expect(result.current.sampleCount).toBe(1));

    // A fix ~1s later is accepted, so the count climbs one at a time.
    act(() => {
      now = NOW + 1100;
      watcher.emit(fix(45.0001, -73, NOW + 1100));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(2));
  });

  it('exposes the unsupported GNSS snapshot by default', () => {
    const watcher = createFakeWatcher();
    const { result } = renderHook(() => useGpsAveraging(false, { watcher }));
    expect(result.current.gnss).toEqual({ supported: false, multiBand: null, constellations: [] });
  });

  it('subscribes to the injected GNSS provider while active and stops on deactivate', async () => {
    const watcher = createFakeWatcher();
    const snapshot = {
      supported: true,
      multiBand: true,
      constellations: [{ id: 'gps' as const, inUse: true, satellitesUsed: 8 }],
    };
    const gnssProvider = {
      isSupported: () => true,
      start: vi.fn((cb: (s: typeof snapshot) => void) => {
        cb(snapshot);
      }),
      stop: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useGpsAveraging(active, { watcher, gnssProvider }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(gnssProvider.start).toHaveBeenCalled());
    await waitFor(() => expect(result.current.gnss.supported).toBe(true));
    expect(result.current.gnss.constellations[0].inUse).toBe(true);

    // Pause: the provider is stopped, but the last snapshot is RETAINED (frozen)
    // like the samples -- it is cleared only on Reset.
    rerender({ active: false });
    await waitFor(() => expect(gnssProvider.stop).toHaveBeenCalled());
    expect(result.current.gnss.supported).toBe(true);
  });

  it('clears samples and re-acquires when restartNonce changes', async () => {
    const watcher = createFakeWatcher();
    const { result, rerender } = renderHook(
      ({ nonce }: { nonce: number }) =>
        useGpsAveraging(true, { watcher, restartNonce: nonce, nowFn: () => NOW }),
      { initialProps: { nonce: 0 } },
    );
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(1));

    act(() => {
      watcher.emit(fix(45, -73, NOW));
      watcher.emit(fix(45.0001, -73, NOW + 1000));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(2));

    // Reset: bump the nonce -> samples cleared + watch restarted.
    rerender({ nonce: 1 });
    await waitFor(() => expect(result.current.sampleCount).toBe(0));
    expect(watcher.stop).toHaveBeenCalled();
    expect(watcher.start).toHaveBeenCalledTimes(2);
  });

  it('stopwatch: Stop keeps samples; Start resumes and continues appending', async () => {
    const watcher = createFakeWatcher();
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useGpsAveraging(active, { watcher, nowFn: () => NOW }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(1));

    act(() => {
      watcher.emit(fix(45, -73, NOW));
      watcher.emit(fix(45.0001, -73, NOW + 1000));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(2));

    // Stop (pause): watch released, but samples are RETAINED (not wiped).
    rerender({ active: false });
    await waitFor(() => expect(watcher.stop).toHaveBeenCalled());
    expect(result.current.sampleCount).toBe(2);
    expect(result.current.result).not.toBeNull();

    // Start (resume): continues appending to the same set.
    rerender({ active: true });
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(2));
    act(() => {
      watcher.emit(fix(45.0002, -73, NOW + 2000));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(3));
  });

  it('stopwatch: resume keeps the one-second throttle from the retained sample set', async () => {
    const watcher = createFakeWatcher();
    let now = NOW;
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useGpsAveraging(active, { watcher, nowFn: () => now }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(1));

    act(() => {
      watcher.emit(fix(45, -73, NOW));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(1));

    rerender({ active: false });
    await waitFor(() => expect(watcher.stop).toHaveBeenCalled());
    now = NOW + 500;
    rerender({ active: true });
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(2));

    act(() => {
      watcher.emit(fix(45.0001, -73, NOW + 500));
    });
    expect(result.current.sampleCount).toBe(1);

    act(() => {
      now = NOW + 1000;
      watcher.emit(fix(45.0002, -73, NOW + 1000));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(2));
  });

  it('stopwatch: resume drops stale replayed fixes but accepts fresh fixes with slight timestamp lag', async () => {
    const watcher = createFakeWatcher();
    let now = NOW;
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useGpsAveraging(active, { watcher, nowFn: () => now }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(1));

    act(() => {
      watcher.emit(fix(45, -73, NOW));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(1));

    rerender({ active: false });
    await waitFor(() => expect(watcher.stop).toHaveBeenCalled());
    now = NOW + 10_000;
    rerender({ active: true });
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(2));

    act(() => {
      watcher.emit(fix(50, -70, NOW + 5_000)); // stale replay from before resume
      watcher.emit(fix(45.0002, -73, NOW + 9_500)); // fresh, but clock-lagged
    });

    await waitFor(() => expect(result.current.sampleCount).toBe(2));
    expect(result.current.result?.latitude).toBeCloseTo(45.0001, 4);
  });

  it('stopwatch: paused wall time does not inflate elapsed time or confidence', async () => {
    const watcher = createFakeWatcher();
    let now = NOW;
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useGpsAveraging(active, { watcher, nowFn: () => now }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(1));

    act(() => {
      watcher.emit(fix(45, -73, NOW));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(1));

    now = NOW + 10_000;
    rerender({ active: false });
    await waitFor(() => expect(watcher.stop).toHaveBeenCalled());

    now = NOW + 70_000;
    rerender({ active: true });
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(2));
    act(() => {
      watcher.emit(fix(45.0002, -73, NOW + 70_000));
    });

    await waitFor(() => expect(result.current.sampleCount).toBe(2));
    expect(result.current.result?.elapsedMs).toBeLessThan(12_000);
  });

  it('stopwatch: Reset while paused clears the retained samples', async () => {
    const watcher = createFakeWatcher();
    const { result, rerender } = renderHook(
      ({ active, nonce }: { active: boolean; nonce: number }) =>
        useGpsAveraging(active, { watcher, restartNonce: nonce, nowFn: () => NOW }),
      { initialProps: { active: true, nonce: 0 } },
    );
    await waitFor(() => expect(watcher.start).toHaveBeenCalled());
    act(() => {
      watcher.emit(fix(45, -73, NOW));
      watcher.emit(fix(45.0001, -73, NOW + 1000));
    });
    await waitFor(() => expect(result.current.sampleCount).toBe(2));

    // Pause, then Reset while paused -> samples cleared even though inactive.
    rerender({ active: false, nonce: 0 });
    expect(result.current.sampleCount).toBe(2);
    rerender({ active: false, nonce: 1 });
    await waitFor(() => expect(result.current.sampleCount).toBe(0));
    expect(result.current.result).toBeNull();
  });

  it('reports permission-denied and never starts the watch', async () => {
    const watcher = createFakeWatcher('denied');
    const { result } = renderHook(() => useGpsAveraging(true, { watcher }));
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
    expect(watcher.start).not.toHaveBeenCalled();
  });

  it('stops the watch on deactivate/unmount', async () => {
    const watcher = createFakeWatcher();
    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useGpsAveraging(active, { watcher }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(watcher.start).toHaveBeenCalled());

    rerender({ active: false });
    await waitFor(() => expect(watcher.stop).toHaveBeenCalled());

    unmount();
  });

  it('stops the watch when unmounted while STILL active (no leaked watch)', async () => {
    const watcher = createFakeWatcher();
    const { unmount } = renderHook(() => useGpsAveraging(true, { watcher }));
    await waitFor(() => expect(watcher.start).toHaveBeenCalled());

    // Unmount without deactivating first: the effect cleanup must still tear the
    // watch down, or a collector closed mid-session would read GPS forever.
    unmount();
    await waitFor(() => expect(watcher.stop).toHaveBeenCalled());
  });

  it('advances elapsed time on the one-second tick without new fixes', async () => {
    vi.useFakeTimers();
    const watcher = createFakeWatcher();
    let now = 0;
    const { result } = renderHook(() => useGpsAveraging(true, { watcher, nowFn: () => now }));

    // Let the async permission/start resolve under fake timers.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      now = 0;
      watcher.emit(fix(45, -73, 0));
    });
    expect(result.current.result?.elapsedMs).toBe(0);

    act(() => {
      now = 5000;
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.result?.elapsedMs).toBe(5000);
  });
});
