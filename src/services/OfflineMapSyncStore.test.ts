import { describe, expect, it, vi } from 'vitest';
import { allowConsoleError } from '../test/consoleGuard';
import type { OfflineMapSyncSnapshot } from '../types/offlineMapSync';
import {
  EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
  OfflineMapSyncStore,
} from './OfflineMapSyncStore';

function snapshot(completedTiles: number): OfflineMapSyncSnapshot {
  return {
    ...EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
    sessionId: 'session-1',
    phase: 'downloading',
    coordinateCount: 10,
    enabledLayerCount: 1,
    totalTiles: 10,
    completedTiles,
  };
}

describe('OfflineMapSyncStore', () => {
  it('applies every tile transition immediately and notifies React once at the next paint', () => {
    const paints: Array<() => void> = [];
    const store = new OfflineMapSyncStore((callback) => {
      paints.push(callback);
      return () => {};
    });
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish(snapshot(1));
    expect(store.getSnapshot().completedTiles).toBe(1);
    store.publish(snapshot(2));
    expect(store.getSnapshot().completedTiles).toBe(2);
    expect(listener).not.toHaveBeenCalled();
    expect(paints).toHaveLength(1);

    paints[0]();
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot().completedTiles).toBe(2);
  });

  it('publishes phase transitions immediately without waiting for a timer', () => {
    const store = new OfflineMapSyncStore(() => () => {});
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish(snapshot(0), true);

    expect(listener).toHaveBeenCalledOnce();
  });

  it('notifies within 50 ms when a WebView does not deliver an animation frame', () => {
    vi.useFakeTimers();
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();
    try {
      const store = new OfflineMapSyncStore();
      const listener = vi.fn();
      store.subscribe(listener);

      store.publish(snapshot(1));
      vi.advanceTimersByTime(49);
      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
      vi.useRealTimers();
    }
  });

  it('is safe when a mocked animation frame invokes synchronously', () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    globalThis.cancelAnimationFrame = vi.fn();
    try {
      const store = new OfflineMapSyncStore();
      const listener = vi.fn();
      store.subscribe(listener);
      expect(() => store.publish(snapshot(1))).not.toThrow();
      expect(listener).toHaveBeenCalledOnce();
      store.publish(snapshot(2));
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it('isolates throwing listeners and defers listeners added during notification', () => {
    const paints: Array<() => void> = [];
    const store = new OfflineMapSyncStore((callback) => {
      paints.push(callback);
      return () => {};
    });
    const late = vi.fn();
    const healthy = vi.fn();
    allowConsoleError('Offline-map progress listener failed:', expect.any(Error));
    store.subscribe(() => {
      store.subscribe(late);
      throw new Error('observer failure');
    });
    store.subscribe(healthy);

    store.publish(snapshot(1));
    paints.shift()!();

    expect(healthy).toHaveBeenCalledOnce();
    expect(late).not.toHaveBeenCalled();
  });

  it('cancels a scheduled notification when disposed', () => {
    let paint: (() => void) | null = null;
    const cancel = vi.fn();
    const store = new OfflineMapSyncStore((callback) => {
      paint = callback;
      return cancel;
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.publish(snapshot(1));
    store.dispose();
    expect(cancel).toHaveBeenCalledOnce();
    (paint as unknown as () => void)();
    expect(listener).not.toHaveBeenCalled();
  });
});
