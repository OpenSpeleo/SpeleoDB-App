import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OfflineAreaList } from './OfflineAreaList';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps an overflow indicator, follows scrolling/resizing and releases observers on unmount', () => {
  let resize!: () => void;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const { container, unmount } = render(<OfflineAreaList><div>Area row</div></OfflineAreaList>);
  const viewport = screen.getByRole('region', { name: 'Offline areas' });
  const rail = container.querySelector<HTMLElement>('.offline-map-scroll-rail')!;
  const thumb = container.querySelector<HTMLElement>('.offline-map-scroll-thumb')!;
  expect(rail).not.toBeVisible();
  expect(observe.mock.calls.map(([element]) => element)).toEqual([viewport, viewport.firstElementChild]);
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 400 },
  });
  act(resize);
  expect(rail).toBeVisible();
  expect(thumb.style.height).toBe('25px');
  expect(thumb.style.transform).toBe('translateY(0px)');
  viewport.scrollTop = 150;
  fireEvent.scroll(viewport);
  expect(thumb.style.transform).toBe('translateY(37.5px)');
  // Overscroll must never push the indicator outside its rail.
  viewport.scrollTop = 500;
  fireEvent.scroll(viewport);
  expect(thumb.style.transform).toBe('translateY(75px)');
  Object.defineProperty(viewport, 'clientHeight', { value: 200 });
  act(resize);
  expect(thumb.style.height).toBe('100px');
  expect(thumb.style.transform).toBe('translateY(100px)');
  // Deleting rows or closing confirmation can remove overflow entirely.
  Object.defineProperty(viewport, 'scrollHeight', { value: 200 });
  act(resize);
  expect(rail).not.toBeVisible();
  const removeListener = vi.spyOn(viewport, 'removeEventListener');
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
});
