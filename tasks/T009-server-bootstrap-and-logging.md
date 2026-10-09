# T009 — Implement server bootstrap, loopback bind, port selection and structured logging

**Epic:** E3 — Server core
**Spec sections:** §3.1, §3.4, §13.2, NFR-8, NFR-10
**Depends on:** T008
**Estimated size:** L

---

## 1. Context

Slydr is a locally running, browser-based slide-show application whose server half is an
Express 5 API that reads images from the user's own disk. A previous ticket built the
Express application *factory* — a function that wires middleware and routes and returns an
app without ever opening a socket, so that tests can mount it directly. This ticket builds
the process around that factory: the executable entry point that resolves and validates the
jail root, binds a listener to loopback only, picks a usable port, emits structured
single-line logs, and shuts down cleanly on a signal.

This is the file a developer actually runs (`tsx watch server/src/index.ts` in development,
`node server/dist/index.js` in production). Getting the bind address and the startup
validation right here is a security requirement, not a convenience: the whole threat model
of Slydr rests on the server being unreachable from the network and on it never serving a
path outside a single validated root.

## 2. Scope

### In scope

- `server/src/index.ts` — the process entry point: read config, resolve and validate the
  jail root, create the app, select a port, listen on `127.0.0.1`, log readiness, install
  signal handlers.
- `server/src/logger.ts` — a structured single-line stdout/stderr logger honouring the
  `SLYDR_QUIET` flag for non-error output, wired into the error envelope created in T008.
- `server/src/bootstrap/resolveRoot.ts` — startup resolution and validation of the jail
  root (`SLYDR_ROOT` or `os.homedir()`), via `fs.realpath`, refusing to start when the root
  is missing, not a directory, or not readable.
- `server/src/bootstrap/listen.ts` — the port-selection loop: start at `PORT`, retry `+1`
  through `+9` on `EADDRINUSE`, then fail with a message naming every port tried.
- Graceful shutdown on `SIGINT` and `SIGTERM`, plus handlers for `uncaughtException` and
  `unhandledRejection`.
- Unit tests for the logger, the root resolver and the port-selection loop; one integration
  test that boots the real process entry point on an ephemeral port.

### Out of scope

- The app factory, middleware, guards, error envelope and `/api/health` — **T008** owns
  those and they are consumed here unchanged.
- `resolveSafe` and per-request path containment — **T010** owns
  `server/src/security/jail.ts`. This ticket produces the validated root string and hands it
  to that module's initialiser; it does **not** implement containment.
- The directory listing service — **T011**; the `/api/fs/*` routes — **T012**.
- **Static hosting of `client/dist` and browser auto-open are deliberately out of scope
  here and are owned by T039** (epic E23, specification §2.2). Leave a clearly commented
  insertion point in `index.ts` and do not add `express.static`, a `client/dist` path
  resolution, an `open`/`start`/`xdg-open` call, or any URL-printing logic beyond the single
  readiness log line described in §4.5.
- The thumbnail cache LRU sweep that §5.6 says runs at startup — owned by the thumbnail
  ticket in epic E8. This ticket only passes `cacheDir` and `cacheMaxMb` through in config.

## 3. Prerequisites and assumed state

**From T001 — monorepo scaffold:**

- npm workspaces monorepo with `shared/`, `server/`, `client/`; root `tsconfig.base.json`.
- `"type": "module"` everywhere — ESM throughout. There is no `require`; use
  `import.meta.url` with `fileURLToPath` when a module needs its own location.
- TypeScript `strict`. `engines.node` is `>=22`, so `fs.promises`, native `fetch` and
  `os.availableParallelism()` are all available without polyfills.
- Express 5 already installed in `server/`.

**From T002 — tooling:** ESLint 9 flat config, Prettier, Vitest with the `node` environment
for `server`, Supertest. `npm test`, `npm run lint`, `npm run typecheck` all work.

**From T004 — `@slydr/shared`.** Importable from `server/` as `@slydr/shared` (via
`shared/dist`). This ticket consumes only `HealthResponse`-style types indirectly; it needs
no shared symbol of its own beyond what T008 already imports.

**From T008 — server core.** The following exist and are consumed verbatim:

