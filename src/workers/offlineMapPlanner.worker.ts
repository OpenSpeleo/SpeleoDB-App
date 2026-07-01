import type { OfflineMapCoordinate, OfflineMapPlanningInput } from '../types/offlineMapSync';
import {
  encodeOfflineMapCoordinateChunk,
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
      let chunkIndex = 0;
      let batch: OfflineMapCoordinate[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        const index = chunkIndex;
        chunkIndex += 1;
        const encoded = encodeOfflineMapCoordinateChunk(batch);
        batch = [];
        const ack = new Promise<void>((resolve) => {
          acknowledge = (ackIndex) => {
            if (ackIndex !== index) return;
            acknowledge = null;
            resolve();
          };
        });
        workerScope.postMessage({ id, type: 'chunk', index, coordinates: encoded }, [encoded.buffer]);
        await ack;
      };
      for (const coordinate of iterateRawOfflineMapCoordinates(input)) {
        batch.push(coordinate);
        if (batch.length >= OFFLINE_MAP_PLAN_CHUNK_SIZE) await flush();
      }
      await flush();
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
