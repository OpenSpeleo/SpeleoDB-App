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
- atomic project/overlay publication after a complete read pass;
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
- A completed empty pass publishes an empty record, clearing data removed by a
  newer revision.

`landmarksRevision` independently reloads overlays after local landmark
mutations without re-reading project map records.

## Performance

The extraction preserves the existing request count and sequential cache-read
ordering. Derived project records, GeoJSON, bounds, colors, landmark groups,
and visible overlays are memoized. Project zoom and initial fit continue to use
prevalidated bounds and never rescan coordinates.

## Verification

`useDashboardMapData.test.ts` directly covers zero-revision cache publication, project
eligibility, valid/empty/malformed/stale commits, depth attachment, every
overlay shape, failure containment, default diagnostics, revision clearing,
commit replacement, and all late-success/late-failure cancellation pairings.
It also covers global and project-linked overlay visibility. The module has
100% statement, branch, function, and line coverage. `Dashboard.test.tsx`
remains the integration characterization seam for controller revisions,
quarantine transitions, panels, layers, overlays, and fit behavior.
