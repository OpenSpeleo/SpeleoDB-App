/**
 * GpsPanel -- slide-in side panel for GPS track recording + management.
 *
 * Mirrors `LandmarkPanel`'s visual language (left-edge panel over the map). It
 * is presentational: recording state, tracks, and callbacks come in via props;
 * the Dashboard wires them to the controller. Sections:
 *  - Record: start/pause/resume/stop with live distance, duration, point count.
 *  - Collect point: launch the GPS averaging modal.
 *  - Tracks: each recorded track with stats, an upload-status chip, and actions
 *    (Share GPX, Upload to SpeleoDB, Rename, Delete).
 *
 * See docs/gps-tracks.md.
 */

import React from 'react';
import type { GpsRecordingState, LocalGpsTrack, RecordedPoint } from '../types/gpsTrack';
import type { MeasurementUnit } from '../types/measurementUnit';
import { FEET_TO_METERS, formatDistanceValue } from '../utils/measurementUnits';
import { formatDuration, summarizeTrack, trackDistanceMeters } from '../utils/gpsTrackStats';

export interface GpsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  recordingState: GpsRecordingState;
  currentPoints: RecordedPoint[];
  tracks: LocalGpsTrack[];
  measurementUnit: MeasurementUnit;
  /** Open the dedicated full-screen recording screen. */
  onOpenRecorder: () => void;
  onCollectPoint: () => void;
  onShareTrack: (track: LocalGpsTrack) => void;
  onUploadTrack: (track: LocalGpsTrack) => void;
  onRenameTrack: (track: LocalGpsTrack) => void;
  onDeleteTrack: (track: LocalGpsTrack) => void;
}

function metersToDisplayDistance(meters: number, unit: MeasurementUnit): string {
  // formatDistanceValue takes feet; convert from meters first.
  return formatDistanceValue(meters / FEET_TO_METERS, unit);
}

interface StatusChip {
  label: string;
  className: string;
}

function uploadStatusChip(track: LocalGpsTrack): StatusChip {
  switch (track.uploadStatus) {
    case 'uploaded':
      return { label: 'Uploaded', className: 'bg-emerald-500/20 text-emerald-300' };
    case 'pending':
      return { label: 'Pending upload', className: 'bg-amber-500/20 text-amber-300' };
    case 'error':
      return { label: 'Upload failed', className: 'bg-red-500/20 text-red-300' };
    default:
      return { label: 'Not uploaded', className: 'bg-slate-600/40 text-slate-300' };
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

// A compact entry that opens the dedicated full-screen recording screen. When a
// recording is in progress it shows a live status line and an "Open recorder"
// affordance; the actual Start/Pause/Stop controls live on that screen.
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

        {/* Live recording status sits just below its own button (GPS Track
            Recording), shown only while a recording is active. */}
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
  track: LocalGpsTrack;
  measurementUnit: MeasurementUnit;
  onShareTrack: (track: LocalGpsTrack) => void;
  onUploadTrack: (track: LocalGpsTrack) => void;
  onRenameTrack: (track: LocalGpsTrack) => void;
  onDeleteTrack: (track: LocalGpsTrack) => void;
}

const TrackRow: React.FC<TrackRowProps> = ({
  track,
  measurementUnit,
  onShareTrack,
  onUploadTrack,
  onRenameTrack,
  onDeleteTrack,
}) => {
  const summary = summarizeTrack(track.points);
  const chip = uploadStatusChip(track);
  const uploaded = track.uploadStatus === 'uploaded';

  return (
    <li className="border-b border-slate-700/40 px-4 py-3" data-testid={`gps-track-${track.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{track.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
            {summary.pointCount} pts · {metersToDisplayDistance(summary.distanceMeters, measurementUnit)} ·{' '}
            {formatDuration(summary.durationMs)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide ${chip.className}`}
          data-testid={`gps-track-status-${track.id}`}
        >
          {chip.label}
        </span>
      </div>

      {track.uploadStatus === 'error' && track.uploadError && (
        <p className="mt-1 text-[11px] text-red-300" data-testid={`gps-track-error-${track.id}`}>
          {track.uploadError}
        </p>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onShareTrack(track)}
          data-testid={`gps-track-share-${track.id}`}
          className="app-btn app-btn--compact app-btn--success w-full touch-manipulation"
        >
          Share GPX
        </button>
        <button
          type="button"
          onClick={() => onUploadTrack(track)}
          disabled={uploaded}
          data-testid={`gps-track-upload-${track.id}`}
          className="app-btn app-btn--compact app-btn--primary w-full touch-manipulation"
        >
          {uploaded ? 'Uploaded' : 'Upload'}
        </button>
        <button
          type="button"
          onClick={() => onRenameTrack(track)}
          data-testid={`gps-track-rename-${track.id}`}
          className="app-btn app-btn--compact app-btn--info w-full touch-manipulation"
        >
          Rename
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
  onOpenRecorder,
  onCollectPoint,
  onShareTrack,
  onUploadTrack,
  onRenameTrack,
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
            <h2 className="text-sm font-semibold text-slate-100">GPS</h2>
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
          <p className="mt-0.5 text-xs text-slate-400">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </p>
        </div>

        <RecordEntry
          recordingState={recordingState}
          currentPoints={currentPoints}
          measurementUnit={measurementUnit}
          onOpenRecorder={onOpenRecorder}
          onCollectPoint={onCollectPoint}
        />

        {/* Tracks list */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
          data-testid="gps-panel-list"
        >
          {tracks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No recorded tracks yet
            </div>
          ) : (
            <ul>
              {tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  measurementUnit={measurementUnit}
                  onShareTrack={onShareTrack}
                  onUploadTrack={onUploadTrack}
                  onRenameTrack={onRenameTrack}
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
