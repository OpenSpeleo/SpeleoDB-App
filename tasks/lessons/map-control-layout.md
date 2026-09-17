# Map controls need shared layout and rendered verification

Position a group of map controls once, then use normal layout flow and shared
button geometry. Independent absolute offsets can overlap when safe-area or
button styles change. Test actual rendered bounds and popup hit targets with
nonzero safe-area insets. Keep editor actions together in its reachable sheet;
verify Cancel and Save by tapping them at short viewport heights, without
scrolling them into view to conceal clipping.

Reserve measured overlay rows and columns instead of assuming viewport
breakpoints imply clearance: wrapped attribution and safe-area offsets change
the actual geometry. Keep shared layout ownership alive when an optional dial is
hidden, and refresh observed DOM elements when editing or a mode switch replaces
controls. Probe both sides of responsive boundaries, then repeat the clearance
checks after hide/show and editor exit. Resize-driven layout writes must be
coalesced outside the observer delivery loop and cancelled on cleanup.

Programmatic `scrollTop` changes precede scroll-event delivery. Before testing
an indicator's movement, assert its rendered starting position after a reset;
otherwise the test can compare two end positions and report a false failure.

Map-space selections must preserve geographic bounds across layout changes.
MapLibre's resize observer can lag behind the DOM and emits `move` events
without a user gesture. Batch editor activation with chrome changes, synchronize
the map size before projection, and treat non-user camera events as frame
repositioning, not geometry edits. Test both resize callback orderings and Edit
→ Save against real persisted coordinates; screenshots and mocked `fitBounds`
alone miss drift.
