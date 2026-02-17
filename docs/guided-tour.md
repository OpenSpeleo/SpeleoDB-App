# Guided Tour

This document defines the interactive guided tour that teaches users how to use the dashboard features after first login.

## Purpose

The guided tour walks users through the dashboard UI step-by-step, highlighting key features and waiting for the user to perform gestures before advancing. It runs after the onboarding modal is dismissed on first login and can be re-triggered from a help button in the header.

## When it runs

- **Auto-start**: Triggers after the user dismisses the onboarding modal on first login. If `hasCompletedGuidedTour` is true, skip the tutorial. If false or missing, run the tutorial.
- **Re-trigger**: A "?" help button in the dashboard floating header resets `hasCompletedGuidedTour` and restarts the tour.
- **Persistence**: Tour completion is persisted as `hasCompletedGuidedTour: true` in `UserPreferences` via `PreferencesService`. Cleared on logout (full preference wipe).
- **No Skip**: The user can not close the tour. This is a mandatory step.

## Library: driver.js

Choices: react-joyride, @reactour/tour, NextStep, Shepherd.js, intro.js, OnboardJS

## Tour flow: 8 steps

### Step 1: "Status bar"

- **Target**: `[data-tour="header"]` (floating header bar)
- **Popover**: Bottom. Explains project count and sync status.
- **Interaction**: User taps "Next" to advance. Back button is hidden on this first step (`showButtons: ['next']`).
- **Stage framing**: Uses zero stage padding/radius so the highlight aligns flush with the top header edge.

### Step 2: "Pull down and refresh"

- **Target**: `[data-tour="header"]` (anchors popover to header)
- **Popover**: Bottom. Instructs user to drag down. Shows animated CSS arrow.
- **Interaction**: Next button hidden. Tour waits for user to perform pull-to-refresh gesture.
- **Detection**: `ionRefresh` is treated only as start signal. Progression requires a dedicated completion signal.
- **Gesture passthrough**: `tour-step-pull-refresh` class on `document.body` forces map touch-surface and refresher controls to `pointer-events: auto`, allowing pull gestures to pass through while the tour remains active.
- **Completion gate**: `Dashboard` dispatches `speleo:refresh-complete` only after `event.detail.complete()`, a minimum settle delay, refresher animation-state checks, and consecutive stable vertical-position samples (with fallback timeout). The tour advances only on that event to avoid step-2/step-3 blink while the page is still sliding back.
- **Feedback**: Pull arrow is removed on refresh start, text updates to "Refreshing...", then "Nice! Moving on..." once completion arrives.
- **Stage framing**: Keeps zero stage padding/radius for the header target to avoid top-edge offset.

### Step 3: "Open the project panel"

- **Target**: `[data-tour="menu-toggle"]` (hamburger button)
- **Popover**: Right side (away from screen edge), start-aligned to the menu button so the box sits lower and avoids top-edge crowding.
- **Interaction**: Next button hidden. Tour waits for user to tap the button.
- **Detection**: Capture-phase click interception on the menu toggle.
- **Handoff behavior**: On click, the tour consumes the original event, hides popover/arrow/highlight chrome (`tour-step-transition-handoff`), re-emits a synthetic native click to the same button, then continues once panel-open readiness checks pass.
- **Advance timing**: Still uses a short 600ms settle after panel-open readiness to match panel slide timing.
- **Stage padding**: Increased to 14px via runtime `setConfig()` to make the cutout more prominent around the small button. Resets to 8px on subsequent steps.
- **Stability refresh**: The tour forces an initial burst and then continuous `driver.refresh()` while this step is active to keep the menu cutout aligned if refresher/layout animations are still settling.
- **Clickthrough guard**: `tour-step-menu-clickthrough` class disables overlay pointer capture and raises the active menu button above the overlay to keep the hamburger reliably tappable.
- **Panel-open guard**: Tour waits for `[data-tour="project-panel"][data-tour-open="true"]` before entering bulk-action steps.
- **Deferred project check**: This step no longer decides whether project-specific steps are skipped. It advances to bulk-action steps as soon as panel controls are available.

### Step 4: "Hide all projects"

- **Target**: `[data-tour-action="hide-all"]` (Hide all button)
- **Popover**: Right. Instructs the user to hide all projects.
- **Interaction**: User clicks `Hide all`.

### Step 5: "Show all projects"

- **Target**: `[data-tour-action="show-all"]` (Show all button)
- **Popover**: Right. Instructs the user to restore all projects.
- **Interaction**: User clicks `Show all`.
- **Deferred skip point**: After click, the tour waits for first-project controls (`project-toggle` / `project-name`) to appear before moving to step 6. If targets never appear within grace period, it jumps to completion.

### Step 6: "Toggle a project"

- **Target**: `[data-tour="project-toggle"]` (first project's toggle switch only)
- **Popover**: Bottom/end. Placed under the project row to avoid clipping and keep arrow alignment on the toggle highlight.
- **Interaction**: User needs to change the project visibility toggle.
- **Conditional**: Skipped if no projects are loaded.

### Step 7: "Center on a project"

- **Target**: `[data-tour="project-name"]` (first project's name button only)
- **Popover**: Left. Explains zoom-to-project behavior.
- **Interaction**: User clicks the highlighted first project name.
- **Handoff behavior**: Tour intercepts the click, hides popover/arrow/highlight chrome (`tour-step-transition-handoff`), re-emits a native click to preserve normal dashboard behavior, and then waits for zoom completion.
- **Auto-close**: The project panel closes automatically after the user clicks a project name, so the map zoom animation is immediately visible without the panel obscuring it. This mirrors the general dashboard behavior.
- **Completion gate**: Step does not advance until `Dashboard` dispatches `speleo:project-zoom-complete` (triggered from map movement completion callbacks).
- **Conditional**: Skipped if no projects are loaded.

### Step 8: "Tour complete"

- **Target**: none (centered popover)
- **Popover**: Confirms tutorial completion.
- **Interaction**: User taps `Finish`.
- **Entry timing**: Shown only after step 7 receives `speleo:project-zoom-complete`.
- **Completion side effect**: Sets `hasCompletedGuidedTour = true`.

### Completion

- `hasCompletedGuidedTour` is set to `true` in preferences only when Step 8 `Finish` is pressed.

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

## Edge cases

- **No projects**: Steps 4-5 still run (bulk controls), then steps 6-7 are skipped if first-project targets do not appear within the step-5 grace period.
- **Flow construction**: The full 8-step flow is always constructed; project-step skipping is resolved only at runtime transition points.
- **User closes tour early**: should not be allowed. The user must complete the tutorial.
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
6. Verify gesture passthrough works for the pull-to-refresh step.
7. Run `npx vitest run src/onboarding/` for tour-specific tests.
8. Update this document if step flow, architecture, or persistence behavior changes.
