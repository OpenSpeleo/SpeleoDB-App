# Networking Behavior

This document defines how network state is handled in the app and what is intentionally *not* observed.

## Design intent

- Networking must be deterministic and user-driven.
- The app must not auto-switch state just because the device toggles Wi-Fi/cellular (no passive listeners).
- State transitions are request-driven: they only happen as a result of an explicit, user-initiated network operation (startup validation, a Resync, or the Go Online reconnect) actually failing or succeeding against the server.
- Offline users must keep local session and cached data unless auth is definitively invalid (`4xx`).

## No passive listeners

- The app does **not** subscribe to `window` `online`/`offline` events.
- The app does **not** run automatic reconnect attempts when the OS reports connectivity changes.
- Returning to Wi-Fi by itself must not reopen offline prompts or trigger sync.

## Allowed reconnect triggers

Explicit, user-initiated actions may attempt to return online from offline mode:

1. Close and reopen the app (startup validation flow).
2. Tap **Go Online** in Settings or **Try Reconnect** on Pending Changes. Both call `controller.attemptReconnect()` (an in-process reconnect that probes the server via `validateSessionAgainstServer()`, then launches a sync on success).

If none of these actions occurs, the app remains in offline behavior even if device connectivity changes. The Settings **Resync** button calls `syncProjects()` only, is disabled while offline-locked, and never performs a reconnect.

## Offline-entry triggers (online -> offline)

The app enters offline mode only as a result of a failed server probe, never from a passive connectivity event:

1. Startup token validation returns a timeout / transport error / non-`4xx` status.
2. A user-initiated **Resync** whose project-list refresh hits a timeout / transport error / `5xx`. The controller calls `enterOfflineMode()` (idempotent), shows the normal offline modal, and reveals the Go Online button. A `4xx` does not flip offline and does not log out (only startup validation acts on `4xx`).

## Startup connectivity feedback

- `SpeleoDBStartupGate` must mount at the app root via `SpeleoDBProvider`, not inside lazy authenticated routes. Cold start loads `/` or `/login` before the dashboard shell exists; if startup UI only lived in `AuthenticatedAppShell`, `SplashScreen.hide()` and the stored-session redirect to `/dashboard` would never run. The gate keeps splash dismissal and validation in the main graph; heavier Ionic modals load lazily from `SpeleoDBStartupModals`.
- Startup validation uses `NETWORK.STARTUP_AUTH_TIMEOUT_MS` (10s) so spotty networks get a fair attempt before falling back to offline.
- When validation is still pending after a 1s gate, the startup UI coordinator (`src/context/useStartupUiCoordinator.ts`) renders a small `Connecting to SpeleoDB…` banner (`data-testid="connecting-banner"`). This is purely visual feedback; it does not change networking state, retry, or trigger any side effects.
- The banner is removed when validation resolves. On a fast network it never appears.
- **The native splash must hide the moment the banner appears.** Capacitor's splash is configured `launchAutoHide: false` with an opaque background, so it sits above React until `SplashScreen.hide()` runs. If the splash is left up until validation resolves, the banner is rendered behind it and the user sees nothing for the full timeout — defeating the purpose of the feature. The startup UI coordinator therefore calls `hideSplashScreenSafely('connecting banner shown')` from inside the 1s gate's setTimeout callback, in addition to the existing call in the validation `.finally()`. Both calls are idempotent at the plugin level.
- The offline modal is gated until startup validation finishes, so the banner and offline modal never overlap.
- Logout or unmount clears the delayed banner timer. The controller aborts the in-flight validation context and the startup UI coordinator drops the stale completion, so old startup work cannot re-open prompts after logout.

## Offline modal contract

- Offline modal visibility is driven by controller offline lock state (`isOfflineLocked`).
- `Go Offline` acknowledges the modal for the current offline-lock period.
- The modal can appear again only after offline lock clears and is later re-entered.

## Request gating while offline

- During offline lock, normal data/map fetch paths should skip outbound network and use cache.
- This includes dashboard project GeoJSON and read-only overlay GeoJSON (landmarks, stations, exploration leads, cylinder installs).
- Map tile-layer selection is gated offline: only the forced satellite layer and layers the user has synced for offline use are selectable while offline-locked (others have no cached tiles). See `docs/map-layers.md`.
- Reconnect attempts are explicit and limited to the app relaunch trigger and the Settings Go Online button above.
- Transport errors/timeouts remain non-destructive (no logout, no cache purge); they flip the app to offline mode (preserving session and cache) rather than wiping data.

## Auth and logout

