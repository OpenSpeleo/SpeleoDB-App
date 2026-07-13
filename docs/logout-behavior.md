# Logout and Data Purge Behavior

This document defines when logout is triggered and what local data is wiped.

## Why this exists

Offline mode and logout must stay clearly separated:

- offline mode keeps the local session and cached data usable.
- logout is destructive and clears local data.

## Logout trigger policy

Logout in startup/session validation is expected only for explicit
authentication-denial outcomes:

- HTTP `401` or `403` from stored-token validation (`unauthorized` path).

Logout must not be triggered by transient network conditions:

- timeout,
- transport/network exceptions,
- HTTP `400`, `404`, `408`, `409`, `425`, `429`, `5xx`, redirects, and other
  responses that do not explicitly deny authorization,
- browser offline event.

## What gets cleared on logout

`logout()` purges local user data, including:

- auth state and preferences,
- the native secure authentication token and its non-secret session marker,
- `localStorage` and `sessionStorage`,
- cached projects and GeoJSON (including dashboard overlay GeoJSON),
- the bounded in-memory validated-project read-through cache and any
  single-flight record reads admitted before purge,
- pending landmark/GPS operations in the `offline_ops` IndexedDB store,
- local GPS recordings, cached remote GPS metadata, and cached GPS geometry,
- cached map tiles,
- persisted offline-map plans, generations, memberships, and cached tiles.

## Voluntary sign-out confirmation

Settings uses the already-published pending-operation count; it does not perform
another storage read. With no pending operations, the normal destructive
sign-out confirmation remains unchanged. With one or more pending operations,
the modal displays the exact count and explicitly states that every pending
offline operation will be permanently deleted, cannot be recovered, and cannot
be synchronized later. The destructive button remains disabled until the user
checks the loss acknowledgement.

The acknowledgement resets when the modal closes or the live pending count
changes. A failed cleanup keeps an unchanged acknowledgement available for an
in-place retry, while the busy state disables acknowledgement, cancellation, and
duplicate submission. This consent applies only to voluntary Settings sign-out.
A forced logout after `401`/`403` remains non-interactive because security
revocation and local purge must not depend on UI availability.

Implementation notes:

- logout closes admission for new login and validation requests before it
  dispatches cancellation, preventing abort-listener re-entry from starting a
  new session transition,
- the session coordinator revokes its published auth/online/offline snapshot at
  logout admission, before waiting for any in-flight native vault rollback;
  runtime adapters and subscribers are best-effort and cannot interrupt that
  revocation or the subsequent purge,
- published auth, project, GPS-track, and pending-operation state is revoked
  before awaiting native watcher or tile-worker teardown,
- in-flight login transports and startup validation are cancelled immediately;
  logout waits for every accepted authentication operation and secure-store
  rollback before entering destructive purge,
- concurrent logout calls share one purge operation, and authentication is
  admitted again only after that operation settles,
- logout invalidates and cancels coordinator-owned startup validation and
  controller-owned sync run contexts before the destructive cache wipe starts,
- one controller-owned user-operation lifetime also covers landmark mutations,
  GPS-track mutations and lazy geometry reads, collection/cache reads, warning
  acknowledgements, and offline replay. Logout aborts that lifetime before
  purge, forwards its signal to network and writable cache seams, and waits for
  every admitted operation to settle before deletion,
- authority is checked again after every awaited transport or persistence
  boundary. A dependency that ignores cancellation may delay logout, but its
  late result cannot publish state, write cache data, or finalize/remove an
  offline operation. Replaced offline-queue instances ignore notifications from
  their invalidated predecessors,
- UI auth/session state resets immediately so the app stops rendering the old
  session; cancelled validation/reconnect callers resolve `unauthorized` when
  logout owns the transition and can never report a stale online success,
- native credential deletion and session-marker deletion are both attempted;
  marker deletion still runs when vault deletion fails, so a retained orphan
  token cannot be restored on restart. Any failure still revokes in-process
  access and is reported after the remaining cleanup steps finish,
- cache purge waits for already-started tracked sync work to settle before
  `clearAll()` / tile cleanup runs. Tile clear also advances a cache epoch and
  aborts every low-priority stale refresh, so ignored/late transport settlement
  cannot repopulate local data after logout completes,
- GPS/tile teardown, pending GPS persistence, cache deletion, storage clearing,
  and tile-runtime restart are independent cleanup steps. A failure in one may
  not skip the others; logout rejects with a generic retryable error only after
  every step has been attempted,
- project, GeoJSON, pending-operation, and GPS-record cache stores are also
  cleared independently inside `ProjectCacheService.clearAll()`. Failure of one
  store cannot prevent deletion attempts for the remaining user-data stores,
- `ProjectCacheService.clearAll()` invalidates its in-memory record generation
  before IndexedDB deletion begins. A pre-clear read may settle for its already
  admitted caller, but cannot repopulate the post-logout cache,
- service/cache layers must treat aborts as authoritative: once logout starts,
  no stale state mutation, cache write, or tile-prefetch scheduling may be
  published from the cancelled run.

The shared lifetime adds only constant-time admission/tracking and one abort
listener per active transport. It does not add polling, background work, or
additional network requests.

## Offline mode interaction

- Entering offline mode does not clear local data.
- `Go Offline` acknowledges offline state and keeps cached content available.
- Reconnect attempts are separate from logout and must not wipe data unless the
  server returns `401`/`403`. In-process reconnect is explicit and
  user-initiated via Settings or Pending Changes; passive connectivity events
  never reconnect.

## Source map

- Controller logout implementation: `src/controllers/SpeleoDBController.ts`
- Startup/session validation decisions: `src/controllers/SessionCoordinator.ts`
- Offline modal behavior: `src/context/useStartupUiCoordinator.ts`,
  `src/context/SpeleoDBProvider.tsx`
- Overlay details: `docs/dashboard-map-overlays.md`
- Regression tests: `src/controllers/SessionCoordinator.test.ts`,
  `src/controllers/SpeleoDBController.test.ts`, and
  `src/context/SpeleoDBProvider.test.tsx`; voluntary confirmation coverage:
  `src/pages/Settings.test.tsx`
