import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

vi.mock('@ionic/react', () => ({
  IonApp: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  setupIonicReact: () => undefined,
}));

vi.mock('@ionic/react-router', () => ({
  IonReactRouter: ({ children }: { children?: React.ReactNode }) => (
    <MemoryRouter initialEntries={[window.location.pathname]}>
      {children}
    </MemoryRouter>
  ),
}));

vi.mock('./context/SpeleoDBProvider', () => ({
  SpeleoDBProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./services/PreferencesService', () => ({
  getShowLandmarks: () => true,
}));

vi.mock('./pages/Login', () => ({
  default: () => <div data-testid="mock-login">login</div>,
}));

vi.mock('./pages/Dashboard', () => ({
  default: ({
    showLandmarks,
    isProjectPanelOpen,
  }: {
    showLandmarks: boolean;
    isProjectPanelOpen: boolean;
  }) => (
    <div
      data-testid="mock-dashboard"
      data-show-landmarks={String(showLandmarks)}
      data-panel-open={String(isProjectPanelOpen)}
    />
  ),
}));

vi.mock('./pages/Settings', () => ({
  default: ({
    onShowLandmarksChange,
    onProjectPanelChange,
  }: {
    onShowLandmarksChange: (visible: boolean) => void;
    onProjectPanelChange: (open: boolean) => void;
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
        data-testid="settings-open-panel"
        onClick={() => onProjectPanelChange(true)}
      >
        Open panel
      </button>
    </div>
  ),
}));

describe('App shared state wiring', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/settings');
  });

  it('propagates settings changes to dashboard state', async () => {
    const user = userEvent.setup();
    render(<App />);

    const dashboard = screen.getByTestId('mock-dashboard');
    expect(dashboard).toHaveAttribute('data-show-landmarks', 'true');
    expect(dashboard).toHaveAttribute('data-panel-open', 'false');

    await user.click(screen.getByTestId('settings-hide-landmarks'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-dashboard')).toHaveAttribute('data-show-landmarks', 'false');
    });

    await user.click(screen.getByTestId('settings-open-panel'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-dashboard')).toHaveAttribute('data-panel-open', 'true');
    });
  });
});
