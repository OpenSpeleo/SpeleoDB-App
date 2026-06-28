import { MultipartPayloadError } from '../services/HttpClient';
import type { SpeleoDBService, GpsTrackUpdateInput } from '../services/SpeleoDBService';
import { EmptyGpxTrackError } from '../services/GpsTrackGpxService';
import { OfflineOpPersistenceError } from '../offline/OfflineOpQueue';
import type { GpsTrackSnapshot, LocalGpsTrack } from '../types/gpsTrack';
import { LandmarkMutationError } from '../types/landmark';
import { normalizeHexColor } from '../utils/gpsTrackColors';
import { parseRemoteGpsTracks } from '../utils/remoteGpsTrack';
import { isAbortError } from '../utils/abort';
import type { CancellationContext } from './CancellationContext';
import type { OfflineMutationCoordinator } from './OfflineMutationCoordinator';
import type { GpsTrackCoordinator } from './GpsTrackCoordinator';

interface GpsTrackMutationDependencies {
  tracks: GpsTrackCoordinator;
  transport: SpeleoDBService;
  mutations: OfflineMutationCoordinator;
  hasNetworkAccess(): boolean;
  getCredentials(): { token: string; instance: string } | null;
  enterOfflineMode(): void;
}

/** Owns GPS track upload/edit/delete decisions and server-list synchronization. */
export class GpsTrackMutationCoordinator {
  constructor(private readonly dependencies: GpsTrackMutationDependencies) {}

  async upload(id: string): Promise<void> {
    const track = this.dependencies.tracks.localTrack(id);
    if (!track) return;
    if (track.points.length === 0) throw new Error('This track has no points to upload.');
    if (!this.canAttemptOnline()) return this.enqueueCreate(track);

    let response: { status: number; data: unknown };
    try {
      response = await this.performUpload(track);
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.dependencies.enterOfflineMode();
      return this.enqueueCreate(track);
    }
    if (isSuccessfulStatus(response.status)) return this.finalizeUpload(id);
    if (isRetryableStatus(response.status)) {
      if (response.status !== 429) this.dependencies.enterOfflineMode();
      return this.enqueueCreate(track);
    }
    throw new Error(parseUploadError(response.data));
  }

