# Authentication

This document defines how the app creates and restores SpeleoDB sessions.

## Design intent

- Support both normal email/password login and direct OAuth-token login.
- Validate every user-supplied OAuth token before storing or using it.
- Keep authentication state transitions in `SpeleoDBController`; the login page
  only collects credentials and presents controller results.
- Preserve the existing offline email/password fallback without allowing an
  unverified token to become an offline session.
- Never log, display, or include token values in error messages.

## Login methods

The login page exposes two keyboard-accessible tabs that share the selected
SpeleoDB instance.

### Email and password

`SpeleoDBController.login()` sends the credentials to
`POST /api/v2/user/auth-token/`. A successful response supplies both the token
and the email used for the in-memory `User` identity. Password-manager autofill,
forgot-password links, and the local offline-login fallback belong exclusively
to this flow.

If the server cannot be reached, the controller may authenticate against the
existing local users database. This is the only login method with an offline
fallback.

### OAuth token

`SpeleoDBController.loginWithToken()` trims the token and instance, then calls
the existing `SpeleoDBService.validateToken()` path:

```http
GET /api/v2/user/auth-token/
Authorization: Token <token>
```

Any `2xx` response validates the token; the response body is opaque and may be
empty. Because validation does not return identity data, the authenticated
state deliberately uses `user: null`. Code must not invent an email address or
derive identity from the token.

Token login requires a live server response:

- `2xx`: create and persist the session.
- `4xx`: remain on the login page and show the server message, falling back to
  `Invalid OAuth token`.
- timeout, transport error, or non-`4xx` server failure: remain on the login
  page, show a validation/connectivity error, and do not enter offline mode.

An unvalidated token is never persisted. The token input is masked, disables
browser autofill and autocapitalization, and preserves its value only in React
form state while the login screen remains mounted.

## Session persistence and restoration

Successful online login from either method uses one controller session-setup
path. It marks the app authenticated and online, stores the normalized instance
and token, and notifies controller subscribers.

Email/password login also stores the authenticated email. Token login stores an
empty email so stale identity cannot leak from a previous session. On restart,
a valid token/instance pair restores authentication; an empty email restores
`user: null`, while a stored email reconstructs the existing lightweight user
identity. Startup then validates the stored token using the rules in
`docs/networking.md`.

Logout and invalid stored-session handling remain destructive operations as
defined in `docs/logout-behavior.md`. A failed pre-login token attempt does not
call logout or purge caches because it never created a session.

## Architecture and performance

- `src/pages/Login.tsx` owns tab selection and form presentation only.
- `SpeleoDBController` owns validation outcomes, session state, and persistence.
- `SpeleoDBService.validateToken()` owns the API request and authorization
  header; there is no separate token-login transport path.

Token login adds one validation request and no background work, polling, cache
scan, or additional storage layer. Reusing the existing endpoint keeps native
and web behavior identical.

## Verification strategy

- Controller unit tests cover validation, trimming, persistence, identity-free
  restoration, and every response class.
- Login component tests cover tab semantics and keyboard navigation, masked
  token entry, shared instance submission, feedback, redirects, and solid
  button variants.
- The opt-in controller integration suite validates a configured real OAuth
  token through the full controller/service/HTTP stack.
