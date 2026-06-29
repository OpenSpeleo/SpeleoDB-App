import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import AppTabBar from './AppTabBar';
import type { DashboardPanel } from '../types/dashboardPanel';

function renderTabBar(
  pathname: string,
  activeDashboardPanel: DashboardPanel = null,
  pendingOpsCount = 0,
  options: { isGpsRecording?: boolean } = {},
) {
  const history = createMemoryHistory({ initialEntries: [pathname] });
  const onDashboardPanelChange = vi.fn();
  const onTabPress = vi.fn();
  render(
    <Router history={history}>
      <AppTabBar
        activeDashboardPanel={activeDashboardPanel}
        onDashboardPanelChange={onDashboardPanelChange}
        isGpsRecording={options.isGpsRecording ?? false}
        onTabPress={onTabPress}
        pendingOpsCount={pendingOpsCount}
      />
    </Router>,
  );
  return { history, onDashboardPanelChange, onTabPress };
}

describe('AppTabBar', () => {
  it('opens the project panel and navigates to dashboard from settings', async () => {
    const user = userEvent.setup();
    const { history, onDashboardPanelChange } = renderTabBar('/settings');

    await user.click(screen.getByTestId('projects-tab'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onDashboardPanelChange).toHaveBeenCalledWith('projects');
  });

  it('toggles the project panel closed on dashboard when already open', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard', 'projects');

    await user.click(screen.getByTestId('projects-tab'));

    expect(onDashboardPanelChange).toHaveBeenCalledWith(null);
  });

  it('opens the project panel on dashboard when currently closed', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard');

    await user.click(screen.getByTestId('projects-tab'));

    expect(onDashboardPanelChange).toHaveBeenCalledWith('projects');
  });

  it('replaces the active panel with one atomic transition', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard', 'landmarks');

    await user.click(screen.getByTestId('projects-tab'));

    expect(onDashboardPanelChange).toHaveBeenCalledOnce();
    expect(onDashboardPanelChange).toHaveBeenCalledWith('projects');
  });

  it('navigates to dashboard map and closes panel from settings map tab', async () => {
    const user = userEvent.setup();
    const { history, onDashboardPanelChange } = renderTabBar('/settings', 'landmarks');

    await user.click(screen.getByText('Map'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onDashboardPanelChange).toHaveBeenCalledOnce();
    expect(onDashboardPanelChange).toHaveBeenCalledWith(null);
  });

  it('renders the GPS tab between Landmarks and Map', () => {
    renderTabBar('/dashboard');
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Projects', 'Landmarks', 'GPS', 'Map', 'Settings']);
  });

  it('opens the GPS panel and navigates to dashboard from settings', async () => {
    const user = userEvent.setup();
    const { history, onDashboardPanelChange } = renderTabBar('/settings');

    await user.click(screen.getByTestId('gps-tab'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onDashboardPanelChange).toHaveBeenCalledWith('gps');
  });

  it('toggles the GPS panel closed on dashboard when already open', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard', 'gps');

    await user.click(screen.getByTestId('gps-tab'));

    expect(onDashboardPanelChange).toHaveBeenCalledWith(null);
  });

  it('closes the GPS panel when the Map tab is tapped', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard', 'gps');

    await user.click(screen.getByText('Map'));

    expect(onDashboardPanelChange).toHaveBeenCalledWith(null);
  });

  it('does not republish an already-active Map state', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard');

    await user.click(screen.getByText('Map'));

    expect(onDashboardPanelChange).not.toHaveBeenCalled();
  });

  it('calls onTabPress on every tab press (to collapse GPS overlays)', async () => {
    const user = userEvent.setup();
    const { onTabPress } = renderTabBar('/dashboard', null, 2);
    await user.click(screen.getByTestId('projects-tab'));
    await user.click(screen.getByTestId('landmarks-tab'));
    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByText('Map'));
    await user.click(screen.getByTestId('pending-tab'));
    await user.click(screen.getByTestId('settings-tab'));
    expect(onTabPress).toHaveBeenCalledTimes(6);
  });

  it('shows a recording dot on the GPS tab while recording', () => {
    renderTabBar('/dashboard', null, 0, { isGpsRecording: true });
    expect(screen.getByTestId('gps-tab-recording-dot')).toBeInTheDocument();
  });

  it('hides the recording dot when not recording', () => {
    renderTabBar('/dashboard');
    expect(screen.queryByTestId('gps-tab-recording-dot')).toBeNull();
  });

  it('opens the landmark panel and navigates to dashboard from settings', async () => {
    const user = userEvent.setup();
    const { history, onDashboardPanelChange } = renderTabBar('/settings');

    await user.click(screen.getByTestId('landmarks-tab'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onDashboardPanelChange).toHaveBeenCalledWith('landmarks');
  });

  it('opens the landmark panel on dashboard when currently closed', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard');

    await user.click(screen.getByTestId('landmarks-tab'));

    expect(onDashboardPanelChange).toHaveBeenCalledWith('landmarks');
  });

  it('toggles the landmark panel closed on dashboard when already open', async () => {
    const user = userEvent.setup();
    const { onDashboardPanelChange } = renderTabBar('/dashboard', 'landmarks');

    await user.click(screen.getByTestId('landmarks-tab'));

    expect(onDashboardPanelChange).toHaveBeenCalledWith(null);
  });

  it('hides the Pending tab when there are no pending ops', () => {
    renderTabBar('/dashboard', null, 0);
    expect(screen.queryByTestId('pending-tab')).toBeNull();
  });

  it('reveals the Pending tab with a badge when there are pending ops', () => {
    renderTabBar('/dashboard', null, 3);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(tabs[4]).toHaveAttribute('data-testid', 'pending-tab');
    expect(tabs[4]).toHaveTextContent('Pending');
    expect(tabs[5]).toHaveTextContent('Settings');
    expect(screen.getByTestId('pending-tab-badge')).toHaveTextContent('3');
  });

  it('navigates to the Pending page when the Pending tab is tapped', async () => {
    const user = userEvent.setup();
    const { history } = renderTabBar('/dashboard', null, 2);

    await user.click(screen.getByTestId('pending-tab'));

    expect(history.location.pathname).toBe('/pending');
  });

  it('keeps the Pending tab visible on /pending even when the queue is empty', () => {
    renderTabBar('/pending', null, 0);
    expect(screen.getByTestId('pending-tab')).toBeTruthy();
  });
});
