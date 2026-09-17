import { registerPlugin } from '@capacitor/core';
import { throwIfAborted } from '../utils/abort';

export interface GisGeometryHttpPlugin {
  get(options: {
    requestId: string;
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ status: number; body: string; contentType: string }>;
  cancel(options: { requestId: string }): Promise<void>;
}

const plugin = registerPlugin<GisGeometryHttpPlugin>('GisGeometryHttp');
let nextRequestId = 0;

/** Native GET transport with no shared Django cookies or redirect replay. */
export async function requestGisGeometryHttp(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
  native: GisGeometryHttpPlugin = plugin,
) {
  throwIfAborted(signal);
  const requestId = `gis-${++nextRequestId}`;
  const cancel = () => { void native.cancel({ requestId }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const response = await native.get({ requestId, url, headers, timeoutMs });
    throwIfAborted(signal);
    return response;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
