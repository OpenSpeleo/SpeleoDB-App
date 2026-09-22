import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixtures/app';
import type { Project } from '../../src/types/project';

const survey: Project = {
  id: 'shot-colors', name: 'Shot Color Cave', description: '', country: 'US', color: '#ff0000',
  type: 'COMPASS', visibility: 'PRIVATE', is_active: true, created_by: 'fixture@example.test',
  creation_date: '2026-01-01', modified_date: '2026-01-01', commit_count: 1,
  active_mutex: null, fork_from: null, exclude_geojson: false,
  geojson_file: 'https://offline-maps.test/survey-file.json', geojson_revision: 'artifact-one',
  latest_commit: { id: 'commit-one', message: '', author_email: '', author_name: '', authored_date: '',
    dt_since: '', parent_ids: [], url: '', formats: [], tree: [] },
};
const geometry: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection', features: [
    { color: '#ff00ff' }, { color: '#00ffff' }, {},
  ].map((properties, index) => ({ type: 'Feature', properties,
    geometry: { type: 'LineString', coordinates: [
      [-87.5, 20.1 + index * 0.0003, 2], [-87.499, 20.1 + index * 0.0003, 8],
    ] } })),
};
async function pixels(page: Page) {
  const screenshot = await page.locator('.maplibregl-canvas').screenshot({ scale: 'css' });
  return page.evaluate(async (dataUrl) => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const values = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { magenta: 0, cyan: 0, red: 0 };
    for (let i = 0; i < values.length; i += 4) {
      const [r, g, b] = values.subarray(i, i + 3);
      if (r > 180 && g < 70 && b > 180) counts.magenta++;
      if (r < 70 && g > 180 && b > 180) counts.cyan++;
      if (r > 180 && g < 70 && b < 70) counts.red++;
    }
    return counts;
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

test('By Shot renders source colors and fallback, persists, and works after offline reload', async ({ page }, testInfo) => {
  const app = await fixture(page);
  let online = true;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const headers = { 'access-control-allow-origin': '*' };
  await page.route('https://offline-maps.test/api/v2/projects/geojson/', route => route.fulfill({
    status: online ? 200 : 503, json: online ? [survey] : {}, headers,
  }));
  await page.route(survey.geojson_file!, route => route.fulfill({
    status: online ? 200 : 503, json: online ? geometry : {}, headers,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Projects', exact: true }).tap();
  await page.getByRole('button', { name: survey.name, exact: true }).tap();
  await expect.poll(async () => (await pixels(page)).red).toBeGreaterThan(20);
  await page.getByRole('tab', { name: 'Settings', exact: true }).tap();
  const selector = page.getByRole('combobox', { name: 'Color mode', exact: true });
  await selector.selectOption('shot');
  await expect(page.getByText(/Shots without a color use their project color/)).toBeVisible();
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect(page.getByTestId('depth-gauge')).toHaveCount(0);
  await expect.poll(async () => {
    const color = await pixels(page);
    return color.magenta > 20 && color.cyan > 20 && color.red > 20;
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('shot-colors.png') });

  await page.getByRole('tab', { name: 'Settings', exact: true }).tap();
  await selector.selectOption('depth');
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect(page.getByTestId('depth-gauge')).toBeVisible();
  await page.getByRole('tab', { name: 'Settings', exact: true }).tap();
  await selector.selectOption('shot');
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect(page.getByTestId('depth-gauge')).toHaveCount(0);

  online = false; app.disconnect();
  await page.reload();
  const offlineNotice = page.getByRole('button', { name: 'Go Offline', exact: true });
  await expect(offlineNotice).toBeVisible();
  await offlineNotice.tap();
  // Reload does not promise to restore the camera; zoom via the real project control.
  await page.getByRole('tab', { name: 'Projects', exact: true }).tap();
  await page.getByRole('button', { name: survey.name, exact: true }).tap();
  await expect.poll(async () => {
    const color = await pixels(page);
    return color.magenta > 20 && color.cyan > 20 && color.red > 20;
  }).toBe(true);
  await page.getByRole('tab', { name: 'Settings', exact: true }).tap();
  await expect(selector).toHaveValue('shot');
  expect(errors).toEqual([]);
});