- `4xx` from auth validation means token/session is invalid and must trigger logout + local purge.
- Network errors, timeouts, and non-`4xx` failures must preserve session and local cache.
- Logout invalidates and cancels in-flight startup/sync work before cache purge, so stale validation or sync completions cannot re-lock offline mode or repopulate cache after logout.

## API contract (v2)

All `/api/v2/*` endpoints return the raw payload on success and a flat error object on failure. The legacy v1 envelope (`data`, `success`, `timestamp`, `url`) is no longer present and must not be parsed.

- Success bodies (status `2xx`):
  - `GET /api/v2/projects/geojson/` -> `Project[]`
  - `GET /api/v2/landmarks/geojson/`, `stations/{subsurface,surface}/geojson/`, `exploration-leads/geojson/`, `cylinder-installs/geojson/` -> `GeoJSON.FeatureCollection`
  - `POST /api/v2/user/auth-token/` -> `{ user, token }`
  - `GET /api/v2/user/auth-token/` (validate) -> `2xx` with arbitrary body (treated as opaque)
- Error bodies (status `4xx` / `5xx`): flat object such as `{ detail: '...' }`, `{ message: '...' }`, or `{ errors: { non_field_errors: ['...'] } }`. The same fields existed under v1 alongside the envelope; only the envelope was removed.

Implementation notes:

- `SpeleoDBService` returns `HttpResponse<T>` where `T` is the raw v2 payload (no wrapper).
- `SpeleoDBController.login` treats any `2xx` auth response with a token body as success; malformed `2xx` auth payloads fall back to normal error handling instead of creating a partial session.
- `SpeleoDBController.syncProjects` is split into explicit phases: cache load, project-list refresh, project GeoJSON sync, overlay sync, and tile-prefetch scheduling. It treats only `2xx + Project[]` as the project-list success path. `2xx + []` is a valid empty refresh and replaces stale cached projects; non-array `2xx` payloads are malformed and are treated like failed refreshes. Failed refreshes preserve cache, skip later phase side-effects, and set `syncStatus` to `'error'` only when no cached projects are available, otherwise `'done'`. A 4xx during data fetch never triggers logout — only `validateSession` does.
- Background GeoJSON cache writes validate the downloaded body before persisting it. Non-`2xx` or malformed GeoJSON payloads are skipped so stale cache is preserved instead of being overwritten with garbage.
- Service/cache IO now accepts cancellation signals from controller-owned run contexts. Web `fetch` aborts transport immediately; native requests are best-effort at the transport level but still must not publish stale state or cache writes after abort/logout.
- Login error parsing in `SpeleoDBController.login` reads `detail` / `message` / `errors.non_field_errors` directly off `response.data` (already v2-shaped).
- Endpoint URLs and the v2 base path live in `src/constants.ts` (`API.BASE_PATH = '/api/v2'`).

## Implementation expectations

- Treat controller offline lock as the authoritative network gate for app behavior.
- Keep reconnect logic explicit and initiated only from documented triggers.
- Follow code architecture and testing conventions in `docs/implementation-guidelines.md`.

## Landmark mutations and the offline queue

Landmark create/edit/delete are request-driven like everything else. A mutation
that hits a transport error, timeout, or 5xx is treated as "not reachable" and
enqueued as a persistent offline op (a 4xx is a definitive answer and is surfaced
to the user, not queued). Replaying the queue is a side-effect of an explicit,
user-initiated action (the Pending page's Sync Now / per-row Sync, or a
controller sync); it never runs from a passive connectivity listener. See
`docs/offline-landmark-queue.md`.

## GPS track uploads and the offline drain

GPS track uploads follow the same request-driven model as landmark mutations. An
upload that hits a transport error, timeout, `408`, `429`, or `5xx` marks the
track `pending` (never dropped); reachability failures also flip the app offline
(`enterOfflineMode`). A definitive `4xx` is surfaced as an `error`. Pending
track uploads are drained by `SpeleoDBController.uploadPendingGpsTracks()`, which
is wired into successful startup validation and the explicit reconnect path
(`attemptReconnect()` -> Settings **Go Online** / Pending **Try Reconnect**). It
never runs from a passive connectivity listener. Only tracks already marked
`pending` drain automatically; untouched `local` tracks require an explicit
Upload tap. Recording itself makes no network calls. See `docs/gps-tracks.md`.

See also:

- `docs/offline-mode.md`
- `docs/offline-landmark-queue.md`
- `docs/gps-tracks.md`
- `docs/logout-behavior.md`
- `docs/implementation-guidelines.md`
- `docs/dashboard-map-overlays.md`
