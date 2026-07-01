import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import { SpeleoDBProvider } from './SpeleoDBProvider';
import { useOfflineMapSync, useSpeleoDB } from './useSpeleoDB';
import type { OfflineMapSyncSnapshot } from '../types/offlineMapSync';

const {
  mockValidateSession,
  mockLogout,
  mockStoreSubscribers,
  mockOfflineMapSubscribers,
  emitStoreUpdate,
  emitOfflineMapUpdate,
  mockIsOfflineLockedRef,
  mockIsAuthenticated,
  mockGetPreferences,
  mockSetPreferences,
  mockClearPreferences,
  mockPreloadTilePrefetch,
  mockStartGuidedTour,
  mockDestroyGuidedTour,
  mockSplashHide,
  authStateSnapshotRef,
  projectsSnapshot,
  offlineMapSyncSnapshotRef,
  syncStatusRef,
  mapDataRevisionRef,
} = vi.hoisted(() => {
  const storeSubscribers = new Set<() => void>();
  const offlineMapSubscribers = new Set<() => void>();
  return {
    mockValidateSession: vi.fn(),
    mockLogout: vi.fn(),
    mockStoreSubscribers: storeSubscribers,
    mockOfflineMapSubscribers: offlineMapSubscribers,
    emitStoreUpdate: () => {
      for (const listener of storeSubscribers) {
        listener();
      }
    },
    emitOfflineMapUpdate: () => {
      for (const listener of offlineMapSubscribers) {
        listener();
      }
    },
    mockIsOfflineLockedRef: { current: false },
    mockIsAuthenticated: vi.fn(),
    mockGetPreferences: vi.fn(),
    mockSetPreferences: vi.fn(),
    mockClearPreferences: vi.fn(),
    mockPreloadTilePrefetch: vi.fn().mockResolvedValue(undefined),
    mockStartGuidedTour: vi.fn().mockResolvedValue(undefined),
    mockDestroyGuidedTour: vi.fn(),
    mockSplashHide: vi.fn().mockResolvedValue(undefined),
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
    offlineMapSyncSnapshotRef: { current: {
      sessionId: null,
      phase: 'idle',
      coordinateCount: null,
      enabledLayerCount: 0,
      totalTiles: 0,
      completedTiles: 0,
      failedTiles: 0,
      cachedFreshTiles: 0,
      auditedTiles: 0,
      queuedTiles: 0,
      downloadedTiles: 0,
      activeDownloads: 0,
      bytesDownloaded: 0,
      tilesPerSecond: 0,
      etaSeconds: null,
      cacheBytes: 0,
      blockedByStorage: false,
      coverageTotalTiles: 0,
      coverageCompletedTiles: 0,
      layers: [],
    } as OfflineMapSyncSnapshot },
    syncStatusRef: { current: 'idle' as string },
    mapDataRevisionRef: { current: 0 },
  };
});

vi.mock('@ionic/react', () => ({
  setupIonicReact: () => {},
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

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: {
    hide: mockSplashHide,
  },
}));

vi.mock('../onboarding/guidedTour/runtime', () => ({
  startGuidedTour: mockStartGuidedTour,
  destroyGuidedTour: mockDestroyGuidedTour,
}));

vi.mock('../services/PreferencesService', () => ({
  getPreferences: mockGetPreferences,
  setPreferences: mockSetPreferences,
  clearPreferences: mockClearPreferences,
}));

vi.mock('../services/AppSessionStore', () => ({
  appSessionStore: {
    initialize: vi.fn(async () => null),
    getSession: vi.fn(() => null),
    establish: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  },
}));

