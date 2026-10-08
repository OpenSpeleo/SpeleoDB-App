# Shared map packages

The mobile and web viewers use the same TypeScript implementations for shared
geography, domain calculations and renderer specifications. Application-specific
behavior remains owned by its application. This prevents fixes to bounds,
geometry validation or layer filters from drifting between the two viewers
without turning native/offline workflows into a generic viewer framework.

## Ownership

`@speleodb/map-core` owns geographic bounds and antimeridian intervals,
spherical distance, the backend GIS geometry contract and validation, landmark
grouping, model-color validation, depth-domain operations and immutable geometry
traversal. It exposes mechanisms that accept caller policy: depth alias order,
parsing and feature selection are supplied by the app.

`@speleodb/map-viewer` owns GL expressions, common line widths, landmark and
station specifications, vector overlay specifications, hit boxes, the shared map
icon assets and globe atmosphere rendering. It does not create a map, register
data sources, fetch data or mutate application state. Its opt-in atmosphere
attachment owns one custom rendering layer and its style/map lifecycle. Mobile
maps those specifications directly to `Layer` children of their owning `Source`;
source-injection tests remain required.

Mobile retains strict depth aliases and the coordinate-Z fallback, its
square-root eight-stop ramp, model-color fallback, display preferences,
React/native lifecycle and interaction policy. Web's depth policy differs; the
packages contain no web/mobile mode switch. Cooperative preparation retains its
1,000-step checkpoints and source-identity cache, while the actual traversal is
shared. Visibility changes still reuse immutable sources and prepared domains.

`SessionCoordinator`, project validation/quarantine, account-scoped GIS
authorization, IndexedDB transactions, the offline operation queue, tile cache
and GPS recording remain mobile-owned. Shared geometry validation does not
replace API metadata/capability parsing or weaken the current cache boundary.
The parser rejects coordinate arrays above the shared contract limit before
visiting positions, then copies validated coordinates before publishing its
record. Only validated `type` and coordinate pairs are copied; foreign response
properties are rejected without reading their values. This preserves the bounded
mobile API boundary even when input is malformed or oversized.

The GIS contract and fixture corpus are imported from the package, whose
versioned copies are verified against the Django backend. Mobile no longer
maintains duplicate JSON files or map icon PNGs.

## Builds

Both standalone and monorepo builds consume TypeScript source. The public
[map-core](https://github.com/OpenSpeleo/SpeleoDB-TS-MapCore) and
[map-viewer](https://github.com/OpenSpeleo/SpeleoDB-TS-MapViewer) packages
export `src/*.ts` by default; Vite compiles that source into the app's browser
bundles. `dist/` is ignored in the packages and is neither installed nor
required. Bun installation does not compile dependencies or run package build
hooks.

`package.json` and `bun.lock` retain full Git commit SHAs, with the core
override matching its direct dependency. Vite, Vitest, editors and the
TypeScript wrapper always enable `speleodb-source` for compatibility with older
pinned revisions that ship source under that condition. New revisions need no
custom condition. The same source API is checked and bundled in standalone and
local builds.

The monorepo's `bun run install:local` projection links live package checkouts.
The wrapper verifies installed source realpaths and the viewer-to-core
dependency edge; an archived `src/` directory cannot pass as a live checkout.
`SPELEODB_LOCAL_PACKAGES=0` selects installed source packages; `1` requires
local checkouts. This flag changes workspace validation, never source versus
compiled exports. Missing local checkouts fail explicitly instead of falling
back to an older published version.

Shared renderer code stays in the authenticated lazy graph. Package code must
remain compatible with the existing Chromium 111 and Safari/iOS 16.4 targets and
bundle budgets.

## Verification

Packages own the moved algorithm suites and renderer-expression tests. Mobile
retains app policy tests, direct `Source`/`Layer` ownership checks, Dashboard
integration, commit/revision and cancellation tests, real fake-IndexedDB tests
and native lifecycle tests. Run lint, type checking, the full covered Vitest
suite and a production build through the normal scripts. Browser suites exercise
the built MapLibre output in Chromium and WebKit, including station categories,
depth/shot colors, overview line visibility and responsiveness.

The extraction adds no geometry scans on toggles, fetches, polling or extra
source registrations. Shared geometry traversal and domain calculation remain
linear in input size; prepared-domain merging remains proportional to project
count. Device evidence is still required for native lifecycle and physical
WebView performance claims.

## Globe presentation

The Dashboard starts over France at `[2.35, 46.6]`, zoom `0`. The map shell
shallow-copies the selected cached style, installs its globe projection and
removes provider camera metadata. Tile URLs, sources and layer arrays retain
their existing identities and cached protocol handling. After the first map
load, the shell restores the initial camera once to undo MapLibre's temporary
Mercator viewport constraint; project navigation runs afterward. Later style
changes retain the current camera.

The shell attaches the shared `attachGlobeAtmosphere` renderer once per map and
releases it when that map is replaced or the shell unmounts. The package
restores its layer after style replacement and handles MapLibre resource
disposal. A transparent foreground anchor is the first map child, keeping stars
and the white rim beneath download areas, GIS, project lines and markers even
when those overlays already exist when the map reports loaded. No
`Source`/`Layer` data ownership changes are needed: the anchor is a source-free
background layer.

The shared shader derives the Earth silhouette from public projection matrices,
so resizing, camera padding and transitions to Mercator stay aligned. Stars are
local and deterministic; one draw runs only with MapLibre's own frame rendering.
There are no new requests, timers, feature scans or offline cache entries.
Native location and orientation-lock policies remain mobile-owned.

Shell unit tests cover provider-camera removal, source identity, one-time camera
application, map replacement and unmount cleanup. Browser tests inspect the real
canvas for stars, dark space and a white halo before and after all three basemap
choices, tab navigation and portrait/landscape resizing. Run browser checks
against a manual production build; browser evidence does not establish physical
Android/iOS WebView performance.
