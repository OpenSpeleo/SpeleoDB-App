import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleViewerUpdate } from './scheduleViewerUpdate';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('scheduleViewerUpdate', () => {
  it('allows a frame to paint before work and releases the fallback timer', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => frames.push(callback)));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const work = vi.fn();
    scheduleViewerUpdate(work);
    expect(work).not.toHaveBeenCalled();
    frames.shift()!(0);
    expect(work).not.toHaveBeenCalled();
    frames.shift()!(16);
    expect(work).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels both frames and timers and falls back when a WebView stops painting', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => frames.push(callback)));
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const stale = vi.fn();
    scheduleViewerUpdate(stale)();
    frames.shift()!(0);
    vi.advanceTimersByTime(100);
    expect(stale).not.toHaveBeenCalled();
    const latest = vi.fn();
    scheduleViewerUpdate(latest);
    vi.advanceTimersByTime(100);
    expect(latest).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalled();
  });

  it('uses a cancellable task for hidden documents without blocking persistence', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const work = vi.fn();
    scheduleViewerUpdate(work);
    expect(work).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(work).toHaveBeenCalledOnce();
  });
});
