import workerUrl from '../workers/projectGeoJSONBounds.worker.ts?worker&url';
import { PROJECT_GEOJSON_VALIDATION } from '../constants';
import type {
  ProjectGeoJSONAnalysis,
  ProjectGeoJSONAnalysisFailureReason,
  ProjectGeoJSONBounds,
  ProjectGeoJSONContentFailureReason,
  ProjectGeoJSONFailureDiagnostics,
} from '../types/projectGeoJSON';
import { createAbortError } from '../utils/abort';
import {
  measureProjectGeoJSONBounds,
  ProjectGeoJSONComputationError,
  type ProjectGeoJSONMeasurement,
} from '../utils/projectGeoJSONBounds';

type WorkerFileFailureReason = Extract<
  ProjectGeoJSONContentFailureReason,
  'invalid_geojson' | 'no_coordinates' | 'bbox_error'
>;

type WorkerResponse =
  | {
      id: number;
      ok: true;
      measurement: ProjectGeoJSONMeasurement;
    }
  | {
      id: number;
      ok: false;
      reason: WorkerFileFailureReason;
      message: string;
      partialMeasurement: ProjectGeoJSONMeasurement | null;
    };

interface AnalyzerWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface ProjectGeoJSONAnalyzerPort {
  analyze(
    featureCollection: GeoJSON.FeatureCollection,
    options?: { signal?: AbortSignal },
  ): Promise<ProjectGeoJSONAnalysis>;
}

const EMPTY_FAILURE_DIAGNOSTICS: ProjectGeoJSONFailureDiagnostics = {
  bounds: null,
  widthKm: null,
  heightKm: null,
  durationMs: null,
};

export class ProjectGeoJSONAnalysisError extends Error {
  public readonly fileScoped: boolean;
  public readonly diagnostics: ProjectGeoJSONFailureDiagnostics;

  constructor(
    public readonly reason: ProjectGeoJSONAnalysisFailureReason,
    message: string,
    _fileScoped = reason !== 'validation_unavailable',
    diagnostics: ProjectGeoJSONFailureDiagnostics = EMPTY_FAILURE_DIAGNOSTICS,
  ) {
    super(message);
    this.name = 'ProjectGeoJSONAnalysisError';
    // Classification follows the reason, not a caller-supplied boolean. This
    // makes it impossible to persist an infrastructure failure as quarantine.
    this.fileScoped = reason !== 'validation_unavailable';
    this.diagnostics = { ...diagnostics };
  }
}

