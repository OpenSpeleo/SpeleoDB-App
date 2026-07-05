# Guided Tour

This document defines the interactive guided tour that teaches users how to use
the dashboard and Settings after first login.

## Purpose

The guided tour walks users through the dashboard and Settings UI step-by-step,
highlighting key features and waiting for the user to perform gestures on the
two tab steps. It runs after the onboarding modal is dismissed on first login
and can be re-triggered from the Settings page.

## Lifecycle

- **Auto-start**: Triggers after the user dismisses the onboarding modal on
  first login, but only once project sync (including all GeoJSON downloads) has
  completed (`syncStatus` is `done` or `error`). If `hasCompletedGuidedTour` is
  true, skip the tutorial. If false or missing, start the tutorial.
- **Re-trigger**: A "Show Tutorial" button in the Settings page resets
  `hasCompletedGuidedTour` and restarts the tour.
- **Persistence**: Tour completion is persisted as
  `hasCompletedGuidedTour: true` in `UserPreferences` via `PreferencesService`.
  Cleared on logout (full preference wipe).
- **Manual close**: Steps 1-5 expose a close control so users can stop early.
- **Close trigger**: Early close is intentionally explicit-control only.
  Backdrop taps are ignored and do not close or persist completion.
- **Close persistence**: Manual close is treated as completed
  (`hasCompletedGuidedTour: true`) so the tour does not auto-open again on
  future launches.

## Library: driver.js

Choices: react-joyride, @reactour/tour, NextStep, Shepherd.js, intro.js,
OnboardJS

## Tour flow: 6 steps

The tour has two gesture-driven tab steps (1 and 2) followed by three
descriptive Settings steps (3-5) advanced via Next, then completion.

### Step 1: "Open the project panel"

- **Target**: `[data-tour="menu-toggle"]` (Projects tab in the bottom navigation
  bar).
- **Popover**: Top side, start-aligned to the Projects button.
- **Interaction**: Next button hidden. Tour waits for the user to tap the
  button.
- **Detection**: Capture-phase click interception on the menu toggle.
- **Handoff behavior**: On click, the tour consumes the original event, hides
  popover/arrow/highlight chrome (`tour-step-transition-handoff`), re-emits a
  synthetic native click to the same button, then continues once the panel-open
  readiness check passes.
- **Advance timing**: Uses an initial 600ms settle window before readiness
  polling begins, then advances as soon as the panel exposes
  `[data-tour="project-panel"][data-tour-open="true"]`.
- **Stage padding**: Increased to 14px via runtime `setConfig()` to make the
  cutout more prominent. Resets to 8px on subsequent steps.
- **Clickthrough guard**: `tour-step-tab-clickthrough` class disables overlay
  pointer capture and raises the active tab button above the overlay so the tap
  reliably reaches the real tab.
- **Timeout**: If the panel never reports `data-tour-open="true"` within ~1.2s
  after the click, jumps to completion.

### Step 2: "Open Settings"

- **Target**: `[data-tour="settings-tab"]` (Settings tab in the bottom
  navigation bar).
- **Popover**: Top side, end-aligned (Settings is the rightmost tab).
- **Interaction**: Next button hidden. Tour waits for the user to tap the
  button.
- **Handoff behavior**: Same handoff as step 1 — consume + hide chrome + re-emit
  native click.
- **Page-route gate**: Both Dashboard and Settings stay mounted via `App.tsx`'s
  visibility toggle. The advance check requires
  `window.location.pathname === '/settings'` **and** all three Settings
  selectors to resolve, otherwise the highlight could land on the hidden
  Settings DOM while Dashboard is still visible.
- **Timeout**: If the Settings DOM never appears within ~6s after the click
  (e.g. the user backed out), the tour jumps to completion.
- **Clickthrough guard**: Reuses `tour-step-tab-clickthrough` so the same
  pointer-passthrough rule covers both `[data-tour='menu-toggle']` and
  `[data-tour='settings-tab']`.

### Step 3: "Color mode"

- **Target**: `[data-tour="settings-color-mode"]` (the `<IonItem>` row wrapping
  the color mode `<select>`).
