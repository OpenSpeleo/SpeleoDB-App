import { describe, expect, it, vi } from 'vitest';
import {
  collectOfflineMapCoordinates,
  computeOfflineMapSourceRevision,
  decodeOfflineMapCoordinateChunk,
  encodeOfflineMapCoordinateChunk,
  planOfflineMapInWorker,
} from './OfflineMapPlanner';

describe('OfflineMapPlanner', () => {
  it('unions project, point, and path coverage into unique canonical coordinates', () => {
    const coordinates = collectOfflineMapCoordinates({
      sourceRevision: 'r1',
      projects: [{
        west: 0,
        east: 0,
        south: 0,
        north: 0,
        crossesDateline: false,
      }],
      points: [[0, 0], [0, 0]],
      paths: [[[0, 0], [0.00001, 0.00001]]],
      minZoom: 0,
      maxZoom: 2,
      padMeters: 0,
    });

    expect(coordinates.length).toBeGreaterThan(0);
    expect(new Set(coordinates.map(({ z, x, y }) => `${z}/${x}/${y}`)).size)
      .toBe(coordinates.length);
    expect(coordinates).toEqual([...coordinates].sort(
      (a, b) => a.z - b.z || a.x - b.x || a.y - b.y,
    ));
  });

  it('round-trips compact typed-array plan chunks', () => {
    const coordinates = [{ z: 1, x: 2, y: 3 }, { z: 18, x: 200, y: 300 }];
    expect(decodeOfflineMapCoordinateChunk(encodeOfflineMapCoordinateChunk(coordinates)))
      .toEqual(coordinates);
  });

  it('computes a revision independent of source ordering', async () => {
    await expect(computeOfflineMapSourceRevision(['project:a', 'gps:b']))
      .resolves.toBe(await computeOfflineMapSourceRevision(['gps:b', 'project:a']));
  });

  it('length-delimits source parts and fails closed without SHA-256', async () => {
    await expect(computeOfflineMapSourceRevision(['ab', 'c']))
      .resolves.not.toBe(await computeOfflineMapSourceRevision(['a', 'bc']));

    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: {}, configurable: true, writable: true,
    });
    try {
      await expect(computeOfflineMapSourceRevision(['project:a']))
        .rejects.toThrow('SHA-256 is unavailable');
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto, configurable: true, writable: true,
      });
    }
  });

  it('awaits each raw planner chunk before producing the next one', async () => {
    let activeConsumers = 0;
    let maxActiveConsumers = 0;
    let chunks = 0;
    const chunkSizes: number[] = [];
    await planOfflineMapInWorker({
      sourceRevision: 'bounded',
      projects: [],
      points: Array.from({ length: 3_000 }, () => [1, 1] as [number, number]),
      paths: [],
      minZoom: 0,
      maxZoom: 0,
      padMeters: 0,
    }, async (chunk) => {
      activeConsumers += 1;
      maxActiveConsumers = Math.max(maxActiveConsumers, activeConsumers);
      chunks += 1;
      chunkSizes.push(chunk.length / 3);
      await Promise.resolve();
      activeConsumers -= 1;
    });

    expect(chunks).toBe(2);
    expect(chunkSizes).toEqual([2_048, 952]);
    expect(maxActiveConsumers).toBe(1);
  });

  it('uses the discriminated production worker protocol and acknowledges each chunk', async () => {
    const originalWorker = globalThis.Worker;
    const posted: unknown[] = [];
    const terminate = vi.fn();
    class ProtocolWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(value: unknown): void {
        posted.push(value);
        const message = value as { id?: number; type?: string; index?: number };
        if (message.type === 'plan') {
          queueMicrotask(() => this.onmessage?.({
            data: {
              id: message.id,
              type: 'chunk',
              index: 0,
              coordinates: new Uint32Array([0, 0, 0]),
            },
          } as MessageEvent<unknown>));
        } else if (message.type === 'ack' && message.index === 0) {
          queueMicrotask(() => this.onmessage?.({
            data: { id: message.id, type: 'done' },
          } as MessageEvent<unknown>));
        }
      }

      terminate(): void {
        terminate();
      }
    }
    Object.defineProperty(globalThis, 'Worker', {
      value: ProtocolWorker,
      configurable: true,
      writable: true,
    });
    const input = {
      sourceRevision: 'worker-protocol',
      projects: [],
      points: [[0, 0] as [number, number]],
      paths: [],
      minZoom: 0,
      maxZoom: 0,
      padMeters: 0,
    };
    const consume = vi.fn(async () => {});

    try {
      await expect(planOfflineMapInWorker(input, consume)).resolves.toBe(1);
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        value: originalWorker,
        configurable: true,
        writable: true,
      });
    }

    expect(posted).toEqual([
      { id: 1, type: 'plan', input },
      { id: 1, type: 'ack', index: 0 },
    ]);
    expect(consume).toHaveBeenCalledWith(new Uint32Array([0, 0, 0]), 0);
    expect(terminate).toHaveBeenCalledOnce();
  });
});
