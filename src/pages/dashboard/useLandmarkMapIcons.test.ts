import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useLandmarkMapIcons } from './useLandmarkMapIcons';

const createRegistry = vi.hoisted(() => vi.fn());
vi.mock('@speleodb/map-viewer/landmark-icons', () => ({ createLandmarkIconRegistry: createRegistry }));

describe('landmark image lifecycle adapter', () => {
  it('prepares latest source, publishes image readiness and disposes map ownership on unmount', () => {
    let onChange = () => {};
    let ids: readonly string[] = [];
    const registry = { prepare: vi.fn(async () => {}), getAvailableImageIds: () => ids, dispose: vi.fn() };
    createRegistry.mockImplementation((_map, changed) => { onChange = changed; return registry; });
    const map = {}, mapRef = { current: { getMap: () => map } } as unknown as RefObject<MapRef | null>;
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    const hook = renderHook(({ source }) => useLandmarkMapIcons(mapRef, source), { initialProps: { source: data } });
    act(() => hook.result.current.load());
    expect(registry.prepare).toHaveBeenLastCalledWith(data);
    act(() => { ids = ['cave-blue']; onChange(); });
    expect(hook.result.current.available).toEqual(['cave-blue']);
    const next: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { icon: 'CAVE', collection_color: '#123456' },
      geometry: { type: 'Point', coordinates: [1, 2] },
    }] };
    hook.rerender({ source: next });
    expect(registry.prepare).toHaveBeenLastCalledWith(next);
    hook.unmount();
    expect(registry.dispose).toHaveBeenCalledOnce();
    onChange();
  });
});
