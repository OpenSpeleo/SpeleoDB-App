import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MultipartPayloadError } from '../services/HttpClient';
import { EmptyGpxTrackError } from '../services/GpsTrackGpxService';
import { OfflineOpPersistenceError } from '../offline/OfflineOpQueue';
import { allowConsoleWarn } from '../test/consoleGuard';
import type { LocalGpsTrack, RemoteGpsTrack } from '../types/gpsTrack';
import { LandmarkMutationError } from '../types/landmark';
import { createAbortError } from '../utils/abort';
import { CancellationContext } from './CancellationContext';
import type { GpsTrackCoordinator } from './GpsTrackCoordinator';
import { GpsTrackMutationCoordinator } from './GpsTrackMutationCoordinator';
import type { OfflineMutationCoordinator } from './OfflineMutationCoordinator';

const LOCAL: LocalGpsTrack = {
  id: 'local-1',
  name: 'Local',
  color: '#123456',
  points: [{ latitude: 46, longitude: 2, timestamp: 1_000 }],
  createdAt: 1_000,
  updatedAt: 2_000,
};

const REMOTE: RemoteGpsTrack = {
  id: 'remote-1',
  name: 'Remote',
  color: '#654321',
  fileUrl: 'https://files.example/remote.geojson',
  sha256: 'sha',
  createdAt: 3_000,
  updatedAt: 4_000,
};

const REMOTE_API = {
  id: REMOTE.id,
  name: REMOTE.name,
  color: REMOTE.color,
  file: REMOTE.fileUrl,
  sha256_hash: REMOTE.sha256,
  creation_date: REMOTE.createdAt,
  modified_date: REMOTE.updatedAt,
};

function createHarness(options: {
  local?: LocalGpsTrack | null;
  online?: boolean;
  credentials?: { instance: string; token: string } | null;
} = {}) {
  let local = options.local === undefined ? LOCAL : options.local;
  let online = options.online ?? true;
  let credentials = options.credentials === undefined
    ? { instance: 'https://example.com', token: 'token' }
    : options.credentials;
  const tracks = {
    localTrack: vi.fn((_id: string) => local),
    remoteSnapshot: vi.fn((_id: string) => ({ name: REMOTE.name, color: REMOTE.color })),
    updateLocal: vi.fn(async (_id: string, _patch: Partial<LocalGpsTrack>) => LOCAL),
    removeLocal: vi.fn(async (_id: string) => {}),
    applyRemoteUpsert: vi.fn(async (_track: RemoteGpsTrack) => {}),
    applyRemoteRemoval: vi.fn(async (_id: string) => {}),
    mergeRemote: vi.fn((_id: string, next: { name: string; color: string }) => ({
      ...REMOTE,
      ...next,
    })),
    replaceRemote: vi.fn(async (_tracks: RemoteGpsTrack[]) => {}),
    cacheRemote: vi.fn(async (_tracks: RemoteGpsTrack[]) => {}),
    publishRemote: vi.fn((_tracks: RemoteGpsTrack[]) => {}),
    buildLocalGpx: vi.fn(async (_track: LocalGpsTrack) => ({
      fileName: 'track.gpx',
      gpx: '<gpx />',
    })),
  };
  const transport = {
    uploadGpx: vi.fn(async (): Promise<{ status: number; data: unknown }> => ({ status: 201, data: {} })),
    updateGpsTrack: vi.fn(async (): Promise<{ status: number; data: unknown }> => ({ status: 200, data: REMOTE_API })),
    deleteGpsTrack: vi.fn(async (): Promise<{ status: number; data: unknown }> => ({ status: 204, data: null })),
    getGpsTracks: vi.fn(async (): Promise<{ status: number; data: unknown }> => ({ status: 200, data: [REMOTE_API] })),
  };
  const mutations = {
    enqueueGpsCreate: vi.fn(async (_track: { id: string; name: string; color: string }) => {}),
    enqueueGpsUpdate: vi.fn(async () => {}),
    enqueueGpsDelete: vi.fn(async () => {}),
    discardGpsTrackOpsForSubject: vi.fn(async (_id: string) => {}),
    hasGpsCreateFor: vi.fn((_id: string) => false),
  };
  const enterOfflineMode = vi.fn();
  const coordinator = new GpsTrackMutationCoordinator({
    tracks: tracks as unknown as GpsTrackCoordinator,
    transport: transport as never,
    mutations: mutations as unknown as OfflineMutationCoordinator,
    hasNetworkAccess: () => online,
    getCredentials: () => credentials,
    enterOfflineMode,
  });
  return {
    coordinator,
    enterOfflineMode,
    mutations,
    tracks,
    transport,
    setCredentials(value: typeof credentials) { credentials = value; },
    setLocal(value: LocalGpsTrack | null) { local = value; },
    setOnline(value: boolean) { online = value; },
  };
}