- **Popover**: Bottom-center. Descriptive text with a Next button.
- **Interaction**: User taps Next; no gesture detection on the row itself.

### Step 4: "Show landmarks"

- **Target**: `[data-tour="settings-show-landmarks"]` (the `<IonItem>` row
  wrapping the landmark toggle).
- **Popover**: Bottom-center. Descriptive text with a Next button.
- **Interaction**: User taps Next.

### Step 5: "Map unit"

- **Target**: `[data-tour="settings-measurement-unit"]` (the `<IonItem>` row
  wrapping the unit `<select>`).
- **Popover**: Bottom-center. Descriptive text with a Next button.
- **Interaction**: User taps Next.

### Step 6: "Tour complete"

- **Target**: none (centered popover).
- **Popover**: Confirms tutorial completion.
- **Interaction**: User taps `Finish`.
- **Completion side effect**: Sets `hasCompletedGuidedTour = true`.

### Completion

- `hasCompletedGuidedTour` is set to `true` in preferences when Step 6 `Finish`
  is pressed or when the user manually closes the tour during steps 1-5.

### Separation from app code

The tour module is deliberately decoupled from the React component tree. The
objective is to keep the onboarding tutorial code as clearly and sharply
separated as possible to minimize the likelihood of bugs.

## CSS theming

The tour popover is styled to match the app's dark slate/purple theme in
`src/onboarding/guidedTour/tourStyles.css`:

- Background: `#1e293b` (slate-800)
- Border: `2px solid rgba(248, 250, 252, 0.78)` (high-contrast near-white
  outline)
- Text: `#f1f5f9` titles, `#cbd5e1` descriptions
- Buttons: Purple primary (`#a855f7`), bright slate secondary (`#e2e8f0`)
- Pointer arrow: Side-specific triangle borders (driver.js native shape) with
  increased size and light drop shadow for clear target direction
- Shadow: Dark elevation plus subtle light ring for readability over the overlay

## Edge cases

- **No projects**: Irrelevant — the tour no longer points at any project row.
  Steps 3-5 only target Settings.
- **Settings DOM missing**: Step 2 jumps to completion if the three Settings
  selectors never resolve (e.g. the user navigated away).
- **User closes tour early**: Allowed from steps 1-5 and treated as completion
  for persistence.
- **Tour re-trigger**: Settings "Show Tutorial" button ignores
  `hasCompletedGuidedTour` and starts the tutorial from step 1.
- **Offline mode**: Tour works identically offline (pure DOM/UI, no network
  dependency).
- **App backgrounded during tour**: do nothing.

## Source code

- Step definitions: `src/onboarding/guidedTour/steps.ts`
- Tour engine: `src/onboarding/guidedTour/engine.ts`
- Selectors and `hasSettingsTourTargets()`:
  `src/onboarding/guidedTour/selectors.ts`
- Tour CSS: `src/onboarding/guidedTour/tourStyles.css`
- Tour selector hosts:
  - `[data-tour="menu-toggle"]`, `[data-tour="settings-tab"]` --
    `src/components/AppTabBar.tsx`
  - `[data-tour="settings-color-mode"]`,
    `[data-tour="settings-show-landmarks"]`,
    `[data-tour="settings-measurement-unit"]` -- `src/pages/Settings.tsx`
  - `[data-tour="project-panel"]`, `data-tour-open` --
    `src/components/ProjectPanel.tsx`
- Tour re-trigger: `src/pages/Settings.tsx` ("Show Tutorial" button)

## Change checklist

When modifying the guided tour:

1. Verify step definitions in `steps.ts` match this document.
2. Verify the two gesture-driven steps (open-panel, go-to-Settings) correctly
   detect taps and advance.
3. Verify the tour auto-starts after onboarding modal dismissal on first login.
4. Verify the tour does not auto-start on subsequent logins (persistence check).
5. Verify the Settings "Show Tutorial" button re-triggers the tour.
6. Verify manual close on steps 1-5 marks tour as completed and suppresses
   future auto-start.
7. Run `npx vitest run src/onboarding/` for tour-specific tests.
8. Update this document if step flow, architecture, or persistence behavior
   changes.
