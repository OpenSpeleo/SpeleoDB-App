# Session and startup coordination

## Intent

Authentication policy must remain independently testable and must not be coupled
to the controller's project, map, tile, offline-mutation, or GPS state.
`SpeleoDBController` remains the stable public façade used by React while
`SessionCoordinator` owns the session state machine.

## Ownership

`SessionCoordinator` owns:

- restored in-memory auth identity and token state,
- email/password and OAuth-token login outcome policy,
- secure-session establishment ordering,
- startup validation timeout and cancellation,
- online/offline-lock transitions,
- explicit reconnect decisions, and
- the decision to request destructive logout after validation returns an
  explicit `401`/`403` authorization denial.

The coordinator depends only on narrow ports:

- `SessionTransport` for authenticate and validate-token requests,
- `SessionStore` for already-initialized secure credentials, and
- lifecycle hooks for notification, wider async invalidation, purge, reconnect
  sync, and the tile-cache offline runtime flag.

It does not import cache, GPS, map, tile-prefetch, offline-queue, React, or
Capacitor implementations. The controller implements lifecycle hooks because it
still owns the wider application cleanup and sync orchestration.

## State transitions

| Trigger                | Validation result                                          | Session   | Connectivity    | Follow-up               |
| ---------------------- | ---------------------------------------------------------- | --------- | --------------- | ----------------------- |
| Stored-session startup | 2xx                                                        | preserved | online/unlocked | startup continues       |
| Stored-session startup | 401/403                                                    | purged    | reset/unlocked  | login required          |
| Stored-session startup | timeout, transport, or non-2xx response other than 401/403 | preserved | offline/locked  | cached use continues    |
| Explicit reconnect     | 2xx                                                        | preserved | online/unlocked | one project sync starts |
| Explicit reconnect     | 401/403                                                    | purged    | reset/unlocked  | login required          |
| Explicit reconnect     | timeout, transport, or non-2xx response other than 401/403 | preserved | offline/locked  | no sync, no purge       |
| Login                  | validated + secure write succeeds                          | replaced  | online/unlocked | UI notified             |
| Login                  | validation or secure write fails                           | unchanged | unchanged       | error returned          |
| Logout                 | n/a                                                        | revoked   | reset/unlocked  | all user data purged    |

Connectivity changes are request-driven. No browser or operating-system online
event may bypass this state machine. Superseded validation runs are aborted and
their late completions resolve from current auth state without publishing stale
connectivity. Concurrent manual reconnect calls share one in-flight result, and
only an authoritative validation success may invoke the reconnect-sync hook.

## Verification and performance

`SessionCoordinator.test.ts` covers every executable statement, branch, and
function, including malformed responses, storage failures, supersession,
invalidation, reconnect, and restore failure. Existing controller tests remain
characterization coverage for façade behavior and cross-subsystem teardown.

The extraction adds no timers, polling, persistence reads, or network calls.
Session state getters return stable references between transitions, preserving
`useSyncExternalStore` behavior without controller-owned duplicate snapshots.
