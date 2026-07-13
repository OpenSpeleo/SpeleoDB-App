# Dashboard Map Data Lifecycle

## Intent

`useDashboardMapData` is the Dashboard-owned consumer boundary for cached,
controller-validated project and overlay map data. It converts cache state and
sync revisions into one commit-consistent view for the page without mixing cache
reads, normalization, cancellation, and rendering in `Dashboard.tsx`.

## Ownership

The hook owns:

- deterministic project ordering and color lookup;
- eligibility filtering for projects that declare usable GeoJSON;
- immediate validated-cache reads plus revision-driven refreshes;
- normalization of cached GeoJSON and landmark property identifiers;
- attachment of the precomputed depth property used by map layers;
- incremental project/overlay publication as each commit-consistent record is
  ready;
- immediate commit gating while replacement data is still loading;
- cancellation of stale success and failure completions;
- projection of current GeoJSON and prevalidated bounds from the same record;
  and
- offline landmark collection grouping from the cached overlay.

The controller remains responsible for cache schemas, quarantine, optimistic
offline landmark folding, and returning only validated project map records.
`Dashboard.tsx` supplies controller revisions and consumes the derived records.
`useDashboardProjectVisibility` remains the owner of project/country intent.

`useVisibleDashboardOverlays` applies the effective project set to
project-linked overlays after map data and visibility have both been derived.
Global landmarks and surface stations remain independent of project toggles.

## Publication invariants

- Cache reads begin as soon as the Dashboard has a controller and project
  metadata. A zero `mapDataRevision` cannot hide an already validated,
  commit-matched record when startup or a later sync phase is interrupted.
- A project is published only when normalized GeoJSON is non-empty and its
  loaded `commitId` equals the current `latest_commit.id`.
- GeoJSON and bounds are projected from one atomic map-data record; consumers
  cannot observe bounds from one commit with geometry from another.
- A changed project list hides an old commit synchronously, before the
  replacement asynchronous read completes.
- One failed project or overlay read is reported and does not prevent unrelated
  records from loading.
- Unmount, dependency replacement, and revision supersession invalidate both
  late successes and late failures. Stale work cannot publish or report noise.
- A generation mismatch hides prior data synchronously. An empty newer
  generation therefore remains empty without an effect-driven clearing render.

`landmarksRevision` independently reloads overlays after local landmark
mutations without re-reading project map records.

## Performance

Project cache reads use a four-worker pool, so one slow project cannot hide an
earlier ready project. Each record yields the WebView thread before CPU
normalization/depth attachment. Ready records accumulate in a `Map` and publish
once on the next cooperative rendering turn. With 60 immediately available
records, the four-worker admission pattern needs at most 15 project publication
turns rather than 60 individual React/MapLibre reconciliations.

The five overlay cache reads start together instead of waiting serially for the
previous overlay. Their ready records use the same rendering batcher, so a slow
landmarks record cannot hide surface stations, subsurface stations, exploration
leads, or cylinder installs. Stale-generation checks run before normalization
and publication; already-admitted reads may settle after unmount but cannot
publish or report stale noise. Derived project records, GeoJSON, bounds, colors,
landmark groups, and visible overlays remain memoized. Project zoom and initial
fit continue to use prevalidated bounds and never rescan coordinates.

The project cache returns the same immutable validated-record object to
reconciliation and Dashboard consumers within a bounded session LRU. Depth
attachment uses a `WeakMap` keyed by the source FeatureCollection, so a
revision-only reload reuses the enriched object without scanning every feature
again. The weak cache does not retain data after the source record leaves both
the bounded service cache and mounted UI.

Every project-data generation emits three sanitized aggregate timings under
`[dashboard-map:timing]`: cache-read work, normalization/depth work, and wall
clock from reader admission through the animation frame after final publication.
The last value includes the device-only React/MapLibre commit-to-paint delay
that fake IndexedDB and jsdom cannot reproduce. Logging retains no project
identifiers, names, coordinates, or GeoJSON.

## Verification

`useDashboardMapData.test.ts` directly covers zero-revision cache publication,
project eligibility, progressive publication behind a deferred record, 60-record
rendering-turn coalescing, concurrent overlay admission behind a deferred
landmarks record, valid/empty/malformed/stale commits, depth attachment, every
overlay shape, failure containment, default diagnostics, revision clearing,
commit replacement, and all late-success/late-failure cancellation pairings. It
also covers global and project-linked overlay visibility. The module has 100%
statement, branch, function, and line coverage. `Dashboard.test.tsx` remains the
integration characterization seam for controller revisions, quarantine
transitions, panels, layers, overlays, and fit behavior.
