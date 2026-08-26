# Networking Behavior

This document defines how network state is handled in the app and what is
intentionally _not_ observed.

## Design intent

- Networking must be deterministic and user-driven.
- The app must not auto-switch state just because the device toggles
  Wi-Fi/cellular (no passive listeners).
- State transitions are request-driven: they only happen as a result of an
  explicit, user-initiated network operation (startup validation, a Resync, or
  the Go Online reconnect) actually failing or succeeding against the server.
- Offline users must keep local session and cached data unless auth is
  definitively denied (`401`/`403`). Other client responses are inconclusive and
  must not trigger destructive logout.

## No passive listeners

- The app does **not** subscribe to `window` `online`/`offline` events.
- The app does **not** run automatic reconnect attempts when the OS reports
  connectivity changes.
- Returning to Wi-Fi by itself must not reopen offline prompts or trigger sync.

## Allowed reconnect triggers

Explicit, user-initiated actions may attempt to return online from offline mode:

1. Close and reopen the app (startup validation flow).
2. Tap **Go Online** in Settings or **Try Reconnect** on Pending Changes. Both
   call `controller.attemptReconnect()`, which delegates the explicit probe to
   `SessionCoordinator` and launches a sync through an injected lifecycle hook
   only after authoritative validation succeeds. Concurrent calls share one
   probe and one result; a probe superseded by login, logout, or another
   validation cannot launch reconnect sync.

If none of these actions occurs, the app remains in offline behavior even if
device connectivity changes. The Settings **Resync** button calls
`syncProjects()` only, is disabled while offline-locked, and never performs a
reconnect.

## Offline-entry triggers (online -> offline)

The app enters offline mode only as a result of a failed server probe, never
from a passive connectivity event:

1. Startup token validation returns a timeout, transport error, or any status
   other than `2xx`, `401`, or `403`.
2. A user-initiated **Resync** whose project-list refresh hits a timeout /
   transport error / `5xx`. The controller calls `enterOfflineMode()`
   (idempotent), shows the normal offline modal, and reveals the Go Online
   button. A `4xx` data response does not flip offline and does not log out;
   only stored-session validation may act destructively, and only on
   `401`/`403`.

## Startup connectivity feedback

- `SpeleoDBStartupGate` must mount at the app root via `SpeleoDBProvider`, not
  inside lazy authenticated routes. Cold start loads `/` or `/login` before the
  dashboard shell exists; if startup UI only lived in `AuthenticatedAppShell`,
  `SplashScreen.hide()` and the stored-session redirect to `/dashboard` would
  never run. The gate keeps splash dismissal and validation in the main graph;
  heavier Ionic modals load lazily from `SpeleoDBStartupModals`.
- Startup validation uses `NETWORK.STARTUP_AUTH_TIMEOUT_MS` (10s) so spotty
  networks get a fair attempt before falling back to offline.
- An unreadable in-process secure-session snapshot fails closed as
  `unauthorized` without transport and invokes destructive local-data cleanup.
  The startup UI also catches unexpected validation rejections, routes to login,
  and always completes splash/banner cleanup.
- When validation is still pending after a 1s gate, the startup UI coordinator
  (`src/context/useStartupUiCoordinator.ts`) renders a small
  `Connecting to SpeleoDB…` banner (`data-testid="connecting-banner"`). This is
  purely visual feedback; it does not change networking state, retry, or trigger
  any side effects.
- The banner is removed when validation resolves. On a fast network it never
  appears.
- **The native splash must hide the moment the banner appears.** Capacitor's
  splash is configured `launchAutoHide: false` with an opaque background, so it
  sits above React until `SplashScreen.hide()` runs. If the splash is left up
  until validation resolves, the banner is rendered behind it and the user sees
  nothing for the full timeout — defeating the purpose of the feature. The
  startup UI coordinator therefore calls
  `hideSplashScreenSafely('connecting banner shown')` from inside the 1s gate's
  setTimeout callback, in addition to the existing call in the validation
  `.finally()`. Both calls are idempotent at the plugin level.
- The offline modal is gated until startup validation finishes, so the banner
  and offline modal never overlap.
- Logout or unmount clears the delayed banner timer. The controller aborts the
  in-flight validation context and the startup UI coordinator drops the stale
  completion, so old startup work cannot re-open prompts after logout.

## Offline modal contract

- Offline modal visibility is driven by controller offline lock state
  (`isOfflineLocked`).
