# GPS recording coordination

## Intent and ownership

GPS recording is a durable mobile state machine: permission changes, stale OS
fixes, background watcher failures, pauses, logout, and process death must never
silently lose accepted points or leave a watcher running.

`SpeleoDBController` remains the public application façade, while
`GpsRecordingCoordinator` owns:

- the `idle` / `recording` / `paused` state machine;
- active-time accounting that excludes paused wall time;
- location and notification permission sequencing;
- watcher start, stop, resume rollback, and fatal-error handling;
- stale-fix rejection and the 15-second recording cadence;
- the live point buffer and incremental crash-recovery writes;
- stop, discard, fatal-permission finalization, and logout teardown.

`GpsTrackCoordinator` supplies narrow ports for persistence serialization,
completed-track publication, and revision notification; the controller supplies
ID/name generation and time. Local and remote lists, GPX operations, server
synchronization, and offline mutation replay remain outside the recording
coordinator.

## State and persistence invariants

- A non-idle session always has an ID, name, color, and start timestamp.
- No empty track is written before the first accepted fix.
- Accepted fixes are persisted incrementally through the track coordinator's
  serialized write seam, so an older slow write cannot replace a newer point
  buffer.
- Stop waits for queued writes before publishing the finalized track.
- Discard and logout invalidate queued writes before removing or clearing the
  active session.
- A failed initial watcher start returns to `idle`; a failed resume returns to
  `paused` with the existing points intact.
- A transient watcher error does not stop recording. Authorization loss stops
  the watcher and saves any accepted points before surfacing the one-shot error.
- Callbacks delivered after logout are ignored because the session is already
  idle.

## Platform boundary

The coordinator depends only on the `LocationWatcher` contract. Native builds
receive `BackgroundGeolocationWatcher`; web and tests can use
`GeolocationWatcher` or a deterministic fake. The same `GPS.WATCH_OPTIONS` and
`shouldAcceptFix` gate are used regardless of platform, so platform adapters do
not own sampling policy.

## Verification and performance

`GpsRecordingCoordinator.test.ts` covers every statement, branch, function, and
line in the coordinator, including denied permission, no-op transitions,
start/resume rollback, stale and throttled fixes, paused timing, empty stop,
discard failure, transient/fatal watcher errors, data-preserving finalization,
and logout races. `SpeleoDBController.test.ts` retains the public-façade and real
IndexedDB characterization coverage.

Recording performs no polling. Each accepted fix causes one serialized local
write and one revision notification; fixes rejected by the shared gate cause
neither. Point-buffer updates are linear in the number of accepted points, with
the existing 15-second cadence bounding write and render frequency.
