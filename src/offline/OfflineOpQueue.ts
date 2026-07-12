/**
 * OfflineOpQueue -- owns the ordered, persistent list of offline mutations and
 * the logic to fold them optimistically and replay them safely.
 *
 * Design invariants (the things that keep offline sync from eating user data):
 *
 * 1. Ground truth is never mutated while offline. The cached server snapshot is
 *    only written by a *confirmed* server response (here, via the injected
 *    `applyUpsert` / `applyRemoval`). The optimistic view the user sees is
 *    `fold(groundTruth, pendingOps)`, recomputed on every change. Discarding a
 *    pending op is therefore a pure re-fold -- no re-pull required (we may be
 *    offline).
 *
 * 2. One landmark has at most one pending op. Enqueue coalesces: editing a
 *    not-yet-synced offline create mutates the create in place; deleting it
 *    drops the create entirely; a later edit replaces an earlier edit; a delete
 *    supersedes pending edits. This eliminates intra-queue dependency chains and
 *    keeps the pending list readable.
 *
 * 3. Replay is idempotent. A create that the server already has (e.g. a flaky
 *    "200 to nothing" tunnel) is matched by identity and treated as success; a
 *    re-PATCH of identical values is a 200; a re-DELETE of a missing landmark is
 *    a 404, treated as success. Ground truth is written only after the server
 *    confirms, and the op is removed only after ground truth is written, so a
 *    force-quit at any point replays cleanly.
 *
 * 4. Conflicts are derived live, never restored stale. On load, transient
 *    statuses (`syncing`/`conflict`) reset to `pending`; a replay re-pulls the
 *    server and compares the op's baseline against the current server state.
 *
 * Network replay + HTTP details are injected via `OfflineReplayPort` so the
 * queue is fully testable with a fake port.
 *
 * See docs/offline-op-queue.md.
 */

import type {
  LandmarkApiObject,
  LandmarkCreateInput,
  LandmarkUpdateInput,
} from '../types/landmark';
import type {
  GpsTrackPendingState,
  GpsTrackSnapshot,
  RemoteGpsTrack,
} from '../types/gpsTrack';
import type {
  LandmarkSnapshot,
  OfflineConflictChoice,
  OfflineOpConflict,
  OfflineOpView,
} from '../types/offlineOp';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import {
  extractLandmarkObject,
  parseLandmarkMutationError,
} from '../utils/landmarkMutations';
import {
  conflictRows,
  findLandmarkFeature,
  findLandmarkFeatureByIdentity,
  landmarkApiObjectFromFeature,
  snapshotFromApi,
  snapshotFromFeature,
  snapshotsEqual,
} from './landmarkSnapshot';
import {
  conflictRows as gpsConflictRows,
  findRemoteTrack,
  snapshotFromRemote,
  snapshotsEqual as gpsSnapshotsEqual,
} from './gpsTrackSnapshot';
import { parseRemoteGpsTrack, parseRemoteGpsTracks } from '../utils/remoteGpsTrack';
import { OfflineOpStore } from './OfflineOpStore';
import { isLocalLandmarkId, OfflineOp } from './ops/OfflineOp';
import { CreateLandmarkOp } from './ops/CreateLandmarkOp';
import { UpdateLandmarkOp } from './ops/UpdateLandmarkOp';
import { DeleteLandmarkOp } from './ops/DeleteLandmarkOp';
import { CreateGpsTrackOp } from './ops/CreateGpsTrackOp';
import { UpdateGpsTrackOp } from './ops/UpdateGpsTrackOp';
import { DeleteGpsTrackOp } from './ops/DeleteGpsTrackOp';
import { deserializeOfflineOp } from './ops/deserialize';

/** Network + ground-truth seam the queue depends on (all injected/testable). */
export interface OfflineReplayPort {
  hasNetworkAccess(): boolean;
  // ---- landmarks ----
  postLandmark(input: LandmarkCreateInput): Promise<{ status: number; data: unknown }>;
  patchLandmark(id: string, input: LandmarkUpdateInput): Promise<{ status: number; data: unknown }>;
  deleteLandmark(id: string): Promise<{ status: number; data: unknown }>;
  fetchLandmarksGeoJSON(): Promise<{ status: number; data: unknown }>;
  /** Write a confirmed landmark into the ground-truth cache. */
  applyUpsert(landmark: LandmarkApiObject): Promise<void>;
  /** Remove a confirmed-deleted landmark from the ground-truth cache. */
  applyRemoval(id: string): Promise<void>;
  // ---- gps tracks ----
  /** Upload a recorded local track as GPX. A local build error returns a 4xx-shaped result. */
  uploadGpsTrack(localTrackId: string): Promise<{ status: number; data: unknown }>;
  patchGpsTrack(id: string, input: { name: string; color: string }): Promise<{ status: number; data: unknown }>;
  deleteGpsTrackRemote(id: string): Promise<{ status: number; data: unknown }>;
  fetchGpsTracks(): Promise<{ status: number; data: unknown }>;
  /** Write a confirmed server track into the ground-truth cache. */
  applyGpsTrackUpsert(track: RemoteGpsTrack): Promise<void>;
  /** Remove a confirmed-deleted server track from the ground-truth cache. */
  applyGpsTrackRemoval(id: string): Promise<void>;
  /** After a confirmed upload: delete the local recording and sync the server list. */
  onGpsTrackCreated(localTrackId: string): Promise<void>;
}

export type OfflineSyncReason =
  | 'completed'
  | 'offline'
  | 'pull_failed'
  | 'nothing_to_sync';

export interface OfflineSyncSummary {
  reason: OfflineSyncReason;
  succeeded: number;
  conflicted: number;
  failed: number;
  /** Op ids that ended in a conflict needing user resolution. */
  conflictIds: string[];
  remaining: number;
}

const emptyCollection = (): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [],
});

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Thrown internally when a replay loses connectivity mid-run; aborts the run. */
class OfflineNetworkInterruption extends Error {}