- `Go Offline` acknowledges the modal for the current offline-lock period.
- The modal can appear again only after offline lock clears and is later
  re-entered.

## Request gating while offline

- During offline lock, normal data/map fetch paths should skip outbound network
  and use cache.
- This includes dashboard project GeoJSON and read-only overlay GeoJSON
  (landmarks, stations, exploration leads, cylinder installs).
- Map tile-layer selection is gated offline: only the forced satellite layer and
  layers the user has synced for offline use are selectable while offline-locked
  (others have no cached tiles). See `docs/map-layers.md`.
- Reconnect attempts are explicit and limited to the app relaunch trigger and
  the Settings Go Online button above.
- Transport errors/timeouts remain non-destructive (no logout, no cache purge);
  they flip the app to offline mode (preserving session and cache) rather than
  wiping data.

## Auth and logout

- A user-supplied OAuth token is persisted only after
  `GET /api/v2/user/auth-token/` returns `2xx`, and is committed to native
  secure storage before non-secret session metadata is updated. A `4xx`,
  timeout, transport error, storage failure, or other server failure leaves the
  app on the login page without creating an offline session.
- Password and token transports both receive coordinator-owned cancellation
  signals. The newest accepted login supersedes older login and startup-
  validation work; stale responses cannot publish state or begin a durable
  session write.
- Secure-session mutations are serialized independently of transport work. If
  cancellation arrives while the platform vault cannot be interrupted, the
  completed token/metadata mutation is rolled back before the next mutation or
  logout purge proceeds.
- Pre-login token validation failure does not purge local data. It never
  established a session, so it returns a form error rather than calling the
  stored-session logout path.
- `SessionCoordinator` is the sole owner of auth-validation outcome policy and
  online/offline state transitions; `SpeleoDBController` remains the UI façade.
- Controller-wide operation invalidation is a required pre-commit gate for a new
  account/session; failure prevents credential storage. Runtime adapters and
  subscribers observe later session/connectivity publication but do not own its
  result. Their exceptions cannot turn a committed login or successful
  validation into a reported failure/offline transition.
- `401`/`403` from stored-session validation explicitly deny authorization and
  trigger logout plus local purge.
- Network errors, timeouts, redirects, server errors, and inconclusive client
  responses such as `400`, `404`, `408`, `409`, `425`, or `429` preserve the
  session and local cache by entering offline lock.
- Logout first closes the login/validation admission gate, cancels in-flight
  authentication/startup work, and revokes the published session snapshot. It
  then waits for authentication and any secure-store rollback before cache
  purge, so stale completions cannot authenticate, report online success,
  re-lock offline mode, or repopulate durable state after logout.

## HTTPS and redirects

- Production API and download requests must use absolute HTTPS URLs. Remote
  `http://` instance input is upgraded; development HTTP is limited to loopback.
- SpeleoDB instance input is an origin only. Paths, queries, and fragments are
  rejected before authentication because API endpoints are fixed absolute paths
  under `/api/v2`; accepted origins are canonicalized before use/storage.
- URL userinfo (`https://user:pass@host`) and non-HTTP schemes are rejected.
- Requests carrying authorization/cookies or any body disable automatic
  redirects in fetch and CapacitorHttp. This prevents credential and payload
  replay to same-origin or cross-origin redirect targets.
- Node-backed web transport identifies SpeleoDB API requests as `SpeleoDB-Web`.
  Browsers retain their browser-managed user agent, while native transport uses
  the platform-specific `SpeleoDB-iOS` or `SpeleoDB-Android` identity. Test-only
  identities must not be sent to production edge security because they can be
  classified as automated traffic before the request reaches the API.
- External account links apply the same HTTPS/userinfo policy before opening a
  browser surface.

## API contract (v2)

All `/api/v2/*` endpoints return the raw payload on success and a flat error
object on failure. The legacy v1 envelope (`data`, `success`, `timestamp`,
`url`) is no longer present and must not be parsed.

- Success bodies (status `2xx`):
  - `GET /api/v2/projects/geojson/` -> `Project[]`
  - `GET /api/v2/landmarks/geojson/`, `stations/{subsurface,surface}/geojson/`,
    `exploration-leads/geojson/`, `cylinder-installs/geojson/` ->
    `GeoJSON.FeatureCollection`
  - `POST /api/v2/user/auth-token/` -> `{ user, token }`
  - `GET /api/v2/user/auth-token/` (validate a stored or user-supplied token) ->
    `2xx` with arbitrary body (treated as opaque)
