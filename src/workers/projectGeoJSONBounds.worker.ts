import {
  measureProjectGeoJSONBounds,
  ProjectGeoJSONComputationError,
  type ProjectGeoJSONMeasurement,
} from '../utils/projectGeoJSONBounds';

type WorkerRequest = { id: number; featureCollection: unknown };
type WorkerResponse =
  | { id: number; ok: true; measurement: ProjectGeoJSONMeasurement }
  | {
      id: number;
      ok: false;
      reason: 'invalid_geojson' | 'no_coordinates' | 'bbox_error';
      message: string;
      partialMeasurement: ProjectGeoJSONMeasurement | null;
    };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

function isRequest(value: unknown): value is WorkerRequest {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'id' in value
    && Number.isSafeInteger((value as { id: unknown }).id)
    && 'featureCollection' in value;
}

workerScope.onmessage = (event) => {
  if (!isRequest(event.data)) {
    const possibleId = event.data
      && typeof event.data === 'object'
      && 'id' in event.data
      && Number.isSafeInteger((event.data as { id: unknown }).id)
      ? (event.data as { id: number }).id
      : -1;
    workerScope.postMessage({
      id: possibleId,
      ok: false,
      reason: 'invalid_geojson',
      message: 'GeoJSON validation worker received a malformed request.',
      partialMeasurement: null,
    });
    return;
  }

  const { id, featureCollection } = event.data;
  try {
    workerScope.postMessage({
      id,
      ok: true,
      measurement: measureProjectGeoJSONBounds(featureCollection),
    });
  } catch (error) {
    if (error instanceof ProjectGeoJSONComputationError) {
      workerScope.postMessage({
        id,
        ok: false,
        reason: error.reason,
        message: error.message,
        partialMeasurement: error.measurement,
      });
      return;
    }
    workerScope.postMessage({
      id,
      ok: false,
      reason: 'bbox_error',
      message: error instanceof Error ? error.message : 'Unknown bbox computation failure.',
      partialMeasurement: null,
    });
  }
};

export {};
