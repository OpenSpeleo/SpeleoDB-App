import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeleoDBService } from './SpeleoDBService';
import type { HttpClient, HttpResponse } from './HttpClient';
import { API, HEADERS } from '../constants';

/** Minimal mock HttpClient that records calls and returns a canned response. */
function createMockHttpClient(
  canned: HttpResponse = { status: 200, data: {} },
): HttpClient & { calls: Array<Parameters<HttpClient['request']>[0]> } {
  const calls: Array<Parameters<HttpClient['request']>[0]> = [];
  return {
    calls,
    request: vi.fn(async (req) => {
      calls.push(req);
      return canned;
    }),
  } as unknown as HttpClient & { calls: Array<Parameters<HttpClient['request']>[0]> };
}

describe('SpeleoDBService', () => {
  let service: SpeleoDBService;
  let http: ReturnType<typeof createMockHttpClient>;

  beforeEach(() => {
    http = createMockHttpClient({ status: 200, data: { user: 'a@b.com', token: 'tok' } });
    service = new SpeleoDBService(http);
  });

  // ---- authenticate ---------------------------------------------------------

  describe('authenticate', () => {
    it('POSTs JSON to the auth-token endpoint', async () => {
      const res = await service.authenticate('https://www.speleodb.org', 'a@b.com', 'pass');

      expect(res.status).toBe(200);
      expect(http.calls).toHaveLength(1);

      const req = http.calls[0];
      expect(req.url).toBe('https://www.speleodb.org' + API.AUTH_TOKEN_ENDPOINT);
      expect(req.method).toBe('POST');
      expect(req.data).toEqual({ email: 'a@b.com', password: 'pass' });
      expect(req.headers?.['Content-Type']).toBe(HEADERS.APPLICATION_JSON_UTF8);
    });

    it('normalizes the instance URL (adds scheme, strips trailing slash)', async () => {
      await service.authenticate('www.speleodb.org/', 'a@b.com', 'p');
      expect(http.calls[0].url).toBe('https://www.speleodb.org' + API.AUTH_TOKEN_ENDPOINT);
    });
  });

  // ---- validateToken --------------------------------------------------------

  describe('validateToken', () => {
    it('sends GET with Authorization header', async () => {
      http = createMockHttpClient({ status: 200, data: {} });
      service = new SpeleoDBService(http);

      await service.validateToken('https://www.speleodb.org', 'my-token');

      const req = http.calls[0];
      expect(req.method).toBe('GET');
      expect(req.url).toBe('https://www.speleodb.org' + API.AUTH_TOKEN_ENDPOINT);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(`${HEADERS.TOKEN_PREFIX}my-token`);
    });
  });

});
