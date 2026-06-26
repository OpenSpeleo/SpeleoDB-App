import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GpsPanel, { type GpsPanelProps } from './GpsPanel';
import type { LocalGpsTrack } from '../types/gpsTrack';

function track(overrides: Partial<LocalGpsTrack> = {}): LocalGpsTrack {
  return {
    id: 'trk-1',
    name: 'Morning Walk',
    points: [
      { latitude: 45, longitude: -73, timestamp: 0 },
      { latitude: 45.001, longitude: -73, timestamp: 60_000 },
    ],
    createdAt: 1000,
    updatedAt: 1000,
    uploadStatus: 'local',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<GpsPanelProps> = {}) {
  const props: GpsPanelProps = {
    isOpen: true,
    onClose: vi.fn(),
    recordingState: 'idle',
    currentPoints: [],
    tracks: [],
    measurementUnit: 'meters',
    onOpenRecorder: vi.fn(),
    onCollectPoint: vi.fn(),
    onShareTrack: vi.fn(),
    onUploadTrack: vi.fn(),
    onRenameTrack: vi.fn(),
    onDeleteTrack: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<GpsPanel {...props} />) };
}

describe('GpsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the "GPS Track Recording" entry and Collect point when idle (no inline controls)', () => {
    renderPanel();
    const record = screen.getByTestId('gps-open-recorder');
    expect(record).toHaveTextContent('GPS Track Recording');
    expect(screen.getByTestId('gps-collect-point')).toBeInTheDocument();
    // The actual recording controls live on the dedicated screen, not the panel.
    expect(screen.queryByTestId('gps-pause-recording')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gps-stop-recording')).not.toBeInTheDocument();
  });

  it('keeps the same "GPS Track Recording" label while a recording is active', () => {
    renderPanel({
      recordingState: 'recording',
      currentPoints: [
        { latitude: 45, longitude: -73, timestamp: 0 },
        { latitude: 45.001, longitude: -73, timestamp: 30_000 },
      ],
    });
    expect(screen.getByTestId('gps-open-recorder')).toHaveTextContent('GPS Track Recording');
  });

  it('fires open-recorder + collect callbacks', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    await user.click(screen.getByTestId('gps-open-recorder'));
    await user.click(screen.getByTestId('gps-collect-point'));
    expect(props.onOpenRecorder).toHaveBeenCalledTimes(1);
    expect(props.onCollectPoint).toHaveBeenCalledTimes(1);
  });

  it('shows a live status line while a recording is active', () => {
    renderPanel({
      recordingState: 'recording',
      currentPoints: [
        { latitude: 45, longitude: -73, timestamp: 0 },
        { latitude: 45.001, longitude: -73, timestamp: 30_000 },
      ],
    });
    expect(screen.getByTestId('gps-recording-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('gps-recording-stats')).toHaveTextContent('2 pts');
  });

  it('renders an empty state with no tracks', () => {
    renderPanel();
    expect(screen.getByText('No recorded tracks yet')).toBeInTheDocument();
  });

  it('renders a track row with stats, status chip and actions', () => {
    renderPanel({ tracks: [track()] });
    expect(screen.getByTestId('gps-track-trk-1')).toBeInTheDocument();
    expect(screen.getByTestId('gps-track-status-trk-1')).toHaveTextContent('Not uploaded');
    expect(screen.getByTestId('gps-track-share-trk-1')).toBeInTheDocument();
    expect(screen.getByTestId('gps-track-upload-trk-1')).toBeInTheDocument();
    expect(screen.getByTestId('gps-track-share-trk-1')).toHaveClass('app-btn--success');
    expect(screen.getByTestId('gps-track-rename-trk-1')).toHaveClass('app-btn--info');
  });

  it('keeps top GPS actions full-width and track actions half-width', () => {
    renderPanel({ tracks: [track()] });
    expect(screen.getByTestId('gps-collect-point').parentElement).toHaveClass('grid-cols-1');
    expect(screen.getByTestId('gps-collect-point')).toHaveClass('w-full');
    expect(screen.getByTestId('gps-open-recorder')).toHaveClass('w-full');
    expect(screen.getByTestId('gps-track-share-trk-1').parentElement).toHaveClass('grid-cols-2');
    for (const id of [
      'gps-track-share-trk-1',
      'gps-track-upload-trk-1',
      'gps-track-rename-trk-1',
      'gps-track-delete-trk-1',
    ]) {
      expect(screen.getByTestId(id)).toHaveClass('w-full');
    }
  });

  it('fires track action callbacks', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ tracks: [track()] });
    await user.click(screen.getByTestId('gps-track-share-trk-1'));
    await user.click(screen.getByTestId('gps-track-upload-trk-1'));
    await user.click(screen.getByTestId('gps-track-rename-trk-1'));
    await user.click(screen.getByTestId('gps-track-delete-trk-1'));
    expect(props.onShareTrack).toHaveBeenCalledTimes(1);
    expect(props.onUploadTrack).toHaveBeenCalledTimes(1);
    expect(props.onRenameTrack).toHaveBeenCalledTimes(1);
    expect(props.onDeleteTrack).toHaveBeenCalledTimes(1);
  });

  it('disables Upload and labels it Uploaded for an uploaded track', () => {
    renderPanel({ tracks: [track({ uploadStatus: 'uploaded' })] });
    const btn = screen.getByTestId('gps-track-upload-trk-1');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Uploaded');
    expect(screen.getByTestId('gps-track-status-trk-1')).toHaveTextContent('Uploaded');
  });

  it('shows the upload error for a failed track', () => {
    renderPanel({ tracks: [track({ uploadStatus: 'error', uploadError: 'bad gpx' })] });
    expect(screen.getByTestId('gps-track-error-trk-1')).toHaveTextContent('bad gpx');
  });

  it('shows the pending chip', () => {
    renderPanel({ tracks: [track({ uploadStatus: 'pending' })] });
    expect(screen.getByTestId('gps-track-status-trk-1')).toHaveTextContent('Pending upload');
  });

  it('every app-btn carries a solid color variant (no bare-text buttons)', () => {
    const { container } = renderPanel({
      recordingState: 'recording',
      currentPoints: [{ latitude: 1, longitude: 2, timestamp: 0 }],
      tracks: [track()],
    });
    const buttons = container.querySelectorAll('button.app-btn');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      const cls = btn.className;
      expect(/app-btn--(primary|secondary|danger|info|success)/.test(cls)).toBe(true);
      // Guard against the recurring "bg utility as fill" bug.
      expect(/app-btn[^"]*\bbg-/.test(cls)).toBe(false);
    });
  });
});
