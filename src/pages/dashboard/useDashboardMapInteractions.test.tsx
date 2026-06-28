import type { RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAP } from '../../constants';
import { allowConsoleWarn } from '../../test/consoleGuard';
import type { Project } from '../../types/project';
import { MAP_TOUCH_TAP_MAX_DURATION_MS } from './dashboardMapUtils';
import { useDashboardMapInteractions } from './useDashboardMapInteractions';

const { mockImpact } = vi.hoisted(() => ({ mockImpact: vi.fn() }));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Heavy: 'HEAVY' },
}));

const CANVAS_RECT = {
  left: 10,
  top: 20,
  right: 210,
  bottom: 220,
  width: 200,
  height: 200,
  x: 10,
  y: 20,
  toJSON: () => ({}),
} as DOMRect;

function pointerEvent(overrides: Record<string, unknown> = {}) {
  return {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 20,
    clientY: 30,
    type: 'pointerup',
    ...overrides,
  } as never;
}

function defaultMap(overrides: Record<string, unknown> = {}) {
  return {
    getCanvas: vi.fn(() => ({ getBoundingClientRect: () => CANVAS_RECT })),
    getLayer: vi.fn((id: string) => ({ id })),
    getZoom: vi.fn(() => MAP.MARKER_INTERACTION_MIN_ZOOM),
    queryRenderedFeatures: vi.fn(() => [{
      layer: { id: 'exploration-leads-icon-layer' },
      id: 'lead-1',
      properties: { description: 'continue' },
    }]),
    unproject: vi.fn(() => ({ lng: 2.3, lat: 46.6 })),
    ...overrides,
  };
}

function renderInteractions(map: Record<string, unknown>) {
  const clearProbedDepth = vi.fn();
  const sampleDepthAtClientPoint = vi.fn();
  const mapRef = {
    current: { getMap: () => map },
  } as unknown as RefObject<MapRef | null>;
  const hook = renderHook(() => useDashboardMapInteractions({
    mapRef,
    activeProjectIds: new Set(['project-1']),
    projects: [{ id: 'project-1', name: 'Deep Cave' } as Project],
    clearProbedDepth,
    sampleDepthAtClientPoint,
  }));
  return { ...hook, clearProbedDepth, sampleDepthAtClientPoint };
}

function tap(result: ReturnType<typeof renderInteractions>['result']) {
  act(() => result.current.handleMapGestureStart(pointerEvent({ type: 'pointerdown' })));
  act(() => result.current.handleMapGestureEnd(pointerEvent()));
}

