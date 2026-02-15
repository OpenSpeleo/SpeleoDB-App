# Documentation

This folder contains product and engineering documentation for core app behaviors.

## Available docs

- `offline-mode.md`: how offline mode works, startup auth timeout behavior, logout rules, and test expectations.
- `pull-to-refresh.md`: dashboard pull-to-refresh behavior, gesture constraints, and reconnect semantics while offline.
- `logout-behavior.md`: when logout/cache purge happens and what data is cleared.
- `networking.md`: networking state model, reconnect triggers, and the no-passive-listener guarantee.
- `implementation-guidelines.md`: high-level architecture boundaries, coding conventions, and testing expectations.

## Maintainer note

When behavior changes, update the related document in this folder in the same pull request so implementation and docs stay aligned.
