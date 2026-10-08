import { expect, test } from '@playwright/test';
import { fixture } from './fixtures/app';

/** Screenshot pixels establish that the GPU produced stars and an outer rim. */
async function appearancePixels(page: import('@playwright/test').Page) {
  const screenshot = await page.locator('.maplibregl-canvas').screenshot({ scale: 'css' });
  return page.evaluate(async dataUrl => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const values = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; let stars = 0; let halo = 0;
    for (let index = 0; index < values.length; index += 4) {
      const r = values[index]!; const g = values[index + 1]!; const b = values[index + 2]!;
      const y = Math.floor(index / 4 / canvas.width);
      if (y < canvas.height / 10) {
        if (r < 30 && g < 30 && b < 35) dark++;
        if (r > 32 && r < 100 && Math.abs(r - g) < 8 && Math.abs(r - b) < 12) stars++;
      }
      if (r > 100 && g > 100 && b > 100 && Math.max(r, g, b) - Math.min(r, g, b) < 45) halo++;
    }
    return { darkFraction: dark / (canvas.width * Math.ceil(canvas.height / 10)), stars, halo };
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

test('mobile globe retains stars and atmosphere through basemap changes and navigation', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fixture(page);
  await page.route(/https:\/\/.*(arcgisonline|arcgis)\.com\/.*\/tile\//, route => route.fulfill({
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQU9ACAACwAGHvrnYhAAAAAElFTkSuQmCC', 'base64'),
    contentType: 'image/png', headers: { 'access-control-allow-origin': '*' },
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect.poll(async () => (await appearancePixels(page)).halo).toBeGreaterThan(100);
  const initial = await appearancePixels(page);
  expect(initial.darkFraction).toBeGreaterThan(0.9);
  expect(initial.stars).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath('mobile-globe.png') });
  for (const id of ['esri-world-hillshade', 'esri-world-hillshade-dark', 'esri-satellite']) {
    await page.getByTestId('map-layer-button').tap();
    await page.getByTestId(`map-layer-option-${id}`).tap();
    await expect.poll(async () => (await appearancePixels(page)).halo).toBeGreaterThan(100);
    expect((await appearancePixels(page)).stars).toBeGreaterThan(10);
  }
  await page.getByRole('tab', { name: 'Projects', exact: true }).tap();
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect.poll(async () => (await appearancePixels(page)).halo).toBeGreaterThan(100);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await appearancePixels(page)).halo).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath('mobile-globe-landscape.png') });
  expect(errors).toEqual([]);
});
