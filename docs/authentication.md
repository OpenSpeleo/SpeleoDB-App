# Authentication

This document defines how the app creates and restores SpeleoDB sessions.

## Design intent

- Support both normal email/password login and direct OAuth-token login.
- Validate every user-supplied OAuth token before storing or using it.
- Keep authentication state transitions in `SessionCoordinator`, exposed to UI
  callers through the stable `SpeleoDBController` façade. The login page only
  collects credentials and presents controller results.
- Permit offline use only through a secure session that was validated online
  before the current network failure.
- Never log, display, or include token values in error messages.

## Login methods

The login page exposes two keyboard-accessible tabs that share the selected
SpeleoDB instance. An instance is an origin only (scheme, hostname, and optional
port); paths, queries, fragments, embedded credentials, and non-HTTP schemes are
rejected before either credential transport runs. The accepted origin is
canonicalized before both transport and secure-session persistence.

### Email and password

`SpeleoDBController.login()` sends the credentials to
`POST /api/v2/user/auth-token/`. A successful response supplies both the token
and the email used for the in-memory `User` identity. Password-manager autofill
and forgot-password links belong exclusively to this flow. Passwords are sent
only to the selected SpeleoDB instance and are never stored by the app. Remote
instances are normalized to HTTPS before the request. Cleartext HTTP is
available only for a loopback development server and never in a release build.

If the server cannot be reached, password login fails with an explicit message.
The app never authenticates against a local password copy and never generates a
synthetic offline token. Users who already have a securely restored session can
continue through the normal startup offline-lock flow in `docs/offline-mode.md`.

### OAuth token

`SpeleoDBController.loginWithToken()` trims the token and instance, then calls
the existing `SpeleoDBService.validateToken()` path:

```http
GET /api/v2/user/auth-token/
Authorization: Token <token>
```

Any `2xx` response validates the token; the response body is opaque and may be
empty. Because validation does not return identity data, the authenticated state
deliberately uses `user: null`. Code must not invent an email address or derive
identity from the token.

Token login requires a live server response:

- `2xx`: create and persist the session.
- `4xx`: remain on the login page and show `Invalid OAuth token`.
- timeout, transport error, or non-`4xx` server failure: remain on the login
  page, show a validation/connectivity error, and do not enter offline mode.

Authentication error bodies are untrusted and are never display input. The
coordinator selects fixed messages from local status/transport classes for both
password and token login. It does not parse `detail`, `message`, field errors,
or any other response-body text, so raw, transformed, or encoded credential
bytes cannot be reflected into the UI.

An unvalidated token is never persisted. The token input is masked, disables
browser autofill and autocapitalization, and preserves its value only in React
form state while the login screen remains mounted.

The form admits one submission synchronously, before React's loading-state
render. It remains disabled through the successful-login redirect delay, so a
second submit cannot supersede an accepted session while success feedback is
visible. Async results are ignored after unmount, and the owned redirect timer
is cancelled when the login page leaves the tree.

## Session persistence and restoration

Successful online login from either method uses one coordinator session-setup
path. `SecureSessionStore` writes the normalized token to the native vault
first, commits only non-secret metadata (`instance`, optional `email`, and a
session-presence marker) to `PreferencesService`, and only then publishes the
authenticated controller state. A storage failure leaves the caller
unauthenticated and restores the previous secure token.

Controller-wide application invalidation is a required cross-account safety gate
and completes before the secure credential commit. If it fails, no new session
is written or published. After durable commit, session/auth/connectivity state
is authoritative: tile-runtime adapters and React subscribers observe that
transition but cannot roll it back or convert a successful login/validation into
failure if they throw. This preserves one result across the durable store,
controller snapshot, and caller.

The initial offline-runtime adapter is also best-effort: failure cannot crash
controller construction or discard a securely restored session.

Authentication attempts use latest-attempt ownership. Starting a valid password
or token attempt cancels any older attempt and supersedes startup validation
immediately. Network requests may overlap so a cancellation-aware new attempt is
not blocked by stale transport work, but secure-session writes use one
serialized mutation lane. The cancellation signal remains authoritative inside
`SecureSessionStore`: if cancellation arrives during a native vault write or
after metadata commit, both token and metadata are rolled back to the previous
coherent session before the attempt returns. A superseded attempt can therefore
neither publish nor leave durable credentials behind when the newer attempt
fails.

Email/password login also stores the authenticated email. Token login omits the
email so stale identity cannot leak from a previous session. Before React
mounts, startup restores the token from iOS Keychain or Android Keystore-backed
storage and combines it with the non-secret instance metadata. A missing email
restores `user: null`; a stored email reconstructs the lightweight user
identity. Startup then validates the secure token using the rules in
`docs/networking.md`.

Persisted session fields are treated as untrusted upgrade input. Startup trims
the token and identity metadata, re-applies the current origin-only/HTTPS
instance policy, and atomically commits any recoverable canonical form before
network validation. A path, query, fragment, embedded credential, unsupported
scheme, blank token, or failed canonical metadata commit cannot become an
offline session: authentication is revoked and the destructive local-user-data
purge runs without issuing a request. A later transport failure after a
successful canonical upgrade keeps the session and follows normal offline
continuity rules.

