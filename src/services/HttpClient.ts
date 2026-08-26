/**
 * Transport abstraction: hides the native CapacitorHttp vs web fetch difference.
 * Every other layer calls HttpClient.request() and never touches Capacitor or fetch directly.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { API, NETWORK } from '../constants';
import { getPreferences } from './PreferencesService';
import { getInstanceBaseUrl } from '../utils/instanceUrl';
import { getAppleMarketingModelOrIdentifier } from '../utils/appleDeviceModelMap';
import { createAbortError, throwIfAborted } from '../utils/abort';

// ==================== Public types ====================

/** A single text file part of a multipart/form-data upload. */
export interface MultipartFilePart {
  /** Form field name (the backend reads `file`). */
  fieldName: string;
  fileName: string;
  /** MIME type written into the part header. */
  contentType: string;
  /** UTF-8 text content (GPX). Binary is intentionally unsupported. */
  content: string;
}

/**
 * A multipart/form-data payload that works on BOTH transports. The web path
 * builds a real `FormData`; the native path serializes a raw multipart body
 * string with an explicit boundary (CapacitorHttp has no FormData support).
 * Only text parts are supported, which is all the GPX upload needs.
 */
export interface MultipartPayload {
  /** Simple text fields (e.g. `collection`). */
  fields?: Record<string, string>;
  file: MultipartFilePart;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** JSON-serialisable body (used on both native and web). */
  data?: unknown;
  /** FormData body -- web-only; ignored on native. */
  formData?: FormData;
  /**
   * Cross-platform multipart/form-data text upload. Preferred over `formData`
   * because it also works on native (CapacitorHttp). See `MultipartPayload`.
   */
  multipart?: MultipartPayload;
  /** Positive overall request deadline; defaults to NETWORK.REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Optional caller-owned cancellation. */
  signal?: AbortSignal;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

export interface HttpClientDeps {
  isNativePlatform?: () => boolean;
  isProduction?: () => boolean;
  getNativeUserAgent?: () => Promise<string | undefined>;
  nativeHttp?: Pick<typeof CapacitorHttp, 'request'>;
}

export class MultipartPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipartPayloadError';
  }
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

    let valuePromise = nativeUserAgentCache?.platform === platform
      ? nativeUserAgentCache.valuePromise
      : undefined;
    if (!valuePromise) {
      valuePromise = (async () => {
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
    }

    try {
      return await valuePromise;
    } catch {
      if (nativeUserAgentCache?.valuePromise === valuePromise) {
        nativeUserAgentCache = null;
      }
      return undefined;
    }
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

function hasSensitiveRequestData(req: HttpRequest): boolean {
  const headers = req.headers ?? {};
  const hasSensitiveHeader = Object.keys(headers).some((key) =>
    ['authorization', 'cookie', 'proxy-authorization'].includes(key.toLowerCase()),
  );
  return hasSensitiveHeader
    || req.data !== undefined
    || req.formData !== undefined
    || req.multipart !== undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]';
}

export function assertSafeRequestUrl(url: string, isProduction: boolean): void {
  const parsed = new URL(url);
  if (parsed.username || parsed.password) {
    throw new TypeError('Request URLs must not contain embedded credentials');
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && !isProduction && isLoopbackHostname(parsed.hostname)) return;
  throw new TypeError('Requests must use HTTPS');
}

function getWebUserAgent(): string {
  return 'SpeleoDB-Web';
}

interface RequestAbortContext {
  signal: AbortSignal;
  cleanup: () => void;
}

function createRequestAbortContext(
  timeout: number,
  callerSignal?: AbortSignal,
): RequestAbortContext {
  throwIfAborted(callerSignal);
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(createAbortError(`Request timed out after ${timeout}ms`)),
    timeout,
  );
  const onCallerAbort = () => {
    controller.abort(callerSignal?.reason ?? createAbortError());
  };
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

async function buildNativeHeaders(
  url: string,
  headers?: Record<string, string>,
  loadUserAgent: () => Promise<string | undefined> = getNativeUserAgent,
): Promise<Record<string, string> | undefined> {
  const merged = { ...(headers ?? {}) };
  const existingUserAgentKey = findHeaderKey(merged, 'User-Agent');
  if (existingUserAgentKey) {
    return merged;
  }
  if (!shouldInjectAppUserAgent(url)) {
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  const userAgent = await loadUserAgent();
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

// ==================== Multipart helpers ====================

const CRLF = '\r\n';

/** Generate a unique multipart boundary token. */
function generateBoundary(): string {
  const random = Math.random().toString(36).slice(2);
  return `----SpeleoDBFormBoundary${Date.now().toString(36)}${random}`;
}

function quoteMultipartHeaderValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r|\n/g, ' ');
}

function assertSafeTextField(name: string, value: string): void {
  if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
    throw new MultipartPayloadError('Multipart field names and values must not contain CRLF characters.');
  }
}

function assertNoBoundaryCollision(content: string, boundary: string): void {
  if (content.includes(`--${boundary}`)) {
    throw new MultipartPayloadError('Multipart content contains the generated boundary.');
  }
}

function validateMultipartPayload(payload: MultipartPayload, boundary?: string): void {
  for (const [name, value] of Object.entries(payload.fields ?? {})) {
    assertSafeTextField(name, value);
  }
  const file = payload.file;
  assertSafeTextField(file.fieldName, file.contentType);
  assertSafeTextField('filename', file.fileName);
  if (boundary) {
    assertNoBoundaryCollision(file.content, boundary);
  }
}

