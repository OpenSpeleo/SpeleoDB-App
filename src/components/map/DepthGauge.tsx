import React from 'react';
import type { DepthDomain } from '../../utils/depthColoring';
import { DEPTH_COLOR_STOPS, getDepthRatio } from '../../utils/depthColoring';
import type { MeasurementUnit } from '../../types/measurementUnit';
import { formatDepthValue } from '../../utils/measurementUnits';

interface DepthGaugeProps {
  depthDomain: DepthDomain | null;
  currentDepth: number | null;
  measurementUnit: MeasurementUnit;
}

const DEPTH_GAUGE_GRADIENT = `linear-gradient(to top, ${DEPTH_COLOR_STOPS
  // Map colors are emphasized with sqrt(depthRatio); project back onto
  // linear depth space so gauge position stays linear while colors remain non-linear.
  .map((stop) => `${stop.color} ${(stop.ratio ** 2 * 100).toFixed(2)}%`)
  .join(', ')})`;

const DepthGauge: React.FC<DepthGaugeProps> = React.memo(({ depthDomain, currentDepth, measurementUnit }) => {
  const hasDomain = Boolean(depthDomain);
  const hasProbedDepth = hasDomain && currentDepth !== null;

  const markerPositionPct = depthDomain && currentDepth !== null
    ? (1 - getDepthRatio(currentDepth, depthDomain)) * 100
    : null;

  const depthLabel = hasProbedDepth ? formatDepthValue(currentDepth, measurementUnit) : '';

  return (
    <div
      className="pointer-events-none select-none rounded-lg bg-slate-900/80 border border-slate-600/70 backdrop-blur-sm px-2 py-2 min-w-[74px]"
      data-testid="depth-gauge"
      aria-hidden="true"
    >
      <div className="text-[10px] font-semibold text-slate-100">Depth</div>
      <div className="text-xs text-slate-100 mt-1" data-testid="depth-gauge-current">
        {depthLabel || '\u00A0'}
      </div>
      <div className="mt-2 flex items-stretch gap-2">
        <div className="relative h-24 w-3 rounded-sm border border-slate-300/70 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{ background: DEPTH_GAUGE_GRADIENT }}
            data-testid="depth-gauge-gradient"
          />
          {markerPositionPct !== null && (
            <div
              className="absolute left-0 right-0 h-[2px] bg-white"
              style={{ top: `${markerPositionPct}%`, transform: 'translateY(-1px)' }}
              data-testid="depth-gauge-marker"
            />
          )}
        </div>
        <div
          className="h-24 flex flex-col justify-between text-[10px] leading-none text-slate-200"
          data-testid="depth-gauge-labels"
        >
          <div data-testid="depth-gauge-max" className="pt-[1px]">
            {depthDomain ? formatDepthValue(depthDomain.max, measurementUnit) : 'N/A'}
          </div>
          <div data-testid="depth-gauge-min" className="pb-[1px]">
            {depthDomain ? formatDepthValue(depthDomain.min, measurementUnit) : 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
});

DepthGauge.displayName = 'DepthGauge';

export default DepthGauge;
