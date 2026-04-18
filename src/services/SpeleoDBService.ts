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
import type { Project } from '../types/project';

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
  ): Promise<HttpResponse<AuthTokenResponse | unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.AUTH_TOKEN_ENDPOINT;

    return this.http.request<AuthTokenResponse | unknown>({
      url,
      method: 'POST',
      headers: { [HEADERS.CONTENT_TYPE]: HEADERS.APPLICATION_JSON_UTF8 },
      data: { email, password },
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
   * GET /api/v2/projects/geojson/  (with Token header)
   *
   * Returns the full project list with geojson metadata as a bare `Project[]`.
   */
  async getProjectsGeoJSON(
    instance: string,
    token: string,
  ): Promise<HttpResponse<Project[] | unknown>> {
    return this.getAuthorized<Project[]>(
      instance,
      token,
      API.PROJECTS_GEOJSON_ENDPOINT,
    );
  }

  /**
   * GET /api/v2/landmarks/geojson/  (with Token header)
   */
  async getLandmarksGeoJSON(
    instance: string,
    token: string,
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.LANDMARKS_GEOJSON_ENDPOINT,
    );
  }

  /**
   * GET /api/v2/stations/subsurface/geojson/  (with Token header)
   */
  async getSubsurfaceStationsGeoJSON(
    instance: string,
    token: string,
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.SUBSURFACE_STATIONS_GEOJSON_ENDPOINT,
    );
  }

  /**
   * GET /api/v2/stations/surface/geojson/  (with Token header)
   */
  async getSurfaceStationsGeoJSON(
    instance: string,
    token: string,
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.SURFACE_STATIONS_GEOJSON_ENDPOINT,
    );
  }

  /**
   * GET /api/v2/exploration-leads/geojson/  (with Token header)
   */
  async getExplorationLeadsGeoJSON(
    instance: string,
    token: string,
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.EXPLORATION_LEADS_GEOJSON_ENDPOINT,
    );
  }

  /**
   * GET /api/v2/cylinder-installs/geojson/  (with Token header)
   */
  async getCylinderInstallsGeoJSON(
    instance: string,
    token: string,
  ): Promise<HttpResponse<GeoJSON.FeatureCollection | unknown>> {
    return this.getAuthorized<GeoJSON.FeatureCollection>(
      instance,
      token,
      API.CYLINDER_INSTALLS_GEOJSON_ENDPOINT,
    );
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

  private async getAuthorized<T>(
    instance: string,
    token: string,
    endpoint: string,
  ): Promise<HttpResponse<T | unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + endpoint;

    return this.http.request<T | unknown>({
      url,
      method: 'GET',
      headers: { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` },
    });
  }
}
