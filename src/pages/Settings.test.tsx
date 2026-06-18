import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Settings from './Settings';
import { formatLastSync } from '../utils/formatLastSync';

// ==================== Mocks ====================

const mockLogout = vi.fn();
const mockIsAuthenticated = vi.fn(() => true);
const mockSyncProjects = vi.fn().mockResolvedValue(undefined);
const mockRequestStorageConsentPrompt = vi.fn();
const mockRevokeTileCacheOverLimit = vi.fn();

const {
  mockTilePrefetchJobs,
  mockProjects,
  mockSyncStatus,
  mockLastSyncedAt,
  mockIsTileCacheOverLimit,
  mockIsTileCacheOverLimitApproved,
} = vi.hoisted(() => ({
  mockTilePrefetchJobs: { current: [] as unknown[] },
  mockProjects: { current: [] as unknown[] },
  mockSyncStatus: { current: 'idle' as 'idle' | 'syncing' | 'done' | 'error' },
  mockLastSyncedAt: { current: null as number | null },
  mockIsTileCacheOverLimit: { current: false },
  mockIsTileCacheOverLimitApproved: { current: false },
}));

vi.mock('../context/useSpeleoDB', () => ({
  useSpeleoDB: () => ({
    controller: {
      logout: mockLogout,
      isAuthenticated: mockIsAuthenticated,
      syncProjects: mockSyncProjects,
      requestStorageConsentPrompt: mockRequestStorageConsentPrompt,
      revokeTileCacheOverLimit: mockRevokeTileCacheOverLimit,
    },
    projects: mockProjects.current,
    syncStatus: mockSyncStatus.current,
    lastSyncedAt: mockLastSyncedAt.current,
    tilePrefetchJobs: mockTilePrefetchJobs.current,
    isTileCacheOverLimit: mockIsTileCacheOverLimit.current,
    isTileCacheOverLimitApproved: mockIsTileCacheOverLimitApproved.current,
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

const {
  mockPersistShowLandmarks,
  mockPersistColorMode,
  mockPersistMeasurementUnit,
} = vi.hoisted(() => ({
  mockPersistShowLandmarks: vi.fn(),
  mockPersistColorMode: vi.fn(),
  mockPersistMeasurementUnit: vi.fn(),
}));

vi.mock('../services/PreferencesService', () => ({
  setShowLandmarks: mockPersistShowLandmarks,
  setColorMode: mockPersistColorMode,
  setMeasurementUnit: mockPersistMeasurementUnit,
}));


vi.mock('../onboarding/guidedTour/runtime', () => ({
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

function renderSettings(
  initialShowLandmarks = true,
  initialPath = '/settings',
  initialColorMode: 'project' | 'depth' = 'project',
  initialMeasurementUnit: 'feet' | 'meters' = 'meters',
) {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const Harness: React.FC = () => {
    const [showLandmarks, setShowLandmarks] = React.useState(initialShowLandmarks);
    const [colorMode, setColorMode] = React.useState(initialColorMode);
    const [measurementUnit, setMeasurementUnit] = React.useState(initialMeasurementUnit);
    const [isProjectPanelOpen, setIsProjectPanelOpen] = React.useState(false);
    const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = React.useState(false);
    return (
      <Settings
        showLandmarks={showLandmarks}
        onShowLandmarksChange={setShowLandmarks}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        measurementUnit={measurementUnit}
        onMeasurementUnitChange={setMeasurementUnit}
        isProjectPanelOpen={isProjectPanelOpen}
        onProjectPanelChange={setIsProjectPanelOpen}
        isLandmarkPanelOpen={isLandmarkPanelOpen}
        onLandmarkPanelChange={setIsLandmarkPanelOpen}
      />
    );
  };
  const renderResult = render(
    <Router history={history}>
      <Harness />
    </Router>,
  );
  return {
    history,
    rerender: () => {
      renderResult.rerender(
        <Router history={history}>
          <Harness />
        </Router>,
      );
    },
  };
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
    mockSyncStatus.current = 'idle';
    mockLastSyncedAt.current = null;
    mockIsTileCacheOverLimit.current = false;
    mockIsTileCacheOverLimitApproved.current = false;
    mockRequestStorageConsentPrompt.mockReset();
    mockRevokeTileCacheOverLimit.mockReset();
    mockPersistShowLandmarks.mockReset();
    mockPersistColorMode.mockReset();
    mockPersistMeasurementUnit.mockReset();
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

  it('includes the combined landmarks prefetch job in sync metrics', () => {
    mockTilePrefetchJobs.current = [
      {
        projectId: 'p1', commitId: 'c1', status: 'downloading',
        zoomMin: 0, zoomMax: 18, padMeters: 50,
        totalTiles: 2000, completedTiles: 1400, failedTiles: 100,
        bytesDownloaded: 500_000, estimatedBytes: 1_000_000, updatedAt: Date.now(),
      },
      {
        projectId: 'landmarks', commitId: 'sig-1', status: 'downloading',
        zoomMin: 0, zoomMax: 18, padMeters: 50,
        totalTiles: 1000, completedTiles: 800, failedTiles: 0,
        bytesDownloaded: 250_000, estimatedBytes: 500_000, updatedAt: Date.now(),
      },
    ];
    renderSettings();

    // Project processed 1500 + landmark processed 800 = 2300 of 3000 total.
    expect(screen.getByTestId('sync-tiles')).toHaveTextContent('2,300 / 3,000');
    expect(screen.getByTestId('sync-pct')).toHaveTextContent('76%');
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

    const { rerender } = renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId('sync-tiles')).toHaveTextContent('1,600 / 2,100');
    });

    mockTilePrefetchJobs.current = [
      {
        projectId: 'p1', commitId: 'c1', status: 'downloading',
        zoomMin: 10, zoomMax: 14, padMeters: 500,
        totalTiles: 2000, completedTiles: 1500, failedTiles: 100,
        bytesDownloaded: 500_000, estimatedBytes: 1_000_000, updatedAt: Date.now(),
      },
    ];
    rerender();

    await waitFor(() => {
      expect(screen.getByTestId('sync-tiles')).toHaveTextContent('1,700 / 2,100');
    });
  });

  it('refreshes synchronization rows immediately on route entry to /settings', async () => {
    mockGetManualTileCount.mockResolvedValue(42);
    mockGetTotalCacheBytes.mockResolvedValue(1024);

    const { history } = renderSettings(true, '/dashboard');

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
    expect(mockPersistShowLandmarks).toHaveBeenCalledWith(false);
  });

  it('renders color mode selector with project default state', () => {
    renderSettings(true, '/settings', 'project');
    const selector = screen.getByTestId('color-mode-selector') as HTMLSelectElement;
    expect(selector.value).toBe('project');
    expect(screen.getByRole('option', { name: 'By Project' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'By Depth' })).toBeInTheDocument();
  });

  it('updates color mode selector state when changed', async () => {
    const user = userEvent.setup();
    renderSettings(true, '/settings', 'project');
    const selector = screen.getByTestId('color-mode-selector') as HTMLSelectElement;
    expect(selector.value).toBe('project');

    await user.selectOptions(selector, 'depth');
    expect(selector.value).toBe('depth');
    expect(mockPersistColorMode).toHaveBeenCalledWith('depth');
  });

  it('persists project mode when selected from depth', async () => {
    const user = userEvent.setup();
    renderSettings(true, '/settings', 'depth');
    const selector = screen.getByTestId('color-mode-selector') as HTMLSelectElement;
    expect(selector.value).toBe('depth');

    await user.selectOptions(selector, 'project');
    expect(selector.value).toBe('project');
    expect(mockPersistColorMode).toHaveBeenCalledWith('project');
  });

  it('renders measurement unit selector with meters as default', () => {
    renderSettings(true, '/settings', 'project', 'meters');
    const selector = screen.getByTestId('measurement-unit-selector') as HTMLSelectElement;
    expect(selector.value).toBe('meters');
    expect(screen.getByRole('option', { name: 'Meters' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Feet' })).toBeInTheDocument();
  });

  it('updates measurement unit selector state when changed', async () => {
    const user = userEvent.setup();
    renderSettings(true, '/settings', 'project', 'meters');
    const selector = screen.getByTestId('measurement-unit-selector') as HTMLSelectElement;
    expect(selector.value).toBe('meters');

    await user.selectOptions(selector, 'feet');
    expect(selector.value).toBe('feet');
    expect(mockPersistMeasurementUnit).toHaveBeenCalledWith('feet');
  });

  it('persists meters when selected from feet', async () => {
    const user = userEvent.setup();
    renderSettings(true, '/settings', 'project', 'meters');
    const selector = screen.getByTestId('measurement-unit-selector') as HTMLSelectElement;
    expect(selector.value).toBe('meters');

    await user.selectOptions(selector, 'feet');
    await user.selectOptions(selector, 'meters');
    expect(selector.value).toBe('meters');
    expect(mockPersistMeasurementUnit).toHaveBeenCalledWith('meters');
  });

  it('renders "Show Tutorial" button', () => {
    renderSettings();
    expect(screen.getByTestId('show-tutorial-button')).toBeInTheDocument();
    expect(screen.getByText('Show Tutorial')).toBeInTheDocument();
  });

  it('clicking "Show Tutorial" navigates to /dashboard', async () => {
    const user = userEvent.setup();
    const { history } = renderSettings();

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
    const { history } = renderSettings();

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

  describe('Last sync row', () => {
    it('renders "Never" when lastSyncedAt is null', () => {
      mockLastSyncedAt.current = null;
      renderSettings();
      expect(screen.getByTestId('last-sync')).toHaveTextContent('Never');
    });

    it('updates when lastSyncedAt changes after the page is already rendered', () => {
      const epoch = Date.UTC(2026, 3, 18, 14, 30);
      mockLastSyncedAt.current = null;
      const { rerender } = renderSettings();
      expect(screen.getByTestId('last-sync')).toHaveTextContent('Never');

      mockLastSyncedAt.current = epoch;
      rerender();

      expect(screen.getByTestId('last-sync')).toHaveTextContent(formatLastSync(epoch));
    });

    it('renders the row above "Synced projects" so it is visible at the top of the section', () => {
      mockLastSyncedAt.current = Date.UTC(2026, 3, 18, 14, 30);
      renderSettings();
      const lastSync = screen.getByTestId('last-sync');
      const syncedProjects = screen.getByTestId('synced-projects');
      // Both must exist and last-sync must come earlier in the document order.
      const positionMask = lastSync.compareDocumentPosition(syncedProjects);
      expect(positionMask & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('Syncing indicator', () => {
    it('shows the "Syncing\u2026" label inside the sync button when syncStatus is "syncing"', () => {
      mockSyncStatus.current = 'syncing';
      renderSettings();
      expect(screen.getByTestId('sync-status-label')).toHaveTextContent('Syncing\u2026');
    });

    it('does not show the "Syncing\u2026" label when sync is idle', () => {
      mockSyncStatus.current = 'idle';
      renderSettings();
      expect(screen.queryByTestId('sync-status-label')).not.toBeInTheDocument();
    });

    it('disables the sync button while syncing', () => {
      mockSyncStatus.current = 'syncing';
      renderSettings();
      expect(screen.getByTestId('sync-button')).toBeDisabled();
    });
  });

  describe('Storage over-limit warning', () => {
    it('is hidden by default', () => {
      renderSettings();
      expect(screen.queryByTestId('storage-over-limit-warning')).not.toBeInTheDocument();
      expect(screen.queryByTestId('storage-approved-status')).not.toBeInTheDocument();
    });

    it('shows a tappable warning when over the cache limit and re-opens the prompt', async () => {
      mockIsTileCacheOverLimit.current = true;
      const user = userEvent.setup();
      renderSettings();

      const warning = screen.getByTestId('storage-over-limit-warning');
      expect(warning).toBeInTheDocument();

      await user.click(warning);
      expect(mockRequestStorageConsentPrompt).toHaveBeenCalledOnce();
    });

    it('shows the approved status with a Revoke action when overflow is approved', async () => {
      mockIsTileCacheOverLimitApproved.current = true;
      const user = userEvent.setup();
      renderSettings();

      expect(screen.getByTestId('storage-approved-status')).toBeInTheDocument();
      // The warning is not shown at the same time as the approved status.
      expect(screen.queryByTestId('storage-over-limit-warning')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('storage-revoke'));
      expect(mockRevokeTileCacheOverLimit).toHaveBeenCalledOnce();
    });
  });
});
