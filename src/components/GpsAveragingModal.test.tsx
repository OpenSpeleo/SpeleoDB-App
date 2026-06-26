import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GpsAveragingModal, { type GpsAveragingModalProps } from './GpsAveragingModal';
import type { AveragingResult } from '../utils/gpsAveraging';
import type { GnssStatusSnapshot } from '../types/gnss';

vi.mock('@ionic/react', () => ({
  IonModal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) =>
    isOpen ? <div data-testid="ion-modal">{children}</div> : null,
  IonContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const UNSUPPORTED_GNSS: GnssStatusSnapshot = { supported: false, multiBand: null, constellations: [] };

function result(overrides: Partial<AveragingResult> = {}): AveragingResult {
  return {
    latitude: 45.123456,
    longitude: -73.654321,
    altitude: 100,
    horizontalAccuracyMeters: 3.2,
    verticalAccuracyMeters: 6.4,
    sampleCount: 40,
    rejectedCount: 0,
    elapsedMs: 65_000,
    confidence: 72,
    isStable: true,
    ...overrides,
  };
}

function renderModal(overrides: Partial<GpsAveragingModalProps> = {}) {
  const props: GpsAveragingModalProps = {
    isOpen: true,
    status: 'collecting',
    result: result(),
    gnss: UNSUPPORTED_GNSS,
    measurementUnit: 'meters',
    phase: 'running',
    onStart: vi.fn(),
    onStop: vi.fn(),
    onReset: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<GpsAveragingModal {...props} />) };
}

describe('GpsAveragingModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not render body when closed', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByTestId('gps-averaging-modal')).not.toBeInTheDocument();
  });

  it('always shows a short explanation of what is happening', () => {
    renderModal({ phase: 'idle', result: null });
    expect(screen.getByTestId('gps-averaging-explainer')).toBeInTheDocument();
  });

  it('goes straight to the measurement view in a held state (no intro page)', () => {
    const { props } = renderModal({ phase: 'idle', result: null });
    // Measurement readout is present immediately, with placeholders.
    expect(screen.getByTestId('gps-averaging-confidence')).toHaveTextContent('0%');
    expect(screen.getByTestId('gps-averaging-lat')).toHaveTextContent('—');
    expect(screen.getByTestId('gps-averaging-samples')).toHaveTextContent('0');
    // Held controls: Start only (the header back button handles closing); no
    // Stop/Save/Reset yet.
    expect(screen.getByTestId('gps-averaging-start')).toBeInTheDocument();
    expect(screen.queryByTestId('gps-averaging-stop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gps-averaging-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gps-averaging-reset')).not.toBeInTheDocument();
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('fires onStart when Start is tapped (held)', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ phase: 'idle', result: null });
    await user.click(screen.getByTestId('gps-averaging-start'));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('shows Stop + Reset (and fires them) while running, with no bottom Cancel', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ phase: 'running' });
    expect(screen.queryByTestId('gps-averaging-cancel')).not.toBeInTheDocument();
    expect(screen.getByTestId('gps-averaging-stop')).toBeInTheDocument();

    await user.click(screen.getByTestId('gps-averaging-stop'));
    expect(props.onStop).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('gps-averaging-reset'));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('when stopped, shows Start (resume) + Save + Reset and keeps the data', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ phase: 'stopped', result: result() });
    // Data is retained and shown while paused.
    expect(screen.getByTestId('gps-averaging-samples')).toHaveTextContent('40');
    expect(screen.getByTestId('gps-averaging-confidence')).toHaveTextContent('72%');
    // Controls: Start (resume), Save, Reset; no Stop.
    expect(screen.queryByTestId('gps-averaging-stop')).not.toBeInTheDocument();
    expect(screen.getByTestId('gps-averaging-save')).toBeEnabled();
    expect(screen.getByTestId('gps-averaging-reset')).toBeInTheDocument();

    await user.click(screen.getByTestId('gps-averaging-start'));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('does not offer Reset in the held (idle) state', () => {
    renderModal({ phase: 'idle', result: null });
    expect(screen.queryByTestId('gps-averaging-reset')).not.toBeInTheDocument();
  });

  it('shows confidence, accuracy, elapsed and sample readouts when running', () => {
    renderModal();
    expect(screen.getByTestId('gps-averaging-confidence')).toHaveTextContent('72%');
    expect(screen.getByTestId('gps-averaging-confidence-bar')).toHaveStyle({ width: '72%' });
    expect(screen.getByTestId('gps-averaging-haccuracy')).toHaveTextContent('3.2 m');
    expect(screen.getByTestId('gps-averaging-vaccuracy')).toHaveTextContent('6.4 m');
    expect(screen.getByTestId('gps-averaging-elapsed')).toHaveTextContent('1:05');
    expect(screen.getByTestId('gps-averaging-samples')).toHaveTextContent('40');
    expect(screen.getByTestId('gps-averaging-lat')).toHaveTextContent('45.123456');
  });

  it('labels the accuracy rows as horizontal/vertical accuracy', () => {
    renderModal();
    expect(screen.getByText('Horizontal accuracy')).toBeInTheDocument();
    expect(screen.getByText('Vertical accuracy')).toBeInTheDocument();
  });

  describe('satellite checklist', () => {
    it('hides the per-constellation list and shows an honest fix indicator when unsupported (iOS/web)', () => {
      renderModal({ gnss: UNSUPPORTED_GNSS, phase: 'running', result: result() });
      expect(screen.getByTestId('gps-averaging-constellations')).toBeInTheDocument();
      expect(screen.getByTestId('gps-constellation-unavailable')).toBeInTheDocument();
      // No misleading per-constellation rows on a platform that cannot report them.
      expect(screen.queryByTestId('gps-constellation-gps')).not.toBeInTheDocument();
      expect(screen.queryByTestId('gps-averaging-multiband')).not.toBeInTheDocument();
      // Instead, a single honest indicator that reflects we ARE receiving fixes.
      expect(screen.getByTestId('gps-fix-indicator')).toHaveAttribute('data-state', 'fixed');
    });

    it('fix indicator reflects acquiring vs fixed vs idle when unsupported', () => {
      const base = {
        isOpen: true as const,
        gnss: UNSUPPORTED_GNSS,
        measurementUnit: 'meters' as const,
        onStart: vi.fn(),
        onStop: vi.fn(),
        onReset: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
      };
      const { rerender } = render(
        <GpsAveragingModal {...base} status="acquiring" result={null} phase="running" />,
      );
      expect(screen.getByTestId('gps-fix-indicator')).toHaveAttribute('data-state', 'acquiring');

      // Paused but with data -> still shows a fix.
      rerender(<GpsAveragingModal {...base} status="collecting" result={result()} phase="stopped" />);
      expect(screen.getByTestId('gps-fix-indicator')).toHaveAttribute('data-state', 'fixed');

      rerender(<GpsAveragingModal {...base} status="idle" result={null} phase="idle" />);
      expect(screen.getByTestId('gps-fix-indicator')).toHaveAttribute('data-state', 'idle');
    });

    it('shows green check (in use) and red cross (not used) when supported', () => {
      const gnss: GnssStatusSnapshot = {
        supported: true,
        multiBand: true,
        constellations: [
          { id: 'gps', inUse: true, satellitesUsed: 9 },
          { id: 'galileo', inUse: true, satellitesUsed: 6 },
          { id: 'glonass', inUse: false },
        ],
      };
      renderModal({ gnss });

      expect(screen.getByTestId('gps-constellation-gps-status')).toHaveAttribute('data-inuse', 'true');
      expect(screen.getByTestId('gps-constellation-galileo-status')).toHaveAttribute('data-inuse', 'true');
      expect(screen.getByTestId('gps-constellation-glonass-status')).toHaveAttribute('data-inuse', 'false');
      // A constellation the snapshot omits defaults to "not used" when supported.
      expect(screen.getByTestId('gps-constellation-beidou-status')).toHaveAttribute('data-inuse', 'false');
      // Multi-band badge + no unavailable note.
      expect(screen.getByTestId('gps-averaging-multiband')).toHaveTextContent('Multi-band');
      expect(screen.queryByTestId('gps-constellation-unavailable')).not.toBeInTheDocument();
    });
  });

  it('formats accuracy in feet when imperial', () => {
    renderModal({ measurementUnit: 'feet', result: result({ horizontalAccuracyMeters: 3 }) });
    expect(screen.getByTestId('gps-averaging-haccuracy')).toHaveTextContent('9.8 ft');
  });

  it('saves the averaged coordinates', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    await user.click(screen.getByTestId('gps-averaging-save'));
    expect(props.onSave).toHaveBeenCalledWith({
      latitude: 45.123456,
      longitude: -73.654321,
      altitude: 100,
    });
  });

  it('closes via the top-left back button (back === cancel)', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ phase: 'idle', result: null });
    await user.click(screen.getByTestId('gps-averaging-back'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the back button available while running', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ phase: 'running' });
    await user.click(screen.getByTestId('gps-averaging-back'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables save while busy and shows a saving label', () => {
    renderModal({ busy: true });
    expect(screen.getByTestId('gps-averaging-save')).toBeDisabled();
    expect(screen.getByTestId('gps-averaging-save')).toHaveTextContent('Saving');
  });

  it('disables save when there is no result yet', () => {
    renderModal({ result: null, status: 'acquiring' });
    expect(screen.getByTestId('gps-averaging-save')).toBeDisabled();
  });

  it('shows a permission-denied message', () => {
    renderModal({ status: 'permission-denied', result: null });
    expect(screen.getByTestId('gps-averaging-permission')).toBeInTheDocument();
    expect(screen.queryByTestId('gps-averaging-confidence')).not.toBeInTheDocument();
    expect(screen.getByTestId('gps-averaging-start')).toBeInTheDocument();
    expect(screen.queryByTestId('gps-averaging-stop')).not.toBeInTheDocument();
  });

  it('shows an error message when the GPS could not start', () => {
    renderModal({ status: 'error', result: null });
    expect(screen.getByTestId('gps-averaging-error')).toBeInTheDocument();
  });

  it('prompts to keep collecting when not yet stable', () => {
    renderModal({ result: result({ isStable: false }) });
    expect(screen.getByText('Keep collecting for a more reliable point.')).toBeInTheDocument();
  });

  it('every app-btn carries a solid color variant (no bare-text buttons)', () => {
    const { container } = renderModal({ phase: 'running' });
    const buttons = container.querySelectorAll('button.app-btn');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      const cls = btn.className;
      expect(/app-btn--(primary|secondary|danger|info|success)/.test(cls)).toBe(true);
      expect(/app-btn[^"]*\bbg-/.test(cls)).toBe(false);
    });
  });
});
