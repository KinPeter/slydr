# T008 — Build the Express app factory, error envelope and transport guards

**Epic:** E3 — Server core
**Spec sections:** §3.4, §3.5, §5.1, §13.2, NFR-7, NFR-10
**Depends on:** T001, T002, T004
**Estimated size:** L

---

## 1. Context

Slydr is a locally running, browser-based slide-show application. Its server half is an
Express 5 API that reads the local file system beneath a hard jail root and hands image
URLs to a React client. This ticket builds the foundation that every later server ticket
sits on: a testable Express application factory, the environment-configuration reader, the
three transport guards that keep a locally bound HTTP server safe from hostile web pages,
the single JSON error envelope that all API errors must use, and the `/api/health`
endpoint that the dev proxy and the end-to-end harness poll for readiness.

Nothing in this ticket touches the file system beyond reading the server's own
`package.json` for a version string. Path resolution, listing, image streaming and
thumbnails all come later and all depend on the error envelope and guards created here.

## 2. Scope

### In scope

- `server/src/config/env.ts` — a typed reader for the five environment variables in
  specification §13.2, producing a frozen `ServerConfig` object.
- `server/src/app.ts` — `createApp(config: ServerConfig): Express`, an application factory
  that wires middleware and routes and returns the app **without ever calling `listen`**,
  so Supertest can mount it directly.
- `server/src/middleware/methodGuard.ts` — rejects any method other than `GET` or `HEAD`.
- `server/src/middleware/hostCheck.ts` — rejects any request whose `Host` header is not a
  loopback name. This is the DNS-rebinding defence.
- `server/src/middleware/securityHeaders.ts` — `X-Content-Type-Options: nosniff` on every
  response, and the restrictive `Content-Security-Policy` from §3.4 on the HTML document.
- `server/src/middleware/errorEnvelope.ts` — the `ApiError` class, the `notFoundHandler`
  for unmatched `/api` routes, and the Express 5 error-handling middleware that serialises
  `{ error: { code, message } }` with the correct HTTP status.
- `server/src/routes/health.ts` — `GET /api/health` returning
  `200 { status: "ok", version }`.
- Unit and Supertest tests for all of the above.

### Out of scope

- Binding a socket, port selection, startup validation of the jail root, structured
  logging and graceful shutdown — **T009** owns `server/src/index.ts`.
- `resolveSafe` and any path containment logic — **T010** owns `server/src/security/jail.ts`.
- The directory listing service — **T011**.
- `GET /api/fs/root` and `GET /api/fs/list` — **T012**.
- `GET /api/fs/images`, `GET /api/image`, `GET /api/thumb` — later tickets in epics E6–E8.
- Static hosting of `client/dist` and browser auto-open — **T039** (epic E23).
- The thumbnail cache directory being created on disk; this ticket only *reads* the
  `SLYDR_CACHE_DIR` and `SLYDR_CACHE_MAX_MB` settings into config so that later tickets
  have them available.

## 3. Prerequisites and assumed state

The repository is **not** empty. The following already exists and must be used as-is.

**From T001 — monorepo scaffold:**

- npm workspaces monorepo with three packages: `shared/`, `server/`, `client/`.
- A root `tsconfig.base.json`; each package has a `tsconfig.json` extending it.
- `"type": "module"` in every `package.json` — the codebase is ESM throughout. Relative
  imports inside `server/src` therefore need explicit extensions as configured by T001;
  follow the convention already present in the repo.
- TypeScript in `strict` mode. `engines.node` is `>=22`.
- Express 5 is already installed as a dependency of `server/`.

**From T002 — tooling:**

- ESLint 9 flat config and Prettier at the repo root; `npm run lint` and `npm run format`.
- Vitest configured with the `node` environment for the `server` workspace, and Supertest
  installed. `npm test` runs the Vitest suites.

**From T004 — the `@slydr/shared` package.** `server/` imports it as `@slydr/shared` (resolved
through `shared/dist`; run `npm run build -w @slydr/shared` first on a fresh checkout). This
ticket consumes only the error-code types:

