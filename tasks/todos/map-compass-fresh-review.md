# Fresh compass adversarial review

## Scope and plan

Review `ccf3b65` against `bfcd450` independently, including the mounted map,
shared native heading lifecycle, control geometry, and authoritative tests.
Preserve the eight-label rose, sixteen-wind readout, and map-relative size cap.

- [x] Read repository rules, relevant lessons, feature docs, production code,
      and existing regression evidence.
- [x] Probe concrete remaining risks at the owning production seams, including
      rendered geometry at responsive breakpoints.
- [x] Review and narrow the corrective plan to reproduced failures; make no
      speculative changes or test-count additions.
- [x] If a failure is confirmed, demonstrate regression before correction, apply
      the smallest fix, and update relevant feature documentation.
- [x] Run focused verification and inspect staged and unstaged changes.
- [x] Root integration gate: full tests with coverage, browser checks, lint,
      type/build validation, `prek run -a`, and commit.

## Review gates and ownership

The review agent owns this file and claims corrective source/test/doc paths
before editing them. Root owns repository-wide verification and the commit.
Browser execution and builds are serialized with root to avoid shared `dist` and
preview-server races. Physical sensor accuracy is outside browser/bridge
evidence and requires real iOS and Android devices.

## Confirmed findings and reviewed corrections

**P2 — Viewport breakpoints leave overlapping map controls.**
`src/components/map/mapCompass.css`, former lines 110–131: at 401×480 and
414×480 in depth mode, expanded source credits overlap the distance scale. At
568×541 the compass overlaps the depth gauge after the short-screen rule
switches off. Both Chromium and WebKit reproduced all three failures against
unchanged `ccf3b65` production assets. At 414×480, credits occupied
approximately x81–268, y373–397 while the scale occupied x8–117, y369–399. At
568×541, the dial began at y244 while the gauge ended at y245.

The corrective plan was reviewed and narrowed to actual overlay measurement.
Expanding the arbitrary breakpoints would relocate the failure. A second plan
review caught that putting all layout ownership inside the optional compass
would regress source credits after hiding it. The final `MapControlLayout` owner
therefore remains mounted with the map, reserves measured rows/columns, and
releases observers and offsets on cleanup. Compass sizing, sensor ownership, and
its eight-label design stay unchanged. Unit tests prove the new effect and
observer lifecycle; browser tests prove layout at the real rendering seam. Final
integration review added explicit editor-toolbar visibility to the layout
lifecycle: an already-hidden compass must still replace its toolbar observation
after editing unmounts and recreates the toolbar. A focused ownership test and
real browser Edit → Cancel → short-viewport resize sequence prove this case.

**P2 — Resuming the hook briefly commits the previous session's heading.** Root
independently reproduced this in `src/hooks/useDeviceHeading.ts`: after 260° →
inactive → active, a layout-effect probe observed committed values `[260, null]`
before any fresh sample. The previous subscription's cleanup now clears retained
heading state. The regression captures committed values before passive
subscription effects can hide the stale render. Root owns this fix, its focused
test, the shared-heading documentation, and the related lesson.

## Verification and limitations

- Red-before browser probes:
  `npm run test:browser -- --project=chromium -g 'compass stays above sources and clear of map controls at (400x480|401x480|414x480|390x540|390x541|568x541)'`:
  three reproduced failures and three passing boundary probes. The matching
  WebKit command restricted to 401×480, 414×480, and 568×541 reproduced all
  three failures independently.
- `npm run build`: passed with the measured layout implementation.
- `npm run test.unit -- --run src/components/map/MapControlLayout.test.tsx src/components/map/MapCompass.test.tsx src/pages/Dashboard.test.tsx`:
  **161 tests passed**, including the final editor-toolbar ownership case. The
  Dashboard map mock now exposes the same `useMap` boundary as production;
  actual geometry is verified in the browser.
- `npm run test:browser -- -g 'compass stays above sources and clear of map controls|map controls reflow'`:
  **22 Chromium/WebKit checks passed**, including hidden compass, changed depth
  mode, expanded/collapsed credits, resizing, reclaimed corner space, and
  assertions rejecting page/ResizeObserver errors. Temporary diagnostic cases
  were narrowed to boundary regressions plus one interaction sequence.
- After adding editor-toolbar replacement coverage,
  `npm run test:browser -- -g 'map controls reflow'`: **both Chromium and WebKit
  passed** against the final rebuilt production assets.
- Focused ESLint and `git diff --check`: passed. Reviewed unstaged changes and
  root's staged corrective diff; the review agent did not stage or commit.
- Root hook verification: **176 tests across five files plus ESLint passed**.
- Preventive layout rule updated in
  [map-control-layout](../lessons/map-control-layout.md): reserve actual overlay
  geometry, keep optional-overlay layout ownership independent, and refresh
  observed DOM elements when editing replaces them.
- Final repository gates and commit reference are filled in by root below.
- These changes do not alter native APIs, persistence, or network behavior.
  Native compilation cannot establish physical sensor accuracy; physical iOS and
  Android heading/orientation evidence remains unavailable in this session.

## Root integration review

- `npm run test:ci`: **127 files / 2,084 tests passed** on the final production
  implementation. Coverage: statements 90.54%, branches 83.10%, functions
  92.83%, lines 92.66%; all enforced thresholds passed.
- `npm run quality:inventory`: all **672 tracked files** classified.
- Inspected narrow-screen screenshots in WebKit (320×400, 401×480) and Chromium
  (568×541); labels remain readable and controls remain clear.
- Initial `prek run -a` passed lint, type checking, and production build;
  documentation formatting was applied and requires a clean final rerun.
- Initial full browser execution passed **73/74** cases. The pre-existing
  offline-list scroll test captured its starting thumb position before the
  browser delivered the reset scroll event. The retained Chromium trace shows
  `translateY(76px)` before measurement, then `translateY(0px)` immediately
  afterward, and `translateY(76px)` after scrolling down. The corrective plan is
  to assert the rendered thumb has reached the rail's top before capturing its
  start, preserving the existing movement assertion. No retries, sleeps, skips,
  or relaxed assertions are introduced. Verify both engines, then rerun the
  complete browser suite.
- `npm run test:browser -- -g 'long offline area lists scroll'`: **both engines
  passed** after synchronization. The review agent independently checked this
  test-only correction and found no actionable concern.
- Final `npm run test:browser`: **74/74 Chromium and WebKit tests passed** with
  retries disabled, including the complete offline-map and login regression
  suites. No production edits were needed for the scrollbar-test correction.
- Final `prek run -a`: **passed**, including repository-wide ESLint, TypeScript,
  production build, formatting, lockfile consistency, and applicable hygiene
  checks. Inspected staged and unstaged diffs; both whitespace checks passed.
- No confirmed review findings remain unresolved. Native files and dependencies
  were not changed; physical sensor validation remains the limitation above.
- Corrective commit: `Fix compass resume state and map control collisions`,
  based on `ccf3b65`; this review is included in that commit. Its resulting hash
  is recorded in the final handoff.
