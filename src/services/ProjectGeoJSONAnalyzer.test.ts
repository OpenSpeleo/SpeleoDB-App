import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_GEOJSON_VALIDATION } from '../constants';
import {
  ProjectGeoJSONAnalysisError,
  ProjectGeoJSONAnalyzer,
} from './ProjectGeoJSONAnalyzer';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

const point: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [2, 45] },
  }],
};

const measurement = {
  bounds: { west: 2, east: 2, south: 45, north: 45, crossesDateline: false },
  widthKm: 0,
  heightKm: 0,
} as const;

describe('ProjectGeoJSONAnalyzer worker lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a runtime-validated measurement and releases every resource', async () => {
    const worker = new FakeWorker();
    let now = 10;
    const clearTimer = vi.fn();
    const analyzer = new ProjectGeoJSONAnalyzer({
      createWorker: () => worker,
      now: () => now,
      setTimer: vi.fn(() => 7 as unknown as ReturnType<typeof setTimeout>),
      clearTimer,
    });
    const promise = analyzer.analyze(point);
    now = 25;
    worker.onmessage?.({
      data: { id: 1, ok: true, measurement },
    } as MessageEvent);

    await expect(promise).resolves.toEqual({ ...measurement, durationMs: 15 });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, featureCollection: point });
    expect(clearTimer).toHaveBeenCalledWith(7);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('enforces the timer deadline, records duration, and disconnects late messages', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const analyzer = new ProjectGeoJSONAnalyzer({ createWorker: () => worker });
    const promise = analyzer.analyze(point);
    const lateHandler = worker.onmessage;
    const assertion = expect(promise).rejects.toMatchObject({
      reason: 'validation_unavailable',
      fileScoped: false,
      diagnostics: {
        bounds: null,
        widthKm: null,
        heightKm: null,
        durationMs: PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS,
      },
    });

    await vi.advanceTimersByTimeAsync(PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    lateHandler?.({ data: { id: 1, ok: true, measurement } } as MessageEvent);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not post when worker construction consumes the complete budget', async () => {
    let now = 0;
    const worker = new FakeWorker();
    const analyzer = new ProjectGeoJSONAnalyzer({
      now: () => now,
      createWorker: () => {
        now = PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS;
        return worker;
      },
    });

    await expect(analyzer.analyze(point)).rejects.toMatchObject({
      reason: 'validation_unavailable',
      fileScoped: false,
      diagnostics: { durationMs: PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS },
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('checks elapsed time again after synchronous structured cloning', async () => {
    let now = 0;
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      now = PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS + 1;
    });
    const analyzer = new ProjectGeoJSONAnalyzer({
      now: () => now,
      createWorker: () => worker,
    });

    await expect(analyzer.analyze(point)).rejects.toMatchObject({
      reason: 'validation_unavailable',
      fileScoped: false,
      diagnostics: { durationMs: PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS + 1 },
    });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('accepts a result before the deadline and rejects one at the deadline', async () => {
    for (const [finishedAt, expected] of [
      [PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS - 1, 'success'],
      [PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS, 'validation_unavailable'],
    ] as const) {
      let now = 0;
      const worker = new FakeWorker();
      const analyzer = new ProjectGeoJSONAnalyzer({
        now: () => now,
        createWorker: () => worker,
      });
      const promise = analyzer.analyze(point);
      now = finishedAt;
      worker.onmessage?.({ data: { id: 1, ok: true, measurement } } as MessageEvent);
      if (expected === 'success') {
        await expect(promise).resolves.toMatchObject({
          durationMs: PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS - 1,
        });
      } else {
        await expect(promise).rejects.toMatchObject({ reason: expected });
      }
    }
  });

  it('preserves file failure reason, partial measurement, and elapsed duration', async () => {
    const worker = new FakeWorker();
    let now = 0;
    const analyzer = new ProjectGeoJSONAnalyzer({
      createWorker: () => worker,
      now: () => now,
    });
    const promise = analyzer.analyze(point);
    now = 37;
    worker.onmessage?.({
      data: {
        id: 1,
        ok: false,
        reason: 'bbox_error',
        message: 'unsafe projected footprint',
        partialMeasurement: measurement,
      },
    } as MessageEvent);

    await expect(promise).rejects.toMatchObject({
      reason: 'bbox_error',
      fileScoped: true,
      diagnostics: { ...measurement, durationMs: 37 },
    });
  });

  it.each([
    ['non-object', null],
    ['foreign id', { id: 2, ok: true, measurement }],
    ['missing status', { id: 1, measurement }],
    ['unknown reason', {
      id: 1,
      ok: false,
      reason: 'validation_unavailable',
      message: 'wrong channel',
      partialMeasurement: null,
    }],
    ['missing partial measurement', {
      id: 1,
      ok: false,
      reason: 'bbox_error',
      message: 'bad',
    }],
    ['non-finite dimension', {
      id: 1,
      ok: true,
      measurement: { ...measurement, widthKm: Number.NaN },
    }],
    ['inconsistent wrapped bounds', {
      id: 1,
      ok: true,
      measurement: {
        ...measurement,
        bounds: { ...measurement.bounds, west: -10, east: 10, crossesDateline: true },
      },
    }],
  ])('fails closed on an unexpected %s response', async (_label, response) => {
    const worker = new FakeWorker();
    const analyzer = new ProjectGeoJSONAnalyzer({ createWorker: () => worker });
    const promise = analyzer.analyze(point);
    worker.onmessage?.({ data: response } as MessageEvent);
    await expect(promise).rejects.toMatchObject({
      reason: 'validation_unavailable',
      fileScoped: false,
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('prevents worker events from escaping to global handlers', async () => {
    for (const kind of ['messageerror', 'error'] as const) {
      const worker = new FakeWorker();
      const preventDefault = vi.fn();
      const analyzer = new ProjectGeoJSONAnalyzer({ createWorker: () => worker });
      const promise = analyzer.analyze(point);

      if (kind === 'messageerror') {
        worker.onmessageerror?.({ preventDefault } as unknown as MessageEvent);
      } else {
        worker.onerror?.({ message: 'asset failed', preventDefault } as unknown as ErrorEvent);
      }

      await expect(promise).rejects.toMatchObject({
        reason: 'validation_unavailable',
        fileScoped: false,
      });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  });

  it('cleans up synchronous constructor and posting failures', async () => {
    const unavailable = new ProjectGeoJSONAnalyzer({
      createWorker: () => { throw new Error('worker asset missing'); },
    });
    await expect(unavailable.analyze(point)).rejects.toMatchObject({
      reason: 'validation_unavailable',
      fileScoped: false,
    });

    const worker = new FakeWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('structured clone failed');
    });
    const postFailure = new ProjectGeoJSONAnalyzer({ createWorker: () => worker });
    await expect(postFailure.analyze(point)).rejects.toMatchObject({
      reason: 'validation_unavailable',
      fileScoped: false,
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not create a worker when already aborted', async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const analyzer = new ProjectGeoJSONAnalyzer({ createWorker });
    const abortController = new AbortController();
    abortController.abort();

    await expect(analyzer.analyze(point, { signal: abortController.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('lets abort win its race and ignores a copied success handler afterward', async () => {
    const worker = new FakeWorker();
    const analyzer = new ProjectGeoJSONAnalyzer({ createWorker: () => worker });
    const abortController = new AbortController();
    const promise = analyzer.analyze(point, { signal: abortController.signal });
    const successHandler = worker.onmessage;

    abortController.abort();
    successHandler?.({ data: { id: 1, ok: true, measurement } } as MessageEvent);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('derives file scope from the typed reason, not a mismatched caller flag', () => {
    expect(new ProjectGeoJSONAnalysisError('validation_unavailable', 'no worker', true))
      .toMatchObject({ fileScoped: false });
    expect(new ProjectGeoJSONAnalysisError('bbox_error', 'bad bbox', false))
      .toMatchObject({ fileScoped: true });
  });
});

describe('projectGeoJSONBounds worker module', () => {
  it('emits typed success, computation failure, and malformed-request responses', async () => {
    const originalSelf = globalThis.self;
    const scope: {
      onmessage: ((event: MessageEvent<unknown>) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
    } = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal('self', scope);
    vi.resetModules();

    try {
      await import('../workers/projectGeoJSONBounds.worker');
      scope.onmessage?.({ data: { id: 7, featureCollection: point } } as MessageEvent);
      expect(scope.postMessage).toHaveBeenLastCalledWith({
        id: 7,
        ok: true,
        measurement,
      });

      scope.onmessage?.({
        data: { id: 8, featureCollection: { type: 'FeatureCollection', features: [] } },
      } as MessageEvent);
      expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
        id: 8,
        ok: false,
        reason: 'no_coordinates',
        partialMeasurement: null,
      }));

      scope.onmessage?.({ data: { id: 9 } } as MessageEvent);
      expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
        id: 9,
        ok: false,
        reason: 'invalid_geojson',
      }));
    } finally {
      vi.stubGlobal('self', originalSelf);
      vi.resetModules();
    }
  });
});