```ts
export const API_ERROR_CODES: readonly [
  'INVALID_PATH', 'INVALID_PARAM', 'OUTSIDE_ROOT', 'FORBIDDEN_HOST', 'NOT_FOUND',
  'NOT_A_DIRECTORY', 'NOT_A_FILE', 'ACCESS_DENIED', 'UNSUPPORTED_IMAGE',
  'THUMBNAIL_FAILED', 'READ_FAILED', 'METHOD_NOT_ALLOWED',
];
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export interface ApiErrorEnvelope {
  error: { code: ApiErrorCode; message: string };
}
export interface HealthResponse {
  status: 'ok';
  version: string;
}
```

Reuse these rather than redeclaring the codes or the envelope/health shapes in `server/`.

`server/src/` currently contains no application code, or only a placeholder entry point.
This ticket creates the files listed in §2.

## 4. Implementation detail

### 4.1 `server/src/config/env.ts`

Export a type and a reader. The reader takes an environment record so tests can pass a
synthetic environment instead of mutating `process.env`.

```ts
export interface ServerConfig {
  /** Preferred TCP port. Default 4317. `0` = OS-assigned (tests). */
  port: number;
  /** Raw jail-root override from SLYDR_ROOT, or null when unset. Test-only. */
  rootOverride: string | null;
  /** True when SLYDR_ROOT was set; T009 logs a prominent warning for this. */
  rootOverridden: boolean;
  /** Absolute thumbnail cache directory. */
  cacheDir: string;
  /** Thumbnail cache size cap in megabytes. Default 500. */
  cacheMaxMb: number;
  /** True when SLYDR_QUIET is set to a truthy value; suppresses non-error logs. */
  quiet: boolean;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig;
```

Rules, exactly:

1. **`PORT`** — parse with `Number.parseInt(value, 10)` after checking the trimmed string
   matches `/^\d{1,5}$/` (so `5000abc` is rejected, not read as 5000). Accept an integer in
   `0..65535`. `0` means "let the OS pick a free port" and exists for tests (T009's
   integration test relies on it); it is not advertised to users. When `PORT` is unset,
   empty, or fails validation, use `4317`.
   *Decision (not specified):* an invalid `PORT` falls back to the default rather than
   aborting, because an unusable port is already handled by T009's port-selection loop and
   failing the whole process on a typo is unhelpful for a local tool. Return a non-fatal
   warning by way of the logger in T009 — for this ticket, simply fall back silently.
2. **`SLYDR_ROOT`** — when present and non-empty after trimming, set `rootOverride` to the
   trimmed value and `rootOverridden` to `true`. Otherwise `rootOverride` is `null` and
   `rootOverridden` is `false`. **This variable is test-only.** It must not be resolved,
   realpath'd or validated here — T009 does that at startup and T010 caches the result.
3. **`SLYDR_CACHE_DIR`** — when present and non-empty, use it verbatim (resolved to an
   absolute path with `path.resolve`). Otherwise compute the OS-appropriate default:

   | Platform | Default cache directory |
   |---|---|
   | `win32` | `path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'slydr', 'thumbnails')` |
   | `darwin` | `path.join(os.homedir(), 'Library', 'Caches', 'slydr', 'thumbnails')` |
   | anything else (Linux and other POSIX) | `path.join(env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'slydr', 'thumbnails')` |

   *Decision (not specified):* when `%LOCALAPPDATA%` is missing on Windows, fall back to
   `<homedir>/AppData/Local` rather than throwing. Likewise `XDG_CACHE_HOME` is only used
   when it is an absolute path; a relative value is ignored per the XDG base-directory
   specification.
4. **`SLYDR_CACHE_MAX_MB`** — `Number.parseInt`, accept an integer `>= 1`, default `500`.
   Invalid values fall back to `500`.
5. **`SLYDR_QUIET`** — truthy when set to any value other than `""`, `"0"`, `"false"` or
   `"no"` (compared case-insensitively after trimming). Merely being present with an empty
   value counts as unset.

Freeze the returned object with `Object.freeze` so no later module can mutate shared
configuration.

### 4.2 `server/src/middleware/errorEnvelope.ts`

This is the contract every other server ticket depends on. Build it first.

