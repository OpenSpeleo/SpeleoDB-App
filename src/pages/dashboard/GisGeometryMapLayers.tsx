import { visibleRecordsFilter } from '../../utils/viewerFilters';
import { Layer, Source } from 'react-map-gl/maplibre';
import { GIS_GEOMETRY_RENDER } from '../../gisGeometry/constants';
import { createGeoJSONLineWidth, GEOJSON_LINE_LAYOUT, GEOJSON_LINE_SOURCE_OPTIONS } from '../../utils/geojsonLineRendering';

const OUTLINE_WIDTH = createGeoJSONLineWidth(GIS_GEOMETRY_RENDER.OUTLINE_WIDTH);
const LINE_WIDTH = createGeoJSONLineWidth(GIS_GEOMETRY_RENDER.LINE_WIDTH);

export interface GisGeometryMapLayersProps {
  featureCollection: GeoJSON.FeatureCollection;
  visibility?: Readonly<Record<string, boolean>>;
}
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function GisGeometryMapLayers({ featureCollection = EMPTY, visibility }: Partial<GisGeometryMapLayersProps>) {
  return (
    <>
      <Source id="gis-geometry-order-source" type="geojson" data={EMPTY}>
        <Layer id="gis-geometry-order-anchor" type="circle" paint={{ 'circle-opacity': 0, 'circle-radius': 0 }} />
      </Source>
      <Source id="gis-geometries-source" type="geojson" data={featureCollection} {...GEOJSON_LINE_SOURCE_OPTIONS}>
        <Layer
          id="gis-geometries-fill" type="fill" beforeId="gis-geometry-order-anchor"
          filter={['all', ...(visibility ? [visibleRecordsFilter(visibility)] : []), ['==', ['geometry-type'], 'Polygon']]}
          paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': GIS_GEOMETRY_RENDER.FILL_OPACITY }}
        />
        <Layer
          id="gis-geometries-outline" type="line" beforeId="gis-geometry-order-anchor"
          filter={['all', ...(visibility ? [visibleRecordsFilter(visibility)] : []), ['==', ['geometry-type'], 'Polygon']]}
          layout={GEOJSON_LINE_LAYOUT}
          paint={{ 'line-color': ['get', 'color'], 'line-width': OUTLINE_WIDTH, 'line-opacity': GIS_GEOMETRY_RENDER.LINE_OPACITY }}
        />
        <Layer
          id="gis-geometries-line" type="line" beforeId="gis-geometry-order-anchor"
          filter={['all', ...(visibility ? [visibleRecordsFilter(visibility)] : []), ['==', ['geometry-type'], 'LineString']]}
          layout={GEOJSON_LINE_LAYOUT}
          paint={{ 'line-color': ['get', 'color'], 'line-width': LINE_WIDTH, 'line-opacity': GIS_GEOMETRY_RENDER.LINE_OPACITY }}
        />
      </Source>
    </>
  );
}
