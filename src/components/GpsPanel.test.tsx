import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GpsPanel, { type GpsPanelProps } from './GpsPanel';
import type { GpsTrackListItem } from '../types/gpsTrack';

// Mirror ProjectPanel.test: render IonToggle as a label + checkbox so the
// visibility switch is testable via querySelector('input') in jsdom.
vi.mock('@ionic/react', () => ({
  IonToggle: ({ checked, disabled, onIonChange, ...rest }: {
    checked?: boolean;
    disabled?: boolean;
    onIonChange?: (e: { detail: { checked: boolean } }) => void;
  } & Record<string, unknown>) => (
    <label data-testid={rest['data-testid'] as string} aria-label={rest['aria-label'] as string}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onIonChange?.({ detail: { checked: e.target.checked } })}
      />
    </label>
  ),
}));

function track(overrides: Partial<GpsTrackListItem> = {}): GpsTrackListItem {
  return {
    id: 'trk-1',
    name: 'Morning Walk',
    color: '#e41a1c',
    origin: 'local',
    createdAt: 1000,
    updatedAt: 1000,
    pointCount: 2,
    distanceMeters: 100,
    durationMs: 60_000,
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
    trackVisibility: {},
    loadingTrackIds: new Set<string>(),
    onOpenRecorder: vi.fn(),
    onCollectPoint: vi.fn(),
    onTrackTap: vi.fn(),
    onToggleTrackVisibility: vi.fn(),
    onShareTrack: vi.fn(),
    onUploadTrack: vi.fn(),
    onEditTrack: vi.fn(),
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
    expect(screen.queryByTestId('gps-pause-recording')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gps-stop-recording')).not.toBeInTheDocument();
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

  it('renders the GPS Tools header and Recorded Tracks section', () => {
    renderPanel({ tracks: [track()] });
    expect(screen.getByRole('heading', { name: 'GPS Tools' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recorded Tracks' })).toBeInTheDocument();
  });

  it('renders an empty state with no tracks', () => {
    renderPanel();
    expect(screen.getByText(/Tracks you record in the app or upload to SpeleoDB/i)).toBeInTheDocument();
  });

  it('marks a clean local track "Local" with Upload + Edit + Delete actions', () => {
    renderPanel({ tracks: [track()] });
    expect(screen.getByTestId('gps-track-trk-1')).toBeInTheDocument();
    expect(screen.getByTestId('gps-track-status-trk-1')).toHaveTextContent('Local');
    expect(screen.getByTestId('gps-track-share-trk-1')).toHaveClass('app-btn--success');
    expect(screen.getByTestId('gps-track-upload-trk-1')).toBeInTheDocument();
    expect(screen.getByTestId('gps-track-edit-trk-1')).toHaveClass('app-btn--info');
    expect(screen.getByTestId('gps-track-delete-trk-1')).toHaveClass('app-btn--danger');
  });

  it('shows no badge for a clean server track, with no Upload action', () => {
    renderPanel({ tracks: [track({ id: 'trk-r', origin: 'remote', pointCount: null })] });
    expect(screen.queryByTestId('gps-track-status-trk-r')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gps-track-upload-trk-r')).not.toBeInTheDocument();
    expect(screen.getByTestId('gps-track-edit-trk-r')).toBeInTheDocument();
    expect(screen.getByTestId('gps-track-delete-trk-r')).toBeInTheDocument();
  });

  it('shows a filled color disk when the track is visible', () => {
    renderPanel({ tracks: [track({ color: '#377eb8' })], trackVisibility: { 'trk-1': true } });
    const dot = screen.getByTestId('gps-track-color-trk-1');
    expect(dot).toHaveStyle({ backgroundColor: 'rgb(55, 126, 184)' });
    expect(dot.style.borderWidth).toBe('0px');
  });

  it('shows a hollow colored ring when the track is hidden (default OFF)', () => {
    renderPanel({ tracks: [track({ color: '#377eb8' })], trackVisibility: {} });
    const dot = screen.getByTestId('gps-track-color-trk-1');
    expect(dot.style.backgroundColor).toBe('transparent');
    expect(dot.style.borderColor).toBe('rgb(55, 126, 184)');
    expect(dot.style.borderWidth).toBe('2px');
  });

  it('fires track action callbacks', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ tracks: [track()] });
    await user.click(screen.getByTestId('gps-track-share-trk-1'));
    await user.click(screen.getByTestId('gps-track-upload-trk-1'));
    await user.click(screen.getByTestId('gps-track-edit-trk-1'));
    await user.click(screen.getByTestId('gps-track-delete-trk-1'));
    expect(props.onShareTrack).toHaveBeenCalledTimes(1);
    expect(props.onUploadTrack).toHaveBeenCalledTimes(1);
    expect(props.onEditTrack).toHaveBeenCalledTimes(1);
    expect(props.onDeleteTrack).toHaveBeenCalledTimes(1);
  });

  it('toggles visibility (default OFF) and fires the callback', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ tracks: [track()], trackVisibility: {} });
    const checkbox = screen
      .getByTestId('gps-track-visibility-trk-1')
      .querySelector('input') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);
    expect(props.onToggleTrackVisibility).toHaveBeenCalledWith(track(), true);
  });

  it('shows the checkbox checked when the track is visible', () => {
    renderPanel({ tracks: [track()], trackVisibility: { 'trk-1': true } });
    const checkbox = screen
      .getByTestId('gps-track-visibility-trk-1')
      .querySelector('input') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('fires onTrackTap (zoom to track) when the row body is tapped', async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ tracks: [track()] });
    await user.click(screen.getByTestId('gps-track-zoom-trk-1'));
    expect(props.onTrackTap).toHaveBeenCalledWith(track());
  });

  it('shows a loading spinner + disabled toggle while geometry downloads', () => {
    renderPanel({ tracks: [track({ origin: 'remote' })], loadingTrackIds: new Set(['trk-1']) });
    expect(screen.getByTestId('gps-track-loading-trk-1')).toBeInTheDocument();
    const checkbox = screen
      .getByTestId('gps-track-visibility-trk-1')
      .querySelector('input') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('shows pending chips derived from the offline queue', () => {
    renderPanel({ tracks: [track({ pending: 'create' })] });
    expect(screen.getByTestId('gps-track-status-trk-1')).toHaveTextContent('Pending upload');
  });

  it('shows the pending error message', () => {
    renderPanel({ tracks: [track({ pending: 'error', pendingError: 'bad gpx' })] });
    expect(screen.getByTestId('gps-track-error-trk-1')).toHaveTextContent('bad gpx');
  });

  it('every app-btn carries a solid color variant (no bare-text buttons)', () => {
    const { container } = renderPanel({
      recordingState: 'recording',
      currentPoints: [{ latitude: 1, longitude: 2, timestamp: 0 }],
      tracks: [track(), track({ id: 'trk-2', origin: 'remote' })],
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
