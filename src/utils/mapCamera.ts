import type { FitBoundsOptions, LngLatBoundsLike } from 'maplibre-gl';
import type { MapRef } from 'react-map-gl/maplibre';
import { computeCameraPadding } from '@speleodb/map-viewer/camera-padding';

/** Shared camera behavior when selecting an item in a map panel. */
export function zoomToMapBounds(
  map: MapRef,
  bounds: LngLatBoundsLike,
  panel?: HTMLElement | null,
): void {
  let padding: FitBoundsOptions['padding'] = 60;
  if (panel) {
    const viewport = map.getContainer().getBoundingClientRect();
    const panelTop = panel.getBoundingClientRect().top;
    const visibleHeight = Math.min(viewport.height, Math.max(0, panelTop - viewport.top));
    if (viewport.width > 0 && visibleHeight > 0) {
      // Leave useful fitting space even when a short viewport needs smaller margins.
      padding = computeCameraPadding(viewport, {
        left: viewport.left,
        right: viewport.right,
        top: viewport.top,
        bottom: viewport.top + visibleHeight,
      }, { padding: 60, marginRatio: 0.25 });
    }
  }
  map.fitBounds(bounds, { padding, maxZoom: 16, duration: 800 });
}
