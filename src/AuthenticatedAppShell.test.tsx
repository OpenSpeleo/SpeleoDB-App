import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import AuthenticatedAppShell from './AuthenticatedAppShell';
import { SpeleoDBContext } from './context/useSpeleoDB';
import type { DashboardPanel } from './types/dashboardPanel';

vi.mock('./pages/Dashboard', () => ({
  default: ({ activeDashboardPanel }: { activeDashboardPanel: DashboardPanel }) => (
    <div
      data-testid="dashboard-page"
      data-active-panel={activeDashboardPanel ?? 'none'}
    >
      Dashboard
    </div>
  ),
}));

vi.mock('./pages/Settings', () => ({
  default: ({
    onDashboardPanelChange,
  }: {
    onDashboardPanelChange: (panel: DashboardPanel) => void;
  }) => (
    <div data-testid="settings-page">
      Settings
      <button onClick={() => onDashboardPanelChange('projects')}>Open projects</button>
      <button onClick={() => onDashboardPanelChange('landmarks')}>Open landmarks</button>
      <button onClick={() => onDashboardPanelChange('gps')}>Open GPS</button>
      <button onClick={() => onDashboardPanelChange(null)}>Close panels</button>
    </div>
  ),
}));

vi.mock('./pages/PendingOps', () => ({
  default: () => <div data-testid="pending-page">Pending</div>,
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
    await user.click(screen.getByRole('button', { name: 'Open projects' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'projects');
    await user.click(screen.getByRole('button', { name: 'Open landmarks' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'landmarks');
    await user.click(screen.getByRole('button', { name: 'Open GPS' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'gps');
    await user.click(screen.getByRole('button', { name: 'Close panels' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'none');
  });
});
