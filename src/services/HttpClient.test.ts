import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient, type HttpRequest } from './HttpClient';

describe('HttpClient (web transport)', () => {
  let client: HttpClient;

  beforeEach(() => {
    client = new HttpClient();
    vi.restoreAllMocks();
  });

  it('sends a GET request and returns parsed JSON', async () => {
    const body = { ok: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => body,
    } as Response);

    const res = await client.request({ url: 'https://api.test/v1', method: 'GET' });

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
      url: 'https://api.test/v1/resource',
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

    const res = await client.request({ url: 'https://api.test/v1', method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(res.data).toEqual({});
  });

  it('propagates fetch errors (e.g. network failure)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      client.request({ url: 'https://unreachable.test', method: 'GET' })
    ).rejects.toThrow('Failed to fetch');
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
});
