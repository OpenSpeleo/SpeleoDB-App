# Offline Mode

This document defines the offline cache feature, user-facing offline modal
behavior, and online recovery guarantees.

## Goal

- Allow users with a previously valid local session to continue working when
  network connectivity is poor or unavailable.
- Never store passwords or use password entry to create a new offline session.
- Log out users and clear local data only when stored-token validation
  explicitly denies authorization (HTTP `401`/`403`).
- Keep offline UX non-blocking: user can acknowledge offline mode and keep using
  cached data.

## Startup auth timeout

- Timeout constant: `NETWORK.STARTUP_AUTH_TIMEOUT_MS = 10000` in
  `src/constants.ts` (raised from `3000` so spotty mobile networks have time to
  respond before the app falls back to offline mode).
- During startup, the app validates the stored token against the backend.
- If the request times out or fails due to transport/network/server conditions,
  the app must enter offline mode and keep the local session.
- Timeout must never trigger logout or cache clearing.
- Startup validation is attempted once per app launch when non-secret
  preferences contain `hasStoredSession: true` and an `instance`. The token is
  restored from native secure storage before React mounts; `email` is not part
  of the gate.
- While startup validation is in flight, the startup UI coordinator
  (`src/context/useStartupUiCoordinator.ts`, rendered by `SpeleoDBProvider`)
  schedules a small `Connecting to SpeleoDB…` floating card
  (`data-testid="connecting-banner"`) **after a 1s gate**, so fast networks
  never see it but slow networks get clear visual feedback that the app is still
  trying. The banner is removed as soon as `validateSession()` resolves (success
  or failure).
- The native splash (`launchAutoHide: false`, opaque `#0f172a`) is hidden at the
  same instant the banner is shown. This is non-negotiable: the splash sits
  above the React tree and would otherwise hide the banner for the entire
  timeout window. On fast networks the banner timer is cancelled and the splash
  hides only via the validation `.finally()` (single hide call). On slow
  networks the splash hides at ~1s and `.finally()` calls hide again on
  resolution; both calls are idempotent and any plugin warning is swallowed by
  `hideSplashScreenSafely`.
- The offline modal is suppressed while startup validation is still pending, so
  users see either the `Connecting to SpeleoDB…` card or the offline modal,
  never both at once.
- If logout or unmount happens while startup validation is still pending, the
  delayed banner timer is cleared and the controller cancels the in-flight
  validation context so stale completions cannot mutate startup/offline UI.

## Offline mode user experience

Offline mode is session continuity, not offline authentication. The secure token
must already have been restored at startup. A user on the login screen must
reach the selected SpeleoDB instance to establish a session; a cached or locally
entered password can never unlock offline data.

- Offline modal includes a `Go Offline` action.
- `Go Offline` means:
  - close the modal,
  - keep app in offline mode,
  - continue using cached data,
  - do not reprompt again during the same offline period.
- After user acknowledged offline mode, prompt may appear again only after
  offline lock is cleared by an explicit reconnect path and later re-entered.

## Online recovery behavior

When app is in offline mode, user-driven actions are allowed to attempt
returning online:

1. Close and reopen the app (startup validation attempt).
2. Tap **Go Online** in Settings or **Try Reconnect** on Pending Changes (both
   call `controller.attemptReconnect()`).

Both delegate a tentative reconnect flow to `SessionCoordinator` and resolve to
exactly one outcome:

- reconnect success (`2xx`): clear offline lock and resume online behavior. The
  Settings **Go Online** / Pending **Try Reconnect** path additionally launches
  a project sync; the button hides once `isOfflineLocked` is false.
- still offline (`5xx` / timeout / transport): remain offline without forced
  logout and without repeated blocking prompts. The Settings **Go Online** /
  Pending **Try Reconnect** path shows a local "Couldn't reconnect" modal and
  changes nothing.
- unauthorized (`401`/`403`): follow logout/cache purge behavior.
- inconclusive response (`400`, `404`, `408`, `409`, `425`, `429`, redirects, or
  `5xx`): remain offline without destructive logout.

