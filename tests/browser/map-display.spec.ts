import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fixture } from './fixtures/app';
import { gisMetadata } from '../../src/test/gisGeometryFixtures';
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

async function setupMap(page: Page, projectGeometry = geometry, beforeNavigation?: () => Promise<void>) {
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
    return route.fulfill({ status: online ? 200 : 503, json: online ? projectGeometry : {}, headers });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await beforeNavigation?.();
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

async function overviewPixels(page: Page) {
  const screenshot = await page.locator('.maplibregl-canvas').screenshot({ scale: 'css' });
  return page.evaluate(async dataUrl => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const ink: { x: number; y: number }[] = [];
    for (let index = 0; index < pixels.length; index += 4) {
      const [r, g, b] = pixels.subarray(index, index + 3);
      if (r > 60 && r > g + 40 && r > b + 40) {
        ink.push({ x: (index / 4) % canvas.width, y: Math.floor(index / 4 / canvas.width) });
      }
    }
    if (ink.length === 0) return { lines: 0, width: 0, maxColumnPixels: 0 };
    const minX = Math.min(...ink.map(p => p.x)); const maxX = Math.max(...ink.map(p => p.x));
    const minY = Math.min(...ink.map(p => p.y)); const maxY = Math.max(...ink.map(p => p.y));
    const lines = new Set(ink.map(p => {
      const column = Math.min(2, Math.floor(3 * (p.x - minX) / (maxX - minX + 1)));
      const row = Math.min(2, Math.floor(3 * (p.y - minY) / (maxY - minY + 1)));
      return `${row}:${column}`;
    }));
    const columnPixels = new Map<number, number>();
    for (const point of ink) columnPixels.set(point.x, (columnPixels.get(point.x) ?? 0) + 1);
    return { lines: lines.size, width: maxX - minX + 1, maxColumnPixels: Math.max(...columnPixels.values()) };
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

async function expectOverviewLines(page: Page, testInfo: TestInfo) {
  await expect.poll(async () => (await overviewPixels(page)).lines).toBe(9);
  // Three rows of thin lines need at most two antialiased pixels per row.
  await expect.poll(async () => (await overviewPixels(page)).maxColumnPixels).toBeLessThanOrEqual(6);
  await page.screenshot({ path: testInfo.outputPath('regional-lines.png') });
  for (let zoomOut = 1; zoomOut <= 3; zoomOut++) {
    const previous = await overviewPixels(page);
    const canvas = await page.locator('.maplibregl-canvas').boundingBox();
    // Mobile WebKit's automation bridge cannot send mouse-wheel input. Deliver
    // the same DOM event to the real map handler in both browser engines.
    await page.locator('.maplibregl-canvas').dispatchEvent('wheel', {
      deltaY: 900, deltaMode: 0,
      clientX: canvas!.x + canvas!.width / 2, clientY: canvas!.y + canvas!.height / 2,
    });
    // Prove the camera actually zoomed out as well as all nine lines surviving.
    await expect.poll(async () => (await overviewPixels(page)).width).toBeLessThan(previous.width * 0.75);
    await expect.poll(async () => (await overviewPixels(page)).lines).toBe(9);
    await page.screenshot({ path: testInfo.outputPath(`overview-zoom-out-${zoomOut}.png`) });
  }
}

test('short survey shots remain visible from regional to country overview', async ({ page }, testInfo) => {
  // Nine 3 km surveys across roughly 70 km, each built from ~10 m shots.
  // Individual shots are below the default simplification threshold at the
  // fitted overview zoom, although each whole cave spans several pixels.
  const features: GeoJSON.Feature[] = [];
  for (const latitude of [20.1, 20.2, 20.3]) {
    for (const longitude of [-87.5, -87.2, -86.9]) {
      for (let shot = 0; shot < 300; shot++) {
        features.push({
          type: 'Feature', properties: { depth: shot },
          geometry: { type: 'LineString', coordinates: [
            [longitude + shot * 0.0001, latitude],
            [longitude + (shot + 1) * 0.0001, latitude],
          ] },
        });
      }
    }
  }
  const app = await setupMap(page, { type: 'FeatureCollection', features });
  await expectOverviewLines(page, testInfo);
  expect(app.errors).toEqual([]);
});

for (const kind of ['GIS', 'GPS'] as const) {
  test(`${kind} lines remain visible from regional to country overview`, async ({ page }, testInfo) => {
    const vertexCount = kind === 'GIS' ? 91 : 301;
    const lines = [20.1, 20.2, 20.3].flatMap(latitude => [-87.5, -87.2, -86.9].map(longitude => ({
      type: 'LineString' as const,
      coordinates: Array.from({ length: vertexCount }, (_, vertex) => [longitude + vertex * 0.03 / (vertexCount - 1), latitude]),
    })));
    const metadata = lines.map((_, index) => gisMetadata({
      id: `${index + 1}2345678-1234-4234-8234-123456789abc`, name: `Overview line ${index}`, color: '#ff0000',
    }));
    // Only points establish the shared camera bounds; the red linework must
    // come from the GIS/GPS renderer being tested, not from a survey layer.
    const cameraBounds: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-87.5, 20.1] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-86.87, 20.3] } },
    ] };
    const app = await setupMap(page, cameraBounds, async () => {
      const headers = { 'access-control-allow-origin': '*' };
      if (kind === 'GIS') {
        await page.route('https://offline-maps.test/api/v2/gis-geometries/**', route => {
          const id = new URL(route.request().url()).pathname.split('/')[4];
          const index = metadata.findIndex(item => item.id === id);
          return route.fulfill({ headers, json: id ? {
            ...metadata[index], geojson: lines[index], bbox_area_m2: 0, vertex_count: vertexCount,
          } : metadata });
        });
      } else {
        await page.route('https://offline-maps.test/api/v2/gps_tracks/', route => route.fulfill({ headers,
          json: metadata.map(item => ({ ...item, file: `https://offline-maps.test/track-${item.id}.json`, sha256_hash: item.id })),
        }));
        for (const [index, item] of metadata.entries()) {
          await page.route(`https://offline-maps.test/track-${item.id}.json`, route => route.fulfill({ headers,
            json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: lines[index] }] },
          }));
        }
      }
    });
    // Camera-bound entrance stars would cover two small lines as we zoom out.
    await openSettings(page);
    await page.getByTestId('map-visibility-summary').tap();
    await page.getByRole('switch', { name: 'Cave entrances', exact: true }).tap();
    await page.getByRole('tab', { name: kind === 'GIS' ? 'Geometries' : 'GPS', exact: true }).tap();
    for (const item of metadata) {
      await page.getByTestId(kind === 'GIS' ? `gis-geometry-toggle-${item.id}` : `gps-track-visibility-${item.id}`).tap();
    }
    if (kind === 'GIS') await expect(page.getByTestId('gis-geometry-panel').getByText('9 of 9 visible')).toBeVisible();
    await page.getByRole('tab', { name: 'Map', exact: true }).tap();
    await expectOverviewLines(page, testInfo);
    expect(app.errors).toEqual([]);
  });
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