  async edit(id: string, input: { name?: string; color?: string }): Promise<void> {
    const local = this.dependencies.tracks.localTrack(id);
    if (local) return this.editLocal(local, input);

    const baseline = this.dependencies.tracks.remoteSnapshot(id);
    const next: GpsTrackSnapshot = {
      name: input.name?.trim() ? input.name.trim() : baseline?.name ?? '',
      color: input.color !== undefined
        ? normalizeHexColor(input.color, baseline?.color)
        : baseline?.color ?? normalizeHexColor(undefined),
    };
    if (!this.canAttemptOnline()) return this.enqueueUpdate(id, baseline, next);
    const credentials = this.dependencies.getCredentials() as { token: string; instance: string };
    let response: { status: number; data: unknown };
    try {
      response = await this.dependencies.transport.updateGpsTrack(
        credentials.instance,
        credentials.token,
        id,
        { name: next.name, color: next.color } satisfies GpsTrackUpdateInput,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.dependencies.enterOfflineMode();
      return this.enqueueUpdate(id, baseline, next);
    }
    if (isSuccessfulStatus(response.status)) {
      return this.dependencies.tracks.applyRemoteUpsert(
        this.dependencies.tracks.mergeRemote(id, next, response.data),
      );
    }
    if (isRetryableStatus(response.status)) {
      if (response.status !== 429) this.dependencies.enterOfflineMode();
      return this.enqueueUpdate(id, baseline, next);
    }
    throw new Error(parseUploadError(response.data));
  }

  async remove(id: string): Promise<void> {
    const local = this.dependencies.tracks.localTrack(id);
    if (local) {
      await this.dependencies.mutations.discardGpsTrackOpsForSubject(id);
      return this.dependencies.tracks.removeLocal(id);
    }
    const baseline = this.dependencies.tracks.remoteSnapshot(id);
    if (!this.canAttemptOnline()) return this.enqueueDelete(id, baseline);
    const credentials = this.dependencies.getCredentials() as { token: string; instance: string };
    let response: { status: number; data: unknown };
    try {
      response = await this.dependencies.transport.deleteGpsTrack(
        credentials.instance,
        credentials.token,
        id,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.dependencies.enterOfflineMode();
      return this.enqueueDelete(id, baseline);
    }
    if (isSuccessfulStatus(response.status) || response.status === 404) {
      return this.dependencies.tracks.applyRemoteRemoval(id);
    }
    if (isRetryableStatus(response.status)) {
      if (response.status !== 429) this.dependencies.enterOfflineMode();
      return this.enqueueDelete(id, baseline);
    }
    throw new Error(parseUploadError(response.data));
  }

  async sync(): Promise<void> {
    if (!this.dependencies.hasNetworkAccess()) return;
    const credentials = this.dependencies.getCredentials();
    if (!credentials) return;
    try {
      const response = await this.dependencies.transport.getGpsTracks(
        credentials.instance,
        credentials.token,
      );
      if (!isSuccessfulStatus(response.status)) return;
      await this.dependencies.tracks.replaceRemote(parseRemoteGpsTracks(response.data));
    } catch (error) {
      if (isAbortError(error)) return;
      console.warn('syncGpsTracks failed:', error);
    }
  }

  async syncPhase(
    context: CancellationContext,
    instance: string,
    token: string,
  ): Promise<void> {
    if (!this.dependencies.hasNetworkAccess()) return;
    try {
      const response = await this.dependencies.transport.getGpsTracks(instance, token, {
        signal: context.signal,
      });
      context.throwIfAborted();
      if (!isSuccessfulStatus(response.status)) return;
      const tracks = parseRemoteGpsTracks(response.data);
      await this.dependencies.tracks.cacheRemote(tracks);
      context.throwIfAborted();
      this.dependencies.tracks.publishRemote(tracks);
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('syncGpsTracksPhase failed:', error);
    }
  }

  async performReplayUpload(localTrackId: string): Promise<{ status: number; data: unknown }> {
    const track = this.dependencies.tracks.localTrack(localTrackId);
    return track ? this.performUpload(track) : { status: 200, data: {} };
  }

  async finalizeUpload(localTrackId: string): Promise<void> {
    await this.dependencies.tracks.removeLocal(localTrackId);
    await this.sync();
  }

  private async editLocal(
    local: LocalGpsTrack,
    input: { name?: string; color?: string },
  ): Promise<void> {
    const name = input.name?.trim() ? input.name.trim() : local.name;
    const color = input.color !== undefined
      ? normalizeHexColor(input.color, local.color)
      : local.color;
    await this.dependencies.tracks.updateLocal(local.id, { name, color });
    if (this.dependencies.mutations.hasGpsCreateFor(local.id)) {
      await this.enqueueCreate({ ...local, name, color });
    }
  }

  private async performUpload(track: LocalGpsTrack): Promise<{ status: number; data: unknown }> {
    const credentials = this.dependencies.getCredentials();
    if (!credentials) return { status: 401, data: { error: 'You are not signed in.' } };
    try {
      const file = await this.dependencies.tracks.buildLocalGpx(track);
      const response = await this.dependencies.transport.uploadGpx(
        credentials.instance,
        credentials.token,
        file.gpx,
        file.fileName,
      );
      return { status: response.status, data: response.data };
    } catch (error) {
      if (error instanceof EmptyGpxTrackError || error instanceof MultipartPayloadError) {
        return { status: 422, data: { error: error.message } };
      }
      throw error;
    }
  }

  private canAttemptOnline(): boolean {
    return this.dependencies.hasNetworkAccess() && this.dependencies.getCredentials() !== null;
  }

  private async enqueueCreate(track: LocalGpsTrack): Promise<void> {
    try {
      await this.dependencies.mutations.enqueueGpsCreate({
        id: track.id,
        name: track.name,
        color: track.color,
      });
    } catch (error) {
      throwQueuePersistenceError(error);
    }
  }

  private async enqueueUpdate(
    id: string,
    baseline: GpsTrackSnapshot | null,
    next: GpsTrackSnapshot,
  ): Promise<void> {
    try {
      await this.dependencies.mutations.enqueueGpsUpdate(id, baseline, next);
    } catch (error) {
      throwQueuePersistenceError(error);
    }
  }

  private async enqueueDelete(id: string, baseline: GpsTrackSnapshot | null): Promise<void> {
    try {
      await this.dependencies.mutations.enqueueGpsDelete(id, baseline);
    } catch (error) {
      throwQueuePersistenceError(error);
    }
  }
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function parseUploadError(data: unknown): string {
  if (data && typeof data === 'object') {
    const value = data as Record<string, unknown>;
    const direct = value.error ?? value.detail ?? value.message;
    if (typeof direct === 'string' && direct.trim()) return direct;
    const errors = value.errors;
    if (errors && typeof errors === 'object') {
      const first = Object.values(errors as Record<string, unknown>)[0];
      if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
      if (typeof first === 'string') return first;
    }
  }
  return 'The server could not import this GPS track.';
}

function throwQueuePersistenceError(error: unknown): never {
  if (error instanceof OfflineOpPersistenceError) {
    throw new LandmarkMutationError(
      'unknown',
      'Could not save this offline change on this device. Please try again before closing the app.',
    );
  }
  throw error;
}
