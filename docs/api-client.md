# Generated SpeleoDB API client

## Ownership

`@speleodb/api` is the shared TypeScript API contract and generated client.
Orval creates its request/response types, endpoint paths, path/query encoding,
and JSON/form serializers from the web application's canonical `OpenAPI.yaml`.
Mobile depends on an exact published package version in `package.json`; the
monorepo overrides that dependency with `packages/typescript/api` during local
development.

`SpeleoDBService` remains the application facade used by controllers and offline
operations. Each first-party method calls a generated operation. There is no
mobile endpoint table or generic first-party URL builder. The facade supplies an
immutable client for each call, using the supplied instance and current token.
It never stores credentials in a shared SDK singleton. Replayed offline
operations continue resolving the active session at execution time.

Generated types describe the server wire contract. They do not replace durable
storage formats, normalized map models, admission checks on unknown server data,
or the session/offline coordinators. The facade deliberately exposes unknown
response data to those existing validators: generated TypeScript types are not
runtime validation of a remote server. Status codes remain available on every
HTTP response, including undocumented responses; network failures and
cancellation reject the promise.

## Transport and lifecycle

`src/services/apiTransport.ts` adapts the SDK transport interface to
`HttpClient`. It forwards generated serialized JSON as text without encoding it
again. It forwards generated multipart `FormData` to the browser unchanged.
Native GPX uploads decode the generated file with a cancellable `FileReader`
inside the request deadline, then use the existing UTF-8 multipart serializer.
The native adapter supports one `application/gpx+xml` file and text fields.
Other native upload formats require an explicit transport design and tests; they
must not silently become stringified binary data.

The SDK starts an overall deadline before transport preparation and passes its
remaining duration and cancellation signal to the mobile transport. Native
metadata lookup, file reading, transport, response parsing, and publication
remain inside that deadline. The facade maps SDK `TimeoutError` to the app's
existing `AbortError` classification. Cancellation handlers consume every
already-admitted promise, including when a transport cancels synchronously, so
late failures cannot become unhandled rejections or publish stale results.

Mobile retains its finite ten-second default (`NETWORK.REQUEST_TIMEOUT_MS`),
with finite per-call overrides where already supported. The shared SDK also
supports `timeoutMs: null` for browser flows without a deadline; the mobile
transport explicitly rejects that option before network admission because
`HttpClient` requires a finite budget. Do not substitute a default silently or
copy the web application's no-deadline policy into the mobile facade.

`HttpClient` continues enforcing production HTTPS, origin-only instances, native
user-agent identification, and disabled redirects for requests carrying
credentials or bodies. GIS collection/detail reads use the dedicated cookie-free
native plugin and status-first JSON parsing. A denial stays a denial even if its
body is HTML. An API generation change must not route these requests through the
ordinary shared-cookie native transport.

No passive connectivity listener or automatic queue replay is introduced. Only
stored-session validation may treat `401`/`403` as destructive denial. Other
requests retain their existing offline/cache policies. An empty `204`, `205`, or
`304` body is represented as `undefined` and is not parsed as JSON.

## Intentional external requests

These resources are outside the first-party OpenAPI contract:

| Boundary                                 | Resource                                                           |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `SpeleoDBService.downloadJSON`           | Signed object-storage GeoJSON, without an API authorization header |
| `TileCacheService.downloadValidatedTile` | External map tiles                                                 |
| `TileCacheService.getCachedStyle`        | External map styles                                                |
| `dashboardMapUtils.loadImageViaFetch`    | Map image assets                                                   |

`bun run check:api` scans the production TypeScript AST for raw network access
outside these named functions and the transport implementations, and for
first-party endpoint path literals outside transport security policy. The check
runs in mobile prek and therefore in its CI. It is a regression boundary, not a
proof of all possible dynamically constructed JavaScript behavior. Keep
exceptions narrow, named, and documented when a new non-API resource appears.

## Updating the package dependency

