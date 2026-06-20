import React from 'react';

export interface LongPressRingProps {
  /** Viewport coordinates (px) of the touch point. */
  x: number;
  y: number;
  /** Fill duration; usually the remaining hold time after the reveal delay. */
  durationMs: number;
  sizePx: number;
  strokePx: number;
}

/**
 * Circular loading ring rendered at the touch point while the user holds an
 * empty spot on the map. It fills from 0% to 100% over `durationMs`; when the
 * long-press timer completes the Map Point modal opens.
 *
 * Purely presentational and non-interactive, and driven entirely by a CSS
 * keyframe animation (no React state) so it never schedules an async update.
 * Mounted after a short intent delay and unmounted on cancel/complete, so a
 * fresh mount restarts the fill each press.
 */
const LongPressRing: React.FC<LongPressRingProps> = ({ x, y, durationMs, sizePx, strokePx }) => {
  const radius = (sizePx - strokePx) / 2;
  const circumference = 2 * Math.PI * radius;
  const animationName = 'speleodb-long-press-fill';

  return (
    <div
      data-testid="long-press-ring"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: x - sizePx / 2,
        top: y - sizePx / 2,
        width: sizePx,
        height: sizePx,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      <style>
        {`@keyframes ${animationName} { from { stroke-dashoffset: ${circumference}px; } to { stroke-dashoffset: 0; } }`}
      </style>
      <svg width={sizePx} height={sizePx} viewBox={`0 0 ${sizePx} ${sizePx}`}>
        <circle
          cx={sizePx / 2}
          cy={sizePx / 2}
          r={radius}
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.35)"
          strokeWidth={strokePx}
        />
        <circle
          data-testid="long-press-ring-progress"
          cx={sizePx / 2}
          cy={sizePx / 2}
          r={radius}
          fill="none"
          stroke="#a855f7"
          strokeWidth={strokePx}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
          transform={`rotate(-90 ${sizePx / 2} ${sizePx / 2})`}
          style={{
            animation: `${animationName} ${durationMs}ms linear forwards`,
          }}
        />
      </svg>
    </div>
  );
};

export default LongPressRing;
