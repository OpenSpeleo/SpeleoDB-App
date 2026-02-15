/**
 * Pure API layer for the SpeleoDB backend.
 *
 * - Stateless: every method receives all the data it needs.
 * - Delegates HTTP transport to the injected HttpClient.
 * - Knows the API contract (endpoints, request/response shapes) but nothing else.
 */

import { API, HEADERS } from '../constants';
import { getInstanceBaseUrl } from '../utils/url';
import type { HttpClient, HttpResponse } from './HttpClient';
import type { AuthTokenResponse } from '../types';
import type { ProjectsGeoJSONResponse } from '../types/project';

export class SpeleoDBService {
  constructor(private http: HttpClient) {}

  // ==================== Auth ====================

  /**
   * POST /api/v1/user/auth-token/
   *
   * Sends JSON on every transport (native and web). The Django endpoint
   * accepts application/json.
   */
  async authenticate(
    instance: string,
    email: string,
    password: string,
  ): Promise<HttpResponse<AuthTokenResponse>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.AUTH_TOKEN_ENDPOINT;

    return this.http.request<AuthTokenResponse>({
      url,
      method: 'POST',
      headers: { [HEADERS.CONTENT_TYPE]: HEADERS.APPLICATION_JSON_UTF8 },
      data: { email, password },
    });
  }

  /**
   * GET /api/v1/user/auth-token/  (with Token header)
   *
   * Used at app startup to validate a stored token is still valid.
   */
  async validateToken(
    instance: string,
    token: string,
    timeoutMs?: number,
  ): Promise<HttpResponse<unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.AUTH_TOKEN_ENDPOINT;

    return this.http.request({
      url,
      method: 'GET',
      headers: { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` },
      timeoutMs,
    });
  }

  // ==================== Projects ====================

  /**
   * GET /api/v1/projects/geojson/  (with Token header)
   *
   * Returns the full project list with geojson metadata.
   */
  async getProjectsGeoJSON(
    instance: string,
    token: string,
  ): Promise<HttpResponse<ProjectsGeoJSONResponse>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.PROJECTS_GEOJSON_ENDPOINT;

    return this.http.request<ProjectsGeoJSONResponse>({
      url,
      method: 'GET',
      headers: { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` },
    });
  }

  /**
   * GET any URL and return parsed JSON.
   *
   * Used to download pre-signed CloudFront geojson files. No auth header
   * is needed because the URL itself carries the signature.
   */
  async downloadJSON<T = unknown>(url: string): Promise<HttpResponse<T>> {
    return this.http.request<T>({ url, method: 'GET' });
  }
}
