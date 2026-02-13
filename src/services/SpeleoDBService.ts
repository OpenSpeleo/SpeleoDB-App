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
import type { AuthTokenResponse, SignupCredentials } from '../types';

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
  ): Promise<HttpResponse<unknown>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = baseUrl + API.AUTH_TOKEN_ENDPOINT;

    return this.http.request({
      url,
      method: 'GET',
      headers: { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` },
    });
  }

  /**
   * POST /api/v1/auth/signup
   */
  async signup(
    instance: string,
    data: SignupCredentials,
  ): Promise<HttpResponse<{ user?: { id: string; email: string; name: string }; message?: string }>> {
    const baseUrl = getInstanceBaseUrl(instance);
    const url = `${baseUrl}${API.BASE_PATH}/auth/signup`;

    return this.http.request({
      url,
      method: 'POST',
      headers: { [HEADERS.CONTENT_TYPE]: HEADERS.APPLICATION_JSON },
      data,
    });
  }
}
