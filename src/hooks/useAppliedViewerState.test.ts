import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppliedViewerState } from './useAppliedViewerState';

function scheduler() {
  const pending = new Set<() => void>();
  return {
    pending,
    schedule: (work: () => void) => { pending.add(work); return () => { pending.delete(work); }; },
    paint: () => { const work = [...pending]; pending.clear(); work.forEach(callback => callback()); },
  };
}

describe('useAppliedViewerState', () => {
  it('keeps control intent urgent and coalesces reversals into the latest applied snapshot', () => {
    const clock = scheduler();
    const { result, rerender } = renderHook(({ intent }) => ({
      control: intent,
      map: useAppliedViewerState(intent, true, clock.schedule),
    }), { initialProps: { intent: 'project' } });
    rerender({ intent: 'depth' });
    expect(result.current).toEqual({ control: 'depth', map: 'project' });
    rerender({ intent: 'shot' });
    expect(clock.pending.size).toBe(1);
    act(clock.paint);
    expect(result.current).toEqual({ control: 'shot', map: 'shot' });
    expect(clock.pending.size).toBe(0);
  });

  it('cancels pending application during suspension and unmount, resuming only the newest intent', () => {
    const clock = scheduler();
    const { result, rerender, unmount } = renderHook(({ intent, active }) => (
      useAppliedViewerState(intent, active, clock.schedule)
    ), { initialProps: { intent: 1, active: true } });
    rerender({ intent: 2, active: true });
    rerender({ intent: 3, active: false });
    expect(clock.pending.size).toBe(0);
    act(clock.paint);
    expect(result.current).toBe(1);
    rerender({ intent: 4, active: true });
    act(clock.paint);
    expect(result.current).toBe(4);
    rerender({ intent: 5, active: true });
    unmount();
    expect(clock.pending.size).toBe(0);
  });
});
