import { FEET_TO_METERS } from './measurementUnits';

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MERCATOR_BASE_PIXEL_WIDTH = 256;
const MIN_SCALE_PIXEL_WIDTH = 48;
const MAX_SCALE_PIXEL_WIDTH = 112;

export interface DistanceScaleMetrics {
  distanceFeet: number;
  widthPx: number;
}

function getNiceDistance(maxDistance: number): number {
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(maxDistance));
  const fraction = maxDistance / magnitude;

  if (fraction >= 5) return 5 * magnitude;
  if (fraction >= 2) return 2 * magnitude;
  return magnitude;
}

export function computeDistanceScaleMetrics(
  zoom: number,
  latitude: number,
): DistanceScaleMetrics {
  const clampedLatitude = Math.max(-85, Math.min(85, latitude));
  const metersPerPixel = (
    EARTH_CIRCUMFERENCE_METERS * Math.cos((clampedLatitude * Math.PI) / 180)
  ) / (MERCATOR_BASE_PIXEL_WIDTH * (2 ** zoom));

  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return {
      distanceFeet: 0,
      widthPx: MIN_SCALE_PIXEL_WIDTH,
    };
  }

  const feetPerPixel = metersPerPixel / FEET_TO_METERS;
  const maxDistanceFeet = feetPerPixel * MAX_SCALE_PIXEL_WIDTH;
  const distanceFeet = getNiceDistance(maxDistanceFeet);
  const widthPx = Math.max(
    MIN_SCALE_PIXEL_WIDTH,
    Math.min(MAX_SCALE_PIXEL_WIDTH, distanceFeet / feetPerPixel),
  );

  return {
    distanceFeet,
    widthPx,
  };
}