```ts
import type { ApiErrorCode } from '@slydr/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  // `cause` (operator-only detail, NEVER serialised into a response body) is the
  // inherited `Error.cause`. Do NOT redeclare it as a class field: with
  // `noImplicitOverride` that is error TS4114, and with `useDefineForClassFields`
  // (default for target ES2023) a field declared without an initializer would be
  // re-defined as `undefined` after `super()` and wipe the stored cause.

  constructor(code: ApiErrorCode, message?: string, cause?: unknown);
  // body: super(message ?? ERROR_MESSAGE[code], cause === undefined ? undefined : { cause });
  //       this.name = 'ApiError'; this.code = code; this.status = ERROR_STATUS[code];
}

/** Maps an ApiErrorCode to its HTTP status, per specification §3.5. */
export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>>;

/** Default human-readable message per code, used when the caller passes none. */
export const ERROR_MESSAGE: Readonly<Record<ApiErrorCode, string>>;

/** 404 NOT_FOUND for unmatched /api routes. Mount after all API routes. */
export const apiNotFoundHandler: RequestHandler;

/** What the error handler reports to the operator log (never to the client). */
export interface ErrorLogEvent {
  /** The original thrown value: stack, errno, syscall and absolute paths live here. */
  err: unknown;
  method: string;
  /** `req.originalUrl`: path and query only. */
  url: string;
  code: ApiErrorCode;
  status: number;
}

/**
 * Builds the Express 5 error handler. Mount last. `log` is injected (T009 passes the
 * structured logger); the default writes one JSON line to stderr. There is no
 * module-level mutable logger.
 */
export function createErrorEnvelope(log?: (event: ErrorLogEvent) => void): ErrorRequestHandler;
```

`createApp` (below) calls `createErrorEnvelope()` itself; T009 extends `createApp` to pass its
logger. No `errorEnvelope` constant is exported.

#### The §3.5 code-to-status table, verbatim

