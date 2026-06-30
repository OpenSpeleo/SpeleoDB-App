import { PROJECT_GEOJSON_VALIDATION } from '../constants';
import type {
  ProjectGeoJSONAnalysis,
  ProjectGeoJSONBounds,
  ProjectGeoJSONContentFailureReason,
} from '../types/projectGeoJSON';
import {
  shortestLongitudeInterval,
  webMercatorSpanKm,
} from './geographicBounds';

const EARTH_RADIUS_KM = 6_371.0088;

function snapValidationLimitRoundoff(value: number, limit: number): number {
  // Circular normalization and the haversine each add a handful of rounding
  // operations, so reserve 32 ULPs rather than a decimal policy tolerance.
  const roundoff = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(limit)) * 32;
  return Math.abs(value - limit) <= roundoff ? limit : value;
}

export class ProjectGeoJSONComputationError extends Error {
  constructor(
    public readonly reason: Extract<
      ProjectGeoJSONContentFailureReason,
      'invalid_geojson' | 'no_coordinates' | 'bbox_error'
    >,
    message: string,
    public readonly measurement: ProjectGeoJSONMeasurement | null = null,
  ) {
    super(message);
    this.name = 'ProjectGeoJSONComputationError';
  }
}

export interface ProjectGeoJSONMeasurement {
  bounds: ProjectGeoJSONBounds;
  widthKm: number;
  heightKm: number;
}

function invalid(message: string): never {
  throw new ProjectGeoJSONComputationError('invalid_geojson', message);
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function haversineKm(
  firstLongitude: number,
  firstLatitude: number,
  secondLongitude: number,
  secondLatitude: number,
): number {
  const lat1 = radians(firstLatitude);
  const lat2 = radians(secondLatitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(secondLongitude - firstLongitude);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function visitPosition(value: unknown, sink: (longitude: number, latitude: number) => void): void {
  if (!Array.isArray(value) || value.length < 2) {
    invalid('GeoJSON position must contain longitude and latitude.');
  }
  const longitude = value[0];
  const latitude = value[1];
  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    invalid('GeoJSON longitude and latitude must be numbers.');
  }
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    invalid('GeoJSON longitude and latitude must be finite.');
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    invalid('GeoJSON longitude or latitude is outside the valid range.');
  }
  sink(longitude, latitude);
}

function visitPositions(
  value: unknown,
  minimumLength: number,
  label: string,
  sink: (longitude: number, latitude: number) => void,
): void {
  if (!Array.isArray(value)) invalid(`${label} coordinates must be an array.`);
  if (value.length > 0 && value.length < minimumLength) {
    invalid(`${label} contains too few positions.`);
  }
  for (const position of value) visitPosition(position, sink);
}

function visitLineString(
  value: unknown,
  label: string,
  sink: (longitude: number, latitude: number) => void,
): void {
  visitPositions(value, 2, label, sink);
}

function visitLinearRing(
  value: unknown,
  sink: (longitude: number, latitude: number) => void,
): void {
  if (!Array.isArray(value)) invalid('Polygon ring coordinates must be an array.');
  if (value.length < 4) invalid('Polygon rings must contain at least four positions.');
  const first = value[0];
  const last = value[value.length - 1];
  if (
    !Array.isArray(first)
    || !Array.isArray(last)
    || first[0] !== last[0]
    || first[1] !== last[1]
  ) {
    invalid('Polygon rings must be closed.');
  }
  for (const position of value) visitPosition(position, sink);
}

function visitPolygon(
  value: unknown,
  sink: (longitude: number, latitude: number) => void,
): void {
  if (!Array.isArray(value)) invalid('Polygon coordinates must be an array of rings.');
  for (const ring of value) visitLinearRing(ring, sink);
}

function visitGeometry(
  value: unknown,
  sink: (longitude: number, latitude: number) => void,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('GeoJSON geometry must be an object.');
  }
  const geometry = value as Record<string, unknown>;
  switch (geometry.type) {
    case 'Point':
      visitPosition(geometry.coordinates, sink);
      return;
    case 'MultiPoint':
      visitPositions(geometry.coordinates, 0, 'MultiPoint', sink);
      return;
    case 'LineString':
      visitLineString(geometry.coordinates, 'LineString', sink);
      return;
    case 'MultiLineString': {
      if (!Array.isArray(geometry.coordinates)) {
        invalid('MultiLineString coordinates must be an array of lines.');
      }
      for (const line of geometry.coordinates) {
        visitLineString(line, 'MultiLineString line', sink);
      }
      return;
    }
    case 'Polygon':
      visitPolygon(geometry.coordinates, sink);
      return;
    case 'MultiPolygon': {
      if (!Array.isArray(geometry.coordinates)) {
        invalid('MultiPolygon coordinates must be an array of polygons.');
      }
      for (const polygon of geometry.coordinates) visitPolygon(polygon, sink);
      return;
    }
    case 'GeometryCollection': {
      if (!Array.isArray(geometry.geometries)) {
        invalid('GeoJSON GeometryCollection.geometries must be an array.');
      }
      for (const child of geometry.geometries) visitGeometry(child, sink);
      return;
    }
    default:
      invalid(`Unsupported GeoJSON geometry type: ${String(geometry.type)}.`);
  }
}

