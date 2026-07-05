import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppForeground, type AppStatePort } from './useAppForeground';

describe('useAppForeground', () => {
  it('publishes initial and event-driven activity and removes its listener', async () => {
    let listener: ((state: { isActive: boolean }) => void) | null = null;
    const remove = vi.fn(async () => undefined);
    const app: AppStatePort = {
      getState: vi.fn(async () => ({ isActive: false })),
      addListener: vi.fn(async (_name, nextListener) => {
        listener = nextListener;
        return { remove };
      }),
    };
    const { result, unmount } = renderHook(() => useAppForeground(app));
    await waitFor(() => expect(result.current).toBe(false));
    act(() => listener?.({ isActive: true }));
    expect(result.current).toBe(true);
    unmount();
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  });

  it('lets a newer app-state event win over a delayed initial read', async () => {
    let resolveState!: (state: { isActive: boolean }) => void;
    let listener: ((state: { isActive: boolean }) => void) | null = null;
    const app: AppStatePort = {
      getState: () => new Promise((resolve) => { resolveState = resolve; }),
      addListener: vi.fn(async (_name, nextListener) => {
        listener = nextListener;
        return { remove: vi.fn(async () => undefined) };
      }),
    };
    const { result } = renderHook(() => useAppForeground(app));
    await waitFor(() => expect(listener).not.toBeNull());
    act(() => listener?.({ isActive: false }));
    await act(async () => resolveState({ isActive: true }));
    expect(result.current).toBe(false);
  });
});
