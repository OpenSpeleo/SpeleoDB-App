import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Dashboard from './Dashboard';
import type { Project } from '../types/project';

// ==================== Mocks ====================

const {
  mapPropsRef,
  mockMapFitBounds,
  mockGetMap,
  mockDisableTouchRotation,
  mockSetBearing,
  mockSetPitch,
} = vi.hoisted(() => {
  const mapPropsRef = { current: null as Record<string, unknown> | null };
  const mockMapFitBounds = vi.fn();
  const mockDisableTouchRotation = vi.fn();
  const mockSetBearing = vi.fn();
  const mockSetPitch = vi.fn();
  const mockGetMap = vi.fn(() => ({
    touchZoomRotate: { disableRotation: mockDisableTouchRotation },
    setBearing: mockSetBearing,
    setPitch: mockSetPitch,
  }));

  return {
    mapPropsRef,
    mockMapFitBounds,
    mockGetMap,
    mockDisableTouchRotation,
    mockSetBearing,
    mockSetPitch,
  };
});

vi.mock('@ionic/react', () => ({
  IonPage: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-page">{children}</div>
  ),
  IonContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-content">{children}</div>
  ),
  IonModal: ({
    children,
    isOpen,
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
  }) => (isOpen ? <div data-testid="ion-modal">{children}</div> : null),
  IonRefresher: ({
    children,
    className,
    disabled,
    onIonRefresh,
  }: {
    children?: React.ReactNode;
    className?: string;
    disabled?: boolean;
    onIonRefresh?: (event: CustomEvent) => void;
  }) => (
    <div
      data-testid="ion-refresher"
      className={className}
      data-disabled={disabled ? 'true' : 'false'}
    >
      <button
        type="button"
        data-testid="trigger-refresh"
        onClick={() => onIonRefresh?.({
          detail: { complete: () => {} },
        } as unknown as CustomEvent)}
      >
        Trigger refresh
      </button>
      {children}
    </div>
  ),
  IonRefresherContent: () => <div data-testid="ion-refresher-content" />,
}));

// Mock maplibre-gl (used by TileCacheService)
vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
  },
}));

// Mock react-map-gl/maplibre
vi.mock('react-map-gl/maplibre', () => {
  const MapMock = React.forwardRef(
    (
      { children, ...mapProps }: { children?: React.ReactNode } & Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) => {
      mapPropsRef.current = mapProps;

      React.useImperativeHandle(ref, () => ({
        fitBounds: mockMapFitBounds,
        getMap: mockGetMap,
      }));

      React.useEffect(() => {
        const onLoad = mapProps.onLoad;
        if (typeof onLoad === 'function') onLoad();
      }, [mapProps.onLoad]);

      return <div data-testid="map">{children}</div>;
    },
  );
  MapMock.displayName = 'MapMock';

  return {
    default: MapMock,
    Source: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="map-source">{children}</div>
    ),
    Layer: ({
      id,
      paint,
    }: {
      id?: string;
      paint?: Record<string, unknown>;
    }) => {
      const lineColor = paint?.['line-color'];
      const fillColor = paint?.['fill-color'];
      const circleColor = paint?.['circle-color'];
      const layerColor = [lineColor, fillColor, circleColor].find(
        (value): value is string => typeof value === 'string',
      ) ?? '';

      return <div data-testid="map-layer" data-layer-id={id} data-layer-color={layerColor} />;
    },
    NavigationControl: () => <div data-testid="nav-control" />,
  };
});

// Mock TileCacheService
vi.mock('../services/TileCacheService', () => ({
  registerTileCacheProtocol: vi.fn(),
  getCachedStyle: vi.fn().mockResolvedValue({
    version: 8,
    sources: {},
    layers: [],
  }),
}));

const {
  mockGetProjectVisibilityPreferences,
  mockSetProjectVisibilityPreference,
  mockSetProjectVisibilityPreferences,
} = vi.hoisted(() => ({
  mockGetProjectVisibilityPreferences: vi.fn(() => ({})),
  mockSetProjectVisibilityPreference: vi.fn(),
  mockSetProjectVisibilityPreferences: vi.fn(),
}));

vi.mock('../services/PreferencesService', () => ({
  getProjectVisibilityPreferences: mockGetProjectVisibilityPreferences,
  setProjectVisibilityPreference: mockSetProjectVisibilityPreference,
  setProjectVisibilityPreferences: mockSetProjectVisibilityPreferences,
}));

