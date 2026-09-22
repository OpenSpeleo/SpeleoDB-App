import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import AuthenticatedAppShell from './AuthenticatedAppShell';
import { SpeleoDBContext } from './context/useSpeleoDB';
import type { DashboardPanel } from './types/dashboardPanel';
import type { MapDisplayPreferences, MapDisplayPreferencesPatch } from './types/mapDisplayPreferences';
import { PREFERENCES } from './constants';
import { clearPreferences, getMapDisplayPreferences } from './services/PreferencesService';

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
    mapDisplayPreferences,
  }: {
    activeDashboardPanel: DashboardPanel;
    isActive: boolean;
    mapDisplayPreferences: MapDisplayPreferences;
  }) {
    const [mapState, setMapState] = React.useState(0);
    return (
      <div
        data-testid="dashboard-page"
        data-active-panel={activeDashboardPanel ?? 'none'}
        data-route-active={isActive ? 'true' : 'false'}
        data-display-preferences={JSON.stringify(mapDisplayPreferences)}
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
    onMapDisplayPreferencesChange,
  }: {
    onDashboardPanelChange: (panel: DashboardPanel) => void;
    onMapDisplayPreferencesChange: (patch: MapDisplayPreferencesPatch) => void;
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
        <button onClick={() => onDashboardPanelChange('gis-geometries')}>Open GIS Geometry</button>
        <button onClick={() => onDashboardPanelChange(null)}>Close panels</button>
        <button onClick={() => {
          onMapDisplayPreferencesChange({ categories: { caveEntrances: false } });
          onMapDisplayPreferencesChange({ stationTypes: { biology: false } });
          onMapDisplayPreferencesChange({ depthLimitFeet: 80.25 });
        }}>Customize display</button>
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
    clearPreferences();
  });

  it('hydrates legacy visibility and merges rapid settings changes into the retained map and storage', async () => {
    localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify({ showLandmarks: false }));
    const history = createMemoryHistory({ initialEntries: ['/settings'] });
    const view = render(<Router history={history}><AuthenticatedAppShell /></Router>);
    const dashboard = await screen.findByTestId('dashboard-page');
    expect(JSON.parse(dashboard.getAttribute('data-display-preferences')!).categories.landmarks).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Customize display' }));
    const expected = {
      categories: { caveEntrances: false, landmarks: false },
      stationTypes: { biology: false }, depthLimitFeet: 80.25,
    };
    expect(JSON.parse(dashboard.getAttribute('data-display-preferences')!)).toMatchObject(expected);
    expect(getMapDisplayPreferences()).toMatchObject(expected);
    expect(JSON.parse(localStorage.getItem(PREFERENCES.STORAGE_KEY)!)).not.toHaveProperty('showLandmarks');
    act(() => history.push('/dashboard'));
    expect(JSON.parse(dashboard.getAttribute('data-display-preferences')!)).toMatchObject(expected);
    view.unmount();
    render(<Router history={history}><AuthenticatedAppShell /></Router>);
    expect(JSON.parse((await screen.findByTestId('dashboard-page')).getAttribute('data-display-preferences')!)).toMatchObject(expected);
  });

  it('keeps map controls usable in memory when persistence is unavailable', async () => {
    const history = createMemoryHistory({ initialEntries: ['/settings'] });
    render(<Router history={history}><AuthenticatedAppShell /></Router>);
    await screen.findByTestId('settings-page');
    const storage = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Customize display' }));
      act(() => history.push('/dashboard'));
      expect(JSON.parse(screen.getByTestId('dashboard-page').getAttribute('data-display-preferences')!)).toMatchObject({
        categories: { caveEntrances: false }, stationTypes: { biology: false }, depthLimitFeet: 80.25,
      });
      expect(errors).toHaveBeenCalledTimes(3);
    } finally {
      storage.mockRestore();
      errors.mockRestore();
    }
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
    await user.click(screen.getByRole('button', { name: 'Open GIS Geometry' }));
    expect(dashboard).toHaveAttribute('data-active-panel', 'gis-geometries');
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
