# Coding Rules (Hard Rules)

These are **hard rules**. Violations must be fixed before merging. Referenced by
`AGENTS.md`.

## UI: Buttons must have a visible, solid background

A button that renders as bare text (no visible background) is a defect.

- Every `.app-btn` MUST also carry one color variant class defined unlayered in
  `src/index.css`: `app-btn--primary`, `app-btn--secondary`, `app-btn--danger`,
  `app-btn--info`, or `app-btn--success`. These set a SOLID `background-color`
  from Tailwind theme tokens (`var(--color-*)`).
- NEVER use an opacity-modified background utility (`bg-<color>-<n>/<NN>`, e.g.
  `bg-slate-800/70`) as a button fill. In Tailwind v4 these compile to
  `color-mix(in oklab, …)` and render invisibly on older Android WebViews, and
  layered utilities can lose the cascade to unlayered rules + preflight.
- Disabled styling is centralized in `.app-btn:disabled`; do not re-add
  `disabled:opacity-*`.
- Ionic `IonButton` is exempt (Ionic provides a solid theme background).

Self-check before finishing a button change: `app-btn[^"]*bg-` must return NO
matches in `src/**/*.tsx`.

See the always-applied rule `.cursor/rules/ui-buttons.mdc` and the post-mortem
in `tasks/lessons/button-backgrounds.md`.

## Styling tokens (Tailwind v4)

- Tie design tokens to Tailwind via CSS variables (`var(--color-slate-700)`)
  rather than copying literal hex values, unless the value is intentionally
  outside the theme. See `tasks/lessons/tailwind-v4-colors.md`.
- App chrome that must beat Tailwind preflight (button shape, radius) lives
  UNLAYERED in `src/index.css` (e.g. `.app-btn`).

## MapLibre source ownership

- Every `react-map-gl` `<Layer>` MUST be a direct child of its owning
  `<Source>`.
- A wrapper between `Source` and `Layer` is allowed only when it explicitly
  forwards the injected `source` prop and has a contract test that models
  `Source` using `Children.map` and `cloneElement`.
- A test mock that merely renders `Source.children` is not evidence that a layer
  is bound to a MapLibre source.

See `tasks/lessons/maplibre-source-children.md`.
