import { expect, test } from '@playwright/test';

test('the packaged update screen is readable without application code or external assets', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/webview-update.html');
  await expect(page.getByRole('heading', { name: 'A browser update is needed' })).toBeVisible();
  await expect(page.getByText('Android System WebView', { exact: true })).toBeVisible();
  await expect(page.getByText('Google Chrome', { exact: true })).toBeVisible();
  const preservation = page.getByText('You do not need to uninstall SpeleoDB or clear its data.');
  await preservation.scrollIntoViewIfNeeded();
  await expect(preservation).toBeVisible();
  expect(await page.evaluate(() => ({
    scripts: document.scripts.length,
    stylesheets: document.querySelectorAll('link[rel=stylesheet]').length,
    widthFits: document.documentElement.scrollWidth <= window.innerWidth,
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
  }))).toEqual({ scripts: 0, stylesheets: 0, widthFits: true, background: 'rgb(15, 23, 42)', text: 'rgb(226, 232, 240)' });
  expect(requests).toEqual(['/webview-update.html']);
  expect(errors).toEqual([]);
});
