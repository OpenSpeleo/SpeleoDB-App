import { createDepthColorExpression as buildDepthColorExpression } from '@speleodb/map-viewer';
import { annotateFeatureDepths, computeCollectionDepthDomain, firstPropertyDepth, meanGeometryDepth, mergeDepthDomains, type DepthDomain } from '@speleodb/map-core/depth';
export { mergeDepthDomains };
export type { DepthDomain };
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

export function getDepthFromProperties(
  properties: Record<string, unknown> | null | undefined,
): number | null {
  return firstPropertyDepth(properties, DEPTH_PROPERTY_CANDIDATES, toFiniteNumber);
}

export function getDepthFromGeometry(geometry: GeoJSON.Geometry | null | undefined): number | null {
  return meanGeometryDepth(geometry, toFiniteNumber);
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
  return annotateFeatureDepths(featureCollection, {
    resolveDepth: getFeatureDepth, property: depthPropertyKey, parseStoredDepth: toFiniteNumber,
  });
}

export function computeDepthDomain(featureCollections: GeoJSON.FeatureCollection[]): DepthDomain | null {
  return computeCollectionDepthDomain(featureCollections, getFeatureDepth);
}

export function createDepthColorExpression(
  domain: DepthDomain | null,
  fallbackColor: string,
  depthPropertyKey = DEPTH_PROPERTY_KEY,
): ExpressionSpecification | string {
  return buildDepthColorExpression({
    domain, fallbackColor, property: depthPropertyKey,
    stops: DEPTH_COLOR_STOPS, transform: 'sqrt',
  });
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
