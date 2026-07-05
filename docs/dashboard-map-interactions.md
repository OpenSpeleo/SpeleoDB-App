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

## Verification and performance

`useDashboardMapInteractions.test.tsx` plus the Dashboard characterization suite
execute every statement, branch, and function. Tests include already queued
timer races, missing map capabilities, low/invalid zoom, query failures,
movement and duration limits, touch/pen/mouse separation, multi-touch,
cancellation, marker parsing, coordinate conversion, and rejected haptics.

The hook registers no global listener. It allocates at most two timers during a
single eligible pointer gesture and clears both at the first terminal event.
