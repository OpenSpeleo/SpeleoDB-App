/**
 * Pure API layer for the SpeleoDB backend.
 *
 * - Stateless: every method receives all the data it needs.
 * - Delegates HTTP transport to the injected HttpClient.
 * - Knows the API contract (endpoints, request/response shapes) but nothing else.
 */

import { API, GPS, HEADERS } from '../constants';
import { getInstanceBaseUrl } from '../utils/instanceUrl';
import type { HttpClient, HttpResponse, HttpRequest } from './HttpClient';
import type { AuthTokenResponse } from '../types';
import type { Project } from '../types/project';
import type {
  LandmarkApiObject,
  LandmarkCreateInput,
  LandmarkUpdateInput,
} from '../types/landmark';

export interface ServiceRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/** Response envelope for a single landmark mutation. */
export interface LandmarkMutationResponse {
  landmark: LandmarkApiObject;
}

/** Server response from a successful GPX import. */
export interface GpxImportResponse {
  landmarks_created: number;
  gps_tracks_created: number;
}

/** Editable fields of a server GPS track (PATCH body). */
export interface GpsTrackUpdateInput {
  name?: string;
  color?: string;
}

export class SpeleoDBService {
  constructor(private http: HttpClient) {}

  // ==================== Auth ====================

  /**
   * POST /api/v2/user/auth-token/
   *
   * Sends JSON on every transport (native and web). The Django endpoint
   * accepts application/json.
   */
  async authenticate(
    instance: string,
    email: string,
    password: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<AuthTokenResponse | unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.AUTH_TOKEN_ENDPOINT;

    return this.http.request<AuthTokenResponse | unknown>({
      url,
      method: 'POST',
      headers: { [HEADERS.CONTENT_TYPE]: HEADERS.APPLICATION_JSON_UTF8 },
      data: { email, password },
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }

  /**
   * GET /api/v2/user/auth-token/  (with Token header)
   *
   * Used at app startup to validate a stored token is still valid.
   */
  async validateToken(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.AUTH_TOKEN_ENDPOINT;

    return this.http.request({
      url,
      method: 'GET',
      headers: { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` },
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }

  // ==================== Projects ====================

  /**
   * GET /api/v2/projects/geojson/  (with Token header)
   *
   * Returns the full project list with geojson metadata as a bare `Project[]`.
   */
  async getProjectsGeoJSON(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<Project[] | unknown>> {
    return this.getAuthorized<Project[]>(
      instance,
      token,
      API.PROJECTS_GEOJSON_ENDPOINT,
      options,
    );
  }

  /**
   * GET /api/v2/landmarks/geojson/  (with Token header)
   */
  async getLandmarksGeoJSON(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.LANDMARKS_GEOJSON_ENDPOINT,
      options,
    );
  }

  // ==================== Landmark CRUD ====================

  /**
   * GET /api/v2/landmark-collections/  (with Token header)
   *
   * Returns the user's landmark collections (used to populate the create/edit
   * collection picker). Shape is backend-defined; callers map it.
   */
  async getLandmarkCollections(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<unknown>> {
    return this.authorizedRequest(
      'GET',
      instance,
      token,
      API.LANDMARK_COLLECTIONS_ENDPOINT,
      options,
    );
  }

  /**
   * POST /api/v2/landmarks/  (with Token header)
   *
   * Creates a landmark. Omit `collection` (or send null) to use the user's
   * personal collection.
   */
  async createLandmark(
    instance: string,
    token: string,
    input: LandmarkCreateInput,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<LandmarkMutationResponse | unknown>> {
    return this.authorizedRequest<LandmarkMutationResponse>(
      'POST',
      instance,
      token,
      API.LANDMARKS_ENDPOINT,
      { ...options, data: input },
    );
  }

  /**
   * PATCH /api/v2/landmarks/<id>/  (with Token header)
   *
   * Partially updates a landmark. Only provided fields are changed.
   */
  async updateLandmark(
    instance: string,
    token: string,
    id: string,
    input: LandmarkUpdateInput,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<LandmarkMutationResponse | unknown>> {
    return this.authorizedRequest<LandmarkMutationResponse>(
      'PATCH',
      instance,
      token,
      API.landmarkDetailEndpoint(id),
      { ...options, data: input },
    );
  }

  /**
   * DELETE /api/v2/landmarks/<id>/  (with Token header)
   */
  async deleteLandmark(
    instance: string,
    token: string,
    id: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<unknown>> {
    return this.authorizedRequest(
      'DELETE',
      instance,
      token,
      API.landmarkDetailEndpoint(id),
      options,
    );
  }

  // ==================== GPS tracks ====================

  /**
   * GET /api/v2/gps_tracks/  (with Token header)
   *
   * Returns the user's server-stored GPS tracks as a bare array of
   * `{ id, name, color, file, sha256_hash, creation_date, modified_date }`
   * (`file` is a pre-signed GeoJSON URL). Synced like projects/landmarks.
   */
  async getGpsTracks(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<unknown>> {
    return this.getAuthorized<unknown>(
      instance,
      token,
      API.GPS_TRACKS_ENDPOINT,
      options,
    );
  }

  /**
   * PATCH /api/v2/gps_tracks/<id>/  (with Token header)
   *
   * Edits a server GPS track's name and/or color. Returns the updated object
   * `{ id, name, color, creation_date, modified_date }`.
   */
  async updateGpsTrack(
    instance: string,
    token: string,
    id: string,
    input: GpsTrackUpdateInput,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<unknown>> {
    return this.authorizedRequest(
      'PATCH',
      instance,
      token,
      API.gpsTrackDetailEndpoint(id),
      { ...options, data: input },
    );
  }

  /**
   * DELETE /api/v2/gps_tracks/<id>/  (with Token header)
   */
  async deleteGpsTrack(
    instance: string,
    token: string,
    id: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<unknown>> {
    return this.authorizedRequest(
      'DELETE',
      instance,
      token,
      API.gpsTrackDetailEndpoint(id),
      options,
    );
  }

  /**
   * PUT /api/v2/import/gpx/  (with Token header, multipart/form-data)
   *
   * Uploads a GPX document. The backend converts waypoints to Landmarks and
   * tracks to GPSTrack rows and returns the created counts. Uses the
   * cross-platform multipart path so it works on native and web. An optional
   * `collection` id targets a specific landmark collection for waypoints.
   */
  async uploadGpx(
    instance: string,
    token: string,
    gpxText: string,
    fileName: string,
    collection?: string | null,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<GpxImportResponse | unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.GPX_IMPORT_ENDPOINT;

    return this.http.request<GpxImportResponse | unknown>({
      url,
      method: 'PUT',
      headers: { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` },
      multipart: {
        fields: collection ? { collection } : undefined,
        file: {
          fieldName: 'file',
          fileName,
          contentType: GPS.GPX_CONTENT_TYPE,
          content: gpxText,
        },
      },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * GET /api/v2/stations/subsurface/geojson/  (with Token header)
   */
  async getSubsurfaceStationsGeoJSON(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.SUBSURFACE_STATIONS_GEOJSON_ENDPOINT,
      options,
    );
  }

  /**
   * GET /api/v2/stations/surface/geojson/  (with Token header)
   */
  async getSurfaceStationsGeoJSON(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.SURFACE_STATIONS_GEOJSON_ENDPOINT,
      options,
    );
  }

  /**
   * GET /api/v2/exploration-leads/geojson/  (with Token header)
   */
  async getExplorationLeadsGeoJSON(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.EXPLORATION_LEADS_GEOJSON_ENDPOINT,
      options,
    );
  }

  /**
   * GET /api/v2/cylinder-installs/geojson/  (with Token header)
   */
  async getCylinderInstallsGeoJSON(
    instance: string,
    token: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.CYLINDER_INSTALLS_GEOJSON_ENDPOINT,
      options,
    );
  }

  /**
   * GET any URL and return parsed JSON.
   *
   * Used to download pre-signed CloudFront geojson files. No auth header
   * is needed because the URL itself carries the signature.
   */
  async downloadJSON<T = unknown>(url: string, options: ServiceRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.http.request<T>({
      url,
      method: 'GET',
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  private async getAuthorized<T>(
    instance: string,
    token: string,
    endpoint: string,
    options: ServiceRequestOptions = {},
  ): Promise<HttpResponse<T | unknown>> {
    return this.authorizedRequest<T>('GET', instance, token, endpoint, options);
  }

  /**
   * Issue an authenticated request (Token header) to an instance endpoint.
   *
   * Generalizes the read-only `getAuthorized` so the same auth/URL logic backs
   * landmark create/update/delete. Pass `data` for a JSON body.
   */
  private async authorizedRequest<T>(
    method: HttpRequest['method'],
    instance: string,
    token: string,
    endpoint: string,
    options: ServiceRequestOptions & { data?: unknown } = {},
  ): Promise<HttpResponse<T | unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + endpoint;

    const headers: Record<string, string> = {
      [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}`,
    };
    if (options.data !== undefined) {
      headers[HEADERS.CONTENT_TYPE] = HEADERS.APPLICATION_JSON_UTF8;
    }

    return this.http.request<T | unknown>({
      url,
      method,
      headers,
      data: options.data,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
