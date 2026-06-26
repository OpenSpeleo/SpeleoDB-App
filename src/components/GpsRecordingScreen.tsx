/**
 * GpsRecordingScreen -- a dedicated full-screen recording view.
 *
 * Opened from the GPS panel, it shows ongoing recording status (live duration,
 * track length/distance, point count) with large, glanceable
 * metrics and the Start / Pause / Resume / Stop controls. A back button leaves
 * the screen WITHOUT stopping the recording (recording lives in the controller
 * and continues in the background), so the user can return to the map and come
 * back. Presentational: state + handlers come in via props.
 *
 * See docs/gps-tracks.md.
 */

import React, { useEffect, useState } from 'react';
import type { GpsRecordingState, RecordedPoint } from '../types/gpsTrack';
import type { MeasurementUnit } from '../types/measurementUnit';
import { FEET_TO_METERS, formatDistanceValue } from '../utils/measurementUnits';
import { formatDuration, trackDistanceMeters } from '../utils/gpsTrackStats';
import GpsScreenHeader from './GpsScreenHeader';

export interface GpsRecordingScreenProps {
  isOpen: boolean;
  recordingState: GpsRecordingState;
  /** Active recording duration, excluding paused wall time, at the last snapshot. */
  recordingElapsedMs: number;
  /** Epoch ms for the elapsed snapshot; non-null only while actively recording. */
  recordingElapsedUpdatedAt: number | null;
  currentPoints: RecordedPoint[];
  measurementUnit: MeasurementUnit;
  /** Leave the screen; recording keeps running in the background. */
  onBack: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /**
   * Cancel: abandon the screen. When recording/paused the parent confirms and
   * discards the in-progress track; when idle it just closes the screen.
   */
  onCancel: () => void;
  /**
   * Android-only reliability nudge: when true, show a dismissible banner asking
   * the user to exempt the app from battery optimization so the OS doesn't kill
   * the recording service. Recording works regardless.
   */
  showBatteryOptimizationHint?: boolean;
  onFixBatteryOptimization?: () => void;
  onDismissBatteryOptimizationHint?: () => void;
}

function metersToDisplayDistance(meters: number, unit: MeasurementUnit): string {
  return formatDistanceValue(meters / FEET_TO_METERS, unit);
}

interface MetricProps {
  label: string;
  value: string;
  testId: string;
  wide?: boolean;
}

const Metric: React.FC<MetricProps> = ({ label, value, testId, wide }) => (
  <div
    className={`rounded-2xl bg-slate-800/60 px-4 py-4 ${wide ? 'col-span-2' : ''}`}
  >
    <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    <p data-testid={testId} className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">
      {value}
    </p>
  </div>
);

