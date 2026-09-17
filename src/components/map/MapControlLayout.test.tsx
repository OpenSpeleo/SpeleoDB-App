import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapControlLayout } from './MapControlLayout';

const context = vi.hoisted(() => ({ current: undefined as undefined | { getContainer(): HTMLElement } }));
vi.mock('react-map-gl/maplibre', () => ({ useMap: () => context }));

describe('MapControlLayout ownership', () => {
  const observers: Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const frames = new Map<number, FrameRequestCallback>();
  let root: HTMLElement;
  let container: HTMLElement;
  let corner: HTMLElement;
  let toolbar: HTMLElement;
  let scale: HTMLElement;
  let mapWidth: number;
  let mapHeight: number;
  let stackHeight: number;
  let frameId: number;

  beforeEach(() => {
    observers.length = 0;
    frames.clear();
    frameId = 0;
    mapWidth = 400;
    mapHeight = 400;
    stackHeight = 230;
    root = document.createElement('div');
    root.className = 'dashboard-map-container';
    root.innerHTML = '<div class="map"><div class="maplibregl-ctrl-bottom-right"><div class="maplibregl-ctrl-attrib"></div></div></div><div class="map-control-stack"></div><div class="dashboard-map-distance-scale"></div>';
    document.body.append(root);
    container = root.querySelector<HTMLElement>('.map')!;
    corner = root.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-right')!;
    toolbar = root.querySelector<HTMLElement>('.map-control-stack')!;
    scale = root.querySelector<HTMLElement>('.dashboard-map-distance-scale')!;
    container.getBoundingClientRect = () => new DOMRect(0, 0, mapWidth, mapHeight);
    toolbar.getBoundingClientRect = () => new DOMRect(mapWidth - 56, 0, 44, 212);
    scale.getBoundingClientRect = () => new DOMRect(8, mapHeight - 38, 110, 30);
    corner.getBoundingClientRect = () => new DOMRect(
      mapWidth - 200 - Number.parseFloat(corner.style.right || '0'),
      mapHeight - stackHeight - Number.parseFloat(corner.style.bottom || '0'),
      200, stackHeight,
    );
    context.current = { getContainer: () => container };
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(readonly callback: () => void) { observers.push(this); }
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  });

  afterEach(() => {
    root.remove();
    vi.unstubAllGlobals();
  });

  const flushResize = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });

  it('reserves actual overlay columns and the scale row, then reclaims space on resize', () => {
    const gauge = document.createElement('div');
    gauge.className = 'dashboard-map-depth-gauge';
    gauge.getBoundingClientRect = () => new DOMRect(mapWidth - 150, 64, 74, 157);
    root.append(gauge);
    const view = render(<MapControlLayout toolbarVisible compassVisible depthMode />);
    expect(corner.style.right).toBe('150px');
    expect(corner.style.bottom).toBe('38px');
    expect(observers[0].observe.mock.calls.flat()).toEqual([
      container, toolbar, gauge, scale, corner.firstElementChild,
    ]);

    mapWidth = 800;
    mapHeight = 800;
    observers[0].callback();
    observers[0].callback();
    expect(frames.size).toBe(1);
    flushResize();
    expect(corner.style.right).toBe('0px');
    expect(corner.style.bottom).toBe('0px');
    view.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(corner.style.right).toBe('');
    expect(corner.style.bottom).toBe('');
  });

  it('retains attribution ownership with the compass hidden and replaces observed overlays on mode changes', () => {
    mapHeight = 220;
    stackHeight = 24;
    const view = render(<MapControlLayout toolbarVisible compassVisible={false} depthMode={false} />);
    expect(corner.style.right).toBe('56px');
    observers[0].callback();
    const gauge = document.createElement('div');
    gauge.className = 'dashboard-map-depth-gauge';
    gauge.getBoundingClientRect = () => new DOMRect(250, 64, 74, 157);
    root.append(gauge);
    view.rerender(<MapControlLayout toolbarVisible compassVisible={false} depthMode />);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(observers[1].observe).toHaveBeenCalledWith(gauge);
    expect(corner.style.right).toBe('150px');
    expect(corner.style.bottom).toBe('38px');
    view.unmount();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
  });

  it('does not allocate observers without a mounted map or control corner', () => {
    context.current = undefined;
    const view = render(<MapControlLayout toolbarVisible compassVisible={false} depthMode={false} />);
    expect(observers).toHaveLength(0);
    context.current = { getContainer: () => container };
    corner.remove();
    view.rerender(<MapControlLayout toolbarVisible compassVisible depthMode={false} />);
    expect(observers).toHaveLength(0);
    view.unmount();
  });

  it('observes the replacement toolbar after area editing with the compass already hidden', () => {
    stackHeight = 24;
    const view = render(<MapControlLayout toolbarVisible compassVisible={false} depthMode={false} />);
    toolbar.remove();
    view.rerender(<MapControlLayout toolbarVisible={false} compassVisible={false} depthMode={false} />);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(observers[1].observe).not.toHaveBeenCalledWith(toolbar);
    const replacement = document.createElement('div');
    replacement.className = 'map-control-stack';
    replacement.getBoundingClientRect = () => new DOMRect(mapWidth - 56, 0, 44, 212);
    root.append(replacement);
    view.rerender(<MapControlLayout toolbarVisible compassVisible={false} depthMode={false} />);
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
    expect(observers[2].observe).toHaveBeenCalledWith(replacement);
    mapHeight = 220;
    observers[2].callback();
    flushResize();
    expect(corner.style.right).toBe('56px');
    view.unmount();
  });
});
