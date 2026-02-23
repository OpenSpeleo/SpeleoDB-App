import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { MapColorMode } from '../types/mapColorMode';
import type { InteractiveOverlayFeature } from '../utils/overlayMarkerDetails';
import {
  computeDepthDomain,
  getFeatureDepth,
  type DepthDomain,
} from '../utils/depthColoring';

const DEPTH_PROBE_HIT_RADIUS_PX_MOUSE = 10;
const DEPTH_PROBE_HIT_RADIUS_PX_TOUCH = 18;
const DEPTH_SAMPLE_THROTTLE_MS = 16;

type DepthProbeQueryMap = {
  queryRenderedFeatures: (
    pointOrBox: { x: number; y: number } | [[number, number], [number, number]],
    options?: { layers?: string[] },
  ) => InteractiveOverlayFeature[];
  getCanvas: () => { getBoundingClientRect: () => DOMRect };
  getLayer: (id: string) => unknown;
};

function hitQueryBounds(
  point: { x: number; y: number },
  radiusPx: number,
): [[number, number], [number, number]] {
  return [
    [point.x - radiusPx, point.y - radiusPx],
    [point.x + radiusPx, point.y + radiusPx],
  ];
}

function getFirstDepth(features: InteractiveOverlayFeature[]): number | null {
  for (const feature of features) {
    const depth = getFeatureDepth(feature as unknown as GeoJSON.Feature);
    if (depth !== null) return depth;
  }
  return null;
}

export interface UseDepthProbeResult {
  probedDepth: number | null;
  depthDomain: DepthDomain | null;
  clearProbedDepth: () => void;
  sampleDepthAtClientPoint: (clientX: number, clientY: number) => void;
  handleMapMouseMove: (event: MapLayerMouseEvent) => void;
  handleMapMouseLeave: () => void;
}

export function useDepthProbe(
  mapRef: React.RefObject<MapRef | null>,
  colorMode: MapColorMode,
  activeProjectIds: Set<string>,
  geoJsonData: Record<string, GeoJSON.FeatureCollection>,
  projectGeometryLayerIds: string[],
): UseDepthProbeResult {
  const [probedDepth, setProbedDepth] = useState<number | null>(null);
  const lastSampleTimeRef = useRef(0);

  const depthDomain = useMemo(() => {
    if (colorMode !== 'depth') {
      return null;
    }
    const activeCollections: GeoJSON.FeatureCollection[] = [];
    for (const projectId of activeProjectIds) {
      const fc = geoJsonData[projectId];
      if (fc) activeCollections.push(fc);
    }
    return computeDepthDomain(activeCollections);
  }, [activeProjectIds, colorMode, geoJsonData]);

  useEffect(() => {
    if (colorMode !== 'depth' || !depthDomain) {
      setProbedDepth(null);
    }
  }, [colorMode, depthDomain]);

  const sampleDepthAtMapPoint = useCallback((
    point: { x: number; y: number },
    hitRadiusPx: number,
  ) => {
    if (colorMode !== 'depth') {
      setProbedDepth(null);
      return;
    }

    const map = mapRef.current?.getMap() as unknown as DepthProbeQueryMap | undefined;
    if (!map?.queryRenderedFeatures || !map.getLayer) {
      return;
    }

    const existingLayers = projectGeometryLayerIds.filter(
      (id) => map.getLayer(id) != null,
    );
    if (existingLayers.length === 0) {
      setProbedDepth(null);
      return;
    }

    let features: InteractiveOverlayFeature[];
    try {
      features = map.queryRenderedFeatures(
        hitQueryBounds(point, hitRadiusPx),
        { layers: existingLayers as string[] },
      );
    } catch {
      return;
    }

    if (!features || features.length === 0) {
      setProbedDepth(null);
      return;
    }

    setProbedDepth(getFirstDepth(features));
  }, [colorMode, mapRef, projectGeometryLayerIds]);

  const sampleDepthAtClientPoint = useCallback((
    clientX: number,
    clientY: number,
  ) => {
    const map = mapRef.current?.getMap() as unknown as DepthProbeQueryMap | undefined;
    const canvasRect = map?.getCanvas()?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }
    sampleDepthAtMapPoint({
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    }, DEPTH_PROBE_HIT_RADIUS_PX_TOUCH);
  }, [mapRef, sampleDepthAtMapPoint]);

  const handleMapMouseMove = useCallback((event: MapLayerMouseEvent) => {
    if (colorMode !== 'depth') {
      return;
    }
    const now = performance.now();
    if (now - lastSampleTimeRef.current < DEPTH_SAMPLE_THROTTLE_MS) {
      return;
    }
    lastSampleTimeRef.current = now;
    const { x, y } = event.point;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    sampleDepthAtMapPoint(
      { x, y },
      DEPTH_PROBE_HIT_RADIUS_PX_MOUSE,
    );
  }, [colorMode, sampleDepthAtMapPoint]);

  const clearProbedDepth = useCallback(() => {
    setProbedDepth(null);
  }, []);

  const handleMapMouseLeave = useCallback(() => {
    setProbedDepth(null);
  }, []);

  return {
    probedDepth,
    depthDomain,
    clearProbedDepth,
    sampleDepthAtClientPoint,
    handleMapMouseMove,
    handleMapMouseLeave,
  };
}
