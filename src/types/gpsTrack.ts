/**
 * Type definitions for GPS tracks.
 *
 * A `LocalGpsTrack` is a track recorded on the device and persisted to
 * IndexedDB (so a force-quit mid-recording never loses captured fixes). A
 * `RemoteGpsTrack` is the metadata for a track that lives on the SpeleoDB
 * server (synced like projects/landmarks); its point geometry is downloaded
 * lazily from a pre-signed GeoJSON URL.
 *
 * The UI consumes a single, unified `GpsTrackListItem` list that merges both
 * sources. Every track mutation (upload=create, edit name/color, delete) is an
 * offline op in the shared `OfflineOpQueue` and surfaces on the Pending page,
 * exactly like landmarks -- so the per-item `pending` state below is *derived*
 * from the queue, never stored on the record.
 *
 * See docs/gps-tracks.md and docs/offline-op-queue.md.
 */

// ==================== Recorded fixes ====================

export interface RecordedPoint {
  latitude: number;
  longitude: number;
  /** Meters above the WGS-84 ellipsoid, when the device reports it. */
  altitude?: number | null;
  /** Horizontal accuracy in meters (radius), when reported. */
  accuracy?: number | null;
  /** Vertical accuracy in meters, when reported. */
  altitudeAccuracy?: number | null;
  /** Epoch milliseconds of the fix. */
  timestamp: number;
}

// ==================== Track records ====================

/**
 * A track recorded on this device and persisted in the `gps_tracks` IndexedDB
 * store. It has no server identity until it is uploaded (a `CreateGpsTrackOp`),
 * after which the local copy is deleted and the server track is synced in.
 */
export interface LocalGpsTrack {
  id: string;
  name: string;
  /** Hex color (#rrggbb) used for the map line; editable locally. */
  color: string;
  points: RecordedPoint[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Metadata for a track stored on the SpeleoDB server (from
 * `GET /api/v2/gps_tracks/`). The GeoJSON geometry is downloaded on demand from
 * `fileUrl` and cached separately.
 */
export interface RemoteGpsTrack {
  id: string;
  name: string;
  /** Hex color (#rrggbb) assigned by the server; editable via PATCH. */
  color: string;
  /** Pre-signed URL to download the track GeoJSON (no auth header needed). */
  fileUrl: string;
  /** SHA-256 of the GeoJSON file (server-side dedupe identity). */
  sha256: string;
  /** Epoch ms parsed from the server `creation_date`. */
  createdAt: number;
  /** Epoch ms parsed from the server `modified_date`. */
  updatedAt: number;
}

// ==================== Unified list model ====================

export type GpsTrackOrigin = 'local' | 'remote';

/**
 * Derived (never persisted) pending state for a track, computed from the shared
 * offline op queue:
 * - `create`   -- a recorded track has a queued upload (not yet on the server).
 * - `update`   -- a queued name/color edit for a server track.
 * - `delete`   -- a queued delete for a server track.
 * - `conflict` -- the server changed under a queued edit/delete; needs the user.
 * - `error`    -- a definitive failure the user must see.
 */
export type GpsTrackPendingState = 'create' | 'update' | 'delete' | 'conflict' | 'error';

/**
 * The single unified track the GPS panel + map consume. Local and remote tracks
 * are merged into one list; `origin` makes the distinction explicit.
 */
export interface GpsTrackListItem {
  id: string;
  name: string;
  color: string;
  origin: GpsTrackOrigin;
  createdAt: number;
  updatedAt: number;
  /** Point count when known (always for local; for remote once geometry loads). */
  pointCount?: number | null;
  /** Track length in meters when point geometry is known. */
  distanceMeters?: number | null;
  /** Recording duration in ms when point timestamps are known. */
  durationMs?: number | null;
  /** Derived from the offline op queue; undefined when synced/clean. */
  pending?: GpsTrackPendingState;
  /** Message when `pending === 'error'`. */
  pendingError?: string | null;
}

/** The comparable subset of a server track used for offline conflict detection. */
export interface GpsTrackSnapshot {
  name: string;
  color: string;
}

// ==================== Recording state machine ====================

export type GpsRecordingState = 'idle' | 'recording' | 'paused';
