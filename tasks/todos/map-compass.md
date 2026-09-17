# Map compass

## Objective and accepted scope

Add a fourth map action below Offline Maps that toggles a compact device-heading
compass above the bottom-right source credits. Proceed from plan to
implementation without an approval pause, as explicitly requested. Default off;
retain the toggle in the mounted Dashboard session, with no new stored
preference.

## 1. Analysis and integration

- [x] Read map shell, heading, layout, coding rules, and relevant lessons.
- [x] Obtain independent integration and UX reviews before implementation.
- [x] Reuse `useDeviceHeading` / `DeviceHeadingService`; preserve location-cone
      ownership, north-up map orientation, and existing native permission
      behavior.
- [x] Gate compass subscription on route/app visibility; hide and release its
      subscription during area editing, retaining the user's toggle choice.
- [x] Mount through MapLibre's bottom-right control flow so source credits can
      expand below it. Remove the control and subscription on unmount.

Gate: Dashboard integration tests prove independent toggling, sharing,
suspension, resumption, and absence of app location-watch/camera/recording side
effects.

## 2. UX and design

- [x] Append a matching 44px control; active cyan fill, crossed compass icon
      when visible, action label Show compass / Hide compass, keyboard focus and
      pressed state.
- [x] Build a roughly 172px slate dial with eight upright rose labels and all
      sixteen wind directions in the center, restrained cyan heading pointer,
      north accent, tick marks, prominent rounded 0–359° readout, and current
      abbreviated direction.
- [x] Show a neutral dash and “No heading” when sensor data is unavailable;
      never substitute map bearing or GPS course. Keep SVG detail decorative and
      expose a readable accessible heading without continuous live
      announcements.
- [x] Preserve map gestures with a pointer-transparent overlay, wrap-safe
      pointer motion, reduced-motion support, and readable short-screen layout.

Gate: rendered Chromium and WebKit checks for toolbar geometry, expanded source
credits, short screens, safe-area insets, toggle appearance and screenshots.

## 3. Implementation

- [x] Add a small isolated compass component and MapLibre control adapter; keep
      frequent heading updates outside Dashboard/map-layer rendering.
- [x] Integrate visibility state and toggle into the existing canvas/chrome.
- [x] Add component regression tests for all 16 directions, degree
      normalization, north crossings, unavailable readings, lifecycle and
      control cleanup.
- [x] Add Dashboard regression tests at the real heading-service boundary.
- [x] Add browser regression coverage against the shipped app.

Ownership: primary agent owns production code, component tests, documentation
and integration; integration specialist owns Dashboard test additions; UX
specialist owns browser test additions. No overlapping file edits.

## 4. Documentation

- [x] Document intent, UI semantics, heading source, lifecycle, ownership,
      accessibility, performance and verification in `docs/map-compass.md`.
- [x] Link the feature from map-shell/heading documentation and docs index.
- [x] Record exact verification results, limitations and commit status below.

## 5. Testing and final review

- [x] Focused component, Dashboard, existing heading hook/service tests.
- [x] Repository lint, TypeScript and production build.
- [x] Complete unit/integration suite with coverage.
- [x] Chromium and WebKit browser tests after all build writers finish.
- [x] Inspect screenshots and staged/unstaged diffs; check button/source rules.

Native scope: no native files, bridge APIs or dependencies are planned to
change. Existing native heading is reused; iOS plugin may start its existing
Core Location updates to obtain true heading. Native compilation alone cannot
prove accuracy. Physical iOS/Android rotation, authorization, north crossing and
background/return remain device verification requirements; record whether
devices were available. Storage/network integration layers need no new
feature-specific cases because this feature introduces no persistence or network
operations.

## Review

Implemented with independent integration and UX specialists. Native source,
dependencies and storage/network contracts are unchanged. Corrected the
preexisting heading documentation's package version to match the current
manifest (8.1.20).

### Commands and results

- `npm run lint` — passed repository-wide, including browser tests.
- `npm run typecheck` — passed.
- `npm run build` — passed; repeated after the responsive layout correction.
- `npm run test.unit -- --run src/components/map/MapCompass.test.tsx src/pages/Dashboard.test.tsx src/services/DeviceHeadingService.test.ts`
  — 154 tests passed after the initial responsive layout edits.
- `npm run test:ci` — 125 files / 2,062 tests passed; statements 90.47%,
  branches 83.04%, functions 92.74%, lines 92.61%. Log:
  `/tmp/speleodb-compass-test-ci.log`. Final subsequent production changes were
  limited to responsive CSS, the depth-mode class and gauge placement, verified
  with focused tests and the production build/browser run.
- Initial focused browser run — 10/10 passed. Screenshot review additionally
  caught attribution/toolbar overlap in landscape; review identified depth-gauge
  clearance. Shifted the entire attribution/compass stack on short screens and
  added rendered overlap assertions and a depth-mode landscape case.
- `npm run test:browser` — 48/48 passed in Chromium and WebKit with zero
  retries.
