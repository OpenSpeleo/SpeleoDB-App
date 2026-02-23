import React, { useMemo } from 'react';
import type { MeasurementUnit } from '../../types/measurementUnit';
import { FEET_TO_METERS, formatDistanceValue } from '../../utils/measurementUnits';

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

interface DistanceScaleProps {
  zoom: number;
  latitude: number;
  measurementUnit: MeasurementUnit;
}

const DistanceScale: React.FC<DistanceScaleProps> = React.memo(({ zoom, latitude, measurementUnit }) => {
  const metrics = useMemo(
    () => computeDistanceScaleMetrics(zoom, latitude),
    [zoom, latitude],
  );
  const label = useMemo(
    () => formatDistanceValue(metrics.distanceFeet, measurementUnit),
    [metrics.distanceFeet, measurementUnit],
  );

  return (
    <div
      className="pointer-events-none select-none"
      data-testid="distance-scale"
      aria-hidden="true"
    >
      <div className="rounded bg-slate-900/75 backdrop-blur-sm px-2 py-1 border border-slate-500/70">
        <div className="text-[10px] leading-none text-slate-100 mb-1">{label}</div>
        <div
          className="h-1.5 border-l border-r border-b border-slate-100"
          style={{ width: `${metrics.widthPx}px` }}
        />
      </div>
    </div>
  );
});

DistanceScale.displayName = 'DistanceScale';

export default DistanceScale;
