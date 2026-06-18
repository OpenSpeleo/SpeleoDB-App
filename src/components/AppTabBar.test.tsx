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
});
