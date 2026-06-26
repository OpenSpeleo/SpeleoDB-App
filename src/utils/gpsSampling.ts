/**
 * gpsSampling -- the single shared "should I keep this GPS fix?" gate used by
 * BOTH the high-accuracy point collector (`useGpsAveraging`) and the track
 * recorder (`SpeleoDBController`). Having one gate means the two features read
 * the GPS identically; they differ only in their `minIntervalMs` (averaging
 * keeps ~1 fix/sec, recording keeps ~1 fix/15s).
 *
 * The gate enforces two rules:
 *  1. **Drop pre-session fixes.** When a watch starts, iOS/Android replay the
 *     device's last-known location (with its *old* timestamp) as the first
 *     reading(s). Those predate the session and would skew the average / add a
 *     spurious jump to a track, so anything older than `sessionStartMs` is
 *     dropped. The session timer then starts at 0 from a real, fresh fix.
 *  2. **Throttle by time.** A warm GPS emits several fixes per second; those are
 *     highly correlated and add nothing, so we keep at most one per
 *     `minIntervalMs`. The FIRST accepted fix is always kept immediately
 *     (`lastAcceptedMs === null`), so acquisition feels instant.
 *
 * See docs/gps-tracks.md.
 */

export interface FixGate {
  /** Epoch ms when the active watch session/segment began. */
  sessionStartMs: number;
  /** Timestamp (epoch ms) of the last accepted fix, or null if none yet. */
  lastAcceptedMs: number | null;
  /** Minimum spacing between accepted fixes (ms). */
  minIntervalMs: number;
}

/**
 * Returns true when a fix at `pointTimestamp` should be accepted given the gate
 * state. Pure -- callers own the `lastAcceptedMs` bookkeeping.
 */
export function shouldAcceptFix(pointTimestamp: number, gate: FixGate): boolean {
  if (!Number.isFinite(pointTimestamp)) return false;
  if (pointTimestamp < gate.sessionStartMs) return false;
  if (
    gate.lastAcceptedMs !== null &&
    pointTimestamp - gate.lastAcceptedMs < gate.minIntervalMs
  ) {
    return false;
  }
  return true;
}
