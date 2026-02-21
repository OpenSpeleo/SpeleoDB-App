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

## Implementation expectations

- Treat controller offline lock as the authoritative network gate for app behavior.
- Keep reconnect logic explicit and initiated only from documented triggers.
- Follow code architecture and testing conventions in `docs/implementation-guidelines.md`.

See also:

- `docs/offline-mode.md`
- `docs/logout-behavior.md`
- `docs/implementation-guidelines.md`
- `docs/dashboard-map-overlays.md`
