# Deep Linking

This document covers how external links open the SpeleoDB app on mobile devices
and what happens when the app is not installed.

## Two mechanisms

### Custom URL scheme (`speleodb://`)

The app registers the `speleodb` scheme so that `speleodb://` URIs are routed to
the app by the OS. This is useful for app-to-app communication but has a key
limitation: if the app is not installed the link fails silently (iOS) or shows
an error (Android). It cannot redirect to the store.

### Universal Links (iOS) / App Links (Android)

The app claims `https://www.speleodb.org/app` paths via platform-specific
association files served from the web server. When the app is installed the OS
opens it directly. When it is not installed the browser loads a fallback page
that detects the platform and redirects to the appropriate store listing. This
is the recommended mechanism for any links shared publicly (emails, QR codes,
websites).

## Comparison

|                       | `speleodb://...`                         | `https://www.speleodb.org/app/...`                              |
| --------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| **Mechanism**         | Custom URL scheme                        | Universal Link (iOS) / App Link (Android)                       |
| **Verified?**         | No — any app can claim it                | Yes — tied to `.well-known/` files on the domain                |
| **App not installed** | Fails silently (iOS) or errors (Android) | Browser loads the fallback page, redirects to store             |
| **Works in browser**  | No                                       | Yes                                                             |
| **Path mapping**      | `speleodb://anything` — free-form        | Must match paths declared in AASA / manifest (`/app`, `/app/*`) |

Both fire the same Capacitor `appUrlOpen` event, so in-app handling is unified.
For now the app simply opens to its default state. No in-app destination routing
is performed.

## Native configuration

### iOS

- **Info.plist** (`ios/App/App/Info.plist`): `CFBundleURLTypes` registers the
  `speleodb` custom scheme. `UIApplicationSceneManifest` opts the app into the
  UIScene lifecycle (see below).
- **App.entitlements** (`ios/App/App/App.entitlements`):
  `applinks:www.speleodb.org` in Associated Domains enables Universal Links. The
  existing `webcredentials:` entry is preserved.
- **SceneDelegate.swift** (`ios/App/App/SceneDelegate.swift`): Routes URL opens
  to Capacitor. Once the app adopts the UIScene lifecycle, UIKit stops calling
  `application(_:open:options:)` / `application(_:continue:restorationHandler:)`
  on the `UIApplicationDelegate`, so the equivalents live here instead:
  - `scene(_:willConnectTo:options:)` handles cold-start launches (custom scheme
    via `connectionOptions.urlContexts`, Universal Links via
    `connectionOptions.userActivities`).
  - `scene(_:openURLContexts:)` handles `speleodb://` opens while
    running/suspended.
  - `scene(_:continue:)` handles Universal Links while running/suspended. Each
    forwards to `ApplicationDelegateProxy.shared.application(_:open:)`, which
    fires the same Capacitor `appUrlOpen` event.

### Why the UIScene lifecycle

Apple requires apps built against the iOS 27 SDK to adopt the scene-based
lifecycle; legacy AppDelegate-only apps fail to launch (the
`UIScene lifecycle will soon be required` console warning precedes this).
Adoption is two parts: the `UIApplicationSceneManifest` in `Info.plist` (points
UIKit at `$(PRODUCT_MODULE_NAME).SceneDelegate` and the `Main` storyboard) and
`SceneDelegate.swift`, which now owns the `UIWindow` and the URL-handling
responsibilities formerly in `AppDelegate.swift`.

### Android

- **AndroidManifest.xml** (`android/app/src/main/AndroidManifest.xml`): Two
  intent filters on `MainActivity`:
  1. `speleodb` custom scheme.
  2. `https://www.speleodb.org/app` with `autoVerify="true"` for App Links.

## In-app listener

`src/App.tsx` registers a Capacitor `App.addListener('appUrlOpen', ...)`
handler. Both `speleodb://` and `https://www.speleodb.org/app/...` URLs arrive
through this single callback. The listener writes only the fixed event label
`[DeepLink] URL received.` and never writes the URL value or its query
parameters because signed paths, reset tokens, and user data may be present. No
destination routing is currently performed. Add validated URL parsing and router
navigation when destination routing is implemented, while preserving the
diagnostic privacy contract.

## Server-side `.well-known/` files

Both files are deployed on `www.speleodb.org` and must meet these requirements:

- Served over HTTPS.
- Return HTTP 200 (no 3xx redirects).
- `Content-Type: application/json`.
- `apple-app-site-association` URL must NOT have a `.json` extension.

### `/.well-known/apple-app-site-association`

Served at `https://www.speleodb.org/.well-known/apple-app-site-association`.
Required for iOS Universal Links.

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["UDUF7J66TN.org.speleodb.app"],
        "components": [
          { "/": "/app", "comment": "Open app landing" },
          { "/": "/app/*", "comment": "Future deep link paths" }
        ]
      }
    ]
  },
  "webcredentials": {
    "apps": ["UDUF7J66TN.org.speleodb.app"]
  }
}
```

### `/.well-known/assetlinks.json`

Served at `https://www.speleodb.org/.well-known/assetlinks.json`. Required for
Android App Links and credential autofill.

```json
[
  {
    "relation": [
      "delegate_permission/common.get_login_creds",
      "delegate_permission/common.handle_all_urls"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "org.speleodb.app",
      "sha256_cert_fingerprints": [
        "ED:5B:2F:D2:A5:F4:C3:FE:95:51:5C:B0:70:2E:1E:18:69:C5:76:C7:59:EE:31:CE:60:5C:2D:B0:1E:BC:D0:70"
      ]
    }
  }
]
```

### `/app` fallback page

When the app is not installed (or on desktop), the browser loads
`https://www.speleodb.org/app` instead. This page should detect the platform via
User-Agent and redirect mobile visitors to the appropriate store listing.
Desktop visitors see a landing page with store badges.

## Extending with destination routing

To deep-link to specific in-app content in the future:

1. Define new URL patterns (e.g., `speleodb://project/<id>`,
   `https://www.speleodb.org/app/project/<id>`).
2. Parse the incoming URL inside the `appUrlOpen` listener in `src/App.tsx`.
3. Use the Ionic router history object to navigate to the target page.
4. Update the AASA `components` array and the Android manifest
   `pathPrefix`/`pathPattern` if the paths change.
5. Update this document.
