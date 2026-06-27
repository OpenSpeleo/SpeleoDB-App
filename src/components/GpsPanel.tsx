/**
 * GpsPanel -- slide-in side panel for GPS track recording + management.
 *
 * Mirrors `LandmarkPanel`'s visual language (left-edge panel over the map). It
 * is presentational: recording state, the unified track list, visibility, and
 * callbacks come in via props; the Dashboard wires them to the controller.
 *
 * The list is unified: local recordings (origin `local`) and server tracks
 * (origin `remote`) appear together with a clear badge. Per-track visibility
 * defaults OFF; tracks are only drawn on the map once toggled on. Every
 * mutation (upload=create, edit name/color, delete) is an offline op surfaced
 * on the Pending page, so each row shows a derived pending chip.
 *
 * See docs/gps-tracks.md.
 */

import React from 'react';
import { IonToggle } from '@ionic/react';
import type {
  GpsRecordingState,
  GpsTrackListItem,
  RecordedPoint,
} from '../types/gpsTrack';
import type { MeasurementUnit } from '../types/measurementUnit';
import { FEET_TO_METERS, formatDistanceValue } from '../utils/measurementUnits';
import { formatDuration, trackDistanceMeters } from '../utils/gpsTrackStats';

export interface GpsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  recordingState: GpsRecordingState;
  currentPoints: RecordedPoint[];
  tracks: GpsTrackListItem[];
  measurementUnit: MeasurementUnit;
  /** Per-track map visibility; a missing key means hidden (default OFF). */
  trackVisibility: Record<string, boolean>;
  /** Track ids whose remote geometry is currently downloading. */
  loadingTrackIds?: Set<string>;
  /** Open the dedicated full-screen recording screen. */
  onOpenRecorder: () => void;
  onCollectPoint: () => void;
  /** Tap a track row to zoom the map to it (and show it). */
  onTrackTap: (track: GpsTrackListItem) => void;
  onToggleTrackVisibility: (track: GpsTrackListItem, visible: boolean) => void;
  onShareTrack: (track: GpsTrackListItem) => void;
  onUploadTrack: (track: GpsTrackListItem) => void;
  onEditTrack: (track: GpsTrackListItem) => void;
  onDeleteTrack: (track: GpsTrackListItem) => void;
}

function metersToDisplayDistance(meters: number, unit: MeasurementUnit): string {
  // formatDistanceValue takes feet; convert from meters first.
  return formatDistanceValue(meters / FEET_TO_METERS, unit);
}

interface Chip {
  label: string;
  className: string;
}

/**
 * Derived badge for a track row, or `null` when there's nothing to flag.
 * A clean server track shows no badge; a clean local track is marked "Local".
 */
function pendingChip(track: GpsTrackListItem): Chip | null {
  switch (track.pending) {
    case 'create':
      return { label: 'Pending upload', className: 'bg-amber-500/20 text-amber-300' };
    case 'update':
      return { label: 'Pending edit', className: 'bg-amber-500/20 text-amber-300' };
    case 'delete':
      return { label: 'Pending delete', className: 'bg-amber-500/20 text-amber-300' };
    case 'conflict':
      return { label: 'Needs attention', className: 'bg-amber-500/20 text-amber-300' };
    case 'error':
      return { label: 'Sync failed', className: 'bg-red-500/20 text-red-300' };
    default:
      return track.origin === 'local'
        ? { label: 'Local', className: 'bg-amber-500/20 text-amber-300' }
        : null;
  }
}

// ==================== Recording entry ====================

interface RecordEntryProps {
  recordingState: GpsRecordingState;
  currentPoints: RecordedPoint[];
  measurementUnit: MeasurementUnit;
  onOpenRecorder: () => void;
  onCollectPoint: () => void;
}

