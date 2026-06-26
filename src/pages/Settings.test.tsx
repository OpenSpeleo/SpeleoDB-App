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
const mockAttemptReconnect = vi.fn();
const mockRequestStorageConsentPrompt = vi.fn();
const mockRevokeTileCacheOverLimit = vi.fn();
const mockSetLayerOfflineSync = vi.fn().mockResolvedValue(undefined);

const {
  mockTilePrefetchJobs,
  mockProjects,
  mockSyncStatus,
  mockLastSyncedAt,
  mockIsTileCacheOverLimit,
  mockIsTileCacheOverLimitApproved,
  mockIsOfflineLocked,
} = vi.hoisted(() => ({
  mockTilePrefetchJobs: { current: [] as unknown[] },
  mockProjects: { current: [] as unknown[] },
  mockSyncStatus: { current: 'idle' as 'idle' | 'syncing' | 'done' | 'error' },
  mockLastSyncedAt: { current: null as number | null },
  mockIsTileCacheOverLimit: { current: false },
  mockIsTileCacheOverLimitApproved: { current: false },
  mockIsOfflineLocked: { current: false },
}));

vi.mock('../context/useSpeleoDB', () => ({
  useSpeleoDB: () => ({
    controller: {
      logout: mockLogout,
      isAuthenticated: mockIsAuthenticated,
      syncProjects: mockSyncProjects,
      attemptReconnect: mockAttemptReconnect,
      requestStorageConsentPrompt: mockRequestStorageConsentPrompt,
      revokeTileCacheOverLimit: mockRevokeTileCacheOverLimit,
      setLayerOfflineSync: mockSetLayerOfflineSync,
    },
    projects: mockProjects.current,
    syncStatus: mockSyncStatus.current,
    lastSyncedAt: mockLastSyncedAt.current,
    tilePrefetchJobs: mockTilePrefetchJobs.current,
    isTileCacheOverLimit: mockIsTileCacheOverLimit.current,
    isTileCacheOverLimitApproved: mockIsTileCacheOverLimitApproved.current,
    isOfflineLocked: mockIsOfflineLocked.current,
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
  IonItem: ({ children, onClick, disabled, ...rest }: { children?: React.ReactNode; onClick?: () => void; button?: boolean; disabled?: boolean } & Record<string, unknown>) => (
    // Mirror Ionic: a disabled item is non-interactive (no onClick) so tests
    // exercise the rendered disabled gate, not just the handler's JS guard.
    <div
      data-testid={(rest['data-testid'] as string) ?? 'ion-item'}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={disabled ? undefined : onClick}
    >{children}</div>
  ),
  IonLabel: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IonNote: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <span data-testid={rest['data-testid'] as string}>{children}</span>
  ),
  IonToggle: ({ checked, onIonChange, children, disabled, ...rest }: {
    checked?: boolean;
    onIonChange?: (e: { detail: { checked: boolean } }) => void;
    children?: React.ReactNode;
    disabled?: boolean;
  } & Record<string, unknown>) => (
    <label>
      <input
        data-testid={rest['data-testid'] as string ?? 'ion-toggle'}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onIonChange?.({ detail: { checked: e.target.checked } })}
      />
      {children}
    </label>
  ),
  IonModal: ({
    children,
    isOpen,
    ...rest
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
  } & Record<string, unknown>) =>
    isOpen ? <div data-testid={(rest['data-testid'] as string) ?? 'ion-modal'}>{children}</div> : null,
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
    const [isGpsPanelOpen, setIsGpsPanelOpen] = React.useState(false);
    const [layerOfflineSync, setLayerOfflineSync] = React.useState<Record<string, boolean>>({});
    return (
      <Settings
        showLandmarks={showLandmarks}
        onShowLandmarksChange={setShowLandmarks}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        measurementUnit={measurementUnit}
        onMeasurementUnitChange={setMeasurementUnit}
        layerOfflineSync={layerOfflineSync}
        onLayerOfflineSyncChange={setLayerOfflineSync}
        isProjectPanelOpen={isProjectPanelOpen}
        onProjectPanelChange={setIsProjectPanelOpen}
        isLandmarkPanelOpen={isLandmarkPanelOpen}
        onLandmarkPanelChange={setIsLandmarkPanelOpen}
        isGpsPanelOpen={isGpsPanelOpen}
        onGpsPanelChange={setIsGpsPanelOpen}
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
    mockAttemptReconnect.mockReset().mockResolvedValue('ok');
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
    mockSetLayerOfflineSync.mockReset().mockResolvedValue(undefined);
    mockIsOfflineLocked.current = false;
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

  describe('Resync button', () => {
    it('renders the "Resync" label when idle', () => {
      mockSyncStatus.current = 'idle';
      renderSettings();
      expect(screen.getByTestId('sync-button')).toHaveTextContent('Resync');
    });

    it('is disabled while offline-locked', () => {
      mockIsOfflineLocked.current = true;
      renderSettings();
      expect(screen.getByTestId('sync-button')).toBeDisabled();
    });

    it('does not call syncProjects when clicked while offline-locked', async () => {
      mockIsOfflineLocked.current = true;
      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('sync-button'));
      expect(mockSyncProjects).not.toHaveBeenCalled();
    });

    it('calls syncProjects when clicked while online', async () => {
      mockIsOfflineLocked.current = false;
      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('sync-button'));
      await waitFor(() => expect(mockSyncProjects).toHaveBeenCalledOnce());
    });
  });

  describe('Go Online button', () => {
    it('is hidden when online', () => {
      mockIsOfflineLocked.current = false;
      renderSettings();
      expect(screen.queryByTestId('go-online-button')).not.toBeInTheDocument();
    });

    it('is visible when offline-locked', () => {
      mockIsOfflineLocked.current = true;
      renderSettings();
      expect(screen.getByTestId('go-online-button')).toBeInTheDocument();
    });

    it('calls attemptReconnect and shows no failure modal on success', async () => {
      mockIsOfflineLocked.current = true;
      mockAttemptReconnect.mockResolvedValue('ok');
      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('go-online-button'));

      await waitFor(() => expect(mockAttemptReconnect).toHaveBeenCalledOnce());
      expect(screen.queryByTestId('reconnect-failed-dismiss')).not.toBeInTheDocument();
    });

    it('shows the "Couldn\u2019t reconnect" modal on network_error and keeps the button', async () => {
      mockIsOfflineLocked.current = true;
      mockAttemptReconnect.mockResolvedValue('network_error');
      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('go-online-button'));

      await waitFor(() => {
        expect(screen.getByTestId('reconnect-failed-dismiss')).toBeInTheDocument();
      });
      // The modal carries its own data-testid (forwarded by IonModal), distinct
      // from the logout modal, matching the production e2e selector.
      expect(screen.getByTestId('reconnect-failed-modal')).toBeInTheDocument();
      expect(screen.getByTestId('go-online-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('reconnect-failed-dismiss'));
      await waitFor(() => {
        expect(screen.queryByTestId('reconnect-failed-dismiss')).not.toBeInTheDocument();
      });
    });

    it('navigates to /login on unauthorized', async () => {
      mockIsOfflineLocked.current = true;
      mockAttemptReconnect.mockResolvedValue('unauthorized');
      const user = userEvent.setup();
      const { history } = renderSettings();

      await user.click(screen.getByTestId('go-online-button'));

      await waitFor(() => expect(history.location.pathname).toBe('/login'));
    });

    it('guards against double-submission while a reconnect is in flight', async () => {
      mockIsOfflineLocked.current = true;
      let resolveAttempt: (value: string) => void = () => {};
      mockAttemptReconnect.mockImplementation(
        () => new Promise<string>((resolve) => { resolveAttempt = resolve; }),
      );
      const user = userEvent.setup();
      renderSettings();

      const button = screen.getByTestId('go-online-button');
      await user.click(button);
      await waitFor(() => expect(button).toHaveTextContent('Reconnecting\u2026'));
      // The rendered item is also disabled (not just guarded in the handler).
      expect(button).toHaveAttribute('aria-disabled', 'true');

      await user.click(button);
      expect(mockAttemptReconnect).toHaveBeenCalledOnce();

      resolveAttempt('network_error');
      await waitFor(() => {
        expect(screen.getByTestId('reconnect-failed-dismiss')).toBeInTheDocument();
      });
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

  describe('Layers section', () => {
    it('renders a row per layer with the satellite toggle forced on + disabled', () => {
      renderSettings();

      const satToggle = screen.getByTestId('layer-toggle-esri-satellite') as HTMLInputElement;
      expect(satToggle).toBeChecked();
      expect(satToggle).toBeDisabled();

      const hillToggle = screen.getByTestId('layer-toggle-esri-world-hillshade') as HTMLInputElement;
      expect(hillToggle).not.toBeChecked();
      expect(hillToggle).not.toBeDisabled();

      expect(screen.getByTestId('layer-row-esri-world-hillshade-dark')).toBeInTheDocument();
    });

    it('toggling an extra layer calls controller.setLayerOfflineSync', async () => {
      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('layer-toggle-esri-world-hillshade'));

      expect(mockSetLayerOfflineSync).toHaveBeenCalledWith('esri-world-hillshade', true);
    });

    it('disables extra-layer toggles while offline-locked', () => {
      mockIsOfflineLocked.current = true;
      renderSettings();

      // Extra layers cannot be synced offline, so their toggles are locked.
      expect(screen.getByTestId('layer-toggle-esri-world-hillshade')).toBeDisabled();
      expect(screen.getByTestId('layer-toggle-esri-world-hillshade-dark')).toBeDisabled();
      expect(screen.getByTestId('layer-sync-status-esri-world-hillshade')).toHaveTextContent(
        'unavailable offline',
      );
      // Satellite stays forced-on + disabled regardless.
      expect(screen.getByTestId('layer-toggle-esri-satellite')).toBeDisabled();
    });

    it('shows per-layer sync percentage from prefetch jobs grouped by layer', () => {
      mockTilePrefetchJobs.current = [
        {
          layerId: 'esri-satellite', projectId: 'p1', commitId: 'c1', status: 'downloading',
          zoomMin: 0, zoomMax: 18, padMeters: 50,
          totalTiles: 100, completedTiles: 50, failedTiles: 0,
          bytesDownloaded: 0, estimatedBytes: 0, updatedAt: 1,
        },
        {
          layerId: 'esri-world-hillshade', projectId: 'p1', commitId: 'c1', status: 'done',
          zoomMin: 0, zoomMax: 16, padMeters: 50,
          totalTiles: 10, completedTiles: 10, failedTiles: 0,
          bytesDownloaded: 0, estimatedBytes: 0, updatedAt: 1,
        },
      ];
      renderSettings();

      expect(screen.getByTestId('layer-sync-status-esri-satellite')).toHaveTextContent('50%');
      expect(screen.getByTestId('layer-sync-status-esri-world-hillshade')).toHaveTextContent(
        'Offline sync off',
      );
    });
  });
});