vi.mock('../controllers/SpeleoDBController', () => {
  class SpeleoDBController {
    validateSession = mockValidateSession;
    logout = mockLogout;
    preloadOfflineMaps = mockPreloadTilePrefetch;

    subscribe(listener: () => void): () => void {
      mockStoreSubscribers.add(listener);
      return () => {
        mockStoreSubscribers.delete(listener);
      };
    }

    subscribeOfflineMapSync(listener: () => void): () => void {
      mockOfflineMapSubscribers.add(listener);
      return () => {
        mockOfflineMapSubscribers.delete(listener);
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

    get projects() {
      return projectsSnapshot;
    }

    get syncStatus() {
      return syncStatusRef.current;
    }

    get lastSyncedAt() {
      return null;
    }

    get mapDataRevision() {
      return mapDataRevisionRef.current;
    }

    get offlineMapSyncSnapshot() {
      return offlineMapSyncSnapshotRef.current;
    }
  }

  return { SpeleoDBController };
});

describe('SpeleoDBProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreSubscribers.clear();
    mockOfflineMapSubscribers.clear();

    mockGetPreferences.mockReturnValue({
      email: 'user@example.com',
      hasStoredSession: true,
      instance: 'https://www.speleodb.org',
    });
    mockValidateSession.mockResolvedValue('ok');
    mockLogout.mockResolvedValue(undefined);
    mockIsAuthenticated.mockReturnValue(true);
    mockIsOfflineLockedRef.current = false;
    mockSplashHide.mockClear();
    mockSplashHide.mockResolvedValue(undefined);
    authStateSnapshotRef.current = {
      isAuthenticated: true,
      user: { id: 'restored', email: 'user@example.com', name: 'user@example.com' },
      token: 'tok',
    };
    syncStatusRef.current = 'idle';
    mapDataRevisionRef.current = 0;
    offlineMapSyncSnapshotRef.current = {
      ...offlineMapSyncSnapshotRef.current,
      sessionId: null,
      phase: 'idle',
      coordinateCount: null,
      totalTiles: 0,
      completedTiles: 0,
      layers: [],
    };
  });

  it('publishes tile progress directly without rerendering unrelated context consumers', async () => {
    const unrelatedRender = vi.fn();

    function ProgressProbe() {
      const progress = useOfflineMapSync();
      return <div data-testid="tile-progress">{progress.completedTiles}</div>;
    }

    function UnrelatedProbe() {
      const { projects } = useSpeleoDB();
      unrelatedRender();
      return <div data-testid="project-count">{projects.length}</div>;
    }

    render(
      <Router history={createMemoryHistory({ initialEntries: ['/dashboard'] })}>
        <SpeleoDBProvider>
          <ProgressProbe />
          <UnrelatedProbe />
        </SpeleoDBProvider>
      </Router>,
    );
    expect(screen.getByTestId('tile-progress')).toHaveTextContent('0');
    const unrelatedRendersBeforeProgress = unrelatedRender.mock.calls.length;

    act(() => {
      offlineMapSyncSnapshotRef.current = {
        ...offlineMapSyncSnapshotRef.current,
        sessionId: 'session-1',
        phase: 'downloading',
        coordinateCount: 10,
        totalTiles: 10,
        completedTiles: 1,
      };
      emitOfflineMapUpdate();
    });

    await waitFor(() => {
      expect(screen.getByTestId('tile-progress')).toHaveTextContent('1');
    });
    expect(unrelatedRender).toHaveBeenCalledTimes(unrelatedRendersBeforeProgress);
  });

  it('publishes map-data revisions without changing the stable projects snapshot', async () => {
    function RevisionProbe() {
      const { mapDataRevision, projects } = useSpeleoDB();
      const firstProjects = React.useRef(projects);
      return (
        <div
          data-testid="map-data-revision"
          data-projects-stable={String(firstProjects.current === projects)}
        >
          {mapDataRevision}
        </div>
      );
    }

    render(
      <Router history={createMemoryHistory({ initialEntries: ['/dashboard'] })}>
        <SpeleoDBProvider>
          <RevisionProbe />
        </SpeleoDBProvider>
      </Router>,
    );
    expect(screen.getByTestId('map-data-revision')).toHaveTextContent('0');

    act(() => {
      mapDataRevisionRef.current = 1;
      emitStoreUpdate();
    });

    await waitFor(() => {
      expect(screen.getByTestId('map-data-revision')).toHaveTextContent('1');
    });
    expect(screen.getByTestId('map-data-revision')).toHaveAttribute(
      'data-projects-stable',
      'true',
    );
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
        hasStoredSession: true,
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

  describe('Connecting banner during startup validation', () => {
    async function flushPendingWork() {
      await Promise.resolve();
      await Promise.resolve();
    }

    it('does not render the banner when validation resolves quickly (< 1s)', async () => {
      // Microtasks always beat any setTimeout callback, so a resolved
      // validation will cancel the 1s gate before it fires. Use shouldAdvanceTime
      // so waitFor can poll without freezing on the faked clock.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockValidateSession.mockResolvedValue('ok');
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
        await act(async () => {
          await flushPendingWork();
        });

        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();

        // Explicitly advance past the gate; the banner must remain hidden
        // because the .finally() cancelled the timer.
        await act(async () => {
          vi.advanceTimersByTime(2000);
        });
        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails closed and dismisses the splash when startup validation rejects', async () => {
      mockValidateSession.mockRejectedValue(new Error('unexpected validation failure'));
      const history = createMemoryHistory({ initialEntries: ['/dashboard'] });

      render(
        <Router history={history}>
          <SpeleoDBProvider>
            <div>child</div>
          </SpeleoDBProvider>
        </Router>,
      );

      await waitFor(() => {
        expect(history.location.pathname).toBe('/login');
      });
      expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
      expect(mockSplashHide).toHaveBeenCalledOnce();
    });

    it('hides the splash exactly once when validation resolves quickly (.finally path)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockValidateSession.mockResolvedValue('ok');
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
        await act(async () => {
          await flushPendingWork();
        });

        // Validation resolved before the 1s gate, so the splash hides only
        // through the .finally() path -- not through the banner-show path.
        expect(mockSplashHide).toHaveBeenCalledTimes(1);

        // Advance past the gate; the cancelled timer must not call hide again.
        await act(async () => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockSplashHide).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('renders the banner when validation is still pending after 1s, then hides it on resolution', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let resolveValidation: ((r: 'ok' | 'unauthorized' | 'network_error') => void) | null = null;
        mockValidateSession.mockImplementation(
          () => new Promise<'ok' | 'unauthorized' | 'network_error'>((resolve) => {
            resolveValidation = resolve;
          }),
        );

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
        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();

        // Advance past the 1s gate without resolving validation.
        await act(async () => {
          vi.advanceTimersByTime(1100);
        });

        expect(screen.getByTestId('connecting-banner')).toBeInTheDocument();
        expect(screen.getByText('Connecting to SpeleoDB…')).toBeInTheDocument();

        // Resolve validation; the banner should disappear.
        await act(async () => {
          resolveValidation!('ok');
          await flushPendingWork();
        });

        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('hides the native splash as soon as the connecting banner appears (slow validation)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let resolveValidation: ((r: 'ok' | 'unauthorized' | 'network_error') => void) | null = null;
        mockValidateSession.mockImplementation(
          () => new Promise<'ok' | 'unauthorized' | 'network_error'>((resolve) => {
            resolveValidation = resolve;
          }),
        );

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
        // Splash must NOT have been hidden yet -- validation is still pending
        // and the 1s gate has not elapsed.
        expect(mockSplashHide).not.toHaveBeenCalled();

        // Fire the 1s gate without resolving validation. The banner appears
        // AND the splash must hide so the banner is actually visible to the
        // user (the native splash is opaque on iOS/Android).
        await act(async () => {
          vi.advanceTimersByTime(1100);
        });

        expect(screen.getByTestId('connecting-banner')).toBeInTheDocument();
        expect(mockSplashHide).toHaveBeenCalledTimes(1);

        // When validation finally resolves, the .finally() also calls hide
        // (idempotent on native, the .catch swallows any "already hidden").
        await act(async () => {
          resolveValidation!('ok');
          await flushPendingWork();
        });
        expect(mockSplashHide).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('hands off from connecting banner to offline modal without showing both at once', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let resolveValidation: ((r: 'ok' | 'unauthorized' | 'network_error') => void) | null = null;
        mockValidateSession.mockImplementation(
          () => new Promise<'ok' | 'unauthorized' | 'network_error'>((resolve) => {
            resolveValidation = resolve;
          }),
        );

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

        await act(async () => {
          vi.advanceTimersByTime(1100);
        });

        expect(screen.getByTestId('connecting-banner')).toBeInTheDocument();
        expect(screen.queryByText('Offline mode')).not.toBeInTheDocument();

        await act(async () => {
          mockIsOfflineLockedRef.current = true;
          emitStoreUpdate();
          resolveValidation!('network_error');
          await flushPendingWork();
        });

        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
        expect(screen.getByText('Offline mode')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('cleans up the delayed banner timer on unmount', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let resolveValidation: ((r: 'ok' | 'unauthorized' | 'network_error') => void) | null = null;
        mockValidateSession.mockImplementation(
          () => new Promise<'ok' | 'unauthorized' | 'network_error'>((resolve) => {
            resolveValidation = resolve;
          }),
        );

        const { unmount } = render(
          <Router history={createMemoryHistory({ initialEntries: ['/dashboard'] })}>
            <SpeleoDBProvider>
              <div>child</div>
            </SpeleoDBProvider>
          </Router>,
        );

        await waitFor(() => {
          expect(mockValidateSession).toHaveBeenCalledOnce();
        });

        unmount();

        await act(async () => {
          vi.advanceTimersByTime(2000);
        });

        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
        expect(mockSplashHide).not.toHaveBeenCalled();

        await act(async () => {
          resolveValidation!('ok');
          await flushPendingWork();
        });

        expect(mockSplashHide).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not resurrect the banner or offline modal after logout during pending startup validation', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let resolveValidation: ((r: 'ok' | 'unauthorized' | 'network_error') => void) | null = null;
        mockValidateSession.mockImplementation(
          () => new Promise<'ok' | 'unauthorized' | 'network_error'>((resolve) => {
            resolveValidation = resolve;
          }),
        );

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

        await act(async () => {
          authStateSnapshotRef.current = {
            isAuthenticated: false,
            user: null,
            token: null,
          };
          mockIsAuthenticated.mockReturnValue(false);
          mockIsOfflineLockedRef.current = true;
          emitStoreUpdate();
        });

        await act(async () => {
          vi.advanceTimersByTime(2000);
        });

        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
        expect(screen.queryByText('Offline mode')).not.toBeInTheDocument();

        await act(async () => {
          resolveValidation!('network_error');
          await flushPendingWork();
        });

        expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
        expect(screen.queryByText('Offline mode')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('validates startup when non-secret metadata marks a stored session', async () => {
      mockGetPreferences.mockReturnValue({
        hasStoredSession: true,
        instance: 'https://www.speleodb.org',
      });
      authStateSnapshotRef.current = {
        isAuthenticated: true,
        user: { id: 'restored', email: '', name: '' },
        token: 'tok',
      };

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
    });

    it('does not render the banner when there are no stored credentials', async () => {
      mockGetPreferences.mockReturnValue({});
      render(
        <Router history={createMemoryHistory({ initialEntries: ['/dashboard'] })}>
          <SpeleoDBProvider>
            <div>child</div>
          </SpeleoDBProvider>
        </Router>,
      );

      await Promise.resolve();
      expect(mockValidateSession).not.toHaveBeenCalled();
      expect(screen.queryByTestId('connecting-banner')).not.toBeInTheDocument();
    });
  });
});
