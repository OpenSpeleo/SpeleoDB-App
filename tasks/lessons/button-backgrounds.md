# Lesson: Buttons rendered as bare text (no background)

## Symptom (reported more than once)

A button — most recently the "Cancel" button in the Create Landmark modal —
showed up as plain text with no visible background/fill. The primary button next
to it (solid fill) looked fine.

## Root cause

The broken buttons used an **opacity-modified Tailwind background utility** as
their fill, e.g. `bg-slate-800/70`:

- In Tailwind v4 `bg-slate-800/70` compiles to
  `background-color: color-mix(in oklab, var(--color-slate-800) 70%, transparent)`.
  `color-mix()` / `oklab` is not supported on older Android System WebViews, so
  the declaration is dropped and the button has NO background.
- Even where it renders, a 70%-opacity dark slate on a dark modal is nearly
  invisible, reading as plain text.
- Tailwind background utilities also live in `@layer utilities`; unlayered
  author rules (`.app-btn`) and preflight can win the cascade.

## Fix / prevention

- Added SOLID, UNLAYERED button variant classes in `src/index.css`:
  `app-btn--primary | secondary | danger | info | success`, each setting
  `background-color: var(--color-*)` (Tailwind tokens) with hover + a shared
  `.app-btn:disabled`.
- Migrated ALL `.app-btn` buttons to `app-btn app-btn--<variant>`; removed every
  `bg-*` utility (including opacity-modified ones) from `.app-btn` elements.
- Codified a hard rule: `.cursor/rules/ui-buttons.mdc` (always applied) and
  `docs/coding-rules.md`.

## Guardrail to run every time

`app-btn[^"]*bg-` must return NO matches in `src/**/*.tsx`. Every `.app-btn`
must carry an `app-btn--*` variant. Never use `bg-<color>/<NN>` as a button
fill.
