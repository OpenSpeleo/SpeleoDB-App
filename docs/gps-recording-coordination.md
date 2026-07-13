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

All native/state transitions enter one coordinator-owned promise lane. Admission
is synchronous: compatible overlapping commands with the same key (start, pause,
resume, same-name stop, discard, fatal callback, or logout) share the exact
in-flight promise/result, while incompatible commands execute in invocation
order and validate state only when admitted. Commands outside their allowed
state reject with `GpsRecordingTransitionError` instead of silently doing
nothing. The lane absorbs prior rejection for scheduling purposes, so one native
failure cannot poison later recovery.

`GpsTrackCoordinator` supplies narrow ports for persistence serialization,
completed-track publication, and revision notification; the controller supplies
ID/name generation and time. Local and remote lists, GPX operations, server
synchronization, and offline mutation replay remain outside the recording
coordinator.

## State and persistence invariants

- A non-idle session always has an ID, name, color, and start timestamp.
- `start` is valid only from `idle`; `pause` from `recording`; `resume` from
  `paused`; and `stop`/`discard` from `recording` or `paused`. Redundant
  overlapping calls share work; a later incompatible command observes the state
  produced by everything before it.
- No empty track is written before the first accepted fix.
- Accepted fixes are persisted incrementally through the track coordinator's
  serialized write seam, so an older slow write cannot replace a newer point
  buffer.
- Stop waits for queued writes and a successful final IndexedDB write before
  publishing the finalized track or allowing “Track saved.” A write failure
  propagates, leaves the watcher stopped in `paused`, and retains the complete
  point buffer for a deterministic retry.
- Incremental write failures surface through the recording error channel without
  dropping the accepted in-memory points; a later final write still persists the
  complete buffer.
- Discard invalidates queued writes but clears the active session only after its
  durable record is removed. Logout invalidates writes before the logout purge.
- A failed initial watcher start returns to `idle`; a failed resume returns to
  `paused` with the existing points intact.
- A transient watcher error does not stop recording. Authorization loss stops
  the watcher and reports that finalization is in progress; it says the track
  was saved only after the write completes. Failure retains a paused,
  recoverable session and surfaces an actionable error without an unhandled
  rejection.
- Callbacks delivered after logout are ignored because the session is already
  idle.

The Dashboard may derive the latest accepted point for its shared location dot
and may consume phone heading while state is `recording`. Those are ephemeral
presentation concerns outside this coordinator: pause makes the recording-owned
indicator dot-only, idle contributes no indicator, and neither path changes fix
acceptance, storage, or the background watcher. See
`docs/user-location-heading.md`.

## Platform boundary

The coordinator depends only on the `LocationWatcher` contract. Native builds
receive `BackgroundGeolocationWatcher`; web and tests can use
`GeolocationWatcher` or a deterministic fake. The same `GPS.WATCH_OPTIONS` and
`shouldAcceptFix` gate are used regardless of platform, so platform adapters do
not own sampling policy.

## Verification and performance

`GpsRecordingCoordinator.test.ts` covers denied permission, no-op transitions,
start/resume rollback, stale and throttled fixes, paused timing, empty stop,
incremental/final write rejection, deletion rejection, retry, transient/fatal
watcher errors, data-preserving finalization, and logout races.
`SpeleoDBController.test.ts` retains the public-façade and real IndexedDB
characterization coverage.

Recording performs no polling. Transition admission is constant-time map/promise
bookkeeping and adds no native calls. Each accepted fix causes one serialized
local write and one revision notification; fixes rejected by the shared gate
cause neither. Point-buffer updates are linear in the number of accepted points,
with the existing 15-second cadence bounding write and render frequency.