The complete producer procedure lives in the API package's `docs/maintenance.md`
(in a monorepo checkout, `packages/typescript/api/docs/maintenance.md`). That
guide covers backend contract changes, canonical export, exact source-digest
verification, regeneration, package validation, versioning, and release
coordination. The web repository owns the sole checked-in `OpenAPI.yaml`; the
SDK publishes only its `openapi-source.json` provenance record and generated
TypeScript. Consumer builds and runtime calls do not download a schema.
Standalone SDK generation uses the record's immutable backend revision and
verifies its SHA-256; unpublished maintenance uses an explicitly supplied
canonical local file.

For a consumer update:

1. Review the schema and generated-code diff. Check operation renames, request
   requiredness, numeric/string inputs, enum values, status codes, response
   bodies, and media types. A successful typecheck cannot establish server
   compatibility on its own.
2. Pin the released version of `@speleodb/api` in mobile's `package.json`. In
   the monorepo, local development uses the workspace override; standalone
   releases require that exact version to exist in the configured registry. Keep
   the standalone dependency pinned to a published registry version.
3. Update calls in `SpeleoDBService` and import wire types from the package. Use
   the generated JSON variant for JSON bodies and the multipart variant for file
   uploads. Generated operation options receive the per-call client; avoid
   reconstructing paths with URL helper exports.
4. Preserve durable cache/queue types where older stored records omit fields.
   Derive their shared fields from generated models, document compatibility
   differences, and test old records before changing persistence semantics.
5. Resolve the standalone lock from this app's directory using `bun run lock` in
   the monorepo. The existing lock utility solves the app outside the parent
   workspace. In a standalone clone, follow `scripts/lock.mjs` instructions.
   Then refresh the integration lock from the monorepo root with `bun run lock`.
   Review both lock diffs; local workspace success does not prove a registry
   install works.
6. Install and run the checks below. In a standalone checkout use
   `test -s bun.lock && bun install --frozen-lockfile`; in the monorepo run
   `bun ci` from the root, then execute checks in the mobile directory.

Do not manually edit the SDK's generated files. A model or serializer defect
must be fixed in the backend contract or generator configuration, regenerated,
and tested at the affected transport boundary.

## Verification

From the mobile directory:

```sh
bun run check:shared-packages
bun run check:api
bun run lint
bun run typecheck
bun run test.unit --run src/services/SpeleoDBService.test.ts src/services/HttpClient.test.ts src/services/apiTransport.test.ts
bun run test:ci
bun run build
bun run test:browser
bun run cap sync
```

The focused transport tests exercise real generated operation functions through
the adapter and `HttpClient`. They cover JSON encoding, encoded identifiers,
authorization, native multipart Unicode/file metadata, cancellation during file
reading, deadlines during native preparation, rejection of unsupported
no-deadline requests before native preparation, cookie-free GIS denials, and
empty responses. The full suite covers session supersession, non-destructive
offline fallback, queue replay, stored records, and cache publication.

Inspect native diffs after Capacitor sync. Run the existing Android/iOS compile
and native tests when transport or native integration changes. Device tests
remain necessary for physical-platform behavior that JavaScript mocks and
compilation cannot establish; record exact commands, platforms, and limitations
instead of treating a green TypeScript build as device evidence.

## Troubleshooting

- **The generated operation does not exist:** verify the installed package
  version and regenerate from the intended schema. Multiple accepted request
  encodings can produce `WithJson`, `WithFormData`, or `WithUrlEncoded`
  variants. Inspect exports rather than guessing a new endpoint path.
- **Local build works but standalone install fails:** check that the exact API
  package version has been published and that the child lock was solved outside
  the parent workspace. A monorepo override can otherwise hide a missing
  release.
- **The server receives a JSON string instead of an object:** preserve the
  generated body as `HttpRequest.body`. Do not pass that string as data to a
  serializer that calls `JSON.stringify` again.
- **Native GPX fails before the request:** verify file MIME type, filename,
  collection field, and cancellation/deadline state. Native multipart rejects
  unsupported binary formats, repeated fields, and unsafe CRLF metadata.
- **A request changes logout/offline behavior:** inspect the coordinator policy,
  status preservation, and error classification. Do not translate all non-2xx
  responses into transport exceptions or turn malformed success into a valid
  durable object.
- **Contract hashes differ:** review web's canonical export, update the SDK's
  source revision and SHA-256 deliberately, then regenerate. Do not
  independently format the schema or weaken the hash check.
