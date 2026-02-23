/**
 * Transport abstraction: hides the native CapacitorHttp vs web fetch difference.
 * Every other layer calls HttpClient.request() and never touches Capacitor or fetch directly.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { NETWORK } from '../constants';
import { getPreferences } from './PreferencesService';
import { getInstanceBaseUrl } from '../utils/url';
import { getAppleMarketingModelOrIdentifier } from '../utils/appleDeviceModelMap';

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
    const requestHost = new URL(url).hostname.toLowerCase();
    const instance = getPreferences().instance;
    if (!instance) return false;
    const instanceHost = new URL(getInstanceBaseUrl(instance)).hostname.toLowerCase();
    return requestHost === instanceHost;
  } catch {
    return false;
  }
}

async function buildNativeHeaders(
  url: string,
  headers?: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  const merged = { ...(headers ?? {}) };
  const existingUserAgentKey = Object.keys(merged).find((key) => key.toLowerCase() === 'user-agent');
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
    const nativeHeaders = await buildNativeHeaders(req.url, req.headers);
    const response = await CapacitorHttp.request({
      url: req.url,
      method: req.method,
      headers: nativeHeaders,
      data: req.data,
      connectTimeout: timeout,
      readTimeout: timeout,
    });

    return { status: response.status, data: response.data as T };
  }

  // ---- Web (fetch) ------------------------------------------------------------

  private async webRequest<T>(req: HttpRequest, timeout: number): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

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
        if (req.headers) {
          const { 'Content-Type': _ct, ...rest } = req.headers;
          if (Object.keys(rest).length > 0) {
            init.headers = rest;
          }
        }
      } else {
        init.headers = req.headers;
        if (req.data !== undefined) {
          init.body = JSON.stringify(req.data);
        }
      }

      const response = await fetch(req.url, init);
      clearTimeout(timeoutId);

      // Parse JSON body (swallow parse errors to return raw status).
      let data: T;
      try {
        data = (await response.json()) as T;
      } catch {
        data = {} as T;
      }

      return { status: response.status, data };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}
