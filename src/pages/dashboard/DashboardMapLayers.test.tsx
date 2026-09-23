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
import { DownloadAreaMapLayers } from './DownloadAreaMapLayers';

const sourceInputs = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({
    id,
    data,
    tolerance,
    children,
  }: {
    id: string;
    data: unknown;
    tolerance?: number;
    children?: React.ReactNode;
  }) => {
    sourceInputs.record(id, data);
    return (
    <div data-source-id={id} data-tolerance={tolerance}>
      {React.Children.map(children, (child) => (
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ source?: string }>, { source: id })
          : child
      ))}
    </div>
    );
  },
  Layer: ({ id, source, type, paint, filter, layout, beforeId, minzoom }: {
    id: string;
    source?: string;
    type?: string;
    paint?: Record<string, unknown>;
    filter?: unknown;
    layout?: unknown;
    beforeId?: string;
    minzoom?: number;
  }) => (
    <div
      data-layer-id={id}
      data-layer-source-id={source}
      data-layer-type={type}
      data-paint={JSON.stringify(paint)}
      data-filter={JSON.stringify(filter)}
      data-layout={JSON.stringify(layout)}
      data-before-id={beforeId}
      data-minzoom={minzoom}
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
  it.each(['project', 'depth', 'shot'] as const)('keeps %s survey lines thin and available at overview zooms', (colorMode) => {
    const { container } = render(<ProjectMapLayers
      projects={[PROJECT]} activeProjectIds={new Set([PROJECT.id])}
      geoJsonData={{ [PROJECT.id]: POINT_FEATURE_COLLECTION }}
      projectColorsById={{ [PROJECT.id]: PROJECT.color }} colorMode={colorMode}
      depthDomain={{ min: 0, max: 50 }} showCaveEntrances={false}
    />);
    const source = container.querySelector(`[data-source-id="project-${PROJECT.id}"]`);
    expect(source).toHaveAttribute('data-tolerance', '0');
    const line = container.querySelector(`[data-layer-id="project-${PROJECT.id}-line"]`)!;
    expect(line).toHaveAttribute('data-layer-source-id', `project-${PROJECT.id}`);
    expect(line).toHaveAttribute('data-minzoom', '0');
    expect(layoutFor(container, `project-${PROJECT.id}-line`)).toEqual({
      'line-cap': 'round', 'line-join': 'round', visibility: 'visible',
    });
    const paint = JSON.parse(line.getAttribute('data-paint')!);
    const compiled = createExpression(paint['line-width'], 'line-width', latest.paint_line['line-width'] as StylePropertySpecification);
    expect(compiled.result).toBe('success');
    if (compiled.result !== 'success') throw new Error('Invalid survey width expression');
    const widthAt = (zoom: number) => compiled.value.evaluateWithoutErrorHandling({ zoom });
    for (const zoom of [0, 4, 6, 8, 9, 10, 11, 12]) {
      expect(widthAt(zoom)).toBeGreaterThanOrEqual(1);
      expect(widthAt(zoom)).toBeLessThanOrEqual(1.5);
    }
    expect(widthAt(10.5)).toBeCloseTo(1.3125);
    expect(widthAt(14)).toBe(2);
    for (const zoom of [16, 18, 22]) expect(widthAt(zoom)).toBe(2.5);
  });

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
      ['outline', 'Polygon', { 'line-color': ['get', 'color'], 'line-width': expect.any(Array), 'line-opacity': 0.95 }],
      ['line', 'LineString', { 'line-color': ['get', 'color'], 'line-width': expect.any(Array), 'line-opacity': 0.95 }],
    ] as const;
    for (const [suffix, type, paint] of styles) {
      const layer = container.querySelector(`[data-layer-id="gis-geometries-${suffix}"]`)!;
      expect(layer).toHaveAttribute('data-layer-source-id', 'gis-geometries-source');
      expect(layer).toHaveAttribute('data-before-id', 'gis-geometry-order-anchor');
      expect(JSON.parse(layer.getAttribute('data-paint')!)).toEqual(paint);
      expect(JSON.parse(layer.getAttribute('data-filter')!)).toEqual(['all', ['==', ['geometry-type'], type]]);
    }
    expect(container.querySelector('[data-layer-id="gis-geometry-order-anchor"]'))
      .toHaveAttribute('data-layer-source-id', 'gis-geometry-order-source');
  });

  it('preserves short geometry and thin overview strokes for every GeoJSON line layer', () => {
    const { container } = render(<>
      <ProjectMapLayers projects={[PROJECT]} activeProjectIds={new Set([PROJECT.id])}
        geoJsonData={{ [PROJECT.id]: POINT_FEATURE_COLLECTION }}
        projectColorsById={{ [PROJECT.id]: PROJECT.color }} colorMode="project"
        depthDomain={null} showCaveEntrances />
      <GisGeometryMapLayers featureCollection={POINT_FEATURE_COLLECTION} />
      <GpsMapLayers savedTrackFeatureCollection={POINT_FEATURE_COLLECTION}
        currentTrackFeatureCollection={POINT_FEATURE_COLLECTION} recordingState="recording" />
      <DownloadAreaMapLayers areas={[]} mapRef={{ current: null }} />
    </>);
    const expectedDetailWidths: Record<string, [number, number]> = {
      [`project-${PROJECT.id}-line`]: [2.5, 2.5],
      'gis-geometries-line': [2.5, 2.5],
      'gis-geometries-outline': [1.5, 1.5],
      'gps-tracks-line': [6, 7],
      'gps-recording-track-line': [4, 4],
      'download-areas-outline': [1.5, 1.5],
    };
    const lines = [...container.querySelectorAll('[data-layer-type="line"]')];
    expect(lines).toHaveLength(Object.keys(expectedDetailWidths).length);
    for (const line of lines) {
      const id = line.getAttribute('data-layer-id')!;
      const sourceId = line.getAttribute('data-layer-source-id');
      expect(sourceId).toBeTruthy();
      expect(container.querySelector(`[data-source-id="${sourceId}"]`)).toHaveAttribute('data-tolerance', '0');
      expect(Number(line.getAttribute('data-minzoom') ?? 0)).toBe(0);
      expect(layoutFor(container, id)).toMatchObject({ 'line-cap': 'round', 'line-join': 'round' });
      const paint = JSON.parse(line.getAttribute('data-paint')!);
      const expression = createExpression(paint['line-width'], 'line-width', latest.paint_line['line-width'] as StylePropertySpecification);
      expect(expression.result).toBe('success');
      if (expression.result !== 'success') throw new Error(`Invalid width for ${id}`);
      const widthAt = (zoom: number) => expression.value.evaluateWithoutErrorHandling({ zoom });
      for (const zoom of [0, 4, 8]) expect(widthAt(zoom)).toBe(1);
      expect(widthAt(10.5)).toBeCloseTo(1.3125);
      const [at16, at18] = expectedDetailWidths[id];
      expect(widthAt(12)).toBe(1.5);
      expect(widthAt(14)).toBe(Math.min(2, at16));
      expect(widthAt(16)).toBe(at16);
      expect(widthAt(18)).toBe(at18);
      expect(widthAt(22)).toBe(at18);
    }
    const savedPaint = JSON.parse(container.querySelector('[data-layer-id="gps-tracks-line"]')!.getAttribute('data-paint')!);
    expect(savedPaint['line-dasharray']).toEqual([2, 2]);
    expect(savedPaint['line-color']).toEqual(['coalesce', ['get', 'color'], '#38bdf8']);
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

describe('viewer source identity and filter contracts', () => {
  function accepts(container: HTMLElement, id: string, properties: Record<string, unknown>): boolean {
    const expression = JSON.parse(container.querySelector(`[data-layer-id="${id}"]`)!.getAttribute('data-filter')!);
    const compiled = createExpression(expression, 'filter', { type: 'boolean' } as StylePropertySpecification);
    expect(compiled.result).toBe('success');
    if (compiled.result !== 'success') throw new Error('Invalid viewer filter');
    return compiled.value.evaluateWithoutErrorHandling({ zoom: 16 }, {
      type: 'Feature', properties, geometry: { type: 'Point', coordinates: [0, 0] },
    } as never, {});
  }

  it('retains project source/data through hide/show and composes cave-entrance visibility', () => {
    const props = { projects: [PROJECT], geoJsonData: { [PROJECT.id]: POINT_FEATURE_COLLECTION }, projectColorsById: {}, colorMode: 'project' as const, depthDomain: null, showCaveEntrances: false };
    const { container, rerender } = render(<ProjectMapLayers {...props} activeProjectIds={new Set([PROJECT.id])} />);
    const source = container.querySelector(`[data-source-id="project-${PROJECT.id}"]`);
    rerender(<ProjectMapLayers {...props} activeProjectIds={new Set()} />);
    expect(container.querySelector(`[data-source-id="project-${PROJECT.id}"]`)).toBe(source);
    for (const suffix of ['line', 'fill', 'point']) expect(layoutFor(container, `project-${PROJECT.id}-${suffix}`).visibility).toBe('none');
    rerender(<ProjectMapLayers {...props} activeProjectIds={new Set([PROJECT.id])} />);
    expect(container.querySelector(`[data-source-id="project-${PROJECT.id}"]`)).toBe(source);
    expect(layoutFor(container, `project-${PROJECT.id}-line`).visibility).toBe('visible');
    expect(layoutFor(container, `project-${PROJECT.id}-point`).visibility).toBe('none');
    expect(sourceInputs.record.mock.calls.filter(([id]) => id === `project-${PROJECT.id}`).every(([, data]) => data === POINT_FEATURE_COLLECTION)).toBe(true);
  });

  it('filters project-linked markers and landmark collections without replacing their sources', () => {
    const data = { subsurfaceStations: POINT_FEATURE_COLLECTION, explorationLeads: POINT_FEATURE_COLLECTION, cylinderInstalls: POINT_FEATURE_COLLECTION };
    const props = { visibleOverlayGeoJsonData: data, visibleLandmarksGeoJSON: POINT_FEATURE_COLLECTION, mapDisplayPreferences: DEFAULT_DISPLAY, iconsLoaded: true, iconAvailability: ALL_ICONS };
    const { container, rerender } = render(<OverlayMapLayers {...props} activeProjectIds={new Set(['42'])} collectionVisibility={{ __personal__: false, hidden: false }} />);
    const sources = [...container.querySelectorAll('[data-source-id]')];
    expect(accepts(container, 'subsurface-stations-circles', { project: 42 })).toBe(true);
    expect(accepts(container, 'subsurface-stations-circles', { project: '42', type: 'biology' })).toBe(false);
    expect(accepts(container, 'subsurface-stations-biology-icons', { project: '42', type: 'biology' })).toBe(true);
    expect(accepts(container, 'cylinder-installs-labels', { project_id: '42' })).toBe(true);
    expect(accepts(container, 'exploration-leads-icon-layer', { project: 'other' })).toBe(false);
    for (const id of ['landmarks-layer', 'landmarks-labels']) {
      expect(accepts(container, id, {})).toBe(false);
      expect(accepts(container, id, { collection: null })).toBe(false);
      expect(accepts(container, id, { collection: 'hidden' })).toBe(false);
      expect(accepts(container, id, { collection: 42 })).toBe(true);
    }
    rerender(<OverlayMapLayers {...props} activeProjectIds={new Set()} collectionVisibility={{}} />);
    expect([...container.querySelectorAll('[data-source-id]')]).toEqual(sources);
    expect(accepts(container, 'subsurface-stations-circles', { project: 42 })).toBe(false);
    expect(accepts(container, 'landmarks-labels', {})).toBe(true);
  });

  it('keeps saved GPS geometry while visibility changes only its filter', () => {
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'track' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] };
    const props = { savedTrackFeatureCollection: data, currentTrackFeatureCollection: EMPTY_FEATURE_COLLECTION, recordingState: 'idle' as const };
    const { container, rerender } = render(<GpsMapLayers {...props} savedTrackVisibility={{ track: true }} />);
    const source = container.querySelector('[data-source-id="gps-tracks-source"]');
    expect(accepts(container, 'gps-tracks-line', { id: 'track' })).toBe(true);
    rerender(<GpsMapLayers {...props} savedTrackVisibility={{ track: false }} />);
    expect(container.querySelector('[data-source-id="gps-tracks-source"]')).toBe(source);
    expect(accepts(container, 'gps-tracks-line', { id: 'track' })).toBe(false);
  });
});
