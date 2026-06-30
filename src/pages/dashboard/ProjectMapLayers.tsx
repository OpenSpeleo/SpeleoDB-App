import { Layer, Source } from 'react-map-gl/maplibre';
import { PROJECT_LAYERS } from '../../constants';
import type { MapColorMode } from '../../types/mapColorMode';
import type { Project } from '../../types/project';
import {
  DEPTH_PROPERTY_KEY,
  createDepthColorExpression,
  type DepthDomain,
} from '../../utils/depthColoring';
import { getProjectColor } from '../../utils/projectColors';

export type ProjectGeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;

interface ProjectMapSourceProps {
  project: Project;
  data: GeoJSON.FeatureCollection;
  colorMode: MapColorMode;
  depthDomain: DepthDomain | null;
  projectColorsById: Record<string, string>;
}

function ProjectMapSource({
  project,
  data,
  colorMode,
  depthDomain,
  projectColorsById,
}: ProjectMapSourceProps) {
  const sourceId = `project-${project.id}`;
  const fallbackColor = getProjectColor(project.id, projectColorsById);
  const lineAndFillColor = colorMode === 'depth'
    ? createDepthColorExpression(depthDomain, fallbackColor, DEPTH_PROPERTY_KEY)
    : fallbackColor;

  return (
    <Source id={sourceId} type="geojson" data={data}>
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
        paint={{ 'line-color': lineAndFillColor, 'line-width': 2.5 }}
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
}

export interface ProjectMapLayersProps {
  projects: readonly Project[];
  activeProjectIds: ReadonlySet<string>;
  geoJsonData: ProjectGeoJsonRecord;
  projectColorsById: Record<string, string>;
  colorMode: MapColorMode;
  depthDomain: DepthDomain | null;
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
}: ProjectMapLayersProps) {
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
        if (!activeProjectIds.has(project.id) || !data) return null;
        return (
          <ProjectMapSource
            key={project.id}
            project={project}
            data={data}
            colorMode={colorMode}
            depthDomain={depthDomain}
            projectColorsById={projectColorsById}
          />
        );
      })}
    </>
  );
}
