# Responsive viewer updates

Viewer controls describe the user's latest intent immediately. Expensive map
application follows a paint opportunity, so a toggle, selector, or collection
control never waits for geometry preparation or map source work to finish.

## Ownership and scheduling

`useAppliedViewerState` separates control state from applied display state.
`scheduleViewerUpdate` admits work after two animation frames, with a
cancellable 100 ms fallback when a WebView stops issuing frames. New intent
cancels pending application. Hidden/backgrounded dashboards retain their last
applied display and apply only the newest intent on return. Native foreground
state has one owner in Dashboard and is also passed to the map shell.

This is an explicit scheduling boundary: the installed react-map-gl components
mutate MapLibre during render, so speculative React transitions cannot safely
own map application. The memoized map viewport consumes stable applied props.
The depth gauge, depth probe eligibility, project colors and overlay filters use
the same applied display state. Controller revocation, source revision changes,
and account-scope invalidation still remove invalid data immediately.

Project sources remain mounted after their first display, retaining immutable
GeoJSON while layer visibility changes. Initially hidden projects are not
admitted. Startup and Show all admit at most four new project sources per turn;
suspension or replacement cancels the next batch. Retained sources are removed
when their authoritative data disappears. This trades retained worker memory for
inexpensive repeated toggles without eagerly loading hidden projects.

Survey depth properties and domains are prepared together once per immutable
FeatureCollection. Preparation yields every 1,000 traversal steps, including
coordinates inside one large feature and empty geometry containers, and stops
when its source load is superseded. The depth probe merges these prepared
project domains; toggles and newly completed project batches do not rescan
previous survey coordinates during render.

Project-linked overlays and landmark collections use MapLibre filters instead of
copying FeatureCollections. These compose with category and station subtype
visibility; numeric/string project IDs and missing personal collection IDs keep
their existing meaning. GIS visibility is session-scoped and retains only
previously selected, current-revision records. Every Layer remains a direct
child of its Source.

## GPS data and camera actions

GPS metadata exposes `geometryRevision`: the server SHA for remote tracks and a
coordinator-owned identity for an immutable completed local point array. Color
and name edits do not change geometry identity. The viewer deduplicates
in-flight reads, rejects superseded completions and prepares coordinates and
bounds in batches of at most 1,000 points. Downloaded GeoJSON conversion also
yields in bounded batches. Visibility filters and a separate color lookup reuse
the source and coordinates. A known cached SHA mismatch triggers a fresh
geometry read; legacy caches without a SHA retain their prior offline display
compatibility.

A failed visible-track load does not trigger an automatic retry loop. Toggling
it on again or selecting its name explicitly retries. Latest locate wins; hide,
track removal/revision replacement, panel departure, route suspension, native
backgrounding and unmount prevent stale camera movement. A user-origin map
movement invalidates pending project/GPS/GIS camera actions and initial
auto-fit; programmatic movement does not cancel its own completion. GIS retains
its existing equivalent scope/revision and camera guards. Project locate
callbacks are invalidated by new display intent, unavailable bounds, route
departure and unmount.

Recording, uploads, edits and deletions continue through their existing
transactional controller operations. Scheduling display work does not claim a
server mutation or offline operation has completed before its durable boundary.

## Persistence and lifecycle

Only display preference setters are queued. Read APIs include pending intent,
while one scheduled write merges the burst against current storage. Synchronous
unrelated writes flush queued display edits first. Session metadata writes stay
synchronous; they flush prior display edits before changing credentials.
`clearPreferences` cancels and discards queued edits so delayed work cannot
restore a cleared session. Page suspension and native backgrounding flush
pending preferences before the WebView pauses. Existing storage-error handling
remains the error boundary.

## Verification and performance

Production-seam tests cover paint-before-apply ordering, coalescing,
cancellation, source/data identity, evaluated MapLibre filters, GPS
revision/deduplication, stale camera work and session-safe persistence. The
browser map-display suite uses the real MapLibre renderer in Chromium and
WebKit; its 12,000-feature responsiveness fixture asserts p95 two-frame control
feedback at most 100 ms while testing rapid toggles, settings changes and
download reuse. A separate 100,000-coordinate fixture exercises controls across
a delayed download's completion. It invokes the real Settings switch handler
with one synthetic DOM click at the first depth-preparation measurement, without
pausing the scheduler. Recorded input and slice start times must show a later
preparation slice after that interaction; the switch must expose its expected
checked state at the two-frame feedback boundary within 100 ms. This boundary
provides an intervening paint opportunity, not a presented-pixel timestamp. This
proves overlap with preparation, while the separate 12,000-feature fixture uses
trusted browser taps to cover pointer input. Both assert measured application
preparation/application slices at most 50 ms. Named `viewer:*` performance
measures contain phase and duration only, and clear the performance buffer after
observer delivery is queued. Raw browser long tasks, which include atomic
MapLibre/WebGL/browser operations, are reported separately rather than
misattributed to the application slices. JSON measurements are attached to each
browser result. Run timing fixtures without concurrent CPU-heavy suites. Desktop
browser measurements do not prove Android/iOS WebView latency; physical-device
performance remains a separate verification requirement.