```ts
// server/src/config/env.ts
export interface ServerConfig {
  port: number;              // default 4317
  rootOverride: string | null;
  rootOverridden: boolean;   // true when SLYDR_ROOT was set
  cacheDir: string;
  cacheMaxMb: number;        // default 500
  quiet: boolean;            // SLYDR_QUIET
}
export function readServerConfig(env?: NodeJS.ProcessEnv): ServerConfig;

// server/src/app.ts
export function createApp(config: ServerConfig): Express;   // never calls listen

// server/src/middleware/errorEnvelope.ts
export class ApiError extends Error {          // `cause` is the inherited Error.cause
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, message?: string, cause?: unknown);
}
export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>>;
export interface ErrorLogEvent {
  err: unknown; method: string; url: string; code: ApiErrorCode; status: number;
}
export function createErrorEnvelope(log?: (event: ErrorLogEvent) => void): ErrorRequestHandler;
// T008's createApp(config) currently calls createErrorEnvelope() with the default stderr log.
```

T008 also established the information-leak rule that this ticket must preserve: no raw OS
error message, `errno`, `syscall` value or absolute path may appear in an API response
body. Logs are the opposite — NFR-10 explicitly permits absolute paths in logs, because
they are local operator context.

`server/src/index.ts` is either absent or a placeholder. This ticket writes it.

## 4. Implementation detail

### 4.1 `server/src/logger.ts`

A deliberately tiny structured logger. No dependency (`pino`, `winston`) is justified for a
local single-user tool, and NFR-9 forbids anything with outbound behaviour.

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  /** Short dot-separated event name, e.g. 'server.listening', 'fs.list.failed'. */
  event: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** When true, debug/info/warn are suppressed; error still writes. */
  quiet: boolean;
  /** Injected for tests. Defaults to process.stdout.write / process.stderr.write. */
  writeOut?: (line: string) => void;
  writeErr?: (line: string) => void;
  /** Injected for tests. Defaults to () => new Date().toISOString(). */
  now?: () => string;
}

export function createLogger(options: LoggerOptions): Logger;
```

Output format — **one line per event, newline-terminated, valid JSON** (NFR-10's
"structured single-line logs to stdout"):

```
{"ts":"2026-10-08T09:41:12.512Z","level":"info","event":"server.listening","port":4317,"url":"http://127.0.0.1:4317"}
```

Rules:

1. Key order is `ts`, `level`, `event`, then the caller's fields in insertion order. A
   caller field named `ts`, `level` or `event` must not be able to overwrite the reserved
   ones — build the object with the reserved keys last, or strip them from `fields`.
2. `debug`, `info` and `warn` write to **stdout**. `error` writes to **stderr**. Rationale:
   a wrapper script or a CI job can then separate operator noise from real failures with
   ordinary stream redirection.
3. **`quiet` suppresses `debug`, `info` and `warn` entirely. `error` is never
   suppressed.** This is the §13.2 contract for `SLYDR_QUIET` ("suppress non-error logs").
4. `debug` is additionally suppressed unless `SLYDR_DEBUG` is set. *Decision (not
   specified):* a debug level is useful for the per-request diagnostics that T010–T012 will
   want, and gating it behind its own variable keeps default output to a handful of lines.
   Read `SLYDR_DEBUG` in `createLogger`'s caller (i.e. `index.ts`) and pass it as part of
   `LoggerOptions`; add a `debugEnabled: boolean` field to `LoggerOptions` for that purpose.
5. Serialisation must never throw. Wrap `JSON.stringify` in a `try/catch`; on failure (a
   circular structure, a `BigInt`) emit a minimal fallback line
   `{"ts":...,"level":...,"event":...,"serializationError":true}`.
6. Provide a helper that turns an unknown thrown value into log-safe fields:

   ```ts
   export function errorFields(err: unknown): Record<string, unknown>;
   ```

   It returns `{ errName, errMessage, errCode, errErrno, errSyscall, errPath, stack }`,
   omitting absent properties. **This helper is for logs only.** Its output must never be
   spread into a response body; add that warning as a comment on the function.

#### Wiring the logger into the error envelope

T008's `createApp(config)` builds its handler with `createErrorEnvelope()` (default stderr
log). *Decision (not specified):* extend `createApp` to accept an optional second argument:

```ts
export function createApp(config: ServerConfig, logger?: Logger): Express;
```

defaulting to a logger built from `config.quiet`, and have it call
`createErrorEnvelope((event) => { ... })` where the callback logs through `logger`. This keeps
T008's single-argument call sites and tests working, lets `index.ts` share one logger instance
with the request path, and avoids module-level mutable state. Update T008's `app.ts`
accordingly as part of this ticket and note the change in the file's header comment.

The callback receives T008's `ErrorLogEvent` (`err`, `method`, `url`, `code`, `status`) and
logs `errorFields(event.err)` plus `method`, `url` (path and query only), `code` and
`status`. A `4xx` caused by bad client input is noisy at `error`
level, so: *Decision (not specified):* log `status >= 500` at `error` and `status < 500` at
`warn`. A traversal attempt is therefore visible in default output as a single `warn` line,
which is what NFR-7's security posture wants, while a cache-miss 404 does not pollute
stderr.

### 4.2 `server/src/bootstrap/resolveRoot.ts`

```ts
export interface ResolvedRoot {
  /** The realpath'd, absolute jail root. */
  absolute: string;
  /** True when it came from SLYDR_ROOT rather than os.homedir(). */
  overridden: boolean;
}

