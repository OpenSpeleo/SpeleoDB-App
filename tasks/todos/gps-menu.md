# GPS Menu

Add a GPS tab to the left of "Map" for recording GPS tracks, exporting/sharing
them as GPX, uploading to SpeleoDB, and collecting high-confidence averaged
points saved as landmarks. Offline-first throughout.

Feature doc: `docs/gps-tracks.md`.

## Plan checklist

- [x] Add `@capacitor/filesystem`; add GPS/API constants and `gpsTrack` types.
- [x] Pure utils: `gpx.ts` (build/parse), `gpsAveraging.ts` (inverse-variance
      mean + confidence), `gpsTrackStats.ts` (haversine/distance/duration),
      `formatAccuracyValue` in `measurementUnits.ts` — all unit-tested.
- [x] `HttpClient` native multipart support + `SpeleoDBService.uploadGpx`
      (`PUT /api/v2/import/gpx/`).
- [x] `gps_tracks` IndexedDB store (CacheStore v3 additive migration) +
      `GpsTrackStore` + `GeolocationWatcher`; cleared on logout.
- [x] Controller: recording lifecycle (force-quit-safe incremental persist),
      rename/delete, `uploadGpsTrack` (offline-first classification),
      `uploadPendingGpsTracks` drained on reconnect, exposed via context.
- [x] `GpxFileService` (Filesystem write + Share for export; web download
      fallback).
- [x] `GpsPanel` + `GpsAveragingModal` (+ `useGpsAveraging` hook); averaged save
      reuses `LandmarkFormModal` + `controller.createLandmark`.
- [x] `AppTabBar` GPS tab (left of Map) + recording dot; `AuthenticatedAppShell`
      mutually-exclusive panel; Dashboard renders panel, live track line,
      averaging + rename modals.
- [x] Docs: `gps-tracks.md` (new) + README/app-permissions/networking/
      offline-mode/offline-landmark-queue updates.
- [x] Tests across pure utils, services, controller (incl. chaos), hook, and UI.

## Decisions

- **GPX sharing**: use the standard OS share sheet only. No app-specific
  shortcut or direct device transfer.
- **Offline model**: reuse the landmark offline queue for averaged points; track
  uploads use a per-track `uploadStatus` drained on the explicit reconnect path.
- **Recording scope**: foreground-only in v1 (background location is a tracked
  follow-up).

## Review

- All targeted unit/component/controller tests pass; `tsc --noEmit` clean.
- Native multipart upload closes the `HttpClient` FormData-on-native gap.
- Force-quit mid-recording recovers captured points (incremental persistence).
- Button rule honored: every `.app-btn` carries a solid variant (guarded by a
  test in `GpsPanel.test.tsx`).
