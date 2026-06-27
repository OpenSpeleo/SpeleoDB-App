import { GPS } from '../constants';
import type { LocalGpsTrack } from '../types/gpsTrack';
import { isValidLatLng } from '../utils/coordinates';
import { errorToLogDetails } from '../utils/errorDiagnostics';
import { buildGpx, type BuildGpxInput } from '../utils/gpx';

export interface GpsTrackGpxFile {
  fileName: string;
  gpx: string;
}

/**
 * Thrown when a track has no valid GPS points to serialize. Without this, an
 * all-invalid track would build a schema-valid GPX with zero `<trkpt>`; the
 * server would accept it (2xx, `gps_tracks_created: 0`) and we'd wrongly mark
 * the track "uploaded". Callers surface this as a real error instead.
 */
export class EmptyGpxTrackError extends Error {
  constructor(message = 'This track has no valid GPS points to export.') {
    super(message);
    this.name = 'EmptyGpxTrackError';
  }
}

export interface GpsTrackGpxServiceDeps {
  buildGpxFn?: (input: BuildGpxInput, creator?: string) => Promise<string>;
  logger?: (message: string, details: Record<string, unknown>) => void;
}

export class GpsTrackGpxService {
  private buildGpxFn: (input: BuildGpxInput, creator?: string) => Promise<string>;
  private logger: (message: string, details: Record<string, unknown>) => void;

  constructor(deps: GpsTrackGpxServiceDeps = {}) {
    this.buildGpxFn = deps.buildGpxFn ?? buildGpx;
    this.logger = deps.logger ?? ((message, details) => console.warn(message, details));
  }

  async buildFile(track: LocalGpsTrack): Promise<GpsTrackGpxFile> {
    const fileName = gpsTrackFileName(track);
    // Guard before building: buildGpx silently filters invalid coordinates, so a
    // track with no valid points would yield an empty (but schema-valid) GPX.
    // Refuse it here so share/upload surface a real error instead of a no-op.
    if (!track.points.some((p) => isValidLatLng(p.latitude, p.longitude))) {
      throw new EmptyGpxTrackError();
    }
    try {
      const gpx = await this.buildGpxFn(
        {
          metadata: { name: track.name, time: track.createdAt },
          tracks: [
            {
              name: track.name,
              segments: [
                track.points.map((p) => ({
                  latitude: p.latitude,
                  longitude: p.longitude,
                  elevation: p.altitude ?? null,
                  timestamp: p.timestamp,
                })),
              ],
            },
          ],
        },
        GPS.GPX_CREATOR,
      );
      return { fileName, gpx };
    } catch (error) {
      this.logger('GPS track GPX generation failed.', {
        trackId: track.id,
        trackName: track.name,
        pointCount: track.points.length,
        createdAt: track.createdAt,
        updatedAt: track.updatedAt,
        fileName,
        error: errorToLogDetails(error),
      });
      throw error;
    }
  }
}

export function gpsTrackFileName(track: LocalGpsTrack): string {
  const safe = track.name.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'track';
  return `${safe}.gpx`;
}