`SecureSessionStore` serializes every establishment and clear operation. If
logout wins while canonical migration is inside a native vault write, the
aborted migration completes its rollback before credential deletion runs; a late
rollback can never restore a token after destructive cleanup.

If the in-process secure-session snapshot cannot be read, validation revokes
authentication, invokes the destructive local-data purge, and returns
`unauthorized` without making a request. Cleanup remains best-effort so a native
deletion error cannot restore in-memory access or reject the validation result.
Restoration failure emits only a fixed diagnostic string; the thrown native
storage object is never passed to console/reporting boundaries. The startup UI
also treats an unexpected validation rejection as unauthorized: it clears the
pending banner, dismisses the splash, and routes to login instead of leaving an
unhandled rejection or an ambiguous authenticated view.

On iOS, `AppBridgeViewController` registers the first-party credential plugin as
a concrete bridge instance. This registration path must coexist with Capacitor's
automatic discovery for packaged plugins; type registration is not used because
Capacitor 8 ignores it while automatic discovery is enabled. A missing plugin is
treated as a storage failure, so even a successful server response leaves the
app unauthenticated instead of retaining a token only in memory.

Upgrades migrate the legacy `localStorage` token in a strict order: read legacy
metadata, write the native vault, then rewrite preferences without the token. If
the final rewrite fails, the previous native value is restored and the legacy
record remains intact for a later retry. Conflicting/orphaned state fails closed
instead of inventing a session.

The browser development preview has no native vault. It therefore uses a
memory-only session that supports login for the lifetime of the page and is
discarded on reload. It never creates a persistent session marker or stores a
token in browser storage. Durable session restoration is a native-app feature.

Logout and invalid stored-session handling remain destructive operations as
defined in `docs/logout-behavior.md`. A failed pre-login token attempt does not
call logout or purge caches because it never created a session. Once logout
begins, new login and validation probes are rejected until purge finishes.
Logout cancels in-flight authentication and validation, waits for all
authentication operations (including secure-store rollback) to settle, and only
then enters the destructive purge boundary. Secure-session clear always revokes
its in-process snapshot and attempts both vault-token and non-secret marker
deletion. If the native vault refuses deletion, the marker is still removed; a
later startup treats any surviving token as an orphan to delete, never as a
restorable authenticated session.

## Architecture and performance

- `src/pages/Login.tsx` owns tab selection and form presentation only.
- `SpeleoDBController` is the public façade and injects bounded lifecycle hooks
  for application-wide invalidation, destructive purge, and reconnect sync.
- `SessionCoordinator` owns login policy, restored auth state, online/offline
  transitions, validation cancellation, reconnect decisions, and session
  establishment. It does not depend on project, GPS, tile, or React modules.
- `SecureSessionStore` owns migration, commit ordering, rollback, and
  revocation.
- `instanceUrl.ts` owns pure instance-origin parsing and canonicalization; it
  has no Capacitor/browser dependency.
- `PreferencesService` owns non-secret metadata and exposes legacy token bytes
  only to the one migration adapter.
- `SpeleoDBService.validateToken()` owns the API request and authorization
  header; there is no separate token-login transport path.

Token login adds one validation request and one bounded native vault write. A
new request starts without waiting for a stale network response; only the short
secure-session mutation is serialized. Login adds no polling, cache scan, or
background task.

Bootstrap removes the obsolete `speleo_users_db` record before session restore.
Failure to remove that residue fails session initialization closed; raw values
are never logged or parsed.

## Verification strategy

- Coordinator unit tests cover every branch of validation, trimming, fail-closed
  persistence, latest-attempt cancellation, serialized secure writes, logout
  exclusion, reconnect, fixed auth-error publication, pre-commit invalidation,
  observer-failure isolation, and state publication.
- Controller characterization tests cover the stable façade and its integration
  with destructive purge, project sync, and application-wide invalidation.
- Together they cover identity-free restoration, every response class, and
  rejection of seeded legacy plaintext credentials during a transport failure.
- Session-store tests cover fresh writes, account replacement, legacy migration,
  interrupted migration, orphan cleanup, cancellation before/after metadata
  commit, canonical instance enforcement, rollback, rollback failure,
  establish/clear ordering, and logout. Coordinator tests own persisted-session
  upgrade ordering and destructive rejection of malformed identity metadata.
- An iOS integration test loads the production bridge controller and proves the
  JavaScript-visible `CredentialStore` plugin is registered before the WebView
  uses it; the separate Keychain tests retain ownership of persistence behavior.
- Login component tests cover tab semantics and keyboard navigation, masked
  token entry, shared instance submission, single-flight admission, unmount-
  safe redirect ownership, feedback, redirects, and solid button variants.
- The opt-in controller integration suite validates a configured real OAuth
  token through the full controller/service/HTTP stack.
