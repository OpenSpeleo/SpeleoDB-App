# Display scaling and scroll ownership

## Intent and platform boundary

Every route must remain usable when the device offers less layout space. iOS
Display Zoom and Android Display size affect the logical viewport available to
the entire app. They are separate from browser page zoom and system font size.
The existing viewport metadata and Capacitor's default disabled page zoom do not
opt the app out of OS display scaling. There is no shared supported switch that
guarantees identical physical sizing across both native platforms.

SpeleoDB therefore lays out against the available viewport and gives overflowing
forms and lists a scroll owner. It does not infer a scale from screen density,
apply an inverse transform, or change the user's font preferences. Such scale
compensation would also affect touch targets, safe areas, keyboard geometry, and
the map's coordinate system. OS accessibility magnification remains system
owned.

- [Apple display and text settings](https://support.apple.com/en-ca/guide/iphone/iphd6804774e/ios)
- [Android screen compatibility](https://developer.android.com/guide/practices/screen-compat-mode)

## Login ownership and root cause

Ionic's global `structure.css` fixes `body` to the viewport with hidden
overflow. Login is intentionally outside the lazy authenticated Ionic shell.
Previously, it used `min-h-screen` without any scroll container, so content
taller than the viewport was clipped and Sign In could become unreachable.
Display scaling, short screens, larger text, and the keyboard can all expose
this layout defect; the original user's exact device configuration has not been
reproduced.

`Login.tsx` and `.login-page` in `src/index.css` now own a fixed, inset-zero
vertical scroll container. A minimum-height child centers short content but
grows with taller content. This keeps the top at a reachable scroll origin
instead of centering oversized content inside a fixed-height flex container. Top
and bottom padding include safe-area insets; the scroller also respects
left/right insets. The decorative illustration cannot introduce horizontal
scrolling.

No global body scrolling is enabled: the authenticated map and Ionic overlays
need their existing viewport boundaries. No resize listener, bridge plugin,
polling, or per-render scale calculation is needed; CSS owns the layout.

## Other app surfaces

The source audit found existing scroll ownership in the remaining primary
routes:

| Surface                            | Scroll owner                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| Settings and Pending               | `IonContent` inside viewport-bound `IonPage`                         |
| Dashboard map                      | Intentionally non-scrolling `IonContent`; MapLibre owns map gestures |
| Projects, landmarks, and GPS lists | Bounded flex panels with `min-h-0` and `overflow-y-auto`             |
| GPS recording and averaging        | Viewport-bound overlays with scrollable flex bodies                  |
| Form/detail/confirmation modals    | Ionic modal content scroll containers                                |

This audit establishes ownership, not proof that every possible device/font
combination fits every overlay. New full-screen forms must provide bounded
scrolling rather than rely on document scrolling under Ionic.

## Verification

`tests/browser/login-layout.spec.ts` renders the built app in WebKit and
Chromium. It covers both login methods at normal portrait, small portrait,
landscape, keyboard-sized viewport, and enlarged-root-font dimensions. It
asserts a real user-scrollable ancestor, full submit/footer visibility after
scrolling, no horizontal overflow, native form validation from a pointer tap on
Sign In, and the logo's reachability after scrolling back to the top. Unexpected
browser warnings/errors fail the tests. No credentials or login requests are
required.

Run `npx playwright install chromium webkit`, `npm run build`, then
`npm run test:browser`. CI installs the browsers and runs this suite against the
production build with no retries. Existing Login component tests continue to own
authentication submission and state behavior. Storage/network/concurrency
integration behavior is unchanged.

Browser viewport and font changes model layout constraints; they do not emulate
the OS setting or native keyboard. Before release, on a physical iPhone and
Android device, record model/OS/build and verify default and largest Display
Zoom/Display size settings, both orientations, opening/dismissing the keyboard,
both login methods, scrolling to Sign In and back to the logo, then Settings,
Pending, map gestures, side panels, and save/cancel actions in forms. Record
larger text separately from display scaling.
