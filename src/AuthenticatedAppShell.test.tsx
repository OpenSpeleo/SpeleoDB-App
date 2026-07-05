import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import AuthenticatedAppShell from './AuthenticatedAppShell';
import { SpeleoDBContext } from './context/useSpeleoDB';
import type { DashboardPanel } from './types/dashboardPanel';

const pageLifecycle = vi.hoisted(() => ({
  settingsMounted: vi.fn(),
  settingsUnmounted: vi.fn(),
  pendingMounted: vi.fn(),
  pendingUnmounted: vi.fn(),
}));

vi.mock('./pages/Dashboard', () => ({
  default: function MockDashboard({
    activeDashboardPanel,
    isActive,
  }: {
    activeDashboardPanel: DashboardPanel;
    isActive: boolean;
  }) {
    const [mapState, setMapState] = React.useState(0);
    return (
      <div
        data-testid="dashboard-page"
        data-active-panel={activeDashboardPanel ?? 'none'}
        data-route-active={isActive ? 'true' : 'false'}
      >
        Dashboard
        <button onClick={() => setMapState((current) => current + 1)}>
          Map state {mapState}
        </button>
      </div>
    );
  },
}));

vi.mock('./pages/Settings', () => ({
  default: function MockSettings({
    onDashboardPanelChange,
  }: {
    onDashboardPanelChange: (panel: DashboardPanel) => void;
  }) {
    React.useEffect(() => {
      pageLifecycle.settingsMounted();
      return () => pageLifecycle.settingsUnmounted();
    }, []);
    return (
      <div data-testid="settings-page">
        Settings
        <button onClick={() => onDashboardPanelChange('projects')}>Open projects</button>
        <button onClick={() => onDashboardPanelChange('landmarks')}>Open landmarks</button>
        <button onClick={() => onDashboardPanelChange('gps')}>Open GPS</button>
        <button onClick={() => onDashboardPanelChange(null)}>Close panels</button>
      </div>
    );
  },
}));

vi.mock('./pages/PendingOps', () => ({
  default: function MockPendingOps() {
    React.useEffect(() => {
      pageLifecycle.pendingMounted();
      return () => pageLifecycle.pendingUnmounted();
    }, []);
    return <div data-testid="pending-page">Pending</div>;
  },
}));

describe('AuthenticatedAppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces GPS recording errors even when Dashboard is hidden', async () => {
    const clearGpsRecordingError = vi.fn();
    const history = createMemoryHistory({ initialEntries: ['/settings'] });

    render(
      <Router history={history}>
        <SpeleoDBContext.Provider
          value={{
            controller: { clearGpsRecordingError },
            gpsRecordingError: 'Location access was denied.',
          } as never}
        >
          <AuthenticatedAppShell />
        </SpeleoDBContext.Provider>
      </Router>,
    );

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
    expect(screen.getByTestId('gps-recording-error-toast')).toHaveTextContent(
      'Location access was denied.',
    );
    expect(clearGpsRecordingError).toHaveBeenCalledTimes(1);
  });

  it('publishes exactly one active dashboard panel across hidden routes', async () => {
    const user = userEvent.setup();
    const history = createMemoryHistory({ initialEntries: ['/settings'] });
    render(
      <Router history={history}>
        <SpeleoDBContext.Provider value={{} as never}>
          <AuthenticatedAppShell />
        </SpeleoDBContext.Provider>
      </Router>,
    );

    const dashboard = await screen.findByTestId('dashboard-page');
    expect(dashboard).toHaveAttribute('data-active-panel', 'none');
    expect(dashboard).toHaveAttribute('data-route-active', 'false');
    await user.click(screen.getByRole('button', { name: 'Open projects' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'projects');
    await user.click(screen.getByRole('button', { name: 'Open landmarks' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'landmarks');
    await user.click(screen.getByRole('button', { name: 'Open GPS' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'gps');
    await user.click(screen.getByRole('button', { name: 'Close panels' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'none');
  });

  it('retains Dashboard state while unmounting inactive non-map pages', async () => {
    const user = userEvent.setup();
    const history = createMemoryHistory({ initialEntries: ['/dashboard'] });
    render(
      <Router history={history}>
        <SpeleoDBContext.Provider value={{} as never}>
          <AuthenticatedAppShell />
        </SpeleoDBContext.Provider>
      </Router>,
    );

    await user.click(await screen.findByRole('button', { name: 'Map state 0' }));
    expect(screen.getByTestId('dashboard-page')).toHaveAttribute('data-route-active', 'true');
    expect(screen.getByRole('button', { name: 'Map state 1' })).toBeInTheDocument();
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-page')).not.toBeInTheDocument();

    act(() => history.push('/settings'));
    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
    expect(pageLifecycle.settingsMounted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dashboard-page')).toHaveTextContent('Map state 1');
    expect(screen.getByTestId('dashboard-page')).toHaveAttribute('data-route-active', 'false');

    act(() => history.push('/pending'));
    expect(await screen.findByTestId('pending-page')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument();
    expect(pageLifecycle.settingsUnmounted).toHaveBeenCalledTimes(1);
    expect(pageLifecycle.pendingMounted).toHaveBeenCalledTimes(1);

    act(() => history.push('/dashboard'));
    expect(screen.queryByTestId('pending-page')).not.toBeInTheDocument();
    expect(pageLifecycle.pendingUnmounted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Map state 1' })).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-page')).toHaveAttribute('data-route-active', 'true');
  });
});
