import { Layer, Source } from 'react-map-gl/maplibre';
import { GIS_GEOMETRY_RENDER } from '../../gisGeometry/constants';

export interface GisGeometryMapLayersProps {
  featureCollection: GeoJSON.FeatureCollection;
}
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function GisGeometryMapLayers({ featureCollection = EMPTY }: Partial<GisGeometryMapLayersProps>) {
  return (
    <>
      <Source id="gis-geometry-order-source" type="geojson" data={EMPTY}>
        <Layer id="gis-geometry-order-anchor" type="circle" paint={{ 'circle-opacity': 0, 'circle-radius': 0 }} />
      </Source>
      <Source id="gis-geometries-source" type="geojson" data={featureCollection}>
        <Layer
          id="gis-geometries-fill" type="fill" beforeId="gis-geometry-order-anchor"
          filter={['==', ['geometry-type'], 'Polygon']}
          paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': GIS_GEOMETRY_RENDER.FILL_OPACITY }}
        />
        <Layer
          id="gis-geometries-outline" type="line" beforeId="gis-geometry-order-anchor"
          filter={['==', ['geometry-type'], 'Polygon']}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': GIS_GEOMETRY_RENDER.OUTLINE_WIDTH, 'line-opacity': GIS_GEOMETRY_RENDER.LINE_OPACITY }}
        />
        <Layer
          id="gis-geometries-line" type="line" beforeId="gis-geometry-order-anchor"
          filter={['==', ['geometry-type'], 'LineString']}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': GIS_GEOMETRY_RENDER.LINE_WIDTH, 'line-opacity': GIS_GEOMETRY_RENDER.LINE_OPACITY }}
        />
      </Source>
    </>
  );
}
