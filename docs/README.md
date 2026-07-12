# Documentation

This folder contains product and engineering documentation for core app
behaviors.

## Available docs

- `authentication.md`: email/password and OAuth-token login flows, session
  persistence, identity handling, security boundaries, and offline behavior.
- `offline-mode.md`: how offline mode works, startup auth timeout behavior,
  logout rules, and test expectations.
- `tile-cache-architecture.md`: cache-first tile serving, 180-day freshness,
  fail-closed bounded in-memory planning, compact IndexedDB plans/layer
  generations, six-worker downloads, paint-cadence progress, refresh, and
  performance regression seams.
- `logout-behavior.md`: when logout/cache purge happens and what data is
  cleared.
- `security-storage.md`: native credential storage, session migration ordering,
  rollback, backup boundaries, and platform verification.
- `session-coordination.md`: ownership boundaries for authentication, startup
  validation, offline lock, reconnect, cancellation, and logout.
- `project-sync-coordination.md`: project-list, GeoJSON quarantine, overlay,
  cancellation, publication, and downstream phase ownership.
- `performance-diagnostics.md`: safe browser/native synchronization timing
  records, Xcode and Logcat filters, field allowlists, and security boundaries.
- `offline-tile-coordination.md`: offline queue lifecycle, replay ports, pending
  revisions, tile scheduling, consent, layer settings, and logout teardown.
- `gps-recording-coordination.md`: recording-state ownership, watcher and
  persistence ports, permission-loss recovery, sampling, and logout invariants.
- `gps-track-coordination.md`: local/remote track state, serialized persistence,
  server mutation policy, cancellation, geometry, GPX, and snapshot ownership.
- `dashboard-map-utilities.md`: pure map bounds, overlay filtering, icon
  loading, hit testing, and orientation invariants extracted from Dashboard
  rendering.
- `dashboard-map-data.md`: revision-driven project/overlay cache reads,
  commit-gated publication, normalization, cancellation, and derived map data.
- `dashboard-map-shell.md`: cached style, icon, viewport, native location, map
  chrome, and MapLibre composition ownership extracted from Dashboard.
- `user-location-heading.md`: live My Location toggle, shared recording/manual
  position selection, reference-counted phone heading, cone rendering, sensor
  lifecycle, privacy, performance, and physical-device verification.
- `dashboard-map-layers.md`: focused project, overlay, GPS-track, recording, and
  user-location MapLibre layer composition.
- `dashboard-map-interactions.md`: touch/pen tap, long-press, empty-spot,
  marker-detail, depth-probe, timer, and cancellation ownership.
- `dashboard-gps-presentation.md`: recording/averaging activity composition, GPS
  track dialog policy, callback boundaries, testing, and render cost.
- `dashboard-gps-track-actions.md`: track visibility, lazy geometry, sharing,
  map zoom, mutation-dialog state, async guards, and performance ownership.
- `dashboard-gps-recording-actions.md`: recorder controls, live geometry,
  battery hints, averaging transitions, async guards, and landmark handoff.
- `dashboard-landmark-actions.md`: collection preferences, visible GeoJSON,
  locate/create/edit/delete state, toasts, async guards, and GPS handoff.
- `dashboard-landmark-presentation.md`: detail/form/delete dialog composition,
  toast styling, long-press feedback, and callback boundaries.
- `dashboard-project-visibility.md`: project and country visibility intent,
  persistence, effective map gates, bulk actions, and bounded project zoom.
- `dashboard-panel-state.md`: the single mutually exclusive Projects, Landmarks,
  GPS, and Map panel state shared across authenticated routes.
- `networking.md`: networking state model, reconnect triggers, and the
  no-passive-listener guarantee.
- `ci.md`: GitHub Actions stages, Vitest non-watch requirements,
  integration-test secrets, and native build verification.
