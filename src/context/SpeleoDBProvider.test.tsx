import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import { SpeleoDBProvider } from './SpeleoDBProvider';

const {
  mockValidateSession,
  mockRetryConnection,
  mockLogout,
  mockStoreSubscribers,
  emitStoreUpdate,
  mockIsOfflineLockedRef,
  mockIsAuthenticated,
  mockGetPreferences,
  mockSetPreferences,
  mockClearPreferences,
  mockRunTileCacheStartupMaintenance,
  authStateSnapshot,
  projectsSnapshot,
  tilePrefetchJobsSnapshot,
} = vi.hoisted(() => {
  const storeSubscribers = new Set<() => void>();
  return {
    mockValidateSession: vi.fn(),
    mockRetryConnection: vi.fn(),
    mockLogout: vi.fn(),
    mockStoreSubscribers: storeSubscribers,
    emitStoreUpdate: () => {
      for (const listener of storeSubscribers) {
        listener();
      }
    },
    mockIsOfflineLockedRef: { current: false },
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
  };
});

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

    subscribe(listener: () => void): () => void {
      mockStoreSubscribers.add(listener);
      return () => {
        mockStoreSubscribers.delete(listener);
      };
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
      return mockIsOfflineLockedRef.current;
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
    mockStoreSubscribers.clear();

    mockGetPreferences.mockReturnValue({
      email: 'user@example.com',
      token: 'tok',
      instance: 'https://www.speleodb.org',
    });
    mockValidateSession.mockResolvedValue('ok');
    mockRetryConnection.mockResolvedValue('ok');
    mockLogout.mockResolvedValue(undefined);
    mockIsAuthenticated.mockReturnValue(true);
    mockIsOfflineLockedRef.current = false;
    mockRunTileCacheStartupMaintenance.mockResolvedValue(undefined);
  });

  it('shows offline modal on startup network_error and does not logout', async () => {
    mockValidateSession.mockResolvedValue('network_error');
    mockIsOfflineLockedRef.current = true;
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

    await waitFor(() => {
      expect(screen.getByText('Offline mode')).toBeInTheDocument();
    });
    expect(mockLogout).not.toHaveBeenCalled();
    expect(history.location.pathname).toBe('/dashboard');
  });

  it('allows Go Offline dismissal and reprompts only after offline lock clears and returns', async () => {
    mockValidateSession.mockResolvedValue('network_error');
    mockIsOfflineLockedRef.current = true;
    render(
      <Router history={createMemoryHistory({ initialEntries: ['/dashboard'] })}>
        <SpeleoDBProvider>
          <div>child</div>
        </SpeleoDBProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(mockValidateSession).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(screen.getByText('Go Offline')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Go Offline'));

    await waitFor(() => {
      expect(screen.queryByText('Offline mode')).not.toBeInTheDocument();
    });

    act(() => {
      emitStoreUpdate();
    });

    await waitFor(() => {
      expect(screen.queryByText('Offline mode')).not.toBeInTheDocument();
    });

    act(() => {
      mockIsOfflineLockedRef.current = false;
      emitStoreUpdate();
    });

    await waitFor(() => {
      expect(screen.queryByText('Offline mode')).not.toBeInTheDocument();
    });

    act(() => {
      mockIsOfflineLockedRef.current = true;
      emitStoreUpdate();
    });

    await waitFor(() => {
      expect(screen.getByText('Offline mode')).toBeInTheDocument();
    });
  });
});
