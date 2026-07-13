# SpeleoDB web and PWA metadata

## Intent

The built web shell must identify itself as SpeleoDB and every install, favicon,
and Apple home-screen asset it advertises must be present with truthful MIME and
dimension metadata. Native app icons remain owned by the Android/iOS resource
sets; this contract covers the Vite web artifact embedded by Capacitor and any
browser/PWA use.

## Ownership and design

- `index.html` owns the document title, Apple home-screen title, theme color,
  manifest link, favicon, and Apple touch icon references.
- `public/manifest.json` owns install name, app id/scope/start URL, colors, and
  the 192px/512px install icon declarations.
- `resources/icon.png` is the reviewed SpeleoDB source artwork. The checked-in
  `public/icons/*.png` files are exact-size generated renditions: 180px for
  Apple touch, plus 192px and 512px for HTML/manifest use.

The artwork has an opaque `#0f182a` background. Icons declare purpose `any`;
they do not claim maskable safe-area compliance. All declared assets are PNGs
whose encoded dimensions match their HTML/manifest `sizes` values. Static icon
payload is approximately 97 KiB total and is loaded only by browser/install
surfaces, not by application JavaScript.

## Verification

`quality/pwa-metadata.test.ts` performs an isolated production Vite build,
parses the emitted HTML and manifest, resolves every local `link[href]` and
`script[src]`, validates SpeleoDB titles/colors, checks PNG signatures, and
compares encoded icon dimensions with declared sizes. The in-process build
disables only bundle-budget enforcement because Vitest instrumentation inflates
its chunks; the normal standalone `npm run build` remains the authoritative
bundle-budget gate.

For manual response verification, serve `dist/` and confirm `/manifest.json`,
`/icons/icon-192.png`, `/icons/icon-512.png`, and
`/icons/apple-touch-icon-180.png` return successfully with JSON/PNG content
types. Capacitor sync must still be inspected separately because native icon
resources are reviewable generated output.