describe('useDashboardMapInteractions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T12:00:00Z'));
    mockImpact.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens and clears marker details for a valid touch tap', () => {
    const map = defaultMap();
    const { result, clearProbedDepth, sampleDepthAtClientPoint, unmount } =
      renderInteractions(map);

    tap(result);

    expect(result.current.selectedMarkerDetail).toMatchObject({
      type: 'explorationLead',
      id: 'lead-1',
    });
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [[-16, -16], [36, 36]],
      expect.objectContaining({ layers: expect.any(Array) }),
    );
    expect(sampleDepthAtClientPoint).toHaveBeenCalledWith(20, 30);
    expect(clearProbedDepth).toHaveBeenCalledOnce();

    act(() => result.current.clearSelectedMarkerDetail());
    expect(result.current.selectedMarkerDetail).toBeNull();
    unmount();
  });

  it('fails closed for unavailable tap-query seams', () => {
    const missingCanvas = renderInteractions(defaultMap({
      getCanvas: vi.fn(() => undefined),
      getZoom: undefined,
    }));
    tap(missingCanvas.result);
    expect(missingCanvas.result.current.selectedMarkerDetail).toBeNull();
    missingCanvas.unmount();

    const missingQuery = renderInteractions(defaultMap({ queryRenderedFeatures: undefined }));
    tap(missingQuery.result);
    expect(missingQuery.result.current.selectedMarkerDetail).toBeNull();
    missingQuery.unmount();

    const noLayers = renderInteractions(defaultMap({ getLayer: vi.fn(() => null) }));
    tap(noLayers.result);
    expect(noLayers.result.current.selectedMarkerDetail).toBeNull();
    noLayers.unmount();

    const queryError = new Error('map query failed');
    allowConsoleWarn('[overlay-tap] queryRenderedFeatures error', queryError);
    const throwingQuery = renderInteractions(defaultMap({
      queryRenderedFeatures: vi.fn(() => { throw queryError; }),
    }));
    tap(throwingQuery.result);
    expect(throwingQuery.result.current.selectedMarkerDetail).toBeNull();
    throwingQuery.unmount();
  });

  it('shows the ring and opens a GPS detail after an empty-map pen long press', async () => {
    mockImpact.mockRejectedValueOnce(new Error('haptics unavailable'));
    const map = defaultMap({ getLayer: vi.fn(() => null) });
    const { result } = renderInteractions(map);

    act(() => result.current.handleMapGestureStart(pointerEvent({
      pointerType: 'pen', type: 'pointerdown', clientX: 40, clientY: 60,
    })));
    act(() => vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS));
    expect(result.current.longPressRing).toEqual({ x: 40, y: 60 });

    await act(async () => {
      vi.advanceTimersByTime(
        MAP.LONG_PRESS_DURATION_MS - MAP.LONG_PRESS_RING_REVEAL_DELAY_MS,
      );
      await Promise.resolve();
    });
    expect(result.current.longPressRing).toBeNull();
    expect(result.current.selectedMarkerDetail).toMatchObject({
      type: 'mapLongPress',
      gpsCoordinate: '46.6, 2.3',
    });
    expect(mockImpact).toHaveBeenCalledWith({ style: 'HEAVY' });
  });

  it('fails closed when empty-spot validation cannot establish a safe target', () => {
    const scenarios: Array<Record<string, unknown>> = [
      defaultMap({ queryRenderedFeatures: undefined }),
      defaultMap({ getZoom: vi.fn().mockReturnValueOnce(15).mockReturnValue(14) }),
      defaultMap({ getCanvas: vi.fn(() => ({ getBoundingClientRect: () => undefined })) }),
      defaultMap({ queryRenderedFeatures: vi.fn(() => { throw new Error('query'); }) }),
    ];

    for (const map of scenarios) {
      const { result, unmount } = renderInteractions(map);
      act(() => result.current.handleMapGestureStart(pointerEvent({ type: 'pointerdown' })));
      act(() => vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS));
      expect(result.current.longPressRing).toBeNull();
      act(() => result.current.handleMapGestureEnd(pointerEvent({ type: 'pointercancel' })));
      unmount();
    }
  });

  it('fails closed when long-press coordinate conversion is unavailable', () => {
    const missingUnproject = renderInteractions(defaultMap({
      getLayer: vi.fn(() => null),
      unproject: undefined,
    }));
    act(() => missingUnproject.result.current.handleMapGestureStart(
      pointerEvent({ type: 'pointerdown' }),
    ));
    act(() => vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS));
    expect(missingUnproject.result.current.selectedMarkerDetail).toBeNull();
    missingUnproject.unmount();

    const getCanvas = vi.fn()
      .mockReturnValueOnce({ getBoundingClientRect: () => CANVAS_RECT })
      .mockReturnValueOnce({ getBoundingClientRect: () => CANVAS_RECT })
      .mockReturnValueOnce({ getBoundingClientRect: () => undefined });
    const missingLongPressRect = renderInteractions(defaultMap({
      getLayer: vi.fn(() => null),
      getCanvas,
    }));
    act(() => missingLongPressRect.result.current.handleMapGestureStart(
      pointerEvent({ type: 'pointerdown' }),
    ));
    act(() => vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS));
    expect(missingLongPressRect.result.current.selectedMarkerDetail).toBeNull();
    missingLongPressRect.unmount();
  });

  it('rejects unrelated, cancelled, moved, distant, and stale gestures', () => {
    const { result, clearProbedDepth, sampleDepthAtClientPoint } =
      renderInteractions(defaultMap());

    act(() => result.current.handleMapGestureStart(pointerEvent({ pointerType: 'mouse' })));
    act(() => result.current.handleMapGestureMove(pointerEvent({ pointerId: 99 })));
    act(() => result.current.handleMapGestureEnd(pointerEvent({ pointerId: 99 })));

    act(() => result.current.handleMapGestureStart(pointerEvent({ type: 'pointerdown' })));
    act(() => result.current.handleMapGestureMove(pointerEvent({ clientX: 50, clientY: 60 })));
    act(() => result.current.handleMapGestureEnd(pointerEvent({ clientX: 50, clientY: 60 })));

    act(() => result.current.handleMapGestureStart(pointerEvent({ type: 'pointerdown' })));
    act(() => result.current.handleMapGestureEnd(pointerEvent({
      type: 'pointercancel',
    })));

    act(() => result.current.handleMapGestureStart(pointerEvent({ type: 'pointerdown' })));
    act(() => result.current.handleMapGestureEnd(pointerEvent({ clientX: 80, clientY: 90 })));

    vi.advanceTimersByTime(MAP_TOUCH_TAP_MAX_DURATION_MS + 1);
    act(() => result.current.handleMapGestureStart(pointerEvent({ type: 'pointerdown' })));
    vi.advanceTimersByTime(MAP_TOUCH_TAP_MAX_DURATION_MS + 1);
    act(() => result.current.handleMapGestureEnd(pointerEvent()));

    expect(result.current.selectedMarkerDetail).toBeNull();
    expect(clearProbedDepth).toHaveBeenCalled();
    expect(sampleDepthAtClientPoint).toHaveBeenCalled();
  });

  it('guards ring callbacks that were already queued when a gesture changed', () => {
    vi.useRealTimers();
    const callbacks: Array<() => void> = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    const { result, clearProbedDepth } = renderInteractions(defaultMap());

    act(() => result.current.handleMapGestureStart(pointerEvent({ type: 'pointerdown' })));
    act(() => result.current.handleMapGestureEnd(pointerEvent()));
    act(() => callbacks[0]());

    act(() => result.current.handleMapGestureStart(pointerEvent({
      type: 'pointerdown', pointerId: 2,
    })));
    act(() => result.current.handleMapGestureStart(pointerEvent({
      type: 'pointerdown', pointerId: 3,
    })));
    act(() => callbacks[2]());
    expect(clearProbedDepth).toHaveBeenCalled();

    act(() => result.current.handleMapGestureEnd(pointerEvent({
      type: 'pointercancel', pointerId: 3,
    })));
    act(() => result.current.handleMapGestureStart(pointerEvent({
      type: 'pointerdown', pointerId: 4,
    })));
    act(() => result.current.handleMapGestureMove(pointerEvent({
      pointerId: 4, clientX: 80, clientY: 90,
    })));
    act(() => callbacks[4]());

    expect(result.current.longPressRing).toBeNull();
  });
});
