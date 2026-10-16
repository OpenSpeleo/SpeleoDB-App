import { normalizeLandmarkIcon, safeHexColor, type LandmarkIcon } from '@speleodb/map-core';
import { LANDMARK_ICON_URLS } from '@speleodb/map-viewer/landmark-icons';
import { COLORS } from '../constants';

/** Shared monochrome artwork stays tinted by the collection, including offline. */
export function LandmarkIconPreview({ icon, color }: { icon?: LandmarkIcon; color?: string }) {
  const mask = `url("${LANDMARK_ICON_URLS[normalizeLandmarkIcon(icon)]}") center / contain no-repeat`;
  return <span aria-hidden="true" className="inline-block w-7 h-7 shrink-0" style={{
    backgroundColor: safeHexColor(color, COLORS.FALLBACK), mask, WebkitMask: mask,
  }} />;
}
