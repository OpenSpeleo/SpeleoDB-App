/**
 * GpxFileService -- write a GPX document to disk and hand it to the OS share
 * sheet.
 *
 * This backs "Export / Share GPX": on a phone, the share sheet lets the user
 * send the file to any installed app that accepts GPX. See docs/gps-tracks.md.
 *
 * On native, the GPX is written to the cache directory and shared by file URI.
 * On web (and tests), it falls back to a Blob download. All collaborators are
 * injectable so the service is unit-testable without real plugins.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isShareCancellation } from '../utils/share';
import { errorToLogDetails } from '../utils/errorDiagnostics';
import { GPS } from '../constants';

const GPX_MIME = GPS.GPX_CONTENT_TYPE;

export interface FilesystemLike {
  writeFile(options: {
    path: string;
    data: string;
    directory?: unknown;
    encoding?: unknown;
    recursive?: boolean;
  }): Promise<{ uri: string }>;
}

export interface ShareLike {
  share(options: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[];
    dialogTitle?: string;
  }): Promise<unknown>;
}

export interface GpxShareInput {
  /** File name including the `.gpx` extension. */
  fileName: string;
  /** The serialized GPX document. */
  gpx: string;
  /** Share-sheet title. */
  title?: string;
  /** Android chooser dialog title. */
  dialogTitle?: string;
}

export type GpxShareOutcome = 'shared' | 'cancelled';

export interface GpxFileServiceDeps {
  filesystem?: FilesystemLike;
  share?: ShareLike;
  isNative?: () => boolean;
  /** Web fallback that triggers a browser download. Injectable for tests. */
  webDownload?: (fileName: string, gpx: string) => void;
  logger?: (message: string, details: Record<string, unknown>) => void;
}

function defaultWebDownload(fileName: string, gpx: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return;
  }
  const blob = new Blob([gpx], { type: GPX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export class GpxFileService {
  private filesystem: FilesystemLike;
  private share: ShareLike;
  private isNative: () => boolean;
  private webDownload: (fileName: string, gpx: string) => void;
  private logger: (message: string, details: Record<string, unknown>) => void;

  constructor(deps: GpxFileServiceDeps = {}) {
    this.filesystem = deps.filesystem ?? (Filesystem as unknown as FilesystemLike);
    this.share = deps.share ?? (Share as unknown as ShareLike);
    this.isNative = deps.isNative ?? (() => Capacitor.isNativePlatform());
    this.webDownload = deps.webDownload ?? defaultWebDownload;
    this.logger = deps.logger ?? ((message, details) => console.warn(message, details));
  }

  /**
   * Write + share a GPX document. Returns `'cancelled'` when the user dismisses
   * the share sheet, `'shared'` otherwise. Throws only on a genuine IO/share
   * failure (not on cancellation).
   */
  async shareGpx(input: GpxShareInput): Promise<GpxShareOutcome> {
    const isNative = this.isNative();
    const baseDiagnostics = {
      fileName: input.fileName,
      gpxLength: input.gpx.length,
      isNative,
    };

    if (!isNative) {
      try {
        this.webDownload(input.fileName, input.gpx);
      } catch (error) {
        this.logger('GPX share failed before web download could start.', {
          ...baseDiagnostics,
          phase: 'web-download',
          error: errorToLogDetails(error),
        });
        throw error;
      }
      return 'shared';
    }

    let uri: string;
    try {
      ({ uri } = await this.filesystem.writeFile({
        path: input.fileName,
        data: input.gpx,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      }));
    } catch (error) {
      this.logger('GPX share failed while writing the temporary GPX file.', {
        ...baseDiagnostics,
        phase: 'native-write',
        error: errorToLogDetails(error),
      });
      throw error;
    }

    try {
      await this.share.share({
        title: input.title ?? input.fileName,
        files: [uri],
        dialogTitle: input.dialogTitle ?? input.title ?? 'Share GPS track',
      });
      return 'shared';
    } catch (error) {
      if (isShareCancellation(error)) return 'cancelled';
      this.logger('GPX share failed while opening the native share sheet.', {
        ...baseDiagnostics,
        phase: 'native-share',
        uri,
        error: errorToLogDetails(error),
      });
      throw error;
    }
  }

}
