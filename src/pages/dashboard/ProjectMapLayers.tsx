import { memo, useLayoutEffect, useState } from 'react';
import { scheduleViewerUpdate } from '../../utils/scheduleViewerUpdate';
import { Layer, Source } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { PROJECT_LAYERS } from '../../constants';
import type { MapColorMode } from '../../types/mapColorMode';
import type { Project } from '../../types/project';
import {
  DEPTH_PROPERTY_KEY,
  createDepthColorExpression,
  type DepthDomain,
} from '../../utils/depthColoring';
import { getProjectColor } from '../../utils/projectColors';
import { GEOJSON_LINE_LAYOUT, GEOJSON_LINE_SOURCE_OPTIONS } from '../../utils/geojsonLineRendering';

export type ProjectGeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;

interface ProjectMapSourceProps {
  project: Project;
  data: GeoJSON.FeatureCollection;
  colorMode: MapColorMode;
  depthDomain: DepthDomain | null;
  projectColorsById: Record<string, string>;
  showCaveEntrances: boolean;
  visible: boolean;
}

const ProjectMapSource = memo(function ProjectMapSource({
  project,
  data,
  colorMode,
  depthDomain,
  projectColorsById,
  showCaveEntrances,
  visible,
}: ProjectMapSourceProps) {
  const sourceId = `project-${project.id}`;
  const fallbackColor = getProjectColor(project.id, projectColorsById);
  const lineAndFillColor: ExpressionSpecification | string = colorMode === 'depth'
    ? createDepthColorExpression(depthDomain, fallbackColor, DEPTH_PROPERTY_KEY)
    : colorMode === 'shot'
      ? ['to-color', ['get', 'color'], fallbackColor]
      : fallbackColor;

  return (
    <Source id={sourceId} type="geojson" data={data} {...GEOJSON_LINE_SOURCE_OPTIONS}>
      <Layer
        id={`${sourceId}-fill`}
        type="fill"
        beforeId="project-layer-order-anchor"
        filter={[
          'match',
          ['geometry-type'],
          ['Polygon', 'MultiPolygon'],
          true,
          false,
        ]}
        layout={{ visibility: visible ? 'visible' : 'none' }}
        paint={{ 'fill-color': lineAndFillColor, 'fill-opacity': 0.25 }}
      />
      <Layer
        id={`${sourceId}-line`}
        type="line"
        beforeId="project-layer-order-anchor"
        minzoom={PROJECT_LAYERS.lineMinZoom}
        filter={[
          'match',
          ['geometry-type'],
          ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
          true,
          false,
        ]}
        layout={{ ...GEOJSON_LINE_LAYOUT, visibility: visible ? 'visible' : 'none' }}
        paint={{ 'line-color': lineAndFillColor, 'line-width': PROJECT_LAYERS.lineWidth }}
      />
      <Layer
        id={`${sourceId}-point`}
        type="symbol"
        beforeId="project-layer-order-anchor"
        filter={[
          'match',
          ['geometry-type'],
          ['Point', 'MultiPoint'],
          true,
          false,
        ]}
        minzoom={PROJECT_LAYERS.entrySymbolMinZoom}
        layout={{
          visibility: visible && showCaveEntrances ? 'visible' : 'none',
          'text-field': '★',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': PROJECT_LAYERS.entrySymbolTextSize,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'text-color': '#F5E027',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        }}
      />
    </Source>
  );
});

export interface ProjectMapLayersProps {
  projects: readonly Project[];
  activeProjectIds: ReadonlySet<string>;
  geoJsonData: ProjectGeoJsonRecord;
  projectColorsById: Record<string, string>;
  colorMode: MapColorMode;
  depthDomain: DepthDomain | null;
  showCaveEntrances: boolean;
  runtimeActive?: boolean;
}

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function ProjectMapLayers({
  projects,
  activeProjectIds,
  geoJsonData,
  projectColorsById,
  colorMode,
  depthDomain,
  showCaveEntrances,
  runtimeActive = true,
}: ProjectMapLayersProps) {
  // Keep previously displayed sources mounted, but never eagerly admit hidden data.
  // Four first-time sources per painted turn bounds Show all and startup work.
  const [admitted, setAdmitted] = useState(() => new Set(projects
    .filter(project => activeProjectIds.has(project.id) && geoJsonData[project.id])
    .slice(0, 4).map(project => project.id)));
  useLayoutEffect(() => {
    if (!runtimeActive) return;
    const retained = [...admitted].filter(id => geoJsonData[id]);
    const next = projects.filter(project => activeProjectIds.has(project.id)
      && geoJsonData[project.id] && !admitted.has(project.id)).slice(0, 4);
    if (!next.length && retained.length === admitted.size) return;
    return scheduleViewerUpdate(() => setAdmitted(new Set([...retained, ...next.map(project => project.id)])));
  }, [activeProjectIds, admitted, geoJsonData, projects, runtimeActive]);
  return (
    <>
      <Source
        id="project-layer-order-anchor-source"
        type="geojson"
        data={EMPTY_FEATURE_COLLECTION}
      >
        <Layer
          id="project-layer-order-anchor"
          type="circle"
          paint={{ 'circle-opacity': 0, 'circle-radius': 0 }}
        />
      </Source>
      {projects.map((project) => {
        const data = geoJsonData[project.id];
        if (!admitted.has(project.id) || !data) return null;
        return (
          <ProjectMapSource
            key={project.id}
            project={project}
            visible={activeProjectIds.has(project.id)}
            data={data}
            colorMode={colorMode}
            depthDomain={depthDomain}
            projectColorsById={projectColorsById}
            showCaveEntrances={showCaveEntrances}
          />
        );
      })}
    </>
  );
}
