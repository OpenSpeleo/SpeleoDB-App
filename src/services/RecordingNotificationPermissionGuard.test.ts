import { describe, expect, it, vi } from 'vitest';
import {
  CapacitorRecordingNotificationPermissionGuard,
  type RecordingNotificationPermissionPlugin,
} from './RecordingNotificationPermissionGuard';

function guardFor(
  display: string,
  isNative = true,
  platform = 'android',
): CapacitorRecordingNotificationPermissionGuard {
  const plugin: RecordingNotificationPermissionPlugin = {
    requestPermission: vi.fn(async () => ({ display })),
  };
  return new CapacitorRecordingNotificationPermissionGuard(
    plugin,
    () => isNative,
    () => platform,
  );
}

describe('CapacitorRecordingNotificationPermissionGuard', () => {
  it('skips notification permission off native Android', async () => {
    // Off Android the local plugin does not exist, so the guard must never call
    // it and must report granted (no notification gate on web/iOS).
    const plugin: RecordingNotificationPermissionPlugin = {
      requestPermission: vi.fn(async () => ({ display: 'denied' })),
    };
    const web = new CapacitorRecordingNotificationPermissionGuard(plugin, () => false, () => 'web');
    const ios = new CapacitorRecordingNotificationPermissionGuard(plugin, () => true, () => 'ios');

    await expect(web.requestPermission()).resolves.toBe('granted');
    await expect(ios.requestPermission()).resolves.toBe('granted');
    expect(plugin.requestPermission).not.toHaveBeenCalled();
  });

  it('returns granted only when Android reports display granted', async () => {
    await expect(guardFor('granted').requestPermission()).resolves.toBe('granted');
    await expect(guardFor('denied').requestPermission()).resolves.toBe('denied');
    await expect(guardFor('prompt').requestPermission()).resolves.toBe('denied');
  });

  it('treats plugin failures as denied so recording start can show a clean error', async () => {
    const plugin: RecordingNotificationPermissionPlugin = {
      requestPermission: vi.fn(async () => {
        throw new Error('notification plugin failed');
      }),
    };
    const guard = new CapacitorRecordingNotificationPermissionGuard(
      plugin,
      () => true,
      () => 'android',
    );

    await expect(guard.requestPermission()).resolves.toBe('denied');
  });
});
