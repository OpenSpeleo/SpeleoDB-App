# Dashboard Map Shell

## Intent

The Dashboard map shell owns platform-facing map presentation without owning
project, landmark, or GPS domain state. `DashboardMapCanvas` composes MapLibre,
map chrome, and the location error surface; `useDashboardMapShell` owns the
small asynchronous state machine behind that presentation.

This boundary keeps `Dashboard.tsx` as a domain-orchestration façade while
preventing map-style, native location, icon, and viewport concerns from
expanding the page component.

## Ownership

The shell owns:

- cached map-style loading for the selected layer;
- validation, persistence, and publication of map-layer selection;
- north-up orientation locking when MapLibre reports ready;
- one-pass overlay icon registration and availability publication;
- finite zoom/latitude metrics for the distance scale;
- foreground location permission, current-position acquisition, map flight,
  the user-location layer value, light haptic feedback, and error dismissal;
- MapLibre viewport composition and the My Location/layer-control chrome; and
- map loading, distance-scale, depth-gauge, and geolocation-error surfaces.

`Dashboard.tsx` supplies already-derived project, overlay, GPS, depth, and
gesture inputs. The focused layer components still own their source/paint
declarations, and `useDashboardMapInteractions` still owns pointer timers and
marker selection. The shell does not read controller state, caches, or domain
preferences.

Native and storage calls are represented by `DashboardMapShellDependencies`.
The production defaults connect Capacitor, `TileCacheService`,
`PreferencesService`, and the map utility boundary; tests inject the same
narrow contract directly.

## Invariants

- A superseded style success cannot replace the currently selected style.
- Unknown layer identifiers fall back to the canonical default before either
  persistence or shared-shell publication.
- Invalid or unchanged move events do not publish new viewport metrics.
- Orientation locking occurs before asynchronous icon registration starts.
- Icon availability becomes ready only after the complete registration pass.
- Permission denial never requests a position and is represented by the shared
  permission-denied error sentinel.
- A successful position is retained even when the MapLibre ref is temporarily
  unavailable; map flight is optional, while haptic failure is non-fatal.
- Location and style failures reach the existing redacted diagnostic and modal
  boundaries; raw coordinates are never logged.

## Performance

The extraction adds no request, listener, timer, or render loop. Map style
loading remains keyed only by layer selection. Icon registration remains a
single sequential pass on map load. Distance-scale state updates only for
finite, changed zoom/latitude pairs, avoiding redundant React publications.

`Dashboard.tsx` is 584 lines after the extraction. The canvas and hook are 248
and 183 lines respectively, and every production function remains below 80
lines.

## Verification

`useDashboardMapShell.test.ts` directly covers style success/failure and stale
completion, icon readiness and missing refs, valid/fallback layer selection,
viewport filtering, denied/granted/failed location paths, missing map refs,
native defaults, and rejected haptics. Together with the Dashboard
characterization suite it executes every statement, branch, function, and line
in both new production modules. `Dashboard.test.tsx` remains the integration
seam for actual layer composition, pointer forwarding, chrome, depth/scale,
offline selection, location modal behavior, and orientation locking.