Both paths are explicit and user-initiated. The app still does **not** subscribe
to passive `online`/`offline` connectivity events. `attemptReconnect()`
deliberately bypasses the offline-lock short-circuit in `validateSession()` so
it can actually probe the server while offline-locked. Reconnect validation owns
the returned result. If the best-effort follow-up project-sync launcher throws
after a successful probe, the session remains online and `attemptReconnect()`
still resolves `ok`; sync-launch failure cannot reclassify connectivity.
Concurrent manual reconnect calls are coalesced at the coordinator boundary, so
same-tick taps or overlapping UI callers share one request and can launch at
most one sync. A reconnect superseded by a newer authenticated transition may
report that current auth state to its original caller, but it is
non-authoritative and cannot start sync. Logout is stricter: it revokes the
session immediately, so a cancelled reconnect resolves `unauthorized` and can
never report stale success.

## Startup auth outcome matrix

| Condition                                                                                 | Startup result                        | Logout                            | Cache purge | UX                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------- | ----------- | -------------------------------------------------------- |
| Session metadata or secure token is missing/inconsistent                                  | No validation; bootstrap fails closed | Local session metadata is cleared | No          | Continue unauthenticated; user must log in again         |
| Restored token exists but its instance is malformed or cannot be canonically re-persisted | `unauthorized`; no request is sent    | Yes                               | Yes         | Continue unauthenticated; user must log in again         |
| Recoverable stored instance is canonically re-persisted, then transport fails             | `network_error`                       | No                                | No          | Offline modal shown; session uses the canonical origin   |
| HTTP 2xx                                                                                  | `ok`                                  | No                                | No          | Continue online                                          |
| HTTP 401/403                                                                              | `unauthorized`                        | Yes                               | Yes         | Redirect to home/login                                   |
| Any other non-2xx status                                                                  | `network_error`                       | No                                | No          | Offline modal shown (acknowledge once with `Go Offline`) |
| Timeout / transport exception                                                             | `network_error`                       | No                                | No          | Offline modal shown (acknowledge once with `Go Offline`) |

## Network behavior while offline

- Offline mode uses cached app data and cached map resources.
- Dashboard map overlays (landmarks, stations, exploration leads, cylinder
  installs) are read from cached GeoJSON when offline.
- Project survey GeoJSON is shown offline only when its active cache metadata is
  schema-v2 valid and its commit matches the cached project list's
  `latest_commit.id`. A matching-commit legacy record may be audited locally;
  unversioned legacy bytes remain hidden because offline mode cannot prove which
  server commit they represent.
- Outbound network requests should be skipped for normal offline operation
  paths.
- Landmark create/edit/delete are the exception to "read-only offline": they are
  captured as persistent offline ops, folded optimistically over the cached
  overlay, and replayed on the next sync. No outbound request is made while
  offline-locked; the op simply queues. See `docs/offline-op-queue.md`.
- GPS track recording is fully local (no network) and persists captured fixes so
  a force-quit recovers the partial local track. Track create (upload), edit,
  and delete made while offline (or that fail as retryable/unreachable) queue an
  `OfflineOp` in the same queue as landmarks and replay from the **Pending**
  page (no GPS-specific auto-drain). An averaged point saved as a landmark while
  offline queues a normal `CreateLandmarkOp`. See `docs/gps-tracks.md` and
  `docs/offline-op-queue.md`.
- Explicit reconnect attempts are limited to the app relaunch recovery path, the
  Settings **Go Online** button, and the Pending Changes **Try Reconnect**
  button above.
- The Settings **Resync** button calls `syncProjects()` only and is disabled
  while offline-locked. It does not attempt offline reconnect.
- The app does not use passive `online`/`offline` browser listeners.
  Connectivity changes alone do not trigger reconnect or modal state changes.

## Runtime offline transition (online -> offline)

The app can flip from online to offline at runtime, request-driven (never via a
passive listener):

