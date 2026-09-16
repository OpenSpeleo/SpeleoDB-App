import { expect, test } from '@playwright/test';

// The shipped app has a native-only credential vault. Emulate only its bridge
// for this fixture; application routing, map, IndexedDB, and downloads stay real.
async function fixture(
  page: import('@playwright/test').Page,
  connected = true,
) {
  let online = connected;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    if (!localStorage.getItem('speleo_user_preferences'))
      localStorage.setItem(
        'speleo_user_preferences',
        JSON.stringify({
          hasStoredSession: true,
          instance: 'https://offline-maps.test',
          email: 'fixture@example.test',
          hasCompletedGuidedTour: true,
        }),
      );
    const bridge = window as unknown as Record<string, unknown>;
    bridge.CapacitorCustomPlatform = { name: 'ios' };
    bridge.Capacitor = {
      PluginHeaders: [
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
      nativePromise: async (
        plugin: string,
        method: string,
        options: { url?: string },
      ) => {
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
  });
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

test('multiple unnamed areas keep their colors through reload, visibility, editing and deletion', async ({
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
  ).toEqual(['Hide Area 1 on map', 'Edit Area 1', 'Delete Area 1']);
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
  await page.getByRole('button', { name: 'Hide Area 1 on map' }).click();
  await expect(
    page.getByRole('button', { name: 'Show Area 1 on map' }),
  ).toHaveAttribute('aria-pressed', 'false');
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
    'Hide Area 1 on map',
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
  await expect(downloads).toBeVisible();
  const controls = [];
  for (const control of [location, layers, downloads]) {
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
