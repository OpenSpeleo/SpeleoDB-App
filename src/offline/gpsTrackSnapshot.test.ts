import { describe, it, expect } from 'vitest';
import {
  conflictRows,
  diffSnapshots,
  findRemoteTrack,
  snapshotFromRemote,
  snapshotsEqual,
} from './gpsTrackSnapshot';
import type { RemoteGpsTrack } from '../types/gpsTrack';

function remote(overrides: Partial<RemoteGpsTrack> = {}): RemoteGpsTrack {
  return {
    id: 'g1',
    name: 'Track',
    color: '#377eb8',
    fileUrl: 'https://files.test/g1.geojson',
    sha256: 'abc',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('gpsTrackSnapshot', () => {
  it('builds a {name,color} snapshot from a remote track (normalized color)', () => {
    expect(snapshotFromRemote(remote({ color: '#377EB8' }))).toEqual({
      name: 'Track',
      color: '#377eb8',
    });
  });

  it('compares snapshots for equality', () => {
    expect(snapshotsEqual({ name: 'A', color: '#111111' }, { name: 'A', color: '#111111' })).toBe(true);
    expect(snapshotsEqual({ name: 'A', color: '#111111' }, { name: 'B', color: '#111111' })).toBe(false);
    expect(snapshotsEqual({ name: 'A', color: '#111111' }, { name: 'A', color: '#222222' })).toBe(false);
  });

  it('diffs only the fields that changed', () => {
    const changes = diffSnapshots({ name: 'Old', color: '#111111' }, { name: 'New', color: '#111111' });
    expect(changes).toEqual([{ field: 'name', label: 'Name', from: 'Old', to: 'New' }]);
  });

  it('builds conflict rows for differing fields', () => {
    const rows = conflictRows({ name: 'Mine', color: '#111111' }, { name: 'Theirs', color: '#111111' });
    expect(rows).toEqual([{ field: 'name', label: 'Name', local: 'Mine', server: 'Theirs' }]);
  });

  it('finds a remote track by id', () => {
    const list = [remote({ id: 'a' }), remote({ id: 'b' })];
    expect(findRemoteTrack(list, 'b')?.id).toBe('b');
    expect(findRemoteTrack(list, 'z')).toBeNull();
    expect(findRemoteTrack(null, 'a')).toBeNull();
  });
});
