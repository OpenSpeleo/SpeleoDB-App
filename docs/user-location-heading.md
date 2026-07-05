# Live User Location and Heading

## Intent

The Dashboard has one reusable representation of the user's current position: a
blue MapLibre dot and, while a live reason exists, a Google-style blue cone
showing the physical direction of the phone. The same indicator is used by the
foreground **My Location** mode and by GPS track recording so those features
cannot drift into different marker, compass, or lifecycle behavior.

The cone is phone orientation, not direction of travel. GPS course/bearing is
never used as a substitute because a stationary or slowly moving phone has no
reliable travel direction.

## Interaction model

- **My Location is a toggle.** The first press requests foreground location
  permission and starts a high-accuracy watch. The button stays loading until
  the first valid fix, then the map centers once and gives one light haptic.
  Later fixes move only the dot; they never move the camera again.
- A second press cancels an activation still awaiting permission/watch setup, or
  stops the active watch. It clears the manual fix and its live reason.
- An actively recording track supplies its latest accepted point and enables
  heading without requiring My Location. Pausing keeps the last dot but removes
  the recording-owned cone. Stopping removes the recording-owned indicator.
- If My Location is independently enabled, it takes visual priority over the
  recording point and remains active across recording pause/stop.
- Hiding the retained Dashboard route or backgrounding the app suspends the
  foreground location watch and compass. The enabled toggle and last fix remain
  in memory; returning resumes sensors without re-centering.

The source policy is deliberately pure and centralized:

| Manual mode        | Recording state | Position                          | Heading                      |
| ------------------ | --------------- | --------------------------------- | ---------------------------- |
| enabled with a fix | any             | manual foreground fix             | active while runtime-visible |
| disabled/no fix    | `recording`     | latest valid accepted track point | active while runtime-visible |
| disabled/no fix    | `paused`        | latest valid accepted track point | off                          |
| disabled/no fix    | `idle`          | none                              | off                          |

Invalid trailing recording points are skipped, so a one-point track and the last
earlier valid point both remain representable.

## Architecture and ownership

`UserMapLocation` is the internal longitude/latitude presentation model. Pure
helpers in `src/utils/userLocation.ts` validate coordinates, choose the latest
recording point, prioritize the manual source, normalize degrees into
`[0, 360)`, and unwrap north crossings so `359° -> 0°` animates two degrees
rather than rotating backward through 359 degrees.

`useLiveUserLocation` owns the foreground toggle state machine around the
injectable `LocationWatcher` interface. It uses high accuracy and Android's
one-second update hints. Monotonic activation and watch generations prevent a
late permission result, watch start, fix, or error from reviving a cancelled or
suspended mode. Permission/watch failures deactivate the mode and flow through
the existing geolocation error modal.

`useDashboardGpsRecordingActions` exposes `currentRecordingLocation` derived
from the already accepted `currentTrackPoints`. It does not start another
location watch or change the recording coordinator's 15-second acceptance
cadence, persistence, background behavior, or storage schema.

`DeviceHeadingService` owns one process-wide native compass listener. The first
consumer starts it with a 100 ms minimum interval and 2-degree minimum change;
additional consumers share it; the final unsubscribe stops it. Setup failure, an
unsupported sensor, or a web runtime publishes no heading and leaves the dot
usable without showing another modal. `useDeviceHeading` owns wrap-safe display
animation state and keeps frequent heading renders inside the indicator.

`DashboardMapCanvas` combines route visibility with Capacitor app foreground
state and passes that runtime gate to both sensor paths. `AuthenticatedAppShell`
keeps Dashboard map state mounted across routes but marks it inactive, so a
hidden map consumes no foreground location or compass updates.

`UserLocationIndicator` owns the visual contract:

- `user-location-source` contains `user-location-dot` as a direct child. This
  preserves `react-map-gl` source injection and the long-press collision guard
  that queries `user-location-dot`.
- The cone is a pointer-transparent 112 px SVG marker with a roughly 50-degree,
  56 px high-opacity dark-blue radial gradient and a center mask around the dot.
  The stronger contrast keeps the heading readable over both light and dark map
  styles. Its screen size is independent of map zoom.
- CSS uses a short linear transform transition and disables it for
  `prefers-reduced-motion`.

Saved and live recording lines remain owned by `GpsMapLayers`; user-location
rendering is intentionally outside it.

On iOS, Capacitor invokes compass plugin calls on its bridge queue. The pinned
plugin patch synchronously marshals UIKit orientation reads and native sensor
start/stop operations to the main queue, keeps those operations idempotent, and
refreshes `CLLocationManager.headingOrientation` from main-queue device
orientation notifications. The app declares portrait, upside-down, landscape
left, and landscape right support so iPad validation and cone alignment share
the same orientation contract.

## Native compass integration

`@capgo/capacitor-compass` is pinned to `8.1.17`. Android uses the device sensor
and accounts for display rotation without another runtime permission. On iOS,
Core Location provides true heading under the app's existing location purpose
strings.

The pinned iOS package starts location/heading updates during plugin `load()`
even with no JavaScript subscriber, and its public `stopListening()` does not
stop those native updates. `scripts/patch-capgo-compass-package.mjs` is
therefore part of `postinstall`: it moves native start/stop ownership to the
public listener lifecycle and refreshes `CLLocationManager.headingOrientation`
for the foreground interface orientation. The patch is exact-match and fail-fast
so an upstream source change cannot silently drop the correction.

## Privacy and performance

Manual fixes and headings are ephemeral React/native state. Heading is never
persisted, logged, transmitted, or attached to a recorded track. Manual location
is never stored or sent. Only the existing explicit track/landmark flows persist
or transmit coordinates.

The compass is bounded to at most ten accepted native events per second and
requires two degrees of change. Only the small indicator subtree rerenders for
heading changes. Recording-position lookup scans backward only when the
recording point revision/state changes. Hidden/background maps stop both
foreground sensors.

## Verification strategy

- Pure tests cover coordinate selection, invalid tails, source priority, heading
  normalization, and circular unwrapping.
- Hook/service tests cover permission and startup races, first-fix behavior,
  suspension/resume, cleanup, first/last compass subscriber ownership, setup
  failure, invalid readings, and stale native completions.
- Indicator tests model production-like `Source -> Layer` injection, SVG
  geometry, dot-only fallback, wrap-safe transforms, and cleanup.
- Dashboard integration tests cover manual toggle/accessibility, recording
  active/pause policy, manual priority, error modal behavior, and route/app
  sensor suspension while retaining state.
- Native compilation proves bridge integration. Physical Android and iOS
  rotation checks remain mandatory for cardinal accuracy, north wraparound,
  portrait/landscape orientation, and unavailable-sensor fallback; compilation
  cannot prove physical sensor alignment.