- A **Resync** runs only while online. If its project-list refresh cannot reach
  the server -- a timeout, transport error, or `5xx` (any non-`4xx`, non-`2xx`
  status) -- the controller calls `enterOfflineMode()`: `isOnline` becomes
  false, the offline lock is set, the normal offline modal is shown, and the
  Settings **Go Online** button is revealed. Cached data is preserved and no
  logout occurs.
- A `4xx` during a data fetch never flips offline and never logs out. Stored-
  session `validateSession()` is the only status-driven destructive boundary,
  and only `401`/`403` prove authorization denial; see `docs/networking.md`.
- `enterOfflineMode()` is idempotent (a no-op when already offline-locked) so
  repeated failures do not thrash UI state. Aborted (superseded/logged-out)
  refreshes do not flip offline.

## Logout and data purge

Logout and wipe policy is documented in `docs/logout-behavior.md`. In offline
mode flows, local data must only be purged on explicit authentication denial
(`401`/`403`).

## Source code map

- Startup UI coordination: `src/context/useStartupUiCoordinator.ts`
- React provider bridge: `src/context/SpeleoDBProvider.tsx`
- Auth decision logic and session connectivity state:
  `src/controllers/SessionCoordinator.ts`
- Manual reconnect façade + runtime offline transition:
  `SpeleoDBController.attemptReconnect()` and the coordinator hook wired into
  `refreshProjectsPhase`
- Reconnect UI (Go Online button + "Couldn't reconnect" modal):
  `src/pages/Settings.tsx`
- Timeout/transport behavior: `src/services/HttpClient.ts`
- Auth API call: `src/services/SpeleoDBService.ts`
- Logout policy detail: `docs/logout-behavior.md`
- Networking state model: `docs/networking.md`
- Architecture and style expectations: `docs/implementation-guidelines.md`
- Map/tile offline fetch behavior: `src/services/TileCacheService.ts`
- Tile orchestration, consent, and layer settings:
  `src/controllers/TileCoordinator.ts`
- Offline-map engine and live store: `src/services/OfflineMapSyncEngine.ts`,
  `src/services/OfflineMapSyncStore.ts`
- Canonical planning worker: `src/services/OfflineMapPlanner.ts`
- Overlay contract and icon mapping: `docs/dashboard-map-overlays.md`

## Offline tile pre-caching

The authoritative cache/read/storage design is in
`docs/tile-cache-architecture.md`.

During `syncProjects()`, after project/overlay/GPS data is cached,
`TileCoordinator.scheduleSyncPhase` builds one layer-independent coordinate plan
and schedules it in `speleo_tiles` so the map renders offline:

- Projects: persisted, validated survey bounds are unioned into the plan. Raw
  project GeoJSON never enters the tile planner. Oversized/invalid/slow files
  are quarantined per commit and their jobs are cancelled; see
  `docs/project-geojson-validation.md`.
- Landmarks and stations: independently padded points are unioned without a
  world-spanning bounding box.
- GPS tracks: durable local and SHA-identified server paths are planned along
  their segments rather than a world-scale bounding box.
- Zoom/pad policy lives in `TILE_PREFETCH` in `src/constants.ts` (projects and
  landmarks both use zoom 0-18, 50 m pad).
- The reusable collector that turns validated project bounds or landmark points
  plus a zoom range into `{z,x,y}` tile URLs is
  `src/services/tilePrefetchPlanner.ts` (`buildTileUrlsForProjectBounds`,
  `extractPointCoordinates`, `buildTileUrlsForPoints`,
  `computeTilePrefetchSignature`). Tiles are deduped by URL across all jobs, so
  shared low-zoom and overlapping dateline ranges download once. Project bounds
  retain their directed antimeridian interval, padding is applied in meters, and
  latitude is clamped to Web Mercator before tile conversion.
- The combined source revision is stable, so an unchanged coordinate plan is
  loaded with one manifest read; enabling a layer reuses it without replanning.
