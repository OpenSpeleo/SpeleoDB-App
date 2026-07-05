# Onboarding Modal

This document defines the design intent, UX requirements, and layout behavior
for the companion onboarding modal shown after first login.

## Purpose

The onboarding modal is a one-time welcome screen shown immediately after the
user logs in and lands on the dashboard. It introduces the companion app's core
value: syncing SpeleoDB surveys for offline fieldwork use.

## When it appears

- Shown once per login session, immediately after the user transitions from
  unauthenticated to authenticated.
- Triggered when the user first lands on `/dashboard` after login.
- The modal cannot be dismissed via backdrop tap or swipe -- only via the
  explicit "Start exploring" CTA button.
- On logout, the companion info state resets so the modal appears again on next
  login.

## Content structure

The modal presents four content blocks in order:

1. **Brand hero**: SpeleoDB logo and headline ("Your surveys, always with you").
2. **Tagline**: "The SpeleoDB app is built for fieldwork. Online or Offline."
3. **Feature highlights**: Three cards -- survey sync, Settings sync action,
   offline access.
4. **Promotional callout**: Survey-publish-sync workflow and field visualization
   pitch.
5. **CTA**: "Start exploring" button that dismisses the modal.

## Layout behavior

The modal uses two distinct responsive layouts to look good on all form factors.

### Phone (< 768px / below `md` breakpoint)

- Fullscreen modal with dark atmospheric background (purple/indigo gradient
  blobs).
- Content is rendered inside a centered, rounded card (`max-w-md`, rounded-3xl,
  border, backdrop blur).
- Single column, vertically centered.
- Typography is compact (`text-2xl` heading, `text-sm` body).
- Feature cards use `text-sm` font and tight padding.
- Content scrolls vertically if the viewport is too short.

### Tablet (>= 768px / `md` breakpoint and above)

- Fullscreen modal (forced via CSS override on `ion-modal.onboarding-modal` to
  bypass Ionic's default card-style presentation on iPads).
- **Two-column side-by-side layout** that fills the entire screen:
  - **Left pane (2/5 width)**: Branded hero area. Logo, headline, and tagline
    centered vertically against a gradient background with large atmospheric
    blobs. Separated from the right pane by a subtle border.
  - **Right pane (3/5 width)**: Feature highlights, promotional callout, and CTA
    button. Content capped at `max-w-lg` and centered vertically within the
    pane.
- Typography scales up (`text-3xl`/`text-4xl` heading, `text-base` body).
- Feature cards have more generous padding (`px-4 py-3`).
- Uses "device" instead of "phone" in copy to match the tablet context.

### Why two layout trees

The phone and tablet layouts use genuinely different structural hierarchies
(centered card vs. full-bleed split panes). A single DOM tree with responsive
utilities would require awkward workarounds. The `md:hidden` / `hidden md:flex`
pattern keeps each layout clean and independently maintainable. The content
strings are nearly identical, differing only in "phone" vs. "device" wording.

## CSS requirements

The `onboarding-modal` class on the `IonModal` element must have these CSS
overrides in `src/theme/variables.css`:

```css
ion-modal.onboarding-modal {
  --width: 100%;
  --height: 100%;
  --max-width: 100%;
  --max-height: 100%;
  --border-radius: 0;
}
```

Without this, iPads default to a floating card-style modal, leaving the content
small and poorly centered.

## Tailwind breakpoints used

Standard Tailwind defaults (no custom config):

| Token     | Min width | Target                            |
| --------- | --------- | --------------------------------- |
| (default) | 0px       | Phones (portrait & landscape)     |
| `md`      | 768px     | Tablets (portrait), small laptops |
| `lg`      | 1024px    | Tablets (landscape), desktops     |

## Design tokens and theme

- Background: `slate-900` base, purple/indigo gradient blobs for atmosphere.
- Card border: `slate-700/80` (phone), `slate-700/30` pane divider (tablet).
- Feature cards: `slate-800/50` fill, `slate-700/70` border.
- Promo callout: `purple-500/10` fill, `purple-500/30` border.
- Text: `slate-100` headings, `slate-300` body, `slate-200` emphasis.
- CTA: Ionic primary button (`--ion-color-primary: #a855f7`).
- Gradient blobs use `blur-3xl` for soft atmospheric effect.

## Dismissal behavior

- `backdropDismiss={false}` -- user must tap the CTA.
- `canDismiss` is gated by startup UI coordinator state
  (`allowCompanionInfoModalDismiss`). The CTA sets this to `true` and closes the
  modal in the same handler.
- State is managed in `useStartupUiCoordinator` and rendered by
  `SpeleoDBProvider`, consistent with the architecture guidelines.

## State ownership

- Modal visibility state lives in `src/context/useStartupUiCoordinator.ts`
  (reducer-backed UI state).
- The open/close trigger depends on `authState.isAuthenticated` transitioning
  from `false` to `true` and the route being `/dashboard`.
- This is presentation-only state and does not belong in the controller.

## Source code

- Modal JSX: `src/context/SpeleoDBProvider.tsx`
- Startup UI coordinator state: `src/context/useStartupUiCoordinator.ts`
- Modal CSS override: `src/theme/variables.css` (`ion-modal.onboarding-modal`)
- Logo asset: `src/assets/media/logo.png`

## Change checklist

When modifying the onboarding modal:

1. Verify the phone layout still looks correct on small screens (375px width).
2. Verify the tablet layout fills the screen on iPad landscape (1024px+ width).
3. Verify the modal cannot be dismissed except via the CTA button.
4. Verify the modal only appears once per login (not on page navigation or app
   resume).
5. Keep the `onboarding-modal` CSS class and its overrides in sync.
6. Update this document if layout structure, breakpoints, or dismissal behavior
   changes.
