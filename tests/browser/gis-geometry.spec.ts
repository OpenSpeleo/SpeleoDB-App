import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixtures/app';
import { gisMetadata } from '../../src/test/gisGeometryFixtures';
import type { DownloadAreaCatalog } from '../../src/types/downloadArea';
import type { OfflineMapGenerationRecord } from '../../src/types/offlineMapSync';

const LINE = gisMetadata({ color: '#ff00ff', name: 'Reference line' });
const POLYGON = gisMetadata({
  id: '22345678-1234-4234-8234-123456789abc', color: '#00ffff', name: 'Reference polygon', geometry_type: 'Polygon',
});
const radians = Math.PI / 180;
const polygonArea = 6371008.8 ** 2 * (0.001 * radians) * 2 * Math.cos(20.1005 * radians) * Math.sin(0.001 * radians / 2);
const DETAILS = {
  [LINE.id]: { ...LINE, geojson: { type: 'LineString', coordinates: [[-87.5, 20.1], [-87.499, 20.1]] }, bbox_area_m2: 0, vertex_count: 2 },
  [POLYGON.id]: { ...POLYGON, geojson: { type: 'Polygon', coordinates: [[[-87.5, 20.1], [-87.499, 20.1], [-87.499, 20.101], [-87.5, 20.1]]] }, bbox_area_m2: polygonArea, vertex_count: 3 },
};

async function geometryFixture(page: Page, holdDetails = false) {
  const app = await fixture(page);
  let offline = false;
  let revoked = false;
  let releaseDetails!: () => void;
  const gate = holdDetails ? new Promise<void>(resolve => { releaseDetails = resolve; }) : Promise.resolve();
  const requests: { path: string; method: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type()) && !message.text().includes('GL Driver Message')) errors.push(message.text());
  });
  await page.route('https://offline-maps.test/api/v2/gis-geometries/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, method: route.request().method() });
    if (offline) {
      await route.fulfill({ status: 503, json: {}, headers: { 'access-control-allow-origin': '*' } });
      return;
    }
    const id = path.split('/')[4];
    if (id) await gate;
    await route.fulfill({ json: id ? DETAILS[id] : revoked ? [] : [LINE, POLYGON], headers: { 'access-control-allow-origin': '*' } });
  });
  return {
    requests, errors,
    release: () => releaseDetails(),
    revoke: () => { revoked = true; },
    offline: () => { offline = true; app.disconnect(); },
  };
}

async function openGis(page: Page) {
  await page.getByRole('tab', { name: 'Geometries' }).click();
  return page.getByTestId('gis-geometry-panel');
}

async function automaticLandmark(page: Page) {
  await page.route('https://offline-maps.test/api/v2/landmarks/geojson/', route => route.fulfill({
    headers: { 'access-control-allow-origin': '*' },
    json: { type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'automatic-landmark',
      properties: { id: 'automatic-landmark', name: 'Automatic landmark' },
      geometry: { type: 'Point', coordinates: [-87.5, 20.1] },
    }] },
  }));
}

async function expectCompletedTiles(page: Page) {
  await expect(page.getByTestId('sync-pct')).toHaveText('100%');
  await expect.poll(async () => {
    const counts = (await page.getByTestId('sync-tiles').innerText()).split('/').map(value => Number(value.replace(/\D/g, '')));
    return counts.length === 2 && counts[0] > 0 && counts[0] === counts[1];
  }).toBe(true);
}