- Final
  `npm run test:browser -- tests/browser/offline-maps.spec.ts --grep 'compass|map controls share geometry'`
  — 12/12 passed after the final depth-gauge clearance correction. The last
  change moved the gauge beside the toolbar and shifted the short-screen
  depth-mode compass/credits farther left. Browser assertions cover all toolbar
  buttons, the gauge, compass, credits and scale; final screenshots were
  inspected in both browser engines. Repository lint and production build also
  passed again.
- `git diff --check` — passed. Both staged and unstaged diffs reviewed; staging
  area remains empty. Button-fill guard returned no matches; no Source/Layer
  ownership changed.

### Visual review and limitations

Inspected WebKit portrait (390×844) and landscape depth mode (568×320)
screenshots. The final dial uses upright labels with clear center readout;
source credits remain below it and controls remain reachable. Browser artifacts
live in `test-results/`. Browser heading events are emulated at the native
bridge boundary, so these are rendering/integration results, not physical-sensor
evidence.

`adb devices -l` found no Android device. `xcrun devicectl list devices` found a
connected iPhone 15 Pro Max, but no device installation or physical rotation
test was performed. Physical iOS/Android accuracy, authorization, orientation
and background-return checks remain unverified. Native
build/unit/instrumentation layers were not rerun because no native
implementation, generated assets, plugin patches, APIs or dependencies changed;
they cannot prove physical heading accuracy in any case. No new storage/network
integration cases are needed because there are no feature-owned storage writes
or network requests.

The user subsequently requested an adversarial review, complete tests, `prek`
and a commit. That verification and commit are tracked below.

### Review refinement: simpler rose

User requested removing three-letter directions from the rose while retaining
them in the center. The rose now labels only N, NE, E, SE, S, SW, W and NW; the
center continues to select all sixteen directions. Existing component and
browser assertions now verify this distinction. No lifecycle or layout changes.
Verification: `npm run lint` and `npm run build` passed; the focused browser
command above passed 12/12 checks in Chromium and WebKit. Inspected the updated
portrait screenshot. `npm run test:ci` passed all 2,062 tests with coverage
(log: `/tmp/speleodb-compass-rose-test-ci.log`); `git diff --check` passed.

### Adversarial review and commit gate

Invoked the
[review-agent skill](/Users/jonathan/.agents/skills/review/SKILL.md). The user
challenged the sufficiency of test evidence. Repository-wide pass counts are not
evidence for individual compass failure scenarios: expanded coverage focuses on
deferred native promises, retired callbacks, cancellation, actual browser
interactions and constrained layout. The corrective plan and reproduced finding
are in [map-compass-review.md](map-compass-review.md).

- [x] Add Dashboard startup failure/recovery, invalid samples, render isolation,
      and startup cancellation through hide/route/background; component
      StrictMode cleanup. Focused component + Dashboard run: 156 tests passed.
- [x] Integrate the reviewer's service race fix and deterministic regression
      tests.
- [x] Integrate deeper browser interactions and inspect any layout regressions.
- [x] Run full coverage tests and `prek run -a` on all feature files.
- [x] Run the full browser suite against stable assets after all build hooks.
- [x] Review staged and unstaged diffs and commit the complete reviewed feature.

### Final sizing requirement

The user additionally requires the compass never exceed 40% of the map width.
The control now measures and observes its map container, setting the diameter to
`min(172px, floor(mapWidth * 0.4))`; the numeric readout scales with it. A
component test verifies container measurement, fractional widths, the maximum
diameter and observer removal. Browser assertions cover the cap in every
geometry case and live wide/narrow viewport plus container-only resizing without
restarting the sensor. The reviewer found no further actionable sizing/lifecycle
issue.

Final verification after the sizing refinement:

- `npm run test:ci`: **125 files / 2,079 tests passed**, with coverage of 90.50%
  statements, 83.07% branches, 92.81% functions and 92.62% lines. Log:
  `/tmp/speleodb-compass-final-test-ci.log`.
- Focused production browser checks: **30 passed** across Chromium and WebKit.
- `npm run test:browser`: **66 passed**, with zero failures, skips or retries.
  The run used stable build output; no hook/build ran concurrently with it.
- New browser cases prove keyboard/focus behavior, route cleanup, startup
  failure/recovery, actual north-crossing CSS interpolation, real map dragging,
  expanded-credit clearance, and viewport/container resizing under the width
  cap.
- Inspected final portrait screenshots at 390px and 320px widths: the dial is
  156px and 128px respectively; labels, source credits, depth gauge and scale
  remain readable and do not overlap.
- `prek run -a`: all applicable hooks passed after formatting corrections. The
  first invocation corrected Markdown formatting and caught a new test-fixture
  promise type mismatch, which was corrected to the actual `Promise<void>`
  contract.
- Both actionable review findings are fixed: stale native callbacks and narrow
  source-credit/scale overlap. Physical-device accuracy remains unverified.
- Commit scope: all sixteen feature, regression-test, documentation and task
  files; base commit `bfcd450`. Commit message:
  `Add responsive map compass with shared heading lifecycle`. The final commit
  hash is reported in the handoff.
