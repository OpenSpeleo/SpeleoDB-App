# Compass adversarial review

## Scope and corrective plan

Review the complete pending compass feature, simplified eight-label rose,
Dashboard integration, shared heading ownership, documentation, and tests.
Preserve the approved design and sixteen-wind center readout.

- [x] Read repository rules, relevant lessons, feature docs, and staged plus
      unstaged changes; review correctness, lifecycle, compatibility, privacy,
      complexity, and test evidence.
- [x] Review the corrective plan against feature scope: fix only a reproducible
      shared-heading lifecycle race; do not expand native APIs or permissions.
- [x] Prove the stale-listener failure with deterministic production-service
      regression tests before changing implementation.
- [x] Fence retired native callbacks and prevent readings with no consumers from
      being cached; update the shared-heading architecture documentation.
- [x] Run focused heading, compass, and Dashboard tests and inspect the final
      corrective diff.
- [x] Root integration gate: complete automated suite, browser tests, lint,
      type/build validation, `prek run -a`, staged-diff review, and commit.

## Actionable finding

**P2 — Retired native callbacks can resurrect a stale compass reading.**
`src/services/DeviceHeadingService.ts`, native callback and stop lifecycle:
`stopNativeListener` clears the cache before awaiting asynchronous native stop,
but the callback remains registered until stop completes. An in-flight event
therefore repopulates the empty cache. Reopening the compass replays that old
reading before the new listener emits; a late callback from a retired listener
can also replace the new session's heading. Guard callbacks with a listener
generation invalidated before stop and on failed startup, and ignore events
without subscribers.

## Review results

**P2 — Expanded source credits overlap the distance scale on narrow depth
maps.** The short-screen offset in `src/components/map/mapCompass.css` shifted
the source credits into the scale's column. Both Chromium and WebKit reproduced
the overlap at 320×480 with depth mode, nonzero safe-area insets and expanded
attribution. The fix reserves a 44px bottom row for the scale on narrow, short
screens. Additional 320×480 project mode and 320×400 depth boundaries now pass.
This preserves the full-size dial and its eight-label design.

- Red-before evidence:
  `npm run test.unit -- --run src/services/DeviceHeadingService.test.ts`
  produced two failures: the resumed subscriber received 120 instead of null
  during delayed stop, and a removed listener overwrote the current 260 reading
  with 90.
- After the correction, the service suite passes all 14 tests. Additional cases
  cover final-unsubscribe delivery before teardown, cancellation during native
  start, replacement subscribers during listener registration and sensor start,
  rejected registration/start and recovery, failed teardown and recovery,
  idempotent unsubscribe, and cancellation while listener removal is pending.
- The corrective implementation adds only callback-generation checks and
  invalidation; listener sharing, native options, and public APIs stay intact.
- Preventive rule:
  [retire native callbacks before asynchronous teardown](../lessons/native-listener-generations.md).
- Focused integration command:
  `npm run test.unit -- --run src/services/DeviceHeadingService.test.ts src/components/map/MapCompass.test.tsx src/pages/Dashboard.test.tsx`:
  **3 files, 170 tests passed** after corrections and expanded integration
  cases.
- `npx eslint src/services/DeviceHeadingService.ts src/services/DeviceHeadingService.test.ts`
  and `git diff --check`: passed.
- Root final integration: 2,079 unit/integration tests with coverage and 66
  browser checks passed; the final `prek run -a` and commit gate are tracked in
  [the feature review](map-compass.md). Physical sensor accuracy and device
  orientation remain device verification limitations; mocked bridge tests cannot
  establish them.

## Subsequent width constraint

The user capped the dial at 40% of actual map width, with 172px as the absolute
maximum. Container resize observation updates the diameter without remounting
the sensor. A bounded adversarial review found no further actionable issue.
Component tests verify sizing and observer cleanup; real browser tests cover
viewport and fractional container-only resizing with heading continuity and a
single native listener.