interface ViewerControlSample {
  startTime: number;
  feedbackTime: number;
  durationMs: number;
  control: string;
  checked: boolean;
  trusted: boolean;
}
interface ViewerWorkSample { name: string; startTime: number; durationMs: number }

async function installViewerMeasurements(page: Page) {
  await page.addInitScript(() => {
    const samples: ViewerControlSample[] = [];
    const longTasks: number[] = [];
    const work: ViewerWorkSample[] = [];
    Object.assign(window, { viewerControlSamples: samples, viewerLongTasks: longTasks, viewerWork: work });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver(list => {
        longTasks.push(...list.getEntries().map(entry => entry.duration));
      }).observe({ type: 'longtask' });
    }
    new PerformanceObserver(list => {
      work.push(...list.getEntries().filter(entry => entry.name.startsWith('viewer:')).map(entry => ({ name: entry.name, startTime: entry.startTime, durationMs: entry.duration })));
    }).observe({ type: 'measure' });
    document.addEventListener('click', event => {
      const toggle = event.composedPath().find(element => element instanceof HTMLElement && element.tagName === 'ION-TOGGLE') as (HTMLElement & { checked: boolean }) | undefined;
      if (!toggle) return;
      const startTime = performance.now();
      const control = toggle.getAttribute('data-testid') ?? '';
      const trusted = event.isTrusted;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const feedbackTime = performance.now();
        samples.push({ startTime, feedbackTime, durationMs: feedbackTime - startTime, control, checked: toggle.checked, trusted });
      }));
    }, { capture: true });
  });
}

