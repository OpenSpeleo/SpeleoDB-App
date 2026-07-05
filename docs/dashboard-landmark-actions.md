# Dashboard Landmark Actions

## Intent

Landmark collection controls and mutation UI state are isolated from the
Dashboard map shell. The extraction keeps persistence and offline mutation
policy behind `SpeleoDBController` while giving collection preferences, form
state, delete state, toasts, and async publication one focused React owner.

## Ownership boundary

`useDashboardLandmarkActions` owns:

- collection visibility/collapse preferences, show-all/hide-all, and the
  memoized visible-landmarks FeatureCollection;
- panel-row locate behavior and map flight;
- map-point and averaged-GPS-point handoff into one create-form state;
- edit-form normalization, writable-collection loading, submission busy/error
  state, and mounted-completion guards;
- delete target, confirmation, busy state, typed error feedback, and late
  completion suppression;
- the shared success/error toast used by landmark and GPS action hooks.

The hook depends on only the required controller methods, selected marker
detail, collection groups, landmarks GeoJSON, map/panel callbacks, and
injectable preference writers. Durable overlay state, optimistic queue folding,
conflicts, and server transport remain controller/coordinator responsibilities.
Dashboard wires hook outputs into `LandmarkPanel`, the focused
`DashboardLandmarkDialogs`/`DashboardLandmarkFeedback` presentation boundary,
`GpsMapLayers`, and the GPS action hooks. See
`docs/dashboard-landmark-presentation.md`.

## Testing and verification

The direct suite covers preference restoration/writes, visibility filtering,
empty and populated batches, map presence/absence, toast replacement/expiry,
collection-load success/failure/unmount races, create/edit normalization,
submission guards and failures, deletion guards and typed outcomes, and late
mutation completions. The production hook has 100% statement, branch, function,
and line coverage. Dashboard's characterization suite continues to verify the
rendered long-press, marker, form, confirmation, panel, toast, and GPS handoff
flows. The presentation module has its own 100% statement, branch, function, and
line coverage.

## Performance implications

Collection filtering is memoized by GeoJSON reference and visibility state.
Writable collections still load only when a form opens. The hook adds no
polling; its only timer is the existing three-second toast expiry, which is
replaced on a new toast and cleared on unmount. The production module is below
600 lines and every function is below 80 lines.
