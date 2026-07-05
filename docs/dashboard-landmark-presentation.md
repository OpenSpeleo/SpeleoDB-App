# Dashboard Landmark Presentation

## Intent

Landmark action state and landmark rendering are separate responsibilities.
`useDashboardLandmarkActions` owns state transitions and side effects;
`DashboardLandmarkDialogs` and `DashboardLandmarkFeedback` render those values
without reading controller, storage, map, or native state.

This is the final Dashboard presentation split. The page remains the wiring
façade, while detail, form, deletion, toast, and long-press surfaces have a
focused typed boundary.

## Ownership

`DashboardLandmarkDialogs` owns composition of:

- the selected overlay/landmark detail modal and its create/edit/delete actions;
- conditional create/edit form presentation and submit/cancel forwarding; and
- destructive landmark confirmation copy, busy state, and callbacks.

`DashboardLandmarkFeedback` owns:

- success/error toast styling and message presentation; and
- the long-press progress ring geometry derived from canonical map constants.

The two components are intentionally separate so `DashboardGpsTrackDialogs`
retains its existing stacking position between landmark dialogs and transient
feedback. No z-order or simultaneous-modal behavior changes as a side effect of
the extraction.

## Invariants

- A null form renders no form modal.
- A null deletion target renders no confirmation.
- A landmark name is included in destructive copy; the normalized `N/A` value
  uses anonymous copy.
- Success and error toasts retain distinct solid-color presentation.
- A null long-press point renders no ring. A present point uses the configured
  reveal-adjusted duration, size, and stroke without duplicating constants.
- Presentation callbacks are forwarded unchanged to the action and interaction
  owners; this module has no mutation policy.

## Verification and performance

`DashboardLandmarkPresentation.test.tsx` covers absent and active surfaces,
named and anonymous deletion copy, form/delete callback forwarding, both toast
tones, and canonical ring geometry. The production module has 100% statement,
branch, function, and line coverage. Dashboard's characterization suite remains
the end-to-end component seam for real marker, form, mutation, toast, and
long-press behavior.

The extraction adds no state, effect, timer, listener, or data scan. Dashboard
is 535 lines afterward; the 144-line presentation module and all of its
functions remain within architecture budgets.