// Mock SpeleoDBProvider
const mockSyncProjects = vi.fn().mockResolvedValue(undefined);
const mockRetryConnection = vi.fn().mockResolvedValue('ok');
const mockGetProjectGeoJSON = vi.fn().mockResolvedValue(null);
const mockLogout = vi.fn();
const mockIsAuthenticated = vi.fn().mockReturnValue(true);
let mockIsOfflineLocked = false;
let mockProjects: Project[] = [];
const mockController = {
  syncProjects: mockSyncProjects,
  retryConnection: mockRetryConnection,
  getProjectGeoJSON: mockGetProjectGeoJSON,
  logout: mockLogout,
  isAuthenticated: mockIsAuthenticated,
};

vi.mock('../context/SpeleoDBProvider', () => ({
  useSpeleoDB: () => ({
    controller: mockController,
    projects: mockProjects,
    syncStatus: 'idle' as const,
    isOnline: true,
    isOfflineLocked: mockIsOfflineLocked,
    isRetryingConnection: false,
    tilePrefetchJobs: [],
  }),
}));

// ==================== Helpers ====================

function renderDashboard() {
  const history = createMemoryHistory({ initialEntries: ['/dashboard'] });
  render(
    <Router history={history}>
      <Dashboard />
    </Router>,
  );
  return history;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    description: '',
    country: 'FR',
    type: 'survey',
    visibility: 'public',
    is_active: true,
    created_by: 'user',
    creation_date: '2025-01-01',
    modified_date: '2025-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: 'https://example.com/test.geojson',
    latest_commit: {
      id: 'c1',
      message: 'init',
      author_email: 'a@b.com',
      author_name: 'Author',
      authored_date: '2025-01-01',
      dt_since: '1 day ago',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
    ...overrides,
  };
}

function pointFeatureCollection(lng = 2.3, lat = 46.6): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
      },
    ],
  };
}

