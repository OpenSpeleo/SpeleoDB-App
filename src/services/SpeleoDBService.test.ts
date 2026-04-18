import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeleoDBService } from './SpeleoDBService';
import type { HttpClient, HttpResponse } from './HttpClient';
import { API, HEADERS } from '../constants';
import type { Project } from '../types/project';

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

const INSTANCE = 'https://www.speleodb.org';
const TOKEN = 'tok';
const AUTH_HEADER = `${HEADERS.TOKEN_PREFIX}${TOKEN}`;

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const SAMPLE_PROJECT: Project = {
  id: 'p1',
  name: 'Project 1',
  description: '',
  country: 'US',
  type: 'COMPASS',
  visibility: 'PRIVATE',
  is_active: true,
  created_by: 'u@x.com',
  creation_date: '2026-01-01',
  modified_date: '2026-01-01',
  commit_count: 1,
  active_mutex: null,
  fork_from: null,
  exclude_geojson: false,
  geojson_file: null,
  latest_commit: {
    id: 'c1',
    message: 'init',
    author_email: 'u@x.com',
    author_name: 'U',
    authored_date: '2026-01-01',
    dt_since: 'today',
    parent_ids: [],
    url: '',
    formats: [],
    tree: [],
  },
};

describe('SpeleoDBService', () => {
  let http: ReturnType<typeof createMockHttpClient>;
  let service: SpeleoDBService;

  beforeEach(() => {
    http = createMockHttpClient();
    service = new SpeleoDBService(http);
  });

  // ---- authenticate ---------------------------------------------------------

  describe('authenticate', () => {
    it('POSTs JSON to /api/v2/user/auth-token/ and returns the v2 payload as-is on 200', async () => {
      const body = { user: 'a@b.com', token: 'tok' };
      http = createMockHttpClient({ status: 200, data: body });
      service = new SpeleoDBService(http);

      const res = await service.authenticate(INSTANCE, 'a@b.com', 'pass');

      expect(res.status).toBe(200);
      expect(res.data).toEqual(body);

      expect(http.calls).toHaveLength(1);
      const req = http.calls[0];
      expect(req.url).toBe(INSTANCE + API.AUTH_TOKEN_ENDPOINT);
      expect(req.method).toBe('POST');
      expect(req.data).toEqual({ email: 'a@b.com', password: 'pass' });
      expect(req.headers?.[HEADERS.CONTENT_TYPE]).toBe(HEADERS.APPLICATION_JSON_UTF8);
    });

    it('normalizes the instance URL (adds scheme, strips trailing slash)', async () => {
      await service.authenticate('www.speleodb.org/', 'a@b.com', 'p');
      expect(http.calls[0].url).toBe(INSTANCE + API.AUTH_TOKEN_ENDPOINT);
    });

    it('returns the flat 4xx error body verbatim (no envelope unwrapping)', async () => {
      const body = { errors: { non_field_errors: ['Invalid email or password.'] } };
      http = createMockHttpClient({ status: 401, data: body });
      service = new SpeleoDBService(http);

      const res = await service.authenticate(INSTANCE, 'a@b.com', 'wrong');

      expect(res.status).toBe(401);
      expect(res.data).toEqual(body);
    });
  });

  // ---- validateToken --------------------------------------------------------

  describe('validateToken', () => {
    it('GETs /api/v2/user/auth-token/ with Authorization header and returns an opaque 2xx payload as-is', async () => {
      const body = null;
      http = createMockHttpClient({ status: 204, data: body });
      service = new SpeleoDBService(http);

      const res = await service.validateToken(INSTANCE, TOKEN);

      expect(res.status).toBe(204);
      expect(res.data).toEqual(body);

      const req = http.calls[0];
      expect(req.method).toBe('GET');
      expect(req.url).toBe(INSTANCE + API.AUTH_TOKEN_ENDPOINT);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
    });

    it('forwards the optional timeoutMs to the transport', async () => {
      await service.validateToken(INSTANCE, TOKEN, 1234);
      expect(http.calls[0].timeoutMs).toBe(1234);
    });

    it('returns the flat 4xx error body verbatim (no envelope unwrapping)', async () => {
      const body = { detail: 'Invalid token.' };
      http = createMockHttpClient({ status: 401, data: body });
      service = new SpeleoDBService(http);

      const res = await service.validateToken(INSTANCE, 'bogus');

      expect(res.status).toBe(401);
      expect(res.data).toEqual(body);
    });
  });

  // ---- getProjectsGeoJSON ---------------------------------------------------

  describe('getProjectsGeoJSON', () => {
    it('GETs /api/v2/projects/geojson/ with auth and returns the bare Project[] as-is on 200', async () => {
      const projects: Project[] = [SAMPLE_PROJECT];
      http = createMockHttpClient({ status: 200, data: projects });
      service = new SpeleoDBService(http);

      const res = await service.getProjectsGeoJSON(INSTANCE, TOKEN);

      expect(res.status).toBe(200);
      expect(res.data).toEqual(projects);

      const req = http.calls[0];
      expect(req.method).toBe('GET');
      expect(req.url).toBe(INSTANCE + API.PROJECTS_GEOJSON_ENDPOINT);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
    });

    it('returns the flat 4xx error body verbatim (no envelope unwrapping)', async () => {
      const body = { detail: 'Invalid token.' };
      http = createMockHttpClient({ status: 401, data: body });
      service = new SpeleoDBService(http);

      const res = await service.getProjectsGeoJSON(INSTANCE, TOKEN);

      expect(res.status).toBe(401);
      expect(res.data).toEqual(body);
    });
  });

  // ---- overlay geojson endpoints --------------------------------------------

  type OverlayMethod =
    | 'getLandmarksGeoJSON'
    | 'getSubsurfaceStationsGeoJSON'
    | 'getSurfaceStationsGeoJSON'
    | 'getExplorationLeadsGeoJSON'
    | 'getCylinderInstallsGeoJSON';

  const OVERLAY_CASES: ReadonlyArray<{ method: OverlayMethod; endpoint: string }> = [
    { method: 'getLandmarksGeoJSON', endpoint: API.LANDMARKS_GEOJSON_ENDPOINT },
    { method: 'getSubsurfaceStationsGeoJSON', endpoint: API.SUBSURFACE_STATIONS_GEOJSON_ENDPOINT },
    { method: 'getSurfaceStationsGeoJSON', endpoint: API.SURFACE_STATIONS_GEOJSON_ENDPOINT },
    { method: 'getExplorationLeadsGeoJSON', endpoint: API.EXPLORATION_LEADS_GEOJSON_ENDPOINT },
    { method: 'getCylinderInstallsGeoJSON', endpoint: API.CYLINDER_INSTALLS_GEOJSON_ENDPOINT },
  ];

  describe.each(OVERLAY_CASES)('$method', ({ method, endpoint }) => {
    it('GETs the endpoint with auth and returns the FeatureCollection as-is on 200', async () => {
      http = createMockHttpClient({ status: 200, data: EMPTY_FEATURE_COLLECTION });
      service = new SpeleoDBService(http);

      const res = await service[method](INSTANCE, TOKEN);

      expect(res.status).toBe(200);
      expect(res.data).toEqual(EMPTY_FEATURE_COLLECTION);

      const req = http.calls[0];
      expect(req.method).toBe('GET');
      expect(req.url).toBe(INSTANCE + endpoint);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
    });

    it('returns the flat 4xx error body verbatim (no envelope unwrapping)', async () => {
      const body = { detail: 'Invalid token.' };
      http = createMockHttpClient({ status: 401, data: body });
      service = new SpeleoDBService(http);

      const res = await service[method](INSTANCE, TOKEN);

      expect(res.status).toBe(401);
      expect(res.data).toEqual(body);
    });
  });

  // ---- downloadJSON ---------------------------------------------------------

  describe('downloadJSON', () => {
    it('GETs the URL without auth and returns the parsed JSON as-is on 200', async () => {
      const body = { type: 'FeatureCollection', features: [] };
      http = createMockHttpClient({ status: 200, data: body });
      service = new SpeleoDBService(http);

      const url = 'https://cloudfront.example/p1.geojson?sig=abc';
      const res = await service.downloadJSON(url);

      expect(res.status).toBe(200);
      expect(res.data).toEqual(body);

      const req = http.calls[0];
      expect(req.method).toBe('GET');
      expect(req.url).toBe(url);
      // Semantic check: pre-signed URLs carry their own credential, so the
      // service must never attach an Authorization header. Asserting only on
      // the absent header (rather than `headers === undefined`) keeps the test
      // robust if unrelated headers (Accept, User-Agent, ...) are added later.
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBeUndefined();
    });

    it('returns the 4xx body verbatim (e.g. expired pre-signed URL)', async () => {
      const body = { Code: 'AccessDenied', Message: 'Request has expired' };
      http = createMockHttpClient({ status: 403, data: body });
      service = new SpeleoDBService(http);

      const res = await service.downloadJSON('https://cloudfront.example/expired.geojson');

      expect(res.status).toBe(403);
      expect(res.data).toEqual(body);
    });
  });
});