/** Analyze a normalized FeatureCollection without mutating it. */
export function measureProjectGeoJSONBounds(data: unknown): ProjectGeoJSONMeasurement {
  if (!data || typeof data !== 'object') invalid('GeoJSON payload must be an object.');
  const collection = data as Record<string, unknown>;
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    invalid('Project GeoJSON must be a FeatureCollection.');
  }

  const longitudes: number[] = [];
  let south = Infinity;
  let north = -Infinity;

  for (const rawFeature of collection.features) {
    if (!rawFeature || typeof rawFeature !== 'object') invalid('GeoJSON feature must be an object.');
    const feature = rawFeature as Record<string, unknown>;
    if (feature.type !== 'Feature' || !('geometry' in feature)) {
      invalid('FeatureCollection contains an invalid feature.');
    }
    if (feature.geometry === null) continue;
    visitGeometry(feature.geometry, (longitude, latitude) => {
      longitudes.push(longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    });
  }

  if (longitudes.length === 0) {
    throw new ProjectGeoJSONComputationError(
      'no_coordinates',
      'Project GeoJSON contains no usable coordinates.',
    );
  }

  const longitudeBounds = shortestLongitudeInterval(longitudes);
  const centerLatitude = (south + north) / 2;
  const measuredWidthKm = haversineKm(
    longitudeBounds.west,
    centerLatitude,
    longitudeBounds.east,
    centerLatitude,
  );
  const measuredHeightKm = haversineKm(
    longitudeBounds.west,
    south,
    longitudeBounds.west,
    north,
  );

  if (!Number.isFinite(measuredWidthKm) || !Number.isFinite(measuredHeightKm)) {
    throw new ProjectGeoJSONComputationError(
      'bbox_error',
      'Project GeoJSON bounds produced non-finite dimensions.',
    );
  }

  // Correct only machine-roundoff at the policy boundary. This preserves the
  // strict `> 100 km` rule while avoiding a false rejection when inverse test
  // geometry represents exactly 100 km but floating math lands one ULP above.
  const widthKm = snapValidationLimitRoundoff(
    measuredWidthKm,
    PROJECT_GEOJSON_VALIDATION.MAX_WIDTH_KM,
  );
  const heightKm = snapValidationLimitRoundoff(
    measuredHeightKm,
    PROJECT_GEOJSON_VALIDATION.MAX_HEIGHT_KM,
  );

  const measurement: ProjectGeoJSONMeasurement = {
    bounds: { ...longitudeBounds, south, north },
    widthKm,
    heightKm,
  };

  // Preserve ordinary oversize classification and its raw dimensions. The
  // projection check is an additional fail-closed boundary for physically
  // compact geometry whose Web-Mercator consumer footprint is still unsafe.
  if (!isProjectGeoJSONOversized(measurement)) {
    const projected = webMercatorSpanKm(measurement.bounds);
    const unsafeProjectedWidth = projected.xKm
      > PROJECT_GEOJSON_VALIDATION.MAX_MERCATOR_X_SPAN_KM;
    const unsafeProjectedHeight = projected.yKm
      > PROJECT_GEOJSON_VALIDATION.MAX_MERCATOR_Y_SPAN_KM;
    if (
      !Number.isFinite(projected.xKm)
      || !Number.isFinite(projected.yKm)
      || unsafeProjectedWidth
      || unsafeProjectedHeight
    ) {
      throw new ProjectGeoJSONComputationError(
        'bbox_error',
        'Project GeoJSON bounds exceed the safe Web-Mercator footprint.',
        measurement,
      );
    }
  }

  return measurement;
}

export function isProjectGeoJSONOversized(
  analysis: Pick<ProjectGeoJSONAnalysis, 'widthKm' | 'heightKm'>,
): boolean {
  return analysis.widthKm > PROJECT_GEOJSON_VALIDATION.MAX_WIDTH_KM
    || analysis.heightKm > PROJECT_GEOJSON_VALIDATION.MAX_HEIGHT_KM;
}
