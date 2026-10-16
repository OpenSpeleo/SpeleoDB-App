import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixtures/app';
import { captureMapCanvas } from './fixtures/mapCanvas';

const ICONS = ['DEFAULT', 'CAVE', 'UNKNOWN', 'ATTENTION', 'NOGO'] as const;

async function magentaShapes(page: Page, region: 'icons' | 'canvas' = 'icons') {
  const screenshot = await captureMapCanvas(page);
  return page.evaluate(async ({ url, region }) => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const columns = new Map<number, number>();
    // locateCenter aligns all five markers on the canvas center row. Keep their
    // full artwork in a 32px band, excluding names below it: neighboring labels
    // can join across columns depending on the browser's font rasterization.
    const top = region === 'icons' ? Math.floor(canvas.height / 2) - 16 : 0;
    const bottom = region === 'icons' ? Math.ceil(canvas.height / 2) + 16 : canvas.height;
    for (let y = top; y < bottom; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] > 150 && pixels[i + 2] > 150 && pixels[i + 1] < 100) columns.set(x, (columns.get(x) ?? 0) + 1);
    }
    const shapes: { start: number; end: number; pixels: number }[] = [];
    for (const x of [...columns.keys()].sort((a, b) => a - b)) {
      const previous = shapes.at(-1);
      if (!previous || x - previous.end > 10) shapes.push({ start: x, end: x, pixels: columns.get(x)! });
      else { previous.end = x; previous.pixels += columns.get(x)!; }
    }
    return shapes.map(shape => ({ width: shape.end - shape.start + 1, pixels: shape.pixels }));
  }, { url: `data:image/png;base64,${screenshot.toString('base64')}`, region });
}

async function locateCenter(page: Page) {
  await page.getByRole('tab', { name: 'Landmarks', exact: true }).click();
  await page.getByTestId('landmark-row-icon-2').click();
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
}

test('renders distinct collection-colored landmark icons after style changes and offline reload', async ({ page }, testInfo) => {
  const app = await fixture(page);
  let offline = false;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://offline-maps.test/api/v2/landmarks/geojson/', route => route.fulfill({
    status: offline ? 503 : 200, headers: { 'access-control-allow-origin': '*' },
    json: { type: 'FeatureCollection', features: ICONS.map((icon, index) => ({
      type: 'Feature', id: `icon-${index}`, properties: { id: `icon-${index}`, icon, name: icon,
        description: '', collection: 'icons', collection_name: 'Icons', collection_color: '#ff00ff',
        can_write: true, can_delete: true },
      geometry: { type: 'Point', coordinates: [-87.5 + (index - 2) * 0.0007, 20.1] },
    })) },
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await locateCenter(page);
  await expect.poll(async () => (await magentaShapes(page)).length).toBe(5);
  await expect.poll(async () => new Set((await magentaShapes(page)).map(shape => `${shape.width}:${shape.pixels}`)).size).toBeGreaterThanOrEqual(4);
  await testInfo.attach('landmark-icons.png', { body: await captureMapCanvas(page), contentType: 'image/png' });
  await page.getByTestId('map-layer-button').click();
  await page.getByTestId('map-layer-option-esri-world-hillshade').click();
  await expect.poll(async () => (await magentaShapes(page)).length).toBe(5);
  await page.getByTestId('map-layer-button').click();
  await page.getByTestId('map-layer-option-esri-satellite').click();
  await expect.poll(async () => new Set((await magentaShapes(page)).map(shape => `${shape.width}:${shape.pixels}`)).size).toBeGreaterThanOrEqual(4);
  offline = true; app.disconnect();
  await page.reload();
  await page.getByRole('button', { name: 'Go Offline', exact: true }).click();
  await locateCenter(page);
  await expect.poll(async () => (await magentaShapes(page)).length).toBe(5);
  await expect.poll(async () => new Set((await magentaShapes(page)).map(shape => `${shape.width}:${shape.pixels}`)).size).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});

