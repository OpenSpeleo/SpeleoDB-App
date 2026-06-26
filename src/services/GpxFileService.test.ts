import { describe, it, expect, vi } from 'vitest';
import { GpxFileService, type FilesystemLike, type ShareLike } from './GpxFileService';

function createDeps(overrides: {
  isNative?: boolean;
  share?: ShareLike['share'];
  writeFile?: FilesystemLike['writeFile'];
} = {}) {
  const writeFile = vi.fn(overrides.writeFile ?? (async () => ({ uri: 'file:///cache/track.gpx' })));
  const share = vi.fn(overrides.share ?? (async () => undefined));
  const webDownload = vi.fn();
  const logger = vi.fn();
  const service = new GpxFileService({
    filesystem: { writeFile } as unknown as FilesystemLike,
    share: { share } as unknown as ShareLike,
    isNative: () => overrides.isNative ?? false,
    webDownload,
    logger,
  });
  return { service, writeFile, share, webDownload, logger };
}

const INPUT = { fileName: 'track.gpx', gpx: '<gpx/>', title: 'My Track' };

describe('GpxFileService', () => {
  it('falls back to a web download off-device', async () => {
    const { service, writeFile, share, webDownload } = createDeps({ isNative: false });
    const outcome = await service.shareGpx(INPUT);

    expect(outcome).toBe('shared');
    expect(webDownload).toHaveBeenCalledWith('track.gpx', '<gpx/>');
    expect(writeFile).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('writes the GPX to disk and shares the file URI on native', async () => {
    const { service, writeFile, share } = createDeps({ isNative: true });
    const outcome = await service.shareGpx(INPUT);

    expect(outcome).toBe('shared');
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'track.gpx', data: '<gpx/>' }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/track.gpx'], title: 'My Track' }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.not.objectContaining({ url: expect.anything() }),
    );
  });

  it('returns "cancelled" when the user dismisses the share sheet', async () => {
    const { service } = createDeps({
      isNative: true,
      share: async () => {
        throw new Error('Share canceled');
      },
    });
    expect(await service.shareGpx(INPUT)).toBe('cancelled');
  });

  it('rethrows a genuine share failure', async () => {
    const { service, logger } = createDeps({
      isNative: true,
      share: async () => {
        throw new Error('share bridge unavailable');
      },
    });
    await expect(service.shareGpx(INPUT)).rejects.toThrow('bridge unavailable');
    expect(logger).toHaveBeenCalledWith(
      'GPX share failed while opening the native share sheet.',
      expect.objectContaining({
        fileName: 'track.gpx',
        gpxLength: INPUT.gpx.length,
        phase: 'native-share',
        uri: 'file:///cache/track.gpx',
        error: expect.objectContaining({
          name: 'Error',
          message: 'share bridge unavailable',
        }),
      }),
    );
  });

  it('propagates a filesystem write failure', async () => {
    const { service, logger } = createDeps({
      isNative: true,
      writeFile: async () => {
        throw new Error('disk full');
      },
    });
    await expect(service.shareGpx(INPUT)).rejects.toThrow('disk full');
    expect(logger).toHaveBeenCalledWith(
      'GPX share failed while writing the temporary GPX file.',
      expect.objectContaining({
        fileName: 'track.gpx',
        gpxLength: INPUT.gpx.length,
        phase: 'native-write',
        error: expect.objectContaining({
          name: 'Error',
          message: 'disk full',
        }),
      }),
    );
  });
});
