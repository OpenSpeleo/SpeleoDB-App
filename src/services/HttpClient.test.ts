import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { __resetNativeUserAgentCacheForTests, HttpClient, type HttpRequest } from './HttpClient';
import { clearPreferences, setPreferences } from './PreferencesService';

describe('HttpClient (web transport)', () => {
  let client: HttpClient;

  beforeEach(() => {
    __resetNativeUserAgentCacheForTests();
    client = new HttpClient();
    vi.restoreAllMocks();
    clearPreferences();
  });

  it('sends a GET request and returns parsed JSON', async () => {
    const body = { ok: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => body,
    } as Response);

    const res = await client.request({ url: 'https://api.test/v2', method: 'GET' });

    expect(res.status).toBe(200);
    expect(res.data).toEqual(body);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends a POST with JSON body when data is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 201,
      json: async () => ({ id: 1 }),
    } as Response);

    const req: HttpRequest = {
      url: 'https://api.test/v2/resource',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { name: 'test' },
    };

    const res = await client.request(req);

    expect(res.status).toBe(201);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ name: 'test' }));
  });

  it('sends a POST with FormData when formData is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({ token: 'abc' }),
    } as Response);

    const fd = new FormData();
    fd.append('email', 'a@b.com');

    const res = await client.request({
      url: 'https://api.test/auth',
      method: 'POST',
      formData: fd,
    });

    expect(res.status).toBe(200);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(fd);
  });

  it('returns empty object when JSON parsing fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 204,
      json: async () => { throw new Error('no body'); },
    } as unknown as Response);

    const res = await client.request({ url: 'https://api.test/v2', method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(res.data).toEqual({});
  });

  it('propagates fetch errors (e.g. network failure)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      client.request({ url: 'https://unreachable.test', method: 'GET' })
    ).rejects.toThrow('Failed to fetch');
  });

  it('injects web app User-Agent for current instance URLs', async () => {
    setPreferences({ instance: 'https://api.test' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    await client.request({ url: 'https://api.test/api/v2/user/auth-token/', method: 'GET' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headersObject = (init.headers ?? {}) as Record<string, string>;
    expect(headersObject['User-Agent']).toBe('SpeleoDB-Unittest');
  });

  it('injects web app User-Agent for auth endpoint even without saved instance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    await client.request({ url: 'https://www.speleodb.org/api/v2/user/auth-token/', method: 'GET' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headersObject = (init.headers ?? {}) as Record<string, string>;
    expect(headersObject['User-Agent']).toBe('SpeleoDB-Unittest');
  });

  it('injects web app User-Agent for API endpoint even when host differs from current instance', async () => {
    setPreferences({ instance: 'https://api.test' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    await client.request({ url: 'https://other-instance.test/api/v2/user/auth-token/', method: 'GET' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headersObject = (init.headers ?? {}) as Record<string, string>;
    expect(headersObject['User-Agent']).toBe('SpeleoDB-Unittest');
  });

  it('preserves caller-provided User-Agent on web transport', async () => {
    setPreferences({ instance: 'https://api.test' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    await client.request({
      url: 'https://api.test/api/v2/user/auth-token/',
      method: 'GET',
      headers: { 'User-Agent': 'Custom-UA/1.0' },
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(expect.objectContaining({ 'User-Agent': 'Custom-UA/1.0' }));
  });

  it('aborts on timeout', async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );

    const promise = client.request({
      url: 'https://slow.test',
      method: 'GET',
      timeoutMs: 5000,
    });

    // Advance past the timeout and immediately catch the rejection
    // to prevent an unhandled promise rejection warning.
    const resultPromise = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5001);
    const error = await resultPromise;

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');

    vi.useRealTimers();
  });

  it('aborts when the caller signal is cancelled', async () => {
    const abortController = new AbortController();

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const promise = client.request({
      url: 'https://cancelled.test',
      method: 'GET',
      signal: abortController.signal,
    });

    const resultPromise = promise.catch((e) => e);
    abortController.abort();
    const error = await resultPromise;

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

describe('HttpClient (native transport)', () => {
  let client: HttpClient;

  beforeEach(() => {
    __resetNativeUserAgentCacheForTests();
    client = new HttpClient();
    vi.restoreAllMocks();
    clearPreferences();
    setPreferences({ instance: 'https://api.test' });
  });

  it('injects iOS User-Agent when not provided', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    const res = await client.request({ url: 'https://api.test/api/v2/projects/geojson/', method: 'GET' });

    expect(res.status).toBe(200);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headersObject = (init.headers ?? {}) as Record<string, string>;
    const userAgent = headersObject['User-Agent'];
    expect(userAgent.startsWith('SpeleoDB-iOS/')).toBe(true);
    expect(userAgent.includes(' - iOS')).toBe(true);
  });

  it('injects Android User-Agent when not provided', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    await client.request({ url: 'https://api.test/api/v2/projects/geojson/', method: 'GET' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headersObject = (init.headers ?? {}) as Record<string, string>;
    const userAgent = headersObject['User-Agent'];
    expect(userAgent.startsWith('SpeleoDB-Android/')).toBe(true);
    expect(userAgent.includes(' - Android')).toBe(true);
  });

  it('preserves caller-provided User-Agent header', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    await client.request({
      url: 'https://api.test/api/v2/projects/geojson/',
      method: 'GET',
      headers: { 'User-Agent': 'Custom-UA/1.0' },
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(expect.objectContaining({ 'User-Agent': 'Custom-UA/1.0' }));
  });

  it('does not inject app User-Agent for non-API URLs (e.g. map tiles)', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    await client.request({
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1',
      method: 'GET',
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headersObject = (init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headersObject).some((key) => key.toLowerCase() === 'user-agent')).toBe(false);
  });

  it('does not inject app User-Agent when host differs and URL is not API', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    await client.request({
      url: 'https://other-instance.test/tiles/1/2/3.png',
      method: 'GET',
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headersObject = (init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headersObject).some((key) => key.toLowerCase() === 'user-agent')).toBe(false);
  });
});