export class RootResolutionError extends Error {
  readonly reason: 'missing' | 'not-a-directory' | 'unreadable' | 'realpath-failed';
}

export async function resolveJailRoot(
  config: ServerConfig,
  deps?: { homedir?: () => string },
): Promise<ResolvedRoot>;
```

Algorithm, in order:

1. Choose the candidate: `config.rootOverride` when non-null, otherwise
   `deps.homedir?.() ?? os.homedir()`. Inject `homedir` so tests can exercise the
   non-override branch without depending on the machine's real home directory.
2. `path.resolve` the candidate to an absolute path. A relative `SLYDR_ROOT` is resolved
   against `process.cwd()`. *Decision (not specified):* accepting a relative `SLYDR_ROOT` is
   convenient for test harnesses; it is resolved once here and never again, so no ambiguity
   leaks into request handling.
3. `await fs.realpath.native(candidate)`. Specification §3.1 requires the root be resolved
   through `realpath` once at startup and cached; use the **native** variant, because on
   Windows only it returns canonical casing and expands `8.3` short names (verified: the JS
   `fs.realpath('c:/users/peterkin/documents')` returns the path in the casing it was given,
   `realpath.native` returns `C:\Users\PeterKin\Documents`). T010 resolves request targets
   with the same function so both sides of the containment check are canonical. Map failures:
   - `ENOENT` or `ENOTDIR` → `RootResolutionError` with reason `missing`.
   - `EACCES` or `EPERM` → reason `unreadable`.
   - anything else → reason `realpath-failed`.
4. `await fs.stat(real)` and require `stats.isDirectory()`. Otherwise reason
   `not-a-directory`.
5. Prove readability with `await fs.access(real, fs.constants.R_OK)`, and additionally
   `await fs.readdir(real)` — *Decision (not specified):* `access` with `R_OK` is unreliable
   on Windows, where the ACL model is not represented by POSIX mode bits and `access` can
   report success for a directory the process cannot enumerate. A single `readdir` at
   startup is cheap and is the only check that actually proves the server can do its job.
   Discard the result. On `EACCES`/`EPERM` → reason `unreadable`.
6. Return `{ absolute: real, overridden: config.rootOverridden }`.

On Windows, `fs.realpath.native` normalises the drive letter's case and resolves `8.3` short
names and junctions, which is precisely why it must run before anything is cached. Note that
a realpath result has no trailing separator, except for a volume root such as `C:\`, which
keeps it. T010's containment check handles both.

### 4.3 The `SLYDR_ROOT` warning

When `config.rootOverridden` is true, emit a prominent warning immediately after resolution
and **before** the listener starts, so it appears above the readiness line:

```
{"ts":"…","level":"warn","event":"root.overridden","root":"C:\\tmp\\slydr-fixture","message":"SLYDR_ROOT is set. This is a TEST-ONLY override of the home-directory jail root. The server will serve files from this directory instead of your home folder."}
```

Specification §3.1 requires this warning and requires that `SLYDR_ROOT` not be presented as
a user feature in the README quick start. *Decision (not specified):* also write the same
warning as a plain human-readable banner line to stderr, framed with a row of `!`
characters, because a single JSON line scrolls past unnoticed and this override disables the
application's main safety boundary. The banner is exempt from `SLYDR_QUIET` since silencing
a security-relevant warning is never the intent of a quiet flag.

### 4.4 `server/src/bootstrap/listen.ts`

```ts
export interface ListenResult {
  server: import('node:http').Server;
  port: number;
  /** Every port that was attempted, in order. */
  attempted: number[];
}