for (const mode of ['create', 'edit'] as const) {
  test(`${mode} landmark form keeps fields and icon choices reachable on constrained screens`, async ({ page }, testInfo) => {
    await fixture(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://offline-maps.test/api/v2/landmarks/geojson/', route => route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'form-landmark',
        properties: { id: 'form-landmark', name: 'Form landmark', icon: 'CAVE', description: '', collection: 'pink',
          collection_name: 'Pink', collection_color: '#ff00ff', can_write: true, can_delete: true },
        geometry: { type: 'Point', coordinates: [-87.5, 20.1] },
      }] },
    }));
    await page.route('https://offline-maps.test/api/v2/landmark-collections/', route => route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: [
        { id: 'pink', name: 'Pink', color: '#ff00ff', is_personal: true, user_permission_level: 3 },
        { id: 'cyan', name: 'Cyan', color: '#00ffff', is_personal: false, user_permission_level: 3 },
      ],
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Landmarks', exact: true }).click();
    await page.getByTestId('landmark-row-form-landmark').click();
    await page.getByRole('tab', { name: 'Map', exact: true }).click();
    // The first SVG frame can precede MapLibre's symbol hit index. Wait for
    // the wider landmark name to paint, and for the drawer to clear the map.
    await expect.poll(async () => (await magentaShapes(page, 'canvas'))[0]?.width ?? 0).toBeGreaterThan(32);
    await expect.poll(() => page.getByTestId('landmark-panel')
      .evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    const canvas = page.locator('.maplibregl-canvas');
    const box = (await canvas.boundingBox())!;
    await expect.poll(() => canvas.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === element;
    })).toBe(true);
    if (mode === 'edit') {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByTestId('edit-landmark-button').click();
    } else {
      const pointer = { pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: box.x + box.width / 2 - 70, clientY: box.y + box.height / 2 + 70 };
      await canvas.dispatchEvent('pointerdown', pointer);
      await expect(page.getByTestId('create-landmark-button')).toBeVisible();
      await canvas.dispatchEvent('pointerup', pointer);
      await page.getByTestId('create-landmark-button').click();
    }
    const form = page.getByTestId('landmark-form-modal');
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: mode === 'edit' ? 'Icon: Cave' : 'Icon: Default' }))
      .toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('landmark-name-input').fill('Layout landmark');
    await form.getByRole('button', { name: 'Icon: No go' }).click();
    await page.getByTestId('landmark-collection-select').selectOption('cyan');
    await expect(form.getByRole('button', { name: 'Icon: No go' })).toHaveAttribute('aria-pressed', 'true');
    for (const label of ['Default', 'Cave', 'Unknown', 'Attention', 'No go']) {
      const preview = form.getByRole('button', { name: `Icon: ${label}` }).locator('span[aria-hidden]');
      await expect(preview).toHaveCSS('background-color', 'rgb(0, 255, 255)');
      expect(await preview.evaluate(async element => {
        const url = JSON.parse(getComputedStyle(element).maskImage.slice(4, -1)) as string;
        const image = new Image(); image.src = url; await image.decode();
        return image.naturalWidth;
      })).toBeGreaterThan(0);
    }
    const owner = await form.evaluateHandle(async element => {
      const content = element.closest('ion-content') as HTMLElement & { getScrollElement(): Promise<HTMLElement> };
      return content.getScrollElement();
    });
    // Measure the scroll origin without a previously focused select triggering
    // browser focus-restoration scrolling after the viewport/font changes.
    await form.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const layout of [
      { name: 'short', width: 320, height: 568, fontSize: 16 },
      { name: 'landscape', width: 568, height: 320, fontSize: 16 },
      { name: 'keyboard', width: 320, height: 300, fontSize: 16 },
      { name: 'large-text', width: 360, height: 640, fontSize: 32 },
    ]) {
      await page.setViewportSize(layout);
      await page.evaluate(fontSize => { document.documentElement.style.fontSize = `${fontSize}px`; }, layout.fontSize);
      await owner.evaluate(element => { element.scrollTop = 0; });
      await expect(form.getByRole('heading', { name: mode === 'edit' ? 'Edit Landmark' : 'Create Landmark' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('landmark-name-input')).toBeInViewport({ ratio: 1 });
      expect(await owner.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const label of ['Default', 'Cave', 'Unknown', 'Attention', 'No go']) {
        const button = form.getByRole('button', { name: `Icon: ${label}` });
        // Center the choice instead of leaving a fractional pixel clipped by
        // the browser's minimum-scroll behavior at enlarged text sizes.
        await button.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      if (layout.name === 'large-text') {
        await page.screenshot({ path: testInfo.outputPath(`${mode}-large-text-icons.png`) });
      }
      await owner.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(page.getByTestId('landmark-form-submit')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('landmark-form-cancel')).toBeInViewport({ ratio: 1 });
      await expect(form.getByRole('button', { name: 'Icon: No go' })).toHaveAttribute('aria-pressed', 'true');
      await testInfo.attach(`${mode}-${layout.name}`, {
        body: await page.screenshot({ path: testInfo.outputPath(`${mode}-${layout.name}.png`) }), contentType: 'image/png',
      });
    }
    await page.getByTestId('landmark-form-cancel').click();
    await expect(form).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}
