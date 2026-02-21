# Guided Tour

This document defines the interactive guided tour that teaches users how to use the dashboard features after first login.

## Purpose

The guided tour walks users through the dashboard UI step-by-step, highlighting key features and waiting for the user to perform gestures before advancing. It runs after the onboarding modal is dismissed on first login and can be re-triggered from the Settings page.

## Lifecycle

- **Auto-start**: Triggers after the user dismisses the onboarding modal on first login, but only once project sync (including all GeoJSON downloads) has completed (`syncStatus` is `done` or `error`). If `hasCompletedGuidedTour` is true, skip the tutorial. If false or missing, start the tutorial.
- **Re-trigger**: A "Show Tutorial" button in the Settings page resets `hasCompletedGuidedTour` and restarts the tour.
- **Persistence**: Tour completion is persisted as `hasCompletedGuidedTour: true` in `UserPreferences` via `PreferencesService`. Cleared on logout (full preference wipe).
- **Manual close**: Steps 1-5 expose a close control so users can stop early.
- **Close trigger**: Early close is intentionally explicit-control only. Backdrop taps are ignored and do not close or persist completion.
- **Close persistence**: Manual close is treated as completed (`hasCompletedGuidedTour: true`) so the tour does not auto-open again on future launches.

## Library: driver.js

Choices: react-joyride, @reactour/tour, NextStep, Shepherd.js, intro.js, OnboardJS

## Tour flow: 6 steps

### Step 1: "Open the project panel"

- **Target**: `[data-tour="menu-toggle"]` (Projects tab in the bottom navigation bar)
- **Popover**: Top side, start-aligned to the Projects button.
- **Interaction**: Next button hidden. Tour waits for user to tap the button.
- **Detection**: Capture-phase click interception on the menu toggle.
- **Handoff behavior**: On click, the tour consumes the original event, hides popover/arrow/highlight chrome (`tour-step-transition-handoff`), re-emits a synthetic native click to the same button, then continues once panel-open readiness checks pass.
- **Advance timing**: Uses an initial 600ms settle window before readiness polling begins, then advances as soon as panel-open controls are available.
- **Stage padding**: Increased to 14px via runtime `setConfig()` to make the cutout more prominent around the button. Resets to 8px on subsequent steps.
- **Clickthrough guard**: `tour-step-menu-clickthrough` class disables overlay pointer capture and raises the active menu button above the overlay to keep it reliably tappable.
- **Panel-open guard**: Tour waits for `[data-tour="project-panel"][data-tour-open="true"]` before entering bulk-action steps.
- **Deferred project check**: This step no longer decides whether project-specific steps are skipped. It advances to bulk-action steps as soon as panel controls are available.

### Step 2: "Hide all projects"

- **Target**: `[data-tour-action="hide-all"]` (Hide all button)
- **Popover**: Bottom. Instructs the user to hide all projects.
- **Interaction**: User clicks `Hide all`.

### Step 3: "Show all projects"

- **Target**: `[data-tour-action="show-all"]` (Show all button)
- **Popover**: Bottom. Instructs the user to restore all projects.
- **Interaction**: User clicks `Show all`.
- **Deferred skip point**: After click, the tour waits up to 6 seconds for first-project controls (`project-toggle` / `project-name`) to appear before moving to step 4. If targets never appear within that grace period, it jumps to completion.

### Step 4: "Toggle a project"

- **Target**: `[data-tour="project-toggle"]` (first project's toggle switch only)
- **Popover**: Bottom/end. Placed under the project row to avoid clipping and keep arrow alignment on the toggle highlight.
- **Interaction**: User needs to change the project visibility toggle.
- **Conditional**: Skipped if no projects are loaded.

### Step 5: "Center on a project"

- **Target**: `[data-tour="project-name"]` (first project's name button only)
- **Popover**: Bottom. Appears under the highlighted project name to avoid covering the focus target.
- **Interaction**: User clicks the highlighted first project name.
- **Handoff behavior**: Tour intercepts the click, hides popover/arrow/highlight chrome (`tour-step-transition-handoff`), re-emits a native click to preserve normal dashboard behavior, and then waits for zoom completion.
- **Auto-close**: The project panel closes automatically after the user clicks a project name, so the map zoom animation is immediately visible without the panel obscuring it.
- **Completion gate**: Step does not advance until `Dashboard` dispatches `speleo:project-zoom-complete` (triggered from map movement completion callbacks).
- **Conditional**: Skipped if no projects are loaded.

### Step 6: "Tour complete"

- **Target**: none (centered popover)
- **Popover**: Confirms tutorial completion.
- **Interaction**: User taps `Finish`.
- **Entry timing**: Shown after step 5 receives `speleo:project-zoom-complete`, or via the runtime skip path when project-step targets never materialize after step 3.
- **Completion side effect**: Sets `hasCompletedGuidedTour = true`.

### Completion

- `hasCompletedGuidedTour` is set to `true` in preferences when Step 6 `Finish` is pressed or when the user manually closes the tour during steps 1-5.

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

- **No projects**: Steps 2-3 still run (bulk controls), then steps 4-5 are skipped if first-project targets do not appear within the step-3 grace period.
- **Flow construction**: The full 6-step flow is always constructed; project-step skipping is resolved only at runtime transition points.
- **User closes tour early**: Allowed from steps 1-5 and treated as completion for persistence.
- **Tour re-trigger**: Settings "Show Tutorial" button ignores `hasCompletedGuidedTour` and starts the tutorial from step 1.
- **Offline mode**: Tour works identically offline (pure DOM/UI, no network dependency).
- **App backgrounded during tour**: do nothing.

## Source code

- Step definitions: `src/onboarding/guidedTour/steps.ts`
- Tour engine: `src/onboarding/guidedTour/engine.ts`
- Selectors and events: `src/onboarding/guidedTour/selectors.ts`
- Tour CSS: `src/onboarding/guidedTour/tourStyles.css`
- Tour re-trigger: `src/pages/Settings.tsx` ("Show Tutorial" button)

## Change checklist

When modifying the guided tour:

1. Verify step definitions in `steps.ts` match this document.
2. Verify interactive steps (open-panel, hide/show, toggle, center) correctly detect gestures and advance.
3. Verify the tour auto-starts after onboarding modal dismissal on first login.
4. Verify the tour does not auto-start on subsequent logins (persistence check).
5. Verify the Settings "Show Tutorial" button re-triggers the tour.
6. Verify manual close on steps 1-5 marks tour as completed and suppresses future auto-start.
7. Run `npx vitest run src/onboarding/` for tour-specific tests.
8. Update this document if step flow, architecture, or persistence behavior changes.