export class PortUnavailableError extends Error {
  readonly attempted: number[];
}

export async function listenWithPortSelection(
  app: import('express').Express,
  options: { host: string; startPort: number; maxAttempts?: number },
): Promise<ListenResult>;
```

Algorithm:

1. `const host = '127.0.0.1'`. **Never `0.0.0.0`, never `::`, never the default (which
   binds all interfaces).** Specification §3.4: "Bind the HTTP listener to `127.0.0.1` only."
   Pass the host explicitly to `server.listen(port, host)`. Hard-code the constant in
   `index.ts` as `export const BIND_HOST = '127.0.0.1';` and do not make it configurable —
   an environment variable that could widen the bind is exactly the kind of foot-gun §1.2
   rules out.
2. Attempt ports `startPort`, `startPort + 1`, … `startPort + 9` — ten attempts total,
   matching §13.2's "If busy, try `+1` up to `+9`". `maxAttempts` defaults to `10` and
   exists only so tests can shorten the loop.
3. For each attempt, wrap `server.listen` in a promise that resolves on the `listening`
   event and rejects on the `error` event. On rejection:
   - `err.code === 'EADDRINUSE'` → remove the listeners, close the half-constructed server,
     and continue to the next port.
   - `err.code === 'EACCES'` → *Decision (not specified):* treat as fatal rather than
     retrying. A privileged-port refusal will recur for every port in the range, and
     retrying ten times produces ten identical failures and a misleading message.
   - any other code → fatal.
   Attach the `error` and `listening` handlers with `once` and detach the loser before the
   next iteration, or a stale `error` handler from attempt *n* will reject attempt *n+1*'s
   promise.
4. Skip any attempted port above `65535` (relevant only when `PORT` is set near the top of
   the range).
5. When every attempt yields `EADDRINUSE`, throw `PortUnavailableError` whose message
   **names every port tried**, for example:

   ```
   Could not bind to 127.0.0.1: ports 4317, 4318, 4319, 4320, 4321, 4322, 4323, 4324, 4325, 4326 are all in use. Set PORT to choose a different starting port.
   ```

   `index.ts` logs this at `error`, writes the same sentence to stderr in plain text, and
   exits with code `1`.

### 4.5 `server/src/index.ts`

```ts
export const BIND_HOST = '127.0.0.1';
export async function main(): Promise<void>;
```

Sequence:

1. `const config = readServerConfig();`
2. `const logger = createLogger({ quiet: config.quiet, debugEnabled: !!process.env.SLYDR_DEBUG });`
3. `logger.info('server.starting', { pid: process.pid, node: process.version, platform: process.platform });`
4. Resolve the jail root with `resolveJailRoot(config)`. On `RootResolutionError`: write a
   clear, human-readable message to stderr naming the directory and the reason, log the
   structured event, and `process.exit(1)`. Required by §3.1 ("The server refuses to start
   if the jail root does not exist or is not a readable directory"). Message wording per
   reason:
   - `missing` → `Jail root does not exist: <path>. Set SLYDR_ROOT to an existing directory, or check your home directory.`
   - `not-a-directory` → `Jail root is not a directory: <path>.`
   - `unreadable` → `Jail root is not readable: <path>. Check the directory's permissions.`
   - `realpath-failed` → `Could not resolve the jail root: <path>.`
   These messages go to **stderr and the log only** — they are not API responses, so the
   absolute path is permitted and desirable (NFR-10).
