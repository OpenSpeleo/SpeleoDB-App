/**
 * BatteryOptimizationGuard -- a thin, Android-only helper around
 * `@capawesome-team/capacitor-android-battery-optimization`.
 *
 * Aggressive OEM power managers (Samsung, Xiaomi, Huawei, …) can kill the
 * background-geolocation foreground service under Doze, cutting a long
 * recording short. Exempting the app from battery optimization makes recording
 * reliable on those devices. This is a best-effort *reliability nudge*: track
 * recording works whether or not the user grants it, so every method degrades to
 * a safe no-op off Android or on any plugin error.
 *
 * The plugin + platform probe are injectable so this is testable without a
 * device. See docs/app-permissions.md and docs/gps-tracks.md.
 */

import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';

export interface BatteryOptimizationLike {
  isBatteryOptimizationEnabled(): Promise<{ enabled: boolean }>;
  requestIgnoreBatteryOptimization(): Promise<void>;
}

export class BatteryOptimizationGuard {
  constructor(
    private plugin: BatteryOptimizationLike = BatteryOptimization,
    private getPlatform: () => string = () => Capacitor.getPlatform(),
  ) {}

  /** Battery optimization only exists on Android; elsewhere this is a no-op. */
  isRelevant(): boolean {
    return this.getPlatform() === 'android';
  }

  /**
   * True when the OS is still battery-optimizing the app (i.e. NOT yet
   * exempted) -- the only case where nudging the user is useful. False off
   * Android or if the state can't be read.
   */
  async isOptimizationActive(): Promise<boolean> {
    if (!this.isRelevant()) return false;
    try {
      const { enabled } = await this.plugin.isBatteryOptimizationEnabled();
      return enabled;
    } catch {
      return false;
    }
  }

  /** Open the system "ignore battery optimization" dialog (best-effort). */
  async requestExemption(): Promise<void> {
    if (!this.isRelevant()) return;
    try {
      await this.plugin.requestIgnoreBatteryOptimization();
    } catch {
      // Best-effort: a cancelled/failed request must not affect recording.
    }
  }
}
