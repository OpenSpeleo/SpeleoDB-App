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
  independently min/max interval endpoints. GIS Geometry is the explicit
  API-contract exception: its validated raw coordinate minima/maxima define
  bounds, without a shortest wrapped interval. See
  [GIS Geometry](gis-geometry.md).

## TypeScript and code style

- Prefer explicit types for public APIs and cross-layer contracts.
- Keep naming consistent with responsibility (`*Controller`, `*Service`,
  `*Provider`).
- Avoid hidden global coupling; pass dependencies where practical.
- Add small comments only for non-obvious behavior or invariants.

## Persisted input boundaries

New-input validation does not repair older stored values. Revalidate identifiers
that control security, routing, ownership, or storage selection before restored
state is published or used for I/O. Canonically migrate recoverable values;
reject and purge unsafe values through the owning lifecycle boundary. Tests must
prove no request or stale publication precedes validation. Keep post-migration
transport failures separate from malformed state so offline continuity is not
destroyed.

## Diagnostic scope

For logging or investigation work, collect phase-specific evidence and the
concrete runtime failure before proposing a dependency replacement. Suspicion
alone does not justify architectural changes. Keep fixes proportional to the
authorized scope; seek expanded authorization when a replacement goes beyond it.

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

## Authoritative publication and observers

Commit durable state and its owning transition before notifying observers.
Subscriber or runtime-adapter exceptions cannot turn that success into a command
failure: storage, snapshot, and returned result must agree. Test throwing
observers at the owning seam. Startup adapters and follow-up work after the
authoritative result are best-effort effects.

Safety prerequisites are different: cancellation/invalidation preventing old
account work from crossing into a new session must succeed before credentials
are committed. A failed prerequisite rejects setup without writing credentials.

Cancellation requests are not proof of settlement. Backpressured producers must
join all admitted workers on failure as well as success before reporting idle or
permitting destructive cleanup. Draining workers still count toward the
replacement scheduler’s concurrency limit.

## Async UI completion

Blocking state follows the authoritative commit, not subsequent background
housekeeping. Derive it from pending IDs still present in authoritative state;
do not fake persistence success or use timers to unblock controls. When actions
overlap, a completion may clear only its own pending state and confirmation.
Verify this with held promises: publish one commit, begin another action, then
settle the old action while the new one is confirming or saving. Exercise shared
storage cleanup at its owning seam as well.

A disabled button only closes admission after React renders. Async form and
destructive actions need a ref-backed gate set before their first state update.
The initiating component owns completion and timer cleanup: ignore unmounted
results, cancel delayed callbacks, and retain admission through success-to-
navigation windows. Test duplicate same-turn events and unmount through the real
handler; button appearance alone is not concurrency evidence.

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
  proof. Trace the production call path before choosing the test boundary.
  Assert ordering and final durable/runtime state, not just callback counts.
- Shared ownership tests include unique and shared resources in queued and
  active states: prove sole-owner cancellation and remaining-owner continuity.
- Keep adversarial fixtures independent of the helper under test; expected
  geometry, metadata, and counters must not come from the implementation itself.
- Monitoring tests assert the emitted envelope through the real SDK parser,
  integrations, and final filter using an in-memory transport. Mocking
  `captureException` cannot establish stack preservation or redaction.
- Inspect native test reports for expected device counts and failures. A Gradle
  success exit alone can conceal interrupted or incomplete instrumentation.
- When production deliberately starts a background IndexedDB write, tests must
  await the final durable record or accounting update, not an earlier object-
  store write from the same transaction. Ending a test on an intermediate write
  leaks work into later tests and makes coverage depend on execution order.
  Serialized files must also receive separate fake IndexedDB factories so open
  connections and catalogs cannot cross file boundaries. Preserve database
  lifetime within a file when restart behavior is under test. A generic
  microtask flush is not transaction completion; use multiple deterministic
  shuffled seeds when diagnosing order-dependent persistence failures.
- Attach cancellation to the live `IDBTransaction`, not merely pre/post helper
  checks. Recheck generation before final metadata/accounting writes. Refreshes
  capture a cache/session epoch and abort on clear/logout; ignored transport
  aborts cannot commit late payloads or tombstones. Test real transaction
  aborts, not just pre-aborted mocks.
- Separate compilation evidence from device evidence. Web/native builds cannot
  establish WebView responsiveness, native modal dismissal, device-console
  output, real network cancellation, or persistence across force-quit.

## Change checklist

1. Verify behavior changes are reflected in `docs/`.
2. Verify controller remains the source of truth for auth/offline decisions.
3. Verify reconnect behavior stays explicit and user-driven.
4. Run targeted unit tests for touched paths.
5. Run `bun run build` for type and dead-path validation.
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

## Native plugin thread ownership

Capacitor bridge invocation does not imply the main thread. Marshal UIKit reads
and mutations (`UIApplication`, scenes, windows, and device orientation) to the
main queue. Keep native start/stop idempotent across bridge, lifecycle, and
cancellation calls. Cache orientation from main-queue notifications instead of
polling UIKit in high-frequency sensor callbacks. A build establishes linkage
and type correctness; exercise the plugin action on a physical device with Main
Thread Checker enabled to establish thread correctness.

## Dashboard async test setup

Before fake-timer gesture assertions, settle Dashboard mount effects for project
sync, map style, overlay GeoJSON, and icons. Wait for the map touch surface and
a loaded layer/overlay that proves data publication, then flush an asynchronous
`act` tick before advancing timers. Otherwise late state commits produce React
`act` warnings after the gesture assertion and can leak into later tests.

Cancellation flows also need settled mount effects and awaited interactions.
Download-area pattern registration queues a React state update even when a
landmark action makes no network request. Wrap synthetic map gestures in async
`act` and await `userEvent` clicks before asserting that cancellation caused no
mutation; keep the console guard enabled.

## Native plugin registration

First-party Capacitor plugins also need explicit Android class registration in
`MainActivity` and iOS instance registration in `AppBridgeViewController`.
Compiling a class or type-only registration does not prove package discovery
exposes it. A bridge integration test must load the production host and resolve
the exact JavaScript plugin name. Keep this separate from native formatter or
storage unit tests, which prove a different invariant.

## Native UI evidence and completion

Recognizing system UI identifies its owner, not the exact trigger. Preserve
contradictory observations (for example, no keyboard or apparent touch rather
than motion). Treat policies blocking candidate triggers as guardrails until
there is a before/after reproduction at the owning responder/WebView seam.
Ancestor property assertions and compilation cannot prove gesture behavior; see
[iOS editing](ios-webview-editing.md).

Native presentation promises can reject even with valid inputs. UI handlers must
consume that rejection and provide fixed, non-sensitive feedback while mounted.
Test a rejected plugin call and successful subsequent retry, not only
invocation.

## High-frequency resource work

Let IndexedDB order durable transactions and use bounded independent network
workers; a single application promise chain per downloaded resource serializes
otherwise independent work. Publish live in-memory progress separately from
crash checkpoints. Verify concurrency limits, head-of-line avoidance, resource
transitions, and notification isolation. A dedicated observer still fans out if
its snapshot enters shared React context: consume frequent progress through a
narrow `useSyncExternalStore` hook or separate context, and prove unrelated
consumers remain untouched with render-count tests.
