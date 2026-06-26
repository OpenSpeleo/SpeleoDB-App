import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import AuthenticatedAppShell from './AuthenticatedAppShell';
import { SpeleoDBContext } from './context/useSpeleoDB';

vi.mock('./pages/Dashboard', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock('./pages/Settings', () => ({
  default: () => <div data-testid="settings-page">Settings</div>,
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
});
