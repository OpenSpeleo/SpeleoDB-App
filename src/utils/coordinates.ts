/**
 * Shared latitude/longitude validation. A single source of truth so the GPX
 * builder, the GeoJSON builder, and the track-stats math all agree on what a
 * "valid" coordinate is -- otherwise distance/export/render can silently
 * disagree about which points count.
 */

/** True when latitude/longitude are finite and within WGS-84 bounds. */
export function isValidLatLng(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
