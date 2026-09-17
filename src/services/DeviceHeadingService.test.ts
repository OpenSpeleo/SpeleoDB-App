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
  const handle = { remove: vi.fn(async (): Promise<void> => undefined) };
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

  it('does not replay readings delivered while the retired listener is stopping', async () => {
    const fake = fakePlugin();
    const stopping = deferred<void>();
    vi.mocked(fake.plugin.stopListening).mockReturnValueOnce(stopping.promise);
    const service = new DeviceHeadingService(fake.plugin, () => true);
    const unsubscribe = service.subscribe(vi.fn());
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
    fake.emit(90);
    unsubscribe();
    await waitFor(() => expect(fake.plugin.stopListening).toHaveBeenCalledOnce());

    fake.emit(120);
    const resumed = vi.fn();
    const unsubscribeResumed = service.subscribe(resumed);
    expect(resumed).toHaveBeenLastCalledWith(null);
    fake.emit(150);
    expect(resumed).toHaveBeenCalledTimes(1);

    stopping.resolve();
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledTimes(2));
    fake.emit(260);
    expect(resumed).toHaveBeenLastCalledWith(260);
    unsubscribeResumed();
    await waitFor(() => expect(fake.plugin.stopListening).toHaveBeenCalledTimes(2));
  });

  it('ignores callbacks from a removed listener after a fresh session starts', async () => {
    const fake = fakePlugin();
    const callbacks: Array<(event: { value: number }) => void> = [];
    vi.mocked(fake.plugin.addListener).mockImplementation(async (_event, callback) => {
      callbacks.push(callback);
      return fake.handle;
    });
    const service = new DeviceHeadingService(fake.plugin, () => true);
    const unsubscribe = service.subscribe(vi.fn());
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
    unsubscribe();
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledOnce());

    const resumed = vi.fn();
    const unsubscribeResumed = service.subscribe(resumed);
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledTimes(2));
    callbacks[1]({ value: 260 });
    callbacks[0]({ value: 90 });
    expect(resumed).toHaveBeenLastCalledWith(260);
    unsubscribeResumed();
    await waitFor(() => expect(fake.plugin.stopListening).toHaveBeenCalledTimes(2));
  });

  it('does not cache a reading after the final unsubscribe before teardown begins', async () => {
    const fake = fakePlugin();
    const service = new DeviceHeadingService(fake.plugin, () => true);
    const unsubscribe = service.subscribe(vi.fn());
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
    unsubscribe();
    fake.emit(90);
    const resumed = vi.fn();
    const unsubscribeResumed = service.subscribe(resumed);
    expect(resumed).toHaveBeenLastCalledWith(null);
    fake.emit(260);
    expect(resumed).toHaveBeenLastCalledWith(260);
    unsubscribeResumed();
    await waitFor(() => expect(fake.plugin.stopListening).toHaveBeenCalledOnce());
  });

  it('stops a pending native start when its last subscriber leaves', async () => {
    const fake = fakePlugin();
    const starting = deferred<void>();
    vi.mocked(fake.plugin.startListening).mockReturnValueOnce(starting.promise);
    const service = new DeviceHeadingService(fake.plugin, () => true);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
    unsubscribe();
    fake.emit(90);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.plugin.stopListening).not.toHaveBeenCalled();
    starting.resolve();
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledOnce());
    expect(fake.plugin.stopListening).toHaveBeenCalledOnce();
  });

  it.each(['addListener', 'startListening'] as const)(
    'shares a pending %s setup with a replacement subscriber',
    async (stage) => {
      const fake = fakePlugin();
      const adding = deferred<Awaited<ReturnType<HeadingPlugin['addListener']>>>();
      const starting = deferred<void>();
      if (stage === 'addListener') vi.mocked(fake.plugin.addListener).mockReturnValueOnce(adding.promise);
      else vi.mocked(fake.plugin.startListening).mockReturnValueOnce(starting.promise);
      const service = new DeviceHeadingService(fake.plugin, () => true);
      const unsubscribe = service.subscribe(vi.fn());
      await waitFor(() => expect(fake.plugin[stage]).toHaveBeenCalledOnce());
      unsubscribe();
      const unsubscribeReplacement = service.subscribe(vi.fn());
      if (stage === 'addListener') adding.resolve(fake.handle);
      else starting.resolve();
      await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
      unsubscribeReplacement();
      await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledOnce());
      expect(fake.plugin.addListener).toHaveBeenCalledOnce();
      expect(fake.plugin.startListening).toHaveBeenCalledOnce();
      expect(fake.plugin.stopListening).toHaveBeenCalledOnce();
    },
  );

  it.each(['addListener', 'startListening'] as const)(
    'recovers from rejected %s setup on the next subscription',
    async (stage) => {
      const fake = fakePlugin();
      vi.mocked(fake.plugin[stage]).mockRejectedValueOnce(new Error('sensor unavailable'));
      const service = new DeviceHeadingService(fake.plugin, () => true);
      const unavailable = vi.fn();
      const unsubscribe = service.subscribe(unavailable);
      await waitFor(() => expect(unavailable).toHaveBeenCalledTimes(2));
      expect(unavailable).toHaveBeenLastCalledWith(null);
      fake.emit(90);
      expect(unavailable).toHaveBeenLastCalledWith(null);
      unsubscribe();
      const resumed = vi.fn();
      const unsubscribeResumed = service.subscribe(resumed);
      await waitFor(() => expect(fake.plugin.addListener).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledTimes(stage === 'startListening' ? 2 : 1));
      fake.emit(260);
      expect(resumed).toHaveBeenLastCalledWith(260);
      unsubscribeResumed();
      await waitFor(() => expect(fake.plugin.stopListening).toHaveBeenCalledTimes(2));
    },
  );

  it('contains teardown failures and still starts a fresh session', async () => {
    const fake = fakePlugin();
    vi.mocked(fake.plugin.stopListening).mockRejectedValueOnce(new Error('stop failed'));
    fake.handle.remove.mockRejectedValueOnce(new Error('remove failed'));
    const service = new DeviceHeadingService(fake.plugin, () => true);
    const unsubscribe = service.subscribe(vi.fn());
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
    unsubscribe();
    unsubscribe();
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledOnce());
    const resumed = vi.fn();
    const unsubscribeResumed = service.subscribe(resumed);
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledTimes(2));
    fake.emit(260);
    expect(resumed).toHaveBeenLastCalledWith(260);
    unsubscribeResumed();
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledTimes(2));
    expect(fake.plugin.stopListening).toHaveBeenCalledTimes(2);
  });

  it('retires cancelled setup callbacks before awaiting listener removal', async () => {
    const fake = fakePlugin();
    const adding = deferred<Awaited<ReturnType<HeadingPlugin['addListener']>>>();
    const removing = deferred<void>();
    let cancelledCallback!: (event: { value: number }) => void;
    vi.mocked(fake.plugin.addListener).mockImplementationOnce((_event, callback) => {
      cancelledCallback = callback;
      return adding.promise;
    });
    fake.handle.remove.mockReturnValueOnce(removing.promise);
    const service = new DeviceHeadingService(fake.plugin, () => true);
    const unsubscribe = service.subscribe(vi.fn());
    await waitFor(() => expect(fake.plugin.addListener).toHaveBeenCalledOnce());
    unsubscribe();
    adding.resolve(fake.handle);
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledOnce());

    const resumed = vi.fn();
    const unsubscribeResumed = service.subscribe(resumed);
    cancelledCallback({ value: 90 });
    expect(resumed).toHaveBeenCalledExactlyOnceWith(null);
    removing.resolve();
    await waitFor(() => expect(fake.plugin.startListening).toHaveBeenCalledOnce());
    fake.emit(260);
    expect(resumed).toHaveBeenLastCalledWith(260);
    unsubscribeResumed();
    await waitFor(() => expect(fake.handle.remove).toHaveBeenCalledTimes(2));
  });
});
