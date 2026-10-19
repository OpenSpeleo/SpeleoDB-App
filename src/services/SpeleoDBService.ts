/** Application facade over generated SpeleoDB operations and the native transport. */
import {
  createApiClient,
  v2UserAuthTokenCreateWithJson,
  v2UserAuthTokenRetrieve,
  v2ProjectsGeojsonList,
  v2LandmarksGeojsonRetrieve,
  v2LandmarkCollectionsList,
  v2LandmarksCreateWithJson,
  v2LandmarksPartialUpdateWithJson,
  v2LandmarksDestroy,
  v2GpsTracksList,
  v2GpsTracksPartialUpdateWithJson,
  v2GpsTracksDestroy,
  v2ImportGpxUpdate,
  v2StationsSubsurfaceGeojsonRetrieve,
  v2StationsSurfaceGeojsonRetrieve,
  v2ExplorationLeadsGeojsonRetrieve,
  v2CylinderInstallsGeojsonRetrieve,
  v2GisGeometriesList,
  v2GisGeometriesRetrieve,
  type ApiRequestOptions,
  type ApiTransportResponse,
  type PatchedGPSTrackRequest,
  type V2ImportGpxUpdate200,
} from '@speleodb/api';
import { GPS, HEADERS, NETWORK } from '../constants';
import { isGisGeometryId } from '../gisGeometry/validation';
import { getInstanceBaseUrl } from '../utils/instanceUrl';
import { createAbortError } from '../utils/abort';
import type { HttpClient, HttpResponse } from './HttpClient';
import { createMobileApiTransport } from './apiTransport';
import type { LandmarkApiObject, LandmarkCreateInput, LandmarkUpdateInput } from '../types/landmark';

export interface ServiceRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LandmarkMutationResponse {
  landmark: LandmarkApiObject;
}

export type GpxImportResponse = Required<Pick<V2ImportGpxUpdate200, 'landmarks_created' | 'gps_tracks_created'>>;

export type GpsTrackUpdateInput = PatchedGPSTrackRequest;

export class SpeleoDBService {
  private readonly transport;

  constructor(private readonly http: HttpClient) {
    this.transport = createMobileApiTransport(http);
  }

  authenticate(instance: string, email: string, password: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, undefined, options, (request) =>
      v2UserAuthTokenCreateWithJson({ email, password }, undefined, request));
  }

  validateToken(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2UserAuthTokenRetrieve(undefined, request));
  }

  getProjectsGeoJSON(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2ProjectsGeojsonList(undefined, request));
  }

  getLandmarksGeoJSON(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2LandmarksGeojsonRetrieve(undefined, request));
  }

  getLandmarkCollections(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2LandmarkCollectionsList(undefined, request));
  }

  createLandmark(instance: string, token: string, input: LandmarkCreateInput, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2LandmarksCreateWithJson(input, undefined, request));
  }

  updateLandmark(instance: string, token: string, id: string, input: LandmarkUpdateInput, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2LandmarksPartialUpdateWithJson(id, input, undefined, request));
  }

  deleteLandmark(instance: string, token: string, id: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2LandmarksDestroy(id, undefined, request));
  }

  getGpsTracks(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2GpsTracksList(undefined, request));
  }

  updateGpsTrack(instance: string, token: string, id: string, input: GpsTrackUpdateInput, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2GpsTracksPartialUpdateWithJson(id, input, undefined, request));
  }

  deleteGpsTrack(instance: string, token: string, id: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2GpsTracksDestroy(id, undefined, request));
  }

  uploadGpx(instance: string, token: string, gpxText: string, fileName: string, collection?: string | null, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2ImportGpxUpdate({
      file: new File([gpxText], fileName, { type: GPS.GPX_CONTENT_TYPE }),
      ...(collection ? { collection } : {}),
    }, undefined, request));
  }

  getSubsurfaceStationsGeoJSON(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2StationsSubsurfaceGeojsonRetrieve(undefined, request));
  }

  getSurfaceStationsGeoJSON(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2StationsSurfaceGeojsonRetrieve(undefined, request));
  }

  getExplorationLeadsGeoJSON(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2ExplorationLeadsGeojsonRetrieve(undefined, request));
  }

  getCylinderInstallsGeoJSON(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2CylinderInstallsGeojsonRetrieve(undefined, request));
  }

  getGisGeometries(instance: string, token: string, options: ServiceRequestOptions = {}) {
    return this.execute(instance, token, options, (request) => v2GisGeometriesList(undefined, {
      ...request, responsePolicy: 'status-first-json', cookiePolicy: 'omit',
    }));
  }

  async getGisGeometry(instance: string, token: string, id: string, options: ServiceRequestOptions = {}) {
    if (!isGisGeometryId(id)) throw new TypeError('Invalid GIS Geometry identifier.');
    return this.execute(instance, token, options, (request) => v2GisGeometriesRetrieve(id, undefined, {
      ...request, responsePolicy: 'status-first-json', cookiePolicy: 'omit',
    }));
  }

  /** Signed storage URLs are outside the API contract and carry their own credentials. */
  downloadJSON<T = unknown>(url: string, options: ServiceRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.http.request<T>({ url, method: 'GET', signal: options.signal, timeoutMs: options.timeoutMs });
  }

  private async execute(
    instance: string,
    token: string | undefined,
    options: ServiceRequestOptions,
    operation: (request: ApiRequestOptions) => Promise<ApiTransportResponse>,
  ): Promise<HttpResponse> {
    const client = createApiClient({
      baseUrl: getInstanceBaseUrl(instance),
      transport: this.transport,
      timeoutMs: NETWORK.REQUEST_TIMEOUT_MS,
      headers: {
        [HEADERS.ACCEPT]: HEADERS.APPLICATION_JSON,
        ...(token ? { [HEADERS.AUTHORIZATION]: `${HEADERS.TOKEN_PREFIX}${token}` } : {}),
      },
    });
    try {
      // Coordinators validate unknown server data before durable writes. Keep
      // that admission boundary even when the generated documented branch is typed.
      return await operation({ client, ...options });
    } catch (error) {
      // Existing session/queue coordinators classify deadlines as AbortError.
      if (error && typeof error === 'object' && 'name' in error && error.name === 'TimeoutError') {
        throw createAbortError();
      }
      throw error;
    }
  }
}
