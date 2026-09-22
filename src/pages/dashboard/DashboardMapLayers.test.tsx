import React from 'react';
import { render } from '@testing-library/react';
import { createExpression, latest } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import { COLORS } from '../../constants';
import { createDefaultMapDisplayPreferences, type MapDisplayPreferences } from '../../types/mapDisplayPreferences';
import type { Project } from '../../types/project';
import type { OverlayIconAvailability } from './dashboardMapUtils';
import { GpsMapLayers } from './GpsMapLayers';
import { OverlayMapLayers } from './OverlayMapLayers';
import { ProjectMapLayers } from './ProjectMapLayers';
import { GisGeometryMapLayers } from './GisGeometryMapLayers';

const sourceInputs = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({
    id,
    data,
    children,
  }: {
    id: string;
    data: unknown;
    children?: React.ReactNode;
  }) => {
    sourceInputs.record(id, data);
    return (
    <div data-source-id={id}>
      {React.Children.map(children, (child) => (
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ source?: string }>, { source: id })
          : child
      ))}
    </div>
    );
  },
  Layer: ({ id, source, paint, filter, layout, beforeId }: {
    id: string;
    source?: string;
    paint?: Record<string, unknown>;
    filter?: unknown;
    layout?: unknown;
    beforeId?: string;
  }) => (
    <div
      data-layer-id={id}
      data-layer-source-id={source}
      data-paint={JSON.stringify(paint)}
      data-filter={JSON.stringify(filter)}
      data-layout={JSON.stringify(layout)}
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

const ALL_ICONS = Object.fromEntries(Object.keys(NO_ICONS).map((id) => [id, true])) as OverlayIconAvailability;
const DEFAULT_DISPLAY = createDefaultMapDisplayPreferences();

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

function layoutFor(container: HTMLElement, layerId: string): Record<string, unknown> {
  const layer = container.querySelector(`[data-layer-id="${layerId}"]`);
  expect(layer).not.toBeNull();
  return JSON.parse(layer!.getAttribute('data-layout') ?? '{}');
}

function allOverlays(preferences: MapDisplayPreferences, icons = ALL_ICONS) {
  return <OverlayMapLayers
    visibleOverlayGeoJsonData={{
      subsurfaceStations: POINT_FEATURE_COLLECTION,
      surfaceStations: POINT_FEATURE_COLLECTION,
      explorationLeads: POINT_FEATURE_COLLECTION,
      cylinderInstalls: POINT_FEATURE_COLLECTION,
    }}
    visibleLandmarksGeoJSON={POINT_FEATURE_COLLECTION}
    mapDisplayPreferences={preferences}
    iconsLoaded
    iconAvailability={icons}
  />;
}

describe('Dashboard map layers', () => {
  it('hides entrance stars without replacing the source, linework or fill', () => {
    const props = {
      projects: [PROJECT], activeProjectIds: new Set([PROJECT.id]),
      geoJsonData: { [PROJECT.id]: POINT_FEATURE_COLLECTION },
      projectColorsById: { [PROJECT.id]: PROJECT.color },
      colorMode: 'depth' as const, depthDomain: { min: 0, max: 50 },
    };
    const { container, rerender } = render(<ProjectMapLayers {...props} showCaveEntrances />);
    const source = container.querySelector(`[data-source-id="project-${PROJECT.id}"]`);
    const line = container.querySelector(`[data-layer-id="project-${PROJECT.id}-line"]`);
    const originalPaint = line?.getAttribute('data-paint');
    sourceInputs.record.mockClear();
    rerender(<ProjectMapLayers {...props} showCaveEntrances={false} />);
    expect(container.querySelector(`[data-source-id="project-${PROJECT.id}"]`)).toBe(source);
    expect(container.querySelector(`[data-layer-id="project-${PROJECT.id}-line"]`)).toBe(line);
    expect(line).toHaveAttribute('data-paint', originalPaint!);
    expect(layoutFor(container, `project-${PROJECT.id}-point`).visibility).toBe('none');
    expect(sourceInputs.record).toHaveBeenCalledWith(`project-${PROJECT.id}`, POINT_FEATURE_COLLECTION);
    rerender(<ProjectMapLayers {...props} showCaveEntrances />);
    expect(layoutFor(container, `project-${PROJECT.id}-point`).visibility).toBe('visible');
    expect(container.querySelector(`[data-source-id="project-${PROJECT.id}"]`)).toBe(source);
  });

  it.each([
    ['landmarks', ['landmarks-layer', 'landmarks-labels']],
    ['surfaceStations', ['surface-stations-layer', 'surface-stations-labels']],
    ['surveyStations', ['subsurface-stations-circles', 'subsurface-stations-biology-icons', 'subsurface-stations-bone-icons', 'subsurface-stations-artifact-icons', 'subsurface-stations-geology-icons', 'subsurface-stations-labels']],
    ['explorationLeads', ['exploration-leads-icon-layer']],
    ['cylinders', ['cylinder-installs-icon-layer', 'cylinder-installs-labels']],
  ] as const)('composes the %s gate across its layers while retaining the source data', (category, layerIds) => {
    const { container, rerender } = render(allOverlays(DEFAULT_DISPLAY));
    const sources = [...container.querySelectorAll('[data-source-id]')];
    const layers = [...container.querySelectorAll('[data-layer-id]')];
    const hidden = { ...DEFAULT_DISPLAY, categories: { ...DEFAULT_DISPLAY.categories, [category]: false } };
    sourceInputs.record.mockClear();
    rerender(allOverlays(hidden));
    for (const layerId of layerIds) {
      expect(layoutFor(container, layerId).visibility).toBe('none');
    }
    for (const layer of layers) {
      expect(container.querySelector(`[data-layer-id="${layer.getAttribute('data-layer-id')}"]`)).toBe(layer);
      expect(layer.getAttribute('data-layer-source-id')).toBeTruthy();
      if (!(layerIds as readonly string[]).includes(layer.getAttribute('data-layer-id')!)) {
        expect(layoutFor(container, layer.getAttribute('data-layer-id')!).visibility).toBe('visible');
      }
    }
    expect([...container.querySelectorAll('[data-source-id]')]).toEqual(sources);
    for (const [, data] of sourceInputs.record.mock.calls) expect(data).toBe(POINT_FEATURE_COLLECTION);
    rerender(allOverlays(DEFAULT_DISPLAY));
    for (const layerId of layerIds) expect(layoutFor(container, layerId).visibility).toBe('visible');
  });

  it('keeps fallback icons hidden when image loading finishes after a category was disabled', () => {
    const preferences = { ...DEFAULT_DISPLAY, categories: { ...DEFAULT_DISPLAY.categories, explorationLeads: false, cylinders: false } };
    const { container, rerender } = render(<OverlayMapLayers
      visibleOverlayGeoJsonData={{}} mapDisplayPreferences={preferences}
      iconsLoaded={false} iconAvailability={NO_ICONS}
    />);
    rerender(allOverlays(preferences, NO_ICONS));
    for (const id of ['exploration-leads-fallback-layer', 'cylinder-installs-fallback-layer', 'cylinder-installs-labels']) {
      expect(layoutFor(container, id).visibility).toBe('none');
    }
    rerender(allOverlays(preferences, ALL_ICONS));
    expect(layoutFor(container, 'exploration-leads-icon-layer').visibility).toBe('none');
    expect(layoutFor(container, 'cylinder-installs-icon-layer').visibility).toBe('none');
  });

  it.each(['sensor', 'biology', 'bone', 'artifact', 'geology'] as const)('filters %s labels and keeps its subtype off across a parent toggle', (type) => {
    const preferences = { ...DEFAULT_DISPLAY, stationTypes: { ...DEFAULT_DISPLAY.stationTypes, [type]: false } };
    const { container, rerender } = render(allOverlays(preferences));
    const layerId = type === 'sensor' ? 'subsurface-stations-circles' : `subsurface-stations-${type}-icons`;
    expect(layoutFor(container, layerId).visibility).toBe('none');
    const expression = JSON.parse(container.querySelector('[data-layer-id="subsurface-stations-labels"]')!.getAttribute('data-filter')!);
    const compiled = createExpression(expression, 'filter', { type: 'boolean' } as StylePropertySpecification);
    expect(compiled.result).toBe('success');
    if (compiled.result !== 'success') throw new Error('Invalid station label filter');
    for (const featureType of ['sensor', 'biology', 'bone', 'artifact', 'geology', null, undefined]) {
      const properties = featureType === undefined ? {} : { type: featureType };
      expect(compiled.value.evaluateWithoutErrorHandling(
        { zoom: 16 }, { ...POINT_FEATURE_COLLECTION.features[0], properties } as never, {},
      )).toBe((featureType ?? 'sensor') !== type);
    }
    rerender(allOverlays({ ...preferences, categories: { ...preferences.categories, surveyStations: false } }));
    expect(layoutFor(container, 'subsurface-stations-labels').visibility).toBe('none');
    rerender(allOverlays(preferences));
    expect(layoutFor(container, layerId).visibility).toBe('none');
    expect(layoutFor(container, 'subsurface-stations-labels').visibility).toBe('visible');
  });

  it('evaluates the existing depth ramp with a configured maximum and leaves raw feature values intact', () => {
    const { container } = render(<ProjectMapLayers
      projects={[PROJECT]} activeProjectIds={new Set([PROJECT.id])}
      geoJsonData={{ [PROJECT.id]: POINT_FEATURE_COLLECTION }}
      projectColorsById={{ [PROJECT.id]: PROJECT.color }} colorMode="depth"
      depthDomain={{ min: 0, max: 20 }} showCaveEntrances
    />);
    for (const [suffix, property, spec] of [
      ['line', 'line-color', latest.paint_line['line-color']],
      ['fill', 'fill-color', latest.paint_fill['fill-color']],
    ] as const) {
      const paint = JSON.parse(container.querySelector(`[data-layer-id="project-${PROJECT.id}-${suffix}"]`)!.getAttribute('data-paint')!);
      const expression = createExpression(paint[property], property, spec as StylePropertySpecification);
      expect(expression.result).toBe('success');
      if (expression.result !== 'success') throw new Error('Invalid depth expression');
      const colorAt = (depth: number | null) => expression.value.evaluateWithoutErrorHandling(
        { zoom: 16 }, { ...POINT_FEATURE_COLLECTION.features[0], properties: depth === null ? {} : { _speleoDepth: depth } } as never, {},
      ).toString();
      expect(colorAt(80)).toBe(colorAt(20));
      expect(colorAt(10)).not.toBe(colorAt(20));
      expect(colorAt(-10)).toBe(colorAt(0));
      expect(colorAt(null)).toBe('rgba(55,126,184,1)');
    }
  });

  it('compiles an empty station-type selection without leaving labels behind', () => {
    const preferences = {
      ...DEFAULT_DISPLAY,
      stationTypes: { sensor: false, biology: false, bone: false, artifact: false, geology: false },
    };
    const { container } = render(allOverlays(preferences));
    const labels = container.querySelector('[data-layer-id="subsurface-stations-labels"]')!;
    const compiled = createExpression(JSON.parse(labels.getAttribute('data-filter')!), 'filter', { type: 'boolean' } as StylePropertySpecification);
    expect(compiled.result).toBe('success');
    if (compiled.result !== 'success') throw new Error('Invalid empty station selection');
    for (const type of ['sensor', 'biology', 'bone', 'artifact', 'geology', null]) {
      expect(compiled.value.evaluateWithoutErrorHandling(
        { zoom: 16 }, { ...POINT_FEATURE_COLLECTION.features[0], properties: { type } } as never, {},
      )).toBe(false);
    }
  });

  it('evaluates shot colors and project fallback in both production paint expressions', () => {
    const { container, rerender } = render(<ProjectMapLayers
      showCaveEntrances
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
      showCaveEntrances
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
        showCaveEntrances
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
        showCaveEntrances
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
        showCaveEntrances
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
        mapDisplayPreferences={DEFAULT_DISPLAY}
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
        mapDisplayPreferences={DEFAULT_DISPLAY}
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
        mapDisplayPreferences={DEFAULT_DISPLAY}
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
