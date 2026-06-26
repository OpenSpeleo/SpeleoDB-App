/**
 * GpsAveragingModal -- presentational UI for collecting a high-confidence GPS
 * point by averaging fixes over ~1-2 minutes.
 *
 * The measurement view is shown immediately (in a "hold" state with placeholder
 * values); the user presses Start to begin, Stop to halt, Reset to re-acquire,
 * and Save to store the averaged coordinates as a landmark (online or offline).
 * A satellite checklist shows which GNSS constellations are contributing -- with
 * a green check / red cross where the platform can report it (Android), and an
 * "unavailable" note where it cannot (iOS/web). All side effects (the GPS watch,
 * aggregation, GNSS status) live in `useGpsAveraging`; this component is pure.
 *
 * See docs/gps-tracks.md.
 */

import React from 'react';
import type { MeasurementUnit } from '../types/measurementUnit';
import type { AveragingResult } from '../utils/gpsAveraging';
import type { AveragingStatus } from '../hooks/useGpsAveraging';
import type { GnssConstellationStatus, GnssStatusSnapshot } from '../types/gnss';
import { formatAccuracyValue } from '../utils/measurementUnits';
import { formatDuration } from '../utils/gpsTrackStats';
import { GPS } from '../constants';
import GpsScreenHeader from './GpsScreenHeader';

/**
 * Stopwatch-style session phase:
 * - `idle`    -> never started (or after a reset-to-zero); held.
 * - `running` -> actively collecting fixes.
 * - `stopped` -> paused; data retained and frozen, can resume (Start) or reset.
 */
export type GpsAveragingPhase = 'idle' | 'running' | 'stopped';

export interface GpsAveragingModalProps {
  isOpen: boolean;
  status: AveragingStatus;
  result: AveragingResult | null;
  gnss: GnssStatusSnapshot;
  measurementUnit: MeasurementUnit;
  phase: GpsAveragingPhase;
  /** True while the save (landmark create) request is in flight. */
  busy?: boolean;
  /** Begin collecting (from held) or resume/continue (from stopped). */
  onStart: () => void;
  /** Pause: stop reading but keep the collected data. */
  onStop: () => void;
  /** Request a reset (clear collected data); the parent confirms first. */
  onReset: () => void;
  onCancel: () => void;
  onSave: (point: { latitude: number; longitude: number; altitude: number | null }) => void;
}

function formatCoordinate(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(6);
}

// ==================== Satellite checklist ====================

function findConstellation(
  gnss: GnssStatusSnapshot,
  id: string,
): GnssConstellationStatus | undefined {
  return gnss.constellations.find((c) => c.id === id);
}

const CheckIcon: React.FC = () => (
  <svg className="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
  </svg>
);

const CrossIcon: React.FC = () => (
  <svg className="h-4 w-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const UnknownIcon: React.FC = () => (
  <span className="text-slate-600" aria-hidden="true">—</span>
);

/** Fix state for platforms that cannot report per-constellation status. */
export type GpsFixState = 'idle' | 'acquiring' | 'fixed';

interface SatelliteChecklistProps {
  gnss: GnssStatusSnapshot;
  /** Used only when the platform cannot report per-constellation status. */
  fixState: GpsFixState;
}

/**
 * Per-constellation checklist (green check / red cross) -- shown only when the
 * platform can actually report satellite status (Android). On iOS/web, where no
 * satellite data exists, this would be a confusing row of dashes, so instead we
 * show a single honest "GNSS fix" indicator that reflects whether we are
 * receiving readings, plus a note that the device auto-combines all GNSS.
 */