- Error bodies (status `4xx` / `5xx`): flat object such as `{ detail: '...' }`,
  `{ message: '...' }`, or `{ errors: { non_field_errors: ['...'] } }`. The same
  fields existed under v1 alongside the envelope; only the envelope was removed.

Implementation notes:

- `SpeleoDBService` returns `HttpResponse<T>` where `T` is the raw v2 payload
  (no wrapper).
- `SpeleoDBController.login` treats any `2xx` auth response with a token body as
  success; malformed `2xx` auth payloads fall back to normal error handling
  instead of creating a partial session.
- `SpeleoDBController.syncProjects` is a stable façade over
  `ProjectSyncCoordinator`, which orders cache load, project-list refresh,
  project GeoJSON, overlay, GPS refresh, and tile-prefetch phases. It treats
  only `2xx + Project[]` as project-list success. `2xx + []` replaces stale
  cache; malformed `2xx` and failed refreshes preserve cache and skip unsafe
  downstream side effects. A `4xx` data fetch never logs out; only stored-
  session validation owns that decision, and only `401`/`403` prove denial.
- Background GeoJSON cache writes validate the downloaded body before persisting
  it. Non-`2xx` or malformed GeoJSON payloads are skipped so stale cache is
  preserved instead of being overwritten with garbage.
- Service/cache IO accepts cancellation signals from coordinator-owned run
  contexts. Web `fetch` aborts transport immediately; native requests are
  best-effort at transport level but cannot publish stale state or cache writes
  after supersession/logout. Native request preparation checks cancellation
  again after asynchronous app/device header assembly, so a request cancelled
  during preparation is never launched.
- The per-request timeout is one overall deadline spanning native metadata
  preparation, transport, response-body parsing, and publication. Web JSON parse
  failures are ignored only for genuinely malformed bodies; an abort during
  parsing remains an `AbortError`. A timed-out native metadata lookup is removed
  from the shared cache so the next request can recover instead of inheriting a
  permanently pending promise. Service wrappers, including signed GeoJSON
  downloads, forward both caller cancellation and custom deadlines to that
  transport boundary.
- Login error publication in `SessionCoordinator` ignores response-body text
  completely and selects fixed local messages from status/transport classes.
  Authentication payloads can therefore never reflect submitted credential bytes
  into the UI.
- Direct token login reuses `SpeleoDBService.validateToken`; `2xx` establishes
  an identity-free session, while every failure remains unauthenticated and
  never falls back offline.
- Endpoint URLs and the v2 base path live in `src/constants.ts`
  (`API.BASE_PATH = '/api/v2'`).

## Implementation expectations

- Treat controller offline lock as the authoritative network gate for app
  behavior.
- Keep reconnect logic explicit and initiated only from documented triggers.
- Follow code architecture and testing conventions in
  `docs/implementation-guidelines.md`.

## Landmark mutations and the offline queue

Landmark create/edit/delete are request-driven like everything else. A mutation
that hits a transport error, timeout, or 5xx is treated as "not reachable" and
enqueued as a persistent offline op (a 4xx is a definitive answer and is
surfaced to the user, not queued). Replaying the queue is a side-effect of an
explicit, user-initiated action (the Pending page's Sync Now / per-row Sync, or
a controller sync); it never runs from a passive connectivity listener. See
`docs/offline-op-queue.md`.

## GPS track mutations

GPS track create (= GPX upload), edit (name/color), and delete follow the exact
same request-driven model as landmark mutations because they go through the
**same** offline op queue (`docs/offline-op-queue.md`). A mutation that hits a
transport error, timeout, `408`, or `5xx` is enqueued and flips the app offline
(`enterOfflineMode`); `429` keeps it pending without going offline; a definitive
`4xx` is surfaced as a thrown error and not enqueued. Pending GPS ops are
replayed from the **Pending** page (`Sync Now` / per-row `Sync`) — uniform with
landmarks. Reconnect (`attemptReconnect()` / successful startup validation)
clears the offline lock and refreshes the server track list via `syncProjects()`
but does **not** auto-replay the queue, and never runs from a passive
connectivity listener. Recording itself makes no network calls. See
`docs/gps-tracks.md`.

See also:

- `docs/offline-mode.md`
- `docs/authentication.md`
- `docs/offline-op-queue.md`
- `docs/gps-tracks.md`
- `docs/logout-behavior.md`
- `docs/implementation-guidelines.md`
- `docs/dashboard-map-overlays.md`
