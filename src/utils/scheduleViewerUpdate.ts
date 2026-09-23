import { recordViewerWork } from './viewerWorkTiming';

export type ViewerUpdateScheduler = (work: () => void) => () => void;

/** Give the control a paint before applying non-urgent map or preference work. */
export const scheduleViewerUpdate: ViewerUpdateScheduler = (work) => {
  let cancelled = false;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (cancelled) return;
    cancelled = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    const startedAt = performance.now();
    try { work(); } finally { recordViewerWork('apply', startedAt); }
  };
  if (typeof requestAnimationFrame === 'function' && (typeof document === 'undefined' || !document.hidden)) {
    frame = requestAnimationFrame(() => {
      if (!cancelled) frame = requestAnimationFrame(run);
    });
    // Persistence must also progress if a WebView stops issuing frames.
    timer = setTimeout(run, 100);
  } else {
    timer = setTimeout(run, 0);
  }
  return () => {
    cancelled = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };
};
