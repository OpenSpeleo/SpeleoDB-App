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
- `localStorage` and `sessionStorage`,
- cached projects and GeoJSON (including dashboard overlay GeoJSON),
- cached map tiles,
- persisted tile prefetch jobs.

## Offline mode interaction

- Entering offline mode does not clear local data.
- `Go Offline` acknowledges offline state and keeps cached content available.
- Reconnect attempts are separate from logout and must not wipe data unless server returns 4xx.

## Source map

- Controller logout implementation: `src/controllers/SpeleoDBController.ts`
- Startup/session validation decisions: `src/controllers/SpeleoDBController.ts`
- Offline modal behavior: `src/context/SpeleoDBProvider.tsx`
- Overlay details: `docs/dashboard-map-overlays.md`
- Regression tests: `src/controllers/SpeleoDBController.test.ts`, `src/context/SpeleoDBProvider.test.tsx`