interface AnalyzerDependencies {
  createWorker: () => AnalyzerWorker;
  now: () => number;
  setTimer: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

const defaultDependencies: AnalyzerDependencies = {
  createWorker: () => new Worker(workerUrl, {
    type: 'module',
    name: 'project-geojson-bounds',
  }) as unknown as AnalyzerWorker,
  now: () => performance.now(),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: (timer) => clearTimeout(timer),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBounds(value: unknown): value is ProjectGeoJSONBounds {
  if (!isRecord(value)) return false;
  const { west, east, south, north, crossesDateline } = value;
  if (
    !isFiniteNumber(west)
    || !isFiniteNumber(east)
    || !isFiniteNumber(south)
    || !isFiniteNumber(north)
    || typeof crossesDateline !== 'boolean'
    || west < -180
    || west > 180
    || east < -180
    || east > 180
    || south < -90
    || south > 90
    || north < -90
    || north > 90
    || south > north
  ) {
    return false;
  }
  if (west === -180 && east === 180 && !crossesDateline) return true;
  return crossesDateline ? west > east : west <= east;
}

function isMeasurement(value: unknown): value is ProjectGeoJSONMeasurement {
  if (!isRecord(value)) return false;
  return isBounds(value.bounds)
    && isFiniteNumber(value.widthKm)
    && value.widthKm >= 0
    && isFiniteNumber(value.heightKm)
    && value.heightKm >= 0;
}

function parseWorkerResponse(value: unknown, expectedId: number): WorkerResponse | null {
  if (!isRecord(value) || value.id !== expectedId || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (!isMeasurement(value.measurement)) return null;
    return { id: expectedId, ok: true, measurement: value.measurement };
  }

  if (
    value.reason !== 'invalid_geojson'
    && value.reason !== 'no_coordinates'
    && value.reason !== 'bbox_error'
  ) {
    return null;
  }
  if (typeof value.message !== 'string') return null;
  if (value.partialMeasurement !== null && !isMeasurement(value.partialMeasurement)) return null;
  return {
    id: expectedId,
    ok: false,
    reason: value.reason,
    message: value.message,
    partialMeasurement: value.partialMeasurement,
  };
}

function diagnostics(
  measurement: ProjectGeoJSONMeasurement | null,
  durationMs: number | null,
): ProjectGeoJSONFailureDiagnostics {
  return {
    bounds: measurement?.bounds ?? null,
    widthKm: measurement?.widthKm ?? null,
    heightKm: measurement?.heightKm ?? null,
    durationMs,
  };
}

function validationTimeoutError(
  measurement: ProjectGeoJSONMeasurement | null,
  durationMs: number | null,
): ProjectGeoJSONAnalysisError {
  return new ProjectGeoJSONAnalysisError(
    'validation_unavailable',
    `Project GeoJSON validation did not complete within ${PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS} ms.`,
    false,
    diagnostics(measurement, durationMs),
  );
}

export class ProjectGeoJSONAnalyzer implements ProjectGeoJSONAnalyzerPort {
  private readonly dependencies: AnalyzerDependencies;
  private readonly useTestFallback: boolean;

  constructor(dependencies: Partial<AnalyzerDependencies> = {}) {
    this.useTestFallback = dependencies.createWorker === undefined;
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  analyze(
    featureCollection: GeoJSON.FeatureCollection,
    options: { signal?: AbortSignal } = {},
  ): Promise<ProjectGeoJSONAnalysis> {
    const startedAt = this.dependencies.now();
    if (options.signal?.aborted) return Promise.reject(createAbortError('GeoJSON analysis aborted'));

    // Vitest/jsdom has no browser Worker implementation. Production always
    // uses the explicitly bundled worker URL; this path lets integration tests
    // exercise the same pure computation without installing a fake global.
    if (
      import.meta.env.MODE === 'test'
      && typeof Worker === 'undefined'
      && this.useTestFallback
    ) {
      return this.analyzeWithoutWorker(featureCollection, startedAt, options.signal);
    }

    return new Promise<ProjectGeoJSONAnalysis>((resolve, reject) => {
      const requestId = 1;
      let worker: AnalyzerWorker | null = null;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const elapsed = (): number | null => {
        const value = this.dependencies.now() - startedAt;
        return Number.isFinite(value) ? Math.max(0, value) : null;
      };
      const cleanup = () => {
        if (timer !== null) {
          this.dependencies.clearTimer(timer);
          timer = null;
        }
        options.signal?.removeEventListener('abort', handleAbort);
        if (worker) {
          worker.onmessage = null;
          worker.onmessageerror = null;
          worker.onerror = null;
          try {
            worker.terminate();
          } catch {
            // Cleanup must not replace the original terminal result.
          }
          worker = null;
        }
      };
      const settleResolve = (analysis: ProjectGeoJSONAnalysis) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(analysis);
      };
      const settleReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const unavailable = (message: string) => new ProjectGeoJSONAnalysisError(
        'validation_unavailable',
        message,
        false,
        diagnostics(null, elapsed()),
      );
      const timedOut = (measurement: ProjectGeoJSONMeasurement | null = null) => {
        const durationMs = elapsed();
        return validationTimeoutError(measurement, durationMs);
      };
      const rejectIfDeadlineReached = (
        measurement: ProjectGeoJSONMeasurement | null = null,
      ): boolean => {
        const durationMs = elapsed();
        if (durationMs === null) {
          settleReject(unavailable('GeoJSON validation clock returned an invalid value.'));
          return true;
        }
        if (durationMs >= PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS) {
          settleReject(timedOut(measurement));
          return true;
        }
        return false;
      };
      const handleAbort = () => settleReject(createAbortError('GeoJSON analysis aborted'));
      const handleDeadlineTimer = () => {
        timer = null;
        const durationMs = elapsed();
        if (durationMs === null) {
          settleReject(unavailable('GeoJSON validation clock returned an invalid value.'));
          return;
        }
        if (durationMs >= PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS) {
          settleReject(timedOut());
          return;
        }
        // Browsers may wake a timer fractionally early. Keep the wall-clock
        // deadline authoritative rather than rejecting before the configured limit.
        timer = this.dependencies.setTimer(
          handleDeadlineTimer,
          PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS - durationMs,
        );
      };

      options.signal?.addEventListener('abort', handleAbort, { once: true });
      if (options.signal?.aborted) {
        handleAbort();
        return;
      }
      const initialElapsed = elapsed();
      if (initialElapsed === null) {
        settleReject(unavailable('GeoJSON validation clock returned an invalid value.'));
        return;
      }
      timer = this.dependencies.setTimer(
        handleDeadlineTimer,
        Math.max(0, PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS - initialElapsed),
      );

      try {
        const createdWorker = this.dependencies.createWorker();
        worker = createdWorker;
      } catch (error) {
        settleReject(unavailable(
          error instanceof Error ? error.message : 'Unable to start GeoJSON validation worker.',
        ));
        return;
      }

      // A constructor can synchronously consume the complete budget or trigger
      // cancellation. Do not post the file after either terminal condition.
      if (settled) {
        cleanup();
        return;
      }
      if (rejectIfDeadlineReached()) return;

      worker.onmessage = (event) => {
        if (rejectIfDeadlineReached()) return;
        const response = parseWorkerResponse(event.data, requestId);
        if (!response) {
          settleReject(unavailable('GeoJSON validation worker returned an unexpected response.'));
          return;
        }
        const durationMs = elapsed();
        if (durationMs === null) {
          settleReject(unavailable('GeoJSON validation clock returned an invalid value.'));
          return;
        }
        if (!response.ok) {
          settleReject(new ProjectGeoJSONAnalysisError(
            response.reason,
            response.message,
            true,
            diagnostics(response.partialMeasurement, durationMs),
          ));
          return;
        }
        settleResolve({ ...response.measurement, durationMs });
      };
      worker.onmessageerror = (event) => {
        event.preventDefault?.();
        settleReject(unavailable('GeoJSON validation worker returned an unreadable response.'));
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        settleReject(unavailable(event.message || 'GeoJSON validation worker failed to load.'));
      };

      try {
        worker.postMessage({ id: requestId, featureCollection });
      } catch (error) {
        settleReject(unavailable(
          error instanceof Error ? error.message : 'Unable to send GeoJSON to validation worker.',
        ));
        return;
      }
      rejectIfDeadlineReached();
    });
  }

  private analyzeWithoutWorker(
    featureCollection: GeoJSON.FeatureCollection,
    startedAt: number,
    signal?: AbortSignal,
  ): Promise<ProjectGeoJSONAnalysis> {
    let measurement: ProjectGeoJSONMeasurement | null = null;
    try {
      measurement = measureProjectGeoJSONBounds(featureCollection);
      const durationMs = this.dependencies.now() - startedAt;
      if (signal?.aborted) return Promise.reject(createAbortError('GeoJSON analysis aborted'));
      if (!Number.isFinite(durationMs)) {
        return Promise.reject(new ProjectGeoJSONAnalysisError(
          'validation_unavailable',
          'GeoJSON validation clock returned an invalid value.',
          false,
        ));
      }
      if (durationMs >= PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS) {
        return Promise.reject(validationTimeoutError(measurement, Math.max(0, durationMs)));
      }
      return Promise.resolve({ ...measurement, durationMs: Math.max(0, durationMs) });
    } catch (error) {
      const durationMs = this.dependencies.now() - startedAt;
      const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : null;
      if (safeDuration !== null && safeDuration >= PROJECT_GEOJSON_VALIDATION.TIMEOUT_MS) {
        return Promise.reject(validationTimeoutError(
          error instanceof ProjectGeoJSONComputationError ? error.measurement : measurement,
          safeDuration,
        ));
      }
      if (error instanceof ProjectGeoJSONComputationError) {
        return Promise.reject(new ProjectGeoJSONAnalysisError(
          error.reason,
          error.message,
          true,
          diagnostics(error.measurement, safeDuration),
        ));
      }
      return Promise.reject(new ProjectGeoJSONAnalysisError(
        'bbox_error',
        error instanceof Error ? error.message : 'GeoJSON bbox computation failed.',
        true,
        diagnostics(measurement, safeDuration),
      ));
    }
  }
}