describe('GpsTrackMutationCoordinator', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ignores a missing upload and rejects an empty local track', async () => {
    const missing = createHarness({ local: null });
    await missing.coordinator.upload('missing');
    expect(missing.transport.uploadGpx).not.toHaveBeenCalled();

    const empty = createHarness({ local: { ...LOCAL, points: [] } });
    await expect(empty.coordinator.upload('local-1')).rejects.toThrow(/no points/i);
  });

  it('uploads online, removes the local track, and refreshes remote state', async () => {
    const harness = createHarness();
    await harness.coordinator.upload('local-1');

    expect(harness.transport.uploadGpx).toHaveBeenCalledWith(
      'https://example.com', 'token', '<gpx />', 'track.gpx',
    );
    expect(harness.tracks.removeLocal).toHaveBeenCalledWith('local-1');
    expect(harness.tracks.replaceRemote).toHaveBeenCalledWith([REMOTE]);
  });

  it('queues uploads offline and on transport/retryable failures', async () => {
    const offline = createHarness({ online: false });
    await offline.coordinator.upload('local-1');
    expect(offline.mutations.enqueueGpsCreate).toHaveBeenCalledWith({
      id: 'local-1', name: 'Local', color: '#123456',
    });

    const transportFailure = createHarness();
    transportFailure.transport.uploadGpx.mockRejectedValueOnce(new Error('network'));
    await transportFailure.coordinator.upload('local-1');
    expect(transportFailure.enterOfflineMode).toHaveBeenCalledOnce();
    expect(transportFailure.mutations.enqueueGpsCreate).toHaveBeenCalledOnce();

    const retry = createHarness();
    retry.transport.uploadGpx.mockResolvedValueOnce({ status: 503, data: {} });
    await retry.coordinator.upload('local-1');
    expect(retry.enterOfflineMode).toHaveBeenCalledOnce();
    retry.transport.uploadGpx.mockResolvedValueOnce({ status: 429, data: {} });
    await retry.coordinator.upload('local-1');
    expect(retry.enterOfflineMode).toHaveBeenCalledOnce();
  });

  it('surfaces definitive upload errors and preserves cancellation', async () => {
    const validation = createHarness();
    validation.transport.uploadGpx.mockResolvedValueOnce({
      status: 422,
      data: { errors: { file: ['Invalid GPX'] } },
    });
    await expect(validation.coordinator.upload('local-1')).rejects.toThrow('Invalid GPX');

    const abort = createAbortError();
    validation.transport.uploadGpx.mockRejectedValueOnce(abort);
    await expect(validation.coordinator.upload('local-1')).rejects.toBe(abort);
  });

  it('maps GPX preparation errors to definitive responses for replay', async () => {
    const harness = createHarness();
    harness.tracks.buildLocalGpx.mockRejectedValueOnce(new EmptyGpxTrackError('empty'));
    await expect(harness.coordinator.performReplayUpload('local-1')).resolves.toEqual({
      status: 422, data: { error: 'empty' },
    });
    harness.tracks.buildLocalGpx.mockRejectedValueOnce(new MultipartPayloadError('boundary'));
    await expect(harness.coordinator.performReplayUpload('local-1')).resolves.toEqual({
      status: 422, data: { error: 'boundary' },
    });
    harness.setCredentials(null);
    await expect(harness.coordinator.performReplayUpload('local-1')).resolves.toEqual({
      status: 401, data: { error: 'You are not signed in.' },
    });
    harness.setLocal(null);
    await expect(harness.coordinator.performReplayUpload('missing')).resolves.toEqual({
      status: 200, data: {},
    });
  });

  it('edits a local track and refreshes a pending create operation', async () => {
    const harness = createHarness();
    harness.mutations.hasGpsCreateFor.mockReturnValueOnce(true);
    await harness.coordinator.edit('local-1', { name: '  Renamed  ', color: 'bad' });

    expect(harness.tracks.updateLocal).toHaveBeenCalledWith('local-1', {
      name: 'Renamed', color: '#123456',
    });
    expect(harness.mutations.enqueueGpsCreate).toHaveBeenCalledWith({
      id: 'local-1', name: 'Renamed', color: '#123456',
    });

    harness.mutations.hasGpsCreateFor.mockReturnValueOnce(false);
    await harness.coordinator.edit('local-1', { name: ' ', color: undefined });
    expect(harness.tracks.updateLocal).toHaveBeenLastCalledWith('local-1', {
      name: 'Local', color: '#123456',
    });
  });

  it('patches a remote track online and applies the confirmed result', async () => {
    const harness = createHarness({ local: null });
    await harness.coordinator.edit('remote-1', { name: ' Changed ', color: '#abcdef' });

    expect(harness.transport.updateGpsTrack).toHaveBeenCalledWith(
      'https://example.com', 'token', 'remote-1', { name: 'Changed', color: '#abcdef' },
    );
    expect(harness.tracks.mergeRemote).toHaveBeenCalled();
    expect(harness.tracks.applyRemoteUpsert).toHaveBeenCalled();
  });

  it('queues remote edits offline and after retryable/transport failures', async () => {
    const offline = createHarness({ local: null, online: false });
    await offline.coordinator.edit('remote-1', {});
    expect(offline.mutations.enqueueGpsUpdate).toHaveBeenCalledWith(
      'remote-1', { name: 'Remote', color: '#654321' }, { name: 'Remote', color: '#654321' },
    );

    const failure = createHarness({ local: null });
    failure.transport.updateGpsTrack.mockRejectedValueOnce(new Error('network'));
    await failure.coordinator.edit('remote-1', {});
    expect(failure.enterOfflineMode).toHaveBeenCalledOnce();
    failure.transport.updateGpsTrack.mockResolvedValueOnce({ status: 500, data: {} });
    await failure.coordinator.edit('remote-1', {});
    expect(failure.mutations.enqueueGpsUpdate).toHaveBeenCalledTimes(2);
    failure.transport.updateGpsTrack.mockResolvedValueOnce({ status: 429, data: {} });
    await failure.coordinator.edit('remote-1', {});
    expect(failure.enterOfflineMode).toHaveBeenCalledTimes(2);

    const noBaseline = createHarness({ local: null, online: false });
    noBaseline.tracks.remoteSnapshot.mockReturnValueOnce(null as never);
    await noBaseline.coordinator.edit('missing', {});
    expect(noBaseline.mutations.enqueueGpsUpdate).toHaveBeenCalledWith(
      'missing', null, expect.objectContaining({ name: '', color: expect.any(String) }),
    );
  });

  it('surfaces definitive remote edit errors and aborts', async () => {
    const harness = createHarness({ local: null });
    harness.transport.updateGpsTrack.mockResolvedValueOnce({ status: 400, data: { detail: 'bad edit' } });
    await expect(harness.coordinator.edit('remote-1', {})).rejects.toThrow('bad edit');
    const abort = createAbortError();
    harness.transport.updateGpsTrack.mockRejectedValueOnce(abort);
    await expect(harness.coordinator.edit('remote-1', {})).rejects.toBe(abort);
  });

  it('removes local tracks and confirmed remote tracks', async () => {
    const local = createHarness();
    await local.coordinator.remove('local-1');
    expect(local.mutations.discardGpsTrackOpsForSubject).toHaveBeenCalledWith('local-1');
    expect(local.tracks.removeLocal).toHaveBeenCalledWith('local-1');

    const remote = createHarness({ local: null });
    remote.transport.deleteGpsTrack.mockResolvedValueOnce({ status: 404, data: null });
    await remote.coordinator.remove('remote-1');
    expect(remote.tracks.applyRemoteRemoval).toHaveBeenCalledWith('remote-1');
  });

  it('queues remote deletes offline and after retryable/transport failures', async () => {
    const offline = createHarness({ local: null, credentials: null });
    await offline.coordinator.remove('remote-1');
    expect(offline.mutations.enqueueGpsDelete).toHaveBeenCalledOnce();

    const failure = createHarness({ local: null });
    failure.transport.deleteGpsTrack.mockRejectedValueOnce(new Error('network'));
    await failure.coordinator.remove('remote-1');
    expect(failure.enterOfflineMode).toHaveBeenCalledOnce();
    failure.transport.deleteGpsTrack.mockResolvedValueOnce({ status: 408, data: {} });
    await failure.coordinator.remove('remote-1');
    expect(failure.mutations.enqueueGpsDelete).toHaveBeenCalledTimes(2);
    failure.transport.deleteGpsTrack.mockResolvedValueOnce({ status: 429, data: {} });
    await failure.coordinator.remove('remote-1');
    expect(failure.enterOfflineMode).toHaveBeenCalledTimes(2);
  });

  it('surfaces definitive remote delete errors and aborts', async () => {
    const harness = createHarness({ local: null });
    harness.transport.deleteGpsTrack.mockResolvedValueOnce({ status: 403, data: { message: 'forbidden' } });
    await expect(harness.coordinator.remove('remote-1')).rejects.toThrow('forbidden');
    const abort = createAbortError();
    harness.transport.deleteGpsTrack.mockRejectedValueOnce(abort);
    await expect(harness.coordinator.remove('remote-1')).rejects.toBe(abort);
  });

  it('synchronizes remote tracks and contains non-abort standalone failures', async () => {
    const harness = createHarness();
    await harness.coordinator.sync();
    expect(harness.tracks.replaceRemote).toHaveBeenCalledWith([REMOTE]);

    harness.setOnline(false);
    await harness.coordinator.sync();
    harness.setOnline(true);
    harness.setCredentials(null);
    await harness.coordinator.sync();
    expect(harness.transport.getGpsTracks).toHaveBeenCalledOnce();

    harness.setCredentials({ instance: 'https://example.com', token: 'token' });
    harness.transport.getGpsTracks.mockResolvedValueOnce({ status: 500, data: [] });
    await harness.coordinator.sync();
    const error = new Error('sync failed');
    allowConsoleWarn('syncGpsTracks failed:', error);
    harness.transport.getGpsTracks.mockRejectedValueOnce(error);
    await harness.coordinator.sync();
  });

  it('preserves abort semantics for standalone and phased synchronization', async () => {
    const harness = createHarness();
    const abort = createAbortError();
    harness.transport.getGpsTracks.mockRejectedValueOnce(abort);
    await expect(harness.coordinator.sync()).resolves.toBeUndefined();

    const context = new CancellationContext(1, 'test');
    harness.tracks.cacheRemote.mockImplementationOnce(async () => context.abort('cancelled'));
    await expect(harness.coordinator.syncPhase(
      context, 'https://example.com', 'token',
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.tracks.publishRemote).not.toHaveBeenCalled();
  });

  it('handles phased sync guards, status failures, and non-abort errors', async () => {
    const harness = createHarness();
    const context = new CancellationContext(1, 'test');
    await harness.coordinator.syncPhase(context, 'https://example.com', 'token');
    expect(harness.tracks.cacheRemote).toHaveBeenCalledWith(
      [REMOTE],
      context.signal,
    );
    expect(harness.tracks.publishRemote).toHaveBeenCalledWith([REMOTE]);

    harness.transport.getGpsTracks.mockResolvedValueOnce({ status: 401, data: [] });
    await harness.coordinator.syncPhase(new CancellationContext(2, 'test'), 'x', 't');
    const error = new Error('phase failed');
    allowConsoleWarn('syncGpsTracksPhase failed:', error);
    harness.transport.getGpsTracks.mockRejectedValueOnce(error);
    await harness.coordinator.syncPhase(new CancellationContext(3, 'test'), 'x', 't');
    harness.setOnline(false);
    await harness.coordinator.syncPhase(new CancellationContext(4, 'test'), 'x', 't');
  });

  it('maps durable queue failures and rethrows unknown queue failures', async () => {
    const durable = createHarness({ online: false });
    durable.mutations.enqueueGpsCreate.mockRejectedValueOnce(new OfflineOpPersistenceError('disk'));
    await expect(durable.coordinator.upload('local-1')).rejects.toBeInstanceOf(LandmarkMutationError);

    const unknown = new Error('unknown');
    durable.mutations.enqueueGpsCreate.mockRejectedValueOnce(unknown);
    await expect(durable.coordinator.upload('local-1')).rejects.toBe(unknown);

    const update = createHarness({ local: null, online: false });
    update.mutations.enqueueGpsUpdate.mockRejectedValueOnce(unknown);
    await expect(update.coordinator.edit('remote-1', {})).rejects.toBe(unknown);
    update.mutations.enqueueGpsDelete.mockRejectedValueOnce(unknown);
    await expect(update.coordinator.remove('remote-1')).rejects.toBe(unknown);
  });

  it('normalizes every supported server error payload shape', async () => {
    const harness = createHarness();
    for (const [data, message] of [
      [{ error: 'direct' }, 'direct'],
      [{ errors: { file: 'plain' } }, 'plain'],
      [null, 'The server could not import this GPS track.'],
      [{}, 'The server could not import this GPS track.'],
      [{ errors: { file: [] } }, 'The server could not import this GPS track.'],
    ] as const) {
      harness.transport.uploadGpx.mockResolvedValueOnce({ status: 400, data });
      await expect(harness.coordinator.upload('local-1')).rejects.toThrow(message);
    }
  });
});
