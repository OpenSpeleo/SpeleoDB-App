import { useLayoutEffect } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HeadingProvider } from '../services/DeviceHeadingService';
import { useDeviceHeading } from './useDeviceHeading';

class TestHeadingProvider implements HeadingProvider {
  private readonly listeners = new Set<(heading: number | null) => void>();

  subscribe(listener: (heading: number | null) => void) {
    this.listeners.add(listener);
    listener(null);
    return () => { this.listeners.delete(listener); };
  }

  emit(heading: number) {
    for (const listener of this.listeners) listener(heading);
  }
}

function CommitProbe({ active, provider, onCommit }: {
  active: boolean;
  provider: HeadingProvider;
  onCommit: (heading: number | null) => void;
}) {
  const heading = useDeviceHeading(active, provider);
  // Capture each committed value before passive subscription effects run.
  useLayoutEffect(() => { onCommit(heading); }, [heading, onCommit]);
  return <span>{heading === null ? 'unavailable' : heading}</span>;
}

describe('useDeviceHeading activation', () => {
  it('never commits a previous session heading when reactivated before fresh sensor data', () => {
    const provider = new TestHeadingProvider();
    const onCommit = vi.fn();
    const view = render(<CommitProbe active provider={provider} onCommit={onCommit} />);
    act(() => provider.emit(260));
    expect(onCommit).toHaveBeenLastCalledWith(260);
    view.rerender(<CommitProbe active={false} provider={provider} onCommit={onCommit} />);
    expect(onCommit).toHaveBeenLastCalledWith(null);
    onCommit.mockClear();
    view.rerender(<CommitProbe active provider={provider} onCommit={onCommit} />);
    expect(onCommit.mock.calls.flat()).not.toContain(260);
    act(() => provider.emit(45));
    expect(onCommit).toHaveBeenLastCalledWith(45);
  });
});
