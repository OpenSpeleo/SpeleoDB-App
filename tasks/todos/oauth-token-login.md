# OAuth Token Login

Add a second login method that validates a user-supplied OAuth token against the
selected SpeleoDB instance before creating a persisted app session.

## Plan checklist

- [x] Add the token-login controller contract and centralize auth session setup.
- [x] Cover token validation, persistence, failures, and identity restoration.
- [x] Add accessible Email & Password / OAuth Token tabs to the login page.
- [x] Cover tab behavior, token submission, feedback, and button styling.
- [x] Document authentication intent, security boundaries, and offline behavior.
- [x] Run targeted tests, full tests, build, lint, and repository guard checks.

## Decisions

- OAuth tokens use the existing `Authorization: Token <token>` API contract.
- Token login requires successful online validation and has no offline fallback.
- The validation payload is opaque, so token-authenticated sessions have no user
  identity (`user: null`) unless a separate identity API is introduced.
- Email/password login and its offline fallback remain unchanged.

## Review

- Added `OAuthTokenCredentials` and `SpeleoDBController.loginWithToken()`, using
  the existing token-validation service and shared online-session setup.
- Added accessible, keyboard-navigable Email & Password / OAuth Token tabs with
  a masked token field, shared instance, mode-specific help, and solid buttons.
- Added controller, component, app-route, and opt-in integration coverage;
  documented the feature and its networking/security boundaries.
- Verification:
  - Targeted auth/app/integration suite: passed (4 files, 199 tests).
  - Final focused auth suite: passed (3 files, 196 tests).
  - Full unit suite: passed (77 files, 1,294 tests).
  - `npm run build`: passed.
  - `npm run lint`: passed.
  - `git diff --check`: passed.
  - `app-btn[^\"]*bg-` guard: passed with zero matches in `src/**/*.tsx`.
