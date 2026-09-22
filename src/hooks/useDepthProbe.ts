import { useCallback, useMemo, useRef, useState } from 'react';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { MapColorMode } from '../types/mapColorMode';
import type { InteractiveOverlayFeature } from '../utils/overlayMarkerDetails';
import { applyDepthLimit, isValidDepthLimit } from '../utils/depthLimit';
import {
  computeDepthDomain,
  mergeDepthDomains,
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

function getFirstDepth(features: InteractiveOverlayFeature[], layerIds: ReadonlySet<string>): number | null {
  for (const feature of features) {
    if (!feature.layer?.id || !layerIds.has(feature.layer.id)) continue;
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
  depthLimitFeet: number | null = null,
): UseDepthProbeResult {
  // A sample belongs to the exact source revision and eligible layers that were
  // queried. Hiding/reloading a project or leaving depth mode invalidates it;
  // restoring those settings cannot resurrect an old pointer reading.
  const probeContext = useMemo(() => ({
    geoJsonData,
    layerIds: new Set(projectGeometryLayerIds),
    colorMode,
  }), [colorMode, geoJsonData, projectGeometryLayerIds]);
  const [sample, setSample] = useState<{ depth: number; context: typeof probeContext } | null>(null);
  const lastSampleTimeRef = useRef(0);

  // Stage A: per-project domain cache — recomputes only when geoJsonData
  // changes (sync/reload), not on every project toggle.
  const projectDepthDomains = useMemo(() => {
    const domains: Record<string, DepthDomain | null> = {};
    for (const [projectId, fc] of Object.entries(geoJsonData)) {
      domains[projectId] = computeDepthDomain([fc]);
    }
    return domains;
  }, [geoJsonData]);

  // Stage B: merge cached domains for visible projects — O(projects) per toggle.
  const measuredDepthDomain = useMemo(() => {
    if (colorMode !== 'depth') return null;
    const activeDomains: (DepthDomain | null)[] = [];
    for (const projectId of activeProjectIds) {
      if (projectId in projectDepthDomains) {
        activeDomains.push(projectDepthDomains[projectId]);
      }
    }
    return mergeDepthDomains(activeDomains);
  }, [activeProjectIds, colorMode, projectDepthDomains]);
  const depthDomain = useMemo(
    () => applyDepthLimit(measuredDepthDomain, depthLimitFeet),
    [depthLimitFeet, measuredDepthDomain],
  );

  // Derive the exposed depth: mask the internal probe state when depth mode
  // is inactive or the domain is unavailable, avoiding a cascading-render
  // effect to clear it.
  const probedDepth = sample?.context === probeContext ? sample.depth : null;
  const effectiveProbedDepth = colorMode === 'depth' && depthDomain && probedDepth !== null
    ? depthLimitFeet !== null && isValidDepthLimit(depthLimitFeet)
      ? Math.min(probedDepth, depthLimitFeet)
      : probedDepth
    : null;

  const sampleDepthAtMapPoint = useCallback((
    point: { x: number; y: number },
    hitRadiusPx: number,
  ) => {
    if (colorMode !== 'depth') {
      setSample(null);
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
      setSample(null);
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
      setSample(null);
      return;
    }

    const depth = getFirstDepth(features, probeContext.layerIds);
    setSample(depth === null ? null : { depth, context: probeContext });
  }, [colorMode, mapRef, probeContext, projectGeometryLayerIds]);

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
    setSample(null);
  }, []);

  const handleMapMouseLeave = useCallback(() => {
    setSample(null);
  }, []);

  return {
    probedDepth: effectiveProbedDepth,
    depthDomain,
    clearProbedDepth,
    sampleDepthAtClientPoint,
    handleMapMouseMove,
    handleMapMouseLeave,
  };
}
