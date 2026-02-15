import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import { SpeleoDBProvider } from './SpeleoDBProvider';

const {
  mockValidateSession,
  mockRetryConnection,
  mockLogout,
  mockIsAuthenticated,
  mockGetPreferences,
  mockSetPreferences,
  mockClearPreferences,
  mockRunTileCacheStartupMaintenance,
  authStateSnapshot,
  projectsSnapshot,
  tilePrefetchJobsSnapshot,
} = vi.hoisted(() => ({
  mockValidateSession: vi.fn(),
  mockRetryConnection: vi.fn(),
  mockLogout: vi.fn(),
  mockIsAuthenticated: vi.fn(),
  mockGetPreferences: vi.fn(),
  mockSetPreferences: vi.fn(),
  mockClearPreferences: vi.fn(),
  mockRunTileCacheStartupMaintenance: vi.fn(),
  authStateSnapshot: {
    isAuthenticated: true,
    user: { id: 'restored', email: 'user@example.com', name: 'user@example.com' },
    token: 'tok',
  },
  projectsSnapshot: [] as unknown[],
  tilePrefetchJobsSnapshot: [] as unknown[],
}));

vi.mock('@ionic/react', () => ({
  IonModal: ({
    children,
    isOpen,
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
  }) => (isOpen ? <div data-testid="ion-modal">{children}</div> : null),
  IonContent: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div data-testid="ion-content">{children}</div>,
  IonButton: ({
    children,
    disabled,
    onClick,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('../services/TileCacheService', () => ({
  runTileCacheStartupMaintenance: mockRunTileCacheStartupMaintenance,
}));

vi.mock('../services/PreferencesService', () => ({
  getPreferences: mockGetPreferences,
  setPreferences: mockSetPreferences,
  clearPreferences: mockClearPreferences,
}));

vi.mock('../controllers/SpeleoDBController', () => {
  class SpeleoDBController {
    validateSession = mockValidateSession;
    retryConnection = mockRetryConnection;
    logout = mockLogout;

    subscribe(): () => void {
      return () => {};
    }

    isAuthenticated(): boolean {
      return mockIsAuthenticated();
    }

    get authState() {
      return authStateSnapshot;
    }

    get isOnline() {
      return false;
    }

    get isOfflineLocked() {
      return false;
    }

    get isRetryingConnection() {
      return false;
    }

    get projects() {
      return projectsSnapshot;
    }

    get syncStatus() {
      return 'idle' as const;
    }

    get tilePrefetchJobs() {
      return tilePrefetchJobsSnapshot;
    }
  }

  return { SpeleoDBController };
});

describe('SpeleoDBProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetPreferences.mockReturnValue({
      email: 'user@example.com',
      token: 'tok',
      instance: 'https://www.speleodb.org',
    });
    mockValidateSession.mockResolvedValue('ok');
    mockRetryConnection.mockResolvedValue('ok');
    mockLogout.mockResolvedValue(undefined);
    mockIsAuthenticated.mockReturnValue(true);
    mockRunTileCacheStartupMaintenance.mockResolvedValue(undefined);
  });

  it('shows offline modal and does not logout when browser goes offline', async () => {
    const history = createMemoryHistory({ initialEntries: ['/dashboard'] });
    render(
      <Router history={history}>
        <SpeleoDBProvider>
          <div>child</div>
        </SpeleoDBProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(mockValidateSession).toHaveBeenCalledOnce();
    });

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    await waitFor(() => {
      expect(screen.getByText('Offline mode')).toBeInTheDocument();
    });
    expect(mockLogout).not.toHaveBeenCalled();
    expect(history.location.pathname).toBe('/dashboard');
  });
});
