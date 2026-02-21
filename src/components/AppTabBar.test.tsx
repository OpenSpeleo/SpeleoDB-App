import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import AppTabBar from './AppTabBar';

function renderTabBar(pathname: string, isProjectPanelOpen = false) {
  const history = createMemoryHistory({ initialEntries: [pathname] });
  const onProjectPanelChange = vi.fn();
  render(
    <Router history={history}>
      <AppTabBar
        isProjectPanelOpen={isProjectPanelOpen}
        onProjectPanelChange={onProjectPanelChange}
      />
    </Router>,
  );
  return { history, onProjectPanelChange };
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
    const { history, onProjectPanelChange } = renderTabBar('/settings', true);

    await user.click(screen.getByText('Map'));

    expect(history.location.pathname).toBe('/dashboard');
    expect(onProjectPanelChange).toHaveBeenCalledWith(false);
  });
});
