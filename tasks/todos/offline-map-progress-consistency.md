# Offline Map Progress Consistency

## Implementation gates

- [x] Derive aggregate completed progress from the same normalized per-layer
      counters shown in Settings.
- [x] Clamp persisted generation progress to its declared total when publishing
      active coverage, preventing legacy/corrupt counters above 100% from
      masking another layer's deficit.
- [x] Keep retained usable coverage internal to rolling refresh and expose only
      **Tiles synced** as the user-facing coverage counter.
- [x] Add regression tests for contradictory aggregate/per-layer snapshots and
      rolling-refresh coverage visibility.
- [x] Update Settings and tile-cache documentation.

## Verification gates

- [x] Run focused engine, store, provider, and Settings tests.
- [x] Run lint, typecheck, production build, and complete CI.

## Review

The inconsistency came from rendering two independently trusted numerators:
`OfflineMapSyncSnapshot.completedTiles` for the overall row and raw layer
generation counts for each layer. A persisted over-count in one layer could
therefore cancel a deficit in another and show overall 100% beside layer 99%.

The engine now bounds every published/checkpointed completed and failed count to
the layer total, and derives aggregate operation completion from those layer
values. Settings independently enforces the same display invariant, so one
snapshot cannot render contradictory aggregate and layer progress.

The retained-coverage row was subsequently removed at user request. **Tiles
synced** is the only user-facing coverage counter; retained-generation state
remains internal to rolling-refresh safety.

Verification:

- `npm run test.unit -- --run src/services/OfflineMapSyncEngine.test.ts src/services/OfflineMapSyncStore.test.ts src/context/SpeleoDBProvider.test.tsx src/pages/Settings.test.tsx`
  — 4 files, 92 tests passed.
- Focused ESLint and `npm run typecheck` — passed.
- `make ci` — 106 files, 1,784 tests passed with coverage; production build
  completed.

No native code changed, no device evidence was required for the deterministic
counter invariant, and no commit was created. The reusable aggregate/per-layer
rule is recorded in `tasks/lessons/streaming-plan-denominators.md`.

### Adversarial correction (2026-07-01)

Clamping only at publication did not repair corrupt durable counters. Preload
now normalizes and persists only invalid generation totals/completed/failed
values. Snapshots include audited and queued counters, cancellation clears
queued work, and completed/failed remain mutually exclusive within each layer
total. Settings shows **Preparing…** before a denominator exists and renders
failed coordinates overall and per affected layer. Historical suite counts above
do not replace the corrected-tree verification in the adversarial review.
