import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Settings from './Settings';

// ==================== Mocks ====================

const mockLogout = vi.fn();
const mockIsAuthenticated = vi.fn(() => true);
const mockSyncProjects = vi.fn().mockResolvedValue(undefined);

const { mockTilePrefetchJobs, mockProjects } = vi.hoisted(() => ({
  mockTilePrefetchJobs: { current: [] as unknown[] },
  mockProjects: { current: [] as unknown[] },
}));

vi.mock('../context/SpeleoDBProvider', () => ({
  useSpeleoDB: () => ({
    controller: {
      logout: mockLogout,
      isAuthenticated: mockIsAuthenticated,
      syncProjects: mockSyncProjects,
    },
    projects: mockProjects.current,
    syncStatus: 'idle',
    tilePrefetchJobs: mockTilePrefetchJobs.current,
  }),
}));

const mockGetManualTileCount = vi.fn();
const mockGetTotalCacheBytes = vi.fn();
vi.mock('../services/tileCache/TileCacheRepository', () => ({
  getManualTileCount: () => mockGetManualTileCount(),
  getTotalCacheBytes: () => mockGetTotalCacheBytes(),
}));

vi.mock('../components/AppTabBar', () => ({
  default: () => <div data-testid="app-tab-bar" />,
}));


vi.mock('../onboarding/guidedTour/engine', () => ({
  restartGuidedTourFromHelp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: { Light: 'LIGHT' },
}));

vi.mock('@ionic/react', () => ({
  IonPage: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-page">{children}</div>
  ),
  IonContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-content">{children}</div>
  ),
  IonHeader: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-header">{children}</div>
  ),
  IonToolbar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-toolbar">{children}</div>
  ),
  IonTitle: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IonList: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-list">{children}</div>
  ),
  IonListHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IonItem: ({ children, onClick, ...rest }: { children?: React.ReactNode; onClick?: () => void; button?: boolean } & Record<string, unknown>) => (
    <div data-testid={rest['data-testid'] as string ?? 'ion-item'} onClick={onClick}>{children}</div>
  ),
  IonLabel: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IonNote: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <span data-testid={rest['data-testid'] as string}>{children}</span>
  ),
  IonToggle: ({ checked, onIonChange, children, ...rest }: {
    checked?: boolean;
    onIonChange?: (e: { detail: { checked: boolean } }) => void;
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <label>
      <input
        data-testid={rest['data-testid'] as string ?? 'ion-toggle'}
        type="checkbox"
        checked={checked}
        onChange={(e) => onIonChange?.({ detail: { checked: e.target.checked } })}
      />
      {children}
    </label>
  ),
  IonModal: ({
    children,
    isOpen,
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
  }) => (isOpen ? <div data-testid="ion-modal">{children}</div> : null),
  IonFooter: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-footer">{children}</div>
  ),
  IonIcon: () => <span data-testid="ion-icon" />,
}));

// ==================== Helpers ====================

function renderSettings(initialShowLandmarks = true, initialPath = '/settings') {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const Harness: React.FC = () => {
    const [showLandmarks, setShowLandmarks] = React.useState(initialShowLandmarks);
    const [isProjectPanelOpen, setIsProjectPanelOpen] = React.useState(false);
    return (
      <Settings
        showLandmarks={showLandmarks}
        onShowLandmarksChange={setShowLandmarks}
        isProjectPanelOpen={isProjectPanelOpen}
        onProjectPanelChange={setIsProjectPanelOpen}
      />
    );
  };
  render(
    <Router history={history}>
      <Harness />
    </Router>,
  );
  return history;
}

// ==================== Tests ====================