5. When `config.rootOverridden`, emit the warning and banner of §4.3.
6. Initialise the path-jail module with the resolved root. T010 owns
   `server/src/security/jail.ts` and will export an initialiser; this ticket must call it so
   that the jail root is set once, at startup, and cached. Until T010 lands, call a
   placeholder with the signature T010 will provide:
   `setJailRoot(resolvedRoot.absolute): void`. Create the stub file with just that function
   and its module-level cache if it does not yet exist, and leave a comment naming T010 as
   the owner of the rest. *Decision (not specified):* passing the root in from the bootstrap
   rather than having `jail.ts` read the environment itself keeps a single resolution point
   and makes T010's unit tests trivially able to point the jail at a temporary fixture tree.
7. `const app = createApp(config, logger);`
8. `const { server, port } = await listenWithPortSelection(app, { host: BIND_HOST, startPort: config.port });`
   On `PortUnavailableError`, log and exit `1` as described in §4.4.
9. Emit exactly one readiness line:

   ```
   {"ts":"…","level":"info","event":"server.listening","host":"127.0.0.1","port":4317,"url":"http://127.0.0.1:4317","root":"C:\\Users\\PeterKin","rootOverridden":false}
   ```

   Build `url` with `new URL('http://127.0.0.1')` and set `.port`/read `.origin` rather than a
   template literal: the T002 lint guard (no separators next to interpolations in
   `server/src`) rejects `` `http://${BIND_HOST}:${port}` ``. `port` is the port the
   listener actually got (`server.address()`), which matters when `PORT=0` or a fallback
   port was used.

   Do **not** print a friendly "open your browser at …" banner and do not open a browser —
   that is T039's job (§2.2, `npm start`). Printing it here would mean two competing
   banners once T039 lands.
10. Configure timeouts. *Decision (not specified):* set `server.keepAliveTimeout = 65_000`
    and `server.headersTimeout = 66_000`. Defaults are fine for loopback use, but the grid
    view holds many concurrent thumbnail connections open and an explicit, generous
    keep-alive avoids surprising mid-scroll socket resets. Leave `server.timeout` at `0`:
    a large original image on a slow spinning disk must not be cut off.
11. Install shutdown handling (§4.6).
12. Install last-resort handlers:
    - `process.on('uncaughtException', …)` → log at `error` with `errorFields`, then force
      shutdown and exit `1`.
    - `process.on('unhandledRejection', …)` → same. NFR-5 says the app must never crash on
      unreadable or vanished files; these handlers are the backstop that turns a missed
      `await` into a logged line rather than a silent Node 22 process abort (unhandled
      rejections are fatal by default since Node 15).

Guard the invocation so the module is importable by tests without starting a server:

```ts
function sameFile(a: string, b: string): boolean {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && sameFile(process.argv[1], fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await main();
}
```

*Decision (not specified):* comparing canonical file paths (`realpath.native` on both sides)
rather than comparing `import.meta.url` to `pathToFileURL(process.argv[1]).href` avoids
Windows URL-escaping and drive-letter-case differences (`%20` in `C:\Users\Peter Kin`,
`c:` vs `C:`) that make the naive comparison silently false.

### 4.6 Graceful shutdown

```ts
export function installShutdown(server: Server, logger: Logger): void;  // exported for tests
```

1. Handle `SIGINT` and `SIGTERM`. On the first signal: log
   `logger.info('server.stopping', { signal })`, stop accepting new connections with
   `server.close()`, and call `server.closeIdleConnections()` (Node 18.2+) so keep-alive
   sockets do not hold the process open for the full keep-alive window.
2. Start a forced-exit timer of **5000 ms**. *Decision (not specified):* five seconds is
   long enough for an in-flight `sendFile` of a large original to finish and short enough
   that `Ctrl+C` feels instant. Call `timer.unref()` so the timer itself never keeps the
   loop alive.
3. When `server.close` completes, log `server.stopped` and `process.exit(0)`.
4. When the timer fires first, log `server.stopForced` at `warn`, call
   `server.closeAllConnections()`, and `process.exit(0)`.
