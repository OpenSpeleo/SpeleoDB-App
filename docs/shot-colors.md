# Shot colors and artifact refresh

## Intent and user experience

Settings → Map Settings → Color mode offers **By Project**, **By Depth**, and
**By Shot**. Project coloring remains the default. By Shot preserves colors
assigned to Ariane shots and colors assigned to Compass sections by the survey
exporter. The app never assigns section colors itself: topology and palette
assignment belong to the exporter so web and mobile use the same artifact.
Compass section colors are assigned randomly during export and may change when
the GeoJSON is regenerated. Mobile does not seed, hash, or version that palette
assignment. The artifact revision described below tracks the exported file, not
a coloring algorithm version.

Each project line or passage feature uses its GeoJSON `properties.color` when
MapLibre can parse it; absent, empty, or malformed values fall back to that
project's model color. The exporter supplies `#rrggbb` for opaque colors and CSS
`rgba(...)` for nonopaque Ariane colors. Alpha is retained and combines with
existing layer opacity. No fallback is applied to an explicitly transparent,
valid color.

Both lines and passage fills/outlines use the same expression. Entrance stars,
other overlays, and project-panel dots retain their existing styles. The depth
gauge and probing are available only in By Depth. By Shot remains selectable
with old files and while offline, and Settings explains the project fallback.
The existing `UserPreferences.colorMode` value stores `shot`; invalid/missing
preferences continue to select `project`.

## Ownership and performance

`ProjectMapLayers` chooses the paint expression at the project layer boundary:
`['to-color', ['get', 'color'], projectColor]`. MapLibre performs per-feature
conversion with an explicit fallback, so one malformed color cannot invalidate
an entire layer. There is no feature-copying color pass, extra coordinate scan,
network request on mode changes, or new JavaScript palette. Existing GeoJSON
normalization, immutable cache records, and memoized depth enrichment preserve
the color property.

## Refreshing exported artifacts

The projects/geojson API may return `geojson_revision`, an opaque artifact token
independent of the source commit and signed download URL. A server reexport can
change the token without changing `latest_commit.id`. Mobile stores the revision
with the downloaded, validated artifact, and refreshes a differing known token
at the next online project sync. Rotating URL signatures alone cause no
download. Older servers without a token retain commit-based freshness.

Missing revision metadata does not invalidate a previously validated cache
entry. An old artifact from the current source commit remains available offline,
while an online replacement is pending, and after replacement failure. Its
properties may lack colors; By Shot then uses project colors. Data from a
different source commit remains hidden. An offline audit of legacy bytes retains
their original or absent revision instead of incorrectly stamping a newly
advertised token.

The durable cache entry and its bounds are replaced only after validation.
Network failures retain the old entry for a later retry. A file-content
rejection for a replacement is stored as revision-specific metadata alongside
the safe active artifact. It suppresses repeat downloads of that rejected token
across restarts while preserving the map and tile-planning bounds. A new
artifact token is eligible for validation. Successful replacement clears the
rejection. Infrastructure failures remain session-only. The warning identifies
when a previously validated map remains available; acknowledgement targets the
exact rejected revision and cannot acknowledge a newer failure accidentally.

This extends existing cache metadata without a database or validation-schema
version bump. Existing cancellation guards and abortable IndexedDB transactions
prevent a superseded refresh from publishing late bytes. Storage reads never
wait for replacement network settlement. If cancellation arrives immediately
after an IndexedDB commit, the memory entry is invalidated so later reads see
the artifact identity actually stored on disk.

## Verification

`DashboardMapLayers.test.tsx` compiles and evaluates both production paint
expressions using the renderer's MapLibre style engine, covering opaque and
alpha colors and malformed-value fallbacks while retaining source injection.
Settings/preferences and application state tests cover selection and
persistence. `useDashboardMapData.test.ts` verifies colors survive depth
enrichment and cached artifact loading without losing memoized identities.

`ProjectGeoJSONCoordinator.test.ts` exercises the actual coordinator and durable
IndexedDB cache for same-commit refresh, pending-network/offline fallback,
revision-specific rejection and acknowledgement, cancellation, recovery, and
older server/cache compatibility. The existing cache/controller suites cover
acknowledging cached artifact warnings when an older server omits revision
metadata, as well as validation, quarantine, and source-commit transitions.
Browser tests exercise the production build in Chromium and WebKit; native
WebView visual checks remain part of release verification for Android and iOS.
