import { expect, test } from '@playwright/test';

// The shipped app has a native-only credential vault. Emulate only its bridge
// for this fixture; application routing, map, IndexedDB, and downloads stay real.
async function fixture(
  page: import('@playwright/test').Page,
  connected = true,
  compass = false,
  depth = false,
) {
  let online = connected;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ withCompass, withDepth }: { withCompass: boolean; withDepth: boolean }) => {
    if (!localStorage.getItem('speleo_user_preferences'))
      localStorage.setItem(
        'speleo_user_preferences',
        JSON.stringify({
          hasStoredSession: true,
          instance: 'https://offline-maps.test',
          email: 'fixture@example.test',
          hasCompletedGuidedTour: true,
          colorMode: withDepth ? 'depth' : undefined,
        }),
      );
    const bridge = window as unknown as Record<string, unknown>;
    const compassListeners = new Map<string, (event: { value: number }) => void>();
    let compassListenerId = 0;
    if (withCompass) {
      bridge.compassFixtureListening = false;
      bridge.compassFixtureListenerCount = 0;
      bridge.compassFixtureStartCount = 0;
      bridge.compassFixtureFailStart = false;
      window.addEventListener('fixture-compass-heading', (event) => {
        for (const listener of compassListeners.values()) {
          listener({ value: (event as CustomEvent<number>).detail });
        }
      });
    }
    bridge.CapacitorCustomPlatform = { name: 'ios' };
    bridge.Capacitor = {
      PluginHeaders: [
        ...(withCompass ? [{
          name: 'CapgoCompass',
          methods: [
            { name: 'addListener', rtype: 'callback' },
            ...['removeListener', 'startListening', 'stopListening'].map((name) => ({ name, rtype: 'promise' })),
          ],
        }] : []),
        {
          name: 'SentryCapacitor',
          methods: [
            'initNativeSdk',
            'fetchNativeDeviceContexts',
            'fetchNativeSdkInfo',
            'fetchNativeRelease',
            'setUser',
            'setContext',
            'setTag',
            'setExtra',
            'addBreadcrumb',
            'captureEnvelope',
          ].map((name) => ({ name, rtype: 'promise' })),
        },
        {
          name: 'CredentialStore',
          methods: ['readToken', 'writeToken', 'clearToken'].map((name) => ({
            name,
            rtype: 'promise',
          })),
        },
        {
          name: 'App',
          methods: ['getInfo', 'getState', 'addListener', 'removeListener'].map(
            (name) => ({ name, rtype: 'promise' }),
          ),
        },
        { name: 'Device', methods: [{ name: 'getInfo', rtype: 'promise' }] },
        {
          name: 'CapacitorHttp',
          methods: [{ name: 'request', rtype: 'promise' }],
        },
      ],
      nativeCallback: (
        plugin: string,
        method: string,
        options: { eventName?: string },
        callback: (event: { value: number }) => void,
      ) => {
        if (plugin === 'CapgoCompass' && method === 'addListener' && options.eventName === 'headingChange') {
          const id = `fixture-compass-listener-${++compassListenerId}`;
          compassListeners.set(id, callback);
          bridge.compassFixtureListenerCount = compassListeners.size;
          return id;
        }
        return undefined;
      },
      nativePromise: async (
        plugin: string,
        method: string,
        options: { url?: string; callbackId?: string },
      ) => {
        if (plugin === 'CapgoCompass') {
          if (method === 'startListening') {
            bridge.compassFixtureStartCount = Number(bridge.compassFixtureStartCount) + 1;
            if (bridge.compassFixtureFailStart) throw new Error('Compass unavailable');
            bridge.compassFixtureListening = true;
          }
          if (method === 'stopListening') bridge.compassFixtureListening = false;
          if (method === 'removeListener') {
            compassListeners.delete(options.callbackId!);
            bridge.compassFixtureListenerCount = compassListeners.size;
          }
          return {};
        }
        if (plugin === 'SentryCapacitor')
          return method === 'initNativeSdk'
            ? true
            : method === 'fetchNativeSdkInfo'
              ? { name: 'fixture', version: '1' }
              : {};
        if (plugin === 'CredentialStore')
          return { token: 'browser-fixture-not-a-real-token' };
        if (plugin === 'App')
          return method === 'getState'
            ? { isActive: true }
            : { version: 'test' };
        if (plugin === 'Device')
          return { model: 'Browser fixture', osVersion: 'test' };
        if (plugin === 'CapacitorHttp') {
          const response = await fetch(options.url!);
          return { status: response.status, data: await response.json() };
        }
        return {};
      },
    };
  }, { withCompass: compass, withDepth: depth });
  await page.route('https://offline-maps.test/**', async (route) => {
    if (!online) {
      await route.fulfill({
        status: 503,
        json: {},
        headers: { 'access-control-allow-origin': '*' },
      });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const data = path.includes('auth-token')
      ? { token: 'browser-fixture-not-a-real-token' }
      : path.includes('geojson') && !path.includes('projects')
        ? { type: 'FeatureCollection', features: [] }
        : [];
    await route.fulfill({
      json: data,
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAFCklEQVR4nO3WMRGAQBAEQQQhAhDx/p1AcSY+mA720s6m7rjWes2sueM/5/1sG5/P3+cLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sD8BMLPmfAB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YX8CYGbN+QD4/LAvAHx+2BcAPj/sCwCfH/YFgM8P+wLA54d9AeDzw74A8PlhXwD4/LAvAHx+2BcAPj/sCwCfH/YFgM8P+wLA54d9AeDzw74A8PlhXwD4/LAvAHx+2BcAPj/sCwCfH/YFgM8P+wLA54d9AeDzw74A8PlhXwD4/LAvAHx+2BcAPj/sCwCfH/YFgM8P+wLA54d9AeDzw/4EwMya8wHw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh/0JgJk15wPg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sTADNrzgfA54d9AeDzw74A8PlhXwD4/LAvAHx+2BcAPj/sCwCfH/YFgM8P+wLA54d9AeDzw74A8PlhXwD4/LAvAHx+2BcAPj/sCwCfH/YFgM8P+wLA54d9AeDzw74A8PlhXwD4/LAvAHx+2BcAPj/sCwCfH/YFgM8P+wLA54d9AeDzw74A8PlhXwD4/LAvAHx+2BcAPj/sCwCfH/YnAGbWnA+Azw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+wLAJ8f9gWAzw/7AsDnh30B4PPDvgDw+WFfAPj8sC8AfH7YFwA+P+xPAMysOR8Anx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftgXAD4/7AsAnx/2BYDPD/sCwOeHfQHg88O+APD5YV8A+PywLwB8ftj/ANJv2iDZH0gMAAAAAElFTkSuQmCC',
    'base64',
  );
  await page.route(
    /https:\/\/.*(arcgisonline|arcgis)\.com\/.*\/tile\//,
    (route) =>
      route.fulfill({
        body: png,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
      }),
  );
  return {
    reconnect: () => {
      online = true;
    },
  };
}

async function zoomToLocalArea(page: import('@playwright/test').Page) {
  const canvas = page.locator('.maplibregl-canvas');
  const scale = page.getByTestId('distance-scale');
  // Feed a continuous wheel gesture through MapLibre's real input handler.
  // Keyboard map navigation is intentionally disabled by the north-up contract.
  await canvas.evaluate(async (element) => {
    const rect = element.getBoundingClientRect();
    for (let frame = 0; frame < 300; frame++) {
      if (
        /^\d{1,2} m$/.test(
          document
            .querySelector('[data-testid="distance-scale"]')!
            .textContent!.trim(),
        )
      )
        break;
      element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -100,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 3,
        }),
      );
      await new Promise(requestAnimationFrame);
    }
  });
  await expect(scale).toHaveText(/^\d{1,2} m$/);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
}