5. A second signal while shutting down exits immediately with code `130` for `SIGINT`
   (128 + 2) and `143` for `SIGTERM` (128 + 15).
6. Make the handler idempotent with a module-local `shuttingDown` boolean.

**Windows note:** `SIGTERM` is not a real signal on Windows; Node synthesises `SIGINT`
from `Ctrl+C` and raises `SIGBREAK` for `Ctrl+Break`, while a `taskkill /F` cannot be
trapped at all. Register a `SIGBREAK` handler as well so `Ctrl+Break` also shuts down
cleanly, and do not write tests that assert on `SIGTERM` delivery on `win32` — send
`SIGINT` there, or skip the signal assertion with a documented `it.skipIf(process.platform === 'win32')`.

### 4.7 Cross-platform notes

| Concern | win32 | darwin | linux |
|---|---|---|---|
| Default jail root | `C:\Users\<name>`, `realpath.native` normalises drive-letter case and short names | `/Users/<name>` | `/home/<name>` |
| `fs.access(R_OK)` fidelity | unreliable (ACLs not reflected in mode bits) — hence the extra `readdir` probe | reliable | reliable |
| `SIGTERM` | synthesised only; `SIGBREAK` exists | real | real |
| `EADDRINUSE` on a loopback bind | raised as expected | raised as expected; note `SO_REUSEADDR` differences do not apply to Node's default | raised as expected |
| Binding `127.0.0.1` while something listens on `0.0.0.0:<port>` | raises `EADDRINUSE` | raises `EADDRINUSE` | raises `EADDRINUSE` |
| `process.exit` code for an untrapped `Ctrl+C` | 3221225786 if not handled; handled here, so always our own code | 130 | 130 |

## 5. Acceptance criteria

- [ ] `server/src/index.ts` exists, exports `main` and `BIND_HOST`, and starts the server
      only when invoked as the process entry point.
- [ ] `BIND_HOST === '127.0.0.1'`, and a repository-wide grep for `0.0.0.0` and for a bare
      `listen(` with no host argument returns no hits in `server/src`.
- [ ] `node --import tsx server/src/index.ts` (the same `tsx` the dev script uses; Node's
      `--experimental-strip-types` cannot resolve the `./x.js` specifiers the repo uses)
      prints exactly one `server.listening` JSON line on stdout and then
      serves `GET /api/health` with `200 { status: 'ok', version }`.
- [ ] Starting with `SLYDR_ROOT` pointing at a nonexistent directory exits with a non-zero
      code and prints a message naming that directory and the reason.
- [ ] Starting with `SLYDR_ROOT` pointing at a *file* exits non-zero with the
      `not-a-directory` message.
- [ ] Starting with `SLYDR_ROOT` set to a valid directory emits a `root.overridden` warning
      containing the word `TEST-ONLY`, before the `server.listening` line.
- [ ] With a listener already occupying the start port, the server binds `start + 1` and
      the `server.listening` line reports the port it actually got.
- [ ] With all ten ports occupied, the process exits non-zero and the message contains all
      ten port numbers.
- [ ] `SLYDR_QUIET=1` suppresses every `debug`/`info`/`warn` line on stdout while an
      `error`-level line still reaches stderr.
- [ ] Every log line written by `createLogger` parses as JSON and contains `ts`, `level` and
      `event`.
- [ ] A `SIGINT` (or `SIGBREAK` on Windows) to a running server produces a `server.stopping`
      line followed by `server.stopped` and exit code `0` within 5 s.
- [ ] `createApp(config, logger)` is the only place the logger is injected into the request
      path; `createErrorEnvelope` holds no module-level mutable logger.
- [ ] `index.ts` contains a comment naming **T039** at the point where static hosting of
      `client/dist` and browser auto-open will be inserted, and contains no `express.static`
      call and no browser-opening code.

## 6. Tests to write

Per specification §12.1. All tests run in the Vitest `node` environment from T002.

**`server/test/logger.test.ts`**

- `writes one JSON line per event with ts, level and event` — inject `writeOut` and `now`,
  assert the line ends with `\n` and `JSON.parse` round-trips.
