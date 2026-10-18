import type { ApiTransport } from '@speleodb/api';
import { HEADERS } from '../constants';
import type { HttpClient, HttpRequest } from './HttpClient';

const METHODS = new Set<HttpRequest['method']>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Adapt generated operations to the app's native, deadline, and cookie policies. */
export function createMobileApiTransport(http: Pick<HttpClient, 'request'>): ApiTransport {
  return async (request) => {
    if (request.timeoutMs === null) {
      throw new TypeError('The mobile API transport requires a finite timeoutMs.');
    }
    if (!METHODS.has(request.method as HttpRequest['method'])) {
      throw new TypeError(`Unsupported mobile API method: ${request.method}`);
    }
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      const canonical = [HEADERS.AUTHORIZATION, HEADERS.CONTENT_TYPE, HEADERS.ACCEPT]
        .find((header) => header.toLowerCase() === name) ?? name;
      headers[canonical] = value;
    });
    const body = request.body;
    if (body != null && typeof body !== 'string' && !(body instanceof FormData)) {
      throw new TypeError('The mobile API transport supports JSON, text, and GPX multipart bodies.');
    }
    const response = await http.request({
      url: request.url,
      method: request.method as HttpRequest['method'],
      headers,
      ...(typeof body === 'string' ? { body } : {}),
      ...(body instanceof FormData ? { formData: body } : {}),
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      ...(request.responsePolicy === 'status-first-json' ? { requireJson: true } : {}),
      ...(request.cookiePolicy ? { cookiePolicy: request.cookiePolicy } : {}),
    });
    const responseHeaders = new Headers(response.headers);
    if (response.contentType) responseHeaders.set('Content-Type', response.contentType);
    return { status: response.status, data: response.data, headers: responseHeaders };
  };
}