// ==================== Tests ====================

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapPropsRef.current = null;
    mockIsAuthenticated.mockReturnValue(true);
    mockIsOfflineLocked = false;
    mockProjects = [];
    mockGetProjectVisibilityPreferences.mockReturnValue({});
  });

  it('renders the map when authenticated', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('map')).toBeInTheDocument();
    });
  });

  it('renders Sign Out button', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });
  });

  it('renders dashboard-specific refresher class', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('ion-refresher')).toHaveClass('dashboard-refresher');
    });
  });

  it('asks for confirmation before wiping data on Sign Out', async () => {
    const history = renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Sign Out'));
    expect(mockLogout).not.toHaveBeenCalled();
    expect(
      screen.getByText('Clear local data and sign out?'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByText('Wipe local data & Sign Out'));
    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledOnce();
      expect(history.location.pathname).toBe('/');
    });
  });

  it('redirects to /login when not authenticated', () => {
    mockIsAuthenticated.mockReturnValue(false);
    const history = renderDashboard();
    return waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
  });

  it('calls syncProjects on mount', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(mockSyncProjects).toHaveBeenCalledOnce();
    });
  });

  it('opens project panel when menu button is clicked', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByLabelText('Open project panel')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Open project panel'));
    // Panel should now show "Projects" heading
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('does not render navigation control', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.queryByTestId('nav-control')).not.toBeInTheDocument();
    });
  });

  it('locks map orientation and disables rotation interactions', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('map')).toBeInTheDocument();
      expect(mapPropsRef.current).not.toBeNull();
    });

    const mapProps = mapPropsRef.current as Record<string, unknown>;
    expect(mapProps.dragRotate).toBe(false);
    expect(mapProps.touchPitch).toBe(false);
    expect(mapProps.pitchWithRotate).toBe(false);
    expect(mapProps.keyboard).toBe(false);
    expect(mapProps.maxPitch).toBe(0);

    const initialViewState = mapProps.initialViewState as Record<string, unknown>;
    expect(initialViewState.bearing).toBe(0);
    expect(initialViewState.pitch).toBe(0);

    await waitFor(() => {
      expect(mockDisableTouchRotation).toHaveBeenCalledOnce();
      expect(mockSetBearing).toHaveBeenCalledWith(0);
      expect(mockSetPitch).toHaveBeenCalledWith(0);
    });
  });

  it('disables refresher while map pointer gesture is active', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('map')).toBeInTheDocument();
    });

    const refresher = screen.getByTestId('ion-refresher');
    const mapTouchSurface = document.querySelector('.dashboard-map-touch-surface');
    expect(mapTouchSurface).toBeTruthy();

    expect(refresher).toHaveAttribute('data-disabled', 'false');

    fireEvent.pointerDown(mapTouchSurface as Element);
    expect(refresher).toHaveAttribute('data-disabled', 'true');

    fireEvent.pointerUp(mapTouchSurface as Element);
    expect(refresher).toHaveAttribute('data-disabled', 'false');
  });

  it('uses pull-to-refresh as online recovery attempt while offline-locked', async () => {
    mockIsOfflineLocked = true;
    mockRetryConnection.mockResolvedValueOnce('network_error');
    renderDashboard();

    await waitFor(() => {
      expect(mockSyncProjects).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTestId('trigger-refresh'));

    await waitFor(() => {
      expect(mockRetryConnection).toHaveBeenCalledOnce();
    });
    expect(mockSyncProjects).toHaveBeenCalledTimes(1);
  });

  it('retries then syncs when pull-to-refresh reconnect succeeds', async () => {
    mockIsOfflineLocked = true;
    mockRetryConnection.mockResolvedValueOnce('ok');
    renderDashboard();

    await waitFor(() => {
      expect(mockSyncProjects).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTestId('trigger-refresh'));

    await waitFor(() => {
      expect(mockRetryConnection).toHaveBeenCalledOnce();
      expect(mockSyncProjects).toHaveBeenCalledTimes(2);
    });
  });

  it('renders GeoJSON layer when payload is a JSON string', async () => {
    mockProjects = [makeProject({ id: 'p-json', name: 'JSON String Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [2.3, 46.6],
          },
        },
      ],
    }));

    renderDashboard();

    await waitFor(() => {
      expect(mockGetProjectGeoJSON).toHaveBeenCalledWith('p-json');
      expect(screen.getByTestId('map-source')).toBeInTheDocument();
    });
  });

  it('restores visibility from saved preferences on first load', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Alpha' }),
      makeProject({ id: 'p2', name: 'Beta' }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
      pointFeatureCollection(projectId === 'p1' ? 2.3 : 2.4, 46.6),
    );
    mockGetProjectVisibilityPreferences.mockReturnValue({
      p1: false,
      p2: true,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByTestId('map-source')).toHaveLength(1);
    });
  });

  it('shows project count when cached panel projects are available (even with idle sync status)', async () => {
    mockProjects = [makeProject({ id: 'p-count', name: 'Count Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(pointFeatureCollection());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('1 project')).toBeInTheDocument();
    });
  });

  it('persists project visibility when toggled', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Toggle Me' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Toggle Me')).toBeInTheDocument();
      expect(screen.getByTestId('map-source')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Toggle Toggle Me'));
    expect(mockSetProjectVisibilityPreference).toHaveBeenCalledWith('p1', false);
  });

  it('persists show-all and hide-all visibility in bulk', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Alpha' }),
      makeProject({ id: 'p2', name: 'Beta' }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
      pointFeatureCollection(projectId === 'p1' ? 2.3 : 2.4, 46.6),
    );
    mockGetProjectVisibilityPreferences.mockReturnValue({
      p1: false,
      p2: false,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Show all')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Show all'));
    expect(mockSetProjectVisibilityPreferences).toHaveBeenCalledWith({
      p1: true,
      p2: true,
    });

    await userEvent.click(screen.getByText('Hide all'));
    expect(mockSetProjectVisibilityPreferences).toHaveBeenCalledWith({
      p1: false,
      p2: false,
    });
  });

  it('persists visible=true when zooming to a project', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Zoom Me' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetProjectVisibilityPreferences.mockReturnValue({
      p1: false,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Zoom Me')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Zoom Me'));
    expect(mockSetProjectVisibilityPreference).toHaveBeenCalledWith('p1', true);
  });

  it('uses the same project color in panel dot and map layer', async () => {
    mockProjects = [
      makeProject({
        id: 'p-hidden',
        name: 'Alpha Hidden',
        exclude_geojson: true,
        geojson_file: null,
      }),
      makeProject({
        id: 'p-visible',
        name: 'Beta Visible',
      }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) => {
      if (projectId === 'p-visible') {
        return pointFeatureCollection(2.4, 46.7);
      }
      return null;
    });

    const history = renderDashboard();
    await waitFor(() => {
      expect(history.location.pathname).toBe('/dashboard');
      expect(mockGetProjectGeoJSON).toHaveBeenCalledWith('p-visible');
      expect(screen.getByTestId('project-color-dot-p-visible')).toBeInTheDocument();
    });

    const lineLayer = document.querySelector(
      '[data-layer-id="project-p-visible-line"]',
    ) as HTMLElement | null;
    expect(lineLayer).not.toBeNull();

    const layerColor = lineLayer?.dataset.layerColor;
    expect(layerColor).toBeTruthy();

    const panelDot = screen.getByTestId('project-color-dot-p-visible');
    expect(panelDot.getAttribute('style')).toContain(`border-color: ${layerColor}`);
  });
});
