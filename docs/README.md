# Documentation

This folder contains product and engineering documentation for core app behaviors.

## Available docs

- `authentication.md`: email/password and OAuth-token login flows, session persistence, identity handling, security boundaries, and offline behavior.
- `offline-mode.md`: how offline mode works, startup auth timeout behavior, logout rules, and test expectations.
- `logout-behavior.md`: when logout/cache purge happens and what data is cleared.
- `security-storage.md`: native credential storage, session migration ordering,
  rollback, backup boundaries, and platform verification.
- `session-coordination.md`: ownership boundaries for authentication, startup
  validation, offline lock, reconnect, cancellation, and logout.
- `project-sync-coordination.md`: project-list, GeoJSON quarantine, overlay,
  cancellation, publication, and downstream phase ownership.
- `networking.md`: networking state model, reconnect triggers, and the no-passive-listener guarantee.
- `ci.md`: GitHub Actions stages, Vitest non-watch requirements, integration-test secrets, and native build verification.
- `implementation-guidelines.md`: high-level architecture boundaries, coding
  conventions, cancellation/publication rules, authoritative-seam testing, and
  the distinction between compilation and physical-device evidence.
- `onboarding-modal.md`: companion onboarding modal design intent, responsive layout behavior, and UX requirements.
- `project-panel.md`: project panel layout, open/close behavior, zoom-to-project, auto-close UX, country grouping, and persistence.
- `project-geojson-validation.md`: per-commit GeoJSON bbox and projected-footprint
  validation, worker deadline, schema-v2 quarantine persistence, sync counters,
  commit-gated map data, linearizable prefetch removal, and warning UX.
- `project-colors.md`: model-driven `project.color` contract, fallback semantics, and downstream consumers.
- `guided-tour.md`: interactive guided tour flow, driver.js integration, step definitions, and architecture.
- `dashboard-map-overlays.md`: read-only dashboard overlay endpoints, icon/label mapping, marker detail modal contract, share functionality, and offline cache lifecycle.
- `settings.md`: Settings page sections (sync stats, map settings, tutorial, account), state ownership, polling lifecycle, and offline behavior.
- `map-depth-and-scale.md`: dashboard distance scale, project/depth color mode selector, depth gauge behavior, and touch-first depth probe contract.
- `depth-domain-per-project-cache.md`: design rationale, performance analysis, and test coverage for the per-project depth domain caching optimization.
- `app-permissions.md`: native permissions (location, internet), privacy guarantees, and purpose strings for iOS and Android.
- `android-safe-area.md`: why `env(safe-area-inset-bottom)` fails on Android, the `initAndroidSafeArea()` fallback, and which components consume the CSS variable.
- `external-links.md`: why `target="_blank"` fails on Android in Capacitor, the `openExternalUrl()` contract, and the rule that all external links must use it.
- `deep-linking.md`: custom URL scheme (`speleodb://`), Universal Links / App Links setup, server `.well-known/` files, and fallback behavior.
- `map-layers.md`: changeable map tile layers (ESRI satellite + hillshade), the layer switcher, per-layer offline sync + prioritized prefetch, magic-hash missing-tile detection, offline gating, and storage-cap interaction.
- `landmark-crud.md`: online create/edit/delete of landmarks from the map, the collection picker, permission gating, long-press loading ring, the single cache-write seam, and the offline-ready architecture.
- `offline-op-queue.md`: THE canonical offline-mutation pattern -- the single persistent op queue shared by landmarks and GPS tracks, optimistic ground-truth-plus-fold model, idempotent replay, conflict diff resolution, and the Pending tab/page.
- `gps-tracks.md`: the GPS menu -- track recording (force-quit safe), GPS averaging + confidence model, GPX export/share, server sync of tracks, the unified local+remote track list, default-OFF per-track map display, and create/edit/delete routed through the shared offline op queue (see `offline-op-queue.md`).

## Maintainer note

When behavior changes, update the related document in this folder in the same pull request so implementation and docs stay aligned.
When a regression exposed a weak test seam, also capture the reusable rule under
`tasks/lessons/`; see `tasks/lessons/authoritative-seam-tests.md` for persistence,
concurrency, and revision-driven UI tests.