async function downloadAreaCatalog(page: Page): Promise<DownloadAreaCatalog | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('speleo_tiles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('offline_map_settings')) return null;
      return await new Promise<DownloadAreaCatalog | null>((resolve, reject) => {
        const request = db.transaction('offline_map_settings').objectStore('offline_map_settings').get('download-areas');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

/** Read the real download catalog/generations; readiness has no row label. */
async function offlineGeometryReady(page: Page) {
  return page.evaluate(async ids => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('speleo_tiles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('offline_map_generations')) return false;
      const tx = db.transaction(['offline_map_settings', 'offline_map_generations'], 'readonly');
      const read = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [catalog, generations] = await Promise.all([
        read(tx.objectStore('offline_map_settings').get('download-areas')) as Promise<DownloadAreaCatalog | undefined>,
        read(tx.objectStore('offline_map_generations').getAll()) as Promise<OfflineMapGenerationRecord[]>,
      ]);
      if (!catalog || !ids.every(id => catalog.areas.some(area => area.type === 'gis-geometry' && area.objectId === id && area.sourceRevision === '1'))) return false;
      return (catalog.layerIds ?? ['esri-satellite']).every(layerId => generations.some(generation =>
        generation.layerId === layerId && generation.status === 'active' && generation.coverageKey
        && generation.totalTiles > 0 && generation.completedTiles === generation.totalTiles && generation.failedTiles === 0));
    } finally { db.close(); }
  }, [LINE.id, POLYGON.id]);
}

async function colorPixels(page: Page, screenshot: Buffer) {
  return page.evaluate(async dataUrl => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const cyan = { count: 0, left: canvas.width, right: 0, top: canvas.height, bottom: 0 };
    let magenta = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const [r, g, b] = pixels.subarray(i, i + 3);
      if (r > 150 && b > 150 && g < 120) magenta++;
      if (r < 90 && g > 150 && b > 150) {
        cyan.count++;
        cyan.left = Math.min(cyan.left, x); cyan.right = Math.max(cyan.right, x);
        cyan.top = Math.min(cyan.top, y); cyan.bottom = Math.max(cyan.bottom, y);
      }
    }
    return { cyan, magenta, width: canvas.width, height: canvas.height };
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

test('delayed offline preparation respects show then hide and never requests permissions', async ({ page }) => {
  const app = await geometryFixture(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  const panel = await openGis(page);
  await expect(panel.getByText('0 of 2 visible')).toBeVisible();
  await expect(panel.getByText(/Tap a name|Preparing offline|LineString|Polygon|Offline ready/)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Refresh/ })).toHaveCount(0);
  const toggle = page.getByTestId(`gis-geometry-toggle-${LINE.id}`);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('status', { name: 'Loading Reference line' })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  app.release();
  await expect.poll(() => offlineGeometryReady(page)).toBe(true);
  await expect(panel.getByText('0 of 2 visible')).toBeVisible();
  expect(app.requests).toEqual(expect.arrayContaining([
    { path: '/api/v2/gis-geometries/', method: 'GET' },
    { path: `/api/v2/gis-geometries/${LINE.id}/`, method: 'GET' },
    { path: `/api/v2/gis-geometries/${POLYGON.id}/`, method: 'GET' },
  ]));
  expect(app.requests).toHaveLength(3);
  expect(app.errors).toEqual([]);
});

test('renders both shapes with full bounds and saved-fill transparency, then works after offline reload', async ({ page }, testInfo) => {
  const app = await geometryFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  let panel = await openGis(page);
  await expect.poll(() => offlineGeometryReady(page)).toBe(true);
  await panel.getByRole('button', { name: 'Show all geometries' }).click();
  await panel.getByRole('button', { name: 'Zoom to Reference polygon' }).click();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  const canvas = page.locator('.maplibregl-canvas');
  await expect.poll(async () => {
    const pixels = await colorPixels(page, await canvas.screenshot({ scale: 'css' }));
    return pixels.cyan.count > 20 && pixels.magenta > 20 && pixels.cyan.left >= 50
      && pixels.cyan.right <= pixels.width - 50 && pixels.cyan.top >= 50 && pixels.cyan.bottom <= pixels.height - 50;
  }).toBe(true);
  const visible = await canvas.screenshot({ scale: 'css', path: testInfo.outputPath('geometries-map.png') });
  const colors = await colorPixels(page, visible);
  const scale = await page.getByTestId('distance-scale').textContent();
  panel = await openGis(page);
  await panel.getByRole('button', { name: 'Hide all geometries' }).click();
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  await expect.poll(async () => (await colorPixels(page, await canvas.screenshot({ scale: 'css' }))).cyan.count).toBe(0);
  const hidden = await canvas.screenshot({ scale: 'css' });
  expect(await page.getByTestId('distance-scale').textContent()).toBe(scale);
  const sample = {
    x: Math.round((colors.cyan.left + 2 * colors.cyan.right) / 3),
    y: Math.round((colors.cyan.top + 2 * colors.cyan.bottom) / 3),
  };
  const rgb = await page.evaluate(async ({ images, point }) => Promise.all(images.map(async url => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(point.x, point.y, 1, 1).data].slice(0, 3);
  })), { images: [hidden, visible].map(buffer => `data:image/png;base64,${buffer.toString('base64')}`), point: sample });
  for (let channel = 0; channel < 3; channel++) {
    const expected = rgb[0][channel] * 0.825 + [0, 255, 255][channel] * 0.175;
    expect(Math.abs(rgb[1][channel] - expected)).toBeLessThan(6);
  }
  await testInfo.attach('gis-line-polygon.png', { body: visible, contentType: 'image/png' });
  const requestCount = app.requests.length;
  app.offline();
  await page.reload();
  await page.getByRole('button', { name: 'Go Offline', exact: true }).click();
  panel = await openGis(page);
  await expect(panel.getByText('0 of 2 visible')).toBeVisible();
  await panel.getByRole('button', { name: 'Zoom to Reference polygon' }).click();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(async () => (await colorPixels(page, await canvas.screenshot({ scale: 'css' }))).cyan.count).toBeGreaterThan(20);
  expect(app.requests).toHaveLength(requestCount);
  expect(app.errors).toEqual(['Failed to load resource: the server responded with a status of 503 (Service Unavailable)']);
});