- Replacement collection fails closed. Matching validated project records, valid
  empty overlays, and matching current quarantines are resolved inputs;
  transient reads, missing current commits, invalid/missing overlays, absent
  SHA-256, or unavailable current-SHA GPS geometry abort replacement and retain
  every active generation. Legacy GPS geometry remains usable for ordinary map
  display but is not accepted as current planning input.

Legacy project GeoJSON cache entries with a matching stored commit are
bbox-audited even while offline before Dashboard reads them. Unversioned legacy
bytes are fail-closed and never assigned to the current commit; only an online
2xx download of the canonical commit can replace them. This lazy metadata
migration uses schema version 2 inside the existing `geojson` store and does not
bump the cache database version.

GeoJSON sync counters intentionally overlap. A 2xx response counts as downloaded
even if validation later rejects it; only newly accepted persisted records count
as validated; durable/session-disabled dispositions count as quarantined; reused
or offline-blocked dispositions count as skipped; and any project that finishes
unusable counts as failed. See `docs/project-geojson-validation.md` for
examples.

### Multi-layer synchronization (satellite first)

The dedicated worker packs and deduplicates coordinates in memory, rejects more
than 1,000,000 unique tiles, sorts the final keys, and transfers at most 2,048
final coordinates per acknowledged IndexedDB plan-chunk write. It commits the
manifest only after every compact chunk is durable. The immutable count `N` is
expanded satellite first, followed by opted-in layers. Expected coverage is
exactly `N * enabled layer count`; the denominator never comes from partial
work. The additive v8 schema preserves existing payloads, metadata, v7 plans,
generations, and memberships; legacy coordinate staging is cleared during
recovery. Its incremental v6 migration retains URL-keyed payloads and treats
unknown fetch dates as fresh from migration time. Disabling an optional layer
cancels the current session, releases the layer, then evicts its namespace and
resumes remaining layers from the active plan; a release failure never evicts
payloads.

Changed or quarantined geometry creates a replacement plan revision. Prior
active generations remain usable until replacement succeeds; failed or aborted
work releases only its pending generation.

The known satellite-only magic hash is configured through
`MapLayerDefinition.noDataSha256Hashes`. A match is an authoritative missing
answer: raster bytes are never cached and a zero-byte, freshness-aware tombstone
is persisted instead. Both hillshade hash lists are empty until independently
verified. The tombstone renders as missing offline and counts as completed
prefetch work. HTTP errors, invalid content types, empty bodies, and unavailable
configured hashing remain failures and never create tombstones.

Sixteen-coordinate cache audits feed six network workers. The backpressured
pipeline has at most 64 outstanding coordinates; retry delays do not occupy
workers and only transport errors, 408, 429, and 5xx retry. One 10-second
deadline covers response headers, body, validation, hashing, and cancellation.
Every audit/commit/failure transition updates the dedicated snapshot and reaches
React by the next paint or 50 ms fallback; one-second durable checkpoints never
gate dispatch or call the global controller observer.

### Tile cache cap and user-approved overflow

All generation-owned tiles are pinned and share a single 500 MB cap
(`MAP.TILE_CACHE_MAX_BYTES`). Pinned tiles are not evictable, so a large set can
reach the cap. Rather than silently failing, the cache raises
`TileCacheCapacityError`, `OfflineMapSyncEngine` pauses the queue once, and
`TileCoordinator` surfaces a **one-time, persistent** consent prompt through the
controller façade:

- The auto prompt appears exactly once; "Allow more storage" and "Not now" both
  persist `tileCacheOverLimitPromptAcknowledged` (gated so it never
  auto-reappears across app starts).
- "Allow more storage" persists `tileCacheOverLimitApproved`, lifts the cap only
  for generation-owned writes, and resumes the preserved six-worker queue.
- Settings shows a tappable over-limit warning to re-open the prompt manually,
  and a Revoke action once approved.
- Both flags live in `PreferencesService` and are cleared on logout. Offline
  best-effort runtime caching (`upsertTileBestEffort`) is unaffected and stays
  within the cap.
