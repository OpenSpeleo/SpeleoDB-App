import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RecordedPoint } from '../types/gpsTrack';
import { PERMISSION_DENIED_SENTINEL } from '../utils/geolocationError';
import type { LocationWatcher, WatchErrorListener, FixListener } from '../services/GeolocationWatcher';
import { useLiveUserLocation } from './useLiveUserLocation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function fakeWatcher(permission: string | Promise<string> = 'granted') {
  let onFix: FixListener | null = null;
  let onError: WatchErrorListener | undefined;
  const watcher: LocationWatcher = {
    requestPermissions: vi.fn(() => Promise.resolve(permission)),
    start: vi.fn(async (_options, nextFix, nextError) => {
      onFix = nextFix;
      onError = nextError;
    }),
    stop: vi.fn(async () => undefined),
  };
  return {
    watcher,
    emit(point: RecordedPoint) { onFix?.(point); },
    fail(error: unknown) { onError?.(error); },
  };
}

function point(longitude: number, latitude: number): RecordedPoint {
  return { longitude, latitude, timestamp: Date.now() };
}

describe('useLiveUserLocation', () => {
  it('starts a live watch, centers once, updates, and explicitly deactivates', async () => {
    const fake = fakeWatcher();
    const onFirstFix = vi.fn();
    const { result } = renderHook(() => useLiveUserLocation({
      runtimeActive: true,
      watcher: fake.watcher,
      onFirstFix,
    }));

    act(() => result.current.toggleLocationMode());
    expect(result.current.isLocating).toBe(true);
    await waitFor(() => expect(fake.watcher.start).toHaveBeenCalledWith(
      expect.objectContaining({ interval: 1_000, minimumUpdateInterval: 1_000 }),
      expect.any(Function),
      expect.any(Function),
    ));
    expect(result.current.locationModeActive).toBe(true);

    act(() => fake.emit(point(-73, 45)));
    expect(result.current.location).toEqual({ lng: -73, lat: 45 });
    expect(result.current.isLocating).toBe(false);
    expect(onFirstFix).toHaveBeenCalledOnce();
    act(() => fake.emit(point(-73.1, 45.1)));
    expect(result.current.location).toEqual({ lng: -73.1, lat: 45.1 });
    expect(onFirstFix).toHaveBeenCalledOnce();

    act(() => result.current.toggleLocationMode());
    expect(result.current.locationModeActive).toBe(false);
    expect(result.current.location).toBeNull();
    await waitFor(() => expect(fake.watcher.stop).toHaveBeenCalled());
  });

  it('maps permission denial and watch errors to a disabled, clear state', async () => {
    const denied = fakeWatcher('denied');
    const deniedHook = renderHook(() => useLiveUserLocation({
      runtimeActive: true,
      watcher: denied.watcher,
      onFirstFix: vi.fn(),
    }));
    act(() => deniedHook.result.current.toggleLocationMode());
    await waitFor(() => expect(deniedHook.result.current.error).toBe(PERMISSION_DENIED_SENTINEL));
    expect(denied.watcher.start).not.toHaveBeenCalled();

    const failing = fakeWatcher();
    const failingHook = renderHook(() => useLiveUserLocation({
      runtimeActive: true,
      watcher: failing.watcher,
      onFirstFix: vi.fn(),
    }));
    act(() => failingHook.result.current.toggleLocationMode());
    await waitFor(() => expect(failing.watcher.start).toHaveBeenCalled());
    const error = new Error('location lost');
    act(() => failing.fail(error));
    expect(failingHook.result.current.error).toBe(error);
    expect(failingHook.result.current.locationModeActive).toBe(false);
    expect(failingHook.result.current.location).toBeNull();
    act(() => failingHook.result.current.dismissError());
    expect(failingHook.result.current.error).toBeNull();
  });

  it('cancels delayed permission without leaking a watch', async () => {
    const permission = deferred<string>();
    const fake = fakeWatcher(permission.promise);
    const { result } = renderHook(() => useLiveUserLocation({
      runtimeActive: true,
      watcher: fake.watcher,
      onFirstFix: vi.fn(),
    }));
    act(() => result.current.toggleLocationMode());
    act(() => result.current.toggleLocationMode());
    await act(async () => permission.resolve('granted'));
    expect(fake.watcher.start).not.toHaveBeenCalled();
    expect(result.current.locationModeActive).toBe(false);
    expect(result.current.isLocating).toBe(false);
  });

  it('does not let an old watch-start completion stop a newer activation', async () => {
    const firstStart = deferred<void>();
    const callbacks: FixListener[] = [];
    const watcher: LocationWatcher = {
      requestPermissions: vi.fn(async () => 'granted'),
      start: vi.fn(async (_options, onFix) => {
        callbacks.push(onFix);
        if (callbacks.length === 1) await firstStart.promise;
      }),
      stop: vi.fn(async () => undefined),
    };
    const { result } = renderHook(() => useLiveUserLocation({
      runtimeActive: true,
      watcher,
      onFirstFix: vi.fn(),
    }));

    act(() => result.current.toggleLocationMode());
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(1));
    act(() => result.current.toggleLocationMode());
    act(() => result.current.toggleLocationMode());
    await waitFor(() => expect(watcher.start).toHaveBeenCalledTimes(2));

    await act(async () => firstStart.resolve());
    act(() => callbacks[1]?.(point(2, 46)));

    expect(result.current.locationModeActive).toBe(true);
    expect(result.current.location).toEqual({ lng: 2, lat: 46 });
    expect(watcher.stop).toHaveBeenCalledTimes(1);
  });

  it('suspends and resumes without forgetting mode, location, or re-centering', async () => {
    const fake = fakeWatcher();
    const onFirstFix = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ active }) => useLiveUserLocation({
        runtimeActive: active,
        watcher: fake.watcher,
        onFirstFix,
      }),
      { initialProps: { active: true } },
    );
    act(() => result.current.toggleLocationMode());
    await waitFor(() => expect(fake.watcher.start).toHaveBeenCalledTimes(1));
    act(() => fake.emit(point(2, 46)));
    rerender({ active: false });
    await waitFor(() => expect(fake.watcher.stop).toHaveBeenCalled());
    expect(result.current.locationModeActive).toBe(true);
    expect(result.current.location).toEqual({ lng: 2, lat: 46 });

    rerender({ active: true });
    await waitFor(() => expect(fake.watcher.start).toHaveBeenCalledTimes(2));
    act(() => fake.emit(point(2.1, 46.1)));
    expect(onFirstFix).toHaveBeenCalledOnce();
    unmount();
    await waitFor(() => expect(fake.watcher.stop).toHaveBeenCalledTimes(2));
  });

  it('ignores invalid fixes and contains rejected watch startup', async () => {
    const fake = fakeWatcher();
    vi.mocked(fake.watcher.start).mockRejectedValueOnce(new Error('watch failed'));
    const { result } = renderHook(() => useLiveUserLocation({
      runtimeActive: true,
      watcher: fake.watcher,
      onFirstFix: vi.fn(),
    }));
    act(() => result.current.toggleLocationMode());
    await waitFor(() => expect(result.current.error).toEqual(new Error('watch failed')));

    const validFake = fakeWatcher();
    const valid = renderHook(() => useLiveUserLocation({
      runtimeActive: true,
      watcher: validFake.watcher,
      onFirstFix: vi.fn(),
    }));
    act(() => valid.result.current.toggleLocationMode());
    await waitFor(() => expect(validFake.watcher.start).toHaveBeenCalled());
    act(() => validFake.emit(point(999, 999)));
    expect(valid.result.current.location).toBeNull();
    expect(valid.result.current.isLocating).toBe(true);
  });
});