test('keeps six and seven tab targets usable at 320px, with enlarged text and a short viewport', async ({ page }, testInfo) => {
  await geometryFixture(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/dashboard');
  const panel = await openGis(page);
  await expect(panel.getByRole('button', { name: 'Hide all geometries' })).toBeVisible();
  await expect.poll(async () => (await panel.boundingBox())?.x).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('geometries-panel-320.png') });
  const list = page.getByTestId('gis-geometry-panel-list');
  expect((await list.boundingBox())!.height).toBeGreaterThan(68);
  await expect(page.getByRole('tab')).toHaveCount(6);
  await page.goto('/pending');
  await expect(page.getByRole('tab')).toHaveCount(7);
  for (const enlarged of [false, true]) {
    if (enlarged) await page.addStyleTag({ content: '.app-tab-bar__tab > span { font-size: 20px !important; line-height: 1.2 !important; }' });
    const targets = await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => {
      const rect = tab.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('tab', { name: 'Geometries' }).focus();
    await expect(page.getByRole('tab', { name: 'Geometries' })).toBeInViewport();
    const name = enlarged ? 'geometries-nav-large-text.png' : 'geometries-nav-320.png';
    await testInfo.attach(name, { body: await page.screenshot({ path: testInfo.outputPath(name) }), contentType: 'image/png' });
  }
  await page.getByRole('tab', { name: 'Geometries' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Geometries' })).toBeVisible();
  await page.getByTestId('gis-geometry-panel').getByRole('button', { name: 'Close panel' }).press('Escape');
  await expect(page.getByTestId('gis-geometry-panel')).toHaveAttribute('aria-hidden', 'true');
});

test('a refreshed access loss removes an already visible geometry', async ({ page }) => {
  const app = await geometryFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  let panel = await openGis(page);
  await expect.poll(() => offlineGeometryReady(page)).toBe(true);
  await panel.getByRole('button', { name: 'Zoom to Reference polygon' }).click();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  const canvas = page.locator('.maplibregl-canvas');
  await expect.poll(async () => (await colorPixels(page, await canvas.screenshot({ scale: 'css' }))).cyan.count).toBeGreaterThan(20);
  app.revoke();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByTestId('sync-button').click();
  panel = await openGis(page);
  await expect(panel.getByText('No geometries available.')).toBeVisible();
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  await expect.poll(async () => (await colorPixels(page, await canvas.screenshot({ scale: 'css' }))).cyan.count).toBe(0);
  expect(app.errors).toEqual([]);
});

for (const status of [404, 503]) {
  test(`automatic landmark tiles sync despite GIS collection ${status}, then merge recovered geometries`, async ({ page }) => {
    await fixture(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let recovered = false;
    let collectionReads = 0;
    const headers = { 'access-control-allow-origin': '*' };
    await automaticLandmark(page);
    await page.route('https://offline-maps.test/api/v2/gis-geometries/**', route => {
      const id = new URL(route.request().url()).pathname.split('/')[4];
      if (!id) collectionReads++;
      return route.fulfill(recovered
        ? { headers, json: id ? DETAILS[id] : [LINE, POLYGON] }
        : { headers, status, json: { detail: 'Geometry collection unavailable' } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    const panel = await openGis(page);
    await expect(panel.getByRole('alert')).toHaveText('GIS Geometries could not be refreshed. Try again.');
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expectCompletedTiles(page);
    const initial = await downloadAreaCatalog(page);
    expect(initial?.schemaVersion).toBe(1);
    expect(initial?.areas).toEqual([expect.objectContaining({
      type: 'landmark', objectId: 'automatic-landmark', sourceKey: 'landmarks:automatic-landmark',
      sourceRevision: '[-87.5,20.1]', layerIds: ['esri-satellite'],
    })]);
    expect(collectionReads).toBe(1);

    recovered = true;
    await page.getByTestId('sync-button').click();
    await expect.poll(() => offlineGeometryReady(page)).toBe(true);
    await expect(page.getByTestId('sync-pct')).toHaveText('100%');
    const updated = await downloadAreaCatalog(page);
    expect(updated?.areas).toHaveLength(3);
    expect(updated?.areas.find(area => area.type === 'landmark')).toEqual(initial!.areas[0]);
    expect(updated?.areas.filter(area => area.type === 'gis-geometry').map(area => area.sourceKey).sort())
      .toEqual([`gis-geometry:${LINE.id}`, `gis-geometry:${POLYGON.id}`].sort());
    expect(collectionReads).toBe(2);
    await openGis(page);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel.getByText('0 of 2 visible')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('automatic landmark downloads finish while GIS details are still pending', async ({ page }) => {
  const app = await geometryFixture(page, true);
  await automaticLandmark(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  const panel = await openGis(page);
  await expect(panel.getByText('0 of 2 visible')).toBeVisible();
  await expect.poll(() => app.requests.filter(request => request.path !== '/api/v2/gis-geometries/').length).toBe(2);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  // The coordinate requests remain unresolved until after real tile completion.
  await expectCompletedTiles(page);
  const initial = await downloadAreaCatalog(page);
  expect(initial?.areas).toEqual([expect.objectContaining({
    type: 'landmark', sourceKey: 'landmarks:automatic-landmark', objectId: 'automatic-landmark',
  })]);
  app.release();
  await expect.poll(() => offlineGeometryReady(page)).toBe(true);
  await expectCompletedTiles(page);
  const updated = await downloadAreaCatalog(page);
  expect(updated?.areas).toHaveLength(3);
  expect(updated?.areas.find(area => area.type === 'landmark')).toEqual(initial!.areas[0]);
  expect(app.requests).toHaveLength(3);
  expect(app.errors).toEqual([]);
});

test('healthy geometry and landmark tiles finish while a GPS source is still pending', async ({ page }) => {
  const app = await geometryFixture(page);
  await automaticLandmark(page);
  const headers = { 'access-control-allow-origin': '*' };
  const trackId = '32345678-1234-4234-8234-123456789abc';
  const fileUrl = 'https://offline-maps.test/fixtures/delayed-track.geojson';
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let trackReads = 0;
  await page.route('https://offline-maps.test/api/v2/gps_tracks/', route => route.fulfill({
    headers, json: [{ id: trackId, name: 'Delayed GPS track', color: '#22c55e',
      file: fileUrl, sha256_hash: 'current-track-content',
      creation_date: LINE.creation_date, modified_date: LINE.modified_date }],
  }));
  await page.route(fileUrl, async route => {
    trackReads++;
    await held;
    await route.fulfill({ headers, json: { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[-87.501, 20.1], [-87.5, 20.1]] },
    }] } });
  });
  let initial: DownloadAreaCatalog | null = null;
  try {
    await page.goto('/dashboard');
    await expect.poll(() => trackReads).toBeGreaterThan(0);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expectCompletedTiles(page);
    await expect.poll(() => offlineGeometryReady(page)).toBe(true);
    initial = await downloadAreaCatalog(page);
    expect(initial?.areas).toHaveLength(3);
    expect(initial?.areas.some(area => area.type === 'track')).toBe(false);
  } finally {
    release();
  }
  await expect.poll(async () => (await downloadAreaCatalog(page))?.areas.length).toBe(4);
  await expectCompletedTiles(page);
  const final = await downloadAreaCatalog(page);
  for (const area of initial!.areas) expect(final?.areas.find(value => value.areaId === area.areaId)).toEqual(area);
  expect(final?.areas.find(area => area.type === 'track')).toMatchObject({
    objectId: trackId, sourceKey: `gps-track-server:${trackId}`, sourceRevision: 'current-track-content',
  });
  expect(app.errors).toEqual([]);
});
