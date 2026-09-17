# GIS Geometry

## Intent and user experience

GIS Geometry displays private, manually authored lines and simple polygons from
the authenticated SpeleoDB instance. A geometry is independent of surveys, GPS
tracks and GIS imported layers. The app provides a read-only list and map: no
editor, upload, sharing or collaborator-inspection interface is included.

The **Geometries** bottom tab opens a panel matching Survey Projects in the same
mutually exclusive slot as Projects, Landmarks and GPS. The menu uses the same
triangle-with-vertices icon as the
[SpeleoDB web app](https://github.com/OpenSpeleo/SpeleoDB/commit/ed9de067890543a3a3531da0e920f8285e133631).
Rows show name, record color and a visibility switch, with no zoom hint, side
icon or offline-preparation message. Show all and Hide all change display intent
without moving the camera. A name tap enables the geometry and frames its full
bounds after coordinates load, then closes the panel. Failed loads keep the
panel available for retry. The most recent selection owns camera movement;
hiding a pending geometry cancels its pending zoom.

Every cold launch starts hidden. Choices remain during panel/route changes and
background/resume within that session. Loading details for offline preparation
never enables a switch. The switch remains operable during requests, and late
responses cannot reverse a user's newer choice.

The list uses the server's modified-date ordering. It distinguishes an empty
successful list from errors, and cached data from a fresh verified collection.
Offline mode uses saved coordinates and does not initiate network requests.
Retrying while offline does not bypass the existing Go Online workflow.

The sidebar shell is shared with Projects and GPS; domain-specific rows and
actions remain separate. Panels support focus entry/return, Escape and backdrop
close. Bottom navigation preserves at least 44-pixel targets with horizontal
overflow when enlarged labels cannot fit, including the optional Pending tab.
The tab bar has 12-pixel side padding to keep its items inset from both edges.

## API and validation boundary

Only these authenticated GET routes are used, with trailing slashes and
`Accept: application/json`:

- `/api/v2/gis-geometries/`: bare metadata array.
- `/api/v2/gis-geometries/{uuid}/`: one complete record with a bare geometry.

There are no query filters, pagination envelopes, signed downloads, conversion
jobs or permission-list reads. Capabilities are validated metadata, independent
of creator provenance. A same-revision sharing change still refreshes access
metadata. Geometry-level denials do not independently destroy the app session;
SessionCoordinator retains authority over authentication/logout.

`src/gisGeometry/geometry_contract.json` is copied byte-for-byte from the
SpeleoDB backend at commit `67c67592e1a1017c7aab40a28ddde1e532fea2f7`. Its
SHA-256 is `9ad38c83e2f30dfe2fa3603637f937c965c76dd2e55a1b10a2cd8d3baf41ef36`.
The shared backend fixture corpus is vendored alongside it. The app imports
policy values from this document; builds need no adjacent backend checkout.
Updating the contract requires updating provenance and checking shared fixtures.

The bounded validator ports upstream read/measurement logic. It accepts only
bare LineString or single-exterior-ring Polygon objects, validates topology,
finite two-dimensional positions, closure, vertex count, 30 km² bounding-box
limit, safe positive integer revisions, UUIDs, color and offset-bearing dates.
Name length counts Unicode code points like the backend, rather than UTF-16
units. Coordinates retain received numeric precision. A malformed list cannot
become an authoritative empty list. Cached records cross the same validation
boundary on restoration; validated online reads can repair corrupt detail
entries.

**GIS uses ordinary min/max longitude bounds.** This is a deliberate exception
to project/GPS shortest-wrapped-interval behavior: a wide line's bounding box
must not be replaced with its shorter dateline complement. Bounds and spherical
rectangle measurements are computed once for the validated record. Polygon
closure is excluded from vertex count. The area is a bounding-box performance
measure, not polygon surface area; the list/map-only UI does not display it.
Mercator display/tile latitude clamping never changes stored coordinates.

## Data ownership and persistence

`GisGeometryCoordinator` owns collection freshness, request scheduling, accepted
versions and access. `GisGeometryCacheService` uses the existing CacheStore;
`SpeleoDBController` connects it to sessions, application sync and offline
areas. The dedicated `useGisGeometries` subscription avoids republishing each
detail completion through the app-wide React context. The dashboard hook owns
only ephemeral visibility and camera intent.

Metadata publishes first. Background offline preparation requests every
accessible geometry's missing/current detail, using four concurrent requests.
Foreground display requests share the same in-flight task and take priority over
queued background tasks. Cancelling a caller does not cancel another consumer's
shared request. A session change cancels the owning work and rejects late
publication even if a native operation ignores cancellation.

Collection/detail content revisions and access-read ordering are separate.
Revision-conditional detail writes are atomic IndexedDB updates. Older content
cannot replace a newer durable version; older successes and failures cannot undo
later accepted access reads. Network/5xx failures preserve usable cached data
with a stale/error state. Explicit denial or authoritative omission removes the
geometry from the map and cache authority and schedules collection revalidation
without a denial retry loop.

Content revision and access metadata remain separate even after an interrupted
detail/catalog write: recovering newer durable coordinates must merge the latest
accepted permission fields. Revocation detaches pending work from its resource
identity so a later regrant can fetch independently; old responses remain
epoch-fenced and tracked until they settle.

Confirmed revocation removes usable in-memory membership before fallible cache
writes. Catalog persistence, detail deletion and automatic-area cleanup are
attempted independently; failures retain the runtime denial and a retryable
error. Explicit refresh retries the pending cleanup.

Token sessions may have no email or stable user ID. Secure session metadata
therefore carries a random non-secret `cacheScopeId`, retained on restoration
and replaced with a new login. GIS catalog/detail keys include that scope. Scope
initialization uses the existing metadata commit/rollback lane. Tokens are never
placed in geometry cache keys. Account replacement invalidates old state and
clears its GIS data; logout drains accepted work before the shared cache purge.

The GIS catalog stores authoritative membership and revoked IDs. This is the
durable authority across the separate geometry and tile databases: detail/map
reads require membership, while startup replays interrupted
detail/automatic-area cleanup. A crash between databases must not restore
revoked access. Geometry records have their own schema version; CacheStore
remains database version 3. When a restored account has no geometry catalog,
startup removes orphan GIS areas instead of treating the previous account's
download intent as its own.

## Native and web HTTP isolation

Django session authentication precedes token authentication. GIS GETs therefore
must not carry browser cookies belonging to a different account.

HttpClient's GIS path omits cookies on web and uses the first-party
`GisGeometryHttp` plugin on native platforms. Status and content type reach the
shared parser before JSON decoding. Non-JSON denials retain their HTTP status;
malformed successes receive fixed local error messages, without reflecting raw
server HTML.

Android installs a permanent route-scoped delegating CookieHandler after
Capacitor's cookie plugin and before WebView startup. GIS requests use raw-body
HttpURLConnection GETs, ignore response cookies and refuse redirects. Unrelated
routes retain the existing cookie handler. iOS uses ephemeral URLSessions with
request/configuration cookie handling disabled and a redirect-denying delegate.
Both classify non-success status from response headers without waiting for an
error body. iOS still waits for the complete body on success; an incomplete
success body times out. Explicit caller cancellation takes precedence over a
header-only completion. Both implement deadlines and fixed error text. No
dependency source patches or new native networking dependencies are required.

## Rendering and offline coverage

Visible validated records become a memoized local FeatureCollection. Three
Layers are direct children of their owning Source: polygon fill at 0.175
opacity, polygon outline at 1.5 px/0.95, and line at 2.5 px/0.95. Record color
is validated before CSS/map use. GIS remains below survey geometry and markers,
independent of project visibility and depth styling. The map camera reuses the
shared fit helper; no map-feature gesture or point rendering is introduced.

Every accessible geometry, including hidden ones, contributes a `gis-geometry`
automatic DownloadArea. It uses min/max bounds plus the same 50 m padding as
existing sources, with stable `gis-geometry:<uuid>` identity. The complete
rectangle includes polygon interiors. Automatic rectangles stay outside the
manual Offline Maps manager. Routine preparation status is not added to the
geometry rows, preserving the Survey Projects presentation.

Coverage uses the existing union plan at zooms 0–18, shared enabled providers,
six tile workers, deduplicated tile membership, storage consent and recovery.
Visibility, names, colors and unchanged bounds do not rebuild plans. Changed
bounds use existing rolling replacement across enabled layers.

Automatic source authority is scoped to each source type. Unavailable GIS
metadata preserves its saved rectangles; failed accessible details preserve only
those identities while healthy peers update. Failure is never an authoritative
empty collection. Each ready source type enters the standard catalog while other
types are still pending, including when GPS, project or overlay reads stall.
Completions that arrive together are coalesced; one collection has at most eight
publications (one per source type), never one rebuild per record. Only the final
full snapshot requests a forced refresh or establishes complete source
authority.

Explicit tile refresh retries GIS metadata after a failed read without an
automatic denial retry loop. Confirmed revocation removes only the corresponding
GIS catalog rows without cancelling unrelated source preparation or deleting
shared public basemap bytes. A freshness callback checked inside the catalog
transaction prevents a superseded GIS snapshot from restoring removed rows.

Server geometry validity and tile capacity are separate limits. A long zero-area
line or polar rectangle can exceed the existing 1,000,000-coordinate per-area
limit. The download engine records `too-large` for that area; valid peer areas
continue. Coordinate persistence and provider readiness remain distinct engine
states. Partial counters belong to the shared batch and are not presented as
individual geometry percentages.

Tile database version 9 and download catalog schema 1 remain unchanged. Existing
areas, colors, pins and plans survive this additive source type. Older app
builds reject the new enum; downgrade compatibility is not supported and the
catalog must not be cleared to conceal that incompatibility.

## Verification

Automated tests cover canonical parser fixtures, API/status/media types, real
IndexedDB conditional writes and restart recovery, request races and four-worker
scheduling, session-scope migration, mounted toggle/zoom behavior and MapLibre
Source injection. Real offline-engine tests verify rectangle/URL deduplication,
unchanged coverage reuse, failed replacement, revoked-source cleanup and
oversized-source isolation. Production Chromium/WebKit tests exercise real
workers, storage, narrow layouts and offline reload.

Tile regression tests start from an empty catalog with healthy automatic areas
and unavailable GIS metadata (403/404/5xx, malformed or non-JSON responses).
They verify source-local retention and explicit retry. Held metadata/detail
tests assert healthy planning before GIS resolves; Chromium/WebKit additionally
verify nonzero completed tiles and 100% in Settings using real workers and
IndexedDB. Recovery must merge GIS without changing existing area identities.

Native loopback tests seed another account's session cookie and verify
token-only GETs, response-cookie suppression, redirect refusal and cancellation.
Android instrumentation and iOS bridge tests verify actual plugin registration.
The iOS shared SpeleoDB test scheme, test host and module imports match the
current app target so these checks can run reproducibly.

Physical-device verification remains distinct: actual Android/iOS WebView
rendering, touch/safe areas, airplane-mode tiles, force-quit recovery and
background transitions require device evidence. Exact executed commands, results
and limitations are recorded in the
[task review](../tasks/todos/gis-geometry.md). The
[deep failure-mode review](../tasks/todos/gis-geometry-deep-review.md) records
additional interrupted-write, regrant, stalled-source and native-body evidence.
