# Implementation Guidelines

This document defines high-level architecture boundaries and coding expectations
for feature work in this repository.

## Goal

- Keep behavior predictable across offline and online scenarios.
- Keep state ownership clear so features are easy to test and reason about.
- Keep docs, implementation, and tests aligned in the same change.

## Architecture boundaries

- `src/context/` is the React bridge layer. Providers subscribe to controller
  state and expose it to components. Startup/offline/onboarding presentation
  orchestration belongs in dedicated UI coordinators/hooks (for example
  `src/context/useStartupUiCoordinator.ts`), not inline inside a large provider
  body.
- `src/controllers/` owns app state transitions and business decisions.
- `src/services/` performs side effects (HTTP, cache persistence, map tile
  operations).
- `src/pages/` and `src/components/` render UI and trigger controller actions.
  They should not duplicate controller business logic.
- `src/services/tileCache/` contains lower-level storage/maintenance primitives
  used by higher services.

## State ownership

- Treat `SessionCoordinator` as the source of truth for auth and offline-lock
  state, and `ProjectSyncCoordinator` as the source of truth for project-list,
  sync-status, last-sync, cancellation, and map-data revision state. Both remain
  exposed through the stable `SpeleoDBController` façade.
- Treat coordinator revision fields as stable publication boundaries. For
  project maps, `mapDataRevision` tells mounted consumers to reread atomic
  `{ commitId, featureCollection, bounds }` records; UI code must still require
  the commit to match `latest_commit.id` and ignore stale async completions.
- Avoid parallel state machines across UI and services for the same behavior.
- UI local state is acceptable for presentation-only concerns (modal visibility,
  form state, layout state).
- UI coordinators may use reducer-backed local state for
  startup/offline/onboarding flows, but they must translate controller snapshots
  into presentation state rather than owning auth/offline truth themselves.
- Default SpeleoDB instance prefill is a login-form concern only. Services,
  controller, and persisted preferences must not auto-inject a fallback
  instance.

## Networking and offline rules

- Do not add passive `window` `online`/`offline` listeners for reconnect
  orchestration.
- Explicit reconnect paths are limited to app relaunch startup validation,
  Settings **Go Online**, and Pending Changes **Try Reconnect**.
- Timeout, transport, redirect, `5xx`, and inconclusive `4xx` auth-validation
  failures must preserve the stored session and local cache.
- Only explicit stored-session authorization denial (`401`/`403`) should trigger
  logout and local data purge.
- When offline lock is active, normal data/map flows should avoid outbound
  network calls.

## Service layer expectations

- Services should be deterministic and prefer dependency injection for external
  concerns (time, network gates, storage).
- Prefer narrow interfaces and explicit return types for side-effecting
  functions.
- Keep cache fallbacks and network retries inside service/controller
  orchestration, not in UI components.
- Long-running IO paths should accept `AbortSignal` when they participate in
  startup validation, sync, or logout-sensitive flows.
- Project GeoJSON is untrusted input. It must cross the worker-backed,
  per-commit validation/cache boundary documented in
  `project-geojson-validation.md` before Dashboard or tile-prefetch code can
  consume it. Downstream consumers use persisted bounds and must not recompute
  project bboxes.
- Durable GeoJSON quarantine APIs accept file-scoped reasons only.
  `validation_unavailable` is an infrastructure/session disposition and must not
  be persisted as blame against a commit. Cache metadata is schema-versioned
  independently from the IndexedDB database version and must be parsed strictly.
- Cache writes participating in sync accept `AbortSignal`. Conditional changes
  such as warning acknowledgement belong in one read/write transaction, with
  commit identity checked inside that transaction.
- Offline-map replacement is a generation boundary, not a mutable job list.
  Preserve the active layer generation until the pending canonical plan
  succeeds; keep retry waits outside workers and live progress outside durable
  checkpoint persistence.
- Circular longitude logic is centralized. Consumers merge complete directed
  intervals and clamp display/tile latitude to Web Mercator; do not
  independently min/max interval endpoints.

## TypeScript and code style

- Prefer explicit types for public APIs and cross-layer contracts.
- Keep naming consistent with responsibility (`*Controller`, `*Service`,
  `*Provider`).
- Avoid hidden global coupling; pass dependencies where practical.
- Add small comments only for non-obvious behavior or invariants.

## Error handling

- Fail safely for user-facing flows: preserve usable local state when remote
  calls fail.
- Use best-effort writes for non-critical caches when appropriate.
- Do not swallow errors that determine auth/offline correctness.
- Cancellation is not an error fallback. Once a coordinator-owned run is
  aborted, stale IO completions must not publish state, cache writes, or
  offline-map plans or generation state.
- Recheck cancellation after persistence and cleanup awaits, immediately before
  logging, counters, warnings, revisions, or other observable publication.

## Testing expectations

- Add or update tests for every behavior change in controller/service
  orchestration.
- Prefer focused unit tests around controller decisions and service fallbacks.
- Keep provider/dashboard tests for user-visible contracts (offline modal,
  Settings sync).
- Include regression coverage when fixing edge cases (timeouts, retries, offline
  lock transitions).
- Exercise the authoritative production seam. Persistence invariants require a
  real fake-IndexedDB transaction test; concurrency invariants require deferred
  dependencies at the actual awaited cache/fetch/sleep/write boundary; UI reload
  invariants require the revision and controller accessor used by Dashboard.
  Mocking an obsolete helper or making a mock return the desired answer is not
  proof. See `tasks/lessons/authoritative-seam-tests.md`.
- When production deliberately starts a background IndexedDB write, tests must
  await the final durable record or accounting update, not an earlier object-
  store write from the same transaction. Ending a test on an intermediate write
  leaks work into later tests and makes coverage depend on execution order.
  Serialized files must also receive separate fake IndexedDB factories so open
  connections and catalogs cannot cross file boundaries. See
  `tasks/lessons/indexeddb-background-writes.md`.
- Separate compilation evidence from device evidence. Web/native builds cannot
  establish WebView responsiveness, native modal dismissal, device-console
  output, real network cancellation, or persistence across force-quit.

## Change checklist

1. Verify behavior changes are reflected in `docs/`.
2. Verify controller remains the source of truth for auth/offline decisions.
3. Verify reconnect behavior stays explicit and user-driven.
4. Run targeted unit tests for touched paths.
5. Run `npm run build` for type and dead-path validation.
6. Record physical Android/iOS checks separately when behavior crosses worker,
   WebView, native modal, network, or persistence boundaries.

## Native asset ownership

Source artwork under `resources/` and the generated Android/iOS icon and splash
assets are checked in. Routine installs and builds must not install or execute a
native-asset generator. Asset changes require an explicitly reviewed tool,
inspection of every generated native diff, and Android/iOS launch-screen and
icon verification before those generated files are committed. This keeps an
infrequent design operation out of the application dependency and advisory
surface.

## Related docs

- `docs/networking.md`
- `docs/offline-mode.md`
- `docs/logout-behavior.md`
