# Networking Behavior

This document defines how network state is handled in the app and what is intentionally *not* observed.

## Design intent

- Networking must be deterministic and user-driven.
- The app must not auto-switch state just because the device toggles Wi-Fi/cellular.
- Offline users must keep local session and cached data unless auth is definitively invalid (`4xx`).

## No passive listeners

- The app does **not** subscribe to `window` `online`/`offline` events.
- The app does **not** run automatic reconnect attempts when the OS reports connectivity changes.
- Returning to Wi-Fi by itself must not reopen offline prompts or trigger sync.

## Allowed reconnect triggers

Only one action may attempt to return online from offline mode:

1. Close and reopen the app (startup validation flow).

If this action does not occur, app remains in offline behavior even if device connectivity changes. The Settings page sync button calls `syncProjects()` but does not attempt offline reconnect.

## Offline modal contract

- Offline modal visibility is driven by controller offline lock state (`isOfflineLocked`).
- `Go Offline` acknowledges the modal for the current offline-lock period.
- The modal can appear again only after offline lock clears and is later re-entered.

## Request gating while offline

- During offline lock, normal data/map fetch paths should skip outbound network and use cache.
- This includes dashboard project GeoJSON and read-only overlay GeoJSON (landmarks, stations, exploration leads, cylinder installs).
- Reconnect attempts are explicit and limited to the app relaunch trigger above.
- Transport errors/timeouts remain non-destructive (no logout, no cache purge).

## Auth and logout

- `4xx` from auth validation means token/session is invalid and must trigger logout + local purge.
- Network errors, timeouts, and non-`4xx` failures must preserve session and local cache.

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
- `SpeleoDBController.syncProjects` treats only `2xx + Project[]` as the project-list success path. `2xx + []` is a valid empty refresh and replaces stale cached projects; non-array `2xx` payloads are malformed and are treated like failed refreshes. Failed refreshes preserve cache, skip overlay/prefetch side-effects, and set `syncStatus` to `'error'` only when no cached projects are available, otherwise `'done'`. A 4xx during data fetch never triggers logout — only `validateSession` does.
- Background GeoJSON cache writes validate the downloaded body before persisting it. Non-`2xx` or malformed GeoJSON payloads are skipped so stale cache is preserved instead of being overwritten with garbage.
- Login error parsing in `SpeleoDBController.login` reads `detail` / `message` / `errors.non_field_errors` directly off `response.data` (already v2-shaped).
- Endpoint URLs and the v2 base path live in `src/constants.ts` (`API.BASE_PATH = '/api/v2'`).

## Implementation expectations

- Treat controller offline lock as the authoritative network gate for app behavior.
- Keep reconnect logic explicit and initiated only from documented triggers.
- Follow code architecture and testing conventions in `docs/implementation-guidelines.md`.

See also:

- `docs/offline-mode.md`
- `docs/logout-behavior.md`
- `docs/implementation-guidelines.md`
- `docs/dashboard-map-overlays.md`
