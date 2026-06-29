# Dashboard GPS Recording Actions

## Intent

Recording-screen and high-accuracy point actions are isolated from Dashboard's
map, landmark, and track-list rendering. The extraction keeps the controller as
the public façade while giving transient recorder, Android battery-hint, and GPS
averaging state one React owner.

## Ownership boundary

`useDashboardGpsRecordingActions` owns:

- the recorder-screen and discard-confirmation state;
- start, pause, resume, stop, discard, and post-completion toast dispatch;
- the session-scoped Android battery-optimization hint and exemption recheck;
- the revision-driven live point snapshot and memoized recording GeoJSON;
- averaging open/held/running/stopped state, restart nonce, reset confirmation,
  tab-collapse behavior, and save/cancel transitions;
- mounted-completion guards for recording and battery requests.

The hook depends on only the required controller methods, recording state and
revision, a toast callback, a callback that opens the landmark-create flow, and
an injectable battery port. `useGpsAveraging` continues to own the location
watch, samples, clock, and GNSS provider. `GpsRecordingCoordinator` continues to
own durable recording behavior. Dashboard only wires the hook to `GpsPanel`,
`GpsMapLayers`, `DashboardGpsActivity`, and the landmark form.

The generic `useMountedRef` helper is shared with dashboard track actions so
async UI owners use one unmount-publication rule instead of copying lifecycle
guards.

## Testing and verification

The direct hook suite covers live-geometry revision changes, every recorder
control, start failures, late completions, saved and empty stops, cancellation,
battery active/exempted/dismissed states, averaging start/stop/resume/reset,
failed acquisition restarts, tab collapse, cancel, and landmark handoff. The
hook plus shared mounted guard have 100% statement, branch, function, and line
coverage. Dashboard's characterization suite verifies the same behavior across
the rendered GPS panel and activity components.

## Performance implications

The live point array is read only when `gpsTracksRevision` advances and its
GeoJSON is memoized. The hook adds no polling or timers; the averaging watch and
clock still exist only while the phase is `running`. The production module is
below 600 lines and every function is below 80 lines.
