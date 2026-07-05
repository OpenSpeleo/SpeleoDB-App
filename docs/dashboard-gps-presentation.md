# Dashboard GPS Presentation

## Intent

Dashboard GPS dialogs and full-screen activity composition are isolated from map
rendering and GPS orchestration. This keeps visual policy reviewable while the
Dashboard remains the temporary owner of track, recording, and averaging state
during the staged decomposition.

## Ownership boundary

- `DashboardGpsActivity` composes the recording screen, recording-cancel
  confirmation, averaging modal, and averaging-reset confirmation.
- `DashboardGpsTrackDialogs` composes upload, delete, and edit dialogs. It owns
  local-versus-remote deletion copy and the selected-color presentation.
- `Dashboard` still owns the state transitions and action handlers passed to
  these components. Moving that orchestration is a separate refactoring so this
  extraction remains behavior-preserving and independently reviewable.
- Existing leaf components continue to own their documented visual contracts;
  the Dashboard wrappers only connect typed props and callbacks.

The wrappers do not access the controller, storage, network, lifecycle, timers,
or map instance. Data and busy state enter through props; user intent leaves
through callbacks. Dismissal follows the same guarded callbacks as the former
inline JSX, including the edit dialog's busy-state protection.

## Testing and verification

`DashboardGpsPresentation.test.tsx` exercises the local and remote deletion
copy, busy edit behavior, and edit-field/color callbacks. The Dashboard
characterization suite verifies the complete recording, averaging, upload, edit,
and delete journeys across the extraction boundary. Together they cover both
production wrappers at 100% statement, branch, function, and line coverage.

## Performance implications

The wrappers add no effects, listeners, timers, requests, or data transforms.
They preserve the existing conditional mounting behavior and reduce the amount
of render policy owned by `Dashboard`. Both production modules remain below the
repository's 600-line module budget.
