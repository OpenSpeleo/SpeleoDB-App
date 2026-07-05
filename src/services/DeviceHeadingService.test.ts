import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { DeviceHeadingService, type HeadingPlugin } from './DeviceHeadingService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakePlugin() {
  let listener: ((event: { value: number }) => void) | null = null;
  const handle = { remove: vi.fn(async () => undefined) };
  const plugin: HeadingPlugin = {
    addListener: vi.fn(async (_name, nextListener) => {
      listener = nextListener;
      return handle;
    }),
    startListening: vi.fn(async () => undefined),
    stopListening: vi.fn(async () => undefined),
  };
  return { plugin, handle, emit: (value: number) => listener?.({ value }) };
}

describe('DeviceHeadingService', () => {
  it('shares one native listener and stops it after the last subscriber', async () => {
    const fake = fakePlugin();
    const service = new DeviceHeadingService(fake.plugin, () => true);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = service.subscribe(first);
    const unsubscribeSecond = service.subscribe(second);

    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledWith({
      minInterval: 100,
      minHeadingChange: 2,
    }));
    expect(fake.plugin.addListener).toHaveBeenCalledOnce();
    fake.emit(361);
    expect(first).toHaveBeenLastCalledWith(1);
    expect(second).toHaveBeenLastCalledWith(1);

    unsubscribeFirst();
    await Promise.resolve();
    expect(fake.plugin.stopListening).not.toHaveBeenCalled();
    unsubscribeSecond();
    await waitFor(() => expect(fake.plugin.stopListening).toHaveBeenCalledOnce());
    expect(fake.handle.remove).toHaveBeenCalledOnce();
  });

  it('does not touch the native plugin on web and ignores invalid readings', async () => {
    const fake = fakePlugin();
    const webService = new DeviceHeadingService(fake.plugin, () => false);
    const webListener = vi.fn();
    webService.subscribe(webListener);
    await Promise.resolve();
    expect(fake.plugin.addListener).not.toHaveBeenCalled();

    const nativeService = new DeviceHeadingService(fake.plugin, () => true);
    const nativeListener = vi.fn();
    nativeService.subscribe(nativeListener);
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
    fake.emit(Number.NaN);
    expect(nativeListener).toHaveBeenCalledTimes(1);
  });

  it('contains setup failures and leaves subscribers on dot-only state', async () => {
    const fake = fakePlugin();
    vi.mocked(fake.plugin.startListening).mockRejectedValueOnce(new Error('unavailable'));
    const listener = vi.fn();
    new DeviceHeadingService(fake.plugin, () => true).subscribe(listener);
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledOnce());
    expect(fake.plugin.stopListening).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it('removes a late listener without starting sensors after unsubscribe', async () => {
    const fake = fakePlugin();
    const pending = deferred<Awaited<ReturnType<HeadingPlugin['addListener']>>>();
    vi.mocked(fake.plugin.addListener).mockReturnValueOnce(pending.promise);
    const unsubscribe = new DeviceHeadingService(fake.plugin, () => true).subscribe(vi.fn());
    await waitFor(() => expect(fake.plugin.addListener).toHaveBeenCalledOnce());
    unsubscribe();
    pending.resolve(fake.handle);
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledOnce());
    expect(fake.plugin.startListening).not.toHaveBeenCalled();
  });
});
