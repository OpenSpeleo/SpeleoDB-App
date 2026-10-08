import { createPreparationRunner, geometryPositionSteps } from '@speleodb/map-core/preparation';
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
  for (const position of geometryPositionSteps(geometry)) {
    const value: unknown = position?.[2];
    const depth = typeof value === 'number' ? value
      : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    yield Number.isFinite(depth) ? depth : null;
  }
}

const runDepthPreparation = createPreparationRunner({
  budgetMs: Infinity,
  maxSteps: 1000,
  initialYield: false,
  yieldWork: yieldToMainThread,
  onSlice: startedAt => recordViewerWork('project-depth', startedAt),
});

function* prepareDepthSteps(source: GeoJSON.FeatureCollection): Generator<void, PreparedProjectDepth> {
  const features: GeoJSON.Feature[] = [];
  let changed = false;
  let hasDepth = false;
  let max = 0;
  for (const feature of source.features) {
    yield;
    let depth = getDepthFromProperties(feature.properties);
    if (depth === null && feature.geometry) {
      let sum = 0;
      let count = 0;
      for (const value of geometrySteps(feature.geometry)) {
        if (value !== null) { sum += value; count++; }
        yield;
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
  return {
    featureCollection: changed ? { ...source, features } : source,
    depthDomain: hasDepth ? { min: 0, max } : null,
  };
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
  try {
    const prepared = await runDepthPreparation(prepareDepthSteps(source), {
      isCurrent: () => !isStale(), yieldWork,
    });
    cache.set(source, prepared);
    return prepared;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' && isStale()) return null;
    throw error;
  }
}
