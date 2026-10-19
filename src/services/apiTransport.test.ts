import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, v2UserAuthTokenRetrieve } from '@speleodb/api';
import { createMobileApiTransport } from './apiTransport';
import { HttpClient } from './HttpClient';
import { SpeleoDBService } from './SpeleoDBService';

const INSTANCE = 'https://www.speleodb.org';
const TOKEN = 'current-token';
const GPX = '<gpx><wpt lat="1" lon="2"><name>Entrée 🦇</name></wpt></gpx>';

function nativeService() {
  const request = vi.fn().mockResolvedValue({
    status: 200, data: { landmarks_created: 1, gps_tracks_created: 0 },
    headers: { 'content-type': 'application/json' }, url: INSTANCE,
  });
  const http = new HttpClient({
    isNativePlatform: () => true,
    getNativeUserAgent: async () => 'SpeleoDB-iOS/test',
    nativeHttp: { request },
  });
  return { service: new SpeleoDBService(http), request };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('generated operations through the mobile transport', () => {
  it('rejects the unsupported no-deadline policy before native network admission', async () => {
    const request = vi.fn();
    const metadata = vi.fn(async () => 'SpeleoDB-iOS/test');
    const http = new HttpClient({
      isNativePlatform: () => true,
      getNativeUserAgent: metadata,
      nativeHttp: { request },
    });
    const client = createApiClient({
      baseUrl: INSTANCE,
      timeoutMs: null,
      transport: createMobileApiTransport(http),
    });
    await expect(v2UserAuthTokenRetrieve(undefined, { client }))
      .rejects.toThrow('The mobile API transport requires a finite timeoutMs.');
    expect(metadata).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('sends browser JSON exactly once and prevents credential redirects', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ user: 'a@b.com', token: TOKEN }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ));
    const service = new SpeleoDBService(new HttpClient({ isNativePlatform: () => false }));
    const response = await service.authenticate(INSTANCE, 'a@b.com', 'quoted"password');
    expect(response.status).toBe(201);
    expect(response.data).toEqual({ user: 'a@b.com', token: TOKEN });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${INSTANCE}/api/v2/user/auth-token/`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@b.com', password: 'quoted"password' });
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
  });

  it('passes serialized JSON to Capacitor exactly once with the current token', async () => {
    const { service, request } = nativeService();
    await service.updateGpsTrack(INSTANCE, TOKEN, 'track 1', { name: 'New', color: '#123456' });
    const [native] = request.mock.calls[0];
    expect(native.url).toBe(`${INSTANCE}/api/v2/gps_tracks/track%201/`);
    expect(native.method).toBe('PATCH');
    expect(typeof native.data).toBe('string');
    expect(JSON.parse(native.data)).toEqual({ name: 'New', color: '#123456' });
    expect(native.headers.Authorization).toBe(`Token ${TOKEN}`);
    expect(native.disableRedirects).toBe(true);
  });

  it('converts generated GPX FormData to a native UTF-8 body with its filename and collection', async () => {
    const { service, request } = nativeService();
    await service.uploadGpx(INSTANCE, TOKEN, GPX, 'entrée.gpx', 'collection-id');
    expect(request).toHaveBeenCalledOnce();
    const [native] = request.mock.calls[0];
    const boundary = native.headers['Content-Type'].split('boundary=')[1];
    expect(native.url).toBe(`${INSTANCE}/api/v2/import/gpx/`);
    expect(native.method).toBe('PUT');
    expect(native.headers.Authorization).toBe(`Token ${TOKEN}`);
    expect(native.data).toContain('name="collection"\r\n\r\ncollection-id\r\n');
    expect(native.data).toContain('name="file"; filename="entrée.gpx"\r\n');
    expect(native.data).toContain(`Content-Type: application/gpx+xml\r\n\r\n${GPX}\r\n`);
    expect(native.data).toMatch(new RegExp(`--${boundary}--\\r\\n$`));
    expect(native.disableRedirects).toBe(true);
  });

  it('rejects unsafe generated multipart metadata before native network admission', async () => {
    const { service, request } = nativeService();
    await expect(service.uploadGpx(INSTANCE, TOKEN, GPX, 'track.gpx', 'id\r\nInjected: yes'))
      .rejects.toMatchObject({ name: 'MultipartPayloadError' });
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels while the generated GPX file is being read and never sends it', async () => {
    const { service, request } = nativeService();
    const controller = new AbortController();
    const originalRead = FileReader.prototype.readAsText;
    const read = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, file, encoding) {
      originalRead.call(this, file, encoding);
      controller.abort();
    });
    await expect(service.uploadGpx(INSTANCE, TOKEN, GPX, 'track.gpx', undefined, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it('includes native header preparation in the deadline and cannot publish late work', async () => {
    vi.useFakeTimers();
    let resolveMetadata!: (value: string) => void;
    const metadata = new Promise<string>((resolve) => { resolveMetadata = resolve; });
    const request = vi.fn();
    const service = new SpeleoDBService(new HttpClient({
      isNativePlatform: () => true,
      getNativeUserAgent: () => metadata,
      nativeHttp: { request },
    }));
    const result = service.validateToken(INSTANCE, TOKEN, { timeoutMs: 50 });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    resolveMetadata('SpeleoDB-iOS/test');
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller cancellation through the generated client into fetch', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      receivedSignal = options?.signal ?? undefined;
      controller.abort();
      throw receivedSignal?.reason;
    });
    const service = new SpeleoDBService(new HttpClient({ isNativePlatform: () => false }));
    await expect(service.getProjectsGeoJSON(INSTANCE, TOKEN, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('keeps GIS on the cookie-free native plugin and preserves an HTML denial', async () => {
    const get = vi.fn().mockResolvedValue({ status: 403, contentType: 'text/html', body: '<html>Denied</html>' });
    const request = vi.fn();
    const service = new SpeleoDBService(new HttpClient({
      isNativePlatform: () => true,
      getNativeUserAgent: async () => undefined,
      gisGeometryHttp: { get, cancel: vi.fn().mockResolvedValue(undefined) },
      nativeHttp: { request },
    }));
    const response = await service.getGisGeometries(INSTANCE, TOKEN);
    expect(response.status).toBe(403);
    expect(get).toHaveBeenCalledWith(expect.objectContaining({
      url: `${INSTANCE}/api/v2/gis-geometries/`,
      headers: { Accept: 'application/json', Authorization: `Token ${TOKEN}` },
    }));
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves an empty native delete response', async () => {
    const { service, request } = nativeService();
    request.mockResolvedValue({ status: 204, data: '', headers: {}, url: INSTANCE });
    const response = await service.deleteGpsTrack(INSTANCE, TOKEN, 'track-id');
    expect(response.status).toBe(204);
    expect(response.data).toBeUndefined();
  });
});
