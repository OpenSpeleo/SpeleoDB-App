import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixtures/app';
import type { Project } from '../../src/types/project';

const survey: Project = {
  id: 'display-cave', name: 'Display Cave', description: '', country: 'US', color: '#ff0000',
  type: 'COMPASS', visibility: 'PRIVATE', is_active: true, created_by: 'fixture@example.test',
  creation_date: '2026-01-01', modified_date: '2026-01-01', commit_count: 1,
  active_mutex: null, fork_from: null, exclude_geojson: false,
  geojson_file: 'https://offline-maps.test/display-cave.json', geojson_revision: 'display-one',
  latest_commit: { id: 'display-commit', message: '', author_email: '', author_name: '', authored_date: '',
    dt_since: '', parent_ids: [], url: '', formats: [], tree: [] },
};

const geometry: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'Cave entrance', depth: 0 },
      geometry: { type: 'Point', coordinates: [-87.495, 20.106] } },
    { type: 'Feature', properties: { depth: 200 },
      geometry: { type: 'LineString', coordinates: [[-87.5, 20.1], [-87.49, 20.1]] } },
  ],
};

async function setupMap(page: Page) {
  const app = await fixture(page);
  let online = true;
  let projectDownloads = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const headers = { 'access-control-allow-origin': '*' };
  await page.route('https://offline-maps.test/api/v2/projects/geojson/', route => route.fulfill({
    status: online ? 200 : 503, json: online ? [survey] : {}, headers,
  }));
  await page.route(survey.geojson_file!, route => {
    projectDownloads++;
    return route.fulfill({ status: online ? 200 : 503, json: online ? geometry : {}, headers });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Projects', exact: true }).tap();
  await page.getByRole('button', { name: survey.name, exact: true }).tap();
  return {
    errors,
    downloads: () => projectDownloads,
    disconnect: () => { online = false; app.disconnect(); },
  };
}

/** Inspect actual canvas output rather than React props or a fake map renderer. */
async function mapPixels(page: Page) {
  const screenshot = await page.locator('.maplibregl-canvas').screenshot({ scale: 'css' });
  return page.evaluate(async (dataUrl) => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const values = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { yellow: 0, red: 0 };
    for (let index = 0; index < values.length; index += 4) {
      const [r, g, b] = values.subarray(index, index + 3);
      if (r > 200 && g > 180 && b < 80) counts.yellow++;
      if (r > 180 && g < 70 && b < 70) counts.red++;
    }
    return counts;
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

async function openSettings(page: Page) {
  await page.getByRole('tab', { name: 'Settings', exact: true }).tap();
  await expect(page.getByTestId('map-visibility-summary')).toBeVisible();
}

test('entrance visibility changes real map output, preserves linework, and restores offline', async ({ page }, testInfo) => {
  const app = await setupMap(page);
  await expect.poll(async () => (await mapPixels(page)).yellow).toBeGreaterThan(15);
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  const downloads = app.downloads();
  await openSettings(page);
  // Complete the fixture's automatic offline area before reloading offline;
  // otherwise WebKit can abort in-flight tile requests during navigation.
  await expect(page.getByTestId('sync-pct')).toHaveText('100%');
  await page.getByTestId('map-visibility-summary').tap();
  await page.getByRole('switch', { name: 'Cave entrances', exact: true }).tap();
  await expect(page.getByTestId('map-visibility-summary')).toContainText('Custom');
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect.poll(async () => (await mapPixels(page)).yellow).toBe(0);
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  expect(app.downloads()).toBe(downloads);
  await page.screenshot({ path: testInfo.outputPath('entrances-hidden.png') });

  app.disconnect();
  await page.reload();
  await page.getByRole('button', { name: 'Go Offline', exact: true }).tap();
  await page.getByRole('tab', { name: 'Projects', exact: true }).tap();
  await page.getByRole('button', { name: survey.name, exact: true }).tap();
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  expect((await mapPixels(page)).yellow).toBe(0);
  await openSettings(page);
  await expect(page.getByTestId('map-visibility-disclosure')).not.toHaveAttribute('open', '');
  await page.getByTestId('map-visibility-summary').tap();
  await expect(page.getByRole('switch', { name: 'Cave entrances', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Reset visibility', exact: true }).tap();
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect.poll(async () => (await mapPixels(page)).yellow).toBeGreaterThan(15);
  expect(app.errors).toEqual([]);
});

test('depth limit and subtype controls work through the real retained map and Settings routes', async ({ page }, testInfo) => {
  const app = await setupMap(page);
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  await openSettings(page);
  await page.getByRole('combobox', { name: 'Color mode', exact: true }).selectOption('depth');
  await page.getByRole('combobox', { name: 'Map unit', exact: true }).selectOption('feet');
  await page.getByTestId('depth-limit-summary').tap();
  const input = page.getByRole('textbox', { name: 'Maximum depth', exact: true });
  await input.fill('80.25');
  await input.press('Enter');
  await expect(page.getByTestId('depth-limit-summary')).toContainText('80.25 ft');
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect(page.getByTestId('depth-gauge-max')).toHaveText('80.25 ft');
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath('depth-cap-map.png') });

  await openSettings(page);
  await page.getByTestId('depth-limit-summary').tap();
  await input.fill('-1');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('depth-limit-summary')).toContainText('80.25 ft');
  await page.getByRole('button', { name: 'Reset to full range', exact: true }).tap();
  await expect(page.getByTestId('depth-limit-summary')).toContainText('Full range');
  await page.getByTestId('map-visibility-summary').tap();
  await page.locator('summary').filter({ hasText: 'Station types' }).tap();
  await page.getByRole('switch', { name: 'Biology', exact: true }).tap();
  await page.getByRole('switch', { name: 'Survey stations', exact: true }).tap();
  await expect(page.getByRole('switch', { name: 'Biology', exact: true })).toBeDisabled();
  await page.getByRole('switch', { name: 'Survey stations', exact: true }).tap();
  await expect(page.getByRole('switch', { name: 'Biology', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Reset visibility', exact: true }).tap();
  await expect(page.getByRole('switch', { name: 'Biology', exact: true })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Color mode', exact: true })).toHaveValue('depth');
  await expect(page.getByRole('combobox', { name: 'Map unit', exact: true })).toHaveValue('feet');
  await page.screenshot({ path: testInfo.outputPath('settings-expanded.png') });
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect(page.getByTestId('depth-gauge-max')).toHaveText('200 ft');
  expect(app.errors).toEqual([]);
});

test('disclosures and depth errors remain usable on narrow, landscape and tablet screens', async ({ page }, testInfo) => {
  const app = await setupMap(page);
  await openSettings(page);
  const settings = page.locator('.map-display-settings');
  await settings.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: testInfo.outputPath('settings-default.png') });
  await page.getByRole('combobox', { name: 'Color mode', exact: true }).selectOption('depth');
  await page.getByTestId('depth-limit-summary').tap();
  const input = page.getByRole('textbox', { name: 'Maximum depth', exact: true });
  await input.fill('30');
  await input.press('Enter');

  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByTestId('depth-limit-summary').scrollIntoViewIfNeeded();
    await expect(input).toHaveValue('30');
    const dimensions = await settings.evaluate(element => ({
      client: element.clientWidth, scroll: element.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
    const inputBox = await input.boundingBox();
    expect(inputBox!.x).toBeGreaterThanOrEqual(0);
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(viewport.width);
    await input.fill('invalid');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('Enter a number greater than zero');
    const reset = page.getByRole('button', { name: 'Reset to full range', exact: true });
    await reset.scrollIntoViewIfNeeded();
    const tabBar = await page.getByTestId('app-tab-bar').filter({ visible: true }).boundingBox();
    const errorBox = await page.getByRole('alert').boundingBox();
    const resetBox = await reset.boundingBox();
    expect(errorBox!.y).toBeGreaterThanOrEqual(0);
    expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(tabBar!.y);
    expect(resetBox!.y + resetBox!.height).toBeLessThanOrEqual(tabBar!.y);
    await page.screenshot({ path: testInfo.outputPath(`depth-error-${viewport.width}.png`) });
    await reset.tap();
    await input.fill('30');
    await input.press('Enter');
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByTestId('depth-limit-summary').tap();
  await page.getByTestId('map-visibility-summary').tap();
  await page.locator('summary').filter({ hasText: 'Station types' }).tap();
  await page.getByRole('switch', { name: 'Safety cylinders', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('switch', { name: 'Safety cylinders', exact: true })).toBeVisible();
  const lastSwitch = await page.getByRole('switch', { name: 'Safety cylinders', exact: true }).boundingBox();
  expect(lastSwitch!.x + lastSwitch!.width).toBeLessThanOrEqual(320);
  await page.getByTestId('map-visibility-summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('visibility-320.png') });
  expect(app.errors).toEqual([]);
});
