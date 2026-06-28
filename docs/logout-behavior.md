# Logout and Data Purge Behavior

This document defines when logout is triggered and what local data is wiped.

## Why this exists

Offline mode and logout must stay clearly separated:

- offline mode keeps the local session and cached data usable.
- logout is destructive and clears local data.

## Logout trigger policy

Logout in startup/session validation is expected only for authentication-invalid outcomes:

- HTTP 4xx from token validation (`unauthorized` path).

Logout must not be triggered by transient network conditions:

- timeout,
- transport/network exceptions,
- HTTP 5xx and other non-4xx server errors,
- browser offline event.

## What gets cleared on logout

`logout()` purges local user data, including:

- auth state and preferences,
- the native secure authentication token and its non-secret session marker,
- `localStorage` and `sessionStorage`,
- cached projects and GeoJSON (including dashboard overlay GeoJSON),
- cached map tiles,
- persisted tile prefetch jobs.

Implementation notes:

- logout invalidates and cancels controller-owned startup validation and sync run contexts before the destructive cache wipe starts,
- UI auth/session state resets immediately so the app stops rendering the old session,
- native credential deletion runs before session metadata deletion; any failure
  still revokes the in-process token, completes local cache cleanup, and is
  reported to the caller instead of being hidden,
- cache purge waits for already-started tracked sync work to settle before `clearAll()` / tile cleanup runs, so stale writes cannot repopulate local data after logout completes,
- service/cache layers must treat aborts as authoritative: once logout starts, no stale state mutation, cache write, or tile-prefetch scheduling may be published from the cancelled run.

## Offline mode interaction

- Entering offline mode does not clear local data.
- `Go Offline` acknowledges offline state and keeps cached content available.
- Reconnect attempts are separate from logout and must not wipe data unless server returns 4xx. In-process reconnect is intentionally unsupported; recovery is relaunch-only.

## Source map

- Controller logout implementation: `src/controllers/SpeleoDBController.ts`
- Startup/session validation decisions: `src/controllers/SpeleoDBController.ts`
- Offline modal behavior: `src/context/useStartupUiCoordinator.ts`, `src/context/SpeleoDBProvider.tsx`
- Overlay details: `docs/dashboard-map-overlays.md`
- Regression tests: `src/controllers/SpeleoDBController.test.ts`, `src/context/SpeleoDBProvider.test.tsx`
