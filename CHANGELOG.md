# Changelog

Highlights from SpeleoDB’s mobile app releases.

## Unreleased

## v1.6.0 - 2026-09-18

### Features

- Select and manage offline map areas to prepare for trips. `f9a0e47`
- View saved lines and shapes from SpeleoDB in the new Geometries tab, online or
  offline. `51e20c6`
- Show an on-map compass with your heading and direction. `65d4b55`

### UI/UX

- Keep sign-in controls reachable on smaller screens and enlarged displays, with
  direct access to get an OAuth token. `252a642`

### Fixes

- Keep offline map downloads moving when some map data is unavailable. `c20cb42`

## v1.5.0 - 2026-08-26

### Fixes

- Show newly saved GPS landmarks on the map before they sync. `a0da333`
- Prevent accidental map zoom from repeated taps. `2e76ad4`
- Remove unwanted shake-to-undo prompts on iOS. `e61e56f`

## v1.4.0 - 2026-07-13

### Features

- Record GPS tracks, including in the background, and export or share them as
  GPX files. `59d986c`
- Browse, display, and manage GPS tracks, with offline changes synced after
  reconnecting. `c36d896`
- Capture more precise landmark locations by averaging GPS readings. `59d986c`
- Follow your live location and see which direction your phone is pointing.
  `40e7967`
- Sign in with an OAuth token as an alternative to a password. `8478d1e`

### UI/UX

- Keep the screen awake while using the app in the field. `40e7967`
- Warn before signing out would discard unsynced changes. `02cb25c`

### Fixes

- Protect saved sign-in credentials with secure device storage. `e0551b8`
- Preserve your session and offline data when the server cannot confirm your
  connection. `4a4fb9c`
- Make offline map preparation and download progress more reliable. `6406c34`

### Performance

- Keep the app responsive during synchronization while offline maps prepare in
  the background. `1a8e3ef`

## v1.3.0 - 2026-06-20

### Features

- Browse landmarks by collection and control which collections appear on the
  map. `cbfac75`
- Create, edit, and delete landmarks offline, then review and sync pending
  changes when reconnected. `bbccb3f`
- Switch between satellite and terrain maps, with offline downloads for your
  chosen layers. `c1b4830`
- Reconnect from Settings without restarting the app. `5db3137`
- Allow additional storage for larger offline map downloads. `cbfac75`

### UI/UX

- Browse projects by country, with project colors matching SpeleoDB on the web.
  `06a8285`
- See when your projects last synced. `06a8285`

## v1.2.1 - 2026-02-28

### Features

- Open the app directly from supported SpeleoDB links. `a1ea94a`

### Fixes

- Open website links reliably in the browser on Android. `5233971`

## v1.2.0 - 2026-02-23

### Features

- Explore surveys colored by depth, with a depth gauge that updates for visible
  projects. `2a1cade`
- View a map distance scale and choose metric or imperial units. `0d77905`

### Fixes

- Prevent duplicate sign-in requests. `da6bf32`

## v1.1.0 - 2026-02-21

### UI/UX

- Introduce a redesigned mobile interface with bottom navigation, refreshed map
  controls, and a dedicated Settings page. `b010c44`

## v1.0.1 - 2026-02-18

### Features

- Learn the map controls with an interactive guided tour. `d5353b4`
- Tap map markers for details or long-press the map to view coordinates.
  `d5d98db`

### UI/UX

- Make map markers easier to see and add a landmark visibility toggle. `68460fa`

### Fixes

- Reveal the selected project on the map when opening it from the project list.
  `07ec8c1`
- Keep regular SpeleoDB website links in the browser. `c53cb85`
