# Dashboard Pull-to-Refresh

This document defines the dashboard pull-to-refresh feature behavior.

## Feature goal

- Allow users to manually sync dashboard data with a pull-down gesture.
- Keep the pull indicator visible on devices with a top notch/status bar inset.
- Restrict pull-to-refresh interaction to the dashboard header area.
- Keep map gestures independent from pull-to-refresh.

## Scope

- Screen: `Dashboard` only.
- Refresh mechanism: Ionic `IonRefresher` and `IonRefresherContent`.
- Data action: dashboard sync flow (`handleRefresh` in `Dashboard`).

## User interaction model

### Allowed refresh gesture

- Pull-down that starts from the top header region may trigger pull-to-refresh.
- The user sees pull indicator UI (arrow/text/spinner) and can release to run refresh.

### Disallowed refresh gesture

- Pull/drag gestures that start on the map surface must not trigger pull-to-refresh.
- Map pan/zoom interaction remains map-only.

## Visual behavior

- Pull indicator appears below top safe-area inset (notch/status bar area).
- Pull indicator should be readable and not hidden behind the floating header.
- Indicator uses the dashboard refresher styling in `src/theme/variables.css`.

## Refresh behavior

When refresh is triggered:

- If online, run project sync
- If online:
    1. First attempts connection retry (see offline-mode.md for more details)
        a. If retry succeeds, run project sync.
        b. If retry fails with network error, the app remains offline and uses cached data.
        c. If retry fails with HTTP 400 code, logout the user

Refresher interaction is completed after the async flow finishes.

## Configuration

Dashboard refresher gesture tuning:

- `pullFactor={0.5}`
- `pullMin={60}`
- `pullMax={200}`

These values define pull sensitivity and trigger thresholds for the dashboard refresh interaction.

## Source code map

- Feature container: `src/pages/Dashboard.tsx`
- Refresher visual spacing/styles: `src/theme/variables.css`
- Feature tests: `src/pages/Dashboard.test.tsx`

## Acceptance checklist

- Header pull-down shows indicator clearly below safe area and can refresh.
- Map drag/pull does not show pull-to-refresh UI and does not trigger refresh.
- Header controls remain usable while pull-to-refresh is available.
- Map pan and pinch-zoom remain functional.

## Platform note

- `env(safe-area-inset-top)` is a browser/webview environment variable.
- It is provided by the runtime (not defined in this repository) and is enabled by viewport settings (`viewport-fit=cover` in `index.html`).
