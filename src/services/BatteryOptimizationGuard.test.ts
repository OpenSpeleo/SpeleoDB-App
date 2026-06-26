import { describe, it, expect, vi } from 'vitest';
import { BatteryOptimizationGuard, type BatteryOptimizationLike } from './BatteryOptimizationGuard';

function fakePlugin(overrides: Partial<BatteryOptimizationLike> = {}) {
  return {
    isBatteryOptimizationEnabled: vi.fn(async () => ({ enabled: true })),
    requestIgnoreBatteryOptimization: vi.fn(async () => {}),
    ...overrides,
  } satisfies BatteryOptimizationLike;
}

describe('BatteryOptimizationGuard', () => {
  it('is a no-op off Android (isRelevant false)', async () => {
    const plugin = fakePlugin();
    const guard = new BatteryOptimizationGuard(plugin, () => 'ios');
    expect(guard.isRelevant()).toBe(false);
    expect(await guard.isOptimizationActive()).toBe(false);
    await guard.requestExemption();
    expect(plugin.isBatteryOptimizationEnabled).not.toHaveBeenCalled();
    expect(plugin.requestIgnoreBatteryOptimization).not.toHaveBeenCalled();
  });

  it('reports optimization active on Android when enabled', async () => {
    const guard = new BatteryOptimizationGuard(fakePlugin({ isBatteryOptimizationEnabled: vi.fn(async () => ({ enabled: true })) }), () => 'android');
    expect(await guard.isOptimizationActive()).toBe(true);
  });

  it('reports inactive once the app is exempted', async () => {
    const guard = new BatteryOptimizationGuard(fakePlugin({ isBatteryOptimizationEnabled: vi.fn(async () => ({ enabled: false })) }), () => 'android');
    expect(await guard.isOptimizationActive()).toBe(false);
  });

  it('swallows plugin read errors (defaults to inactive)', async () => {
    const guard = new BatteryOptimizationGuard(
      fakePlugin({ isBatteryOptimizationEnabled: vi.fn(async () => { throw new Error('boom'); }) }),
      () => 'android',
    );
    expect(await guard.isOptimizationActive()).toBe(false);
  });

  it('requests the exemption dialog on Android', async () => {
    const plugin = fakePlugin();
    const guard = new BatteryOptimizationGuard(plugin, () => 'android');
    await guard.requestExemption();
    expect(plugin.requestIgnoreBatteryOptimization).toHaveBeenCalledTimes(1);
  });

  it('swallows request errors (cancellation must not break recording)', async () => {
    const plugin = fakePlugin({ requestIgnoreBatteryOptimization: vi.fn(async () => { throw new Error('cancelled'); }) });
    const guard = new BatteryOptimizationGuard(plugin, () => 'android');
    await expect(guard.requestExemption()).resolves.toBeUndefined();
  });
});
