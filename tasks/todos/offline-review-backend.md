# Offline download backend adversarial review

## Scope and gates

- [x] Read the complete uncommitted service, storage, planner and type changes,
      alongside the existing lifecycle tests and geometry identity contract.
- [x] Reproduce actionable failures at the production service/storage seam.
- [x] Review the smallest corrective plan against cancellation, pin ownership,
      unchanged-geometry reuse and enabled-layer consistency before editing.
- [x] Implement confirmed corrections and focused regression coverage only.
- [x] Run focused service, planner and storage tests; report evidence to the
      integrating reviewer for full-suite verification and commit.

## Confirmed finding and reviewed corrective plan

P2: `cornersForBounds` padded raw source latitudes before clamping. Valid
geographic sources above 85.0511287798066 degrees (or below its negative) become
zero-height rectangles, and one such source rejects the complete catalog
transaction, including ordinary sources. The production service regression fails
with `Offline map settings contain an invalid area.`

Clamp each source latitude to the representable map before applying the existing
buffer, then clamp the expanded bounds. This retains a positive edge strip,
preserves ordinary coordinates and retains centralized geometry handling for
projects, tracks and points. Verify both poles, the generated tile counts, and
mixed ordinary/polar sources through the real planner/engine/IndexedDB pipeline.
No changes to lifetime, cancellation, preference or pin ownership are needed.

## Review

- Before fix: production service test failed at catalog validation with ordinary
  and ±89° landmarks in the same reconciliation. Evidence:
  `/tmp/offline-review-polar-before.log`.
- After fix:
  `npm run test.unit -- --run src/services/DownloadAreaService.test.ts src/services/downloadAreaGeometry.test.ts src/services/OfflineMapPlanner.test.ts src/services/OfflineMapSyncEngine.test.ts src/services/tileCache/TileCacheRepository.test.ts`
  — 89 tests, five files, passed. Evidence:
  `/tmp/offline-review-backend-tests.log`.
- The fix is projection math shared by every automatic source; native lifecycle
  changes and physical-device evidence are not required for this correction.
- No other confirmed backend findings. Reviewed atomic enabled-layer activation,
  shared pin ownership, manifest invalidation, interrupted requests, persisted
  plan reuse, and legacy coverage retention.
- The integrating reviewer owns full-repository validation and the final commit;
  no separate backend commit was made.
