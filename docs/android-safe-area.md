# Android Safe Area Insets

## Problem

CSS `env(safe-area-inset-bottom)` always returns `0px` in Android's WebView.
Capacitor 8's built-in `SystemBars` plugin works around this by injecting
`--safe-area-inset-*` as inline CSS custom properties on `<html>`, but only on
Android 15+ (API 35). On older Android versions (10--14), the WebView can extend
behind the system navigation bar (especially with gesture navigation), and there
is no native mechanism to report the inset.

## Solution

`initAndroidSafeArea()` in `src/main.tsx` sets `--safe-area-inset-bottom: 40px`
on the document root **synchronously before React renders**. This ensures the
tab bar, and any other element using `var(--safe-area-inset-bottom, ...)`, never
sits flush against the navigation buttons.

- **Android 15+**: The `40px` default is applied first. Capacitor's `SystemBars`
  plugin then overwrites it with the accurate device-specific value after its
  `DOMContentLoaded` callback chain completes.
- **Android 10--14**: The `40px` value remains in effect. It provides a
  comfortable buffer above the system navigation bar for both gesture navigation
  (~20dp indicator) and 3-button navigation (~48dp bar).
- **iOS / Web**: `initAndroidSafeArea()` exits immediately. The CSS
  `env(safe-area-inset-bottom)` fallback in
  `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))` is used instead,
  which Safari and desktop browsers populate natively.

## Where the CSS variable is consumed

All safe area references use the pattern
`var(--safe-area-inset-bottom, env(safe-area-inset-bottom))`:

- `src/components/AppTabBar.tsx` -- tab bar bottom padding
- `src/components/ProjectPanel.tsx` -- panel top padding
- `src/pages/dashboard/DashboardMapCanvas.tsx` -- My Location button top offset
- `src/pages/Login.tsx` -- login form top padding

## Source files

- Safe area init: `src/main.tsx` (`initAndroidSafeArea`)
- Capacitor SystemBars plugin:
  `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java`
