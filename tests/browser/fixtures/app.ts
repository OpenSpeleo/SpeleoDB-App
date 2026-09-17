// The shipped app has a native-only credential vault. Emulate only its bridge
// for this fixture; application routing, map, IndexedDB, and downloads stay real.
export async function fixture(
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
        { name: 'GisGeometryHttp', methods: ['get', 'cancel'].map(name => ({ name, rtype: 'promise' })) },
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
        options: { url?: string; callbackId?: string; headers?: Record<string, string> },
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
        if (plugin === 'GisGeometryHttp') {
          if (method === 'cancel') return {};
          // Emulate native transport, whose requests are not browser CORS
          // requests. Header/cookie enforcement is covered by native tests.
          const response = await fetch(options.url!, { credentials: 'omit', redirect: 'manual' });
          return { status: response.status, body: await response.text(), contentType: response.headers.get('content-type') ?? '' };
        }
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
    disconnect: () => { online = false; },
    reconnect: () => {
      online = true;
    },
  };
}
