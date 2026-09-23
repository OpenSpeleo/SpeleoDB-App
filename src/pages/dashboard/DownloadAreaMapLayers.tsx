import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Layer, Source, type MapRef } from 'react-map-gl/maplibre';
import type { DownloadArea } from '../../types/downloadArea';
import { areaFeatureCollection } from '../../services/downloadAreaGeometry';
import { createGeoJSONLineWidth, GEOJSON_LINE_LAYOUT, GEOJSON_LINE_SOURCE_OPTIONS } from '../../utils/geojsonLineRendering';

const OUTLINE_WIDTH = createGeoJSONLineWidth(1.5);

/** Small procedural pattern, generated once per style, with no network asset. */
function registerDownloadAreaPattern(map: ReturnType<MapRef['getMap']>): void {
  if (map.hasImage('offline-area-stripes')) return;
  const width = 16;
  const data = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const stripe = (x + y) % 16 < 5;
      data.set(stripe ? [0, 0, 0, 45] : [0, 0, 0, 0], i);
    }
  map.addImage('offline-area-stripes', { width, height: width, data });
}

export function DownloadAreaMapLayers({
  areas,
  mapRef,
}: {
  areas: readonly DownloadArea[];
  mapRef: RefObject<MapRef | null>;
}) {
  const data = useMemo(() => areaFeatureCollection(areas), [areas]);
  const [patternReady, setPatternReady] = useState(false);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || typeof map.hasImage !== 'function') return;
    let alive = true;
    const register = () => {
      if (!map.isStyleLoaded()) return;
      registerDownloadAreaPattern(map);
      queueMicrotask(() => {
        if (alive) setPatternReady(true);
      });
    };
    register();
    const missing = ({ id }: { id: string }) => {
      if (id === 'offline-area-stripes') registerDownloadAreaPattern(map);
    };
    map.on('styledata', register);
    map.on('idle', register);
    map.on('styleimagemissing', missing);
    return () => {
      alive = false;
      map.off('styledata', register);
      map.off('idle', register);
      map.off('styleimagemissing', missing);
    };
  }, [mapRef, data]);
  return (
    <Source id="download-areas" type="geojson" data={data} {...GEOJSON_LINE_SOURCE_OPTIONS}>
      <Layer
        id="download-areas-fill"
        type="fill"
        paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 }}
      />
      <Layer
        id="download-areas-stripes"
        type="fill"
        paint={
          patternReady
            ? { 'fill-pattern': 'offline-area-stripes' }
            : { 'fill-opacity': 0 }
        }
      />
      <Layer
        id="download-areas-outline"
        type="line"
        layout={GEOJSON_LINE_LAYOUT}
        paint={{
          'line-color': ['get', 'color'],
          'line-width': OUTLINE_WIDTH,
          'line-opacity': 0.8,
        }}
      />
    </Source>
  );
}
