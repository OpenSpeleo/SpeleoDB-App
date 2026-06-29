import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory } from 'history';
import App from './App';
import type { DashboardPanel } from './types/dashboardPanel';

const { historyRef } = vi.hoisted(() => ({
  historyRef: { current: null as ReturnType<typeof createMemoryHistory> | null },
}));

vi.mock('@ionic/react', () => ({
  IonApp: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  setupIonicReact: () => undefined,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    BrowserRouter: ({ children }: { children?: React.ReactNode }) => (
      <actual.Router history={historyRef.current!}>
        {children}
      </actual.Router>
    ),
  };
});

vi.mock('./context/SpeleoDBProvider', () => ({
  SpeleoDBProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./context/SpeleoDBStoreProvider', () => ({
  SpeleoDBStoreProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./context/SpeleoDBStartupGate', () => ({
  SpeleoDBStartupGate: () => null,
}));

vi.mock('./services/PreferencesService', () => ({
  getShowLandmarks: () => true,
  getColorMode: () => 'project',
  getMeasurementUnit: () => 'meters',
  getSelectedMapLayerId: () => 'esri-satellite',
  getLayerOfflineSyncPreferences: () => ({}),
}));

vi.mock('./pages/Login', () => ({
  default: () => <div data-testid="mock-login">login</div>,
}));

vi.mock('./pages/PendingOps', () => ({
  default: () => <div data-testid="mock-pending" />,
}));

vi.mock('./pages/Dashboard', () => ({
  default: ({
    showLandmarks,
    colorMode,
    measurementUnit,
    activeDashboardPanel,
  }: {
    showLandmarks: boolean;
    colorMode: 'project' | 'depth';
    measurementUnit: 'feet' | 'meters';
    activeDashboardPanel: DashboardPanel;
  }) => (
    <div
      data-testid="mock-dashboard"
      data-show-landmarks={String(showLandmarks)}
      data-color-mode={colorMode}
      data-measurement-unit={measurementUnit}
      data-active-panel={activeDashboardPanel ?? 'none'}
    />
  ),
}));

vi.mock('./pages/Settings', () => ({
  default: ({
    onShowLandmarksChange,
    onColorModeChange,
    onMeasurementUnitChange,
    onDashboardPanelChange,
  }: {
    onShowLandmarksChange: (visible: boolean) => void;
    onColorModeChange: (mode: 'project' | 'depth') => void;
    onMeasurementUnitChange: (unit: 'feet' | 'meters') => void;
    onDashboardPanelChange: (panel: DashboardPanel) => void;
  }) => (
    <div data-testid="mock-settings">
      <button
        type="button"
        data-testid="settings-hide-landmarks"
        onClick={() => onShowLandmarksChange(false)}
      >
        Hide landmarks
      </button>
      <button
        type="button"
        data-testid="settings-enable-depth-mode"
        onClick={() => onColorModeChange('depth')}
      >
        Enable depth mode
      </button>
      <button
        type="button"
        data-testid="settings-enable-feet"
        onClick={() => onMeasurementUnitChange('feet')}
      >
        Enable feet
      </button>
      <button
        type="button"
        data-testid="settings-open-panel"
        onClick={() => onDashboardPanelChange('projects')}
      >
        Open panel
      </button>
    </div>
  ),
}));

describe('App shared state wiring', () => {
  beforeEach(() => {
    historyRef.current = createMemoryHistory({ initialEntries: ['/settings'] });
  });

  it('propagates settings changes to dashboard state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId('mock-settings');

    await user.click(screen.getByTestId('settings-hide-landmarks'));
    await user.click(screen.getByTestId('settings-enable-depth-mode'));
    await user.click(screen.getByTestId('settings-enable-feet'));
    await user.click(screen.getByTestId('settings-open-panel'));

    act(() => {
      historyRef.current!.push('/dashboard');
    });

    const dashboard = await screen.findByTestId('mock-dashboard');
    await waitFor(() => {
      expect(dashboard).toHaveAttribute('data-show-landmarks', 'false');
      expect(dashboard).toHaveAttribute('data-color-mode', 'depth');
      expect(dashboard).toHaveAttribute('data-measurement-unit', 'feet');
      expect(dashboard).toHaveAttribute('data-active-panel', 'projects');
    });
  });
});
