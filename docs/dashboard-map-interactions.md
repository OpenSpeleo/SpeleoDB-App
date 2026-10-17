# Dashboard Map Interactions

## Intent

Map pointer behavior is a state machine with timer, cancellation, MapLibre, and
depth-probe boundaries. `useDashboardMapInteractions.ts` owns that state machine
so Dashboard does not mix gesture mechanics with page, panel, GPS, and landmark
composition.

## Inputs and outputs

The hook receives the map ref, effectively visible project IDs, project names,
and the depth-probe sample/clear callbacks. It returns:

- the selected read-only marker or long-press detail;
- an explicit detail-clear action and `cancelMapInteractions` for route changes;
- the long-press loading-ring position;
- pointer start, move, end, and cancel handlers.

Map layer IDs, hit radii, movement/duration thresholds, and marker parsing stay
centralized in the existing map utility and marker-detail modules.

## Invariants

- Only touch and pen pointers become tap candidates. Mouse input remains owned
  by MapLibre.
- Marker taps and long presses fail closed below the interaction zoom or when a
  required MapLibre capability, canvas rectangle, or rendered-layer query is
  unavailable.
- Queries include only layers currently mounted in MapLibre. MapLibre rendered
  queries exclude hidden markers and filtered station types, so invisible
  content cannot open details or block an otherwise empty-map long press.
- Long press succeeds only on an empty map spot; blocking features, query
  failures, movement, cancellation, multi-touch, and stale callbacks suppress
  both the loading ring and detail publication.
- Timer handles are cleared on every terminal gesture and hook unmount. Leaving
  Dashboard also cancels the pending pointer candidate, both timers, feedback,
  and transient detail. The detail portal is masked while the route is inactive;
  returning cannot resurrect a stale sheet. Landmark authoring drafts are
  separate and preserved.
- Depth probing samples touch/pen movement and clears on terminal gestures.

## Map navigation gestures

The Dashboard constructs MapLibre with `doubleClickZoom={false}`. This disables
MapLibre's complete discrete tap/click zoom handler: mouse double-click,
one-finger double-tap zoom-in, and two-finger tap zoom-out. Triple, quadruple,
and longer tap sequences cannot change the map zoom because their repeated
double-tap subsequences are handled by the same disabled handler. MapLibre does
not assign discrete zoom actions to taps with three or more fingers.

`touchZoomRotate` remains enabled so deliberate two-finger pinch zoom continues
to work. Rotation is still disabled independently by the north-up orientation
policy. The app does not install a competing DOM or native tap recognizer, which
preserves pointer cancellation, marker taps, long press, panning, and platform
accessibility handling.

This policy owns the MapLibre camera only. System accessibility magnification,
including iOS Accessibility Zoom gestures, remains system-owned and does not
change the map's stored zoom level.

## Verification and performance

`useDashboardMapInteractions.test.tsx` plus the Dashboard characterization suite
execute every statement, branch, and function. Tests include already queued
timer races, missing map capabilities, low/invalid zoom, query failures,
movement and duration limits, touch/pen/mouse separation, multi-touch,
cancellation, marker parsing, coordinate conversion, and rejected haptics.

The Dashboard production-seam test also asserts that discrete tap zoom is
disabled in the props used to construct MapLibre while pinch zoom remains
enabled. Device verification should cover one-finger double/triple/quadruple
taps, two-finger taps, and three-or-more-finger taps, then confirm that
two-finger pinch, one-finger pan, marker tap, and long press still work.

The hook registers no global listener. It allocates at most two timers during a
single eligible pointer gesture and clears both at the first terminal event. The
MapLibre gesture policy adds no listener or per-event application work.

## Globe transition and camera ownership

A drag must keep the geographic point under the contact moving in the same
screen direction, including while zoom crosses the globe/Mercator blend (engine
zoom 11–12). North-up bearing and pitch stay zero. Fresh survey data must not
change this contract. Displayed distances depend on viewport and latitude and
are not a reliable substitute for the engine zoom when reproducing a failure.

