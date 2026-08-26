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
- an explicit detail-clear action;
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
- Queries include only layers currently mounted in MapLibre.
- Long press succeeds only on an empty map spot; blocking features, query
  failures, movement, cancellation, multi-touch, and stale callbacks suppress
  both the loading ring and detail publication.
- Timer handles are cleared on every terminal gesture and hook unmount.
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
