import { describe, expect, it } from 'vitest';
import { GeometryLabelFeatureCache } from './geometryLabelFeatureCache';

const line = (id: string, revision = 1): GeoJSON.Feature => ({ type: 'Feature',
  properties: { id, revision, alias: id, color: '#123456' },
  geometry: { type: 'LineString', coordinates: [[0, 0], [2, 0]] },
});
const collection = (...features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

describe('geometry label revision cache', () => {
  it('reuses a peer label when another detail arrives and replaces only changed revisions', () => {
    const cache = new GeometryLabelFeatureCache();
    const first = cache.prepare(collection(line('a'))).features[0];
    const second = cache.prepare(collection(line('a'), line('b')));
    expect(second.features[0]).toBe(first);
    const changed = cache.prepare(collection(line('a', 2), line('b')));
    expect(changed.features[0]).not.toBe(first);
    expect(changed.features[1]).toBe(second.features[1]);
    cache.prepare(collection());
    expect(cache.prepare(collection(line('b'))).features[0]).not.toBe(second.features[1]);
  });
});