The shared `@speleodb/map-viewer/tooling/maplibre-gestures` entry owns the
MapLibre 6.10.0 backport and artifact tests. Its
[gesture documentation](https://github.com/OpenSpeleo/SpeleoDB-TS-MapViewer/blob/master/docs/gestures.md)
explains the stale requested projection, Camera event ownership, source-map
integrity and upgrade contract. The projection and event-cleanup defects arise
with the camera update callback installed by `react-map-gl`; GeoJSON timing can
expose them but is not the cause. A further partial-release fix prevents pinch
inertia from resetting the finger still held on the map. That defect also exists
in web's engine version. Desktop mouse input in this app is affected as well as
touch.

Mobile owns only installation wiring: `scripts/patch-maplibre-gestures.mjs`
invokes the shared patch from postinstall, and Vite configuration verifies it
before dev, tests and builds. This also covers existing workspace installs that
skip a changed lifecycle script. Mapping dependencies belong to map-viewer and
stay outside the browser bundle. The version/hash guards require explicit review
during engine upgrades. Mobile retains its pinned renderer and camera,
orientation, discrete-zoom and lifecycle policies.

The app pins the published map-viewer 0.3.0 release that provides these shared
exports. Future shared changes must be published before this app's exact
registry pin and standalone lock advance. Workspace and packed-candidate
validation do not prove compatibility with previously published shared code.

## Navigation regression coverage

`tests/browser/map-gestures.spec.ts` exercises the built Dashboard, React
wrapper, real MapLibre renderer and WebGL in Chromium and WebKit. Its fixture
supplies local application/native-service data; it does not replace the
renderer, camera methods or gestures. Shared helpers from
`@speleodb/map-viewer/testing/gestures` own input delivery, anchor measurement,
source workloads and cleanup assertions used by both applications.
`useDashboardMapShell` calls the shared `announceMapCreated` helper to emit
`speleo:map-created` once per initialized map so observers can attach without
constructor replacement or a persistent application global.

The cases measure a geographic anchor after every rendered input sample with a
one-CSS-pixel per-axis tolerance, and assert north-up orientation. They cover:

- wheel zoom across the transition in both directions, followed by repeated
  up/down/left/right mouse drags, with and without fresh 12,000-feature GeoJSON;
- continuous two-finger pinch followed by translation, and a pinch-to-one-finger
  handoff, under both normal and reduced motion;
- a pause after lifting one finger, proving that the remaining contact survives
  camera settling and its first move is applied;
- a subsequent independent drag and Camera releasing its requested transform
  after movement ends (read-only inspection of the pinned engine's cleanup
  seam).

Chromium sends trusted multi-touch input through its automation protocol. WebKit
replays the same touch-contact event lists because its automation runtime cannot
construct native Touch objects; that is renderer integration coverage, not a
claim about native iOS touch delivery. The desktop sequence has a longer
explicit deadline for its 96 rendered input samples on software WebGL; there are
no retries, fixed sleeps, camera resets during a sequence, or relaxed motion
assertions.

The map-viewer package tests verify artifact integrity, source-map locations,
idempotence, partial-install recovery, cache isolation and rejection of unknown
versions/contents. Mobile retains its native-package installation tests. Run
`bun run build`, `bun run test:browser tests/browser/map-gestures.spec.ts`, and
the normal lint, full unit/coverage and browser gates. Fresh standalone and
workspace installation must also retain the patch.

Before release, repeat pinch, two-finger translation, one-finger handoff,
release/re-grab, and wheel/trackpad direction checks on supported Android
WebView and iOS devices, through the transition and at close zoom, with survey
refreshes in progress. Record OS/WebView and build identity. Browser automation
does not establish physical-device gesture arbitration, frame pacing, or
cancellation behavior during native app suspension.
