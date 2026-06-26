/**
 * useGpsAveraging -- owns a live GPS averaging session with stopwatch semantics.
 *
 * While `active`, it requests location permission, starts a high-accuracy
 * position watch (no recording filters -- averaging wants every fix), collects
 * samples, and recomputes the averaged point + confidence on each fix and once
 * per second (so elapsed time advances between fixes).
 *
 * Stopwatch model: toggling `active` false (Stop) pauses the watch but **keeps**
 * the collected samples + last result frozen; toggling it true again (Start)
 * resumes and **continues** appending to the same set. Samples are cleared ONLY
 * when `restartNonce` changes (Reset). All side effects live here;
 * `GpsAveragingModal` stays presentational. The watcher + clock are injectable
 * for tests.
 *
 * See docs/gps-tracks.md.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { GeolocationWatcher } from '../services/GeolocationWatcher';
import {
  aggregateSamples,
  DEFAULT_AVERAGING_CONFIG,
  type AccuracySample,
  type AveragingConfig,
  type AveragingResult,
} from '../utils/gpsAveraging';
import {
  createDefaultGnssStatusProvider,
  UNSUPPORTED_GNSS_SNAPSHOT,
  type GnssStatusProvider,
} from '../services/GnssStatusProvider';
import type { GnssStatusSnapshot } from '../types/gnss';
import { GPS } from '../constants';
import type { RecordedPoint } from '../types/gpsTrack';
import { shouldAcceptFix } from '../utils/gpsSampling';

export type AveragingStatus = 'idle' | 'acquiring' | 'collecting' | 'permission-denied' | 'error';

export interface UseGpsAveraging {
  status: AveragingStatus;
  result: AveragingResult | null;
  sampleCount: number;
  /** Live multi-constellation satellite status (or "unsupported" snapshot). */
  gnss: GnssStatusSnapshot;
}

export interface UseGpsAveragingOptions {
  watcher?: GeolocationWatcher;
  config?: AveragingConfig;
  nowFn?: () => number;
  /** Injected GNSS status source (defaults to the platform-aware provider). */
  gnssProvider?: GnssStatusProvider;
  /**
   * Bump this to restart the session (clear samples + re-acquire) while it stays
   * active -- backs the modal's "Reset" button.
   */
  restartNonce?: number;
}

