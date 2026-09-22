import React from 'react';
import { render } from '@testing-library/react';
import { createExpression, latest } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import { COLORS } from '../../constants';
import type { Project } from '../../types/project';
import type { OverlayIconAvailability } from './dashboardMapUtils';
import { GpsMapLayers } from './GpsMapLayers';
import { OverlayMapLayers } from './OverlayMapLayers';
import { ProjectMapLayers } from './ProjectMapLayers';
import { GisGeometryMapLayers } from './GisGeometryMapLayers';

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
  Layer: ({ id, source, paint, filter, beforeId }: {
    id: string;
    source?: string;
    paint?: Record<string, unknown>;
    filter?: unknown;
    beforeId?: string;
  }) => (
    <div
      data-layer-id={id}
      data-layer-source-id={source}
      data-paint={JSON.stringify(paint)}
      data-filter={JSON.stringify(filter)}
      data-before-id={beforeId}
      data-text-color-expression={JSON.stringify(paint?.['text-color'])}
    />
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
  it('evaluates shot colors and project fallback in both production paint expressions', () => {
    const { container, rerender } = render(<ProjectMapLayers
      projects={[PROJECT]}
      activeProjectIds={new Set([PROJECT.id])}
      geoJsonData={{ [PROJECT.id]: POINT_FEATURE_COLLECTION }}
      projectColorsById={{ [PROJECT.id]: PROJECT.color }}
      colorMode="shot"
      depthDomain={null}
    />);
    for (const [suffix, property, spec] of [
      ['line', 'line-color', latest.paint_line['line-color']],
      ['fill', 'fill-color', latest.paint_fill['fill-color']],
    ] as const) {
      const layer = container.querySelector(`[data-layer-id="project-${PROJECT.id}-${suffix}"]`)!;
      expect(layer).toHaveAttribute('data-layer-source-id', `project-${PROJECT.id}`);
      const expression = JSON.parse(layer.getAttribute('data-paint')!)[property];
      const compiled = createExpression(expression, property, spec as StylePropertySpecification);
      expect(compiled.result).toBe('success');
      if (compiled.result !== 'success') throw new Error('Invalid project color expression');
      const cases = [
        [{ color: '#112233' }, 'rgba(17,34,51,1)'],
        [{ color: 'rgba(17,34,51,0.5)' }, 'rgba(17,34,51,0.5)'],
        [{ color: 'rgba(0,0,0,0)' }, 'rgba(0,0,0,0)'],
        ...[undefined, null, '', 'invalid', '0x112233ff', 42, {}, [2], [300, 0, 0], [255, 0, 0, 2]]
          .map((color) => [{ color }, 'rgba(55,126,184,1)']),
        [{}, 'rgba(55,126,184,1)'],
        [null, 'rgba(55,126,184,1)'],
      ];
      for (const [properties, expected] of cases) {
        const color = compiled.value.evaluateWithoutErrorHandling(
          { zoom: 15 }, { ...POINT_FEATURE_COLLECTION.features[0], properties } as never, {},
        );
        expect(color.toString()).toBe(expected);
      }
    }
    expect(JSON.parse(container.querySelector(`[data-layer-id="project-${PROJECT.id}-point"]`)!.getAttribute('data-paint')!))
      .toMatchObject({ 'text-color': '#F5E027' });
    rerender(<ProjectMapLayers
      projects={[PROJECT]} activeProjectIds={new Set([PROJECT.id])}
      geoJsonData={{ [PROJECT.id]: POINT_FEATURE_COLLECTION }}
      projectColorsById={{ [PROJECT.id]: '#abcdef' }} colorMode="shot" depthDomain={null}
    />);
    expect(JSON.parse(container.querySelector(`[data-layer-id="project-${PROJECT.id}-line"]`)!.getAttribute('data-paint')!))
      .toMatchObject({ 'line-color': ['to-color', ['get', 'color'], '#abcdef'] });
  });

  it('binds all GIS styles directly to one source below the stable GIS anchor', () => {
    const { container } = render(<GisGeometryMapLayers featureCollection={EMPTY_FEATURE_COLLECTION} />);
    const styles = [
      ['fill', 'Polygon', { 'fill-color': ['get', 'color'], 'fill-opacity': 0.175 }],
      ['outline', 'Polygon', { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.95 }],
      ['line', 'LineString', { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.95 }],
    ] as const;
    for (const [suffix, type, paint] of styles) {
      const layer = container.querySelector(`[data-layer-id="gis-geometries-${suffix}"]`)!;
      expect(layer).toHaveAttribute('data-layer-source-id', 'gis-geometries-source');
      expect(layer).toHaveAttribute('data-before-id', 'gis-geometry-order-anchor');
      expect(JSON.parse(layer.getAttribute('data-paint')!)).toEqual(paint);
      expect(JSON.parse(layer.getAttribute('data-filter')!)).toEqual(['==', ['geometry-type'], type]);
    }
    expect(container.querySelector('[data-layer-id="gis-geometry-order-anchor"]'))
      .toHaveAttribute('data-layer-source-id', 'gis-geometry-order-source');
  });

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

  it('renders pending personal landmarks with a valid fallback color', () => {
    const pendingPersonalLandmark: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'local:averaged-point',
        properties: {
          name: 'High-accuracy point',
          collection: '',
          collection_color: '',
          is_personal_collection: true,
        },
        geometry: { type: 'Point', coordinates: [-73, 45] },
      }],
    };
    const { container } = render(
      <OverlayMapLayers
        visibleOverlayGeoJsonData={{ landmarks: pendingPersonalLandmark }}
        visibleLandmarksGeoJSON={pendingPersonalLandmark}
        showLandmarks
        iconsLoaded
        iconAvailability={NO_ICONS}
      />,
    );
    const layer = container.querySelector('[data-layer-id="landmarks-layer"]');
    const expression = JSON.parse(
      layer?.getAttribute('data-text-color-expression') ?? 'null',
    );
    expect(expression).toEqual([
      'to-color',
      ['get', 'collection_color'],
      COLORS.FALLBACK,
    ]);
    const compiled = createExpression(
      expression,
      'text-color',
      latest.paint_symbol['text-color'] as StylePropertySpecification,
    );
    expect(compiled.result).toBe('success');
    if (compiled.result !== 'success') throw new Error('Landmark color expression is invalid.');

    const color = compiled.value.evaluateWithoutErrorHandling(
      { zoom: 15 },
      pendingPersonalLandmark.features[0] as never,
      {},
    );
    expect(color.toString()).toBe('rgba(148,163,184,1)');
  });
});
