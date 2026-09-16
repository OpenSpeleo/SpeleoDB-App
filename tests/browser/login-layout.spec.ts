import { expect, test } from '@playwright/test';

// These exercise shipped markup/CSS in real layout engines. A smaller logical
// viewport models Display Zoom's layout constraint, not the OS setting itself.
const layouts = [
  { name: 'portrait', width: 390, height: 844, fontSize: 16 },
  { name: 'small portrait', width: 320, height: 568, fontSize: 16 },
  { name: 'landscape', width: 568, height: 320, fontSize: 16 },
  { name: 'keyboard-sized viewport', width: 320, height: 300, fontSize: 16 },
  { name: 'enlarged text', width: 360, height: 640, fontSize: 32 },
];

for (const layout of layouts) {
  for (const method of ['password', 'token'] as const) {
    test(`${method} login remains reachable: ${layout.name}`, async ({ page, browserName }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          errors.push(message.text());
        }
      });
      await page.setViewportSize(layout);
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
      await page.evaluate((fontSize) => {
        document.documentElement.style.fontSize = `${fontSize}px`;
        // Include non-zero insets so the last action has usable clearance.
        document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px');
      }, layout.fontSize);

      const submit = page.locator('button[type="submit"]');
      // Find the actual scroll owner by behavior, independent of class names.
      const owner = await submit.evaluateHandle((button) => {
        for (let node = button.parentElement; node; node = node.parentElement) {
          if (/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)
              && node.clientHeight > 0) {
            return node;
          }
        }
        return null;
      });
      expect(await owner.evaluate((node) => node !== null), 'login needs a user-scrollable ancestor').toBe(true);
      const overflow = await owner.evaluate((node) => node!.scrollHeight - node!.clientHeight);
      if (layout.name !== 'portrait') expect(overflow).toBeGreaterThan(0);

      // Playwright does not support wheel input in mobile WebKit. Chromium
      // additionally proves input-driven scrolling; both engines verify the
      // real scroll geometry and pointer hit testing below.
      if (browserName === 'chromium') {
        await page.mouse.move(layout.width - 8, layout.height / 2);
        await page.mouse.wheel(0, 10000);
        await expect.poll(() => owner.evaluate((node) => node!.scrollTop)).toBe(overflow);
      }

      if (method === 'token') {
        await page.getByRole('tab', { name: 'OAuth Token' }).click();
      }

      // Reach the bottom through the owning scroller. Hidden body overflow is
      // deliberately not accepted, even though scrollIntoView can move it.
      await owner.evaluate((node) => { node!.scrollTop = node!.scrollHeight; });
      await expect(submit).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('link', { name: 'Sign up' })).toBeInViewport({ ratio: 1 });
      if (method === 'token') {
        await expect(page.getByRole('link', { name: 'Get OAuth Token' })).toBeInViewport({ ratio: 1 });
      }
      expect(await owner.evaluate((node) => node!.scrollWidth <= node!.clientWidth)).toBe(true);
      await testInfo.attach('login-bottom', {
        body: await page.screenshot({ path: testInfo.outputPath('login-bottom.png') }),
        contentType: 'image/png',
      });

      // Check scrolling back before validation focuses an invalid input:
      // WebKit can asynchronously scroll that focused field into view.
      await owner.evaluate((node) => { node!.scrollTop = 0; });
      await expect(page.getByRole('img', { name: 'SpeleoDB', exact: true })).toBeInViewport({ ratio: 1 });
      await owner.evaluate((node) => { node!.scrollTop = node!.scrollHeight; });
      await expect(submit).toBeInViewport({ ratio: 1 });

      // A real pointer tap must reach the form. Empty credentials invoke native
      // validation, proving clickability without sending credentials anywhere.
      await page.evaluate(() => {
        document.querySelector('form')!.addEventListener('invalid', () => {
          document.querySelector('form')!.dataset.validationReached = 'true';
        }, { capture: true, once: true });
      });
      await submit.tap();
      await expect(page.locator('form')).toHaveAttribute('data-validation-reached', 'true');

      expect(errors).toEqual([]);
    });
  }
}
