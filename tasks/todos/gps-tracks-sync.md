# GPS Tracks: Server Sync, Map Display & Unified Offline Mutations

Bring `map_viewer`'s GPS-track behavior to the app: one unified list of local +
server tracks, live recording line, default-OFF per-track map display, server
sync at launch/refresh, and offline create/edit/delete routed through the SAME
offline op queue + Pending page used by landmarks.

Feature docs: `docs/gps-tracks.md`, `docs/offline-op-queue.md`.

## Plan checklist

- [x] Types + constants: `RemoteGpsTrack`, unified `GpsTrackListItem`, `color`
      on `LocalGpsTrack` (drop `uploadStatus`); `gpsTrackDetailEndpoint` +
      `GPS.TRACK_COLOR_PALETTE`; `gpsTrackColors.ts`, `remoteGpsTrack.ts`,
      `gpsTrackGeoJsonToPoints`.
- [x] `SpeleoDBService`: `getGpsTracks` / `updateGpsTrack` / `deleteGpsTrack`.
- [x] `ProjectCacheService`: `gps-tracks` list cache + `gps-track:<id>` geojson
      cache (reuse `projects`/`geojson` stores — no IndexedDB bump).
- [x] Generalize the offline op queue to be entity-aware
      (`landmark | gpsTrack`): `CreateGpsTrackOp` / `UpdateGpsTrackOp` /
      `DeleteGpsTrackOp`, `gpsTrackSnapshot.ts`, `foldGpsTracks`,
      `gpsPendingBySubject`, GPS replay port, generic conflict modal
      (`entityLabel`). Reused landmark machinery.
- [x] Controller: unified `gpsTracks` fold, route upload(create)/edit/delete
      through the queue, `syncGpsTracks` + `syncGpsTracksPhase`,
      `getGpsTrackGeoJSON`/`getGpsTrackPoints`, delete-local-then-resync on
      confirmed upload; remove the old `uploadStatus` drain.
- [x] `PreferencesService`: `gpsTrackVisibility` map (default OFF).
- [x] Dashboard: per-track visibility toggle + lazy remote geometry load, shared
      dotted `gps-tracks-line` (data-driven color), Edit (name+color) modal,
      Delete confirmation; keep the live recording line.
- [x] `GpsPanel`: unified rows (local/remote badge, visibility toggle, derived
      pending chip, Share/Upload/Edit/Delete; solid button variants).
- [x] Tests across queue, gps ops, snapshot, service, cache, preferences,
      controller, GpsPanel, Dashboard, PendingOps.
- [x] Docs: rewrite `docs/gps-tracks.md`; generalize the offline doc to
      `docs/offline-op-queue.md` as THE canonical pattern; update README /
      networking / offline-mode.

## Decisions

- **One queue, one pattern.** Every track mutation is an `OfflineOp` on the same
  queue as landmarks and shows on the Pending page (per the explicit directive).
  No GPS-specific offline mechanism. The old per-track `uploadStatus` field and
  `uploadPendingGpsTracks()` auto-drain were removed.
- **Uniform drain.** Pending GPS ops sync from the Pending page like landmarks;
  reconnect refreshes data but does not auto-replay the queue.
- **Per-track visibility persists, default OFF** (missing key ⇒ hidden — the
  opposite of projects/landmarks).
- **No IndexedDB migration** — reuse `gps_tracks`, `projects`, `geojson`,
  `offline_ops` stores.

## Review

- `tsc --noEmit` clean; ESLint clean; `npm run build` succeeds.
- 1247 unit tests pass (only the network `*.integration.test.ts` suites fail
  offline, which is environmental and pre-existing).
- Button rule honored: `app-btn[^"]*bg-` returns zero matches in `src/**/*.tsx`.