- `implementation-guidelines.md`: high-level architecture boundaries, coding
  conventions, cancellation/publication rules, authoritative-seam testing, and
  the distinction between compilation and physical-device evidence.
- `onboarding-modal.md`: companion onboarding modal design intent, responsive
  layout behavior, and UX requirements.
- `project-panel.md`: project panel layout, open/close behavior,
  zoom-to-project, auto-close UX, country grouping, and persistence.
- `project-geojson-validation.md`: per-commit GeoJSON bbox and
  projected-footprint validation, worker deadline, schema-v2 quarantine
  persistence, sync counters, commit-gated map data, linearizable prefetch
  removal, and warning UX.
- `project-colors.md`: model-driven `project.color` contract, fallback
  semantics, and downstream consumers.
- `guided-tour.md`: interactive guided tour flow, driver.js integration, step
  definitions, and architecture.
- `dashboard-map-overlays.md`: read-only dashboard overlay endpoints, icon/label
  mapping, marker detail modal contract, share functionality, and offline cache
  lifecycle.
- `pwa-metadata.md`: built web branding, manifest/icon ownership, and emitted
  asset verification.
- `release-device-evidence.md`: credential-safe Android/iOS E2E matrices,
  physical-device protocols, evidence fields, and release blocking rules.
- `release-ceremony.md`: protected signing, versioning, artifact identity,
  installation/store validation, hashes, approval, and rollback.
- `settings.md`: Settings page sections (event-driven sync stats, map settings,
  tutorial, account), state ownership, progress lifecycle, and offline behavior.
- `map-depth-and-scale.md`: dashboard distance scale, project/depth color mode
  selector, depth gauge behavior, and touch-first depth probe contract.
- `depth-domain-per-project-cache.md`: design rationale, performance analysis,
  and test coverage for the per-project depth domain caching optimization.
- `app-permissions.md`: native permissions (location, internet), privacy
  guarantees, and purpose strings for iOS and Android.
- `screen-awake.md`: native Android/iOS foreground screen-awake ownership,
  lifecycle behavior, design boundaries, power impact, and device verification.
- `android-safe-area.md`: why `env(safe-area-inset-bottom)` fails on Android,
  the `initAndroidSafeArea()` fallback, and which components consume the CSS
  variable.
- `external-links.md`: why `target="_blank"` fails on Android in Capacitor, the
  `openExternalUrl()` contract, and the rule that all external links must use
  it.
- `deep-linking.md`: custom URL scheme (`speleodb://`), Universal Links / App
  Links setup, server `.well-known/` files, and fallback behavior.
- `map-layers.md`: changeable map tile layers (ESRI satellite + hillshade), the
  layer switcher, per-layer offline sync + prioritized prefetch, magic-hash
  missing-tile detection, offline gating, and storage-cap interaction.
- `landmark-crud.md`: online create/edit/delete of landmarks from the map, the
  collection picker, permission gating, long-press loading ring, the single
  cache-write seam, and the offline-ready architecture.
- `offline-op-queue.md`: THE canonical offline-mutation pattern -- the single
  persistent op queue shared by landmarks and GPS tracks, optimistic
  ground-truth-plus-fold model, idempotent replay, conflict diff resolution, and
  the Pending tab/page.
- `gps-tracks.md`: the GPS menu -- track recording (force-quit safe), GPS
  averaging + confidence model, GPX export/share, server sync of tracks, the
  unified local+remote track list, default-OFF per-track map display, and
  create/edit/delete routed through the shared offline op queue (see
  `offline-op-queue.md`).

## Maintainer note

When behavior changes, update the related document in this folder in the same
pull request so implementation and docs stay aligned. When a regression exposed
a weak test seam, also capture the reusable rule under `tasks/lessons/`; see
`tasks/lessons/authoritative-seam-tests.md` for persistence, concurrency, and
revision-driven UI tests. First-party native plugins also require a live bridge
resolution test; see `tasks/lessons/native-plugin-registration.md`.
