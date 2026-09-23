import { useLayoutEffect, useState } from 'react';
import { scheduleViewerUpdate, type ViewerUpdateScheduler } from '../utils/scheduleViewerUpdate';

/** Controls consume intent; expensive map consumers receive the latest painted intent. */
export function useAppliedViewerState<T>(
  intent: T,
  active = true,
  schedule: ViewerUpdateScheduler = scheduleViewerUpdate,
): T {
  const [applied, setApplied] = useState(intent);
  useLayoutEffect(() => {
    if (!active || Object.is(applied, intent)) return;
    return schedule(() => setApplied(() => intent));
  }, [active, applied, intent, schedule]);
  return applied;
}
