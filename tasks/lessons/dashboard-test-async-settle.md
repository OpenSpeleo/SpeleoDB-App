# Dashboard Tests Must Settle Async Mount Effects

## Lesson

Dashboard tests that switch to fake timers must first wait for the initial map,
sync, and overlay effects to settle before simulating pointer gestures.

## Pattern

The Dashboard mounts several async effects (`syncProjects`, map style loading,
overlay GeoJSON loading, and map icon loading). If a test starts gesture/timer
assertions while those effects are still committing state, React can emit
unwrapped `act(...)` warnings after the assertion even when the gesture logic is
correct.

## Rule

Before testing fake-timer pointer behavior in Dashboard:

- wait for the map touch surface;
- wait for the loaded layer or overlay that proves initial data effects landed;
- flush one async `act` tick before advancing timers.
