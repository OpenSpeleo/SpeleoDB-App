import workerUrl from '../workers/offlineMapPlanner.worker.ts?worker&url';
import type { OfflineMapPlanningInput } from '../types/offlineMapSync';
import { createAbortError } from '../utils/abort';
import {
  collectUniqueOfflineMapCoordinateKeys,
  encodePackedOfflineMapCoordinateChunk,
  iterateRawOfflineMapCoordinates,
  OFFLINE_MAP_PLAN_CHUNK_SIZE,
} from './offlineMapPlanCore';

export {
  collectOfflineMapCoordinates,
  collectUniqueOfflineMapCoordinateKeys,
  decodeOfflineMapCoordinateChunk,
  encodeOfflineMapCoordinateChunk,
  encodePackedOfflineMapCoordinateChunk,
  OFFLINE_MAP_PLAN_CHUNK_SIZE,
  OFFLINE_MAP_PLAN_MAX_COORDINATES,
} from './offlineMapPlanCore';

type PlannerWorkerResponse =
  | { id: number; type: 'chunk'; index: number; coordinates: Uint32Array }
  | { id: number; type: 'done' }
  | { id: number; type: 'error'; message: string };

interface PlannerWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}

export type OfflineMapPlanConsumer = (
  chunk: Uint32Array,
  chunkIndex: number,
) => void | Promise<void>;

/**
 * Deduplicates and sorts coordinates off the WebView thread, then sends final
 * compact chunks with one-chunk acknowledgement.
 */
export function planOfflineMapInWorker(
  input: OfflineMapPlanningInput,
  consume: OfflineMapPlanConsumer,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) return Promise.reject(createAbortError('Offline-map planning aborted'));

  if (import.meta.env.MODE === 'test' && typeof Worker === 'undefined') {
    return (async () => {
      const keys = collectUniqueOfflineMapCoordinateKeys(
        iterateRawOfflineMapCoordinates(input),
      );
      for (
        let start = 0, chunkIndex = 0;
        start < keys.length;
        start += OFFLINE_MAP_PLAN_CHUNK_SIZE, chunkIndex += 1
      ) {
        if (signal?.aborted) throw createAbortError('Offline-map planning aborted');
        const end = Math.min(keys.length, start + OFFLINE_MAP_PLAN_CHUNK_SIZE);
        await consume(encodePackedOfflineMapCoordinateChunk(keys, start, end), chunkIndex);
      }
      return keys.length;
    })();
  }

  return new Promise<number>((resolve, reject) => {
    const id = 1;
    let rawCount = 0;
    let settled = false;
    let consumerTail = Promise.resolve();
    let worker: PlannerWorkerLike | null = null;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (!worker) return;
      worker.onmessage = null;
      worker.onmessageerror = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(createAbortError('Offline-map planning aborted'));

    try {
      worker = new Worker(workerUrl, { type: 'module', name: 'offline-map-planner' }) as unknown as PlannerWorkerLike;
      worker.onmessage = (event) => {
        const message = event.data as PlannerWorkerResponse;
        if (!message || message.id !== id || settled) return;
        if (message.type === 'chunk') {
          rawCount += message.coordinates.length / 3;
          consumerTail = consumerTail.then(async () => {
            await consume(message.coordinates, message.index);
            worker?.postMessage({ id, type: 'ack', index: message.index });
          });
          consumerTail.catch((error) => fail(
            error instanceof Error ? error : new Error('Offline-map plan consumer failed'),
          ));
          return;
        }
        if (message.type === 'error') {
          void consumerTail.finally(() => fail(new Error(message.message)));
          return;
        }
        void consumerTail.then(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(rawCount);
        }, (error) => fail(
          error instanceof Error ? error : new Error('Offline-map plan consumer failed'),
        ));
      };
      worker.onmessageerror = () => fail(new Error('Offline-map planner returned unreadable data'));
      worker.onerror = (event) => fail(new Error(event.message || 'Offline-map planner failed'));
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ id, type: 'plan', input });
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Unable to start offline-map planner'));
    }
  });
}

/** Collision-resistant, length-delimited identity for geometry/source inputs. */
export async function computeOfflineMapSourceRevision(
  parts: readonly string[],
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-256 is unavailable for offline-map planning');
  const sorted = [...parts].sort();
  const payload = sorted.map((part) => `${part.length}:${part}`).join('|');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `v2-${hex}`;
}