describe('Settings page', () => {
  beforeEach(() => {
    mockLogout.mockReset().mockResolvedValue(undefined);
    mockIsAuthenticated.mockReturnValue(true);
    mockSyncProjects.mockReset().mockResolvedValue(undefined);
    mockGetManualTileCount.mockReset().mockResolvedValue(0);
    mockGetTotalCacheBytes.mockReset().mockResolvedValue(0);
    mockTilePrefetchJobs.current = [];
    mockProjects.current = [];
  });

  it('renders settings header', () => {
    renderSettings();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows synced projects count (only those with geojson)', () => {
    mockProjects.current = [
      { id: 'p1', geojson_file: 'a.geojson', exclude_geojson: false },
      { id: 'p2', geojson_file: 'b.geojson', exclude_geojson: false },
      { id: 'p3', geojson_file: null, exclude_geojson: false },
    ];
    renderSettings();
    expect(screen.getByTestId('synced-projects')).toHaveTextContent('2');
  });

  it('shows "0" synced projects when empty', () => {
    renderSettings();
    expect(screen.getByTestId('synced-projects')).toHaveTextContent('0');
  });

  it('renders correct MB used from tile cache', async () => {
    mockGetTotalCacheBytes.mockResolvedValue(13_000_000);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId('cache-size')).toHaveTextContent('12.4 MB');
    });
  });

  it('renders sync percentage and tiles from prefetch jobs', () => {
    mockTilePrefetchJobs.current = [
      {
        projectId: 'p1', commitId: 'c1', status: 'downloading',
        zoomMin: 10, zoomMax: 14, padMeters: 500,
        totalTiles: 2000, completedTiles: 1400, failedTiles: 100,
        bytesDownloaded: 500_000, estimatedBytes: 1_000_000, updatedAt: Date.now(),
      },
    ];
    renderSettings();

    expect(screen.getByTestId('sync-pct')).toHaveTextContent('75%');
    expect(screen.getByTestId('sync-tiles')).toHaveTextContent('1,500 / 2,000');
  });

  it('includes manually downloaded tiles in synchronization metrics', async () => {
    mockGetManualTileCount.mockResolvedValue(100);
    mockTilePrefetchJobs.current = [
      {
        projectId: 'p1', commitId: 'c1', status: 'downloading',
        zoomMin: 10, zoomMax: 14, padMeters: 500,
        totalTiles: 2000, completedTiles: 1400, failedTiles: 100,
        bytesDownloaded: 500_000, estimatedBytes: 1_000_000, updatedAt: Date.now(),
      },
    ];

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId('sync-tiles')).toHaveTextContent('1,600 / 2,100');
    });
    expect(screen.getByTestId('sync-pct')).toHaveTextContent('76%');
  });

  it('keeps sync total stable while prefetch progresses on settings page', async () => {
    const user = userEvent.setup();
    mockGetTotalCacheBytes
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    mockGetManualTileCount
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(100);
    mockTilePrefetchJobs.current = [
      {
        projectId: 'p1', commitId: 'c1', status: 'downloading',
        zoomMin: 10, zoomMax: 14, padMeters: 500,
        totalTiles: 2000, completedTiles: 1400, failedTiles: 100,
        bytesDownloaded: 500_000, estimatedBytes: 1_000_000, updatedAt: Date.now(),
      },
    ];

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId('sync-tiles')).toHaveTextContent('1,600 / 2,100');
    });

    const [job] = mockTilePrefetchJobs.current as Array<{ completedTiles: number }>;
    job.completedTiles = 1500;

    await user.click(screen.getByTestId('sync-button'));

    await waitFor(() => {
      expect(screen.getByTestId('sync-tiles')).toHaveTextContent('1,700 / 2,100');
    });
  });

  it('refreshes synchronization rows immediately on route entry to /settings', async () => {
    mockGetManualTileCount.mockResolvedValue(42);
    mockGetTotalCacheBytes.mockResolvedValue(1024);

    const history = renderSettings(true, '/dashboard');

    expect(mockGetManualTileCount).not.toHaveBeenCalled();
    expect(mockGetTotalCacheBytes).not.toHaveBeenCalled();

    act(() => {
      history.push('/settings');
    });

    await waitFor(() => {
      expect(mockGetManualTileCount).toHaveBeenCalledTimes(1);
      expect(mockGetTotalCacheBytes).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('sync-tiles')).toHaveTextContent('42 / 42');
    expect(screen.getByTestId('sync-pct')).toHaveTextContent('100%');
  });

  it('shows 0% sync progress when no jobs and no cache', () => {
    mockTilePrefetchJobs.current = [];
    renderSettings();
    expect(screen.getByTestId('sync-pct')).toHaveTextContent('0%');
    expect(screen.getByTestId('sync-tiles')).toHaveTextContent('0 / 0');
  });

  it('renders "Map Settings" section header', () => {
    renderSettings();
    expect(screen.getByText('Map Settings')).toBeInTheDocument();
  });

  it('renders landmark toggle with correct initial state', () => {
    renderSettings();
    const toggle = screen.getByTestId('landmark-toggle');
    expect(toggle).toBeInTheDocument();
  });

  it('updates landmark toggle state when changed', async () => {
    const user = userEvent.setup();
    renderSettings(true);
    const toggle = screen.getByTestId('landmark-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await user.click(toggle);
    expect(toggle.checked).toBe(false);
  });

  it('renders "Show Tutorial" button', () => {
    renderSettings();
    expect(screen.getByTestId('show-tutorial-button')).toBeInTheDocument();
    expect(screen.getByText('Show Tutorial')).toBeInTheDocument();
  });

  it('clicking "Show Tutorial" navigates to /dashboard', async () => {
    const user = userEvent.setup();
    const history = renderSettings();

    await user.click(screen.getByTestId('show-tutorial-button'));
    expect(history.location.pathname).toBe('/dashboard');
  });

  it('renders sign out button', () => {
    renderSettings();
    expect(screen.getByTestId('sign-out-button')).toBeInTheDocument();
  });

  it('clicking sign out opens confirmation modal', async () => {
    const user = userEvent.setup();
    renderSettings();

    const signOutItem = screen.getByTestId('sign-out-button');
    await user.click(signOutItem);

    expect(screen.getByText(/clear local data and sign out/i)).toBeInTheDocument();
  });

  it('confirming logout calls controller.logout', async () => {
    const user = userEvent.setup();
    const history = renderSettings();

    const signOutItem = screen.getByTestId('sign-out-button');
    await user.click(signOutItem);

    const confirmButton = screen.getByText(/wipe local data/i);
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
    expect(history.location.pathname).toBe('/login');
  });

  it('keeps modal open when logout rejects', async () => {
    mockLogout.mockRejectedValueOnce(new Error('network failure'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByTestId('sign-out-button'));
    const confirmButton = screen.getByText(/wipe local data/i);
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(screen.getByText(/clear local data and sign out/i)).toBeInTheDocument();
    });
  });

  it('still refreshes cache stats when syncProjects rejects', async () => {
    mockSyncProjects.mockRejectedValueOnce(new Error('sync failed'));
    mockGetTotalCacheBytes.mockResolvedValue(5000);
    mockGetManualTileCount.mockResolvedValue(10);
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByTestId('sync-button'));

    await waitFor(() => {
      expect(mockSyncProjects).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(mockGetTotalCacheBytes).toHaveBeenCalled();
      expect(mockGetManualTileCount).toHaveBeenCalled();
    });
  });
});
