import React, { useMemo } from 'react';
import type { MeasurementUnit } from '../../types/measurementUnit';
import { formatDistanceValue } from '../../utils/measurementUnits';
import { computeDistanceScaleMetrics } from '../../utils/distanceScale';

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