Reproduce this mapping exactly in `ERROR_STATUS`. It is the normative table from
specification §3.5 and is quoted here in full so this ticket is self-contained.

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_PATH` | 400 | Malformed, absolute, or oversized path input. |
| `INVALID_PARAM` | 400 | A query parameter failed validation. |
| `OUTSIDE_ROOT` | 403 | Resolved target escapes the jail root. |
| `FORBIDDEN_HOST` | 403 | Host header check failed. |
| `NOT_FOUND` | 404 | Target does not exist. |
| `NOT_A_DIRECTORY` | 400 | A directory was required, a file was given. |
| `NOT_A_FILE` | 400 | A file was required, a directory was given. |
| `ACCESS_DENIED` | 403 | OS denied read (`EACCES`, `EPERM`). |
| `UNSUPPORTED_IMAGE` | 415 | Extension is not in the supported image set. |
| `THUMBNAIL_FAILED` | 500 | Decode or resize failed. |
| `READ_FAILED` | 500 | Any other I/O failure. |
| `METHOD_NOT_ALLOWED` | 405 | Non-GET/HEAD request. |

#### Default messages

Use these exact strings as `ERROR_MESSAGE` defaults. They are user-facing and must contain
no machine detail. The `OUTSIDE_ROOT` wording is taken from the example envelope in §3.5.

| Code | Default message |
|---|---|
| `INVALID_PATH` | `Invalid path.` |
| `INVALID_PARAM` | `Invalid query parameter.` |
| `OUTSIDE_ROOT` | `Path is outside the allowed root.` |
| `FORBIDDEN_HOST` | `Host not allowed.` |
| `NOT_FOUND` | `Not found.` |
| `NOT_A_DIRECTORY` | `Not a directory.` |
| `NOT_A_FILE` | `Not a file.` |
| `ACCESS_DENIED` | `Access denied.` |
| `UNSUPPORTED_IMAGE` | `Unsupported image format.` |
| `THUMBNAIL_FAILED` | `Thumbnail generation failed.` |
| `READ_FAILED` | `Read failed.` |
| `METHOD_NOT_ALLOWED` | `Method not allowed.` |

#### Response body shape

Every error response body is exactly this, with no additional keys:

```json
{ "error": { "code": "OUTSIDE_ROOT", "message": "Path is outside the allowed root." } }
```

Set `Content-Type: application/json; charset=utf-8` (Express's `res.json` does this) and
`Cache-Control: no-store` on error responses so a transient failure is never cached by the
browser.

#### The information-leak rule — non-negotiable

**No raw OS error message, no `errno`, no `syscall` value, and no absolute file-system path
may ever appear in an API response body.** This is specification §3.4's final bullet and
NFR-10. Concretely:

- `ApiError.message` may only be one of the fixed strings above, or another short,
  hand-written, path-free sentence supplied deliberately by the route.
- The error handler must **never** fall through to `err.message` for an unknown error. An
  error that is not an `ApiError` is reported as `READ_FAILED` with the fixed message
  `Read failed.`, regardless of what it actually was.
- The original error (including `err.stack`, `errno`, `code` and any absolute path) is
  passed to the logger only. Logs are operator-local and §NFR-10 explicitly permits
  absolute paths there.
- Do not echo the request's `path` query parameter back inside an error message. The client
  already knows what it asked for, and echoing user-controlled text into a response body is
  a needless reflection surface.

#### Error handler behaviour

```ts
export function createErrorEnvelope(log: (event: ErrorLogEvent) => void = defaultLog): ErrorRequestHandler {
  return (err, req, res, _next) => {
    // 1. Classify.
    const apiError = err instanceof ApiError
      ? err
      : new ApiError('READ_FAILED', undefined, err);

    // 2. Log the full detail (operator-only) via the injected `log`, passing the
    //    ORIGINAL `err` (not apiError.message), method, req.originalUrl, code, status.
    //    `defaultLog` writes one JSON line to stderr; T009 injects the structured logger.
    // 3. If headers were already sent (e.g. a stream failed mid-body), destroy the
    //    response instead of attempting to write a JSON envelope.
    // 4. Otherwise send the envelope.
  };
}
```

Point 3 matters: `res.sendFile` in the later image ticket can fail after the status line
has gone out. Guard with `if (res.headersSent) { res.destroy(); return; }`.

Express 5 forwards rejected promises from async route handlers to the error middleware
automatically, so routes may simply `throw new ApiError(...)` inside an `async` handler.
Verify this in a test rather than assuming it.

### 4.3 `server/src/middleware/methodGuard.ts`

```ts
export const ALLOWED_METHODS = ['GET', 'HEAD'] as const;
export const methodGuard: RequestHandler;
```

Behaviour:

1. If `req.method` is `GET` or `HEAD`, call `next()`.
2. Otherwise set the `Allow: GET, HEAD` response header (required by RFC 9110 for a 405)
   and `next(new ApiError('METHOD_NOT_ALLOWED'))`, which the envelope renders as
   `405 { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }`.

Mount this guard **before** any route so that `POST /api/fs/list` and
`DELETE /anything` both produce 405 rather than Express's default HTML 404.

*Decision (not specified):* `OPTIONS` is also rejected with 405. CORS is deliberately not
enabled (§3.4), the application is same-origin in production and proxied in development, so
there is no legitimate preflight to answer.

### 4.4 `server/src/middleware/hostCheck.ts`

This is the DNS-rebinding defence. A page on `evil.example` can be made to resolve a
hostname to `127.0.0.1` and then issue requests to the local server with the attacker's
`Host` header; checking the header blocks that while leaving genuine loopback traffic alone.

```ts
export const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;
export const hostCheck: RequestHandler;
export function isAllowedHost(hostHeader: string | undefined): boolean;
```

`isAllowedHost` rules:

1. A missing, empty or array-valued `Host` header is **not** allowed.
2. Strip an optional port suffix. Because IPv6 literals contain colons, split carefully:
   - If the value starts with `[`, the host is everything up to and including the matching
     `]`; an optional `:<digits>` may follow.
   - Otherwise the host is everything before the first `:`, and an optional `:<digits>` may
     follow. A value containing more than one `:` outside brackets is rejected.
3. The port suffix, when present, must be one to five digits and nothing else.
4. Compare the extracted host case-insensitively against `localhost`, `127.0.0.1` and
   `[::1]`. *Decision (not specified):* the bare, unbracketed `::1` is **rejected**
   (RFC 9110 requires brackets around an IPv6 literal in `Host`, and accepting it would
   make `::1:4317` ambiguous), as is every other `127.x.y.z` address — the specification
   names `127.0.0.1` exactly and widening the set has no benefit for a loopback-bound
   server.
5. Reject any value with leading or trailing whitespace, any userinfo (`@`), and any path
   or query characters. Treat anything that does not parse cleanly as not allowed.

On rejection: `next(new ApiError('FORBIDDEN_HOST'))` →
`403 { error: { code: "FORBIDDEN_HOST", message: "Host not allowed." } }`.

Mount `hostCheck` before `methodGuard`: a non-loopback `POST` should be reported as a host
problem, because that is the more serious of the two findings and the one a security test
asserts on.

*Decision (not specified):* the host check applies to **every** request, including the
static client assets and `/api/health`, not just `/api/*`. There is no reason to serve the
HTML document to a rebinding attacker either.

### 4.5 `server/src/middleware/securityHeaders.ts`

```ts
export const CSP_VALUE =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'";

export const securityHeaders: RequestHandler;
```

Behaviour:

1. Set `X-Content-Type-Options: nosniff` on **every** response. This is cheap and prevents
   a mis-typed image or JSON body being sniffed as HTML or script.
2. Set `Content-Security-Policy: <CSP_VALUE>` on the HTML document only. The exact string
   is quoted from specification §3.4 and reproduced above; it must match character for
   character, including the single quotes around `'self'` and `'unsafe-inline'`, the
   trailing colons on `blob:` and `data:`, and the `; ` separators.
3. *Decision (not specified):* "the HTML document" is implemented as: apply the CSP header
   when the request path is `/`, or ends in `.html`, or when the response's eventual
   `Content-Type` starts with `text/html`. Because this ticket does not serve any HTML yet,
   implement the first two cases as a path test and expose the middleware so that T039,
   which adds static hosting of `client/dist`, can place it in front of the static handler
   without modification. A short comment in the file must point at T039.
4. Also set `Referrer-Policy: no-referrer` and
   `Cross-Origin-Resource-Policy: same-origin` on every response. *Decision (not
   specified):* these two are not named in §3.4 but cost nothing, align with the
   no-outbound-traffic stance of NFR-9, and further reduce the value of the server to a
   cross-origin page. Do not add `Strict-Transport-Security` — the server is plain HTTP on
   loopback and HSTS on `localhost` would be actively harmful to other local development.

Note on image responses: `CSP_VALUE` is for the HTML document only. SVG files served by
`GET /api/image` get their own locked-down policy (`default-src 'none'; style-src
'unsafe-inline'; sandbox`) set by the route in **T015** (spec §3.4), because an SVG opened
as a top-level document would otherwise run its script in the Slydr origin. This
middleware must not add or strip a CSP on `/api/*` responses.

Note on framing: CSP's `frame-ancestors` has no fallback to `default-src`, so `CSP_VALUE`
does not prevent framing. *Decision (not specified):* append nothing extra here; the
server is loopback-only and read-only. If framing protection is later wanted, add
`frame-ancestors 'none'` to `CSP_VALUE` as a deliberate spec amendment rather than silently
diverging from the §3.4 string.

### 4.6 `server/src/routes/health.ts`

```ts
export function createHealthRouter(): Router;
```

`GET /api/health` → `200 { "status": "ok", "version": "<package version>" }`.

- `version` is read from the **server** package's own `package.json`. Because the codebase
  is ESM, there is no `require`. Read it once at module load with:

  ```ts
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import path from 'node:path';

  const here = path.dirname(fileURLToPath(import.meta.url));
  // Resolve upward from src/routes (dev, via tsx) or dist/routes (built).
  ```

  *Decision (not specified):* resolve the file by walking up from `import.meta.url` until a
  `package.json` whose `name` is `@slydr/server` is found, with a maximum of five levels,
  and fall back to the string `"0.0.0"` if none is found. This survives both the `tsx watch`
  layout (`server/src/routes/health.ts`) and the compiled layout
  (`server/dist/routes/health.js`) without a build-time code generation step and without
  `resolveJsonModule`, whose ESM JSON-import behaviour still requires an import attribute
  in Node 22.
- Send `Cache-Control: no-store` on the health response. A polled readiness endpoint must
  never be cached.
- The endpoint takes no parameters; any query string is ignored rather than rejected.
- `HEAD /api/health` must also return `200` with no body. Express handles this
  automatically for a `GET` route.

### 4.7 `server/src/app.ts`

```ts
import type { Express } from 'express';
import type { ServerConfig } from './config/env.js';

export function createApp(config: ServerConfig): Express;
```

The factory **must not call `app.listen`**. T009's bootstrap does that. This separation is
what lets the Supertest suites in T012 and later do
`request(createApp(testConfig)).get('/api/fs/list?path=')` with no socket involved.

Middleware order, exactly:

1. `app.disable('x-powered-by')` — do not advertise Express.
2. Do not touch `etag` settings. Express's default (weak ETags on JSON responses) is
   fine; the thumbnail ticket sets its own strong ETag explicitly per response.
3. `securityHeaders`
4. `hostCheck`
5. `methodGuard`
6. `createHealthRouter()` mounted at `/api`
7. A placeholder comment marking where `/api/fs`, `/api/image` and `/api/thumb` routers are
   mounted by T012 and the later tickets, and where T039 inserts static hosting of
   `client/dist`.
8. `apiNotFoundHandler` mounted at `/api` — any unmatched `/api/*` path yields
   `404 { error: { code: "NOT_FOUND", message: "Not found." } }` rather than Express's HTML
   404 page.
9. `createErrorEnvelope()` (the handler it returns) as the final `app.use`.

Do **not** add `express.json()` or any body parser. Every endpoint is `GET`/`HEAD`; a body
parser on a read-only API is pure attack surface.

Do **not** enable CORS, and do not install the `cors` package (§3.4).

The factory accepts the config by injection — it never reads `process.env` itself. Tests
build a `ServerConfig` literal; T009 calls `readServerConfig()` and passes the result in.

### 4.8 Cross-platform notes

- Nothing in this ticket branches on platform except the cache-directory default in
  `env.ts`. Test that branch by passing a synthetic `env` and stubbing `process.platform`
  with `Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })`
  (restore the original descriptor in `afterEach`; `vi.stubGlobal('process', ...)` would
  replace the whole object and is not allowed), rather than by skipping the test on other
  platforms, so all three defaults are covered on every CI leg. The host's `path` module
  still joins with the host separator, so assert with `path.join('slydr', 'thumbnails')`
  suffixes and the injected `env` values, and do not run `path.resolve` over the computed
  default (a stubbed Windows path is not absolute on a POSIX host and would be prefixed
  with the cwd).
- `%LOCALAPPDATA%` and `XDG_CACHE_HOME` are read from the injected `env` record, not from
  `process.env` directly, which keeps the reader pure and testable.
- Node on Windows reports `req.headers.host` identically to the other platforms, so
  `hostCheck` needs no platform branch.
- Path separators do not appear anywhere in this ticket's response bodies.

## 5. Acceptance criteria

- [ ] `server/src/config/env.ts` exports `ServerConfig` and
      `readServerConfig(env?): ServerConfig`; the returned object is frozen.
- [ ] `readServerConfig({})` yields `port === 4317`, `rootOverride === null`,
      `rootOverridden === false`, `cacheMaxMb === 500`, `quiet === false`, and an absolute
      `cacheDir`.
- [ ] `readServerConfig({ SLYDR_ROOT: 'C:\\tmp\\fixture' })` yields
      `rootOverridden === true` and `rootOverride === 'C:\\tmp\\fixture'`.
- [ ] `server/src/middleware/errorEnvelope.ts` exports `ApiError`, `ERROR_STATUS`,
      `ERROR_MESSAGE`, `apiNotFoundHandler`, `createErrorEnvelope` and the `ErrorLogEvent`
      type; `err.cause` of an `ApiError` constructed with a cause is that cause (not wiped).
- [ ] `ERROR_STATUS` contains exactly the twelve codes of §3.5 mapped to the statuses in the
      table in §4.2 of this ticket, and `Object.keys(ERROR_STATUS)` has length 12.
- [ ] Every error response body is exactly `{ error: { code, message } }` with no extra
      top-level or nested keys.
- [ ] No response body produced by any code path in this ticket contains an `errno`, a
      `syscall`, a stack trace, or a path separator. A test asserts this for a thrown
      non-`ApiError` carrying a realistic `ENOENT` object with an absolute `path` property.
- [ ] `createApp(config)` returns an Express app and does not open a socket; calling it in a
      test leaves `server.listening` irrelevant because no server object is created.
- [ ] `GET /api/health` returns `200` with `{ status: 'ok', version: <non-empty string> }`
      and `Cache-Control: no-store`.
- [ ] Any method other than `GET`/`HEAD` on any path returns `405` with code
      `METHOD_NOT_ALLOWED` and an `Allow: GET, HEAD` header.
- [ ] A request with `Host: evil.example` returns `403` with code `FORBIDDEN_HOST`.
- [ ] Requests with `Host` values `localhost`, `localhost:4317`, `127.0.0.1`,
      `127.0.0.1:4317`, `[::1]`, `[::1]:4317` all pass the host check.
- [ ] Every response carries `X-Content-Type-Options: nosniff`.
- [ ] `CSP_VALUE` equals, character for character:
      `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'`
- [ ] `GET /api/does-not-exist` returns `404` with code `NOT_FOUND` and a JSON body, not
      HTML.
- [ ] `X-Powered-By` is absent from all responses.

## 6. Tests to write

Per specification §12.1 (unit) and §12.2 (API via Supertest). All server tests run in the
Vitest `node` environment configured by T002.

**`server/test/config/env.test.ts`**

- `defaults with an empty environment` — asserts the full default `ServerConfig`.
- `parses a valid PORT` — `{ PORT: '5000' }` → `port === 5000`.
- `falls back to 4317 for a non-numeric PORT` — `{ PORT: 'abc' }`.
- `accepts PORT 0 as the ephemeral-port request` — `{ PORT: '0' }` → `port === 0`.
- `falls back to 4317 for an out-of-range PORT` — `{ PORT: '-1' }`, `{ PORT: '70000' }` and
  `{ PORT: '5000abc' }`.
- `records SLYDR_ROOT as an override without resolving it` — asserts `rootOverridden` and
  that no file-system call happened (the value may be a nonexistent path).
- `treats an empty SLYDR_ROOT as unset`.
- `honours SLYDR_CACHE_DIR` — a relative value is resolved to absolute.
- `computes the Windows cache default` — `process.platform` stubbed to `win32`,
  `LOCALAPPDATA` provided; asserts the path ends with `slydr/thumbnails` (compare with
  `path.join` so the assertion is separator-agnostic).
- `computes the macOS cache default` — platform stubbed to `darwin`.
- `computes the Linux cache default honouring XDG_CACHE_HOME`, and
  `ignores a relative XDG_CACHE_HOME`.
- `parses SLYDR_CACHE_MAX_MB and rejects junk`.
- `SLYDR_QUIET truthiness` — table-driven over `''`, `'0'`, `'false'`, `'no'`, `'1'`,
  `'true'`, `'yes'`.
- `the returned config is frozen`.

**`server/test/middleware/hostCheck.test.ts`** — a table-driven unit test of
`isAllowedHost` covering: `localhost`, `LOCALHOST`, `localhost:4317`, `127.0.0.1`,
`127.0.0.1:4317`, `[::1]`, `[::1]:4317` (all true) and `::1` (false, bare IPv6),
`undefined`, `''`, `evil.example`,
`evil.example:4317`, `127.0.0.2`, `localhost.evil.example`, `localhost:abc`,
`localhost:123456`, `user@localhost`, `' localhost '`, `0.0.0.0`, and
`[::1]:4317extra` — each with the expected boolean.

**`server/test/middleware/errorEnvelope.test.ts`**

- `ERROR_STATUS matches the §3.5 table` — an inline expected object compared with
  `toEqual`, so a future edit to either side fails loudly.
- `every ApiErrorCode has a default message`.
- `ApiError carries code, status and message`.
- `an unknown error becomes READ_FAILED` and the body contains neither the original message
  nor any of `errno`, `syscall`, `stack`.

**`server/test/app.test.ts`** (Supertest against `createApp(makeTestConfig())`)

- `GET /api/health returns ok and a version`.
- `HEAD /api/health returns 200 with an empty body`.
- `health response is not cacheable` — asserts `Cache-Control: no-store`.
- `POST /api/health returns 405 METHOD_NOT_ALLOWED with an Allow header`.
- `PUT /, DELETE /api/fs/list and OPTIONS /api/health all return 405` — table-driven.
- `a non-loopback Host returns 403 FORBIDDEN_HOST`.
- `a non-loopback Host on a non-GET method reports FORBIDDEN_HOST, not METHOD_NOT_ALLOWED`
  — pins the middleware order.
- `allowed Host values pass` — table-driven over the six accepted forms.
- `every response carries nosniff`.
- `the CSP header is applied to an HTML-document path and not to a JSON API path` — assert
  the exact `CSP_VALUE` string on `GET /` and its absence on `GET /api/health`. Because no
  HTML is served yet, `GET /` will fall through to the error envelope; assert on the header
  rather than on the status.
- `API responses carry no HTML CSP` — `GET /api/health` and a 404 `GET /api/image` carry
  no `Content-Security-Policy` header from this middleware (SVG responses get theirs from
  T015).
- `an unmatched /api route returns a JSON 404 NOT_FOUND envelope`.
- `X-Powered-By is absent`.
- `a route that throws an ApiError inside an async handler is serialised by the envelope` —
  a route added to the app returned by `createApp` would sit *after* the `/api` 404 handler and
  never run, so build a small throwaway app in the test instead:
  `express()` + `securityHeaders` + `hostCheck` + `methodGuard` + the throwing `async` route +
  `app.use('/api', apiNotFoundHandler)` + `app.use(createErrorEnvelope())`. This confirms
  Express 5 async error forwarding works as assumed.
- `a route that throws a raw ENOENT object yields 500 READ_FAILED with no leaked detail`.

Add a small shared helper `server/test/helpers/testConfig.ts` exporting
`makeTestConfig(overrides?: Partial<ServerConfig>): ServerConfig` so later tickets
(T012 in particular) reuse it instead of hand-rolling config literals.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on Windows, macOS and Linux.
- [ ] `createApp` is exported and used by no `listen` call anywhere in this ticket's diff.
- [ ] `ERROR_STATUS` and `CSP_VALUE` are single-sourced; no other file redeclares a status
      number or a CSP string.
- [ ] Grep the diff for `err.message`, `errno`, `e.stack` inside anything that reaches
      `res.json` — there must be no hits.
- [ ] README updated only if setup changed; this ticket adds no new user-visible behaviour
      beyond `/api/health`, so a README change is likely unnecessary.

## 8. Notes and gotchas

- **Express 5 error signature.** The error-handling middleware must declare four
  parameters (`err, req, res, next`) or Express will treat it as ordinary middleware. ESLint
  will flag the unused ones; prefix them with `_` per the repo's configured
  `argsIgnorePattern` rather than disabling the rule.
- **Express 5 wildcards changed.** Express 5 uses `path-to-regexp` v8, where a bare `*` is
  no longer a valid path. For the catch-all 404 use `app.use('/api', apiNotFoundHandler)`
  (middleware mounting, no pattern) rather than `app.get('/api/*', ...)`.
- **Supertest and `listen`.** Supertest will itself call `listen` on an ephemeral port when
  given an `Express` app. That is fine and is exactly why the factory must not listen: a
  factory that bound 4317 would make the test suite unrunnable in parallel and would fail
  on a developer machine with the dev server already up.
- **`req.headers.host` can be an array** in pathological cases with Node's raw header
  handling. Type it as `string | string[] | undefined` and reject the array case rather than
  letting TypeScript's `string | undefined` assumption hide a crash.
- **The host check is not authentication.** It stops a cross-origin page from using the API
  via a rebound hostname. It does not stop a local process, and it is not meant to. Combined
  with the loopback bind in T009 it is the whole of the transport threat model (§1.2:
  no multi-user, no remote use).
- **Do not depend on the structured logger yet.** It is T009's deliverable. The injection
  seam is the `createErrorEnvelope(log)` factory of §4.2 (default `log` writes one JSON line
  to `stderr`); there is no module-level mutable logger, and T009 plugs its logger in through
  `createApp(config, logger)` without editing this file's logic.
- **Port 4317 is an arbitrary pick** (§16.2 item 1). Do not hard-code it anywhere except as
  the documented default in `env.ts`.
- **`SLYDR_ROOT` is test-only.** It must not be documented in the README quick start
  (§3.1). T009 is responsible for the startup warning when it is set; this ticket only
  surfaces the flag in config.
