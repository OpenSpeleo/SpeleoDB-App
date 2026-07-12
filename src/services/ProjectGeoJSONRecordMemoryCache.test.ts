import { describe, expect, it, vi } from 'vitest';
import type { ProjectGeoJSONCacheRecord } from '../types/projectGeoJSON';
import { ProjectGeoJSONRecordMemoryCache } from './ProjectGeoJSONRecordMemoryCache';

function missing(): ProjectGeoJSONCacheRecord {
  return { state: 'missing', commitId: null, data: null };
}

describe('ProjectGeoJSONRecordMemoryCache', () => {
  it('evicts the least recently used record at its fixed capacity', async () => {
    const cache = new ProjectGeoJSONRecordMemoryCache(2);
    const load = vi.fn(async () => missing());

    await cache.get('first', load);
    await cache.get('second', load);
    await cache.get('first', load);
    await cache.get('third', load);
    await cache.get('second', load);

    expect(load).toHaveBeenCalledTimes(4);
  });

  it('forces a backing reload after explicit invalidation', async () => {
    const cache = new ProjectGeoJSONRecordMemoryCache();
    const initial = missing();
    const replacement: ProjectGeoJSONCacheRecord = {
      state: 'legacy',
      commitId: 'commit',
      data: { type: 'FeatureCollection', features: [] },
    };
    const load = vi.fn(async () => replacement);

    cache.publish('project', initial);
    expect(await cache.get('project', load)).toBe(initial);
    cache.invalidate('project');

    expect(await cache.get('project', load)).toBe(replacement);
    expect(load).toHaveBeenCalledOnce();
  });
});
