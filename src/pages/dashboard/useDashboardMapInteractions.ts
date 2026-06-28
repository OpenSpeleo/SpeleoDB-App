import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { MAP } from '../../constants';
import type { Project } from '../../types/project';
import {
  INTERACTIVE_OVERLAY_LAYER_IDS,
  formatLatLng,
} from '../../utils/overlayMarkerDetails';
import type {
  InteractiveOverlayFeature,
  MapLongPressDetails,
  MarkerParseContext,
  OverlayMarkerDetails,
} from '../../utils/overlayMarkerDetails';
import {
  LONG_PRESS_BLOCKING_STATIC_LAYER_IDS,
  MAP_MARKER_HIT_RADIUS_PX_TOUCH,
  MAP_TOUCH_TAP_MAX_DURATION_MS,
  MAP_TOUCH_TAP_MAX_MOVEMENT_PX,
  getClickedOverlayMarkerDetails,
  getMarkerHitQueryBounds,
  type MapPointerTapCandidate,
  type OverlayFeatureQueryMap,
} from './dashboardMapUtils';

export interface DashboardMapInteractionOptions {
  mapRef: RefObject<MapRef | null>;
  activeProjectIds: ReadonlySet<string>;
  projects: readonly Project[];
  clearProbedDepth: () => void;
  sampleDepthAtClientPoint: (clientX: number, clientY: number) => void;
}

export interface DashboardMapInteractionState {
  selectedMarkerDetail: OverlayMarkerDetails | null;
  clearSelectedMarkerDetail: () => void;
  longPressRing: { x: number; y: number } | null;
  handleMapGestureStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleMapGestureMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleMapGestureEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useDashboardMapInteractions({
  mapRef,
  activeProjectIds,
  projects,
  clearProbedDepth,
  sampleDepthAtClientPoint,
}: DashboardMapInteractionOptions): DashboardMapInteractionState {
  const pointerCandidateRef = useRef<MapPointerTapCandidate | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedMarkerDetail, setSelectedMarkerDetail] =
    useState<OverlayMarkerDetails | null>(null);
  const [longPressRing, setLongPressRing] = useState<{ x: number; y: number } | null>(null);

  const projectPointLayerIds = useMemo(
    () => [...activeProjectIds].map((id) => `project-${id}-point`),
    [activeProjectIds],
  );
  const allInteractiveLayerIds = useMemo(
    () => [...INTERACTIVE_OVERLAY_LAYER_IDS, ...projectPointLayerIds] as readonly string[],
    [projectPointLayerIds],
  );
  const longPressBlockingLayerIds = useMemo(
    () => [...LONG_PRESS_BLOCKING_STATIC_LAYER_IDS, ...projectPointLayerIds] as readonly string[],
    [projectPointLayerIds],
  );
  const markerParseContext = useMemo<MarkerParseContext>(() => {
    const projectNameByPointLayerId = new globalThis.Map<string, string>();
    for (const project of projects) {
      projectNameByPointLayerId.set(`project-${project.id}-point`, project.name);
    }
    return { projectNameByPointLayerId };
  }, [projects]);

  const openMarkerDetailsAtMapPoint = useCallback((
    point: { x: number; y: number },
    hitRadiusPx: number,
  ) => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.queryRenderedFeatures || !map.getLayer || !map.getZoom) return;

    const zoom = map.getZoom();
    if (!Number.isFinite(zoom) || zoom < MAP.MARKER_INTERACTION_MIN_ZOOM) return;

    const existingLayers = allInteractiveLayerIds.filter((id) => map.getLayer(id) != null);
    if (existingLayers.length === 0) return;

    let features: InteractiveOverlayFeature[];
    try {
      features = map.queryRenderedFeatures(
        getMarkerHitQueryBounds(point, hitRadiusPx),
        { layers: existingLayers as string[] },
      );
    } catch (error) {
      console.warn('[overlay-tap] queryRenderedFeatures error', error);
      return;
    }
    if (!features || features.length === 0) return;

