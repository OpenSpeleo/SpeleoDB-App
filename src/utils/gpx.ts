import { isValidLatLng } from './coordinates';

// ==================== Public shapes ====================

export interface GpxPoint {
  latitude: number;
  longitude: number;
  /** Meters; omitted/null produces no <ele>. */
  elevation?: number | null;
  /** Epoch ms; omitted produces no <time>. */
  timestamp?: number | null;
}

export interface GpxWaypoint extends GpxPoint {
  name?: string | null;
  description?: string | null;
}

export interface GpxTrack {
  name?: string | null;
  /**
   * One or more segments of points. A flat `GpxPoint[]` is also accepted and
   * treated as a single segment.
   */
  segments: GpxPoint[][];
}

export interface GpxMetadata {
  name?: string | null;
  /** Epoch ms for the <metadata><time>. Defaults to none. */
  time?: number | null;
}

export interface BuildGpxInput {
  tracks?: GpxTrack[];
  waypoints?: GpxWaypoint[];
  metadata?: GpxMetadata;
}

// ==================== Helpers ====================

function isValidCoordinate(point: GpxPoint): boolean {
  return isValidLatLng(point.latitude, point.longitude);
}

function optionalNumber(value: number | null | undefined): number | undefined {
  return value === null || value === undefined || !Number.isFinite(value) ? undefined : value;
}

function optionalDate(value: number | null | undefined): Date | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
}

function normalizeSegments(track: GpxTrack): GpxPoint[][] {
  if (!Array.isArray(track.segments)) return [];
  // Tolerate a flat point array passed as `segments`.
  if (track.segments.length > 0 && !Array.isArray(track.segments[0])) {
    return [track.segments as unknown as GpxPoint[]];
  }
  return track.segments;
}

// ==================== Build ====================

/**
 * Serialize tracks + waypoints to a GPX 1.1 document string.
 *
 * Always returns a schema-valid document, even with no tracks/waypoints.
 */
export async function buildGpx(input: BuildGpxInput, creator = 'SpeleoDB App'): Promise<string> {
  const { BaseBuilder, buildGPX } = await loadGpxBuilder();
  if (!BaseBuilder?.MODELS) {
    throw new Error('gpx-builder BaseBuilder.MODELS is unavailable in this runtime bundle.');
  }
  const {
    Metadata,
    Point,
    Segment,
    Track,
  } = BaseBuilder.MODELS;
  const toBuilderPoint = (
    point: GpxPoint,
    extras: { name?: string | null; description?: string | null } = {},
  ) => new Point(point.latitude, point.longitude, {
    ele: optionalNumber(point.elevation),
    time: optionalDate(point.timestamp),
    name: extras.name ?? undefined,
    desc: extras.description ?? undefined,
  });

  const tracks = input.tracks ?? [];
  const waypoints = input.waypoints ?? [];
  const meta = input.metadata ?? {};

  const builder = new BaseBuilder();

  if (meta.name || (meta.time !== null && meta.time !== undefined)) {
    builder.setMetadata(new Metadata({
      name: meta.name ?? undefined,
      time: optionalDate(meta.time),
    }));
  }

  const builderWaypoints = waypoints
    .filter(isValidCoordinate)
    .map((wpt) => toBuilderPoint(wpt, { name: wpt.name, description: wpt.description }));
  if (builderWaypoints.length > 0) {
    builder.setWayPoints(builderWaypoints);
  }

  const builderTracks = tracks.flatMap((track) => {
    const segments = normalizeSegments(track)
      .map((segment) => segment.filter(isValidCoordinate).map((point) => toBuilderPoint(point)))
      .filter((segment) => segment.length > 0)
      .map((segment) => new Segment(segment));
    return segments.length > 0 ? [new Track(segments, { name: track.name ?? undefined })] : [];
  });
  if (builderTracks.length > 0) {
    builder.setTracks(builderTracks);
  }

  const data = builder.toObject();
  data.attributes = { ...data.attributes, creator };
  return buildGPX(data);
}

type GpxBuilderModule = typeof import('gpx-builder');
type GpxBuilderModuleShape = GpxBuilderModule & {
  default?: Partial<GpxBuilderModule>;
};

async function loadGpxBuilder(): Promise<GpxBuilderModule> {
  const module = await import('gpx-builder') as GpxBuilderModuleShape;
  const BaseBuilder = module.BaseBuilder ?? module.default?.BaseBuilder;
  const buildGPX = module.buildGPX ?? module.default?.buildGPX;
  if (!BaseBuilder || !buildGPX) {
    throw new Error(
      `gpx-builder exports unavailable. keys=${Object.keys(module).join(',')} defaultKeys=${Object.keys(module.default ?? {}).join(',')}`,
    );
  }
  return { ...module, BaseBuilder, buildGPX };
}
