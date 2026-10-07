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

See [AGENTS.md](../AGENTS.md) for the complete agent button rules and examples.

## Styling tokens (Tailwind v4)

- Tie design tokens to Tailwind via CSS variables (`var(--color-slate-700)`)
  rather than copying literal hex values, unless the value is intentionally
  outside the theme or documented as a product-specific token.
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

Before extracting children of any third-party container, inspect its immediate-
child contract for injected props, context, order, refs, and lifecycle. Model
that behavior in test doubles and demonstrate a failing-before/passing-after
integration regression; unchanged-child mocks cannot prove this refactor safe.

## Interaction and layout ownership

Adding row click or keyboard behavior preserves dimensions, spacing, and visual
hierarchy unless a presentation change is requested. Do not apply shared action
button styling to row interaction targets when its padding, border, or fill
changes that layout. Browser verification must establish the actual hit area and
rendered dimensions; keyboard tests alone cannot prove whole-row pointer
coverage. Keep adjacent actions independently reachable.

Map controls share one positioned container and normal flow with common button
geometry. Verify rendered bounds and popup hit targets with nonzero safe areas,
short screens, both sides of responsive boundaries, and after hide/show or
editor exit. Cancel/Save must be reachable without test-only scrolling. Reserve
measured overlay rows/columns, keep layout ownership alive when optional
controls hide, refresh observed nodes after mode changes, and coalesce resize
writes outside observer delivery with cleanup cancellation. See
[map compass](map-compass.md).

Programmatic `scrollTop` changes precede scroll-event delivery: establish the
rendered indicator's starting position after a reset before measuring movement.
Map selections preserve geographic bounds during layout changes; synchronize
MapLibre size before projection, distinguish resize-generated movement from user
gestures, and verify both resize callback orders plus Edit → Save against real
persisted coordinates. See [offline areas](offline-download-areas.md).
