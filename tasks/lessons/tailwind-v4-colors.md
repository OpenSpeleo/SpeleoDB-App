# Tailwind v4 Color Corrections

- When replacing Tailwind `@apply` during a v4 migration, keep design tokens tied
  to Tailwind by using CSS variables such as `var(--color-slate-800)` instead of
  copying literal hex values.
- Use literal colors only when the value is intentionally outside the Tailwind
  theme or is documented as a product-specific token.
