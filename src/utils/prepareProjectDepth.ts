import { DEPTH_PROPERTY_KEY, getDepthFromProperties, type DepthDomain } from './depthColoring';
import { yieldToMainThread } from './yieldToMainThread';
import { recordViewerWork } from './viewerWorkTiming';

export interface PreparedProjectDepth {
  featureCollection: GeoJSON.FeatureCollection;
  depthDomain: DepthDomain | null;
}

const cache = new WeakMap<GeoJSON.FeatureCollection, PreparedProjectDepth>();

// Yield for containers as well as positions: even many empty rings/collections
// must not hide unbounded traversal between two scheduling checkpoints.
function* geometrySteps(geometry: GeoJSON.Geometry): Generator<number | null> {
  yield null;
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) yield* geometrySteps(child);
  } else {
    yield* coordinateSteps(geometry.coordinates);
  }
}

function* coordinateSteps(coordinates: unknown): Generator<number | null> {
  if (!Array.isArray(coordinates)) { yield null; return; }
  if (typeof coordinates[0] === 'number') {
    const value: unknown = coordinates[2];
    const depth = typeof value === 'number' ? value
      : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    yield Number.isFinite(depth) ? depth : null;
    return;
  }
  yield null;
  for (const child of coordinates) yield* coordinateSteps(child);
}

/** Prepare each immutable source revision once, with bounded cancellable work. */
export async function prepareProjectDepth(
  source: GeoJSON.FeatureCollection,
  isStale: () => boolean,
  yieldWork: () => Promise<void> = yieldToMainThread,
): Promise<PreparedProjectDepth | null> {
  if (isStale()) return null;
  const cached = cache.get(source);
  if (cached) return cached;
  const features: GeoJSON.Feature[] = [];
  let sliceStartedAt = performance.now();
  let steps = 0;
  let changed = false;
  let hasDepth = false;
  let max = 0;
  for (const feature of source.features) {
    if (++steps >= 1000) {
      recordViewerWork('project-depth', sliceStartedAt);
      await yieldWork(); steps = 0;
      sliceStartedAt = performance.now();
      if (isStale()) return null;
    }
    let depth = getDepthFromProperties(feature.properties);
    if (depth === null && feature.geometry) {
      let sum = 0;
      let count = 0;
      for (const value of geometrySteps(feature.geometry)) {
        if (value !== null) { sum += value; count++; }
        if (++steps >= 1000) {
          recordViewerWork('project-depth', sliceStartedAt);
          await yieldWork(); steps = 0;
          sliceStartedAt = performance.now();
          if (isStale()) return null;
        }
      }
      depth = count ? sum / count : null;
    }
    if (depth === null) { features.push(feature); continue; }
    hasDepth = true;
    max = Math.max(max, Number.isFinite(depth) ? depth : 0);
    const existing = feature.properties?.[DEPTH_PROPERTY_KEY];
    if ((typeof existing === 'number' || (typeof existing === 'string' && existing.trim()))
      && Number(existing) === depth) {
      features.push(feature);
    } else {
      changed = true;
      features.push({ ...feature, properties: { ...feature.properties, [DEPTH_PROPERTY_KEY]: depth } });
    }
  }
  recordViewerWork('project-depth', sliceStartedAt);
  if (isStale()) return null;
  const prepared = {
    featureCollection: changed ? { ...source, features } : source,
    depthDomain: hasDepth ? { min: 0, max } : null,
  };
  cache.set(source, prepared);
  return prepared;
}
