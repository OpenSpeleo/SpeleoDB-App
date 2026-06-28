import { describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';

import {
  CapacitorCredentialStore,
  CredentialStoreError,
  type NativeCredentialStorePlugin,
} from './CredentialStore';

function createPlugin(...values: [unknown?]): NativeCredentialStorePlugin {
  const token = values.length === 0 ? null : values[0];
  return {
    readToken: vi.fn(async () => ({ token })),
    writeToken: vi.fn(async () => undefined),
    clearToken: vi.fn(async () => undefined),
  };
}

describe('CapacitorCredentialStore', () => {
  it('reads an existing token without changing its value', async () => {
    const plugin = createPlugin(' token-with-significant-spaces ');
    const store = new CapacitorCredentialStore(plugin, () => true);

    await expect(store.readToken()).resolves.toBe(' token-with-significant-spaces ');
    expect(plugin.readToken).toHaveBeenCalledOnce();
  });

  it('returns null when the native store is empty', async () => {
    const store = new CapacitorCredentialStore(createPlugin(), () => true);

    await expect(store.readToken()).resolves.toBeNull();
  });

  it.each([undefined, 1, false, {}, []])(
    'rejects malformed native read value %j',
    async (token) => {
      const store = new CapacitorCredentialStore(createPlugin(token), () => true);

      await expect(store.readToken()).rejects.toMatchObject({
        name: 'CredentialStoreError',
        code: 'invalid-response',
      });
    },
  );

  it.each(['', '   ', 'x'.repeat(16 * 1024 + 1), 'é'.repeat(8 * 1024 + 1)])(
    'rejects an invalid token without calling native write',
    async (token) => {
      const plugin = createPlugin();
      const store = new CapacitorCredentialStore(plugin, () => true);

      await expect(store.writeToken(token)).rejects.toMatchObject({
        name: 'CredentialStoreError',
        code: 'invalid-token',
      });
      expect(plugin.writeToken).not.toHaveBeenCalled();
    },
  );

  it('accepts the maximum UTF-8 token length and preserves it', async () => {
    const token = 'x'.repeat(16 * 1024);
    const plugin = createPlugin();
    const store = new CapacitorCredentialStore(plugin, () => true);

    await store.writeToken(token);

    expect(plugin.writeToken).toHaveBeenCalledWith({ token });
  });

  it('rejects an invalid token returned by native storage', async () => {
    const store = new CapacitorCredentialStore(createPlugin(' '), () => true);

    await expect(store.readToken()).rejects.toMatchObject({ code: 'invalid-token' });
  });

  it('clears the native token', async () => {
    const plugin = createPlugin();
    const store = new CapacitorCredentialStore(plugin, () => true);

    await store.clearToken();

    expect(plugin.clearToken).toHaveBeenCalledOnce();
  });

  it.each(['readToken', 'writeToken', 'clearToken'] as const)(
    'fails closed outside a native application for %s',
    async (operation) => {
      const plugin = createPlugin('token');
      const store = new CapacitorCredentialStore(plugin, () => false);

      const call = operation === 'writeToken'
        ? store.writeToken('token')
        : store[operation]();

      await expect(call).rejects.toEqual(expect.any(CredentialStoreError));
      await expect(call).rejects.toMatchObject({ code: 'native-only' });
      expect(plugin.readToken).not.toHaveBeenCalled();
      expect(plugin.writeToken).not.toHaveBeenCalled();
      expect(plugin.clearToken).not.toHaveBeenCalled();
    },
  );

  it('propagates native failures without retrying', async () => {
    const plugin = createPlugin();
    vi.mocked(plugin.writeToken).mockRejectedValueOnce(new Error('vault unavailable'));
    const store = new CapacitorCredentialStore(plugin, () => true);

    await expect(store.writeToken('token')).rejects.toThrow('vault unavailable');
    expect(plugin.writeToken).toHaveBeenCalledOnce();
  });

  it('uses the Capacitor platform detector by default', async () => {
    const nativePlatform = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const store = new CapacitorCredentialStore(createPlugin());

    await expect(store.readToken()).rejects.toMatchObject({ code: 'native-only' });
    expect(nativePlatform).toHaveBeenCalledOnce();
    nativePlatform.mockRestore();
  });
});
