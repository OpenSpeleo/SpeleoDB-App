# Guided Tour

This document defines the interactive guided tour that teaches users how to use the dashboard features after first login.

## Purpose

The guided tour walks users through the dashboard UI step-by-step, highlighting key features and waiting for the user to perform gestures before advancing. It runs after the onboarding modal is dismissed on first login and can be re-triggered from a help button in the header.

## When it runs

- **Auto-start**: Triggers after the user dismisses the onboarding modal on first login. If `hasCompletedGuidedTour` is true, skip the tutorial. If false or missing, queue the tutorial and start it only once dashboard initial sync has settled.
- **Re-trigger**: A "?" help button in the dashboard floating header resets `hasCompletedGuidedTour` and restarts the tour, but still waits for initial sync readiness before opening step 1.
- **Persistence**: Tour completion is persisted as `hasCompletedGuidedTour: true` in `UserPreferences` via `PreferencesService`. Cleared on logout (full preference wipe).
- **Manual close**: Steps 1-7 expose a close control so users can stop early.
- **Close trigger**: Early close is intentionally explicit-control only. Backdrop taps are ignored and do not close or persist completion.
- **Close persistence**: Manual close is treated as completed (`hasCompletedGuidedTour: true`) so the tour does not auto-open again on future launches.
- **Sync gate source**: Readiness is exposed by `Dashboard` on `[data-tour="header"][data-tour-sync-ready="true"]` after the first `syncProjects()` call resolves (done or error).

## Library: driver.js

Choices: react-joyride, @reactour/tour, NextStep, Shepherd.js, intro.js, OnboardJS

## Tour flow: 8 steps

### Step 1: "Status bar"

- **Target**: `[data-tour="header"]` (floating header bar)
- **Popover**: Bottom. Explains project count and sync status.
- **Interaction**: User taps "Next" to advance, or "Close" to stop the tutorial. Back button remains hidden on this first step (`showButtons: ['next', 'close']`).
- **Stage framing**: Uses zero stage padding/radius so the highlight aligns flush with the top header edge.

### Step 2: "Pull down and refresh"

- **Target**: `[data-tour="header"]` (anchors popover to header)
- **Popover**: Bottom. Instructs user to drag down while a separate gesture cue overlay demonstrates the motion.
- **Popover spacing**: While `tour-step-pull-refresh` is active, `.tour-step-pull-refresh.driver-active .driver-popover.guided-tour-popover` applies `translateY(100px)` so this text container sits lower without runtime driver reconfiguration during the step-2 -> step-3 transition.
- **Visual cue**: Uses `src/assets/media/gesture-icons/finger_slide_down.svg` as the gesture icon in a fixed overlay (outside the popover body).
- **Placement**: The icon anchor prefers the active sync-status label (`Syncing...`) and otherwise the projects-count label (`N projects`) so the icon top aligns with that header text row.
- **Layering**: The finger icon is rendered at the highest cue layer with the touch bubble centered directly beneath it at the same anchor point.
- **Motion phases**: The icon loops through hold-at-start -> drag-down -> hold-at-bottom -> reset to make pull direction explicit.
- **Interaction**: Next button remains hidden. A close control remains available while the tour waits for pull-to-refresh.
- **Detection**: `ionRefresh` is treated only as start signal. Progression requires a dedicated completion signal.
- **Gesture passthrough**: `tour-step-pull-refresh` class on `document.body` forces map touch-surface and refresher controls to `pointer-events: auto`, allowing pull gestures to pass through while the tour remains active.
- **Completion gate**: `Dashboard` dispatches `speleo:refresh-complete` only after `event.detail.complete()`, a minimum settle delay, refresher animation-state checks, and consecutive stable vertical-position samples (with fallback timeout). The tour advances only on that event to avoid step-2/step-3 blink while the page is still sliding back.
- **Feedback**: The overlay cue is hidden on refresh start, text updates to "Refreshing...", then "Nice! Moving on..." once completion arrives.
- **Stage framing**: Keeps zero stage padding/radius for the header target to avoid top-edge offset.

### Step 3: "Open the project panel"

- **Target**: `[data-tour="menu-toggle"]` (hamburger button)
- **Popover**: Right side (away from screen edge), start-aligned to the menu button so the box sits lower and avoids top-edge crowding.
- **Interaction**: Next button hidden. Tour waits for user to tap the button.
- **Detection**: Capture-phase click interception on the menu toggle.
- **Handoff behavior**: On click, the tour consumes the original event, hides popover/arrow/highlight chrome (`tour-step-transition-handoff`), re-emits a synthetic native click to the same button, then continues once panel-open readiness checks pass.
- **Advance timing**: Uses an initial 600ms settle window before readiness polling begins, then advances as soon as panel-open controls are available.
- **Stage padding**: Increased to 14px via runtime `setConfig()` to make the cutout more prominent around the small button. Resets to 8px on subsequent steps.
- **Stability refresh**: To avoid overlay/mask flicker during step transitions, this step does not run continuous refresh loops; it relies on the normal step-entry refresh path.
- **Clickthrough guard**: `tour-step-menu-clickthrough` class disables overlay pointer capture and raises the active menu button above the overlay to keep the hamburger reliably tappable.
- **Panel-open guard**: Tour waits for `[data-tour="project-panel"][data-tour-open="true"]` before entering bulk-action steps.
- **Deferred project check**: This step no longer decides whether project-specific steps are skipped. It advances to bulk-action steps as soon as panel controls are available.