/**
 * Serialize a multipart payload to a raw body string for native transport.
 * Only text parts are emitted, so a plain string body is byte-correct.
 */
export function buildMultipartString(payload: MultipartPayload, boundary: string): string {
  validateMultipartPayload(payload, boundary);
  const parts: string[] = [];
  for (const [name, value] of Object.entries(payload.fields ?? {})) {
    parts.push(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${quoteMultipartHeaderValue(name)}"${CRLF}${CRLF}` +
        `${value}${CRLF}`,
    );
  }
  const file = payload.file;
  parts.push(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${quoteMultipartHeaderValue(file.fieldName)}"; filename="${quoteMultipartHeaderValue(file.fileName)}"${CRLF}` +
      `Content-Type: ${file.contentType}${CRLF}${CRLF}` +
      `${file.content}${CRLF}`,
  );
  parts.push(`--${boundary}--${CRLF}`);
  return parts.join('');
}

/** Build a real `FormData` from a multipart payload (web transport). */
function buildMultipartFormData(payload: MultipartPayload): FormData {
  validateMultipartPayload(payload);
  const fd = new FormData();
  for (const [name, value] of Object.entries(payload.fields ?? {})) {
    fd.append(name, value);
  }
  const file = payload.file;
  const blob = new Blob([file.content], { type: file.contentType });
  fd.append(file.fieldName, blob, file.fileName);
  return fd;
}

// ==================== HttpClient ====================

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class HttpClient {
  constructor(private deps: HttpClientDeps = {}) {}

  /**
   * Send an HTTP request. Automatically chooses CapacitorHttp on native
   * or fetch on web.
   */
  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    const timeout = req.timeoutMs ?? NETWORK.REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMER_DELAY_MS) {
      throw new RangeError(
        `Request timeout must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
      );
    }
    assertSafeRequestUrl(req.url, (this.deps.isProduction ?? (() => import.meta.env.PROD))());

    if ((this.deps.isNativePlatform ?? isNativePlatform)()) {
      return this.nativeRequest<T>(req, timeout);
    }
    return this.webRequest<T>(req, timeout);
  }

  // ---- Native (CapacitorHttp) -------------------------------------------------

  private async nativeRequest<T>(req: HttpRequest, timeout: number): Promise<HttpResponse<T>> {
    const abortContext = createRequestAbortContext(timeout, req.signal);
    try {
      const operation = this.performNativeRequest<T>(req, timeout, abortContext.signal);
      return await this.awaitWithAbort(operation, abortContext.signal);
    } finally {
      if (abortContext.signal.aborted && !this.deps.getNativeUserAgent) {
        nativeUserAgentCache = null;
      }
      abortContext.cleanup();
    }
  }

  private async performNativeRequest<T>(
    req: HttpRequest,
    timeout: number,
    signal: AbortSignal,
  ): Promise<HttpResponse<T>> {
    throwIfAborted(signal);

    let data = req.data;
    let headerOverrides = req.headers;
    // CapacitorHttp has no FormData support, so serialize multipart uploads to a
    // raw body string with an explicit boundary and matching Content-Type. GPX
    // is text, so a string body is byte-correct (no binary encoding needed).
    if (req.multipart) {
      const boundary = generateBoundary();
      data = buildMultipartString(req.multipart, boundary);
      headerOverrides = {
        ...(req.headers ?? {}),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      };
    }

    const nativeHeaders = await buildNativeHeaders(
      req.url,
      headerOverrides,
      this.deps.getNativeUserAgent,
    );
    throwIfAborted(signal);
    const nativeHttp = this.deps.nativeHttp ?? CapacitorHttp;
    const response = await nativeHttp.request({
      url: req.url,
      method: req.method,
      headers: nativeHeaders,
      data,
      connectTimeout: timeout,
      readTimeout: timeout,
      disableRedirects: hasSensitiveRequestData(req),
    });
    throwIfAborted(signal);

    return { status: response.status, data: response.data as T };
  }

  private async awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    throwIfAborted(signal);

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        try {
          throwIfAborted(signal);
        } catch (error) {
          reject(error);
        }
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
    const abortContext = createRequestAbortContext(timeout, req.signal);

    try {
      const init: RequestInit = {
        method: req.method,
        signal: abortContext.signal,
        redirect: hasSensitiveRequestData(req) ? 'manual' : 'follow',
      };

      // Prefer FormData when provided (e.g. login); otherwise send JSON body.
      // When using FormData the browser MUST set the Content-Type header itself
      // (it includes the multipart boundary), so we strip any caller-supplied
      // Content-Type to avoid a mismatch the server would reject as 400.
      const formData = req.formData ?? (req.multipart ? buildMultipartFormData(req.multipart) : undefined);
      if (formData) {
        init.body = formData;
        init.headers = buildWebHeaders(req.url, req.headers, true);
      } else {
        init.headers = buildWebHeaders(req.url, req.headers);
        if (req.data !== undefined) {
          init.body = JSON.stringify(req.data);
        }
      }

      const response = await this.awaitWithAbort(
        fetch(req.url, init),
        abortContext.signal,
      );

      // Swallow malformed JSON only. Deadline/caller abort remains
      // authoritative through body parsing and final publication.
      let data: T;
      try {
        data = (await this.awaitWithAbort(
          response.json(),
          abortContext.signal,
        )) as T;
      } catch {
        throwIfAborted(abortContext.signal);
        data = {} as T;
      }
      throwIfAborted(abortContext.signal);

      return { status: response.status, data };
    } finally {
      abortContext.cleanup();
    }
  }
}
