import { describe, expect, it, vi } from 'vitest';
import type { LocalGpsTrack } from '../types/gpsTrack';
import { EmptyGpxTrackError, GpsTrackGpxService, gpsTrackFileName } from './GpsTrackGpxService';

function track(overrides: Partial<LocalGpsTrack> = {}): LocalGpsTrack {
  return {
    id: 'trk-1',
    name: 'Surface Walk',
    points: [
      {
        latitude: 45,
        longitude: -73,
        altitude: 10,
        timestamp: 1000,
      },
      {
        latitude: 45.001,
        longitude: -73.001,
        altitude: null,
        timestamp: 16_000,
      },
    ],
    createdAt: 1000,
    updatedAt: 16_000,
    color: '#e41a1c',
    ...overrides,
  };
}

describe('GpsTrackGpxService', () => {
  it('sanitizes track names into GPX file names', () => {
    expect(gpsTrackFileName(track({ name: 'Surface Walk 01' }))).toBe('Surface_Walk_01.gpx');
    expect(gpsTrackFileName(track({ name: '///' }))).toBe('track.gpx');
  });

  it('maps a local GPS track into the shared GPX builder input', async () => {
    const buildGpxFn = vi.fn(async () => '<gpx/>');
    const service = new GpsTrackGpxService({ buildGpxFn });

    const file = await service.buildFile(track());

    expect(file).toEqual({ fileName: 'Surface_Walk.gpx', gpx: '<gpx/>' });
    expect(buildGpxFn).toHaveBeenCalledWith(
      {
        metadata: { name: 'Surface Walk', time: 1000 },
        tracks: [
          {
            name: 'Surface Walk',
            segments: [
              [
                { latitude: 45, longitude: -73, elevation: 10, timestamp: 1000 },
                { latitude: 45.001, longitude: -73.001, elevation: null, timestamp: 16_000 },
              ],
            ],
          },
        ],
      },
      'SpeleoDB App',
    );
  });

  it('throws EmptyGpxTrackError (without building) when no point has valid coordinates', async () => {
    const buildGpxFn = vi.fn(async () => '<gpx/>');
    const service = new GpsTrackGpxService({ buildGpxFn });
    const invalid = track({
      points: [
        { latitude: Number.NaN, longitude: 10, altitude: null, timestamp: 1 },
        { latitude: 91, longitude: 200, altitude: null, timestamp: 2 },
      ],
    });

    await expect(service.buildFile(invalid)).rejects.toBeInstanceOf(EmptyGpxTrackError);
    expect(buildGpxFn).not.toHaveBeenCalled();
  });

  it('logs diagnostics and rethrows GPX conversion failures', async () => {
    const logger = vi.fn();
    const service = new GpsTrackGpxService({
      logger,
      buildGpxFn: async () => {
        throw new Error('bad coordinate');
      },
    });

    await expect(service.buildFile(track())).rejects.toThrow('bad coordinate');
    expect(logger).toHaveBeenCalledWith(
      'GPS track GPX generation failed.',
      expect.objectContaining({
        trackId: 'trk-1',
        trackName: 'Surface Walk',
        fileName: 'Surface_Walk.gpx',
        pointCount: 2,
        error: expect.objectContaining({ message: 'bad coordinate' }),
      }),
    );
  });
});
