import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';

/** Keep source credits and the optional dial clear of the actual map overlays. */
export function MapControlLayout({ compassVisible, depthMode, toolbarVisible }: {
  compassVisible: boolean;
  depthMode: boolean;
  toolbarVisible: boolean;
}) {
  const { current: map } = useMap();

  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    const corner = container.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-right');
    const root = container.closest('.dashboard-map-container');
    if (!corner || !root) return;
    const upperControls = [...root.querySelectorAll('.map-control-stack, .dashboard-map-depth-gauge')];
    const scale = root.querySelector('.dashboard-map-distance-scale');
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const updateLayout = () => {
      const mapBounds = container.getBoundingClientRect();
      const upperBounds = upperControls.map((control) => control.getBoundingClientRect());
      const scaleBounds = scale?.getBoundingClientRect();
      let right = 0;
      let bottom = 0;
      // Measure the unshifted stack so a larger map can reclaim its corner.
      corner.style.right = '0px';
      corner.style.bottom = '0px';
      // Reserving the scale row may bring the dial into an upper control's row.
      // Reservations only grow; these passes cover both upper columns + scale.
      for (let pass = 0; pass < 3; pass++) {
        for (const bounds of upperBounds) {
          if (overlaps(corner.getBoundingClientRect(), bounds)) {
            right = Math.max(right, mapBounds.right - bounds.left);
            corner.style.right = `${right}px`;
          }
        }
        if (scaleBounds && overlaps(corner.getBoundingClientRect(), scaleBounds)) {
          bottom = Math.max(bottom, mapBounds.bottom - scaleBounds.top);
          corner.style.bottom = `${bottom}px`;
        }
      }
    };
    let frame: number | null = null;
    // A layout write can resize wrapped credits. Defer observer work to the next
    // frame instead of writing into the current ResizeObserver delivery loop.
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateLayout();
      });
    });
    for (const element of [container, ...upperControls, scale, ...corner.children]) {
      if (element) observer.observe(element);
    }
    updateLayout();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      corner.style.removeProperty('right');
      corner.style.removeProperty('bottom');
    };
  }, [map, compassVisible, depthMode, toolbarVisible]);

  return null;
}
