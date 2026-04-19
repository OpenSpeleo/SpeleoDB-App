# Documentation

This folder contains product and engineering documentation for core app behaviors.

## Available docs

- `offline-mode.md`: how offline mode works, startup auth timeout behavior, logout rules, and test expectations.
- `logout-behavior.md`: when logout/cache purge happens and what data is cleared.
- `networking.md`: networking state model, reconnect triggers, and the no-passive-listener guarantee.
- `implementation-guidelines.md`: high-level architecture boundaries, coding conventions, and testing expectations.
- `onboarding-modal.md`: companion onboarding modal design intent, responsive layout behavior, and UX requirements.
- `project-panel.md`: project panel layout, open/close behavior, zoom-to-project, auto-close UX, country grouping, and persistence.
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

## Maintainer note

When behavior changes, update the related document in this folder in the same pull request so implementation and docs stay aligned.
