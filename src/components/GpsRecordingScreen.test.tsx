import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GpsRecordingScreen, { type GpsRecordingScreenProps } from './GpsRecordingScreen';
import type { RecordedPoint } from '../types/gpsTrack';

function pts(): RecordedPoint[] {
  return [
    { latitude: 45, longitude: -73, accuracy: 4, timestamp: 1_000_000 },
    { latitude: 45.001, longitude: -73, accuracy: 6, timestamp: 1_060_000 },
  ];
}

function renderScreen(overrides: Partial<GpsRecordingScreenProps> = {}) {
  const props: GpsRecordingScreenProps = {
    isOpen: true,
    recordingState: 'recording',
    recordingElapsedMs: 0,
    recordingElapsedUpdatedAt: Date.now(),
    currentPoints: pts(),
    measurementUnit: 'meters',
    onBack: vi.fn(),
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<GpsRecordingScreen {...props} />) };
}

describe('GpsRecordingScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('renders nothing when closed', () => {
    renderScreen({ isOpen: false });
    expect(screen.queryByTestId('gps-recording-screen')).not.toBeInTheDocument();
  });

  it('has a back button that leaves without stopping', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen();
    await user.click(screen.getByTestId('gps-recording-back'));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onStop).not.toHaveBeenCalled();
  });

  it('shows ongoing status: duration, distance, points (no per-fix accuracy)', () => {
    renderScreen({ recordingState: 'paused', recordingElapsedMs: 60_000, recordingElapsedUpdatedAt: null });
    expect(screen.getByTestId('gps-recording-duration')).toHaveTextContent('1:00');
    expect(screen.getByTestId('gps-recording-points')).toHaveTextContent('2');
    expect(screen.getByTestId('gps-recording-distance')).not.toHaveTextContent('N/A');
    expect(screen.getByTestId('gps-recording-state')).toHaveTextContent('Paused');
    // Accuracy is intentionally NOT shown for a moving track.
    expect(screen.queryByTestId('gps-recording-accuracy')).not.toBeInTheDocument();
  });

  it('does not count paused wall time in the displayed duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T12:00:00Z'));
    renderScreen({ recordingState: 'paused', recordingElapsedMs: 60_000, recordingElapsedUpdatedAt: null });

    vi.setSystemTime(new Date('2026-06-25T12:05:00Z'));
    expect(screen.getByTestId('gps-recording-duration')).toHaveTextContent('1:00');
    vi.useRealTimers();
  });

  it('ticks from the controller elapsed snapshot while recording', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T12:00:00Z'));
    renderScreen({
      recordingState: 'recording',
      recordingElapsedMs: 60_000,
      recordingElapsedUpdatedAt: Date.now(),
    });

    await act(async () => {
      vi.setSystemTime(new Date('2026-06-25T12:00:05Z'));
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('gps-recording-duration')).toHaveTextContent('1:05');
    vi.useRealTimers();
  });

  it('makes it obvious that leaving keeps recording (back hint + accessible back button)', () => {
    renderScreen({ recordingState: 'recording' });
    expect(screen.getByTestId('gps-recording-leave-hint')).toBeInTheDocument();
    expect(screen.getByTestId('gps-recording-back')).toHaveAccessibleName('Back to map');
  });

  it('fires onCancel from the Cancel button (parent decides confirm vs close)', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ recordingState: 'recording' });
    await user.click(screen.getByTestId('gps-recording-cancel'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onStop).not.toHaveBeenCalled();
  });

  it('shows a Cancel button when idle that fires onCancel (close)', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ recordingState: 'idle', currentPoints: [] });
    await user.click(screen.getByTestId('gps-recording-cancel'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows Start when idle and fires it', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ recordingState: 'idle', currentPoints: [] });
    expect(screen.getByTestId('gps-recording-state')).toHaveTextContent('Ready');
    expect(screen.queryByTestId('gps-stop-recording')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('gps-start-recording'));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('shows Pause + Stop while recording and fires them', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ recordingState: 'recording' });
    await user.click(screen.getByTestId('gps-pause-recording'));
    await user.click(screen.getByTestId('gps-stop-recording'));
    expect(props.onPause).toHaveBeenCalledTimes(1);
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('gps-resume-recording')).not.toBeInTheDocument();
  });

  it('shows Resume + Stop while paused and fires them', async () => {
    const user = userEvent.setup();
    const { props } = renderScreen({ recordingState: 'paused' });
    await user.click(screen.getByTestId('gps-resume-recording'));
    await user.click(screen.getByTestId('gps-stop-recording'));
    expect(props.onResume).toHaveBeenCalledTimes(1);
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it('hides the battery-optimization hint by default', () => {
    renderScreen({ recordingState: 'recording' });
    expect(screen.queryByTestId('gps-battery-optimization-hint')).not.toBeInTheDocument();
  });

  it('shows the battery-optimization hint and fires its actions', async () => {
    const user = userEvent.setup();
    const onFixBatteryOptimization = vi.fn();
    const onDismissBatteryOptimizationHint = vi.fn();
    renderScreen({
      recordingState: 'recording',
      showBatteryOptimizationHint: true,
      onFixBatteryOptimization,
      onDismissBatteryOptimizationHint,
    });
    expect(screen.getByTestId('gps-battery-optimization-hint')).toBeInTheDocument();
    await user.click(screen.getByTestId('gps-battery-optimization-fix'));
    await user.click(screen.getByTestId('gps-battery-optimization-dismiss'));
    expect(onFixBatteryOptimization).toHaveBeenCalledTimes(1);
    expect(onDismissBatteryOptimizationHint).toHaveBeenCalledTimes(1);
  });

  it('every app-btn carries a solid color variant (no bare-text buttons)', () => {
    const { container } = renderScreen({ recordingState: 'recording' });
    const buttons = container.querySelectorAll('button.app-btn');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      const cls = btn.className;
      expect(/app-btn--(primary|secondary|danger|info|success)/.test(cls)).toBe(true);
      expect(/app-btn[^"]*\bbg-/.test(cls)).toBe(false);
    });
  });
});
