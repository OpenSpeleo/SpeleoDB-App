import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

export const DEPTH_PROPERTY_KEY = '_speleoDepth';

// Checked in order; first numeric hit wins. `_speleoDepth` is the normalized
// key written by `attachDepthToFeatureCollection`, so it short-circuits for
// pre-processed features.  `min_depth`/`max_depth` are included for
// compatibility but represent bounds, not point depth -- if a feature carries
// both, `min_depth` wins due to order.
const DEPTH_PROPERTY_CANDIDATES = [
  DEPTH_PROPERTY_KEY,
  'depth',
  'depth_m',
  'depth_meters',
  'depthMeters',
  'z',
  'z_depth',
  'z_coord',
  'z_coordinate',
  'elevation',
  'elevation_m',
  'altitude',
  'height',
  'min_depth',
  'max_depth',
] as const;

export interface DepthDomain {
  min: number;
  max: number;
}

export interface DepthColorStop {
  ratio: number;
  color: string;
}

export const DEPTH_COLOR_STOPS: readonly DepthColorStop[] = [
  { ratio: 0, color: '#1e3a8a' },
  { ratio: 0.12, color: '#1d4ed8' },
  { ratio: 0.24, color: '#2563eb' },
  { ratio: 0.4, color: '#06b6d4' },
  { ratio: 0.56, color: '#22c55e' },
  { ratio: 0.72, color: '#eab308' },
  { ratio: 0.86, color: '#f97316' },
  { ratio: 1, color: '#dc2626' },
] as const;

function clampDepthToDomain(depth: number, domain: DepthDomain): number {
  return Math.max(domain.min, Math.min(domain.max, depth));
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function visitGeometryDepths(geometry: GeoJSON.Geometry, visit: (depth: number) => void): void {
  const visitCoord = (coord: number[]): void => {
    if (coord.length < 3) return;
    const depth = toFiniteNumber(coord[2]);
    if (depth === null) return;
    visit(depth);
  };

  switch (geometry.type) {
    case 'Point':
      visitCoord(geometry.coordinates);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const coord of geometry.coordinates) visitCoord(coord);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates) {
        for (const coord of ring) visitCoord(coord);
      }
      break;
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) visitCoord(coord);
        }
      }
      break;
    case 'GeometryCollection':
      for (const child of geometry.geometries) {
        visitGeometryDepths(child, visit);
      }
      break;
  }
}

export function getDepthFromProperties(
  properties: Record<string, unknown> | null | undefined,
): number | null {
  if (!properties) return null;
  for (const key of DEPTH_PROPERTY_CANDIDATES) {
    const depth = toFiniteNumber(properties[key]);
    if (depth !== null) {
      return depth;
    }
  }
  return null;
}

export function getDepthFromGeometry(geometry: GeoJSON.Geometry | null | undefined): number | null {
  if (!geometry) return null;
  let sum = 0;
  let count = 0;
  visitGeometryDepths(geometry, (depth) => {
    sum += depth;
    count += 1;
  });
  if (count === 0) return null;
  return sum / count;
}

export function getFeatureDepth(feature: GeoJSON.Feature): number | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const fromProperties = getDepthFromProperties(properties);
  if (fromProperties !== null) {
    return fromProperties;
  }
  return getDepthFromGeometry(feature.geometry);
}

export function attachDepthToFeatureCollection(
  featureCollection: GeoJSON.FeatureCollection,
  depthPropertyKey = DEPTH_PROPERTY_KEY,
): GeoJSON.FeatureCollection {
  let changed = false;
  const nextFeatures = featureCollection.features.map((feature) => {
    const depth = getFeatureDepth(feature);
    if (depth === null) {
      return feature;
    }

    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    if (toFiniteNumber(properties[depthPropertyKey]) === depth) {
      return feature;
    }

    changed = true;
    return {
      ...feature,
      properties: {
        ...properties,
        [depthPropertyKey]: depth,
      },
    };
  });

  if (!changed) {
    return featureCollection;
  }

  return {
    ...featureCollection,
    features: nextFeatures,
  };
}

function clampDepthForColorScale(depth: number): number {
  if (!Number.isFinite(depth)) {
    return 0;
  }
  return Math.max(0, depth);
}

export function computeDepthDomain(
  featureCollections: GeoJSON.FeatureCollection[],
): DepthDomain | null {
  let max = 0;
  let hasDepth = false;

  for (const featureCollection of featureCollections) {
    for (const feature of featureCollection.features) {
      const depth = getFeatureDepth(feature);
      if (depth === null) continue;
      hasDepth = true;
      const clampedDepth = clampDepthForColorScale(depth);
      if (clampedDepth > max) max = clampedDepth;
    }
  }

  if (!hasDepth) {
    return null;
  }
  return { min: 0, max };
}

export function createDepthColorExpression(
  domain: DepthDomain | null,
  fallbackColor: string,
  depthPropertyKey = DEPTH_PROPERTY_KEY,
): ExpressionSpecification | string {
  if (!domain) {
    return fallbackColor;
  }

  const maxDepth = Math.max(0, domain.max);
  if (maxDepth <= 0) {
    return [
      'case',
      ['has', depthPropertyKey],
      DEPTH_COLOR_STOPS[0].color,
      fallbackColor,
    ];
  }
  const clampedDepthExpression = [
    'min',
    maxDepth,
    ['max', 0, ['to-number', ['get', depthPropertyKey]]],
  ];
  const emphasizedDepthExpression = [
    'sqrt',
    ['/', clampedDepthExpression, maxDepth],
  ];
  const interpolateExpression = [
    'interpolate',
    ['linear'],
    emphasizedDepthExpression,
    ...DEPTH_COLOR_STOPS.flatMap((stop) => [stop.ratio, stop.color]),
  ] as unknown as ExpressionSpecification;

  return [
    'case',
    ['has', depthPropertyKey],
    interpolateExpression,
    fallbackColor,
  ];
}

export function mergeDepthDomains(
  domains: (DepthDomain | null)[],
): DepthDomain | null {
  let max = 0;
  let hasDepth = false;

  for (const domain of domains) {
    if (!domain) continue;
    hasDepth = true;
    if (domain.max > max) max = domain.max;
  }

  if (!hasDepth) return null;
  return { min: 0, max };
}

export function getDepthRatio(depth: number, domain: DepthDomain): number {
  if (!Number.isFinite(depth)) return 0;
  const span = domain.max - domain.min;
  if (span <= 0) {
    return depth <= domain.min ? 0 : 1;
  }
  const clamped = clampDepthToDomain(depth, domain);
  const normalized = (clamped - domain.min) / span;
  if (normalized < 0) return 0;
  if (normalized > 1) return 1;
  return normalized;
}
