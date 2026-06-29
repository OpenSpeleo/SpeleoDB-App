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
  color: '#377eb8',
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

    it('rejects a non-origin instance before sending credentials', async () => {
      await expect(service.authenticate(
        'https://www.speleodb.org/tenant?name=one',
        'a@b.com',
        'password',
      )).rejects.toThrow(/origin URL/);
      expect(http.calls).toHaveLength(0);
    });

    it('forwards timeout and cancellation ownership to the transport', async () => {
      const abortController = new AbortController();

      await service.authenticate(INSTANCE, 'a@b.com', 'pass', {
        timeoutMs: 1234,
        signal: abortController.signal,
      });

      expect(http.calls[0].timeoutMs).toBe(1234);
      expect(http.calls[0].signal).toBe(abortController.signal);
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
      await service.validateToken(INSTANCE, TOKEN, { timeoutMs: 1234 });
      expect(http.calls[0].timeoutMs).toBe(1234);
    });

    it('forwards the optional AbortSignal to the transport', async () => {
      const abortController = new AbortController();

      await service.validateToken(INSTANCE, TOKEN, {
        signal: abortController.signal,
      });

      expect(http.calls[0].signal).toBe(abortController.signal);
    });

    it('returns the flat 4xx error body verbatim (no envelope unwrapping)', async () => {
      const body = { detail: 'Invalid token.' };
      http = createMockHttpClient({ status: 401, data: body });
      service = new SpeleoDBService(http);

      const res = await service.validateToken(INSTANCE, 'bogus');

      expect(res.status).toBe(401);
      expect(res.data).toEqual(body);
    });

    it('forwards cancellation to the transport', async () => {
      const abortController = new AbortController();

      await service.getProjectsGeoJSON(INSTANCE, TOKEN, {
        signal: abortController.signal,
      });

      expect(http.calls[0].signal).toBe(abortController.signal);
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

  // ---- landmark CRUD --------------------------------------------------------

  describe('getLandmarkCollections', () => {
    it('GETs /api/v2/landmark-collections/ with auth', async () => {
      http = createMockHttpClient({ status: 200, data: [] });
      service = new SpeleoDBService(http);

      const res = await service.getLandmarkCollections(INSTANCE, TOKEN);

      expect(res.status).toBe(200);
      const req = http.calls[0];
      expect(req.method).toBe('GET');
      expect(req.url).toBe(INSTANCE + API.LANDMARK_COLLECTIONS_ENDPOINT);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
      expect(req.data).toBeUndefined();
    });
  });

  describe('createLandmark', () => {
    it('POSTs JSON to /api/v2/landmarks/ with auth + content-type', async () => {
      const created = { landmark: { id: 'lm-1', name: 'Camp' } };
      http = createMockHttpClient({ status: 201, data: created });
      service = new SpeleoDBService(http);

      const input = { name: 'Camp', description: 'd', latitude: 1, longitude: 2, collection: 'c1' };
      const res = await service.createLandmark(INSTANCE, TOKEN, input);

      expect(res.status).toBe(201);
      expect(res.data).toEqual(created);

      const req = http.calls[0];
      expect(req.method).toBe('POST');
      expect(req.url).toBe(INSTANCE + API.LANDMARKS_ENDPOINT);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
      expect(req.headers?.[HEADERS.CONTENT_TYPE]).toBe(HEADERS.APPLICATION_JSON_UTF8);
      expect(req.data).toEqual(input);
    });

    it('returns a 400 duplicate body verbatim', async () => {
      const body = { error: 'A landmark for GPS coordinate (1, 2) already exists or is invalid.' };
      http = createMockHttpClient({ status: 400, data: body });
      service = new SpeleoDBService(http);

      const res = await service.createLandmark(INSTANCE, TOKEN, {
        name: 'Camp',
        latitude: 1,
        longitude: 2,
      });
      expect(res.status).toBe(400);
      expect(res.data).toEqual(body);
    });

    it('forwards an AbortSignal', async () => {
      const ac = new AbortController();
      await service.createLandmark(
        INSTANCE,
        TOKEN,
        { name: 'C', latitude: 0, longitude: 0 },
        { signal: ac.signal },
      );
      expect(http.calls[0].signal).toBe(ac.signal);
    });
  });

  describe('updateLandmark', () => {
    it('PATCHes /api/v2/landmarks/<id>/ with the id URL-encoded and a JSON body', async () => {
      const updated = { landmark: { id: 'lm 1', name: 'Renamed' } };
      http = createMockHttpClient({ status: 200, data: updated });
      service = new SpeleoDBService(http);

      const res = await service.updateLandmark(INSTANCE, TOKEN, 'lm 1', { name: 'Renamed' });

      expect(res.status).toBe(200);
      const req = http.calls[0];
      expect(req.method).toBe('PATCH');
      expect(req.url).toBe(INSTANCE + API.landmarkDetailEndpoint('lm 1'));
      expect(req.url).toContain('lm%201');
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
      expect(req.data).toEqual({ name: 'Renamed' });
    });
  });

  describe('deleteLandmark', () => {
    it('DELETEs /api/v2/landmarks/<id>/ with auth and no body', async () => {
      http = createMockHttpClient({ status: 200, data: { message: 'deleted' } });
      service = new SpeleoDBService(http);

      const res = await service.deleteLandmark(INSTANCE, TOKEN, 'lm-1');

      expect(res.status).toBe(200);
      const req = http.calls[0];
      expect(req.method).toBe('DELETE');
      expect(req.url).toBe(INSTANCE + API.landmarkDetailEndpoint('lm-1'));
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
      expect(req.data).toBeUndefined();
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

    it('forwards cancellation and the caller-owned download deadline', async () => {
      const abortController = new AbortController();

      await service.downloadJSON('https://cloudfront.example/p1.geojson', {
        signal: abortController.signal,
        timeoutMs: 4_321,
      });

      expect(http.calls[0]).toMatchObject({
        signal: abortController.signal,
        timeoutMs: 4_321,
      });
    });
  });

  // ---- uploadGpx ------------------------------------------------------------

  describe('uploadGpx', () => {
    it('PUTs a multipart GPX file to /api/v2/import/gpx/ with auth', async () => {
      http = createMockHttpClient({ status: 200, data: { landmarks_created: 2, gps_tracks_created: 1 } });
      service = new SpeleoDBService(http);

      const res = await service.uploadGpx(INSTANCE, TOKEN, '<gpx/>', 'track.gpx');

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ landmarks_created: 2, gps_tracks_created: 1 });

      const req = http.calls[0];
      expect(req.method).toBe('PUT');
      expect(req.url).toBe(INSTANCE + API.GPX_IMPORT_ENDPOINT);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
      expect(req.multipart?.file).toMatchObject({
        fieldName: 'file',
        fileName: 'track.gpx',
        contentType: 'application/gpx+xml',
        content: '<gpx/>',
      });
      // No collection field unless explicitly provided.
      expect(req.multipart?.fields).toBeUndefined();
      // Must not set a JSON Content-Type; the transport owns the multipart boundary.
      expect(req.headers?.[HEADERS.CONTENT_TYPE]).toBeUndefined();
    });

    it('includes the collection field when provided', async () => {
      await service.uploadGpx(INSTANCE, TOKEN, '<gpx/>', 'track.gpx', 'col-123');
      expect(http.calls[0].multipart?.fields).toEqual({ collection: 'col-123' });
    });

    it('omits the collection field when null', async () => {
      await service.uploadGpx(INSTANCE, TOKEN, '<gpx/>', 'track.gpx', null);
      expect(http.calls[0].multipart?.fields).toBeUndefined();
    });

    it('returns a definitive 4xx error body verbatim', async () => {
      http = createMockHttpClient({ status: 400, data: { error: 'bad gpx' } });
      service = new SpeleoDBService(http);

      const res = await service.uploadGpx(INSTANCE, TOKEN, 'junk', 'track.gpx');
      expect(res.status).toBe(400);
      expect(res.data).toEqual({ error: 'bad gpx' });
    });

    it('forwards signal and timeout to the transport', async () => {
      const ac = new AbortController();
      await service.uploadGpx(INSTANCE, TOKEN, '<gpx/>', 'track.gpx', undefined, {
        signal: ac.signal,
        timeoutMs: 4242,
      });
      expect(http.calls[0].signal).toBe(ac.signal);
      expect(http.calls[0].timeoutMs).toBe(4242);
    });
  });

  describe('GPS track list / update / delete', () => {
    it('GETs the GPS track list with auth', async () => {
      http = createMockHttpClient({ status: 200, data: [{ id: 'g1', name: 'T' }] });
      service = new SpeleoDBService(http);

      const res = await service.getGpsTracks(INSTANCE, TOKEN);
      expect(res.status).toBe(200);
      const req = http.calls[0];
      expect(req.method).toBe('GET');
      expect(req.url).toBe(INSTANCE + API.GPS_TRACKS_ENDPOINT);
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
    });

    it('PATCHes a GPS track name/color to its detail endpoint', async () => {
      await service.updateGpsTrack(INSTANCE, TOKEN, 'g1', { name: 'New', color: '#377eb8' });
      const req = http.calls[0];
      expect(req.method).toBe('PATCH');
      expect(req.url).toBe(INSTANCE + API.gpsTrackDetailEndpoint('g1'));
      expect(req.data).toEqual({ name: 'New', color: '#377eb8' });
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
    });

    it('DELETEs a GPS track via its detail endpoint', async () => {
      await service.deleteGpsTrack(INSTANCE, TOKEN, 'g1');
      const req = http.calls[0];
      expect(req.method).toBe('DELETE');
      expect(req.url).toBe(INSTANCE + API.gpsTrackDetailEndpoint('g1'));
      expect(req.headers?.[HEADERS.AUTHORIZATION]).toBe(AUTH_HEADER);
    });
  });
});
