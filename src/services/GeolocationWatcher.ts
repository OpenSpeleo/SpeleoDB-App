/**
 * GeolocationWatcher -- a thin, testable wrapper over `@capacitor/geolocation`
 * `watchPosition`. It normalizes platform `Position` objects into the app's
 * `RecordedPoint` shape and forwards every fix; all sampling decisions (drop
 * pre-session replays + throttle by time) live in the shared `shouldAcceptFix`
 * gate at the call sites, so the watcher applies no filters of its own.
 *
 * The underlying plugin is injectable so the controller and tests can drive it
 * deterministically without a device. The watcher owns no business state beyond
 * the live watch id.
 *
 * See docs/gps-tracks.md.
 */

import { Geolocation } from '@capacitor/geolocation';
import type { RecordedPoint } from '../types/gpsTrack';

// ==================== Injectable plugin surface ====================

export interface PluginPosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
  };
  timestamp: number;
}

export interface PluginPositionOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  interval?: number;
  minimumUpdateInterval?: number;
}

export interface GeolocationLike {
  requestPermissions(options?: { permissions?: string[] }): Promise<{ location: string }>;
  watchPosition(
    options: PluginPositionOptions,
    callback: (position: PluginPosition | null, err?: unknown) => void,
  ): Promise<string>;
  clearWatch(options: { id: string }): Promise<void>;
}

// ==================== Watcher ====================

/**
 * Options for starting a watch -- just the plugin's position options. The old
 * `maxAccuracyMeters`/`minDistanceMeters` filters were removed once both GPS
 * features moved to the shared time-based `shouldAcceptFix` gate (no caller set
 * them, and the min-distance filter once dropped every fix against the OS's
 * replayed last-known location).
 */
export type WatchOptions = PluginPositionOptions;

export type FixListener = (point: RecordedPoint) => void;
export type WatchErrorListener = (error: unknown) => void;

/**
 * The minimal watcher contract the controller's track recorder depends on. Both
 * the foreground `GeolocationWatcher` (web / averaging) and the native
 * `BackgroundGeolocationWatcher` (background-capable recording) implement it, so
 * recording can swap providers by platform without touching the controller. The
 * shared `shouldAcceptFix` gate still governs which fixes are kept either way.
 */
export interface LocationWatcher {
  requestPermissions(): Promise<string>;
  start(options: WatchOptions, onFix: FixListener, onError?: WatchErrorListener): Promise<void>;
  stop(): Promise<void>;
}

function normalizePosition(position: PluginPosition): RecordedPoint {
  const c = position.coords;
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    altitude: c.altitude ?? null,
    accuracy: c.accuracy ?? null,
    altitudeAccuracy: c.altitudeAccuracy ?? null,
    timestamp: position.timestamp ?? Date.now(),
  };
}

export class GeolocationWatcher implements LocationWatcher {
  private watchId: string | null = null;
  private starting: Promise<void> | null = null;
  // Monotonic token bumped by every start()/stop(). `watchPosition` is async, so
  // a stop() (or a re-start) can land WHILE a start() is still awaiting its
  // watch id. The generation lets a resolving start detect that it has been
  // superseded and immediately clear the watch instead of leaking a GPS
  // subscription that runs forever in the background.
  private generation = 0;

  constructor(private geo: GeolocationLike = Geolocation as unknown as GeolocationLike) {}

  get isWatching(): boolean {
    return this.watchId !== null;
  }

  /** Request location permission; returns the granted state string. */
  async requestPermissions(): Promise<string> {
    const status = await this.geo.requestPermissions({ permissions: ['location'] });
    return status.location;
  }

  /**
   * Start a position watch. Each fix is normalized and passed to `onFix`; watch
   * errors are passed to `onError`. No filtering happens here -- the shared
   * `shouldAcceptFix` gate at the call site decides what to keep. Calling start
   * while already watching is a no-op.
   */
  async start(options: WatchOptions, onFix: FixListener, onError?: WatchErrorListener): Promise<void> {
    if (this.watchId !== null) return;
    if (this.starting) return this.starting;

    const startPromise = (async () => {
      const gen = ++this.generation;

      const id = await this.geo.watchPosition(options, (position, err) => {
        if (gen !== this.generation) return;
        if (err) {
          onError?.(err);
          return;
        }
        if (!position) return;
        onFix(normalizePosition(position));
      });

      // If a stop() (or another start()) ran while we were awaiting the watch id,
      // this start has been superseded -- clear the just-created watch instead of
      // adopting it, so it does not keep reading GPS in the background.
      if (gen !== this.generation) {
        try {
          await this.geo.clearWatch({ id });
        } catch {
          // Best-effort.
        }
        return;
      }

      this.watchId = id;
    })();
    const trackedStart = startPromise.finally(() => {
      if (this.starting === trackedStart) this.starting = null;
    });
    this.starting = trackedStart;
    return trackedStart;
  }

  /** Stop the active watch (idempotent), including one still being set up. */
  async stop(): Promise<void> {
    // Invalidate any in-flight start() so it clears itself on resolve.
    this.generation++;
    this.starting = null;
    const id = this.watchId;
    this.watchId = null;
    if (id !== null) {
      try {
        await this.geo.clearWatch({ id });
      } catch {
        // Best-effort: a clearWatch failure must not crash recording teardown.
      }
    }
  }
}
