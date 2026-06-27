import { describe, it, expect } from 'vitest';
import { parseRemoteGpsTrack, parseRemoteGpsTracks } from './remoteGpsTrack';

describe('parseRemoteGpsTrack', () => {
  it('maps the server shape to RemoteGpsTrack with epoch dates', () => {
    const track = parseRemoteGpsTrack({
      id: 'g1',
      name: 'Cave Approach',
      color: '#377EB8',
      file: 'https://files.test/g1.geojson',
      sha256_hash: 'deadbeef',
      creation_date: '2024-01-02T03:04:05Z',
      modified_date: '2024-02-03T00:00:00Z',
    });
    expect(track).toEqual({
      id: 'g1',
      name: 'Cave Approach',
      color: '#377eb8',
      fileUrl: 'https://files.test/g1.geojson',
      sha256: 'deadbeef',
      createdAt: Date.parse('2024-01-02T03:04:05Z'),
      updatedAt: Date.parse('2024-02-03T00:00:00Z'),
    });
  });

  it('returns null without a usable id', () => {
    expect(parseRemoteGpsTrack({})).toBeNull();
    expect(parseRemoteGpsTrack(null)).toBeNull();
    expect(parseRemoteGpsTrack({ name: 'x' })).toBeNull();
  });

  it('tolerates a missing file/hash (detail/PATCH response shape)', () => {
    const track = parseRemoteGpsTrack({ id: 'g2', name: 'T', color: '#000000' });
    expect(track).toMatchObject({ id: 'g2', fileUrl: '', sha256: '', createdAt: 0, updatedAt: 0 });
  });

  it('parses a list and drops bad entries', () => {
    const list = parseRemoteGpsTracks([
      { id: 'g1', name: 'A' },
      null,
      { name: 'no id' },
      { id: 'g2', name: 'B' },
    ]);
    expect(list.map((t) => t.id)).toEqual(['g1', 'g2']);
    expect(parseRemoteGpsTracks('nope' as unknown)).toEqual([]);
  });
});