export function useGpsAveraging(
  active: boolean,
  options: UseGpsAveragingOptions = {},
): UseGpsAveraging {
  const config = options.config ?? DEFAULT_AVERAGING_CONFIG;
  const nowFn = options.nowFn ?? Date.now;
  // A single watcher + GNSS provider instance for the lifetime of the hook.
  const watcherRef = useRef<GeolocationWatcher | null>(null);
  if (watcherRef.current === null) {
    watcherRef.current = options.watcher ?? new GeolocationWatcher();
  }
  const gnssRef = useRef<GnssStatusProvider | null>(null);
  if (gnssRef.current === null) {
    gnssRef.current = options.gnssProvider ?? createDefaultGnssStatusProvider();
  }

  const [samples, setSamples] = useState<AccuracySample[]>([]);
  const samplesRef = useRef<AccuracySample[]>([]);
  const [status, setStatus] = useState<AveragingStatus>('idle');
  const [gnss, setGnss] = useState<GnssStatusSnapshot>(UNSUPPORTED_GNSS_SNAPSHOT);
  // Ticks once per second so elapsed time/confidence advance between fixes.
  const [tick, setTick] = useState(0);
  const [timing, setTiming] = useState({
    accumulatedActiveMs: 0,
    activeSessionStartedAt: null as number | null,
    generation: 0,
  });

  // Reset (Reset button) clears samples regardless of running state. This is
  // React's documented "adjust state when a prop changes" pattern (render-phase
  // setState guarded by the previous value) -- NOT an effect -- so Stop/Start
  // (pause/resume) never clears, but a Reset always does, even while paused.
  const nonce = options.restartNonce ?? 0;
  const [prevNonce, setPrevNonce] = useState(nonce);
  if (nonce !== prevNonce) {
    setPrevNonce(nonce);
    setSamples([]);
    setStatus('idle');
    setGnss(UNSUPPORTED_GNSS_SNAPSHOT);
    setTiming((prev) => ({
      accumulatedActiveMs: 0,
      activeSessionStartedAt: null,
      generation: prev.generation + 1,
    }));
  }

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const watcher = watcherRef.current as GeolocationWatcher;
    const gnssProvider = gnssRef.current as GnssStatusProvider;
    // Origin of this active period. The shared fix gate drops anything older
    // than this (iOS/Android replay the cached last-known location on watch
    // start) and throttles the rest, so the timer starts at 0 from a real fix.
    const sessionStartMs = nowFn();
    const timingGeneration = timing.generation;
    queueMicrotask(() => {
      if (!cancelled) {
        setTiming((prev) => ({ ...prev, activeSessionStartedAt: sessionStartMs }));
      }
    });
    // Timestamp of the last accepted sample, for the shared throttle gate.
    const retainedSamples = samplesRef.current;
    let lastAcceptedMs: number | null =
      retainedSamples.length > 0 ? retainedSamples[retainedSamples.length - 1].timestamp : null;

    // Resume/continue: do NOT clear samples here -- pausing (Stop) keeps them
    // and Start appends to the same set. Clearing happens only on Reset (above).
    void (async () => {
      setStatus('acquiring');
      // Subscribe to live multi-constellation status (Android only; the default
      // provider reports "unsupported" on iOS/web).
      try {
        await gnssProvider.start((snapshot) => {
          if (!cancelled) setGnss(snapshot);
        });
      } catch {
        // Satellite status is best-effort; never block the fix on it.
      }
      try {
        const permission = await watcher.requestPermissions();
        if (cancelled) return;
        if (permission !== 'granted') {
          setStatus('permission-denied');
          return;
        }
        await watcher.start(
          {
            enableHighAccuracy: GPS.WATCH_OPTIONS.enableHighAccuracy,
            timeout: GPS.WATCH_OPTIONS.timeout,
            maximumAge: GPS.WATCH_OPTIONS.maximumAge,
            // Averaging keeps every fix; rejection happens in the aggregator.
          },
          (point: RecordedPoint) => {
            if (cancelled) return;
            // Shared gate (same one the recorder uses): drop the OS's replayed
            // pre-session fixes and throttle to ~1 fix/sec so the count climbs
            // like seconds instead of jumping on a warm GPS.
            if (
              !shouldAcceptFix(point.timestamp, {
                sessionStartMs: sessionStartMs - GPS.WATCH_START_STALE_FIX_GRACE_MS,
                lastAcceptedMs,
                minIntervalMs: GPS.AVERAGING_MIN_SAMPLE_INTERVAL_MS,
              })
            ) {
              return;
            }
            lastAcceptedMs = point.timestamp;
            setStatus('collecting');
            setSamples((prev) => [
              ...prev,
              {
                latitude: point.latitude,
                longitude: point.longitude,
                altitude: point.altitude ?? null,
                accuracy: point.accuracy ?? null,
                altitudeAccuracy: point.altitudeAccuracy ?? null,
                timestamp: point.timestamp,
              },
            ]);
          },
          () => {
            // Keep collecting on transient watch errors; surface only if nothing
            // has been collected yet.
            if (!cancelled) setStatus((s) => (s === 'acquiring' ? 'error' : s));
          },
        );
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    const interval = setInterval(() => {
      if (!cancelled) setTick((t) => t + 1);
    }, 1000);

    return () => {
      // Pause: stop the watch but KEEP samples + last result frozen (stopwatch
      // Stop). Reset (restartNonce) is the only thing that clears them.
      cancelled = true;
      setTiming((prev) => {
        const startedAt = prev.activeSessionStartedAt;
        if (startedAt === null || timingGeneration !== prev.generation) return prev;
        return {
          ...prev,
          accumulatedActiveMs: prev.accumulatedActiveMs + Math.max(0, nowFn() - startedAt),
          activeSessionStartedAt: null,
        };
      });
      clearInterval(interval);
      void watcher.stop();
      void gnssProvider.stop();
    };
    // `restartNonce` re-runs this effect so a Reset while running re-acquires
    // (the render-phase reset above clears the samples). `nowFn` is read fresh
    // for the session origin and intentionally excluded so the watch only
    // restarts on active/nonce changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, options.restartNonce]);

  const result = useMemo<AveragingResult | null>(() => {
    if (samples.length === 0) return null;
    const firstTs = samples.reduce((min, sample) => Math.min(min, sample.timestamp), samples[0].timestamp);
    const activeStartedAt = timing.activeSessionStartedAt;
    const activeElapsedMs =
      timing.accumulatedActiveMs +
      (active && activeStartedAt !== null ? Math.max(0, nowFn() - activeStartedAt) : 0);
    return aggregateSamples(samples, config, firstTs + activeElapsedMs);
    // `tick` is intentionally a dependency so elapsed time/confidence advance
    // once per second even when no new fix has arrived. Recomputing the memo on
    // every render is harmless (only the watch *effect* must stay stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, tick, config, nowFn, active, timing]);

  return { status, result, sampleCount: samples.length, gnss };
}