test('multiple unnamed areas keep their colors through reload, menu reopening, editing and deletion', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'warning' &&
      message.text().includes('GL Driver Message') &&
      message.text().includes('GPU stall due to ReadPixels')
    )
      return;
    if (['error', 'warning'].includes(message.type()))
      errors.push(message.text());
  });
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  await page.getByRole('button', { name: 'Add new offline area' }).click();
  await zoomToLocalArea(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const first = page.getByRole('group', { name: 'Area 1', exact: true });
  const second = page.getByRole('group', { name: 'Area 2', exact: true });
  await expect(first.getByText('Downloaded', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add new offline area' }).click();
  await page
    .getByRole('button', { name: 'Resize top left corner' })
    .press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(second.getByText('Downloaded', { exact: true })).toBeVisible();
  const colors = await page
    .locator('.offline-map-color')
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(new Set(colors).size).toBe(2);
  await expect(first.getByRole('button')).toHaveCount(3);
  expect(
    await first
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label')),
      ),
  ).toEqual(['Zoom to Area 1', 'Edit Area 1', 'Delete Area 1']);
  const row = first.locator('.offline-map-row');
  // Preserve the existing 44 px actions plus 12 px top/bottom row spacing.
  await expect(row).toHaveCSS('height', '68px');
  const selection = first.getByRole('button', { name: 'Zoom to Area 1' });
  await expect(selection).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(selection).toHaveCSS('border-top-width', '0px');
  await expect(selection).toHaveCSS('padding-top', '0px');
  await expect(page.getByRole('button', { name: /Retry|Refresh/ })).toHaveCount(
    0,
  );
  await testInfo.attach('offline-map-manager', {
    body: await page.screenshot({
      path: testInfo.outputPath('offline-map-manager.png'),
    }),
    contentType: 'image/png',
  });
  await page.reload();
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  await expect(second).toBeVisible();
  expect(
    await page
      .locator('.offline-map-color')
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).backgroundColor),
      ),
  ).toEqual(colors);
  await expect(page.getByRole('button', { name: /^(Show|Hide) Area/ })).toHaveCount(0);
  const beforeZoom = await savedAreas(page);
  // Reload starts at the default world view. Selecting the saved area must
  // move the real MapLibre camera, keep the sheet open, and preserve the catalog.
  // The row's top-left padding is outside the label button's layout box.
  await row.tap({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId('distance-scale')).toHaveText(/^\d+ m$/);
  await expect(page.getByRole('dialog', { name: 'Offline Maps' })).toBeVisible();
  await second.getByRole('button', { name: 'Zoom to Area 2' }).tap();
  await expect(page.getByRole('dialog', { name: 'Offline Maps' })).toBeVisible();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(await savedAreas(page)).toEqual(beforeZoom);
  await testInfo.attach('offline-area-above-menu-portrait', {
    body: await page.screenshot({ path: testInfo.outputPath('offline-area-above-menu-portrait.png') }),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 568, height: 320 });
  await mapSizeSettled(page);
  await first.getByRole('button', { name: 'Zoom to Area 1' }).tap();
  await expect(page.getByRole('dialog', { name: 'Offline Maps' })).toBeVisible();
  await testInfo.attach('offline-area-above-menu-landscape', {
    body: await page.screenshot({ path: testInfo.outputPath('offline-area-above-menu-landscape.png') }),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await mapSizeSettled(page);
  await first.getByRole('button', { name: 'Zoom to Area 1' }).tap();
  await page.getByRole('button', { name: 'Edit Area 1' }).click();
  const corner = page.getByRole('button', { name: 'Resize top left corner' });
  await expect(corner).toBeInViewport();
  await corner.press('ArrowLeft');
  await expect(page.getByRole('dialog').getByRole('button')).toHaveText([
    'Cancel',
    'Save',
  ]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(second).toBeVisible();
  expect(
    await page
      .locator('.offline-map-color')
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).backgroundColor),
      ),
  ).toEqual(colors);
  await page
    .getByRole('button', { name: 'Delete Area 1', exact: true })
    .click();
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(second).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete Area 1', exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete area', exact: true }).click();
  await expect(page.locator('.offline-map-item')).toHaveCount(1);
  // Check the committed list immediately; Playwright's click auto-wait must not
  // hide a disabled-controls gap between consecutive deletions.
  for (const label of [
    'Edit Area 1',
    'Delete Area 1',
    'Add new offline area',
  ]) {
    expect(
      await page.getByRole('button', { name: label, exact: true }).isEnabled(),
    ).toBe(true);
  }
  await expect(page.locator('.offline-map-color')).toHaveCSS(
    'background-color',
    colors[1],
  );
  await page
    .getByRole('button', { name: 'Delete Area 1', exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete area', exact: true }).click();
  await expect(
    page.getByText('Choose an area on the map to keep offline.'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('long offline area lists scroll below fixed controls in a smaller sheet', async ({ page }, testInfo) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  await page.getByRole('button', { name: 'Add new offline area' }).click();
  await zoomToLocalArea(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Downloaded', { exact: true })).toBeVisible();
  // Expand a real saved catalog, keeping identical coverage to avoid unrelated
  // network/planner work while exercising a long list after restart.
  await expect(page.locator('.offline-map-scroll-rail')).toBeHidden();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('speleo_tiles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('offline_map_settings', 'readwrite');
        const store = tx.objectStore('offline_map_settings');
        const request = store.get('download-areas');
        request.onsuccess = () => {
          const catalog = request.result;
          const original = catalog.areas[0];
          catalog.areas = Array.from({ length: 30 }, () => {
            const areaId = crypto.randomUUID();
            return { ...original, areaId, sourceKey: `manual:${areaId}` };
          });
          catalog.revision++;
          store.put(catalog, 'download-areas');
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  await page.reload();
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Offline Maps' });
  const rows = page.getByRole('region', { name: 'Offline areas' });
  const heading = sheet.getByRole('heading', { name: 'Offline Maps' });
  const add = sheet.getByRole('button', { name: 'Add new offline area' });
  const close = sheet.getByRole('button', { name: 'Close', exact: true });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 320, height: 300 },
  ]) {
    await page.setViewportSize(viewport);
    await mapSizeSettled(page);
    await rows.evaluate((element) => { element.scrollTop = 0; });
    const height = await sheet.evaluate((element) => ({
      actual: element.getBoundingClientRect().height,
      available: element.parentElement!.clientHeight,
    }));
    const cap = Math.min(height.available - 24, Math.max(242, height.available * (viewport.width >= 768 ? 0.429 : 0.4224)));
    expect(height.actual).toBeCloseTo(cap, 0);
    const rail = sheet.locator('.offline-map-scroll-rail');
    const thumb = sheet.locator('.offline-map-scroll-thumb');
    await expect(rail).toBeVisible();
    // scrollTop changes before the browser delivers the scroll event that
    // updates the thumb. Establish its rendered starting position first.
    await expect.poll(() => thumb.evaluate((element) =>
      element.getBoundingClientRect().top - element.parentElement!.getBoundingClientRect().top,
    )).toBe(0);
    const start = await thumb.boundingBox();
    const addBox = await add.boundingBox();
    const listBox = await rows.boundingBox();
    expect(listBox!.y - (addBox!.y + addBox!.height)).toBe(8);
    const fixedControls = [heading, add, close];
    const positions = await Promise.all(fixedControls.map((control) => control.boundingBox()));
    expect(await rows.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await rows.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(68);
    await rows.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await rows.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(async () => (await thumb.boundingBox())!.y).toBeGreaterThan(start!.y);
    await expect(rail).toBeVisible();
    expect(await sheet.evaluate((element) => element.scrollTop)).toBe(0);
    const last = sheet.getByRole('group', { name: 'Area 30', exact: true });
    await expect(last.getByRole('button', { name: 'Delete Area 30', exact: true })).toBeInViewport({ ratio: 1 });
    await last.getByRole('button', { name: 'Delete Area 30', exact: true }).click();
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
    for (const [index, control] of fixedControls.entries()) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(await control.boundingBox()).toEqual(positions[index]);
    }
    // Moving away from the scroller must not hide the persistent indicator.
    await page.mouse.move(0, 0);
    await expect(thumb).toBeVisible();
    await testInfo.attach(`scrolling-areas-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ path: testInfo.outputPath(`scrolling-areas-${viewport.width}x${viewport.height}.png`) }),
      contentType: 'image/png',
    });
  }
  // A real persistence failure must not consume the fixed header and collapse
  // the row viewport on the shortest layout. Fail one catalog write only.
  const storageError = 'Offline map settings could not be saved because the device storage is unavailable. Free some space and try again; your saved areas have been kept.';
  await page.evaluate((message) => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'offline_map_settings' && key === 'download-areas') {
        IDBObjectStore.prototype.put = put;
        throw new Error(message);
      }
      return put.call(this, value, key);
    };
  }, storageError);
  await sheet.getByRole('button', { name: 'Delete Area 30', exact: true }).click();
  await sheet.getByRole('button', { name: 'Delete area', exact: true }).click();
  await expect(rows.getByRole('alert')).toHaveText(storageError);
  expect(await rows.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(68);
  await rows.getByRole('alert').scrollIntoViewIfNeeded();
  await expect(rows.getByRole('alert')).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  const lastDelete = sheet.getByRole('button', { name: 'Delete Area 30', exact: true });
  await lastDelete.scrollIntoViewIfNeeded();
  await expect(lastDelete).toBeInViewport({ ratio: 1 });
  await expect(sheet.getByRole('group', { name: /^Area \d+$/ })).toHaveCount(30);
  await add.click();
  await expect(page.getByRole('dialog', { name: 'Select offline area' })).toBeVisible();
});

for (const layout of [
  { name: 'small portrait', width: 320, height: 568 },
  { name: 'landscape', width: 568, height: 320 },
  { name: 'keyboard', width: 320, height: 300 },
]) {
  test(`area controls remain reachable: ${layout.name}`, async ({
    page,
  }, testInfo) => {
    await fixture(page);
    await page.setViewportSize(layout);
    await page.goto('/dashboard');
    await page
      .getByRole('button', { name: 'Offline Maps', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add new offline area' }).click();
    const initialCancel = page
      .getByRole('dialog', { name: 'Select offline area' })
      .getByRole('button', { name: 'Cancel', exact: true });
    await expect(initialCancel).toBeInViewport({ ratio: 1 });
    await initialCancel.tap();
    await page.getByRole('button', { name: 'Add new offline area' }).tap();

    for (const name of [
      'top left',
      'top right',
      'bottom left',
      'bottom right',
    ]) {
      const handle = page.getByRole('button', {
        name: `Resize ${name} corner`,
      });
      await expect(handle).toBeInViewport({ ratio: 1 });
      await handle.tap();
    }
    await zoomToLocalArea(page);
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Select offline area' });
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeVisible();
    await expect(cancel).toBeInViewport({ ratio: 1 });
    const save = page.getByRole('button', { name: 'Save', exact: true });

    await expect(save).toBeInViewport({ ratio: 1 });
    await testInfo.attach('selection-layout', {
      body: await page.screenshot({
        path: testInfo.outputPath('selection-layout.png'),
      }),
      contentType: 'image/png',
    });
    await cancel.tap();
    await page.getByRole('button', { name: 'Add new offline area' }).tap();
    await save.tap();
    await expect(
      page.getByRole('group', { name: 'Area 1', exact: true }),
    ).toBeVisible();
  });
}

test('offline intent survives restart and downloads after explicit reconnect', async ({
  page,
}) => {
  const network = await fixture(page, false);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Go Offline', exact: true }).click();
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  await page.getByRole('button', { name: 'Add new offline area' }).click();
  await zoomToLocalArea(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('Waiting for connection', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Go Offline', exact: true }).click();
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  await expect(
    page
      .getByRole('group', { name: 'Area 1', exact: true })
      .getByText('Waiting for connection', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  network.reconnect();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Go Online', exact: true }).click();
  await page.getByText('Offline Maps', { exact: true }).click();
  await expect(
    page
      .getByRole('group', { name: 'Area 1', exact: true })
      .getByText('Downloaded', { exact: true }),
  ).toBeVisible();
});

test('map controls share geometry and stay below Layers with safe-area insets', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px'),
  );
  const location = page.getByTestId('my-location-button');
  const layers = page.getByTestId('map-layer-button');
  const downloads = page.getByRole('button', {
    name: 'Offline Maps',
    exact: true,
  });
  const compass = page.getByRole('button', { name: 'Show compass', exact: true });
  await expect(downloads).toBeVisible();
  const controls = [];
  for (const control of [location, layers, downloads, compass]) {
    controls.push(
      await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          radius: style.borderRadius,
          background: style.backgroundColor,
        };
      }),
    );
  }
  for (const [index, control] of controls.entries()) {
    expect(control.width).toBe(44);
    expect(control.height).toBe(44);
    expect(control.radius).toBe(controls[0].radius);
    expect(control.background).toBe(controls[0].background);
    expect(control.x).toBe(controls[0].x);
    if (index) expect(control.y).toBe(controls[index - 1].y + 52);
  }
  await layers.tap();
  const menu = page.getByTestId('map-layer-menu');
  await expect(menu).toBeVisible();
  const point = controls[2];
  expect(
    await page.evaluate(
      ({ x, y }) =>
        !!document
          .elementFromPoint(x + 22, y + 22)
          ?.closest('[data-testid="map-layer-menu"]'),
      point,
    ),
  ).toBe(true);
  await page.getByTestId('map-layer-option-esri-satellite').tap();
  await expect(menu).not.toBeVisible();
  await downloads.tap();
  await expect(
    page.getByRole('dialog', { name: 'Offline Maps' }),
  ).toBeVisible();
});

async function emitCompassHeading(page: import('@playwright/test').Page, heading: number) {
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { compassFixtureListening: boolean }
  ).compassFixtureListening)).toBe(true);
  await page.evaluate((value) => window.dispatchEvent(
    new CustomEvent('fixture-compass-heading', { detail: value }),
  ), heading);
}

test('compass toggles live headings independently of location and restores after area editing', async ({ page }) => {
  // Only native sensor delivery is emulated; the shipped service, hook, control,
  // map and rendering remain real. This does not establish device accuracy.
  await fixture(page, true, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  const dial = page.getByTestId('map-compass');
  const show = page.getByRole('button', { name: 'Show compass', exact: true });
  const hide = page.getByRole('button', { name: 'Hide compass', exact: true });
  const heading = page.getByTestId('compass-heading');
  await expect(show).toHaveAttribute('aria-pressed', 'false');
  await expect(dial).toHaveCount(0);
  await show.tap();
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('compass-toggle-slash')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Compass heading unavailable', exact: true })).toBeVisible();
  await emitCompassHeading(page, 260);
  await expect(heading).toHaveText('260°');
  await expect(page.getByRole('img', { name: 'Compass heading 260 degrees, W', exact: true })).toBeVisible();
  await expect(page.getByTestId('my-location-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(dial.locator('svg text')).toHaveCount(8);
  for (const direction of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) {
    await expect(dial.locator('svg text').filter({ hasText: new RegExp(`^${direction}$`) }).first()).toBeVisible();
  }
  await emitCompassHeading(page, 337.5);
  await expect(dial.locator('.map-compass__direction')).toHaveText('NNW');
  await expect(dial.locator('svg text').filter({ hasText: /^NNW$/ })).toHaveCount(0);
  await expect(page.getByTestId('compass-heading-pointer')).toHaveCSS('transition-duration', '0s');
  await emitCompassHeading(page, 359);
  await expect(heading).toHaveText('359°');
  await emitCompassHeading(page, 1);
  await expect(heading).toHaveText('1°');
  await expect(page.getByRole('img', { name: 'Compass heading 1 degrees, N', exact: true })).toBeVisible();
  await hide.tap();
  await expect(dial).toHaveCount(0);
  await expect(show).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('compass-toggle-slash')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { compassFixtureListening: boolean }
  ).compassFixtureListening)).toBe(false);
  await show.tap();
  await expect(page.getByRole('img', { name: 'Compass heading unavailable', exact: true })).toBeVisible();
  await emitCompassHeading(page, 260);
  await expect(heading).toHaveText('260°');
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).tap();
  await page.getByRole('button', { name: 'Add new offline area' }).tap();
  await expect(dial).toHaveCount(0);
  await expect(hide).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Select offline area' }).getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(dial).toBeVisible();
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
});

async function compassSensorState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const bridge = window as unknown as {
      compassFixtureListening: boolean;
      compassFixtureListenerCount: number;
    };
    return { listening: bridge.compassFixtureListening, listeners: bridge.compassFixtureListenerCount };
  });
}

test('compass supports keyboard activation, focus visibility and complete listener cleanup', async ({ page }) => {
  await fixture(page, true, true);
  await page.goto('/dashboard');
  const toggle = page.getByTestId('compass-toggle');
  await toggle.focus();
  await toggle.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS('outline-style', 'solid');
  await expect(toggle).toHaveCSS('outline-width', '2px');
  await expect(toggle).toHaveAttribute('aria-label', 'Hide compass');
  await emitCompassHeading(page, 22.5);
  await expect(page.getByRole('img', { name: 'Compass heading 23 degrees, NNE', exact: true })).toBeVisible();
  await expect.poll(() => compassSensorState(page)).toEqual({ listening: true, listeners: 1 });
  await toggle.press('Space');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-label', 'Show compass');
  await expect(page.getByTestId('map-compass')).toHaveCount(0);
  await expect(page.locator('.map-compass-control')).toHaveCount(0);
  await expect.poll(() => compassSensorState(page)).toEqual({ listening: false, listeners: 0 });
  await toggle.press('Enter');
  await expect(page.getByRole('img', { name: 'Compass heading unavailable', exact: true })).toBeVisible();
  await emitCompassHeading(page, 90);
  await expect(page.getByRole('img', { name: 'Compass heading 90 degrees, E', exact: true })).toBeVisible();
  await expect(page.locator('.map-compass-control')).toHaveCount(1);
  await expect.poll(() => compassSensorState(page)).toEqual({ listening: true, listeners: 1 });
});

test('compass releases its native listener off-route and restores its selection with a fresh heading', async ({ page }) => {
  await fixture(page, true, true);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
  await emitCompassHeading(page, 260);
  await expect(page.getByTestId('compass-heading')).toHaveText('260°');
  await page.getByRole('tab', { name: 'Settings', exact: true }).tap();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('map-compass')).not.toBeVisible();
  await expect.poll(() => compassSensorState(page)).toEqual({ listening: false, listeners: 0 });
  // A native delivery while Dashboard is hidden must not seed the next session.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-compass-heading', { detail: 90 })));
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Hide compass', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: 'Compass heading unavailable', exact: true })).toBeVisible();
  await expect.poll(() => compassSensorState(page)).toEqual({ listening: true, listeners: 1 });
  await emitCompassHeading(page, 180);
  await expect(page.getByRole('img', { name: 'Compass heading 180 degrees, S', exact: true })).toBeVisible();
  await expect(page.locator('.map-compass-control')).toHaveCount(1);
});

test('compass keeps an unavailable native sensor neutral and retries after hide and show', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page, true, true);
  await page.goto('/dashboard');
  await page.evaluate(() => { (window as unknown as { compassFixtureFailStart: boolean }).compassFixtureFailStart = true; });
  await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { compassFixtureStartCount: number }).compassFixtureStartCount)).toBe(1);
  await expect.poll(() => compassSensorState(page)).toEqual({ listening: false, listeners: 0 });
  await expect(page.getByRole('img', { name: 'Compass heading unavailable', exact: true })).toBeVisible();
  await expect(page.getByTestId('map-compass').getByText('No heading', { exact: true })).toBeVisible();
  await expect(page.getByTestId('compass-heading-pointer')).toHaveCount(0);
  await expect(page.getByTestId('my-location-button')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Hide compass', exact: true }).tap();
  await page.evaluate(() => { (window as unknown as { compassFixtureFailStart: boolean }).compassFixtureFailStart = false; });
  await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
  await emitCompassHeading(page, 292.5);
  await expect(page.getByRole('img', { name: 'Compass heading 293 degrees, WNW', exact: true })).toBeVisible();
  await expect.poll(() => compassSensorState(page)).toEqual({ listening: true, listeners: 1 });
  expect(errors).toEqual([]);
});

test('compass animates across north without rotating through south and respects a changed motion preference', async ({ page }) => {
  await fixture(page, true, true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
  await emitCompassHeading(page, 359);
  const pointer = page.getByTestId('compass-heading-pointer');
  await expect(pointer).toHaveCSS('transition-duration', '0.16s');
  // Observe the browser's actual CSS interpolation at its midpoint. Pausing
  // on transitionrun avoids relying on machine speed or a timed screenshot.
  for (const heading of [1, 359]) {
    const midpoint = await pointer.evaluate((element, nextHeading) => new Promise<{ a: number; b: number }>((resolve) => {
      void getComputedStyle(element).transform;
      element.addEventListener('transitionrun', () => {
        const animation = element.getAnimations()[0];
        animation.pause();
        animation.currentTime = Number(animation.effect!.getComputedTiming().duration) / 2;
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        animation.finish();
        resolve({ a: matrix.a, b: matrix.b });
      }, { once: true });
      window.dispatchEvent(new CustomEvent('fixture-compass-heading', { detail: nextHeading }));
    }), heading);
    expect(midpoint.a).toBeCloseTo(1, 3);
    expect(midpoint.b).toBeCloseTo(0, 3);
    await expect(page.getByTestId('compass-heading')).toHaveText(`${heading}°`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pointer).toHaveCSS('transition-duration', '0s');
  await emitCompassHeading(page, 90);
  await expect(page.getByTestId('compass-heading')).toHaveText('90°');
  expect(await pointer.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test('a real drag beginning on the compass pans the underlying map without changing device heading', async ({ page }) => {
  await fixture(page, true, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
  await emitCompassHeading(page, 260);
  await mapSizeSettled(page);
  // The production distance scale derives its rendered width from MapLibre's
  // latitude, so its change proves that the gesture moved the actual map.
  const scale = page.getByTestId('distance-scale').locator('[style]');
  const originalWidth = await scale.evaluate((element) => element.getBoundingClientRect().width);
  const box = (await page.getByTestId('map-compass').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 180, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(await scale.evaluate((element) => element.getBoundingClientRect().width) - originalWidth)).toBeGreaterThan(1);
  await expect(page.getByRole('img', { name: 'Compass heading 260 degrees, W', exact: true })).toBeVisible();
});

test('compass stays within forty percent of the actual map width through viewport and container resizes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page, true, true);
  await page.setViewportSize({ width: 840, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
  await emitCompassHeading(page, 292.5);
  const map = page.locator('.maplibregl-map');
  const dial = page.getByTestId('map-compass');
  const assertSize = async (diameter: number) => {
    await expect(dial).toHaveCSS('width', `${diameter}px`);
    await expect(dial).toHaveCSS('height', `${diameter}px`);
    const mapBox = (await map.boundingBox())!;
    const compassBox = (await dial.boundingBox())!;
    expect(compassBox.width).toBeLessThanOrEqual(mapBox.width * 0.4);
    expect(compassBox.width).toBeLessThanOrEqual(172);
    await expect(page.getByRole('img', { name: 'Compass heading 293 degrees, WNW', exact: true })).toBeVisible();
    await expect(page.locator('.map-compass-control')).toHaveCount(1);
    await expect.poll(() => compassSensorState(page)).toEqual({ listening: true, listeners: 1 });
  };
  await assertSize(172);
  await page.setViewportSize({ width: 320, height: 568 });
  await assertSize(128);
  await page.setViewportSize({ width: 840, height: 844 });
  await assertSize(172);
  // Change only the actual MapLibre container, keeping the viewport at 840px.
  // A 40vw implementation would incorrectly keep the dial 172px wide here.
  await map.evaluate((element) => { element.style.width = '300.5px'; });
  await assertSize(120);
  await map.evaluate((element) => { element.style.width = '100%'; });
  await assertSize(172);
  expect(await page.evaluate(() => (window as unknown as { compassFixtureStartCount: number }).compassFixtureStartCount)).toBe(1);
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 320, height: 480 },
  { width: 320, height: 480, depth: true },
  { width: 320, height: 400, depth: true },
  { width: 400, height: 480, depth: true },
  { width: 401, height: 480, depth: true },
  { width: 568, height: 541, depth: true },
  { width: 568, height: 320 },
  { width: 568, height: 320, depth: true },
]) {
  const depth = 'depth' in viewport && viewport.depth;
  test(`compass stays above sources and clear of map controls at ${viewport.width}x${viewport.height}${depth ? ' in depth mode' : ''}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await fixture(page, true, true, depth);
    await page.setViewportSize(viewport);
    await page.goto('/dashboard');
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
      document.documentElement.style.setProperty('--safe-area-inset-right', '12px');
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '20px');
    });
    await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
    await emitCompassHeading(page, 260);
    const dial = page.getByTestId('map-compass');
    await expect(dial).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('compass-heading')).toHaveText('260°');
    const attribution = page.locator('.maplibregl-ctrl-attrib');
    const attributionButton = attribution.locator('.maplibregl-ctrl-attrib-button');
    if (!await attribution.evaluate((element) => element.classList.contains('maplibregl-compact-show'))) {
      await attributionButton.tap();
    }
    await expect(attribution.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
    // Compare real rendered rectangles, including expanded/wrapped source text.
    await expect.poll(async () => {
      const compassBox = await dial.boundingBox();
      const sourcesBox = await attribution.boundingBox();
      return compassBox !== null && sourcesBox !== null && compassBox.y + compassBox.height <= sourcesBox.y;
    }).toBe(true);
    const compassBox = (await dial.boundingBox())!;
    const sourcesBox = (await attribution.boundingBox())!;
    const mapBox = (await page.locator('.maplibregl-map').boundingBox())!;
    expect(compassBox.width).toBeGreaterThan(100);
    expect(compassBox.height).toBe(compassBox.width);
    expect(compassBox.width).toBeLessThanOrEqual(172);
    expect(compassBox.width).toBeLessThanOrEqual(mapBox.width * 0.4);
    expect(compassBox.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(compassBox.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(compassBox.x + compassBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
    for (const obstacle of [
      page.getByTestId('my-location-button'),
      page.getByTestId('map-layer-button'),
      page.getByRole('button', { name: 'Offline Maps', exact: true }),
      page.getByRole('button', { name: 'Hide compass', exact: true }),
      page.getByTestId('distance-scale'),
      ...(depth ? [page.getByTestId('depth-gauge')] : []),
    ]) {
      const box = (await obstacle.boundingBox())!;
      expect(
        compassBox.x + compassBox.width <= box.x || box.x + box.width <= compassBox.x ||
        compassBox.y + compassBox.height <= box.y || box.y + box.height <= compassBox.y,
        `Compass ${JSON.stringify(compassBox)} overlaps ${obstacle} ${JSON.stringify(box)}`,
      ).toBe(true);
      expect(
        sourcesBox.x + sourcesBox.width <= box.x || box.x + box.width <= sourcesBox.x ||
        sourcesBox.y + sourcesBox.height <= box.y || box.y + box.height <= sourcesBox.y,
        `Sources ${JSON.stringify(sourcesBox)} overlap ${obstacle} ${JSON.stringify(box)}`,
      ).toBe(true);
    }
    expect(await dial.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.classList.contains('maplibregl-canvas');
    })).toBe(true);
    if (depth) {
      const gaugeBox = (await page.getByTestId('depth-gauge').boundingBox())!;
      for (const control of [
        page.getByTestId('my-location-button'),
        page.getByTestId('map-layer-button'),
        page.getByRole('button', { name: 'Offline Maps', exact: true }),
        page.getByRole('button', { name: 'Hide compass', exact: true }),
      ]) {
        const box = (await control.boundingBox())!;
        expect(
          gaugeBox.x + gaugeBox.width <= box.x || box.x + box.width <= gaugeBox.x ||
          gaugeBox.y + gaugeBox.height <= box.y || box.y + box.height <= gaugeBox.y,
        ).toBe(true);
      }
    }
    await testInfo.attach(`compass-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ path: testInfo.outputPath(`compass-${viewport.width}x${viewport.height}.png`) }),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Hide compass', exact: true }).tap();
    await expect(dial).toHaveCount(0);
    await expectMapControlClearance(page);
    expect(errors).toEqual([]);
  });
}

async function expectMapControlClearance(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() => {
    const overlays = [...document.querySelectorAll('.map-control-stack, .dashboard-map-depth-gauge, .dashboard-map-distance-scale')];
    const controls = [...document.querySelectorAll('.map-compass, .maplibregl-ctrl-attrib')];
    return controls.flatMap((control) => {
      const a = control.getBoundingClientRect();
      return overlays.filter((overlay) => {
        const b = overlay.getBoundingClientRect();
        return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      }).map((overlay) => `${control.className} overlaps ${overlay.className}`);
    });
  })).toEqual([]);
}

test('map controls reflow on credit, compass, depth and viewport changes without observer errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page, true, true);
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto('/dashboard');
  const attribution = page.locator('.maplibregl-ctrl-attrib');
  const attributionButton = attribution.locator('.maplibregl-ctrl-attrib-button');
  await expect(attribution).toBeVisible();
  await expectMapControlClearance(page);
  if (!await attribution.evaluate((element) => element.classList.contains('maplibregl-compact-show'))) {
    await attributionButton.tap();
  }
  await expect(attribution.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
  await expectMapControlClearance(page);
  await page.getByRole('button', { name: 'Show compass', exact: true }).tap();
  await emitCompassHeading(page, 260);
  await expectMapControlClearance(page);
  await attributionButton.tap();
  await expect(attribution.locator('.maplibregl-ctrl-attrib-inner')).not.toBeVisible();
  await expectMapControlClearance(page);
  await attributionButton.tap();
  await expect(attribution.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
  await page.getByRole('tab', { name: 'Settings', exact: true }).tap();
  await page.getByRole('combobox', { name: 'Color mode', exact: true }).selectOption('depth');
  await page.getByRole('tab', { name: 'Map', exact: true }).tap();
  await expect(page.getByTestId('depth-gauge')).toBeVisible();
  await expectMapControlClearance(page);
  for (const viewport of [{ width: 414, height: 480 }, { width: 568, height: 541 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expectMapControlClearance(page);
  }
  const corner = page.locator('.maplibregl-ctrl-bottom-right');
  await expect(corner).toHaveCSS('right', '0px');
  await expect(corner).toHaveCSS('bottom', '0px');
  await page.getByRole('button', { name: 'Hide compass', exact: true }).tap();
  await expect(page.locator('.map-compass-control')).toHaveCount(0);
  await expectMapControlClearance(page);
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).tap();
  await page.getByRole('button', { name: 'Add new offline area', exact: true }).tap();
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Show compass', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 568, height: 320 });
  await expectMapControlClearance(page);
  expect(errors).toEqual([]);
});

async function savedAreas(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('speleo_tiles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<
        import('../../src/types/downloadArea').DownloadArea[]
      >((resolve, reject) => {
        const request = db
          .transaction('offline_map_settings')
          .objectStore('offline_map_settings')
          .get('download-areas');
        request.onsuccess = () => resolve(request.result.areas);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

async function mapSizeSettled(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.locator('.maplibregl-canvas').evaluate((canvas) => {
        const container = canvas.closest('.maplibregl-map')!;
        return (
          canvas.clientHeight === container.clientHeight &&
          canvas.clientWidth === container.clientWidth
        );
      }),
    )
    .toBe(true);
}

test('editing and resizing the viewport never change saved bounds without a gesture', async ({
  page,
}, testInfo) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '47px');
    document.documentElement.style.setProperty(
      '--safe-area-inset-bottom',
      '34px',
    );
  });
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  await page.getByRole('button', { name: 'Add new offline area' }).click();
  await zoomToLocalArea(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Downloaded', { exact: true })).toBeVisible();
  const [original] = await savedAreas(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.getByRole('button', { name: 'Edit Area 1' }).click();
    await expect(page.getByTestId('app-tab-bar')).toHaveCount(0);
    await page.setViewportSize(viewport);
    await mapSizeSettled(page);
    await expect(page.getByLabel('Selected map area')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Edit Area 1' }),
    ).toBeVisible();
    expect((await savedAreas(page))[0]).toEqual(original);
  }
  await page.getByRole('button', { name: 'Edit Area 1' }).click();
  await mapSizeSettled(page);
  await page.getByRole('button', { name: 'Resize top left corner' }).tap();
  await testInfo.attach('aligned-edit-boundary', {
    body: await page.screenshot({
      path: testInfo.outputPath('aligned-edit-boundary.png'),
    }),
    contentType: 'image/png',
  });
  await page
    .getByRole('button', { name: 'Resize top left corner' })
    .press('ArrowRight');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Area 1' })).toBeVisible();
  const [edited] = await savedAreas(page);
  expect(edited.topLeft[0]).toBeGreaterThan(original.topLeft[0]);
  expect(edited.topLeft[1]).toBeCloseTo(original.topLeft[1], 9);
  expect(edited.bottomRight[0]).toBeCloseTo(original.bottomRight[0], 9);
  expect(edited.bottomRight[1]).toBeCloseTo(original.bottomRight[1], 9);
  expect(edited.revision).toBe(original.revision + 1);
});

test('layer switches reuse the union worker plan and preserve satellite coverage', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    const state = window as unknown as { offlinePlannerStarts: number };
    state.offlinePlannerStarts = 0;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'offline-map-planner') state.offlinePlannerStarts++;
      }
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Offline Maps', exact: true }).click();
  await page.getByRole('button', { name: 'Add new offline area' }).click();
  await zoomToLocalArea(page);
  await expect(page.getByText('1 map layer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Downloaded', { exact: true })).toBeVisible();
  const originalArea = (await savedAreas(page))[0];
  const generations = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('speleo_tiles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ id: string; planId: string; layerId: string; status: string }>>((resolve, reject) => {
        const request = db.transaction('offline_map_generations').objectStore('offline_map_generations').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
  const [satellite] = await generations();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const hill = page.getByTestId('layer-toggle-esri-world-hillshade');
  const dark = page.getByTestId('layer-toggle-esri-world-hillshade-dark');
  const satelliteProgress = page.getByTestId('layer-sync-status-esri-satellite');
  for (const toggle of [hill, dark, hill, hill]) {
    await toggle.click();
    await expect(satelliteProgress).toContainText('100%');
  }
  await expect(page.getByTestId('layer-sync-status-esri-world-hillshade')).toContainText('100%');
  await expect(page.getByTestId('layer-sync-status-esri-world-hillshade-dark')).toContainText('100%');
  await expect.poll(async () => (await generations()).filter((g) => g.status === 'active').length).toBe(3);
  const final = await generations();
  expect(final.find((g) => g.layerId === 'esri-satellite')).toEqual(satellite);
  expect(new Set(final.map((g) => g.planId))).toEqual(new Set([satellite.planId]));
  expect(await page.evaluate(() => (window as unknown as { offlinePlannerStarts: number }).offlinePlannerStarts)).toBe(1);
  const area = (await savedAreas(page))[0];
  expect(area.revision).toBe(originalArea.revision);
  expect(area.topLeft).toEqual(originalArea.topLeft);
  expect(area.bottomRight).toEqual(originalArea.bottomRight);
  expect(area.layerIds).toHaveLength(3);
});