test('large cached surveys keep controls responsive through rapid project and settings changes', async ({ page }, testInfo) => {
  const dense: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: Array.from({ length: 12_000 }, (_, index) => ({
      type: 'Feature' as const, properties: { depth: index % 200 },
      geometry: { type: 'LineString' as const, coordinates: [
        [-87.5 + (index % 100) * 0.0001, 20.1 + Math.floor(index / 100) * 0.00001],
        [-87.5 + (index % 100 + 1) * 0.0001, 20.1 + Math.floor(index / 100) * 0.00001],
      ] },
    })),
  };
  await installViewerMeasurements(page);
  const app = await setupMap(page, dense);
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  await page.getByRole('tab', { name: 'Projects', exact: true }).tap();
  const toggle = page.getByTestId(`project-toggle-${survey.id}`);
  for (let index = 0; index < 6; index++) {
    await toggle.tap();
    await expect(toggle).toHaveJSProperty('checked', index % 2 === 1);
  }
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  expect(app.downloads()).toBe(1);
  await openSettings(page);
  await page.getByTestId('map-visibility-summary').tap();
  const entrance = page.getByRole('switch', { name: 'Cave entrances', exact: true });
  await entrance.tap();
  await expect(entrance).not.toBeChecked();
  await page.getByTestId('color-mode-selector').selectOption('depth');
  await page.getByTestId('color-mode-selector').selectOption('shot');
  await page.getByTestId('color-mode-selector').selectOption('project');
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  await expect.poll(() => page.evaluate(() => (window as unknown as { viewerControlSamples: ViewerControlSample[] }).viewerControlSamples.length)).toBe(7);
  const measurements = await page.evaluate(() => {
    const state = window as unknown as { viewerControlSamples: ViewerControlSample[]; viewerLongTasks: number[]; viewerWork: ViewerWorkSample[] };
    const timings = state.viewerControlSamples.map(sample => sample.durationMs).sort((a, b) => a - b);
    return { samples: state.viewerControlSamples, p95ControlPaintMs: timings[Math.ceil(timings.length * 0.95) - 1], longTasksMs: state.viewerLongTasks, appWork: state.viewerWork };
  });
  await testInfo.attach('viewer-responsiveness.json', { body: JSON.stringify({ browser: testInfo.project.name, features: 12_000, ...measurements }, null, 2), contentType: 'application/json' });
  expect(measurements.samples).toHaveLength(7);
  expect(measurements.p95ControlPaintMs).toBeLessThanOrEqual(100);
  expect(measurements.appWork.some(entry => entry.name === 'viewer:project-depth')).toBe(true);
  expect(Math.max(...measurements.appWork.map(entry => entry.durationMs))).toBeLessThanOrEqual(50);
  expect(app.errors).toEqual([]);
});

