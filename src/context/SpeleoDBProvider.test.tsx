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
  mockStartGuidedTour,
  mockDestroyGuidedTour,
  authStateSnapshotRef,
  projectsSnapshot,
  tilePrefetchJobsSnapshot,
  syncStatusRef,
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
    mockStartGuidedTour: vi.fn().mockResolvedValue(undefined),
    mockDestroyGuidedTour: vi.fn(),
    authStateSnapshotRef: {
      current: {
        isAuthenticated: true,
        user: { id: 'restored', email: 'user@example.com', name: 'user@example.com' },
        token: 'tok',
      } as {
        isAuthenticated: boolean;
        user: { id: string; email: string; name: string } | null;
        token: string | null;
      },
    },
    projectsSnapshot: [] as unknown[],
    tilePrefetchJobsSnapshot: [] as unknown[],
    syncStatusRef: { current: 'idle' as string },
  };
});

vi.mock('@ionic/react', () => ({
  IonModal: ({
    children,
    isOpen,
    onDidDismiss,
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
    onDidDismiss?: () => void;
  }) => {
    const wasOpen = React.useRef(Boolean(isOpen));

    React.useEffect(() => {
      if (wasOpen.current && !isOpen) {
        onDidDismiss?.();
      }
      wasOpen.current = Boolean(isOpen);
    }, [isOpen, onDidDismiss]);

    return isOpen ? <div data-testid="ion-modal">{children}</div> : null;
  },
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

vi.mock('../onboarding/guidedTour/engine', () => ({
  startGuidedTour: mockStartGuidedTour,
  destroyGuidedTour: mockDestroyGuidedTour,
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
      return authStateSnapshotRef.current;
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
      return syncStatusRef.current;
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
    authStateSnapshotRef.current = {
      isAuthenticated: true,
      user: { id: 'restored', email: 'user@example.com', name: 'user@example.com' },
      token: 'tok',
    };
    syncStatusRef.current = 'idle';
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

  it('skips immediate startup validation after fresh in-app login', async () => {
    const history = createMemoryHistory({ initialEntries: ['/login'] });
    authStateSnapshotRef.current = {
      isAuthenticated: false,
      user: null,
      token: null,
    };
    mockIsAuthenticated.mockReturnValue(false);
    mockGetPreferences.mockReturnValue({});

    render(
      <Router history={history}>
        <SpeleoDBProvider>
          <div>child</div>
        </SpeleoDBProvider>
      </Router>,
    );

    await waitFor(() => {
      expect(mockValidateSession).not.toHaveBeenCalled();
    });

    act(() => {
      authStateSnapshotRef.current = {
        isAuthenticated: true,
        user: { id: 'restored', email: 'user@example.com', name: 'user@example.com' },
        token: 'tok',
      };
      mockIsAuthenticated.mockReturnValue(true);
      mockGetPreferences.mockReturnValue({
        email: 'user@example.com',
        token: 'tok',
        instance: 'https://www.speleodb.org',
      });
      emitStoreUpdate();
      history.push('/dashboard');
    });

    await waitFor(() => {
      expect(history.location.pathname).toBe('/dashboard');
      expect(mockValidateSession).not.toHaveBeenCalled();
    });
  });

  it('starts guided tour after onboarding modal dismissal on first dashboard login', async () => {
    authStateSnapshotRef.current = {
      isAuthenticated: false,
      user: null,
      token: null,
    };
    render(
      <Router history={createMemoryHistory({ initialEntries: ['/dashboard'] })}>
        <SpeleoDBProvider>
          <div>child</div>
        </SpeleoDBProvider>
      </Router>,
    );

    act(() => {
      authStateSnapshotRef.current = {
        isAuthenticated: true,
        user: { id: 'restored', email: 'user@example.com', name: 'user@example.com' },
        token: 'tok',
      };
      emitStoreUpdate();
    });

    await waitFor(() => {
      expect(screen.getAllByText('Start exploring')).toHaveLength(2);
    });

    await userEvent.click(screen.getAllByText('Start exploring')[0]);

    act(() => {
      syncStatusRef.current = 'done';
      emitStoreUpdate();
    });

    await waitFor(() => {
      expect(mockStartGuidedTour).toHaveBeenCalledWith();
    });
  });

  it('destroys active guided tour on auth transition to logged out', async () => {
    render(
      <Router history={createMemoryHistory({ initialEntries: ['/dashboard'] })}>
        <SpeleoDBProvider>
          <div>child</div>
        </SpeleoDBProvider>
      </Router>,
    );

    act(() => {
      authStateSnapshotRef.current = {
        isAuthenticated: false,
        user: null,
        token: null,
      };
      emitStoreUpdate();
    });

    await waitFor(() => {
      expect(mockDestroyGuidedTour).toHaveBeenCalled();
    });
  });
});
