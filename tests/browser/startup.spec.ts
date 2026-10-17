import { expect, test } from '@playwright/test';
import { fixture } from './fixtures/app';

test('a cold stored-session launch reaches the offline prompt and dismisses the native splash', async ({ page }) => {
  await fixture(page, false);
  // Startup feedback must work even before the authenticated route chunk arrives.
  // Loading the shell first can mask circular initialization in shared Ionic chunks.
  let releaseShell!: () => void;
  const shellReleased = new Promise<void>((resolve) => { releaseShell = resolve; });
  await page.route('**/assets/AuthenticatedAppShell-*.js', async (route) => {
    await shellReleased;
    await route.continue();
  });
  await page.addInitScript(() => {
    const bridge = window as unknown as {
      startupSplashHidden: boolean;
      Capacitor: {
        PluginHeaders: Array<{ name: string; methods: Array<{ name: string; rtype: string }> }>;
        nativePromise: (plugin: string, method: string, options: unknown) => Promise<unknown>;
      };
    };
    bridge.startupSplashHidden = false;
    bridge.Capacitor.PluginHeaders.push({
      name: 'SplashScreen',
      methods: [{ name: 'hide', rtype: 'promise' }],
    });
    const nativePromise = bridge.Capacitor.nativePromise;
    bridge.Capacitor.nativePromise = async (plugin, method, options) => {
      if (plugin === 'SplashScreen' && method === 'hide') {
        bridge.startupSplashHidden = true;
        return {};
      }
      return nativePromise(plugin, method, options);
    };
  });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Go Offline', exact: true })).toBeVisible();
    await expect(page.getByTestId('app-error-boundary')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { startupSplashHidden: boolean }).startupSplashHidden,
    )).toBe(true);
  } finally {
    releaseShell();
    await page.unroute('**/assets/AuthenticatedAppShell-*.js');
  }
});
