import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  __resetNativeUserAgentCacheForTests,
  buildMultipartString,
  HttpClient,
  type HttpRequest,
} from './HttpClient';
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

  it('builds a FormData body from a multipart payload on web', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({ gps_tracks_created: 1 }),
    } as Response);

    await client.request({
      url: 'https://api.test/api/v2/import/gpx/',
      method: 'PUT',
      multipart: {
        fields: { collection: 'col-1' },
        file: { fieldName: 'file', fileName: 't.gpx', contentType: 'application/gpx+xml', content: '<gpx/>' },
      },
    });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    const fd = init.body as FormData;
    expect(fd.get('collection')).toBe('col-1');
    const file = fd.get('file');
    expect(file).toBeInstanceOf(Blob);
    // The browser owns the multipart boundary, so no Content-Type is set here.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')).toBe(false);
  });

  it('rejects unsafe multipart fields before web FormData construction', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({}),
    } as Response);

    await expect(
      client.request({
        url: 'https://api.test/api/v2/import/gpx/',
        method: 'PUT',
        multipart: {
          fields: { collection: 'col-1\r\nX-Injected: yes' },
          file: { fieldName: 'file', fileName: 't.gpx', contentType: 'application/gpx+xml', content: '<gpx/>' },
        },
      }),
    ).rejects.toThrow(/CRLF/);
    expect(fetch).not.toHaveBeenCalled();
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

  function mockNativeResponse(data: unknown = { ok: true }, status = 200) {
    const request = vi.fn().mockResolvedValue({
      status,
      data,
      headers: {},
      url: 'https://api.test',
    });
    client = new HttpClient({
      isNativePlatform: () => true,
      nativeHttp: { request } as never,
    });
    return request;
  }

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
    const nativeRequest = mockNativeResponse();

    const res = await client.request({ url: 'https://api.test/api/v2/projects/geojson/', method: 'GET' });

    expect(res.status).toBe(200);
    const [{ headers: headersObject = {} }] = nativeRequest.mock.calls[0];
    const userAgent = headersObject['User-Agent'];
    expect(userAgent.startsWith('SpeleoDB-iOS/')).toBe(true);
    expect(userAgent.includes(' - iOS')).toBe(true);
  });

  it('injects Android User-Agent when not provided', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    const nativeRequest = mockNativeResponse();

    await client.request({ url: 'https://api.test/api/v2/projects/geojson/', method: 'GET' });

    const [{ headers: headersObject = {} }] = nativeRequest.mock.calls[0];
    const userAgent = headersObject['User-Agent'];
    expect(userAgent.startsWith('SpeleoDB-Android/')).toBe(true);
    expect(userAgent.includes(' - Android')).toBe(true);
  });

  it('preserves caller-provided User-Agent header', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    const nativeRequest = mockNativeResponse();

    await client.request({
      url: 'https://api.test/api/v2/projects/geojson/',
      method: 'GET',
      headers: { 'User-Agent': 'Custom-UA/1.0' },
    });

    const [{ headers = {} }] = nativeRequest.mock.calls[0];
    expect(headers).toEqual(expect.objectContaining({ 'User-Agent': 'Custom-UA/1.0' }));
  });

  it('does not inject app User-Agent for non-API URLs (e.g. map tiles)', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    const nativeRequest = mockNativeResponse();

    await client.request({
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1',
      method: 'GET',
    });

    const [{ headers: headersObject = {} }] = nativeRequest.mock.calls[0];
    expect(Object.keys(headersObject).some((key) => key.toLowerCase() === 'user-agent')).toBe(false);
  });

  it('serializes a multipart payload to a raw body string with a boundary Content-Type', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    const nativeRequest = mockNativeResponse({ gps_tracks_created: 1 });

    await client.request({
      url: 'https://api.test/api/v2/import/gpx/',
      method: 'PUT',
      headers: { Authorization: 'Token abc' },
      multipart: {
        fields: { collection: 'col-1' },
        file: { fieldName: 'file', fileName: 't.gpx', contentType: 'application/gpx+xml', content: '<gpx>data</gpx>' },
      },
    });

    const [{ headers = {}, data }] = nativeRequest.mock.calls[0];
    const contentType = headers['Content-Type'];
    expect(contentType).toMatch(/^multipart\/form-data; boundary=----SpeleoDBFormBoundary/);
    const boundary = contentType.split('boundary=')[1];

    const body = data as string;
    expect(typeof body).toBe('string');
    expect(body).toContain(`--${boundary}\r\n`);
    expect(body).toContain('name="collection"\r\n\r\ncol-1\r\n');
    expect(body).toContain('name="file"; filename="t.gpx"');
    expect(body).toContain('<gpx>data</gpx>');
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
    // Auth header survives the multipart header merge.
    expect(headers['Authorization']).toBe('Token abc');
  });

  it('does not inject app User-Agent when host differs and URL is not API', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    const nativeRequest = mockNativeResponse();

    await client.request({
      url: 'https://other-instance.test/tiles/1/2/3.png',
      method: 'GET',
    });

    const [{ headers: headersObject = {} }] = nativeRequest.mock.calls[0];
    expect(Object.keys(headersObject).some((key) => key.toLowerCase() === 'user-agent')).toBe(false);
  });
});

describe('buildMultipartString', () => {
  it('serializes fields and a file part with the boundary and CRLFs', () => {
    const body = buildMultipartString(
      {
        fields: { collection: 'col-9' },
        file: { fieldName: 'file', fileName: 't.gpx', contentType: 'application/gpx+xml', content: '<gpx/>' },
      },
      'BOUND',
    );

    expect(body).toContain('--BOUND\r\n');
    expect(body).toContain('Content-Disposition: form-data; name="collection"\r\n\r\ncol-9\r\n');
    expect(body).toContain(
      'Content-Disposition: form-data; name="file"; filename="t.gpx"\r\n' +
        'Content-Type: application/gpx+xml\r\n\r\n<gpx/>\r\n',
    );
    // Final closing boundary.
    expect(body.endsWith('--BOUND--\r\n')).toBe(true);
  });

  it('omits the fields section when no fields are given', () => {
    const body = buildMultipartString(
      { file: { fieldName: 'file', fileName: 't.gpx', contentType: 'application/gpx+xml', content: 'x' } },
      'B',
    );
    expect(body).not.toContain('name="collection"');
    expect(body.startsWith('--B\r\nContent-Disposition: form-data; name="file"')).toBe(true);
  });

  it('rejects CRLF injection in text fields', () => {
    expect(() =>
      buildMultipartString(
        {
          fields: { collection: 'col-1\r\nX-Injected: yes' },
          file: { fieldName: 'file', fileName: 't.gpx', contentType: 'application/gpx+xml', content: '<gpx/>' },
        },
        'BOUND',
      ),
    ).toThrow(/CRLF/);
  });

  it('rejects file content containing the multipart boundary delimiter', () => {
    expect(() =>
      buildMultipartString(
        {
          file: {
            fieldName: 'file',
            fileName: 't.gpx',
            contentType: 'application/gpx+xml',
            content: `<gpx>\r\n--BOUND\r\n</gpx>`,
          },
        },
        'BOUND',
      ),
    ).toThrow(/boundary/);
  });

  it('rejects bare boundary delimiters even without leading CRLF', () => {
    expect(() =>
      buildMultipartString(
        {
          file: {
            fieldName: 'file',
            fileName: 't.gpx',
            contentType: 'application/gpx+xml',
            content: `<gpx>--BOUND</gpx>`,
          },
        },
        'BOUND',
      ),
    ).toThrow(/boundary/);
  });
});