- Mutual exclusivity is one-directional and safe: the consent modal is never
  shown alongside the offline, companion-info, or project-GeoJSON warning
  modals. If a higher-priority modal takes the slot while consent is open, the
  coordinator flags `storageConsentSuppressedByGate` and the modal's
  `onDidDismiss` does **not** acknowledge in that window, so a gating-driven
  close cannot silently opt the user out of the one-time prompt; consent
  re-shows when the gate clears. Only a genuine user dismissal (button, gesture,
  controlled close after a choice) acknowledges.
- Diagnostic: `isTileCacheOverLimit` intentionally returns false once approved
  (the Settings warning disappears). `TileCoordinator` logs one bounded warning
  if the engine remains blocked after approval.
- Caveat (known, by design): once approved, pinned prefetch may exceed the cap
  **without an upper bound**. For a globally-scattered landmark set at zoom 0-18
  this can reach multiple GB. A bounded guardrail (lower landmark `maxZoom`
  and/or a max-tiles ceiling in `TILE_PREFETCH.LANDMARK_REQUEST`) is a tracked
  follow-up pending product sign-off; the current behavior preserves zoom/pad
  parity with project prefetch.
- Key tests:
  - `src/controllers/SpeleoDBController.test.ts`
  - `src/context/SpeleoDBProvider.test.tsx`
  - `src/pages/Dashboard.test.tsx`
  - `src/services/ProjectCacheService.test.ts`
  - `src/services/TileCacheService.test.ts`
  - `src/services/OfflineMapSyncEngine.test.ts`
  - `src/services/OfflineMapSyncEngine.repository.test.ts`
  - `src/services/OfflineMapPlanner.test.ts`
  - `src/services/MapLayersService.test.ts`
  - `src/services/tileCache/TileCacheRepository.test.ts`
  - `src/components/map/MapLayerControl.test.tsx`

### Startup modal arbitration

Only one startup modal is effective at a time, in this order: offline/auth gate,
companion onboarding, project-GeoJSON warning, storage consent. A
higher-priority controlled close is suppression, not acknowledgement. In
particular, the GeoJSON safety warning rejects backdrop, escape/back, gesture,
and uncontrolled programmatic dismissal; it closes only when acknowledgement
succeeds, recovery removes the warning, or a higher-priority gate temporarily
owns the slot. Failed acknowledgement remains visible with an inline error and
can be retried. This arbitration must be tested through coordinator inputs and
real modal callbacks rather than by asserting independent booleans.

### Verification boundary

Web/native builds and Capacitor sync confirm that assets and types compile, but
they do not prove mobile-WebView behavior. Physical Android and iOS checks still
cover worker responsiveness, device-console diagnostics, tile-network
suppression after removal, warning non-dismissal, IndexedDB persistence across
force-quit/offline startup, and recovery after a newer server commit.

Runtime tile and style caching returns before its best-effort IndexedDB write
finishes. Tests for that path wait for metadata and cache-stat accounting, which
are the final durable effects of the transaction. Observing the tile payload
alone is insufficient: it can become readable while metadata and statistics are
still pending, allowing that work to leak into the next test and making branch
coverage depend on test order. The shared test setup also installs a fresh fake
IndexedDB factory for each file, preventing persisted jobs or open connections
from crossing Vitest's serialized file boundary.

## Change checklist (offline/auth)

When modifying auth/offline logic:

1. Verify timeout and network failures do not call `logout()`.
2. Verify only `401`/`403` stored-session validation failures trigger cache
   purge.
3. Verify modal can be acknowledged with `Go Offline` and is not repeatedly
   re-shown in same offline period.
4. Verify the only reconnect paths while offline are app relaunch and the
   Settings `Go Online` button (`attemptReconnect()`); no passive
   `online`/`offline` listeners.
5. Verify a failed Resync (timeout / transport / 5xx) flips the app offline,
   while a `4xx` does not.
6. Run targeted tests for controller, provider, dashboard, settings, tile cache,
   and tile prefetch paths.
7. Update this document if any behavior changes.
