import type { OfflineMapSyncSnapshot } from '../types/offlineMapSync';

export const EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT: OfflineMapSyncSnapshot = Object.freeze({
  sessionId: null,
  phase: 'idle',
  coordinateCount: null,
  enabledLayerCount: 0,
  totalTiles: 0,
  completedTiles: 0,
  failedTiles: 0,
  cachedFreshTiles: 0,
  auditedTiles: 0,
  queuedTiles: 0,
  downloadedTiles: 0,
  activeDownloads: 0,
  bytesDownloaded: 0,
  tilesPerSecond: 0,
  etaSeconds: null,
  cacheBytes: 0,
  blockedByStorage: false,
  coverageTotalTiles: 0,
  coverageCompletedTiles: 0,
  layers: Object.freeze([]),
});

type Listener = () => void;
type PaintScheduler = (callback: () => void) => () => void;

function defaultPaintScheduler(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    let settled = false;
    let frameId: number | null = null;
    let deadlineId: ReturnType<typeof setTimeout> | null = null;
    const runOnce = () => {
      if (settled) return;
      settled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (deadlineId !== null) clearTimeout(deadlineId);
      callback();
    };
    // Some mobile WebViews defer animation frames during Ionic transitions.
    // A foreground progress update must never wait indefinitely for that frame.
    deadlineId = setTimeout(runOnce, 50);
    frameId = requestAnimationFrame(runOnce);
    return () => {
      settled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (deadlineId !== null) clearTimeout(deadlineId);
    };
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

/**
 * Per-tile state is applied synchronously. React subscribers are notified once
 * at the next paint, independently from IndexedDB checkpoint frequency.
 */
export class OfflineMapSyncStore {
  private snapshot: OfflineMapSyncSnapshot = EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private cancelScheduledPaint: (() => void) | null = null;

  constructor(private readonly schedulePaint: PaintScheduler = defaultPaintScheduler) {}

  getSnapshot = (): OfflineMapSyncSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  publish(snapshot: OfflineMapSyncSnapshot, immediate = false): void {
    this.snapshot = snapshot;
    if (immediate) {
      this.flush();
      return;
    }
    if (this.cancelScheduledPaint) return;
    let invokedSynchronously = false;
    const cancel = this.schedulePaint(() => {
      invokedSynchronously = true;
      this.cancelScheduledPaint = null;
      this.notify();
    });
    this.cancelScheduledPaint = invokedSynchronously ? null : cancel;
  }

  reset(): void {
    this.publish(EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT, true);
  }

  dispose(): void {
    this.cancelScheduledPaint?.();
    this.cancelScheduledPaint = null;
    this.listeners.clear();
  }

  private flush(): void {
    this.cancelScheduledPaint?.();
    this.cancelScheduledPaint = null;
    this.notify();
  }

  private notify(): void {
    const listeners = [...this.listeners];
    for (const listener of listeners) {
      if (!this.listeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        console.error('Offline-map progress listener failed:', error);
      }
    }
  }
}
