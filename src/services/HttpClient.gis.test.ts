import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, type HttpRequest } from './HttpClient';
import type { GisGeometryHttpPlugin } from './GisGeometryHttp';

const url = 'https://example.test/api/v2/gis-geometries/';
const request: HttpRequest = {
  url, method: 'GET', headers: { Authorization: 'Token intended-account', Accept: 'application/json' },
  requireJson: true, cookiePolicy: 'omit',
};
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('GIS JSON GET transport', () => {
  it('omits web cookies, denies redirects and parses JSON without a response envelope', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
    const response = await new HttpClient({ isNativePlatform: () => false }).request(request);
    expect(response).toEqual({ status: 200, data: [], contentType: 'application/json; charset=utf-8' });
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({
      method: 'GET', credentials: 'omit', redirect: 'manual', headers: expect.objectContaining(request.headers),
    }));
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it.each([403, 404, 406, 500])('preserves HTTP %s without parsing an error body', async (status) => {
    const response = new Response('<html>private server detail</html>', {
      status, headers: { 'Content-Type': 'text/html' },
    });
    const read = vi.spyOn(response, 'text');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    expect(await new HttpClient({ isNativePlatform: () => false }).request(request))
      .toEqual({ status, data: null, contentType: 'text/html' });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])('cancels an unread HTTP %s body without waiting for its transport cleanup', async (status) => {
    let finishCancellation!: () => void;
    const cancelled = new Promise<void>((resolve) => { finishCancellation = resolve; });
    const cancel = vi.fn(() => cancelled);
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
      status, headers: { 'Content-Type': 'text/html' },
    }));
    try {
      expect(await new HttpClient({ isNativePlatform: () => false }).request(request))
        .toEqual({ status, data: null, contentType: 'text/html' });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      finishCancellation();
      await body.cancel();
    }
  });

  it('preserves denial status when discarded-body cancellation rejects', async () => {
    const cancel = vi.fn(async () => { throw new Error('Transport cleanup failed'); });
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 403 }));
    expect(await new HttpClient({ isNativePlatform: () => false }).request(request))
      .toEqual({ status: 403, data: null, contentType: '' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['text/html', '<html>secret</html>', 'The server did not return JSON.'],
    ['application/json', '{"broken":', 'The server returned invalid JSON.'],
  ])('rejects malformed success responses with fixed messages (%s)', async (contentType, body, message) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { headers: { 'Content-Type': contentType } }));
    await expect(new HttpClient({ isNativePlatform: () => false }).request(request)).rejects.toThrow(message);
  });

  it.each<Partial<HttpRequest>>([
    { method: 'POST' }, { url: `${url}?page=2` },
    { url: 'https://example.test/api/v2/projects/' }, { data: {} },
    { headers: { Cookie: 'sessionid=another-account' } },
    { headers: { Cookie2: 'sessionid=another-account' } },
  ])('rejects invalid cookie-free requests before transport: %j', async (override) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(new HttpClient({ isNativePlatform: () => false }).request({ ...request, ...override }))
      .rejects.toThrow('Cookie-free transport requires a GIS Geometry GET request.');
    expect(fetcher).not.toHaveBeenCalled();
  });

  function nativeClient(plugin: GisGeometryHttpPlugin) {
    return new HttpClient({
      isNativePlatform: () => true, getNativeUserAgent: async () => 'SpeleoDB-Test',
      gisGeometryHttp: plugin,
      nativeHttp: { request: vi.fn(() => { throw new Error('Shared-cookie transport must not be used'); }) },
    });
  }

  it('routes native reads through the cookie-free raw-body adapter', async () => {
    const plugin = {
      get: vi.fn(async () => ({ status: 200, contentType: 'application/json', body: '[]' })),
      cancel: vi.fn(async () => {}),
    };
    expect((await nativeClient(plugin).request(request)).data).toEqual([]);
    expect(plugin.get).toHaveBeenCalledWith(expect.objectContaining({
      url, headers: { ...request.headers, 'User-Agent': 'SpeleoDB-Test' }, timeoutMs: 10000,
    }));
    expect(plugin.cancel).not.toHaveBeenCalled();
  });

  it('preserves native denial status before JSON decoding', async () => {
    const plugin = {
      get: vi.fn(async () => ({ status: 403, contentType: 'application/json', body: '{broken' })),
      cancel: vi.fn(async () => {}),
    };
    expect(await nativeClient(plugin).request(request)).toMatchObject({ status: 403, data: null });
  });

  it('cancels the admitted native request and rejects its late successful result', async () => {
    let complete!: (value: { status: number; contentType: string; body: string }) => void;
    const plugin = {
      get: vi.fn<GisGeometryHttpPlugin['get']>(() => new Promise<{ status: number; contentType: string; body: string }>((resolve) => { complete = resolve; })),
      cancel: vi.fn(async () => {}),
    };
    const abort = new AbortController();
    const pending = nativeClient(plugin).request({ ...request, signal: abort.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(plugin.get).toHaveBeenCalledOnce());
    abort.abort();
    await rejected;
    expect(plugin.cancel).toHaveBeenCalledWith({ requestId: plugin.get.mock.calls[0][0].requestId });
    complete({ status: 200, contentType: 'application/json', body: '[]' });
  });

  it('keeps the overall deadline authoritative during native reads', async () => {
    vi.useFakeTimers();
    const plugin = { get: vi.fn(() => new Promise<never>(() => {})), cancel: vi.fn(async () => {}) };
    const pending = nativeClient(plugin).request({ ...request, timeoutMs: 5 });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    expect(plugin.cancel).toHaveBeenCalledOnce();
  });
});
