/**
 * GNSS (multi-constellation) satellite-status types.
 *
 * Modern phone receivers track multiple constellations (GPS, GLONASS, Galileo,
 * BeiDou, QZSS, SBAS) and, on capable hardware, multiple frequency bands
 * (L1 + L5/E5/B2a). The OS/GNSS chip fuses whatever it can automatically; the
 * app cannot choose the mix, only request high accuracy.
 *
 * Live per-constellation status is exposable ONLY on Android (via the native
 * `GnssStatus` API). iOS (CoreLocation) and the web expose nothing -- they hand
 * apps a high-level position with no satellite detail. So a snapshot is marked
 * `supported: false` on those platforms and the UI shows the constellations as
 * "status unavailable" rather than guessing. See docs/gps-tracks.md.
 */

export type GnssConstellationId =
  | 'gps'
  | 'glonass'
  | 'galileo'
  | 'beidou'
  | 'qzss'
  | 'sbas'
  | 'irnss';

export interface GnssConstellationStatus {
  id: GnssConstellationId;
  /**
   * `true`  -> satellites of this constellation are used in the current fix
   * `false` -> visible but not used (or none visible)
   * `null`  -> unknown / not reportable on this platform
   */
  inUse: boolean | null;
  satellitesUsed?: number;
  satellitesVisible?: number;
}

export interface GnssStatusSnapshot {
  /** Whether the platform can report live satellite status at all. */
  supported: boolean;
  /**
   * `true` if any used satellite reports a second frequency band (L5/E5/B2a),
   * i.e. a multi-band fix; `null` when unknown/unavailable.
   */
  multiBand: boolean | null;
  constellations: GnssConstellationStatus[];
}
