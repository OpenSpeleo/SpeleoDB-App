import { createVectorOverlayLayers } from '@speleodb/map-viewer';
import { visibleRecordsFilter } from '../../utils/viewerFilters';
import { Layer, Source } from 'react-map-gl/maplibre';
import { GIS_GEOMETRY_RENDER } from '../../gisGeometry/constants';
import { createGeoJSONLineWidth, GEOJSON_LINE_SOURCE_OPTIONS } from '../../utils/geojsonLineRendering';

const OUTLINE_WIDTH = createGeoJSONLineWidth(GIS_GEOMETRY_RENDER.OUTLINE_WIDTH);
const LINE_WIDTH = createGeoJSONLineWidth(GIS_GEOMETRY_RENDER.LINE_WIDTH);

export interface GisGeometryMapLayersProps {
  featureCollection: GeoJSON.FeatureCollection;
  visibility?: Readonly<Record<string, boolean>>;
}
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function GisGeometryMapLayers({ featureCollection = EMPTY, visibility }: Partial<GisGeometryMapLayersProps>) {
  const layers = createVectorOverlayLayers({
    sourceId: 'gis-geometries-source',
    layerIds: { fill: 'gis-geometries-fill', outline: 'gis-geometries-outline', line: 'gis-geometries-line' },
    color: ['get', 'color'], fillOpacity: GIS_GEOMETRY_RENDER.FILL_OPACITY,
    lineOpacity: GIS_GEOMETRY_RENDER.LINE_OPACITY, lineWidth: LINE_WIDTH, outlineWidth: OUTLINE_WIDTH,
    filterForGeometry: type => ['all', ...(visibility ? [visibleRecordsFilter(visibility)] : []), ['==', ['geometry-type'], type]],
  });
  return (
    <>
      <Source id="gis-geometry-order-source" type="geojson" data={EMPTY}>
        <Layer id="gis-geometry-order-anchor" type="circle" paint={{ 'circle-opacity': 0, 'circle-radius': 0 }} />
      </Source>
      <Source id="gis-geometries-source" type="geojson" data={featureCollection} {...GEOJSON_LINE_SOURCE_OPTIONS}>
        {layers.map(layer => <Layer key={layer.id} {...layer} beforeId="gis-geometry-order-anchor" />)}
      </Source>
    </>
  );
}
