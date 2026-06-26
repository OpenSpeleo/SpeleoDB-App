/**
 * BackgroundGeolocationWatcher -- a `LocationWatcher` backed by
 * `@capacitor-community/background-geolocation`. Unlike the stock
 * `@capacitor/geolocation` watcher (foreground only), this keeps delivering
 * fixes while the app is backgrounded or the device is locked, by running a
 * foreground service + persistent notification on Android and enabling
 * background location updates on iOS (requires `UIBackgroundModes: location`).
 *
 * It is used ONLY for GPS track recording on native platforms; the stationary
 * High-Accuracy point collector stays on the foreground watcher. Both still feed
 * the shared `shouldAcceptFix` gate, so sampling logic is identical -- only the
 * native location source differs (background capability is a hard platform
 * requirement, not a duplicated code path).
 *
 * The plugin + the permission requester are injectable so this is testable
 * without a device. Race-safety mirrors `GeolocationWatcher`: a `generation`
 * token lets a `stop()` that lands while `addWatcher` is still resolving tear
 * down the just-created watcher instead of leaking a background subscription.
 *
 * See docs/gps-tracks.md and docs/app-permissions.md.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { RecordedPoint } from '../types/gpsTrack';
import {
  GeolocationWatcher,
  type FixListener,
  type LocationWatcher,
  type WatchErrorListener,
  type WatchOptions,
} from './GeolocationWatcher';
import { GPS } from '../constants';

// ==================== Injectable plugin surface ====================

export interface BackgroundLocation {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  bearing?: number | null;
  speed?: number | null;
  simulated?: boolean;
  /** Epoch ms the fix was produced. */
  time?: number | null;
}

export interface BackgroundWatcherError {
  code?: string;
  message?: string;
}

export interface BackgroundWatcherOptions {
  backgroundTitle?: string;
  backgroundMessage?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
}

export interface BackgroundGeolocationLike {
  addWatcher(
    options: BackgroundWatcherOptions,
    callback: (location?: BackgroundLocation | null, error?: BackgroundWatcherError | null) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings?(): Promise<void>;
}

function defaultPlugin(): BackgroundGeolocationLike {
  return registerPlugin<BackgroundGeolocationLike>('BackgroundGeolocation');
}

/** Default permission requester: reuse Capacitor Geolocation's location prompt. */
async function defaultRequestPermission(): Promise<string> {
  const status = await Geolocation.requestPermissions({ permissions: ['location'] });
  return status.location;
}

// ==================== Watcher ====================

export class BackgroundGeolocationWatcher implements LocationWatcher {
  private watchId: string | null = null;
  private starting: Promise<void> | null = null;
  private generation = 0;

  constructor(
    private bg: BackgroundGeolocationLike = defaultPlugin(),
    private requestLocationPermission: () => Promise<string> = defaultRequestPermission,
  ) {}

  get isWatching(): boolean {
    return this.watchId !== null;
  }

  /**
   * Request location permission up front so the controller can gate on it (and
   * surface a denial) exactly like the foreground watcher. `addWatcher` then
   * escalates to "Always"/background as needed via `requestPermissions: true`.
   */
  async requestPermissions(): Promise<string> {
    return this.requestLocationPermission();
  }

  /**
   * Start a background-capable watch. The `WatchOptions` are accepted for
   * interface parity but the plugin-specific ones (`enableHighAccuracy`,
   * timeouts, accuracy/distance filters) don't apply -- we keep every fix and
   * throttle by time in the shared gate. Defining `backgroundMessage` is what
   * makes the plugin keep tracking in the background.
   */
  async start(_options: WatchOptions, onFix: FixListener, onError?: WatchErrorListener): Promise<void> {
    if (this.watchId !== null) return;
    if (this.starting) return this.starting;

    const startPromise = (async () => {
      const gen = ++this.generation;

      const options = {
        backgroundTitle: GPS.BACKGROUND_TRACKING_TITLE,
        backgroundMessage: GPS.BACKGROUND_TRACKING_MESSAGE,
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      };
      const callback = (location?: BackgroundLocation | null, error?: BackgroundWatcherError | null) => {
        if (gen !== this.generation) return;
        if (error) {
          onError?.(error);
          return;
        }
        if (!location) return;
        onFix(normalizeBackgroundLocation(location));
      };

      const id = await this.addWatcherWithServiceRetry(options, callback);

      // Superseded by a stop()/restart while addWatcher was resolving: tear down
      // the just-created watcher instead of leaking a background subscription.
      if (gen !== this.generation) {
        try {
          await this.bg.removeWatcher({ id });
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
    this.generation++;
    this.starting = null;
    const id = this.watchId;
    this.watchId = null;
    if (id !== null) {
      try {
        await this.bg.removeWatcher({ id });
      } catch {
        // Best-effort: must not crash recording teardown.
      }
    }
  }

  private async addWatcherWithServiceRetry(
    options: BackgroundWatcherOptions,
    callback: (location?: BackgroundLocation | null, error?: BackgroundWatcherError | null) => void,
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.bg.addWatcher(options, callback);
      } catch (error) {
        lastError = error;
        if (!isServiceBindingRace(error) || attempt === 2) break;
        await delay(150 * (attempt + 1));
      }
    }
    throw lastError;
  }
}

function isServiceBindingRace(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /service .*not .*running|not .*bound/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeBackgroundLocation(location: BackgroundLocation): RecordedPoint {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    altitude: location.altitude ?? null,
    accuracy: location.accuracy ?? null,
    altitudeAccuracy: location.altitudeAccuracy ?? null,
    timestamp: location.time ?? Date.now(),
  };
}

/**
 * Recording location provider for the controller: the background-capable
 * watcher on native devices (so recording survives lock/background), and the
 * plain foreground watcher on web (the plugin is native-only, and field
 * recording is a device feature anyway).
 */
export function createRecordingLocationWatcher(): LocationWatcher {
  return Capacitor.isNativePlatform()
    ? new BackgroundGeolocationWatcher()
    : new GeolocationWatcher();
}
