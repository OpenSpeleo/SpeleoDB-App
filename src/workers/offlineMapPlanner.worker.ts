import type { OfflineMapPlanningInput } from '../types/offlineMapSync';
import {
  collectUniqueOfflineMapCoordinateKeys,
  encodePackedOfflineMapCoordinateChunk,
  iterateRawOfflineMapCoordinates,
  OFFLINE_MAP_PLAN_CHUNK_SIZE,
} from '../services/offlineMapPlanCore';

type WorkerResponse =
  | { id: number; type: 'chunk'; index: number; coordinates: Uint32Array }
  | { id: number; type: 'done' }
  | { id: number; type: 'error'; message: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: WorkerResponse, transfer?: Transferable[]): void;
};

type WorkerRequest =
  | { id: number; type: 'plan'; input: OfflineMapPlanningInput }
  | { id: number; type: 'ack'; index: number };

function isRequest(value: unknown): value is WorkerRequest {
  return Boolean(
    value
    && typeof value === 'object'
    && 'id' in value
    && Number.isSafeInteger((value as { id: unknown }).id)
    && 'type' in value,
  );
}

let acknowledge: ((index: number) => void) | null = null;

workerScope.onmessage = (event) => {
  if (!isRequest(event.data)) return;
  if (event.data.type === 'ack') {
    acknowledge?.(event.data.index);
    return;
  }
  const { id, input } = event.data;
  void (async () => {
    try {
      const keys = collectUniqueOfflineMapCoordinateKeys(
        iterateRawOfflineMapCoordinates(input),
      );
      for (
        let start = 0, index = 0;
        start < keys.length;
        start += OFFLINE_MAP_PLAN_CHUNK_SIZE, index += 1
      ) {
        const end = Math.min(keys.length, start + OFFLINE_MAP_PLAN_CHUNK_SIZE);
        const encoded = encodePackedOfflineMapCoordinateChunk(keys, start, end);
        const ack = new Promise<void>((resolve) => {
          acknowledge = (ackIndex) => {
            if (ackIndex !== index) return;
            acknowledge = null;
            resolve();
          };
        });
        workerScope.postMessage({ id, type: 'chunk', index, coordinates: encoded }, [encoded.buffer]);
        await ack;
      }
      workerScope.postMessage({ id, type: 'done' });
    } catch (error) {
      workerScope.postMessage({
        id,
        type: 'error',
        message: error instanceof Error ? error.message : 'Offline-map planning failed',
      });
    }
  })();
};

export {};
