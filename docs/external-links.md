# External Links

How the app opens URLs in an external browser from within the Capacitor WebView.

## Problem

Capacitor wraps the app in a native WebView. Standard HTML `<a target="_blank">`
links behave differently across platforms:

- **iOS (WKWebView)**: `target="_blank"` opens the URL in Safari. Works.
- **Android (WebView)**: `target="_blank"` is not handled reliably. The WebView
  either navigates in-place or silently ignores the click.

The Capacitor config compounds this on Android: `hostname: "www.speleodb.org"` +
`androidScheme: "https"` makes the WebView consider itself at
`https://www.speleodb.org`. Links to the same host are treated as internal
navigation rather than external browser launches.

## Solution

The app uses `@capacitor/browser` (`Browser.open()`) to open external URLs. This
plugin provides consistent cross-platform behavior:

| Platform | Behavior               |
| -------- | ---------------------- |
| Android  | Chrome Custom Tabs     |
| iOS      | SFSafariViewController |
| Web      | `window.open`          |

`openExternalUrl()` rejects non-HTTP schemes, embedded URL credentials, and
remote cleartext HTTP before invoking the plugin. Development HTTP is allowed
only for loopback. Callers must not bypass this validation or log the target URL
because account/deep-link URLs may contain private signed parameters.

## API

```typescript
import { openExternalUrl } from "../utils/url";

await openExternalUrl("https://example.com");
```

`openExternalUrl` is the only sanctioned way to open external URLs. Do not use
`<a target="_blank">` or `window.open()` directly.

## Usage in components

Keep the `<a>` tag for accessibility (right-click copy, hover preview), but
intercept the click:

```tsx
<a
  href={url}
  onClick={(e) => {
    e.preventDefault();
    openExternalUrl(url);
  }}
>
  Link text
</a>
```

## Current external links

| Page  | Link    | URL pattern                          |
| ----- | ------- | ------------------------------------ |
| Login | Forgot? | `{instance}/account/password/reset/` |
| Login | Sign up | `{instance}/signup/`                 |

## Rules

1. **Never** use `target="_blank"` on anchor tags. It silently fails on Android.
2. **Always** use `openExternalUrl()` from `src/utils/url.ts` for any URL that
   should leave the WebView.
3. When adding a new external link, add a test that verifies `Browser.open()` is
   called with the correct URL.
4. Update the table above when adding new external links.

## Source code

- Utility: `src/utils/url.ts` (`openExternalUrl`)
- Plugin: `@capacitor/browser` (dependency in `package.json`)

## Tests

- `src/utils/url.test.ts`: unit tests for `openExternalUrl` delegation to
  `Browser.open`.
- `src/pages/Login.test.tsx`: verifies both login-page links call `Browser.open`
  with correct URLs and do not use `target="_blank"`.
