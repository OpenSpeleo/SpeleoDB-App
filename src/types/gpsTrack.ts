/**
 * Type definitions for GPS track recording and upload.
 *
 * A `LocalGpsTrack` is a track recorded on the device and persisted to
 * IndexedDB (so a force-quit mid-recording never loses captured fixes). Tracks
 * are exported/shared as GPX and uploaded to SpeleoDB via the GPX import
 * endpoint. `uploadStatus` mirrors the offline-first model used by landmarks:
 * a track recorded offline is uploaded when connectivity returns.
 *
 * See docs/gps-tracks.md.
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
 * Upload lifecycle for a recorded track:
 * - `local`    -- recorded, not yet uploaded (no attempt made).
 * - `pending`  -- an upload was attempted but the server was unreachable
 *                 (offline / transport / timeout / 5xx); will retry on
 *                 reconnect or manual retry. Never silently dropped.
 * - `uploaded` -- the server accepted the GPX (a definitive 2xx).
 * - `error`    -- the server gave a definitive 4xx; surfaced to the user.
 */
export type GpsTrackUploadStatus = 'local' | 'pending' | 'uploaded' | 'error';

export interface LocalGpsTrack {
  id: string;
  name: string;
  points: RecordedPoint[];
  createdAt: number;
  updatedAt: number;
  uploadStatus: GpsTrackUploadStatus;
  /** Human-readable reason when `uploadStatus === 'error'`. */
  uploadError?: string | null;
  /** Server result of the last successful upload (informational). */
  remoteLandmarksCreated?: number;
  remoteTracksCreated?: number;
}

// ==================== Recording state machine ====================

export type GpsRecordingState = 'idle' | 'recording' | 'paused';
