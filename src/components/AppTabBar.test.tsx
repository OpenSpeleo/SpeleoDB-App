import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import AppTabBar from './AppTabBar';

function renderTabBar(
  pathname: string,
  isProjectPanelOpen = false,
  isLandmarkPanelOpen = false,
  pendingOpsCount = 0,
) {
  const history = createMemoryHistory({ initialEntries: [pathname] });
  const onProjectPanelChange = vi.fn();
  const onLandmarkPanelChange = vi.fn();
  render(
    <Router history={history}>
      <AppTabBar
        isProjectPanelOpen={isProjectPanelOpen}
        onProjectPanelChange={onProjectPanelChange}
        isLandmarkPanelOpen={isLandmarkPanelOpen}
        onLandmarkPanelChange={onLandmarkPanelChange}
        pendingOpsCount={pendingOpsCount}
      />
    </Router>,
  );
  return { history, onProjectPanelChange, onLandmarkPanelChange };
}

describe('AppTabBar', () => {
  it('opens the project panel and navigates to dashboard from settings', async () => {
    const user = userEvent.setup();
    const { history, onProjectPanelChange } = renderTabBar('/settings');

    await user.click(screen.getByTestId('projects-tab'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onProjectPanelChange).toHaveBeenCalledWith(true);
  });

  it('toggles the project panel closed on dashboard when already open', async () => {
    const user = userEvent.setup();
    const { onProjectPanelChange } = renderTabBar('/dashboard', true);

    await user.click(screen.getByTestId('projects-tab'));

    expect(onProjectPanelChange).toHaveBeenCalledWith(false);
  });

  it('opens the project panel on dashboard when currently closed', async () => {
    const user = userEvent.setup();
    const { onProjectPanelChange } = renderTabBar('/dashboard', false);

    await user.click(screen.getByTestId('projects-tab'));

    expect(onProjectPanelChange).toHaveBeenCalledWith(true);
  });

  it('navigates to dashboard map and closes panel from settings map tab', async () => {
    const user = userEvent.setup();
    const { history, onProjectPanelChange, onLandmarkPanelChange } = renderTabBar('/settings', true, true);

    await user.click(screen.getByText('Map'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onProjectPanelChange).toHaveBeenCalledWith(false);
    expect(onLandmarkPanelChange).toHaveBeenCalledWith(false);
  });

  it('renders the Landmarks tab between Projects and Map', () => {
    renderTabBar('/dashboard');
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Projects', 'Landmarks', 'Map', 'Settings']);
  });

  it('opens the landmark panel and navigates to dashboard from settings', async () => {
    const user = userEvent.setup();
    const { history, onLandmarkPanelChange } = renderTabBar('/settings');

    await user.click(screen.getByTestId('landmarks-tab'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onLandmarkPanelChange).toHaveBeenCalledWith(true);
  });

  it('opens the landmark panel on dashboard when currently closed', async () => {
    const user = userEvent.setup();
    const { onLandmarkPanelChange } = renderTabBar('/dashboard', false, false);

    await user.click(screen.getByTestId('landmarks-tab'));

    expect(onLandmarkPanelChange).toHaveBeenCalledWith(true);
  });

  it('toggles the landmark panel closed on dashboard when already open', async () => {
    const user = userEvent.setup();
    const { onLandmarkPanelChange } = renderTabBar('/dashboard', false, true);

    await user.click(screen.getByTestId('landmarks-tab'));

    expect(onLandmarkPanelChange).toHaveBeenCalledWith(false);
  });

  it('hides the Pending tab when there are no pending ops', () => {
    renderTabBar('/dashboard', false, false, 0);
    expect(screen.queryByTestId('pending-tab')).toBeNull();
  });

  it('reveals the Pending tab with a badge when there are pending ops', () => {
    renderTabBar('/dashboard', false, false, 3);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs[3]).toHaveAttribute('data-testid', 'pending-tab');
    expect(tabs[3]).toHaveTextContent('Pending');
    expect(tabs[4]).toHaveTextContent('Settings');
    expect(screen.getByTestId('pending-tab-badge')).toHaveTextContent('3');
  });

  it('navigates to the Pending page when the Pending tab is tapped', async () => {
    const user = userEvent.setup();
    const { history } = renderTabBar('/dashboard', false, false, 2);

    await user.click(screen.getByTestId('pending-tab'));

    expect(history.location.pathname).toBe('/pending');
  });

  it('keeps the Pending tab visible on /pending even when the queue is empty', () => {
    renderTabBar('/pending', false, false, 0);
    expect(screen.getByTestId('pending-tab')).toBeTruthy();
  });
});
