/**
 * Transport abstraction: hides the native CapacitorHttp vs web fetch difference.
 * Every other layer calls HttpClient.request() and never touches Capacitor or fetch directly.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { API, NETWORK } from '../constants';
import { getPreferences } from './PreferencesService';
import { getInstanceBaseUrl } from '../utils/url';
import { getAppleMarketingModelOrIdentifier } from '../utils/appleDeviceModelMap';
import { createAbortError, throwIfAborted } from '../utils/abort';

// ==================== Public types ====================

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** JSON-serialisable body (used on both native and web). */
  data?: unknown;
  /** FormData body -- web-only; ignored on native. */
  formData?: FormData;
  /** Per-request timeout; defaults to NETWORK.REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Optional caller-owned cancellation. */
  signal?: AbortSignal;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

// ==================== Helpers ====================

/** True only inside the native Capacitor shell (Xcode / Android Studio). */
function isNativePlatform(): boolean {
  try {
    return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

let nativeUserAgentCache:
  | {
      platform: 'ios' | 'android';
      valuePromise: Promise<string | undefined>;
    }
  | null = null;

export function __resetNativeUserAgentCacheForTests(): void {
  nativeUserAgentCache = null;
}

function normalizeUaPart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ').replace(/\//g, '-');
  return normalized || undefined;
}

async function getNativeUserAgent(): Promise<string | undefined> {
  try {
    const platform = Capacitor.getPlatform?.();
    if (platform !== 'ios' && platform !== 'android') {
      return undefined;
    }

    if (nativeUserAgentCache && nativeUserAgentCache.platform === platform) {
      return nativeUserAgentCache.valuePromise;
    }

    const valuePromise = (async () => {
      const platformLabel = platform === 'ios' ? 'iOS' : 'Android';
      const base = `SpeleoDB-${platformLabel}`;

      const [appInfoResult, deviceInfoResult] = await Promise.allSettled([
        App.getInfo(),
        Device.getInfo(),
      ]);
      const appVersion =
        appInfoResult.status === 'fulfilled'
          ? normalizeUaPart(appInfoResult.value.version)
          : undefined;
      const deviceModel =
        deviceInfoResult.status === 'fulfilled'
          ? normalizeUaPart(getAppleMarketingModelOrIdentifier(deviceInfoResult.value.model))
          : undefined;
      const osVersion =
        deviceInfoResult.status === 'fulfilled'
          ? normalizeUaPart(deviceInfoResult.value.osVersion)
          : undefined;

      if (!appVersion && !deviceModel && !osVersion) {
        return base;
      }

      const versionPart = appVersion ? `v${appVersion}` : 'vunknown';
      const devicePart = deviceModel ?? 'device-unknown';
      const osPart = osVersion ? `${platformLabel} ${osVersion}` : platformLabel;
      return `${base}/${versionPart}/${devicePart} - ${osPart}`;
    })();
    nativeUserAgentCache = { platform, valuePromise };
    return valuePromise;
  } catch {
    // No-op: if native metadata fails we still keep transport functional.
    return undefined;
  }
}

function shouldInjectAppUserAgent(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    // SpeleoDB API calls should always carry app UA, including pre-login auth.
    if (parsedUrl.pathname.startsWith(`${API.BASE_PATH}/`)) {
      return true;
    }

    const requestHost = parsedUrl.hostname.toLowerCase();
    const instance = getPreferences().instance;
    if (!instance) return false;
    const instanceHost = new URL(getInstanceBaseUrl(instance)).hostname.toLowerCase();
    return requestHost === instanceHost;
  } catch {
    return false;
  }
}

function findHeaderKey(
  headers: Record<string, string>,
  target: string,
): string | undefined {
  const normalizedTarget = target.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === normalizedTarget);
}

function getWebUserAgent(): string {
  return 'SpeleoDB-Unittest';
}

async function buildNativeHeaders(
  url: string,
  headers?: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  const merged = { ...(headers ?? {}) };
  const existingUserAgentKey = findHeaderKey(merged, 'User-Agent');
  if (existingUserAgentKey) {
    return merged;
  }
  if (!shouldInjectAppUserAgent(url)) {
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  const userAgent = await getNativeUserAgent();
  if (!userAgent) {
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  merged['User-Agent'] = userAgent;
  return merged;
}

function buildWebHeaders(
  url: string,
  headers?: Record<string, string>,
  isFormDataRequest = false,
): Record<string, string> | undefined {
  const merged = { ...(headers ?? {}) };

  if (isFormDataRequest) {
    const existingContentTypeKey = findHeaderKey(merged, 'Content-Type');
    if (existingContentTypeKey) {
      delete merged[existingContentTypeKey];
    }
  }

  const existingUserAgentKey = findHeaderKey(merged, 'User-Agent');
  if (!existingUserAgentKey && shouldInjectAppUserAgent(url)) {
    merged['User-Agent'] = getWebUserAgent();
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

// ==================== HttpClient ====================

export class HttpClient {
  /**
   * Send an HTTP request. Automatically chooses CapacitorHttp on native
   * or fetch on web.
   */
  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    const timeout = req.timeoutMs ?? NETWORK.REQUEST_TIMEOUT_MS;

    if (isNativePlatform()) {
      return this.nativeRequest<T>(req, timeout);
    }
    return this.webRequest<T>(req, timeout);
  }

  // ---- Native (CapacitorHttp) -------------------------------------------------

  private async nativeRequest<T>(req: HttpRequest, timeout: number): Promise<HttpResponse<T>> {
    throwIfAborted(req.signal);
    const nativeHeaders = await buildNativeHeaders(req.url, req.headers);
    const response = await this.awaitWithAbort(
      CapacitorHttp.request({
        url: req.url,
        method: req.method,
        headers: nativeHeaders,
        data: req.data,
        connectTimeout: timeout,
        readTimeout: timeout,
      }),
      req.signal,
    );

    return { status: response.status, data: response.data as T };
  }

  private async awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      return promise;
    }

    throwIfAborted(signal);

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(createAbortError());
      };

      signal.addEventListener('abort', onAbort, { once: true });

      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  // ---- Web (fetch) ------------------------------------------------------------

  private async webRequest<T>(req: HttpRequest, timeout: number): Promise<HttpResponse<T>> {
    throwIfAborted(req.signal);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(createAbortError(`Request timed out after ${timeout}ms`)),
      timeout,
    );
    const onAbort = () => controller.abort(req.signal?.reason ?? createAbortError());

    if (req.signal) {
      req.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const init: RequestInit = {
        method: req.method,
        signal: controller.signal,
        redirect: 'follow',
      };

      // Prefer FormData when provided (e.g. login); otherwise send JSON body.
      // When using FormData the browser MUST set the Content-Type header itself
      // (it includes the multipart boundary), so we strip any caller-supplied
      // Content-Type to avoid a mismatch the server would reject as 400.
      if (req.formData) {
        init.body = req.formData;
        init.headers = buildWebHeaders(req.url, req.headers, true);
      } else {
        init.headers = buildWebHeaders(req.url, req.headers);
        if (req.data !== undefined) {
          init.body = JSON.stringify(req.data);
        }
      }

      const response = await fetch(req.url, init);

      // Parse JSON body (swallow parse errors to return raw status).
      let data: T;
      try {
        data = (await response.json()) as T;
      } catch {
        data = {} as T;
      }

      return { status: response.status, data };
    } finally {
      clearTimeout(timeoutId);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}