test('controls accept newer intent while a large survey download finishes', async ({ page }, testInfo) => {
  await fixture(page);
  await installViewerMeasurements(page);
  const headers = { 'access-control-allow-origin': '*' };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('https://offline-maps.test/api/v2/projects/geojson/', route => route.fulfill({ headers, json: [survey] }));
  await page.route(survey.geojson_file!, async route => {
    requested = true;
    await pending;
    await route.fulfill({ headers, json: { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {}, geometry: { type: 'LineString',
        coordinates: Array.from({ length: 100_000 }, (_, index) => [
          -87.5 + index / 10_000_000, 20.1 + Math.sin(index / 100) / 1000, index % 200,
        ]),
      },
    }] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect.poll(() => requested).toBe(true);
  await openSettings(page);
  await page.getByTestId('map-visibility-summary').tap();
  // Project rows are intentionally withheld until validated geometry exists.
  // Settings remain usable throughout the pending download and preparation.
  const toggle = page.getByRole('switch', { name: 'Cave entrances', exact: true });
  await toggle.tap();
  await expect(toggle).toHaveJSProperty('checked', false);
  await toggle.evaluate(element => {
    const measure = performance.measure;
    performance.measure = (...args) => {
      const entry = measure.apply(performance, args);
      if (args[0] === 'viewer:project-depth') {
        // Trigger the actual control handler at the first production yield
        // boundary, without pausing the scheduler or adding artificial sleeps.
        // This is a synthetic event; trusted pointer input is covered above.
        performance.measure = measure;
        (element as HTMLElement).click();
      }
      return entry;
    };
  });
  release();
  await expect.poll(() => page.evaluate(() => {
    const state = window as unknown as { viewerControlSamples: ViewerControlSample[] };
    return state.viewerControlSamples.some(sample => sample.control === 'map-category-caveEntrances'
      && !sample.trusted && sample.checked);
  })).toBe(true);
  await expect(toggle).toBeChecked();
  for (let index = 0; index < 6; index++) {
    await toggle.tap();
    await expect(toggle).toHaveJSProperty('checked', index % 2 === 1);
  }
  await page.getByRole('tab', { name: 'Projects', exact: true }).tap();
  await page.getByRole('button', { name: survey.name, exact: true }).tap();
  await expect.poll(async () => (await mapPixels(page)).red).toBeGreaterThan(20);
  await expect.poll(() => page.evaluate(() => (window as unknown as { viewerControlSamples: ViewerControlSample[] }).viewerControlSamples.length)).toBe(8);
  const measurements = await page.evaluate(() => {
    const state = window as unknown as {
      viewerControlSamples: ViewerControlSample[];
      viewerWork: ViewerWorkSample[];
      viewerLongTasks: number[];
    };
    const timings = state.viewerControlSamples.map(sample => sample.durationMs).sort((a, b) => a - b);
    return { samples: state.viewerControlSamples, p95ControlPaintMs: timings[Math.ceil(timings.length * 0.95) - 1], appWork: state.viewerWork, longTasksMs: state.viewerLongTasks };
  });
  await testInfo.attach('viewer-load-completion.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  expect(measurements.p95ControlPaintMs).toBeLessThanOrEqual(100);
  const preparation = measurements.appWork.filter(entry => entry.name === 'viewer:project-depth');
  expect(preparation.length).toBeGreaterThan(50);
  const interaction = measurements.samples.find(sample => sample.control === 'map-category-caveEntrances'
    && !sample.trusted && sample.checked);
  expect(interaction).toBeDefined();
  expect(interaction!.startTime).toBeGreaterThanOrEqual(preparation[0].startTime);
  expect(preparation.some(slice => slice.startTime > interaction!.startTime)).toBe(true);
  expect(interaction!.startTime).toBeLessThan(preparation.at(-1)!.startTime + preparation.at(-1)!.durationMs);
  expect(interaction!.durationMs).toBeLessThanOrEqual(100);
  expect(Math.max(...measurements.appWork.map(entry => entry.durationMs))).toBeLessThanOrEqual(50);
});
