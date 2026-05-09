# Offline Mode

This document defines the offline cache feature, user-facing offline modal behavior, and online recovery guarantees.

## Goal

- Allow users with a previously valid local session to continue working when network connectivity is poor or unavailable.
- Log out users and clear local data only when auth is definitively invalid (HTTP 4xx from token validation).
- Keep offline UX non-blocking: user can acknowledge offline mode and keep using cached data.

## Startup auth timeout

- Timeout constant: `NETWORK.STARTUP_AUTH_TIMEOUT_MS = 10000` in `src/constants.ts` (raised from `3000` so spotty mobile networks have time to respond before the app falls back to offline mode).
- During startup, the app validates the stored token against the backend.
- If the request times out or fails due to transport/network/server conditions, the app must enter offline mode and keep the local session.
- Timeout must never trigger logout or cache clearing.
- Startup validation is attempted once per app launch when persisted preferences contain a `token` and `instance`. `email` is not part of the gate.
- While startup validation is in flight, the startup UI coordinator (`src/context/useStartupUiCoordinator.ts`, rendered by `SpeleoDBProvider`) schedules a small `Connecting to SpeleoDB…` floating card (`data-testid="connecting-banner"`) **after a 1s gate**, so fast networks never see it but slow networks get clear visual feedback that the app is still trying. The banner is removed as soon as `validateSession()` resolves (success or failure).
- The native splash (`launchAutoHide: false`, opaque `#0f172a`) is hidden at the same instant the banner is shown. This is non-negotiable: the splash sits above the React tree and would otherwise hide the banner for the entire timeout window. On fast networks the banner timer is cancelled and the splash hides only via the validation `.finally()` (single hide call). On slow networks the splash hides at ~1s and `.finally()` calls hide again on resolution; both calls are idempotent and any plugin warning is swallowed by `hideSplashScreenSafely`.
- The offline modal is suppressed while startup validation is still pending, so users see either the `Connecting to SpeleoDB…` card or the offline modal, never both at once.
- If logout or unmount happens while startup validation is still pending, the delayed banner timer is cleared and the controller cancels the in-flight validation context so stale completions cannot mutate startup/offline UI.

## Offline mode user experience

- Offline modal includes a `Go Offline` action.
- `Go Offline` means:
  - close the modal,
  - keep app in offline mode,
  - continue using cached data,
  - do not reprompt again during the same offline period.
- After user acknowledged offline mode, prompt may appear again only after offline lock is cleared by an explicit reconnect path and later re-entered.

## Online recovery behavior (strict)

When app is in offline mode, only one action is allowed to attempt returning online:

1. Close and reopen the app (startup validation attempt).

This action must run a tentative reconnect flow and resolve to exactly one outcome:

- reconnect success: clear offline lock and resume online behavior.
- still offline: remain offline without forced logout and without repeated blocking prompts.
- unauthorized (4xx): follow logout/cache purge behavior.

## Startup auth outcome matrix

| Condition | Startup result | Logout | Cache purge | UX |
| --- | --- | --- | --- | --- |
| Persisted auth prefs missing `instance` | `unauthorized` | Yes (preferences cleared as invalid) | No | Continue unauthenticated; user must log in again |
| HTTP 2xx | `ok` | No | No | Continue online |
| HTTP 4xx | `unauthorized` | Yes | Yes | Redirect to home/login |
| HTTP 5xx or non-4xx error status | `network_error` | No | No | Offline modal shown (acknowledge once with `Go Offline`) |
| Timeout / transport exception | `network_error` | No | No | Offline modal shown (acknowledge once with `Go Offline`) |

## Network behavior while offline

- Offline mode uses cached app data and cached map resources.
- Dashboard map overlays (landmarks, stations, exploration leads, cylinder installs) are read from cached GeoJSON when offline.
- Outbound network requests should be skipped for normal offline operation paths.
- Explicit reconnect attempts are limited to the app relaunch recovery path above.
- The Settings page sync button calls `syncProjects()` only. It does not attempt offline reconnect.
- The app does not use passive `online`/`offline` browser listeners. Connectivity changes alone do not trigger reconnect or modal state changes.

## Logout and data purge

Logout and wipe policy is documented in `docs/logout-behavior.md`.
In offline mode flows, local data must only be purged on authentication-invalid (`4xx`) outcomes.

## Source code map

- Startup UI coordination: `src/context/useStartupUiCoordinator.ts`
- React provider bridge: `src/context/SpeleoDBProvider.tsx`
- Auth decision logic: `src/controllers/SpeleoDBController.ts`
- Timeout/transport behavior: `src/services/HttpClient.ts`
- Auth API call: `src/services/SpeleoDBService.ts`
- Logout policy detail: `docs/logout-behavior.md`
- Networking state model: `docs/networking.md`
- Architecture and style expectations: `docs/implementation-guidelines.md`
- Map/tile offline fetch behavior: `src/services/TileCacheService.ts`
- Tile prefetch runtime behavior: `src/services/TilePrefetchService.ts`
- Overlay contract and icon mapping: `docs/dashboard-map-overlays.md`
- Key tests:
  - `src/controllers/SpeleoDBController.test.ts`
  - `src/context/SpeleoDBProvider.test.tsx`
  - `src/pages/Dashboard.test.tsx`
  - `src/services/ProjectCacheService.test.ts`
  - `src/services/TileCacheService.test.ts`
  - `src/services/TilePrefetchService.test.ts`

## Change checklist (offline/auth)

When modifying auth/offline logic:

1. Verify timeout and network failures do not call `logout()`.
2. Verify only 4xx auth failures trigger cache purge.
3. Verify modal can be acknowledged with `Go Offline` and is not repeatedly re-shown in same offline period.
4. Verify the only reconnect path while offline is app relaunch.
5. Run targeted tests for controller, provider, dashboard, tile cache, and tile prefetch paths.
6. Update this document if any behavior changes.