- `reserved keys cannot be overwritten by caller fields` — pass
  `{ level: 'bogus', event: 'bogus', ts: 'bogus' }` and assert the reserved values win.
- `info, warn and debug go to stdout; error goes to stderr`.
- `quiet suppresses debug, info and warn but never error`.
- `debug is suppressed unless debugEnabled`.
- `serialisation failure emits the fallback line` — pass a circular object.
- `errorFields extracts code, errno, syscall, path and stack from an ENOENT-shaped error`
  and `errorFields tolerates a thrown string, number, null and undefined`.

**`server/test/bootstrap/resolveRoot.test.ts`** — build fixtures with
`fs.mkdtemp(path.join(os.tmpdir(), 'slydr-root-'))` in `beforeAll` and remove them with
`fs.rm(dir, { recursive: true, force: true })` in `afterAll`.

- `resolves an existing directory and returns its realpath`.
- `returns overridden: true when SLYDR_ROOT was set` and
  `returns overridden: false and uses the injected homedir otherwise`.
- `throws RootResolutionError with reason 'missing' for a nonexistent path`.
- `throws reason 'not-a-directory' when the path is a file`.
- `resolves a relative SLYDR_ROOT against cwd`.
- `follows a symlinked root to its target` — create a symlink to the fixture directory and
  assert the returned path is the target, not the link. **Symlink creation can require
  elevation or Developer Mode on Windows**: wrap the creation in `try/catch` and skip the
  case with `ctx.skip()` on `EPERM`, so CI's Windows leg reports a skip rather than a
  failure.
- `throws reason 'unreadable' when the directory cannot be enumerated` — POSIX only
  (`fs.chmod(dir, 0o000)`); skip on `win32` with a documented `it.skipIf`, because `chmod`
  is a no-op there.

**`server/test/bootstrap/listen.test.ts`**

- `binds the requested port when free` — assert `server.address()` reports
  `address === '127.0.0.1'` and the expected port, then close.
- `falls back to the next port on EADDRINUSE` — occupy port *p* with a plain
  `http.createServer().listen(p, '127.0.0.1')` first, then assert the app lands on `p + 1`
  and `attempted` is `[p, p + 1]`.
- `tries exactly ten ports and then throws PortUnavailableError` — use `maxAttempts: 3` for
  speed, occupy all three, and assert the error's `attempted` array and that its message
  contains every attempted port number as a substring.
- `does not retry on a non-EADDRINUSE error` — stub `listen` to emit an `EACCES` error and
  assert exactly one attempt.
- `never binds a non-loopback address` — assert `server.address().address` is `127.0.0.1`
  and not `0.0.0.0` or `::`.
- `picks an ephemeral port when startPort is 0` — *Decision (not specified):* support
  `startPort === 0` (reachable via `PORT=0`, T008) so integration tests need not hunt for a
  free port; assert the resulting port is non-zero and that `attempted` is `[0]`.

**`server/test/index.integration.test.ts`** — one end-to-end boot of the real entry point.

- `boots on an ephemeral port against a fixture root and answers /api/health` — spawn
  `process.execPath` with args `['--import', 'tsx', 'server/src/index.ts']` (no shell, no
  `.cmd` shim; works identically on every OS) and env `{ PORT: '0', SLYDR_ROOT: fixtureDir }`
  (T008 accepts `PORT=0` as "OS-assigned"), parse stdout lines as JSON until the
  `server.listening` event arrives (its `port` is the real one), `fetch`
  `http://127.0.0.1:<port>/api/health`, assert the body. Then on POSIX send `SIGINT` and
  assert exit code `0` with `server.stopping` and `server.stopped` lines. **On Windows
  `child.kill('SIGINT')` terminates the process outright instead of running the handler**, so
  on `win32` just `child.kill()` after the health check and do not assert the exit code;
  graceful shutdown is covered cross-platform by the unit test below. Give the test a
  generous timeout (20 s) because a cold `tsx` start on Windows CI is slow.