### Step 4: "Hide all projects"

- **Target**: `[data-tour-action="hide-all"]` (Hide all button)
- **Popover**: Bottom. Instructs the user to hide all projects.
- **Interaction**: User clicks `Hide all`.

### Step 5: "Show all projects"

- **Target**: `[data-tour-action="show-all"]` (Show all button)
- **Popover**: Bottom. Instructs the user to restore all projects.
- **Interaction**: User clicks `Show all`.
- **Deferred skip point**: After click, the tour waits up to 6 seconds for first-project controls (`project-toggle` / `project-name`) to appear before moving to step 6. If targets never appear within that grace period, it jumps to completion.

### Step 6: "Toggle a project"

- **Target**: `[data-tour="project-toggle"]` (first project's toggle switch only)
- **Popover**: Bottom/end. Placed under the project row to avoid clipping and keep arrow alignment on the toggle highlight.
- **Interaction**: User needs to change the project visibility toggle.
- **Conditional**: Skipped if no projects are loaded.

### Step 7: "Center on a project"

- **Target**: `[data-tour="project-name"]` (first project's name button only)
- **Popover**: Bottom. Appears under the highlighted project name to avoid covering the focus target.
- **Interaction**: User clicks the highlighted first project name.
- **Handoff behavior**: Tour intercepts the click, hides popover/arrow/highlight chrome (`tour-step-transition-handoff`), re-emits a native click to preserve normal dashboard behavior, and then waits for zoom completion.
- **Auto-close**: The project panel closes automatically after the user clicks a project name, so the map zoom animation is immediately visible without the panel obscuring it. This mirrors the general dashboard behavior.
- **Completion gate**: Step does not advance until `Dashboard` dispatches `speleo:project-zoom-complete` (triggered from map movement completion callbacks).
- **Conditional**: Skipped if no projects are loaded.

### Step 8: "Tour complete"

- **Target**: none (centered popover)
- **Popover**: Confirms tutorial completion.
- **Interaction**: User taps `Finish`.
- **Entry timing**: Shown after step 7 receives `speleo:project-zoom-complete`, or via the runtime skip path when project-step targets never materialize after step 5.
- **Completion side effect**: Sets `hasCompletedGuidedTour = true`.

### Completion

- `hasCompletedGuidedTour` is set to `true` in preferences when Step 8 `Finish` is pressed or when the user manually closes the tour during steps 1-7.

### Separation from app code

The tour module is deliberately decoupled from the React component tree.
The objective is to keep the onboarding tutorial code as clearly and sharply separated as possible to minimize the likelihood of bugs. 
  
## CSS theming

The tour popover is styled to match the app's dark slate/purple theme in `src/onboarding/guidedTour/tourStyles.css`:

- Background: `#1e293b` (slate-800)
- Border: `2px solid rgba(248, 250, 252, 0.78)` (high-contrast near-white outline)
- Text: `#f1f5f9` titles, `#cbd5e1` descriptions
- Buttons: Purple primary (`#a855f7`), bright slate secondary (`#e2e8f0`)
- Pointer arrow: Side-specific triangle borders (driver.js native shape) with increased size and light drop shadow for clear target direction
- Shadow: Dark elevation plus subtle light ring for readability over the overlay
- Step 2 cue: `.guided-tour-pull-gesture-overlay` renders `finger_slide_down.svg` with a downward drag animation plus an anchored bubble layer, with explicit z-ordering (`icon > bubble`), `pointer-events: none`, and a reduced-motion fallback.

## Edge cases

- **No projects**: Steps 4-5 still run (bulk controls), then steps 6-7 are skipped if first-project targets do not appear within the step-5 grace period.
- **Flow construction**: The full 8-step flow is always constructed; project-step skipping is resolved only at runtime transition points.
- **User closes tour early**: Allowed from steps 1-7 and treated as completion for persistence.
- **Tour re-trigger**: Help button ignores `hasCompletedGuidedTour` and start tutorial from step 1.
- **Offline mode**: Tour works identically offline (pure DOM/UI, no network dependency).
- **App backgrounded during tour**: do nothing.


## Change checklist

When modifying the guided tour:

1. Verify step definitions.
2. Verify interactive steps (pull-to-refresh, open-panel) correctly detect gestures and advance.
3. Verify the tour auto-starts after onboarding modal dismissal on first login.
4. Verify the tour does not auto-start on subsequent logins (persistence check).
5. Verify the help button re-triggers the tour.
6. Verify manual close on steps 1-7 marks tour as completed and suppresses future auto-start.
7. Verify gesture passthrough works for the pull-to-refresh step.
8. Run `npx vitest run src/onboarding/` for tour-specific tests.
9. Update this document if step flow, architecture, or persistence behavior changes.
