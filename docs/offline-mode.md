# Offline Mode

This document describes the offline cache feature and the expected auth behavior when the app starts.

## Goal

- Allow users with a previously valid local session to continue working when network connectivity is poor or unavailable.
- Log out users and clear local data only when auth is definitively invalid (HTTP 4xx from token validation).

## Startup auth timeout

- Timeout constant: `NETWORK.STARTUP_AUTH_TIMEOUT_MS = 3000` in `src/constants.ts`.
- During startup, the app validates the stored token against the backend.
- If the request times out or fails due to transport/network/server conditions, the app must enter offline mode and keep the local session.
- Timeout must never trigger logout.

## Startup auth outcome matrix

| Condition | Startup result | Logout | Cache purge | UX |
| --- | --- | --- | --- | --- |
| HTTP 2xx | `ok` | No | No | Continue online |
| HTTP 4xx | `unauthorized` | Yes | Yes | Redirect to home/login |
| HTTP 5xx or non-4xx error status | `network_error` | No | No | Offline mode |
| Timeout / transport exception | `network_error` | No | No | Offline mode |
| Browser offline event | N/A | No | No | Offline modal shown |

## Retry behavior

- Offline modal "Retry connection" calls `retryConnection()`.
- Retry outcomes:
  - `ok`: close offline modal and resume normal behavior.
  - `unauthorized`: redirect to home/login (logout and purge already handled in controller for 4xx).
  - `network_error`: stay in offline modal.

## What gets cleared, and when

Local data purge is tied to `logout()` and includes:

- preferences and auth state
- local and session storage
- project cache
- tile cache and prefetch jobs

Expected trigger for purge in startup auth flow:

- only HTTP 4xx token validation responses.

## Source code map

- Startup provider orchestration: `src/context/SpeleoDBProvider.tsx`
- Auth decision logic: `src/controllers/SpeleoDBController.ts`
- Timeout/transport behavior: `src/services/HttpClient.ts`
- Auth API call: `src/services/SpeleoDBService.ts`
- Key tests:
  - `src/controllers/SpeleoDBController.test.ts`
  - `src/context/SpeleoDBProvider.test.tsx`
  - `src/pages/Dashboard.test.tsx`

## Change checklist (offline/auth)

When modifying auth/offline logic:

1. Verify timeout and network failures do not call `logout()`.
2. Verify only 4xx auth failures trigger cache purge.
3. Run targeted tests for controller, provider, and dashboard retry paths.
4. Update this document if any behavior changes.