const RecordEntry: React.FC<RecordEntryProps> = ({
  recordingState,
  currentPoints,
  measurementUnit,
  onOpenRecorder,
  onCollectPoint,
}) => {
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const isActive = isRecording || isPaused;
  const distanceMeters = trackDistanceMeters(currentPoints);

  return (
    <div className="shrink-0 border-b border-slate-700/50 px-4 py-3">
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onCollectPoint}
          data-testid="gps-collect-point"
          className="app-btn app-btn--info w-full gap-2 touch-manipulation"
        >
          High-Accuracy GPS Point
        </button>

        <button
          type="button"
          onClick={onOpenRecorder}
          data-testid="gps-open-recorder"
          className="app-btn app-btn--primary w-full gap-2 touch-manipulation"
        >
          GPS Track Recording
        </button>

        {isActive && (
          <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2">
            <span className="flex items-center gap-2 text-xs text-slate-300">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  isRecording ? 'bg-red-500 animate-pulse' : 'bg-amber-400'
                }`}
                data-testid="gps-recording-indicator"
              />
              {isRecording ? 'Recording' : 'Paused'}
            </span>
            <span className="text-xs tabular-nums text-slate-400" data-testid="gps-recording-stats">
              {currentPoints.length} pts · {metersToDisplayDistance(distanceMeters, measurementUnit)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== Track row ====================

interface TrackRowProps {
  track: GpsTrackListItem;
  measurementUnit: MeasurementUnit;
  visible: boolean;
  loading: boolean;
  onTrackTap: (track: GpsTrackListItem) => void;
  onToggleTrackVisibility: (track: GpsTrackListItem, visible: boolean) => void;
  onShareTrack: (track: GpsTrackListItem) => void;
  onUploadTrack: (track: GpsTrackListItem) => void;
  onEditTrack: (track: GpsTrackListItem) => void;
  onDeleteTrack: (track: GpsTrackListItem) => void;
}

const TrackRow: React.FC<TrackRowProps> = ({
  track,
  measurementUnit,
  visible,
  loading,
  onTrackTap,
  onToggleTrackVisibility,
  onShareTrack,
  onUploadTrack,
  onEditTrack,
  onDeleteTrack,
}) => {
  const chip = pendingChip(track);
  const isLocal = track.origin === 'local';
  const hasStats = typeof track.pointCount === 'number' && track.pointCount > 0;

  return (
    <li className="border-b border-slate-700/40 px-4 py-3" data-testid={`gps-track-${track.id}`}>
      <div className="flex items-center gap-2">
        {/* Tap the name/dot to zoom the map to the track (and show it). */}
        <button
          type="button"
          onClick={() => onTrackTap(track)}
          data-testid={`gps-track-zoom-${track.id}`}
          title={`Zoom to ${track.name}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left touch-manipulation"
        >
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full shadow-sm ring-1 ring-white/20"
            style={{
              // Mirror the project panel: filled disk when shown, hollow colored
              // ring when hidden.
              backgroundColor: visible ? track.color : 'transparent',
              borderWidth: visible ? 0 : 2,
              borderColor: track.color,
              borderStyle: 'solid',
            }}
            data-testid={`gps-track-color-${track.id}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-100">{track.name}</span>
            {(chip || hasStats) && (
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                {chip && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${chip.className}`}
                    data-testid={`gps-track-status-${track.id}`}
                  >
                    {chip.label}
                  </span>
                )}
                {hasStats && (
                  <span className="tabular-nums">
                    {track.pointCount} pts ·{' '}
                    {metersToDisplayDistance(track.distanceMeters ?? 0, measurementUnit)} ·{' '}
                    {formatDuration(track.durationMs ?? 0)}
                  </span>
                )}
              </span>
            )}
          </span>
        </button>

        {loading && (
          <span
            className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"
            data-testid={`gps-track-loading-${track.id}`}
          />
        )}
        <IonToggle
          checked={visible}
          disabled={loading}
          onIonChange={(e) => {
            if (e.detail.checked !== visible) onToggleTrackVisibility(track, e.detail.checked);
          }}
          aria-label={`Show ${track.name} on map`}
          data-testid={`gps-track-visibility-${track.id}`}
        />
      </div>

      {track.pending === 'error' && track.pendingError && (
        <p className="mt-1 text-[11px] text-red-300" data-testid={`gps-track-error-${track.id}`}>
          {track.pendingError}
        </p>
      )}

      {/* Top row: Share (+ Upload for local recordings). Share spans the full
          width for a synced server track (no Upload action). */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onShareTrack(track)}
          data-testid={`gps-track-share-${track.id}`}
          className={`app-btn app-btn--compact app-btn--success w-full touch-manipulation ${
            isLocal ? '' : 'col-span-2'
          }`}
        >
          Share GPX
        </button>
        {isLocal && (
          <button
            type="button"
            onClick={() => onUploadTrack(track)}
            data-testid={`gps-track-upload-${track.id}`}
            className="app-btn app-btn--compact app-btn--primary w-full touch-manipulation"
          >
            Upload
          </button>
        )}
      </div>

      {/* Bottom row: Edit / Delete are always together on their own row. */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onEditTrack(track)}
          data-testid={`gps-track-edit-${track.id}`}
          className="app-btn app-btn--compact app-btn--info w-full touch-manipulation"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDeleteTrack(track)}
          data-testid={`gps-track-delete-${track.id}`}
          className="app-btn app-btn--compact app-btn--danger w-full touch-manipulation"
        >
          Delete
        </button>
      </div>
    </li>
  );
};

// ==================== Panel ====================

const GpsPanel: React.FC<GpsPanelProps> = ({
  isOpen,
  onClose,
  recordingState,
  currentPoints,
  tracks,
  measurementUnit,
  trackVisibility,
  loadingTrackIds,
  onOpenRecorder,
  onCollectPoint,
  onTrackTap,
  onToggleTrackVisibility,
  onShareTrack,
  onUploadTrack,
  onEditTrack,
  onDeleteTrack,
}) => {
  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-20 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-30 w-72 max-w-[80vw]
          bg-slate-900/95 backdrop-blur-md border-r border-slate-700/50
          flex flex-col transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}
        data-testid="gps-panel"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-slate-700/50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">GPS Tools</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400
                         hover:bg-slate-700/50 hover:text-slate-100 transition-colors"
              aria-label="Close panel"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <RecordEntry
          recordingState={recordingState}
          currentPoints={currentPoints}
          measurementUnit={measurementUnit}
          onOpenRecorder={onOpenRecorder}
          onCollectPoint={onCollectPoint}
        />

        {/* Recorded Tracks section title + count */}
        <div className="shrink-0 px-4 pt-3 pb-2">
          <h3 className="text-sm font-semibold text-slate-100">Recorded Tracks</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </p>
        </div>

        {/* Tracks list */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pt-1"
          data-testid="gps-panel-list"
        >
          {tracks.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
              Tracks you record in the app or upload to SpeleoDB will appear here.
            </div>
          ) : (
            <ul>
              {tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  measurementUnit={measurementUnit}
                  visible={trackVisibility[track.id] === true}
                  loading={loadingTrackIds?.has(track.id) ?? false}
                  onTrackTap={onTrackTap}
                  onToggleTrackVisibility={onToggleTrackVisibility}
                  onShareTrack={onShareTrack}
                  onUploadTrack={onUploadTrack}
                  onEditTrack={onEditTrack}
                  onDeleteTrack={onDeleteTrack}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};

export default GpsPanel;
