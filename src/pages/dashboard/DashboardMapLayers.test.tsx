import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../../types/project';
import type { OverlayIconAvailability } from './dashboardMapUtils';
import { GpsMapLayers } from './GpsMapLayers';
import { OverlayMapLayers } from './OverlayMapLayers';
import { ProjectMapLayers } from './ProjectMapLayers';

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({
    id,
    children,
  }: {
    id: string;
    children?: React.ReactNode;
  }) => (
    <div data-source-id={id}>
      {React.Children.map(children, (child) => (
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ source?: string }>, { source: id })
          : child
      ))}
    </div>
  ),
  Layer: ({ id, source }: { id: string; source?: string }) => (
    <div data-layer-id={id} data-layer-source-id={source} />
  ),
}));

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const POINT_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [2, 46] },
  }],
};

const NO_ICONS: OverlayIconAvailability = {
  'biology-station-icon': false,
  'bone-station-icon': false,
  'artifact-station-icon': false,
  'geology-station-icon': false,
  'exploration-lead-icon': false,
  'cylinder-icon': false,
};

const PROJECT: Project = {
  id: 'project-1',
  name: 'Source Contract Cave',
  description: '',
  country: 'FR',
  color: '#377eb8',
  type: 'COMPASS',
  visibility: 'PRIVATE',
  is_active: true,
  created_by: 'user@example.com',
  creation_date: '2026-01-01',
  modified_date: '2026-01-01',
  commit_count: 1,
  active_mutex: null,
  fork_from: null,
  exclude_geojson: false,
  geojson_file: 'https://example.com/project.geojson',
  latest_commit: {
    id: 'commit-1',
    message: 'test',
    author_email: 'user@example.com',
    author_name: 'User',
    authored_date: '2026-01-01',
    dt_since: 'today',
    parent_ids: [],
    url: '',
    formats: [],
    tree: [],
  },
};

describe('Dashboard map layers', () => {
  it('binds every active project layer to its GeoJSON source', () => {
    const { container } = render(
      <ProjectMapLayers
        projects={[PROJECT]}
        activeProjectIds={new Set([PROJECT.id])}
        geoJsonData={{ [PROJECT.id]: POINT_FEATURE_COLLECTION }}
        projectColorsById={{ [PROJECT.id]: PROJECT.color }}
        colorMode="project"
        depthDomain={null}
      />,
    );

    const sourceId = `project-${PROJECT.id}`;
    for (const suffix of ['fill', 'line', 'point']) {
      expect(container.querySelector(`[data-layer-id="${sourceId}-${suffix}"]`))
        .toHaveAttribute('data-layer-source-id', sourceId);
    }
  });

  it('omits project layers without active data', () => {
    const { container, rerender } = render(
      <ProjectMapLayers
        projects={[PROJECT]}
        activeProjectIds={new Set()}
        geoJsonData={{ [PROJECT.id]: POINT_FEATURE_COLLECTION }}
        projectColorsById={{ [PROJECT.id]: PROJECT.color }}
        colorMode="project"
        depthDomain={null}
      />,
    );
    expect(container.querySelector(`[data-source-id="project-${PROJECT.id}"]`)).toBeNull();

    rerender(
      <ProjectMapLayers
        projects={[PROJECT]}
        activeProjectIds={new Set([PROJECT.id])}
        geoJsonData={{}}
        projectColorsById={{ [PROJECT.id]: PROJECT.color }}
        colorMode="project"
        depthDomain={null}
      />,
    );
    expect(container.querySelector(`[data-source-id="project-${PROJECT.id}"]`)).toBeNull();
  });

  it('does not render a recording line when a non-idle recording has no points', () => {
    const { container } = render(
      <GpsMapLayers
        savedTrackFeatureCollection={EMPTY_FEATURE_COLLECTION}
        currentTrackFeatureCollection={EMPTY_FEATURE_COLLECTION}
        recordingState="paused"
      />,
    );

    expect(container.querySelector('[data-layer-id="gps-recording-track-line"]')).toBeNull();
  });

  it('renders the current line while a recording has points', () => {
    const { container } = render(
      <GpsMapLayers
        savedTrackFeatureCollection={EMPTY_FEATURE_COLLECTION}
        currentTrackFeatureCollection={POINT_FEATURE_COLLECTION}
        recordingState="recording"
      />,
    );

    expect(container.querySelector('[data-layer-id="gps-recording-track-line"]'))
      .toHaveAttribute('data-layer-source-id', 'gps-recording-track-source');
  });

  it('binds available subsurface icons to the station source', () => {
    const iconAvailability = { ...NO_ICONS, 'biology-station-icon': true };
    const { container } = render(
      <OverlayMapLayers
        visibleOverlayGeoJsonData={{ subsurfaceStations: POINT_FEATURE_COLLECTION }}
        visibleLandmarksGeoJSON={undefined}
        showLandmarks={false}
        iconsLoaded
        iconAvailability={iconAvailability}
      />,
    );

    expect(container.querySelector('[data-layer-id="subsurface-stations-biology-icons"]'))
      .toHaveAttribute('data-layer-source-id', 'subsurface-stations-source');
  });

  it('omits unavailable subsurface icons after icon loading completes', () => {
    const { container } = render(
      <OverlayMapLayers
        visibleOverlayGeoJsonData={{ subsurfaceStations: POINT_FEATURE_COLLECTION }}
        visibleLandmarksGeoJSON={undefined}
        showLandmarks={false}
        iconsLoaded
        iconAvailability={NO_ICONS}
      />,
    );

    expect(container.querySelector('[data-layer-id="subsurface-stations-circles"]')).not.toBeNull();
    expect(container.querySelector('[data-layer-id$="-icons"]')).toBeNull();
  });
});
