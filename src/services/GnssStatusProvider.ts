/**
 * GnssStatusProvider -- pluggable source of live multi-constellation satellite
 * status for the GPS averaging UI.
 *
 * Why an abstraction (and why the default is "unsupported"):
 * - Live per-constellation / multi-band status is only obtainable on **Android**
 *   via the native `GnssStatus` / `GnssMeasurement` APIs.
 * - **iOS** (CoreLocation) and the **web** expose no satellite detail at all --
 *   they hand apps a high-level position only. There is no public API to get it.
 * - `@capacitor/geolocation` surfaces none of this on any platform.
 *
 * So the default provider reports `supported: false`, and the UI honestly shows
 * "status unavailable" instead of fabricating green/red ticks. A native Android
 * provider can be wired in later (DI via `useGpsAveraging`) to light up real
 * per-constellation checks. See docs/gps-tracks.md.
 */

import type { GnssStatusSnapshot } from '../types/gnss';

export interface GnssStatusProvider {
  /** Whether this provider can report live satellite status on this platform. */
  isSupported(): boolean;
  /** Begin emitting snapshots. Safe to call when already started (idempotent). */
  start(onSnapshot: (snapshot: GnssStatusSnapshot) => void): Promise<void> | void;
  /** Stop emitting and release any native listener. */
  stop(): Promise<void> | void;
}

/** The snapshot shown when no platform data is available. */
export const UNSUPPORTED_GNSS_SNAPSHOT: GnssStatusSnapshot = {
  supported: false,
  multiBand: null,
  constellations: [],
};

class UnsupportedGnssStatusProvider implements GnssStatusProvider {
  isSupported(): boolean {
    return false;
  }

  start(onSnapshot: (snapshot: GnssStatusSnapshot) => void): void {
    onSnapshot(UNSUPPORTED_GNSS_SNAPSHOT);
  }

  stop(): void {
    // No-op: nothing is subscribed.
  }
}

/**
 * Default provider. Returns the no-op "unsupported" provider until a native
 * Android `GnssStatus` plugin is available; iOS/web can never support this.
 */
export function createDefaultGnssStatusProvider(): GnssStatusProvider {
  return new UnsupportedGnssStatusProvider();
}
