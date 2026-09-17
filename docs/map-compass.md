# Map compass

## Intent and interaction

The fourth map action, immediately below Offline Maps, toggles a small compass
above the source credits in the bottom-right corner. It displays the physical
heading of the phone while the map stays north-up. It works independently of the
My Location toggle and GPS recording.

The compass starts hidden. Press **Show compass** to show it; the button becomes
cyan and its compass icon is crossed out to indicate **Hide compass** as the
next action. The button has a 44px touch target, keyboard focus styling, and an
accessible pressed state. The choice stays in the mounted Dashboard session; it
is not a persisted setting. Area editing hides the compass and its toolbar, then
restores the previous choice when editing ends.

The rose is capped at 172px and 40% of the actual map width. It uses eight
upright direction labels at 45° intervals: N, NE, E, SE, S, SW, W, NW. The
center readout retains all sixteen standard wind directions at 22.5° intervals,
including three-letter directions such as NNW and WNW. This keeps the rose
uncluttered while preserving heading detail. North and the heading pointer are
cyan, with a high-contrast dark face and a prominent whole-degree readout.
Degrees are normalized and rounded into 0–359°, and the abbreviated direction is
the nearest wind to the unrounded heading. A dash and **No heading** replace the
value when the sensor has not supplied a reading or is unavailable. The pointer
is omitted in that state; map bearing and GPS course are never used as
substitutes.

## Architecture and ownership

`DashboardMapCanvas` owns the visibility toggle and combines route visibility
with app foreground state. `MapCompass` lives inside the map and subscribes via
the existing `useDeviceHeading` hook. `DeviceHeadingService` remains the single
owner of native listener setup and teardown. The compass and user-location cone
are separate consumers: hiding one cannot stop the other's heading updates. Both
release their subscription while the route or app is inactive. Area editing
unmounts only the compass consumer, preserving any location-cone subscription.

The compass uses `useControl` and a React portal to join MapLibre's bottom-right
control stack. This gives the source credits their actual required height,
including when expanded, instead of assuming a fixed attribution height.
Unmounting removes both the control element and heading subscription.
`MapControlLayout` remains mounted independently so source credits stay clear of
the four-button toolbar even with the compass hidden. It measures the actual
map, toolbar, depth gauge, distance scale, and MapLibre control stack, reserving
an overlay's column or bottom row only when their rectangles overlap. This
avoids viewport breakpoints that fail with a slightly wider phone, changed
safe-area insets, or wrapped attribution. The depth gauge sits beside the
toolbar so the fourth button cannot cover its lower labels. The dial is
pointer-transparent, so dragging its area still pans the map.

The layout owner observes container and control dimensions, refreshes its
observed elements when compass visibility, depth mode, or editor toolbar
visibility changes, and coalesces resize callbacks into one animation-frame
task. Deferring writes avoids a ResizeObserver feedback loop when moving the
credits changes their wrapping. This is event-driven layout work, with no
polling or work on heading ticks. Cleanup disconnects the observer, cancels a
queued task, and releases offsets.

The control measures its map container and observes container resizes with
`ResizeObserver`. It sets the diameter to the smaller of 172px and 40% of the
map width, rounded down so fractional pixels cannot exceed the cap. This also
handles changes to map width without a viewport resize. A CSS custom property
sizes the square dial and scales the numeric readout, avoiding extra React
renders or newer container-query CSS requirements. Removing the control
disconnects the observer.

The static compass rose is memoized. Only the small compass subtree responds to
heading readings; no heading state is lifted into Dashboard or the map-layer
composition. The existing native 100ms / 2° thresholds remain authoritative. The
pointer uses the hook's unwrapped degrees for short-path north crossings;
display text uses normalized degrees. Reduced-motion preferences disable the
pointer transition. One accessible image name exposes the current reading
without announcing every sensor update through an ARIA live region.

## Native boundaries and privacy

There are no new dependencies, native APIs, storage writes, network requests,
location permission requests, or application geolocation watches. Headings
remain ephemeral and are not logged or attached to tracks. The existing iOS
compass plugin starts Core Location updates for true heading; this feature does
not change that native behavior or its authorization requirements. If no valid
true heading is available, the readout stays unavailable. Web runtimes without
the native sensor likewise show the neutral state. See
[user location and heading](user-location-heading.md) for shared sensor details.

## Verification

- `MapCompass.test.tsx` exercises the actual component, hook, control lifecycle,
  all sixteen directions, normalization, rounding, sector boundaries, north
  crossings, unavailable readings, subscription cleanup, and StrictMode
  remounts, plus map-relative sizing and resize-observer cleanup.
- `MapControlLayout.test.tsx` exercises the layout owner's real effect and
  observer boundary: actual overlay reservations, coalescing, reclaiming space,
  hidden-compass ownership, changed overlay subscriptions, and cleanup. Browser
  tests remain authoritative for rendered geometry.
- `Dashboard.test.tsx` drives the real shared heading service through its plugin
  boundary. It proves default visibility, action semantics, independent
  operation, shared ownership in both removal orders, route/app suspension,
  recording pause/stop, and area editing restoration. It also holds native
  startup pending across hide/route/background cancellation, delivers retired
  callbacks after resumption, checks startup failure/retry and invalid samples,
  and proves that heading changes do not rerender the map viewport.
- `DeviceHeadingService.test.ts` retains native callbacks and defers the actual
  bridge promises to prove stale-callback rejection across shutdown and restart,
  subscriber replacement, failed setup and teardown, and last-consumer cleanup.
- `tests/browser/offline-maps.spec.ts` uses production assets in Chromium and
  WebKit, with a narrow native compass bridge fixture. It verifies actual
  heading rendering, control geometry, reduced motion, expanded source credits,
  safe-area layouts, short screens, and pointer pass-through, and captures
  screenshots. Adversarial cases verify keyboard focus and Enter/Space
  activation, native listener cleanup across real route changes, failed sensor
  startup and retry, the browser's actual CSS interpolation across north in both
  directions, a changed reduced-motion preference, and real map dragging through
  the dial. Geometry checks include 320×400 and 320×480 depth layouts with
  expanded credits. Regression cases cross the former 400px width and 540px
  height breakpoints and verify source-credit clearance with the compass hidden,
  expanded/collapsed credits, live depth-mode changes and viewport resizing,
  without browser or ResizeObserver errors.

The browser fixture proves presentation and integration, not physical sensor
accuracy. Release checks on physical iOS and Android must cover cardinal
headings, 359° ↔ 0° movement, portrait/landscape rotation, available/denied
authorization, compass plus My Location/recording, and background/foreground
transitions. Commands, results and device limitations are recorded in
[the task review](../tasks/todos/map-compass.md).
