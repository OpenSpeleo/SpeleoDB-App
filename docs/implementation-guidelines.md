# Implementation Guidelines

This document defines high-level architecture boundaries and coding expectations for feature work in this repository.

## Goal

- Keep behavior predictable across offline and online scenarios.
- Keep state ownership clear so features are easy to test and reason about.
- Keep docs, implementation, and tests aligned in the same change.

## Architecture boundaries

- `src/context/` is the React bridge layer. Providers subscribe to controller state and expose it to components. Startup/offline/onboarding presentation orchestration belongs in dedicated UI coordinators/hooks (for example `src/context/useStartupUiCoordinator.ts`), not inline inside a large provider body.
- `src/controllers/` owns app state transitions and business decisions.
- `src/services/` performs side effects (HTTP, cache persistence, map tile operations).
- `src/pages/` and `src/components/` render UI and trigger controller actions. They should not duplicate controller business logic.
- `src/services/tileCache/` contains lower-level storage/maintenance primitives used by higher services.

## State ownership

- Treat `SpeleoDBController` as the source of truth for auth, offline lock, sync, and retry state.
- Avoid parallel state machines across UI and services for the same behavior.
- UI local state is acceptable for presentation-only concerns (modal visibility, form state, layout state).
- UI coordinators may use reducer-backed local state for startup/offline/onboarding flows, but they must translate controller snapshots into presentation state rather than owning auth/offline truth themselves.
- Default SpeleoDB instance prefill is a login-form concern only. Services, controller, and persisted preferences must not auto-inject a fallback instance.

## Networking and offline rules

- Do not add passive `window` `online`/`offline` listeners for reconnect orchestration.
- Explicit reconnect paths are limited to app relaunch startup validation,
  Settings **Go Online**, and Pending Changes **Try Reconnect**.
- Timeout/transport/non-`4xx` auth failures must preserve session and local cache.
- Only auth-invalid `4xx` outcomes should trigger logout and local data purge.
- When offline lock is active, normal data/map flows should avoid outbound network calls.

## Service layer expectations

- Services should be deterministic and prefer dependency injection for external concerns (time, network gates, storage).
- Prefer narrow interfaces and explicit return types for side-effecting functions.
- Keep cache fallbacks and network retries inside service/controller orchestration, not in UI components.
- Long-running IO paths should accept `AbortSignal` when they participate in startup validation, sync, or logout-sensitive flows.

## TypeScript and code style

- Prefer explicit types for public APIs and cross-layer contracts.
- Keep naming consistent with responsibility (`*Controller`, `*Service`, `*Provider`).
- Avoid hidden global coupling; pass dependencies where practical.
- Add small comments only for non-obvious behavior or invariants.

## Error handling

- Fail safely for user-facing flows: preserve usable local state when remote calls fail.
- Use best-effort writes for non-critical caches when appropriate.
- Do not swallow errors that determine auth/offline correctness.
- Cancellation is not an error fallback. Once a controller-owned run is aborted, stale IO completions must not publish state, cache writes, or prefetch jobs.

## Testing expectations

- Add or update tests for every behavior change in controller/service orchestration.
- Prefer focused unit tests around controller decisions and service fallbacks.
- Keep provider/dashboard tests for user-visible contracts (offline modal, Settings sync).
- Include regression coverage when fixing edge cases (timeouts, retries, offline lock transitions).

## Change checklist

1. Verify behavior changes are reflected in `docs/`.
2. Verify controller remains the source of truth for auth/offline decisions.
3. Verify reconnect behavior stays explicit and user-driven.
4. Run targeted unit tests for touched paths.
5. Run `npm run build` for type and dead-path validation.

## Related docs

- `docs/networking.md`
- `docs/offline-mode.md`
- `docs/logout-behavior.md`