    const details = getClickedOverlayMarkerDetails(
      features,
      allInteractiveLayerIds,
      markerParseContext,
    );
    if (details) setSelectedMarkerDetail(details);
  }, [allInteractiveLayerIds, mapRef, markerParseContext]);

  const openMarkerDetailsAtClientPoint = useCallback((
    clientX: number,
    clientY: number,
    hitRadiusPx: number,
  ) => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    const canvasRect = map?.getCanvas()?.getBoundingClientRect();
    if (!canvasRect) return;
    openMarkerDetailsAtMapPoint(
      { x: clientX - canvasRect.left, y: clientY - canvasRect.top },
      hitRadiusPx,
    );
  }, [mapRef, openMarkerDetailsAtMapPoint]);

  const openLongPressGpsDetail = useCallback((clientX: number, clientY: number) => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.getCanvas || !map.unproject) return;
    const canvasRect = map.getCanvas()?.getBoundingClientRect();
    if (!canvasRect) return;
    const lngLat = map.unproject({
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    });
    const detail: MapLongPressDetails = {
      type: 'mapLongPress',
      gpsCoordinate: formatLatLng(lngLat.lat, lngLat.lng),
      latitude: lngLat.lat,
      longitude: lngLat.lng,
    };
    setSelectedMarkerDetail(detail);
  }, [mapRef]);

  const isMarkerInteractionZoom = useCallback((): boolean => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.getZoom) return false;
    const zoom = map.getZoom();
    return Number.isFinite(zoom) && zoom >= MAP.MARKER_INTERACTION_MIN_ZOOM;
  }, [mapRef]);

  const isEmptyMapSpotAtClientPoint = useCallback((clientX: number, clientY: number): boolean => {
    const map = mapRef.current?.getMap() as unknown as OverlayFeatureQueryMap | undefined;
    if (!map?.queryRenderedFeatures || !map.getLayer || !map.getCanvas || !map.getZoom) {
      return false;
    }
    const zoom = map.getZoom();
    if (!Number.isFinite(zoom) || zoom < MAP.MARKER_INTERACTION_MIN_ZOOM) return false;

    const canvasRect = map.getCanvas()?.getBoundingClientRect();
    if (!canvasRect) return false;
    const mapPoint = {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top,
    };
    const existingLayers = longPressBlockingLayerIds.filter((id) => map.getLayer(id) != null);
    if (existingLayers.length === 0) return true;

    try {
      return map.queryRenderedFeatures(
        getMarkerHitQueryBounds(mapPoint, MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX),
        { layers: existingLayers as string[] },
      ).length === 0;
    } catch {
      return false;
    }
  }, [longPressBlockingLayerIds, mapRef]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (longPressRingTimerRef.current !== null) {
      clearTimeout(longPressRingTimerRef.current);
      longPressRingTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearLongPressTimer(), [clearLongPressTimer]);

  const handleMapGestureStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    clearLongPressTimer();
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      pointerCandidateRef.current = null;
      return;
    }

    const isMultiTouch = pointerCandidateRef.current !== null;
    pointerCandidateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startedAtMs: Date.now(),
      moved: false,
    };
    if (isMultiTouch) {
      setLongPressRing(null);
      clearProbedDepth();
      return;
    }

    sampleDepthAtClientPoint(event.clientX, event.clientY);
    if (!isMarkerInteractionZoom()) return;

    const { clientX, clientY, pointerId } = event;
    longPressRingTimerRef.current = setTimeout(() => {
      longPressRingTimerRef.current = null;
      const candidate = pointerCandidateRef.current;
      if (!candidate || candidate.pointerId !== pointerId || candidate.moved) return;
      if (isEmptyMapSpotAtClientPoint(clientX, clientY)) {
        setLongPressRing({ x: clientX, y: clientY });
      }
    }, MAP.LONG_PRESS_RING_REVEAL_DELAY_MS);
    longPressTimerRef.current = setTimeout(() => {
      clearLongPressTimer();
      longPressTimerRef.current = null;
      pointerCandidateRef.current = null;
      setLongPressRing(null);
      if (!isEmptyMapSpotAtClientPoint(clientX, clientY)) return;
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
      openLongPressGpsDetail(clientX, clientY);
    }, MAP.LONG_PRESS_DURATION_MS);
  }, [
    clearLongPressTimer,
    clearProbedDepth,
    isEmptyMapSpotAtClientPoint,
    isMarkerInteractionZoom,
    openLongPressGpsDetail,
    sampleDepthAtClientPoint,
  ]);

  const handleMapGestureMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const candidate = pointerCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - candidate.startClientX,
      event.clientY - candidate.startClientY,
    );
    if (distance > MAP_TOUCH_TAP_MAX_MOVEMENT_PX) {
      candidate.moved = true;
      clearLongPressTimer();
      setLongPressRing(null);
    }
    sampleDepthAtClientPoint(event.clientX, event.clientY);
  }, [clearLongPressTimer, sampleDepthAtClientPoint]);

  const handleMapGestureEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    clearLongPressTimer();
    setLongPressRing(null);
    const candidate = pointerCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;

    pointerCandidateRef.current = null;
    clearProbedDepth();
    if (event.type !== 'pointerup') return;

    const durationMs = Date.now() - candidate.startedAtMs;
    const distance = Math.hypot(
      event.clientX - candidate.startClientX,
      event.clientY - candidate.startClientY,
    );
    const isTap = !candidate.moved
      && distance <= MAP_TOUCH_TAP_MAX_MOVEMENT_PX
      && durationMs <= MAP_TOUCH_TAP_MAX_DURATION_MS;
    if (!isTap) return;

    openMarkerDetailsAtClientPoint(
      event.clientX,
      event.clientY,
      MAP_MARKER_HIT_RADIUS_PX_TOUCH,
    );
  }, [clearLongPressTimer, clearProbedDepth, openMarkerDetailsAtClientPoint]);

  const clearSelectedMarkerDetail = useCallback(() => setSelectedMarkerDetail(null), []);

  return {
    selectedMarkerDetail,
    clearSelectedMarkerDetail,
    longPressRing,
    handleMapGestureStart,
    handleMapGestureMove,
    handleMapGestureEnd,
  };
}