const GpsRecordingScreen: React.FC<GpsRecordingScreenProps> = ({
  isOpen,
  recordingState,
  recordingElapsedMs,
  recordingElapsedUpdatedAt,
  currentPoints,
  measurementUnit,
  onBack,
  onStart,
  onPause,
  onResume,
  onStop,
  onCancel,
  showBatteryOptimizationHint = false,
  onFixBatteryOptimization,
  onDismissBatteryOptimizationHint,
}) => {
  const [now, setNow] = useState(() => Date.now());

  // While recording, refresh `now` immediately (so the timer shows the real
  // elapsed the instant Start is pressed) and then tick once per second -- even
  // when standing still (no new points). Paused leaves `now` frozen.
  useEffect(() => {
    if (!isOpen || recordingState !== 'recording') return;
    const immediate = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [isOpen, recordingState]);

  if (!isOpen) return null;

  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const isActive = isRecording || isPaused;

  const points = currentPoints;
  // Duration is owned by the controller so pause/resume does not count paused
  // wall time. While recording, tick locally from the controller snapshot.
  const durationMs =
    recordingState === 'recording' && recordingElapsedUpdatedAt !== null
      ? recordingElapsedMs + Math.max(0, now - recordingElapsedUpdatedAt)
      : recordingElapsedMs;
  const distanceMeters = trackDistanceMeters(points);

  const stateLabel = isRecording ? 'Recording' : isPaused ? 'Paused' : 'Ready';

  return (
    <div
      data-testid="gps-recording-screen"
      className="absolute inset-0 z-[60] flex flex-col bg-slate-900"
      style={{
        paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))',
        paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))',
      }}
    >
      {/* Shared header: back button (top-left, leaves WITHOUT stopping) +
          centered title, matching the High-Accuracy GPS Point screen. The
          ready/recording status tag rides in the right slot. */}
      <GpsScreenHeader
        title="GPS Track Recording"
        onBack={onBack}
        backLabel="Back to map"
        backTestId="gps-recording-back"
        right={
          <span
            data-testid="gps-recording-state"
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              isRecording
                ? 'bg-red-500/20 text-red-300'
                : isPaused
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-slate-700/60 text-slate-300'
            }`}
          >
            {isActive && (
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isRecording ? 'bg-red-500 animate-pulse' : 'bg-amber-400'
                }`}
              />
            )}
            {stateLabel}
          </span>
        }
      />

      {/* Live status metrics (no per-fix accuracy: it isn't meaningful for a
          moving track -- accuracy belongs to the stationary averaging tool). */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {!isActive && (
          <p
            data-testid="gps-recording-explainer"
            className="mb-5 text-center text-xs leading-relaxed text-slate-400"
          >
            Records the path you walk as a trail of GPS points. Use it to capture
            a surface route — a cave entrance approach, a resurgence, a survey
            traverse — and overlay your real-world track on top of the cave
            survey to see how they line up. To keep tracks light it logs about
            <strong className="text-slate-300"> one point every 15 seconds</strong>,
            so just start it and walk — recording keeps going even with the app
            in the background or your screen locked. The finished track can be
            exported as a GPX file or <strong className="text-slate-300">uploaded
            directly to SpeleoDB</strong>.
          </p>
        )}

        {isActive && (
          <div
            data-testid="gps-recording-leave-hint"
            className="mb-4 flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-xs text-sky-200"
          >
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Recording continues even if you leave the app or lock your screen.
              Tap the <strong>back arrow</strong> (top-left) to use the map and
              other views, or lock your phone and keep walking — your track runs
              until you Stop. A notification shows while it&apos;s recording.
            </span>
          </div>
        )}

        {showBatteryOptimizationHint && (
          <div
            data-testid="gps-battery-optimization-hint"
            className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200"
          >
            <p className="mb-2">
              For best results, allow SpeleoDB to ignore battery optimization —
              some phones aggressively stop background apps, which can cut a long
              recording short.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onFixBatteryOptimization}
                data-testid="gps-battery-optimization-fix"
                className="app-btn app-btn--info touch-manipulation"
              >
                Allow
              </button>
              <button
                type="button"
                onClick={onDismissBatteryOptimizationHint}
                data-testid="gps-battery-optimization-dismiss"
                className="app-btn app-btn--secondary touch-manipulation"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Metric label="Duration" value={formatDuration(durationMs)} testId="gps-recording-duration" wide />
          <Metric
            label="Distance"
            value={metersToDisplayDistance(distanceMeters, measurementUnit)}
            testId="gps-recording-distance"
          />
          <Metric label="Points" value={String(points.length)} testId="gps-recording-points" />
        </div>

        {isActive && (
          <p className="mt-3 text-center text-[11px] text-slate-500">
            Logging about one point every 15 seconds — just keep walking.
          </p>
        )}

        {!isActive && (
          <p className="mt-5 text-center text-xs text-slate-400">
            Press Start to begin. You can leave this screen with the back arrow at
            any time — recording keeps running.
          </p>
        )}
      </div>

      {/* Controls. The Cancel button abandons the screen: when recording/paused
          the parent confirms and discards the track; when idle it just closes.
          The header's back arrow is the non-destructive "leave but keep
          recording" affordance. */}
      <div className="border-t border-slate-700/50 px-4 py-4" style={{ paddingBottom: 'max(1rem, var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))' }}>
        {!isActive ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCancel}
              data-testid="gps-recording-cancel"
              className="app-btn app-btn--secondary touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onStart}
              data-testid="gps-start-recording"
              className="app-btn app-btn--primary touch-manipulation"
            >
              Start recording
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {isRecording ? (
                <button
                  type="button"
                  onClick={onPause}
                  data-testid="gps-pause-recording"
                  className="app-btn app-btn--secondary touch-manipulation"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onResume}
                  data-testid="gps-resume-recording"
                  className="app-btn app-btn--primary touch-manipulation"
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                onClick={onStop}
                data-testid="gps-stop-recording"
                className="app-btn app-btn--danger touch-manipulation"
              >
                Stop &amp; save
              </button>
            </div>
            <button
              type="button"
              onClick={onCancel}
              data-testid="gps-recording-cancel"
              className="app-btn app-btn--secondary w-full mt-3 touch-manipulation"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default GpsRecordingScreen;
