/**
 * Android 13+ requires POST_NOTIFICATIONS before a foreground-service
 * notification can be shown. Background GPS recording depends on that persistent
 * notification, so request it before starting the native recorder.
 *
 * The permission is requested through a small *local* Android-only Capacitor
 * plugin (`RecordingNotificationPermission`, see
 * `android/app/src/main/java/.../RecordingNotificationPermissionPlugin.java`)
 * rather than `@capacitor/local-notifications`, so nothing is linked into the
 * iOS build -- iOS has no notification gate for the location background mode. On
 * any non-Android platform this guard short-circuits to "granted" and never
 * touches the native plugin. See docs/app-permissions.md.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface RecordingNotificationPermissionGuard {
  requestPermission(): Promise<'granted' | 'denied'>;
}

/** Native surface of the local Android-only `RecordingNotificationPermission` plugin. */
export interface RecordingNotificationPermissionPlugin {
  /** Resolves `{ display: 'granted' | 'denied' }` (mirrors the OS prompt result). */
  requestPermission(): Promise<{ display: string }>;
}

const RecordingNotificationPermission = registerPlugin<RecordingNotificationPermissionPlugin>(
  'RecordingNotificationPermission',
);

export class CapacitorRecordingNotificationPermissionGuard
implements RecordingNotificationPermissionGuard {
  constructor(
    private plugin: RecordingNotificationPermissionPlugin = RecordingNotificationPermission,
    private isNativePlatform: () => boolean = () => Capacitor.isNativePlatform(),
    private getPlatform: () => string = () => Capacitor.getPlatform(),
  ) {}

  async requestPermission(): Promise<'granted' | 'denied'> {
    if (!this.isNativePlatform() || this.getPlatform() !== 'android') {
      return 'granted';
    }

    try {
      const status = await this.plugin.requestPermission();
      return status.display === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
}
