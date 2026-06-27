const FULL_CIRCLE_DEGREES = 360;
const HALF_CIRCLE_DEGREES = 180;
const LONGITUDE_EPSILON = 1e-12;
// EPSG:3857 uses the WGS84 semi-major axis for both projected axes.
const WEB_MERCATOR_EARTH_RADIUS_KM = 6_378.137;

/** Maximum latitude represented by finite Web-Mercator world coordinates. */
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;

/**
 * A longitude arc travelled eastward from `west` to `east`.
 *
 * `crossesDateline` disambiguates wrapped intervals. The only full-world
 * representation is `{ west: -180, east: 180, crossesDateline: false }`.
 */
export interface DirectedLongitudeInterval {
  west: number;
  east: number;
  crossesDateline: boolean;
}

interface NumericSegment {
  start: number;
  end: number;
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Normalize a longitude to the canonical half-open interval [-180, 180). */
export function normalizeLongitude(longitude: number): number {
  if (longitude >= -180 && longitude < 180) {
    return Object.is(longitude, -0) ? 0 : longitude;
  }
  if (longitude === 180) return -180;
  const normalized = modulo(longitude + HALF_CIRCLE_DEGREES, FULL_CIRCLE_DEGREES)
    - HALF_CIRCLE_DEGREES;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function longitudeToCircle(longitude: number): number {
  return modulo(longitude, FULL_CIRCLE_DEGREES);
}

function isFullWorldInterval(interval: DirectedLongitudeInterval): boolean {
  return !interval.crossesDateline
    && interval.west === -HALF_CIRCLE_DEGREES
    && interval.east === HALF_CIRCLE_DEGREES;
}

/** Return the eastward angular width of a directed interval. */
export function longitudeIntervalSpanDegrees(
  interval: DirectedLongitudeInterval,
): number {
  if (isFullWorldInterval(interval)) return FULL_CIRCLE_DEGREES;
  if (interval.crossesDateline) {
    return interval.east - interval.west + FULL_CIRCLE_DEGREES;
  }
  return interval.east - interval.west;
}

function intervalFromCircleArc(start: number, span: number): DirectedLongitudeInterval {
  if (span >= FULL_CIRCLE_DEGREES - LONGITUDE_EPSILON) {
    return { west: -180, east: 180, crossesDateline: false };
  }

  const west = normalizeLongitude(start);
  // Computing the same negative longitude through two modulo paths can differ
  // by one floating-point ulp. Preserve a true zero-width arc explicitly so
  // that tiny rounding noise cannot turn a point into a near-full-world span.
  if (span <= LONGITUDE_EPSILON) {
    return { west, east: west, crossesDateline: false };
  }
  let east = normalizeLongitude(start + span);

  // Prefer +180 when the arc approaches the dateline from the west. This
  // keeps [170, 180] ordinary while a true [179, -179] arc remains wrapped.
  if (east === -180 && west > -180 && span <= HALF_CIRCLE_DEGREES) east = 180;

  return {
    west,
    east,
    crossesDateline: west > east,
  };
}

function compareIntervals(
  left: DirectedLongitudeInterval,
  right: DirectedLongitudeInterval,
): number {
  if (left.crossesDateline !== right.crossesDateline) {
    return left.crossesDateline ? 1 : -1;
  }
  if (left.west !== right.west) return left.west - right.west;
  return left.east - right.east;
}

function intervalSegments(interval: DirectedLongitudeInterval): NumericSegment[] {
  const span = longitudeIntervalSpanDegrees(interval);
  if (!Number.isFinite(span) || span < 0 || span > FULL_CIRCLE_DEGREES) {
    throw new RangeError('Longitude interval has an invalid directed span.');
  }
  if (span >= FULL_CIRCLE_DEGREES - LONGITUDE_EPSILON) {
    return [{ start: 0, end: FULL_CIRCLE_DEGREES }];
  }

  const start = longitudeToCircle(interval.west);
  const end = start + span;
  if (end <= FULL_CIRCLE_DEGREES) return [{ start, end }];
  return [
    { start, end: FULL_CIRCLE_DEGREES },
    { start: 0, end: end - FULL_CIRCLE_DEGREES },
  ];
}

/**
 * Return the shortest deterministic interval containing every complete input
 * arc. This operates on interval coverage, not merely on interval endpoints.
 */
export function mergeLongitudeIntervals(
  intervals: readonly DirectedLongitudeInterval[],
): DirectedLongitudeInterval | null {
  if (intervals.length === 0) return null;

  const segments = intervals
    .flatMap(intervalSegments)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: NumericSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous || segment.start > previous.end + LONGITUDE_EPSILON) {
      merged.push({ ...segment });
    } else {
      previous.end = Math.max(previous.end, segment.end);
    }
  }

  if (
    merged.length === 1
    && merged[0].start <= LONGITUDE_EPSILON
    && merged[0].end >= FULL_CIRCLE_DEGREES - LONGITUDE_EPSILON
  ) {
    return { west: -180, east: 180, crossesDateline: false };
  }

  let largestGap = -1;
  const candidates: DirectedLongitudeInterval[] = [];
  for (let index = 0; index < merged.length; index += 1) {
    const current = merged[index];
    const next = merged[(index + 1) % merged.length];
    const nextStart = index === merged.length - 1
      ? next.start + FULL_CIRCLE_DEGREES
      : next.start;
    const gap = nextStart - current.end;
    const candidate = intervalFromCircleArc(
      next.start,
      FULL_CIRCLE_DEGREES - gap,
    );
    if (gap > largestGap + LONGITUDE_EPSILON) {
      largestGap = gap;
      candidates.length = 0;
      candidates.push(candidate);
    } else if (Math.abs(gap - largestGap) <= LONGITUDE_EPSILON) {
      candidates.push(candidate);
    }
  }

  candidates.sort(compareIntervals);
  return candidates[0];
}

/** Return the shortest deterministic circular interval containing all points. */
export function shortestLongitudeInterval(
  longitudes: readonly number[],
): DirectedLongitudeInterval {
  if (longitudes.length === 0) {
    throw new RangeError('At least one longitude is required.');
  }
  const pointIntervals = longitudes.map((longitude) => {
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new RangeError('Longitude must be finite and inside [-180, 180].');
    }
    const normalized = normalizeLongitude(longitude);
    return { west: normalized, east: normalized, crossesDateline: false };
  });
  // Non-empty input always produces an interval.
  return mergeLongitudeIntervals(pointIntervals) as DirectedLongitudeInterval;
}

export function clampWebMercatorLatitude(latitude: number): number {
  return Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
}

function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function webMercatorYKm(latitude: number): number {
  const radians = degreesToRadians(clampWebMercatorLatitude(latitude));
  return WEB_MERCATOR_EARTH_RADIUS_KM * Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

/** Projected, clamped Web-Mercator footprint of geographic bounds. */
export function webMercatorSpanKm(
  bounds: DirectedLongitudeInterval & { south: number; north: number },
): { xKm: number; yKm: number } {
  const xKm = WEB_MERCATOR_EARTH_RADIUS_KM
    * degreesToRadians(longitudeIntervalSpanDegrees(bounds));
  const yKm = Math.abs(webMercatorYKm(bounds.north) - webMercatorYKm(bounds.south));
  return { xKm, yKm };
}