export class OfflineOpPersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'OfflineOpPersistenceError';
    this.cause = options?.cause;
  }
}

interface ConflictContext {
  /** Server snapshot (LandmarkSnapshot or GpsTrackSnapshot), or null when removed. */
  server: unknown | null;
  serverFeature: GeoJSON.Feature | null;
}

/** Server snapshots pulled once per replay run, per entity type. */
interface ReplayServerSnapshots {
  landmarks: GeoJSON.FeatureCollection;
  gpsTracks: RemoteGpsTrack[];
}

export class OfflineOpQueue {
  private ops: OfflineOp[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private seqCounter = 0;
  private conflicts = new Map<string, ConflictContext>();
  private replaying = false;
  private commandTail: Promise<void> = Promise.resolve();
  private fullReplayFlight: Promise<OfflineSyncSummary> | null = null;

  constructor(
    private store: OfflineOpStore,
    private port: OfflineReplayPort,
    /** Invoked after any change so the controller can bump revision + notify. */
    private onChange: () => void = () => {},
  ) {}

  // ---- Loading --------------------------------------------------------------

  /** Load persisted ops once. Idempotent and safe to await repeatedly. */
  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      let records;
      try {
        records = await this.store.list();
      } catch (error) {
        this.loadPromise = null;
        throw new OfflineOpPersistenceError('Could not load pending offline changes.', {
          cause: error,
        });
      }
      const ops: OfflineOp[] = [];
      for (const record of records) {
        const op = deserializeOfflineOp(record);
        if (!op) continue;
        // Conflicts are derived live; a `syncing` op was interrupted. Reset both
        // to `pending` so the next replay re-derives state cleanly.
        if (op.status === 'syncing' || op.status === 'conflict') {
          op.status = 'pending';
        }
        ops.push(op);
      }
      ops.sort((a, b) => a.seq - b.seq);
      this.ops = ops;
      this.seqCounter = ops.reduce((max, op) => Math.max(max, op.seq), 0);
      this.loaded = true;
    })();
    return this.loadPromise;
  }

  // ---- Reads ----------------------------------------------------------------

  get count(): number {
    return this.ops.length;
  }

  get isReplaying(): boolean {
    return this.replaying;
  }

  /** Fold all pending landmark ops over a base FeatureCollection, in order. */
  foldOver(base: GeoJSON.FeatureCollection | null | undefined): GeoJSON.FeatureCollection {
    let collection: GeoJSON.FeatureCollection =
      base && Array.isArray(base.features) ? base : emptyCollection();
    for (const op of this.ordered()) {
      if (op.entityType !== 'landmark') continue;
      collection = op.applyTo(collection);
    }
    return collection;
  }

  /** Fold all pending GPS-track ops over the cached server track list, in order. */
  foldGpsTracks(base: readonly RemoteGpsTrack[] | null | undefined): RemoteGpsTrack[] {
    let tracks: RemoteGpsTrack[] = Array.isArray(base) ? [...base] : [];
    for (const op of this.ordered()) {
      if (op.entityType !== 'gpsTrack') continue;
      tracks = op.applyToTrackList(tracks);
    }
    return tracks;
  }

  /**
   * Per-subject pending state for GPS tracks (keyed by the op's subject id:
   * the recorded local track id for an upload, or the server track id for an
   * edit/delete). Lets the controller annotate the unified track list.
   */
  gpsPendingBySubject(): Map<string, { state: GpsTrackPendingState; error?: string | null }> {
    const map = new Map<string, { state: GpsTrackPendingState; error?: string | null }>();
    for (const op of this.ordered()) {
      if (op.entityType !== 'gpsTrack') continue;
      let state: GpsTrackPendingState;
      if (op.status === 'conflict') state = 'conflict';
      else if (op.status === 'error') state = 'error';
      else state = op.kind as GpsTrackPendingState;
      map.set(op.subjectId(), { state, error: op.lastError ?? null });
    }
    return map;
  }

  /** View models for the pending list, newest first. */
  views(): OfflineOpView[] {
    return this.ordered()
      .map((op) => this.toView(op))
      .reverse();
  }

  private ordered(): OfflineOp[] {
    return [...this.ops].sort((a, b) => a.seq - b.seq);
  }

  private toView(op: OfflineOp): OfflineOpView {
    const description = op.describe();
    const view: OfflineOpView = {
      id: op.id,
      entityType: op.entityType,
      kind: op.kind,
      status: op.status,
      createdAt: op.createdAt,
      title: description.title,
      summary: description.summary,
      changes: description.changes,
      lastError: op.lastError,
    };
    if (op.status === 'conflict') {
      view.conflict = this.buildConflict(op);
    }
    return view;
  }

  private buildConflict(op: OfflineOp): OfflineOpConflict {
    const context = this.conflicts.get(op.id);
    const server = context?.server ?? null;
    if (op instanceof UpdateLandmarkOp) {
      const serverSnapshot = (server as LandmarkSnapshot | null) ?? null;
      return {
        kind: 'update',
        entityLabel: 'landmark',
        title: op.next.name || op.baseline?.name || '',
        local: op.next,
        server,
        rows: conflictRows(op.next, serverSnapshot),
      };
    }
    if (op instanceof DeleteLandmarkOp) {
      const serverSnapshot = (server as LandmarkSnapshot | null) ?? null;
      return {
        kind: 'delete',
        entityLabel: 'landmark',
        title: op.baseline?.name ?? '',
        local: null,
        server,
        rows: conflictRows(op.baseline, serverSnapshot),
      };
    }
    if (op instanceof UpdateGpsTrackOp) {
      const serverSnapshot = (server as GpsTrackSnapshot | null) ?? null;
      return {
        kind: 'update',
        entityLabel: 'GPS track',
        title: op.next.name || op.baseline?.name || '',
        local: op.next,
        server,
        rows: gpsConflictRows(op.next, serverSnapshot),
      };
    }
    if (op instanceof DeleteGpsTrackOp) {
      const serverSnapshot = (server as GpsTrackSnapshot | null) ?? null;
      return {
        kind: 'delete',
        entityLabel: 'GPS track',
        title: op.baseline?.name ?? '',
        local: null,
        server,
        rows: gpsConflictRows(op.baseline, serverSnapshot),
      };
    }
    return { kind: 'update', title: '', local: null, server, rows: [] };
  }

  // ---- Enqueue (with coalescing) --------------------------------------------

  private genId(): string {
    const cryptoObj =
      typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
    return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  enqueueCreate(landmark: LandmarkApiObject): Promise<CreateLandmarkOp> {
    return this.enqueueCommand(() => this.enqueueCreateCommand(landmark));
  }

  private async enqueueCreateCommand(landmark: LandmarkApiObject): Promise<CreateLandmarkOp> {
    await this.load();
    const seq = this.seqCounter + 1;
    const op = new CreateLandmarkOp({
      id: this.genId(),
      seq,
      createdAt: Date.now(),
      landmark,
    });
    await this.persist(op);
    this.seqCounter = seq;
    this.ops.push(op);
    this.emitChange();
    return op;
  }

  enqueueUpdate(
    targetId: string,
    baseline: LandmarkSnapshot | null,
    next: LandmarkSnapshot,
  ): Promise<void> {
    return this.enqueueCommand(() => this.enqueueUpdateCommand(targetId, baseline, next));
  }

  private async enqueueUpdateCommand(
    targetId: string,
    baseline: LandmarkSnapshot | null,
    next: LandmarkSnapshot,
  ): Promise<void> {
    await this.load();

    // Editing a not-yet-synced offline create: mutate the create in place.
    const create = this.findCreate(targetId);
    if (create) {
      const replacement = new CreateLandmarkOp({
        id: create.id,
        seq: create.seq,
        createdAt: create.createdAt,
        status: create.status,
        lastError: create.lastError,
        landmark: {
          ...create.landmark,
          name: next.name,
          description: next.description,
          latitude: next.latitude,
          longitude: next.longitude,
          collection: next.collection ?? '',
        },
      });
      await this.replaceOp(create, replacement);
      this.emitChange();
      return;
    }

    // Replace an existing pending edit (keep its original server baseline).
    const existingUpdate = this.findOp(
      (op): op is UpdateLandmarkOp => op instanceof UpdateLandmarkOp && op.targetId === targetId,
    );
    if (existingUpdate) {
      const replacement = new UpdateLandmarkOp({
        id: existingUpdate.id,
        seq: existingUpdate.seq,
        createdAt: existingUpdate.createdAt,
        targetId,
        baseline: existingUpdate.baseline,
        next,
      });
      await this.replaceOp(existingUpdate, replacement);
      this.emitChange();
      return;
    }

    // Editing after a pending delete means the user intent has changed from
    // "remove it" to "keep it with these edits". Replace the delete so the queue
    // still has exactly one op for this landmark.
    const existingDelete = this.findOp(
      (op): op is DeleteLandmarkOp => op instanceof DeleteLandmarkOp && op.targetId === targetId,
    );
    const effectiveBaseline = existingDelete ? existingDelete.baseline : baseline;

    const seq = this.seqCounter + 1;
    const op = new UpdateLandmarkOp({
      id: this.genId(),
      seq,
      createdAt: Date.now(),
      targetId,
      baseline: effectiveBaseline,
      next,
    });
    if (existingDelete) {
      await this.replaceOp(existingDelete, op);
    } else {
      await this.persist(op);
      this.ops.push(op);
    }
    this.seqCounter = seq;
    this.emitChange();
  }

  enqueueDelete(targetId: string, baseline: LandmarkSnapshot | null): Promise<void> {
    return this.enqueueCommand(() => this.enqueueDeleteCommand(targetId, baseline));
  }

  private async enqueueDeleteCommand(
    targetId: string,
    baseline: LandmarkSnapshot | null,
  ): Promise<void> {
    await this.load();

    // Deleting a not-yet-synced offline create: it never existed server-side, so
    // drop the create (and it leaves no trace).
    const create = this.findCreate(targetId);
    if (create) {
      await this.removeOp(create.id);
      this.emitChange();
      return;
    }

    // A delete supersedes any pending edit for the same landmark. Preserve the
    // edit's original baseline (the true last-known server state).
    const existingUpdate = this.findOp(
      (op): op is UpdateLandmarkOp => op instanceof UpdateLandmarkOp && op.targetId === targetId,
    );
    const effectiveBaseline = existingUpdate ? existingUpdate.baseline : baseline;
    const seq = this.seqCounter + 1;
    const op = new DeleteLandmarkOp({
      id: this.genId(),
      seq,
      createdAt: Date.now(),
      targetId,
      baseline: effectiveBaseline,
    });
    if (existingUpdate) {
      await this.replaceOp(existingUpdate, op);
    } else {
      await this.persist(op);
      this.ops.push(op);
    }
    this.seqCounter = seq;
    this.emitChange();
  }

  // ---- GPS track enqueue (with coalescing) ----------------------------------

  enqueueGpsCreate(
    track: { id: string; name: string; color: string },
  ): Promise<CreateGpsTrackOp> {
    return this.enqueueCommand(() => this.enqueueGpsCreateCommand(track));
  }

  private async enqueueGpsCreateCommand(
    track: { id: string; name: string; color: string },
  ): Promise<CreateGpsTrackOp> {
    await this.load();
    // Re-uploading the same recorded track replaces the pending upload in place.
    const existing = this.findOp(
      (op): op is CreateGpsTrackOp => op instanceof CreateGpsTrackOp && op.localTrackId === track.id,
    );
    if (existing) {
      const replacement = new CreateGpsTrackOp({
        id: existing.id,
        seq: existing.seq,
        createdAt: existing.createdAt,
        localTrackId: existing.localTrackId,
        name: track.name,
        color: track.color,
      });
      await this.replaceOp(existing, replacement);
      this.emitChange();
      return replacement;
    }
    const seq = this.seqCounter + 1;
    const op = new CreateGpsTrackOp({
      id: this.genId(),
      seq,
      createdAt: Date.now(),
      localTrackId: track.id,
      name: track.name,
      color: track.color,
    });
    await this.persist(op);
    this.seqCounter = seq;
    this.ops.push(op);
    this.emitChange();
    return op;
  }

  enqueueGpsUpdate(
    targetId: string,
    baseline: GpsTrackSnapshot | null,
    next: GpsTrackSnapshot,
  ): Promise<void> {
    return this.enqueueCommand(() => this.enqueueGpsUpdateCommand(targetId, baseline, next));
  }

  private async enqueueGpsUpdateCommand(
    targetId: string,
    baseline: GpsTrackSnapshot | null,
    next: GpsTrackSnapshot,
  ): Promise<void> {
    await this.load();

    // Replace an existing pending edit (keep its original server baseline).
    const existingUpdate = this.findOp(
      (op): op is UpdateGpsTrackOp => op instanceof UpdateGpsTrackOp && op.targetId === targetId,
    );
    if (existingUpdate) {
      const replacement = new UpdateGpsTrackOp({
        id: existingUpdate.id,
        seq: existingUpdate.seq,
        createdAt: existingUpdate.createdAt,
        targetId,
        baseline: existingUpdate.baseline,
        next,
      });
      await this.replaceOp(existingUpdate, replacement);
      this.emitChange();
      return;
    }

    // Editing after a pending delete flips intent back to "keep it"; replace the
    // delete with an update so the queue keeps exactly one op per track.
    const existingDelete = this.findOp(
      (op): op is DeleteGpsTrackOp => op instanceof DeleteGpsTrackOp && op.targetId === targetId,
    );
    const effectiveBaseline = existingDelete ? existingDelete.baseline : baseline;

    const seq = this.seqCounter + 1;
    const op = new UpdateGpsTrackOp({
      id: this.genId(),
      seq,
      createdAt: Date.now(),
      targetId,
      baseline: effectiveBaseline,
      next,
    });
    if (existingDelete) {
      await this.replaceOp(existingDelete, op);
    } else {
      await this.persist(op);
      this.ops.push(op);
    }
    this.seqCounter = seq;
    this.emitChange();
  }

  enqueueGpsDelete(targetId: string, baseline: GpsTrackSnapshot | null): Promise<void> {
    return this.enqueueCommand(() => this.enqueueGpsDeleteCommand(targetId, baseline));
  }

  private async enqueueGpsDeleteCommand(
    targetId: string,
    baseline: GpsTrackSnapshot | null,
  ): Promise<void> {
    await this.load();

    // A delete supersedes any pending edit for the same track; keep the edit's
    // original baseline (the true last-known server state).
    const existingUpdate = this.findOp(
      (op): op is UpdateGpsTrackOp => op instanceof UpdateGpsTrackOp && op.targetId === targetId,
    );
    const effectiveBaseline = existingUpdate ? existingUpdate.baseline : baseline;
    const seq = this.seqCounter + 1;
    const op = new DeleteGpsTrackOp({
      id: this.genId(),
      seq,
      createdAt: Date.now(),
      targetId,
      baseline: effectiveBaseline,
    });
    if (existingUpdate) {
      await this.replaceOp(existingUpdate, op);
    } else {
      await this.persist(op);
      this.ops.push(op);
    }
    this.seqCounter = seq;
    this.emitChange();
  }

  /** True when a recorded local track has a pending upload (create) op. */
  hasGpsCreateFor(localTrackId: string): boolean {
    return this.ops.some(
      (op) => op instanceof CreateGpsTrackOp && op.localTrackId === localTrackId,
    );
  }

  /** Discard every queued op whose subject is `subjectId` (any GPS-track op). */
  discardGpsTrackOpsForSubject(subjectId: string): Promise<void> {
    return this.enqueueCommand(() => this.discardGpsTrackOpsForSubjectCommand(subjectId));
  }

  private async discardGpsTrackOpsForSubjectCommand(subjectId: string): Promise<void> {
    await this.load();
    const ids = this.ops
      .filter((op) => op.entityType === 'gpsTrack' && op.subjectId() === subjectId)
      .map((op) => op.id);
    if (ids.length === 0) return;
    for (const id of ids) {
      await this.removeOp(id);
    }
    this.emitChange();
  }

  /** Discard a pending op (the map reverts via re-fold). */
  discard(id: string): Promise<void> {
    return this.enqueueCommand(() => this.discardCommand(id));
  }

  private async discardCommand(id: string): Promise<void> {
    await this.load();
    await this.removeOp(id);
    this.emitChange();
  }

  // ---- Replay ---------------------------------------------------------------

  /**
   * Replay every pending op in chronological order. Overlapping full replay
   * callers are compatible and share one result instead of queuing redundant
   * pulls after the active run.
   */
  syncAll(): Promise<OfflineSyncSummary> {
    if (this.fullReplayFlight) return this.fullReplayFlight;

    const flight = this.enqueueCommand(async () => {
      await this.load();
      return this.runReplay(this.ordered());
    });
    this.fullReplayFlight = flight;
    const clearFlight = () => {
      if (this.fullReplayFlight === flight) this.fullReplayFlight = null;
    };
    void flight.then(clearFlight, clearFlight);
    return flight;
  }

  /** Replay a single op (and nothing else). */
  syncOne(id: string): Promise<OfflineSyncSummary> {
    return this.enqueueCommand(async () => {
      await this.load();
      const op = this.ops.find((candidate) => candidate.id === id);
      return this.runReplay(op ? [op] : []);
    });
  }

  private async runReplay(targets: OfflineOp[]): Promise<OfflineSyncSummary> {
    const summary: OfflineSyncSummary = {
      reason: 'completed',
      succeeded: 0,
      conflicted: 0,
      failed: 0,
      conflictIds: [],
      remaining: this.ops.length,
    };

    if (targets.length === 0) {
      summary.reason = 'nothing_to_sync';
      return summary;
    }
    if (!this.port.hasNetworkAccess()) {
      summary.reason = 'offline';
      return summary;
    }

    this.replaying = true;
    // Pull only the server snapshots the targeted ops actually need; a mixed
    // run (landmark + GPS ops) pulls both. A failed pull aborts the whole run.
    const needsLandmarks = targets.some((op) => op.entityType === 'landmark');
    const needsGpsTracks = targets.some((op) => op.entityType === 'gpsTrack');
    const snapshots: ReplayServerSnapshots = { landmarks: emptyCollection(), gpsTracks: [] };
    try {
      if (needsLandmarks) snapshots.landmarks = await this.fetchServerLandmarks();
      if (needsGpsTracks) snapshots.gpsTracks = await this.fetchServerGpsTracks();
    } catch {
      summary.reason = 'pull_failed';
      this.replaying = false;
      return summary;
    }

    const blockedSubjects = new Set<string>();
    try {
      for (const op of targets) {
        if (!this.ops.includes(op)) continue;
        // Namespace by entity so a landmark id can never block a track id.
        const subject = `${op.entityType}:${op.subjectId()}`;
        if (blockedSubjects.has(subject)) continue;
        const outcome = await this.replayOne(op, snapshots);
        if (outcome === 'success') {
          summary.succeeded += 1;
        } else if (outcome === 'conflict') {
          summary.conflicted += 1;
          summary.conflictIds.push(op.id);
          blockedSubjects.add(subject);
        } else {
          summary.failed += 1;
          blockedSubjects.add(subject);
        }
      }
    } catch (error) {
      if (!(error instanceof OfflineNetworkInterruption)) throw error;
      // Lost connectivity mid-run: leave the rest pending, surface nothing scary.
      summary.reason = 'pull_failed';
    } finally {
      this.replaying = false;
    }

    summary.remaining = this.ops.length;
    this.emitChange();
    return summary;
  }

  private async replayOne(
    op: OfflineOp,
    snapshots: ReplayServerSnapshots,
  ): Promise<'success' | 'conflict' | 'error'> {
    if (op instanceof CreateLandmarkOp) return this.replayCreate(op, snapshots.landmarks);
    if (op instanceof UpdateLandmarkOp) return this.replayUpdate(op, snapshots.landmarks);
    if (op instanceof DeleteLandmarkOp) return this.replayDelete(op, snapshots.landmarks);
    if (op instanceof CreateGpsTrackOp) return this.replayGpsCreate(op);
    if (op instanceof UpdateGpsTrackOp) return this.replayGpsUpdate(op, snapshots.gpsTracks);
    if (op instanceof DeleteGpsTrackOp) return this.replayGpsDelete(op, snapshots.gpsTracks);
    return 'error';
  }

  private async replayCreate(
    op: CreateLandmarkOp,
    server: GeoJSON.FeatureCollection,
  ): Promise<'success' | 'conflict' | 'error'> {
    const existingBeforePost = findLandmarkFeatureByIdentity(
      server,
      snapshotFromApi(op.landmark),
    );
    if (existingBeforePost) {
      await this.finalizeCreate(op, landmarkApiObjectFromFeature(existingBeforePost));
      return 'success';
    }

    let response: { status: number; data: unknown };
    try {
      response = await this.port.postLandmark(this.toCreateInput(op.landmark));
    } catch {
      throw new OfflineNetworkInterruption();
    }

    if (isSuccessfulStatus(response.status)) {
      const landmark = extractLandmarkObject(response.data);
      if (!landmark || isLocalLandmarkId(landmark.id)) {
        const freshServer = await this.fetchServerLandmarks();
        const existing = findLandmarkFeatureByIdentity(freshServer, snapshotFromApi(op.landmark));
        if (existing) {
          await this.finalizeCreate(op, landmarkApiObjectFromFeature(existing));
          return 'success';
        }
        return this.markError(
          op,
          'The server accepted this landmark but did not return it. Tap Sync to check again.',
        );
      }
      await this.finalizeCreate(op, landmark);
      return 'success';
    }
    if (response.status >= 500) throw new OfflineNetworkInterruption();

    // Idempotent dedupe: the landmark may already exist server-side (e.g. a
    // "200 to nothing" tunnel that actually committed). Match by identity.
    const parsed = parseLandmarkMutationError(response.status, response.data);
    if (parsed.kind === 'duplicate') {
      const freshServer = await this.fetchServerLandmarks();
      const existing = findLandmarkFeatureByIdentity(
        freshServer,
        snapshotFromApi(op.landmark),
      );
      if (existing) {
        await this.finalizeCreate(op, landmarkApiObjectFromFeature(existing));
        return 'success';
      }
    }
    return this.markError(op, parsed.message);
  }

  private async replayUpdate(
    op: UpdateLandmarkOp,
    server: GeoJSON.FeatureCollection,
  ): Promise<'success' | 'conflict' | 'error'> {
    const serverFeature = findLandmarkFeature(server, op.targetId);
    // Idempotent replay: if the server is already at our intended end state, the
    // op is satisfied -- adopt the server feature and drop the op. This covers a
    // force-quit *after* the PATCH committed but before the op was removed (on
    // relaunch the baseline no longer matches, but the server already equals
    // `next`), and a two-device case where another client made the same edit.
    // Checked before the baseline comparison so it never raises a false,
    // empty-diff conflict (server == next, so there is nothing to show).
    if (serverFeature) {
      const serverSnapshot = snapshotFromFeature(serverFeature);
      if (snapshotsEqual(serverSnapshot, op.next)) {
        await this.port.applyUpsert(landmarkApiObjectFromFeature(serverFeature));
        await this.removeOp(op.id);
        return 'success';
      }
    }
    // Conflict detection compares the op's footprint (last known server state)
    // against the freshly pulled server state. A `null` footprint means we never
    // had a reliable upstream snapshot, so we cannot claim a conflict -> push.
    if (op.baseline !== null) {
      if (!serverFeature) {
        // Deleted on the server while the user edited it locally -> conflict.
        return this.markConflict(op, null, null);
      }
      const serverSnapshot = snapshotFromFeature(serverFeature);
      if (!snapshotsEqual(serverSnapshot, op.baseline)) {
        return this.markConflict(op, serverSnapshot, serverFeature);
      }
    }

    let response: { status: number; data: unknown };
    try {
      response = await this.port.patchLandmark(op.targetId, this.toUpdateInput(op.next));
    } catch {
      throw new OfflineNetworkInterruption();
    }
    if (isSuccessfulStatus(response.status)) {
      const landmark = extractLandmarkObject(response.data) ?? this.buildLandmark(op.targetId, op.next, serverFeature);
      await this.port.applyUpsert(landmark);
      await this.removeOp(op.id);
      return 'success';
    }
    if (response.status >= 500) throw new OfflineNetworkInterruption();
    return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
  }

  private async replayDelete(
    op: DeleteLandmarkOp,
    server: GeoJSON.FeatureCollection,
  ): Promise<'success' | 'conflict' | 'error'> {
    const serverFeature = findLandmarkFeature(server, op.targetId);
    if (!serverFeature) {
      // Already gone server-side: the delete is satisfied.
      await this.port.applyRemoval(op.targetId);
      await this.removeOp(op.id);
      return 'success';
    }
    // Only claim a conflict when we have a real footprint to compare against.
    if (op.baseline !== null) {
      const serverSnapshot = snapshotFromFeature(serverFeature);
      if (!snapshotsEqual(serverSnapshot, op.baseline)) {
        return this.markConflict(op, serverSnapshot, serverFeature);
      }
    }

    let response: { status: number; data: unknown };
    try {
      response = await this.port.deleteLandmark(op.targetId);
    } catch {
      throw new OfflineNetworkInterruption();
    }
    if (isSuccessfulStatus(response.status) || response.status === 404) {
      await this.port.applyRemoval(op.targetId);
      await this.removeOp(op.id);
      return 'success';
    }
    if (response.status >= 500) throw new OfflineNetworkInterruption();
    return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
  }

  // ---- GPS track replay -----------------------------------------------------

  private async replayGpsCreate(
    op: CreateGpsTrackOp,
  ): Promise<'success' | 'conflict' | 'error'> {
    let response: { status: number; data: unknown };
    try {
      response = await this.port.uploadGpsTrack(op.localTrackId);
    } catch {
      throw new OfflineNetworkInterruption();
    }
    if (isSuccessfulStatus(response.status)) {
      // The server dedupes GPX imports by file sha256, so re-uploading the same
      // recording is idempotent (it just returns zero counts) -- still success.
      await this.port.onGpsTrackCreated(op.localTrackId);
      await this.removeOp(op.id);
      return 'success';
    }
    if (response.status >= 500) throw new OfflineNetworkInterruption();
    return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
  }

  private async replayGpsUpdate(
    op: UpdateGpsTrackOp,
    server: RemoteGpsTrack[],
  ): Promise<'success' | 'conflict' | 'error'> {
    const serverTrack = findRemoteTrack(server, op.targetId);
    // Idempotent replay: if the server is already at our intended end state,
    // adopt it and drop the op (covers a force-quit after the PATCH committed).
    if (serverTrack) {
      const serverSnapshot = snapshotFromRemote(serverTrack);
      if (gpsSnapshotsEqual(serverSnapshot, op.next)) {
        await this.port.applyGpsTrackUpsert(serverTrack);
        await this.removeOp(op.id);
        return 'success';
      }
    }
    if (op.baseline !== null) {
      if (!serverTrack) {
        // Deleted on the server while the user edited it locally -> conflict.
        return this.markConflict(op, null, null);
      }
      const serverSnapshot = snapshotFromRemote(serverTrack);
      if (!gpsSnapshotsEqual(serverSnapshot, op.baseline)) {
        return this.markConflict(op, serverSnapshot, null);
      }
    }

    let response: { status: number; data: unknown };
    try {
      response = await this.port.patchGpsTrack(op.targetId, { name: op.next.name, color: op.next.color });
    } catch {
      throw new OfflineNetworkInterruption();
    }
    if (isSuccessfulStatus(response.status)) {
      await this.port.applyGpsTrackUpsert(this.buildRemoteTrack(op.targetId, op.next, serverTrack, response.data));
      await this.removeOp(op.id);
      return 'success';
    }
    if (response.status >= 500) throw new OfflineNetworkInterruption();
    return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
  }

  private async replayGpsDelete(
    op: DeleteGpsTrackOp,
    server: RemoteGpsTrack[],
  ): Promise<'success' | 'conflict' | 'error'> {
    const serverTrack = findRemoteTrack(server, op.targetId);
    if (!serverTrack) {
      // Already gone server-side: the delete is satisfied.
      await this.port.applyGpsTrackRemoval(op.targetId);
      await this.removeOp(op.id);
      return 'success';
    }
    if (op.baseline !== null) {
      const serverSnapshot = snapshotFromRemote(serverTrack);
      if (!gpsSnapshotsEqual(serverSnapshot, op.baseline)) {
        return this.markConflict(op, serverSnapshot, null);
      }
    }

    let response: { status: number; data: unknown };
    try {
      response = await this.port.deleteGpsTrackRemote(op.targetId);
    } catch {
      throw new OfflineNetworkInterruption();
    }
    if (isSuccessfulStatus(response.status) || response.status === 404) {
      await this.port.applyGpsTrackRemoval(op.targetId);
      await this.removeOp(op.id);
      return 'success';
    }
    if (response.status >= 500) throw new OfflineNetworkInterruption();
    return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
  }

  // ---- Conflict resolution --------------------------------------------------

  resolveConflict(id: string, choice: OfflineConflictChoice): Promise<OfflineSyncSummary> {
    return this.enqueueCommand(() => this.resolveConflictCommand(id, choice));
  }

  private async resolveConflictCommand(
    id: string,
    choice: OfflineConflictChoice,
  ): Promise<OfflineSyncSummary> {
    await this.load();
    const summary: OfflineSyncSummary = {
      reason: 'completed',
      succeeded: 0,
      conflicted: 0,
      failed: 0,
      conflictIds: [],
      remaining: this.ops.length,
    };
    const op = this.ops.find((candidate) => candidate.id === id);
    if (!op) {
      summary.reason = 'nothing_to_sync';
      return summary;
    }
    if (!this.port.hasNetworkAccess()) {
      summary.reason = 'offline';
      return summary;
    }

    try {
      if (choice === 'local') {
        const outcome = await this.forceLocal(op);
        if (outcome === 'error') {
          summary.failed = 1;
        } else {
          summary.succeeded = 1;
        }
      } else {
        await this.adoptServer(op);
        summary.succeeded = 1;
      }
    } catch (error) {
      if (!(error instanceof OfflineNetworkInterruption)) throw error;
      summary.reason = 'pull_failed';
    }

    summary.remaining = this.ops.length;
    this.emitChange();
    return summary;
  }

  /** Keep the user's change: force the request regardless of server drift. */
  private async forceLocal(op: OfflineOp): Promise<'success' | 'error'> {
    if (op instanceof UpdateLandmarkOp) {
      let response: { status: number; data: unknown };
      try {
        response = await this.port.patchLandmark(op.targetId, this.toUpdateInput(op.next));
      } catch {
        throw new OfflineNetworkInterruption();
      }
      if (isSuccessfulStatus(response.status)) {
        const landmark = extractLandmarkObject(response.data) ?? this.buildLandmark(op.targetId, op.next, null);
        await this.port.applyUpsert(landmark);
        await this.removeOp(op.id);
        return 'success';
      }
      if (response.status >= 500) throw new OfflineNetworkInterruption();
      return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
    }
    if (op instanceof DeleteLandmarkOp) {
      let response: { status: number; data: unknown };
      try {
        response = await this.port.deleteLandmark(op.targetId);
      } catch {
        throw new OfflineNetworkInterruption();
      }
      if (isSuccessfulStatus(response.status) || response.status === 404) {
        await this.port.applyRemoval(op.targetId);
        await this.removeOp(op.id);
        return 'success';
      }
      if (response.status >= 500) throw new OfflineNetworkInterruption();
      return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
    }
    if (op instanceof UpdateGpsTrackOp) {
      let response: { status: number; data: unknown };
      try {
        response = await this.port.patchGpsTrack(op.targetId, { name: op.next.name, color: op.next.color });
      } catch {
        throw new OfflineNetworkInterruption();
      }
      if (isSuccessfulStatus(response.status)) {
        await this.port.applyGpsTrackUpsert(this.buildRemoteTrack(op.targetId, op.next, null, response.data));
        await this.removeOp(op.id);
        return 'success';
      }
      if (response.status >= 500) throw new OfflineNetworkInterruption();
      return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
    }
    if (op instanceof DeleteGpsTrackOp) {
      let response: { status: number; data: unknown };
      try {
        response = await this.port.deleteGpsTrackRemote(op.targetId);
      } catch {
        throw new OfflineNetworkInterruption();
      }
      if (isSuccessfulStatus(response.status) || response.status === 404) {
        await this.port.applyGpsTrackRemoval(op.targetId);
        await this.removeOp(op.id);
        return 'success';
      }
      if (response.status >= 500) throw new OfflineNetworkInterruption();
      return this.markError(op, parseLandmarkMutationError(response.status, response.data).message);
    }
    return 'error';
  }

  /** Use the server's version: discard the local op and adopt current server state. */
  private async adoptServer(op: OfflineOp): Promise<void> {
    if (op.entityType === 'gpsTrack') {
      let server: RemoteGpsTrack[];
      try {
        server = await this.fetchServerGpsTracks();
      } catch {
        throw new OfflineNetworkInterruption();
      }
      const targetId = op.subjectId();
      const serverTrack = findRemoteTrack(server, targetId);
      if (serverTrack) {
        await this.port.applyGpsTrackUpsert(serverTrack);
      } else {
        await this.port.applyGpsTrackRemoval(targetId);
      }
      await this.removeOp(op.id);
      return;
    }

    let server: GeoJSON.FeatureCollection;
    try {
      const response = await this.port.fetchLandmarksGeoJSON();
      if (!isSuccessfulStatus(response.status)) throw new OfflineNetworkInterruption();
      server = normalizeGeoJSON(response.data) ?? emptyCollection();
    } catch {
      throw new OfflineNetworkInterruption();
    }

    const targetId = op.subjectId();
    const serverFeature = findLandmarkFeature(server, targetId);
    if (serverFeature) {
      await this.port.applyUpsert(landmarkApiObjectFromFeature(serverFeature));
    } else {
      await this.port.applyRemoval(targetId);
    }
    await this.removeOp(op.id);
  }

  // ---- Helpers --------------------------------------------------------------

  private async finalizeCreate(op: CreateLandmarkOp, landmark: LandmarkApiObject): Promise<void> {
    const tempId = op.landmark.id;
    const realId = landmark.id;
    // Defensive remap: rewrite any later op that still targets the temp id.
    if (tempId !== realId) {
      for (const other of this.ops) {
        if (other instanceof UpdateLandmarkOp && other.targetId === tempId) {
          other.targetId = realId;
          await this.persist(other);
        } else if (other instanceof DeleteLandmarkOp && other.targetId === tempId) {
          other.targetId = realId;
          await this.persist(other);
        }
      }
    }
    await this.port.applyUpsert(landmark);
    await this.removeOp(op.id);
  }

  private async markConflict(
    op: OfflineOp,
    server: unknown | null,
    serverFeature: GeoJSON.Feature | null,
  ): Promise<'conflict'> {
    op.status = 'conflict';
    op.lastError = undefined;
    this.conflicts.set(op.id, { server, serverFeature });
    await this.persist(op);
    return 'conflict';
  }

  private async markError(op: OfflineOp, message: string): Promise<'error'> {
    op.status = 'error';
    op.lastError = message;
    await this.persist(op);
    return 'error';
  }

  private findCreate(targetId: string): CreateLandmarkOp | null {
    return (
      this.findOp(
        (op): op is CreateLandmarkOp =>
          op instanceof CreateLandmarkOp && op.landmark.id === targetId,
      ) ?? null
    );
  }

  private findOp<T extends OfflineOp>(predicate: (op: OfflineOp) => op is T): T | undefined {
    return this.ops.find(predicate) as T | undefined;
  }

  private toCreateInput(landmark: LandmarkApiObject): LandmarkCreateInput {
    return {
      name: landmark.name,
      description: landmark.description,
      latitude: landmark.latitude,
      longitude: landmark.longitude,
      collection: landmark.collection ? landmark.collection : null,
    };
  }

  private toUpdateInput(next: LandmarkSnapshot): LandmarkUpdateInput {
    return {
      name: next.name,
      description: next.description,
      latitude: next.latitude,
      longitude: next.longitude,
      collection: next.collection,
    };
  }

  private buildLandmark(
    id: string,
    next: LandmarkSnapshot,
    existing: GeoJSON.Feature | null,
  ): LandmarkApiObject {
    const props =
      existing && existing.properties && typeof existing.properties === 'object'
        ? (existing.properties as Record<string, unknown>)
        : {};
    return {
      id,
      name: next.name,
      description: next.description,
      latitude: next.latitude,
      longitude: next.longitude,
      collection: next.collection ?? '',
      collection_name: typeof props.collection_name === 'string' ? props.collection_name : '',
      collection_color: typeof props.collection_color === 'string' ? props.collection_color : '',
      is_personal_collection: props.is_personal_collection === true,
      can_write: props.can_write !== false,
      can_delete: props.can_delete !== false,
    };
  }

  private async fetchServerLandmarks(): Promise<GeoJSON.FeatureCollection> {
    const response = await this.port.fetchLandmarksGeoJSON();
    if (!isSuccessfulStatus(response.status)) {
      throw new OfflineNetworkInterruption();
    }
    return normalizeGeoJSON(response.data) ?? emptyCollection();
  }

  private async fetchServerGpsTracks(): Promise<RemoteGpsTrack[]> {
    const response = await this.port.fetchGpsTracks();
    if (!isSuccessfulStatus(response.status)) {
      throw new OfflineNetworkInterruption();
    }
    return parseRemoteGpsTracks(response.data);
  }

  /**
   * Build the confirmed `RemoteGpsTrack` to cache after a successful PATCH.
   * Prefers the PATCH response, falls back to the previous server entry (to keep
   * `fileUrl`/`sha256`), and always applies the intended name/color.
   */
  private buildRemoteTrack(
    id: string,
    next: GpsTrackSnapshot,
    existing: RemoteGpsTrack | null,
    responseData: unknown,
  ): RemoteGpsTrack {
    const parsed = parseRemoteGpsTrack(responseData);
    const base: RemoteGpsTrack = existing ?? {
      id,
      name: next.name,
      color: next.color,
      fileUrl: '',
      sha256: '',
      createdAt: 0,
      updatedAt: 0,
    };
    return {
      ...base,
      id,
      name: next.name,
      color: next.color,
      // Keep a known file URL/hash; the PATCH response omits them.
      fileUrl: base.fileUrl || parsed?.fileUrl || '',
      sha256: base.sha256 || parsed?.sha256 || '',
      updatedAt: parsed?.updatedAt || Date.now(),
    };
  }

  private async persist(op: OfflineOp): Promise<void> {
    try {
      const ok = await this.store.put(op.serialize());
      if (!ok) {
        throw new OfflineOpPersistenceError('Could not save a pending offline change.');
      }
    } catch (error) {
      if (error instanceof OfflineOpPersistenceError) throw error;
      throw new OfflineOpPersistenceError('Could not save a pending offline change.', {
        cause: error,
      });
    }
  }

  private async replaceOp(current: OfflineOp, replacement: OfflineOp): Promise<void> {
    try {
      const ok = await this.store.replace(current.id, replacement.serialize());
      if (!ok) {
        throw new OfflineOpPersistenceError('Could not replace a pending offline change.');
      }
    } catch (error) {
      if (error instanceof OfflineOpPersistenceError) throw error;
      throw new OfflineOpPersistenceError('Could not replace a pending offline change.', {
        cause: error,
      });
    }
    this.ops = this.ops.map((op) => (op === current ? replacement : op));
    this.conflicts.delete(current.id);
  }

  private async removeOp(id: string): Promise<void> {
    try {
      const ok = await this.store.remove(id);
      if (!ok) {
        throw new OfflineOpPersistenceError('Could not remove a pending offline change.');
      }
    } catch (error) {
      if (error instanceof OfflineOpPersistenceError) throw error;
      throw new OfflineOpPersistenceError('Could not remove a pending offline change.', {
        cause: error,
      });
    }
    this.ops = this.ops.filter((op) => op.id !== id);
    this.conflicts.delete(id);
  }

  /**
   * Serialize network commands while keeping the lane usable after rejection.
   * Admission is synchronous, so two UI actions in the same render frame
   * cannot execute against the same durable operation concurrently.
   */
  private enqueueCommand<T>(command: () => Promise<T>): Promise<T> {
    const result = this.commandTail.then(command, command);
    this.commandTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private emitChange(): void {
    try {
      this.onChange();
    } catch (error) {
      console.warn('OfflineOpQueue onChange listener failed:', error);
    }
  }
}
