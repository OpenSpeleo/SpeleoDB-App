# Offline Map Progress Tuning

## Implementation gates

- [x] Reproduce the frozen **Tiles synced** value through the real
      engine-to-React subscription seam and identify the root cause.
- [x] Make committed/audited tile progress visible without polling or durable
      checkpoint coupling.
- [x] Format remaining time using non-zero hours/minutes/seconds, hiding seconds
      whenever minutes or hours are shown.
- [x] Add focused regression tests for live subscription updates and ETA
      display.
- [x] Update Settings/offline-map documentation for the display behavior.

## Verification gates

- [x] Run focused store, provider, controller, and Settings tests.
- [x] Run lint and TypeScript/build validation.
- [x] Run the complete automated suite or document any limitation.

## Review

The progress snapshot had been added to the app-wide `SpeleoDBContext` value.
That made each paint-cadence tile event rerender every context consumer instead
of only Settings. `useOfflineMapSync()` now subscribes Settings directly to the
dedicated store, and the global context no longer carries the high-frequency
snapshot. The paint scheduler also has a 50 ms one-shot fallback for mobile
WebViews that defer `requestAnimationFrame` during Ionic transitions.

ETA display now uses the largest useful units: seconds below one minute, minutes
below one hour, and hours with non-zero minutes above one hour. Seconds are
hidden whenever minutes or hours are present.

Verification:

- `npm run test.unit -- --run src/services/OfflineMapSyncStore.test.ts src/context/SpeleoDBProvider.test.tsx src/pages/Settings.test.tsx src/controllers/TileCoordinator.test.ts`
  — 4 files, 81 tests passed.
- `npm run lint -- src/context/useSpeleoDB.ts src/context/SpeleoDBStoreProvider.tsx src/context/SpeleoDBProvider.test.tsx src/pages/Settings.tsx src/pages/Settings.test.tsx src/services/OfflineMapSyncStore.ts src/services/OfflineMapSyncStore.test.ts`
  — passed.
- `npm run typecheck` — passed.
- `make ci` — 106 files, 1,778 tests passed with coverage; production build
  completed. The first sandboxed attempt could not resolve `stage.speleodb.org`;
  the network-enabled rerun passed.

No native code changed. Physical-device timing remains part of the parent
offline-map rearchitecture acceptance work; this correction is covered at the
real external-store/React subscription seam. No commit was created.

Reusable prevention is captured in
`tasks/lessons/serialized-resource-hot-paths.md`.

### Adversarial correction (2026-07-01)

The first scheduler still retained a stale cancellation handle when mocked RAF
ran synchronously, and one throwing listener could interrupt notification. The
store now handles synchronous/frozen RAF, repeated publication, disposal,
listener snapshot/add/remove semantics, and exception isolation. The 50 ms
fallback is covered deterministically, while physical-device publication p95
remains a release measurement rather than an inferred result. Current command
evidence is centralized in the adversarial review.
