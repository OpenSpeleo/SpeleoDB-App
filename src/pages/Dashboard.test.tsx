import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Dashboard from './Dashboard';
import type { Project } from '../types/project';

// ==================== Mocks ====================

vi.mock('@ionic/react', () => ({
  IonPage: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-page">{children}</div>
  ),
  IonContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-content">{children}</div>
  ),
  IonRefresher: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-refresher">{children}</div>
  ),
  IonRefresherContent: () => <div data-testid="ion-refresher-content" />,
}));

// Mock maplibre-gl (used by TileCacheService)
vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: vi.fn(),
  },
}));

// Mock react-map-gl/maplibre
vi.mock('react-map-gl/maplibre', () => {
  const MapMock = React.forwardRef(
    ({ children }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        fitBounds: vi.fn(),
        getMap: vi.fn(),
      }));
      return <div data-testid="map">{children}</div>;
    },
  );
  MapMock.displayName = 'MapMock';

  return {
    default: MapMock,
    Source: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="map-source">{children}</div>
    ),
    Layer: () => <div data-testid="map-layer" />,
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
const mockGetProjectGeoJSON = vi.fn().mockResolvedValue(null);
const mockLogout = vi.fn();
const mockIsAuthenticated = vi.fn().mockReturnValue(true);
let mockProjects: Project[] = [];

vi.mock('../context/SpeleoDBProvider', () => ({
  useSpeleoDB: () => ({
    controller: {
      syncProjects: mockSyncProjects,
      getProjectGeoJSON: mockGetProjectGeoJSON,
      logout: mockLogout,
      isAuthenticated: mockIsAuthenticated,
    },
    projects: mockProjects,
    syncStatus: 'idle' as const,
    isOnline: true,
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
    mockIsAuthenticated.mockReturnValue(true);
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

  it('calls logout and navigates home on Sign Out click', async () => {
    const history = renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Sign Out'));
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(history.location.pathname).toBe('/');
  });

  it('redirects to /login when not authenticated', () => {
    mockIsAuthenticated.mockReturnValue(false);
    const history = renderDashboard();
    expect(history.location.pathname).toBe('/login');
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

  it('renders navigation control', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('nav-control')).toBeInTheDocument();
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
});