const SatelliteChecklist: React.FC<SatelliteChecklistProps> = ({ gnss, fixState }) => (
  <div className="mb-6" data-testid="gps-averaging-constellations">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs uppercase tracking-wide text-slate-400">Satellites</span>
      {gnss.supported && gnss.multiBand !== null && (
        <span
          data-testid="gps-averaging-multiband"
          className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide ${
            gnss.multiBand ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-slate-300'
          }`}
        >
          {gnss.multiBand ? 'Multi-band' : 'Single band'}
        </span>
      )}
    </div>

    {gnss.supported ? (
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {GPS.CONSTELLATIONS.map((c) => {
          const entry = findConstellation(gnss, c.id);
          const inUse = entry?.inUse ?? false;
          return (
            <li
              key={c.id}
              className="flex items-center justify-between text-sm"
              data-testid={`gps-constellation-${c.id}`}
            >
              <span className="text-slate-200">{c.label}</span>
              <span
                className="flex items-center gap-1 tabular-nums"
                data-testid={`gps-constellation-${c.id}-status`}
                data-inuse={String(inUse)}
              >
                {entry && entry.satellitesUsed !== undefined && inUse && (
                  <span className="text-[10px] text-slate-500">{entry.satellitesUsed}</span>
                )}
                {inUse ? <CheckIcon /> : <CrossIcon />}
              </span>
            </li>
          );
        })}
      </ul>
    ) : (
      <>
        <div
          className="flex items-center gap-2 text-sm"
          data-testid="gps-fix-indicator"
          data-state={fixState}
        >
          {fixState === 'fixed' ? (
            <>
              <CheckIcon />
              <span className="text-slate-200">GNSS fix acquired</span>
            </>
          ) : fixState === 'acquiring' ? (
            <>
              <span className="h-3.5 w-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
              <span className="text-slate-300">Acquiring GNSS fix…</span>
            </>
          ) : (
            <>
              <UnknownIcon />
              <span className="text-slate-400">Not started</span>
            </>
          )}
        </div>
        <p data-testid="gps-constellation-unavailable" className="mt-2 text-[11px] text-slate-500">
          Your device automatically combines every GNSS constellation and band it
          can receive. A per-satellite breakdown isn&apos;t available on this
          platform.
        </p>
      </>
    )}
  </div>
);

// ==================== Modal ====================

const GpsAveragingModal: React.FC<GpsAveragingModalProps> = ({
  isOpen,
  status,
  result,
  gnss,
  measurementUnit,
  phase,
  busy = false,
  onStart,
  onStop,
  onReset,
  onCancel,
  onSave,
}) => {
  const isRunning = phase === 'running';
  const confidence = result?.confidence ?? 0;
  const hasFix = result !== null && result.sampleCount > 0;
  // Save works whenever we have a fix (running or paused).
  const canSave = !busy && hasFix;
  const blocked = status === 'permission-denied' || status === 'error';
  const showHeldControls = phase === 'idle' || blocked;
  // Fix state is about whether we HAVE data, so a paused-with-data session still
  // shows the green "fix acquired" indicator.
  const fixState: GpsFixState = hasFix ? 'fixed' : isRunning ? 'acquiring' : 'idle';

  const handleSave = () => {
    if (!result) return;
    onSave({
      latitude: result.latitude,
      longitude: result.longitude,
      altitude: result.altitude,
    });
  };

  if (!isOpen) return null;

  return (
    // Confined overlay (covers the map area, NOT the bottom tab bar) so a menu
    // tap stays reachable and collapses this view. See docs/gps-tracks.md.
    <div
      data-testid="gps-averaging-modal"
      className="absolute inset-0 z-[60] flex flex-col bg-slate-900"
      style={{
        paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))',
        paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))',
      }}
    >
      {/* Shared header: back button (top-left) closes the screen, matching the
          GPS Track Recording layout. */}
      <GpsScreenHeader
        title="High-Accuracy GPS Point"
        onBack={onCancel}
        backTestId="gps-averaging-back"
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-sm mx-auto w-full px-4 py-6">
          <p
            data-testid="gps-averaging-explainer"
            className="text-xs text-slate-400 mb-5 text-center"
          >
            A single GPS reading can be off by several meters and drifts from one
            moment to the next. This averages many readings taken while you hold
            still into one point — the random errors cancel out, so the more
            readings it collects the closer the result gets to your true location.
            Stand still with a clear view of the sky.
          </p>

          {blocked ? (
            <p
              data-testid={status === 'permission-denied' ? 'gps-averaging-permission' : 'gps-averaging-error'}
              className="text-red-400 text-sm text-center mb-6"
            >
              {status === 'permission-denied'
                ? 'Location permission is required to collect a GPS point.'
                : 'Could not start the GPS. Check that location is enabled and try again.'}
            </p>
          ) : (
            <>
              {/* Progress (collection progress + accuracy quality) */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Progress</span>
                  <span data-testid="gps-averaging-confidence" className="text-sm font-semibold text-slate-100">
                    {confidence}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-700/70 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-500 transition-all duration-500"
                    style={{ width: `${confidence}%` }}
                    data-testid="gps-averaging-confidence-bar"
                  />
                </div>
              </div>

              {/* Live readout (placeholders while held) */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-6">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">Latitude</dt>
                  <dd data-testid="gps-averaging-lat" className="text-slate-100 tabular-nums">
                    {formatCoordinate(result?.latitude)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">Longitude</dt>
                  <dd data-testid="gps-averaging-lng" className="text-slate-100 tabular-nums">
                    {formatCoordinate(result?.longitude)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">Horizontal accuracy</dt>
                  <dd data-testid="gps-averaging-haccuracy" className="text-slate-100 tabular-nums">
                    {formatAccuracyValue(result?.horizontalAccuracyMeters ?? null, measurementUnit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">Vertical accuracy</dt>
                  <dd data-testid="gps-averaging-vaccuracy" className="text-slate-100 tabular-nums">
                    {formatAccuracyValue(result?.verticalAccuracyMeters ?? null, measurementUnit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">Elapsed</dt>
                  <dd data-testid="gps-averaging-elapsed" className="text-slate-100 tabular-nums">
                    {formatDuration(result?.elapsedMs ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">Samples</dt>
                  <dd data-testid="gps-averaging-samples" className="text-slate-100 tabular-nums">
                    {result?.sampleCount ?? 0}
                  </dd>
                </div>
              </dl>

              <SatelliteChecklist gnss={gnss} fixState={fixState} />

              {isRunning && result && !result.isStable && (
                <p className="text-[11px] text-slate-500 text-center mb-2">
                  Keep collecting for a more reliable point.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Controls (stopwatch); the header back button handles closing:
          - idle    -> Start
          - running -> Stop + Save  (+ Reset)
          - stopped -> Start (resume) + Save  (+ Reset) */}
      <div
        className="border-t border-slate-700/50 px-4 py-4"
        style={{ paddingBottom: 'max(1rem, var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))' }}
      >
        <div className="max-w-sm mx-auto w-full">
          {showHeldControls ? (
            <button
              type="button"
              disabled={busy}
              onClick={onStart}
              data-testid="gps-averaging-start"
              className="app-btn app-btn--primary w-full"
            >
              Start
            </button>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {isRunning ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onStop}
                    data-testid="gps-averaging-stop"
                    className="app-btn app-btn--danger"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onStart}
                    data-testid="gps-averaging-start"
                    className="app-btn app-btn--success"
                  >
                    Start
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canSave}
                  onClick={handleSave}
                  data-testid="gps-averaging-save"
                  className="app-btn app-btn--primary"
                >
                  {busy ? 'Saving\u2026' : 'Save as Landmark'}
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={onReset}
                data-testid="gps-averaging-reset"
                className="app-btn app-btn--secondary w-full mt-3"
              >
                Reset
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GpsAveragingModal;
