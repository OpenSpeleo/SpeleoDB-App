import { createPaintScheduler } from '@speleodb/map-viewer/update-scheduler';
import { recordViewerWork } from './viewerWorkTiming';

export type ViewerUpdateScheduler = (work: () => void) => () => void;

const afterControlPaint = createPaintScheduler({
  afterPaintTask: false,
  // Persistence must also progress if a WebView stops issuing frames.
  fallbackMs: 100,
  canUseFrames: () => typeof requestAnimationFrame === 'function'
    && (typeof document === 'undefined' || !document.hidden),
});

/** Mobile owns its timing instrumentation and background-persistence policy. */
export const scheduleViewerUpdate: ViewerUpdateScheduler = work => afterControlPaint(() => {
  const startedAt = performance.now();
  try { work(); } finally { recordViewerWork('apply', startedAt); }
});