- `installShutdown stops the server and exits 0` (unit, all platforms) — call
  `installShutdown` with a fake server object (`close`, `closeIdleConnections`,
  `closeAllConnections`), spy on `process.exit`, emit `process.emit('SIGINT')`, and assert
  `close` was called, `server.stopping` was logged, and `exit(0)` follows; a second emit
  exits with 130 immediately; the 5 s forced-exit timer path is covered with fake timers.
- `exits non-zero with a clear message when SLYDR_ROOT does not exist` — assert the exit
  code and that stderr mentions the directory.
- `logs the TEST-ONLY warning before the listening line when SLYDR_ROOT is set` — assert on
  line order, not just presence.
- `SLYDR_QUIET=1 produces no stdout lines` while the health endpoint still answers. The
  readiness line is suppressed, so the test reserves a free port itself (listen on port `0`
  with a throwaway `net` server, read the port, close it), passes it as `PORT`, and polls
  `/api/health` until it answers or 20 s pass.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on Windows, macOS and Linux.
- [ ] Windows-only and POSIX-only test cases skip cleanly on the other platforms rather
      than failing; the CI log shows skips, not errors.
- [ ] A grep of `server/src` finds no `console.log`, `console.info` or `console.warn` — all
      output goes through `createLogger`.
- [ ] A grep of `server/src` finds no `0.0.0.0` and no host-less `listen`.
- [ ] `index.ts` carries the T039 insertion-point comment and no static-hosting or
      browser-opening code.
- [ ] README: no change in this ticket (T041 creates the README). T041's configuration table
      must list `PORT`, `SLYDR_CACHE_DIR`, `SLYDR_CACHE_MAX_MB` and `SLYDR_QUIET`, and must
      **not** present `SLYDR_ROOT` as a user feature in the quick start (§3.1).

## 8. Notes and gotchas

- **The bind address is a security control, not a setting.** A future "make the host
  configurable so I can test from my phone" request must be refused or escalated to a spec
  change: §1.2 puts remote use out of scope and §3.4 mandates `127.0.0.1`. Leave a comment
  on `BIND_HOST` saying so.
- **Logs may contain absolute paths; API responses may not** (NFR-10, §3.4). The two rules
  pull in opposite directions and the only place they meet is the error envelope. `errorFields`
  exists to make the log side easy; the envelope's fixed message table makes the response
  side safe. Never hand `errorFields` output to `res.json`.
- **Startup budget.** NFR-8 requires startup to an interactive explorer in under two
  seconds on a warm cache. The only startup I/O in this ticket is one `realpath`, one `stat`,
  one `access` and one `readdir` on the home directory. Do not add anything else — in
  particular, do not walk the tree, do not pre-warm a listing, and do not sweep the
  thumbnail cache here (that sweep is owned by the E8 thumbnail ticket and must be
  scheduled *after* the listener is up, never before it).
- **`server.closeIdleConnections` and `closeAllConnections`** require Node 18.2+. The
  project's floor is Node 22, so they are safe, but they are easy to forget: without them
  `server.close()` waits for every keep-alive socket and `Ctrl+C` appears to hang for the
  full keep-alive timeout.
- **Stale `error` listeners during the port loop** are the classic bug in a retry-on-bind
  implementation. Create a fresh `http.Server` per attempt, or meticulously
  `removeAllListeners('error')` before reusing one. Creating a fresh server per attempt via
  `http.createServer(app)` is clearer and is the recommended approach.
- **Port 4317 is an arbitrary pick** (§16.2 item 1). The retry range `4317–4326` is what
  makes that arbitrariness tolerable; keep the failure message instructive so a user whose
  machine has a conflict can set `PORT` without reading the source.
- **`tsx watch` restarts** will re-run the whole bootstrap, including the `EADDRINUSE`
  loop. If a restart is faster than the old listener's teardown, the dev server will
  silently move to `4318` and the Vite proxy (configured against `4317` by the client
  tickets) will break. Mitigation: the shutdown path above closes idle connections promptly,
  and the `server.listening` line always reports the real port so the cause is visible in the
  terminal. Mention this in the README's troubleshooting note.
- **Do not add `helmet`.** T008 already sets the exact headers §3.4 names; `helmet` would
  add headers the specification does not call for and would have to be audited against the
  verbatim CSP string.
