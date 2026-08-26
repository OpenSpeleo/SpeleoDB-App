# Disable Discrete Map Tap Zoom

## Goal

Prevent double, triple, quadruple, and longer tap/click sequences from changing
the Dashboard map zoom, regardless of whether the sequence uses one or multiple
fingers. Preserve deliberate continuous map navigation: one-finger pan,
two-finger pinch zoom, and the existing north-up rotation lock.

## Root-cause gates

- [x] Trace the behavior to MapLibre's enabled-by-default
      `DoubleClickZoomHandler`, not the Dashboard pointer state machine or
      native iOS editing gestures.
- [x] Confirm the handler owns mouse double-click, one-finger double-tap
      zoom-in, and two-finger tap zoom-out.
- [x] Confirm triple and longer tap sequences only change zoom because they
      contain one or more recognized double-tap subsequences.
- [x] Confirm browser page scaling is already disabled by the application
      viewport and MapLibre touch-action policy.

## Implementation gates

- [x] Disable MapLibre `doubleClickZoom` at the `DashboardMapCanvas` map
      construction seam.
- [x] Keep `touchZoomRotate` enabled so two-finger pinch zoom remains available;
      do not add touch interception or private MapLibre handler access.
- [x] Add a Dashboard production-seam test that asserts the MapLibre option and
      preserved pinch interaction contract.
- [x] Update canonical map-interaction documentation with intent, ownership,
      compatibility, verification, and performance implications.

## Verification gates

- [x] Run the focused Dashboard test suite.
- [x] Run lint, type checking, production build, and the complete Vitest suite
      with coverage.
- [x] Run `prek run -a`, recording unrelated baseline failures without adopting
      out-of-scope rewrites.
- [x] Run final diff and repository-hygiene checks.
- [ ] Record physical-device checks for one-finger and multi-finger tap
      sequences, or leave the release evidence gate explicitly open.

## Locked decisions

- `doubleClickZoom={false}` is the public MapLibre option that owns both mouse
  double-click and discrete touch tap zoom.
- Do not disable `touchZoomRotate`; that would also remove intentional pinch
  zoom.
- Do not implement a custom tap recognizer. MapLibre already owns this gesture
  classification, and a competing recognizer would risk map pan, long-press, and
  marker-tap regressions.
- The policy is cross-platform because the same Dashboard map configuration is
  used by iOS, Android, and browser/PWA builds.

## Review

### Result

- `DashboardMapCanvas` passes `doubleClickZoom={false}` to MapLibre, disabling
  its mouse double-click, one-finger double-tap, and two-finger tap zoom paths.
- `touchZoomRotate` is explicitly enabled, preserving two-finger pinch zoom.
- No DOM/native recognizer, event listener, or private MapLibre access was
  added.
- The shared Dashboard map configuration applies on iOS, Android, and
  browser/PWA builds.

### Automated verification

- `npx vitest run src/pages/Dashboard.test.tsx` — passed all 113 tests.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; Vite transformed 619 modules.
- `npm run test:ci` — passed 118 files and 1,937 tests, with 90.53% statement,
  82.19% branch, 93.27% function, and 92.67% line coverage.
- `prek run -a` — all non-formatting hooks passed. Its global Markdown hook
  exposed pre-existing drift in six unrelated tracked documents; those
  out-of-scope rewrites were reverted. The task-owned Markdown files pass the
  same formatter directly.

### Physical-device evidence and limitations

No new physical-device evidence was recorded. The production-seam test proves
the MapLibre construction policy, while a real iOS and Android device should
still verify the tap matrix and preserved pinch/pan/marker/long-press behavior.
System accessibility screen magnification is outside MapLibre's map-camera
policy. Native Xcode and Gradle builds were not rerun because no native source,
project configuration, plugin, or platform API changed; the shared WebView
bundle was type-checked, built, and tested directly.
