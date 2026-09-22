import { act, renderHook } from '@testing-library/react';
import type { MapRef } from 'react-map-gl/maplibre';
import { describe, expect, it, vi } from 'vitest';
import type { MapColorMode } from '../types/mapColorMode';
import { useDepthProbe } from './useDepthProbe';

function collection(depth: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { _speleoDepth: depth }, geometry: { type: 'Point', coordinates: [0, 0] } }],
  };
}

function setup() {
  const queryRenderedFeatures = vi.fn().mockReturnValue([
    { layer: { id: 'project-p1-line' }, properties: { _speleoDepth: 80 } },
  ]);
  const map = {
    queryRenderedFeatures,
    getLayer: vi.fn(() => ({})),
    getCanvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
  };
  const mapRef = { current: { getMap: () => map } } as unknown as React.RefObject<MapRef | null>;
  const initialProps = {
    mode: 'depth' as MapColorMode,
    active: new Set(['p1', 'p2']),
    data: { p1: collection(80), p2: collection(40) },
    layers: ['project-p1-line', 'project-p1-point', 'project-p2-line'],
    limit: null as number | null,
  };
  const hook = renderHook((props: typeof initialProps) => useDepthProbe(
    mapRef, props.mode, props.active, props.data, props.layers, props.limit,
  ), { initialProps });
  return { ...hook, initialProps, queryRenderedFeatures };
}

describe('useDepthProbe display limits', () => {
  it('uses a fixed scale and updates an active raw sample when the cap changes or clears', () => {
    const { result, rerender, initialProps, queryRenderedFeatures } = setup();
    act(() => result.current.sampleDepthAtClientPoint(20, 20));
    expect(result.current.probedDepth).toBe(80);
    rerender({ ...initialProps, limit: 20 });
    expect(result.current.depthDomain).toEqual({ min: 0, max: 20 });
    expect(result.current.probedDepth).toBe(20);
    rerender({ ...initialProps, limit: 120 });
    expect(result.current.depthDomain).toEqual({ min: 0, max: 120 });
    expect(result.current.probedDepth).toBe(80);
    rerender(initialProps);
    expect(result.current.depthDomain).toEqual({ min: 0, max: 80 });
    expect(result.current.probedDepth).toBe(80);
    expect(queryRenderedFeatures).toHaveBeenCalledTimes(1);
  });

  it('preserves negative sample readings with a positive cap', () => {
    const { result, rerender, initialProps, queryRenderedFeatures } = setup();
    queryRenderedFeatures.mockReturnValue([{ layer: { id: 'project-p1-line' }, properties: { _speleoDepth: -22 } }]);
    rerender({ ...initialProps, limit: 20 });
    act(() => result.current.sampleDepthAtClientPoint(20, 20));
    expect(result.current.probedDepth).toBe(-22);
  });

  it('discards a hidden project sample while another project still supplies a domain', () => {
    const { result, rerender, initialProps } = setup();
    act(() => result.current.sampleDepthAtClientPoint(20, 20));
    rerender({ ...initialProps, active: new Set(['p2']), layers: ['project-p2-line'] });
    expect(result.current.depthDomain).toEqual({ min: 0, max: 40 });
    expect(result.current.probedDepth).toBeNull();
    rerender(initialProps);
    expect(result.current.probedDepth).toBeNull();
  });

  it('discards stale samples after source replacement or a round trip through another color mode', () => {
    const { result, rerender, initialProps } = setup();
    act(() => result.current.sampleDepthAtClientPoint(20, 20));
    rerender({ ...initialProps, data: { ...initialProps.data, p1: collection(10) } });
    expect(result.current.depthDomain).toEqual({ min: 0, max: 40 });
    expect(result.current.probedDepth).toBeNull();
    act(() => result.current.sampleDepthAtClientPoint(20, 20));
    rerender({ ...initialProps, mode: 'project' });
    expect(result.current.probedDepth).toBeNull();
    rerender(initialProps);
    expect(result.current.probedDepth).toBeNull();
  });

  it('excludes hidden entrances from queries and does not resurrect their old reading', () => {
    const { result, rerender, initialProps, queryRenderedFeatures } = setup();
    queryRenderedFeatures.mockReturnValue([{ layer: { id: 'project-p1-point' }, properties: { _speleoDepth: 12 } }]);
    act(() => result.current.sampleDepthAtClientPoint(20, 20));
    expect(result.current.probedDepth).toBe(12);
    const layers = ['project-p1-line', 'project-p2-line'];
    rerender({ ...initialProps, layers });
    expect(result.current.probedDepth).toBeNull();
    act(() => result.current.sampleDepthAtClientPoint(20, 20));
    expect(queryRenderedFeatures).toHaveBeenLastCalledWith(expect.any(Array), { layers });
    expect(result.current.probedDepth).toBeNull();
  });

  it('keeps the configured scale through later loads but shows no domain without visible depth', () => {
    const { result, rerender, initialProps } = setup();
    rerender({ ...initialProps, limit: 100, data: { p1: collection(200), p2: collection(300) } });
    expect(result.current.depthDomain).toEqual({ min: 0, max: 100 });
    rerender({ ...initialProps, limit: 100, active: new Set() });
    expect(result.current.depthDomain).toBeNull();
    expect(result.current.probedDepth).toBeNull();
  });

  it('does not reread feature depths for limits or project visibility changes', () => {
    const { rerender, initialProps } = setup();
    const readDepth = vi.fn(() => 80);
    const data = { ...initialProps.data, p1: collection(80) };
    Object.defineProperty(data.p1.features[0].properties!, '_speleoDepth', { get: readDepth });
    rerender({ ...initialProps, data });
    const readsAfterLoad = readDepth.mock.calls.length;
    expect(readsAfterLoad).toBeGreaterThan(0);
    for (const limit of [20, 100, 0.04, null]) {
      rerender({ ...initialProps, data, limit });
    }
    rerender({ ...initialProps, data, active: new Set(['p2']), layers: ['project-p2-line'] });
    expect(readDepth).toHaveBeenCalledTimes(readsAfterLoad);
  });
});
