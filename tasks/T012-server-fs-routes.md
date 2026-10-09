# T012 — Expose `GET /api/fs/root` and `GET /api/fs/list`

**Epic:** E5 — Listing API
**Spec sections:** §5.2, §5.3, §3.2, §3.5, §12.2, NFR-5, NFR-7
**Depends on:** T011
**Estimated size:** M

---

## 1. Context

Slydr's first screen is a file explorer that opens at the user's home folder and lets the
user walk down the folder tree. That screen needs exactly two HTTP endpoints:
`GET /api/fs/root`, which says where the explorer starts and what to call it, and
`GET /api/fs/list`, which returns the classified, sorted, hidden-filtered contents of one
folder together with the metadata the UI needs (parent path, counts, truncation flag).

The hard work already exists as a service: `listDirectory` in
`server/src/services/listing.ts` (T011) reads, classifies, filters, sorts, tallies and
truncates a directory. This ticket adds the thin HTTP layer on top of it in
`server/src/routes/fs.ts`: query-parameter validation, safe path resolution through
`resolveSafe`, response assembly in the exact shape of specification §5.2 and §5.3, error
mapping onto the project's error envelope, and mounting the router in the app factory. It
also delivers the first Supertest suite of the project that exercises a real fixture tree
through the full middleware stack.

## 2. Scope

### In scope

- Create `server/src/routes/fs.ts` exporting the router factory
  `createFsRouter({ logger }: { logger: Logger }): Router` (the "fs router") with two
  handlers: `GET /root` and `GET /list`. There is no module-level router and no singleton:
  the logger is injected by `createApp`.
- Mount the router in `createApp` (`server/src/app.ts`) at `/api/fs`.
- `GET /api/fs/root` response: `{ path: "", name, absoluteRoot, platform }`.
- `GET /api/fs/list` query validation for `path` and `showHidden`, including the handling
  of repeated / array-valued / object-valued query parameters.
- Response assembly for `/list`: `path`, `name`, `parentPath`, `entries`, `counts`,
  `truncated`.
- Complete error mapping for both endpoints.
- Small shared parameter-parsing helpers in the routes module, written so that T014
  (`/api/fs/images`) can reuse them verbatim.
- The shared route-test harness `server/test/helpers/testApp.ts` (`createTestEnv`), reused
  by T014, T015 and T017.
- A Supertest suite (`server/test/routes/fs.test.ts`) against a fixture tree built through
  that harness, per specification §12.2.

### Out of scope

- Reading, classifying, sorting, filtering, counting and truncating directory entries —
  **T011** owns `server/src/services/listing.ts`. This ticket calls `listDirectory` and must
  not re-sort, re-filter or re-count its output.
- `resolveSafe`, `toWirePath`, `assertDirectory` and the cached jail root — **T010**.
- The app factory logic, the `405` method guard, the `403 FORBIDDEN_HOST` check and the error
  envelope — delivered by T008/T009; consumed unchanged (this ticket only adds the one mount
  line to `createApp`).
- `GET /api/fs/images` — **T014** adds that handler to the same router later.
- `GET /api/image` (T015) and `GET /api/thumb` (T016, T017).
- The explorer UI that consumes these endpoints (epics E10–E13).
- The repository-wide fixture-tree generator script — **T037**. This ticket builds its own
  small temporary fixture through `createTestEnv` and must not wait for, or pre-empt, T037.

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** with three packages: `shared/`, `server/`
and `client/`. Everything is **ESM** (`"type": "module"`), TypeScript is **strict**, the
engine requirement is **Node >= 22**, the server uses **Express 5**, and **Vitest +
Supertest** are configured and runnable through `npm test`. Follow the import-extension
convention already used in `server/src`.

### `@slydr/shared` (implemented)

Exports `FsEntry`, `ImageItem`, the endpoint response types, `ApiErrorCode`,
`IMAGE_EXTENSIONS`, `isImageExtension`, `MAX_ENTRIES = 10000`, and pure POSIX wire-path
helpers. The response types relevant here:

```ts
export interface RootResponse {
  path: string;          // always ""
  name: string;          // basename of the jail root
  absoluteRoot: string;  // display-only
  platform: string;      // process.platform
}

export interface ListResponse {
  path: string;
  name: string;
  parentPath: string | null;
  entries: FsEntry[];
  counts: { folders: number; images: number; files: number };
  truncated: boolean;
}
```

Use these as the handlers' response types. If `RootResponse` or `ListResponse` is missing or
has a different shape, correct it in `shared/src/types.ts` as part of this ticket — do not
declare a duplicate in `server/`.

The wire-path helpers include `normalizeWirePath(p: string): string` (drops empty and `.`
segments, no leading/trailing slash), `wireParent(p: string): string | null`,
`wireBasename(p: string): string`, `wireJoin(dir: string, name: string): string` and
`wireSegments(p: string): string[]`. They are pure, lexical and never touch disk.

### `server/src/app.ts` (implemented — T008, T009)

An **app factory** `createApp(config: ServerConfig, logger?: Logger): Express` that returns an
Express application and never calls `listen`. (`ServerConfig` and `readServerConfig` live in
`server/src/config/env.ts`, T008; `Logger` is T009's `server/src/logger.ts`: `debug|info|warn|error(event, fields?)`.
Without a second argument `createApp` builds a logger from `config.quiet`.) It already
installs, before any router:

- the `405 METHOD_NOT_ALLOWED` guard for any method other than `GET` or `HEAD`;
- the `403 FORBIDDEN_HOST` check (`Host` must be `localhost`, `127.0.0.1` or `[::1]` with an
  optional port);
- the error-handling middleware that renders every failure as
  `{ "error": { "code": "...", "message": "..." } }`, never leaking an `errno`, a raw OS
  message or an absolute path;
- the typed `ApiError` class:

```ts
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;     // derived from code via the §3.5 table
  // `cause` is the inherited Error.cause (do not redeclare it as a field)
  constructor(code: ApiErrorCode, message?: string, cause?: unknown);
}
```

The status is derived from the code (`INVALID_PARAM` 400, `INVALID_PATH` 400,
`OUTSIDE_ROOT` 403, `NOT_FOUND` 404, `NOT_A_DIRECTORY` 400, `ACCESS_DENIED` 403,
`READ_FAILED` 500, and so on). Do not pass a status explicitly. Express 5 forwards rejected
promises from `async` handlers to the error middleware, so handlers simply `throw`.

### `server/src/config/env.ts` and `server/test/helpers/testConfig.ts` (implemented — T008)

`readServerConfig(env): ServerConfig` returns `{ port, rootOverride, rootOverridden, cacheDir,
cacheMaxMb, quiet }`. Tests never touch environment variables: `makeTestConfig(overrides?)`
(`server/test/helpers/testConfig.ts`) builds a `ServerConfig`, and the jail root is set with
`setJailRoot` (T010). `SLYDR_ROOT` is only read by the bootstrap (T009) and is not used by any
test in this ticket.

### Test helpers (implemented — T011)

`server/test/helpers/fs.ts` exports `makeTempBase(prefix)` (mkdtemp + `fs.realpath.native`),
`trySymlink(target, link, type): Promise<boolean>` and `removeTree(dir)`;
`server/test/helpers/logger.ts` exports `createTestLogger(): { logger: Logger; events }`.

### `server/src/security/jail.ts` (implemented — T010)

```ts
export function setJailRoot(absolute: string): void;
export function getJailRoot(): string;               // cached, realpath'd root
export function resetJailRootForTests(): void;
export function resolveSafe(relPath: string): Promise<string>;
export function toWirePath(absPath: string): string; // root -> "", otherwise POSIX relative
export function assertDirectory(absPath: string): Promise<import('node:fs').Stats>;
export function assertFile(absPath: string): Promise<import('node:fs').Stats>;
export function mapFsError(err: unknown): ApiError;
```

`resolveSafe` implements specification §3.3: NUL byte or more than 4096 characters, leading
`/`, `^[A-Za-z]:`, `^\\\\` (UNC) → `400 INVALID_PATH`, and **on Windows only** any backslash →
`400 INVALID_PATH` (on POSIX a backslash is an ordinary filename character); any `..` segment →
`403 OUTSIDE_ROOT`; `fs.realpath.native` failure `ENOENT`/`ENOTDIR` → `404 NOT_FOUND`; real
path not equal to the real jail root and not under it plus `path.sep` → `403 OUTSIDE_ROOT`.
It throws `ApiError` and returns the verified absolute path. It follows symlinks and
junctions: a symlinked folder whose real target is inside the jail resolves normally. `assertDirectory` throws
`400 NOT_A_DIRECTORY` for a non-directory. **Every file-system access must go through
`resolveSafe`; concatenating user input into a path anywhere else is a defect.**

### `server/src/services/listing.ts` (implemented — T011)

```ts
export interface ListOptions {
  showHidden: boolean;
  wireDir: string;   // wire path of the directory being listed ("" for the root), as navigated
  logger?: Logger;   // T009 Logger
}
export interface ListingCounts { folders: number; images: number; files: number }
export interface ListingResult {
  entries: FsEntry[];       // post-filter, sorted per §4.2, at most MAX_ENTRIES
  counts: ListingCounts;    // computed over the full post-filter set, before truncation
  truncated: boolean;       // post-filter count > MAX_ENTRIES
}
export async function listDirectory(absDir: string, options: ListOptions): Promise<ListingResult>;
```

`listDirectory` throws `ApiError` itself for a failure on the directory (`ACCESS_DENIED`
for `EACCES`/`EPERM`, `NOT_FOUND`, `READ_FAILED`). Per-entry failures never surface. The
caller supplies `wireDir` and must pass an `absDir` that came from `resolveSafe`.

## 4. Implementation detail

### 4.1 Files

| Action | Path |
|---|---|
| Create | `server/src/routes/fs.ts` |
| Modify | `server/src/app.ts` (mount the router factory) |
| Create | `server/test/helpers/testApp.ts` (shared route-test harness, §6) |
| Create | `server/test/routes/fs.test.ts` |
| Modify (only if missing/wrong) | `shared/src/types.ts` (`RootResponse`, `ListResponse`) |

`server/src/routes/fs.ts` must be structured so T014 can add `router.get('/images', ...)`
inside the same factory without touching the `/root` or `/list` code: export
`createFsRouter({ logger })` and keep the parameter helpers (§4.2) as **exported**
module-level functions (`readStringParam`, `readBooleanParam`) that T014 reuses. The factory
deps are `{ logger: Logger; listDirectory?: typeof listDirectory }`; the optional
`listDirectory` is a documented test seam (default: the real service) used by test 19 to
prove `truncated` and `counts` are forwarded unchanged.

### 4.2 Parameter helpers

Two small, pure helpers live at module scope in `routes/fs.ts` and are **exported** (T014
imports them for `recursive`/`showHidden`). Both throw `ApiError('INVALID_PARAM', message)`
with a generic message that contains no OS detail.

```ts
/**
 * Returns the single string value of a query parameter, or `fallback` when it is absent.
 * Anything that is not undefined and not a string (an array from a repeated parameter,
 * an object from `?path[x]=y`) is rejected rather than coerced.
 */
export function readStringParam(value: unknown, name: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAM', `Query parameter "${name}" must be a single value.`);
  }
  return value;
}

/** Strictly "true" or "false" (case-sensitive); absent means false. */
export function readBooleanParam(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ApiError('INVALID_PARAM', `Query parameter "${name}" must be "true" or "false".`);
}
```

Rules, stated explicitly because the tests pin them:

- **`path`** — absent means `""` (the jail root). An empty string is also valid and means
  the root. The value is passed to `resolveSafe` untouched: NUL, length, absolute-path and
  `..` rules belong to `resolveSafe` and must not be duplicated in the route.
- **`showHidden`** — absent means `false`. Otherwise it must be exactly `"true"` or exactly
  `"false"`. Every other value — `"1"`, `"0"`, `"TRUE"`, `"True"`, `"yes"`, `""` — is
  `400 INVALID_PARAM`. The empty string (`?showHidden=`) is rejected, not treated as absent,
  because it is a present-but-invalid value.
- **Repeated or array-valued parameters.** Express 5's default query parser (the "simple"
  parser backed by `node:querystring`) delivers `?path=a&path=b` as the array
  `['a', 'b']`, and, depending on the configured parser, `?path[x]=y` as an object.
  **Decision (not specified):** a repeated or non-string `path` or `showHidden` is rejected
  with `400 INVALID_PARAM`; it is never coerced with `String(...)`, never "first wins" and
  never "last wins". Rationale: `String(['a','b'])` is `"a,b"`, which `resolveSafe` would
  accept as a real relative path naming a folder the caller did not ask for, and silently
  picking either value would hide a client bug. The specification does not address repeated
  parameters, and a strict `400` is the only choice that cannot be mistaken for success.
- **Validation order. Decision (not specified):** all query parameters are validated before
  any file-system access, in the order `path` (type), then `showHidden`. A request with a
  bad `showHidden` and a non-existent `path` therefore returns `400 INVALID_PARAM`, not
  `404`. This keeps the cheap check ahead of the expensive one and makes the tests
  order-independent. Pin it with a test.
- **Unknown parameters** (`?foo=1`) are ignored. **Decision (not specified):** strictness
  about unknown keys would make the endpoint brittle against harmless cache-busting
  parameters from the client.

Add a comment at each Decision site in the code.

### 4.3 `GET /api/fs/root`

Specification §5.2:

```json
{
  "path": "",
  "name": "PeterKin",
  "absoluteRoot": "C:\\Users\\PeterKin",
  "platform": "win32"
}
```

Algorithm (synchronous apart from reading the cached root):

1. `const root = getJailRoot();` — the real, cached, absolute jail root. There is no file
   system access and no `resolveSafe` call here: the value is the root itself, not
   derived from client input.
2. `path: ""` — a literal. The wire path of the root is always the empty string.
3. `name: path.basename(root)`. **Decision (not specified):** when `path.basename(root)`
   is empty — the jail root is a volume root such as `/` or `C:\` (only reachable by
   pointing the jail at a volume root, e.g. in a unit test) — return `root` itself (`"/"` or `"C:\\"`) so the breadcrumb's
   "Home" segment label is never blank.
4. `absoluteRoot: root` — the real absolute path in the platform's native form (backslashes
   on Windows). **It is display-only (tooltip / breadcrumb root label) and must never be fed
   back into any request.** If the client sent it back as `path`, `resolveSafe` would reject
   it as `400 INVALID_PATH` (drive letter or leading slash). Say so in a code comment. This
   is the single, deliberate place the server reveals an absolute path (§3.2), and it is
   exempt from the "no absolute path in a response body" rule only because it is a
   successful response of a fixed purpose, not an error body.
5. `platform: process.platform` — `'win32' | 'darwin' | 'linux'` (or other Node value
   passed through unchanged).
6. Respond `200` with `res.json(body)`; `Content-Type: application/json; charset=utf-8`.
   (Handlers live inside `createFsRouter`, which closes over `deps.logger`; the factory
   signature is `createFsRouter(deps: { logger: Logger }): Router`.)

The endpoint accepts no query parameters and ignores any that are supplied.

### 4.4 `GET /api/fs/list`

Specification §5.3:

| Param | Type | Default | Notes |
|---|---|---|---|
| `path` | wire path | `""` | Must resolve to a directory. |
| `showHidden` | `"true" \| "false"` | `"false"` | Anything else → `400 INVALID_PARAM`. |

Handler algorithm, in order:

1. **Validate parameters** (§4.2): `rawPath = readStringParam(req.query.path, 'path', '')`,
   then `showHidden = readBooleanParam(req.query.showHidden, 'showHidden')`.
2. `const absPath = await resolveSafe(rawPath);` — let its `ApiError`s propagate untouched
   (`INVALID_PATH` 400, `OUTSIDE_ROOT` 403, `NOT_FOUND` 404, `ACCESS_DENIED` 403).
3. `await assertDirectory(absPath);` — throws `400 NOT_A_DIRECTORY` when the target is a
   file. A race (the path vanished between `realpath` and `stat`) arrives as an `ApiError`
   already mapped by `mapFsError` (`NOT_FOUND` / `ACCESS_DENIED` / `READ_FAILED`). Do not
   catch and re-wrap.
4. `const wirePath = normalizeWirePath(rawPath);` (from `@slydr/shared`).
   Per spec §5.3 (updated) the response `path` is the request path **lexically normalised**
   (empty and `.` segments dropped), **not** the symlink-resolved real path.
   `?path=Pictures/./2024//` returns `"Pictures/2024"`; `?path=link-inside` (a symlink to
   `Pictures` inside the jail) returns `"link-inside"`, so the explorer keeps the path the
   user navigated and "up" returns to where they came from. Containment is already proven on
   the real path by `resolveSafe` (step 2); do not use `toWirePath(absPath)` for the
   response. The normalised form is accepted again verbatim by `resolveSafe`. Never perform
   a `replace(/\\/g, '/')` in the route.
5. `const listing = await listDirectory(absPath, { showHidden, wireDir: wirePath, logger });`
   with the router's injected `logger`. Let any `ApiError` it throws propagate
   (`ACCESS_DENIED` for `EACCES`/`EPERM` on the directory itself, per §5.3).
6. Compute `parentPath`:
   - if `wirePath === ''`, `parentPath = null`. **This is how the UI disables the "up"
     control.** It must be the JSON literal `null`, never `""`, never omitted;
   - otherwise `parentPath = wireParent(wirePath) ?? ''`. For `"Pictures"` that is `""`
     (the root, which is a valid, navigable parent); for `"Pictures/2024"` it is
     `"Pictures"`; for `"link-inside"` it is `""`. Because `wirePath` came from
     `normalizeWirePath` it contains no empty or `.` segments.
7. Compute `name`:
   - for the jail root (`wirePath === ''`), `name = path.basename(getJailRoot())`, using
     the same fallback as `/root` for a volume-root jail. Factor this into a small
     `rootDisplayName()` helper used by both handlers so they cannot drift;
   - otherwise `name = wireBasename(wirePath)` — the last segment of the normalised path
     (the symlink's own name when the folder was reached through a symlink).
8. Respond `200` with exactly these keys and no others:

```json
{
  "path": "Pictures",
  "name": "Pictures",
  "parentPath": "",
  "entries": [ /* FsEntry[], exactly as returned by listDirectory */ ],
  "counts": { "folders": 3, "images": 412, "files": 2 },
  "truncated": false
}
```

   - `entries`, `counts` and `truncated` are copied straight from `ListingResult`. **Do not
     sort, filter, re-map, slice or recount** them: ordering is a server-side service
     concern (§4.2) and the client must not re-sort either. `counts` reflects the full
     post-filter set before truncation and `truncated` is true when that set exceeded
     `MAX_ENTRIES = 10000`; both are T011's contract.
9. Log one event through the injected logger (which already honours quiet mode, NFR-10):
   `logger.debug('fs.list', { path: 'Pictures', showHidden: false, entries: 417,
   truncated: false, ms: 42 })`. Logs may contain absolute paths; response bodies may not.
   `/root` logs nothing.

### 4.5 Error mapping (complete)

Every failure leaves the handler as an `ApiError` and is rendered by the existing error
middleware as `{ "error": { "code": "...", "message": "..." } }`.

| Condition | Code | HTTP | Raised by |
|---|---|---|---|
| `showHidden` not exactly `"true"`/`"false"`; `path` or `showHidden` repeated/array/object | `INVALID_PARAM` | 400 | this route (§4.2) |
| `path` has a NUL byte, exceeds 4096 chars, starts with `/`, matches `^[A-Za-z]:` or `^\\\\`, or (Windows only) contains a backslash | `INVALID_PATH` | 400 | `resolveSafe` |
| `path` has a `..` segment, or the real path escapes the jail root (symlink, junction, reparse point) | `OUTSIDE_ROOT` | 403 | `resolveSafe` |
| `path` does not exist | `NOT_FOUND` | 404 | `resolveSafe` / `listDirectory` |
| `path` resolves to a file | `NOT_A_DIRECTORY` | 400 | `assertDirectory` |
| OS denied reading the directory itself (`EACCES`, `EPERM`) | `ACCESS_DENIED` | 403 | `resolveSafe` or `listDirectory` |
| Any other I/O failure on the directory itself | `READ_FAILED` | 500 | `listDirectory` / `mapFsError` |
| `Host` not `localhost` / `127.0.0.1` / `[::1]` | `FORBIDDEN_HOST` | 403 | app middleware |
| Method not `GET`/`HEAD` | `METHOD_NOT_ALLOWED` | 405 | app middleware |

Per-entry `stat` failures are explicitly **not** errors: `listDirectory` swallows them and
omits the entry (§5.3, NFR-5). Never include a raw OS message, an `errno` or an absolute
path in an error body (§3.4).

### 4.6 Mounting in `app.ts`

Edit `createApp(config, logger)` in `server/src/app.ts`: add exactly one line after the guards
and before the error middleware (the same `logger` instance that `createApp` already builds
or receives):

```ts
app.use('/api/fs', createFsRouter({ logger }));
```

Requests under `/api/fs` that match no route fall through to the app's existing 404
handling; do not add a catch-all in the router. Because the method guard and the host check
run before the router, `POST /api/fs/list` is `405` and `Host: evil.example` is `403` without
any code in `routes/fs.ts`.

### 4.7 `HEAD` support

Express routes `HEAD` through the matching `GET` handler and discards the body, so
`HEAD /api/fs/root` and `HEAD /api/fs/list` work with no extra code. The headers
(`Content-Type`, `Content-Length`) match the corresponding `GET`. Do not register a separate
`router.head`. A test asserts it (§6).

### 4.8 Caching headers

**Decision (not specified):** send `Cache-Control: no-store` on both endpoints. A directory
listing must always reflect the disk at the moment of the request; the explorer's "Retry"
and navigation expectations break if a browser serves a stale listing. Set it with
`res.set('Cache-Control', 'no-store')` before `res.json`. (Do not set it on error responses
by hand; the error middleware owns those.)

### 4.9 Cross-platform notes

| Concern | win32 | darwin | linux |
|---|---|---|---|
| `absoluteRoot` | `C:\Users\Name` (backslashes, drive letter) | `/Users/name` | `/home/name` |
| `platform` | `"win32"` | `"darwin"` | `"linux"` |
| Wire paths in `entries[].path`, `path`, `parentPath` | forward slashes only | same | same |
| Fixture root from `os.tmpdir()` | may contain 8.3 short names (`PETERK~1`) | `/var` → `/private/var` symlink | plain |
| Unreadable-directory test | not possible with `chmod` | possible (non-root) | possible (non-root) |
| Symlink fixtures | need Administrator or Developer Mode | unprivileged | unprivileged |

The response body must contain no backslash in any wire-path field on any platform
(`absoluteRoot` is the sole exception and is a native path by design). The fixture root
must be `fs.realpath.native`'d before it becomes the jail root (`makeTempBase` and
`createTestEnv` do this), or containment checks fail on macOS and on Windows short-name
paths for reasons unrelated to the code under test.

## 5. Acceptance criteria

- [ ] `server/src/routes/fs.ts` exports the factory `createFsRouter({ logger })` (returns an
      Express `Router`) with `GET /root` and `GET /list`, plus the exported helpers
      `readStringParam` and `readBooleanParam`; `createApp` in `server/src/app.ts` mounts it
      with `app.use('/api/fs', createFsRouter({ logger }))`. There is no module-level router.
- [ ] `server/test/helpers/testApp.ts` exports `createTestEnv` as specified in §6 and is the
      only place route tests set up the jail; no test reads or writes `SLYDR_ROOT`.
- [ ] `GET /api/fs/root` returns `200` with exactly the keys `path`, `name`, `absoluteRoot`,
      `platform`; `path === ""`; `name` equals `path.basename` of the real jail root;
      `absoluteRoot` equals the real jail root; `platform === process.platform`.
- [ ] `GET /api/fs/list` returns `200` with exactly the keys `path`, `name`, `parentPath`,
      `entries`, `counts`, `truncated`.
- [ ] `GET /api/fs/list` with no parameters lists the jail root: `path === ""`,
      `parentPath === null` (JSON `null`), `name` equals the root's basename.
- [ ] `GET /api/fs/list?path=Pictures` returns `parentPath === ""`;
      `?path=Pictures/2024` returns `parentPath === "Pictures"`.
- [ ] The response `path` is the lexically normalised request path (`normalizeWirePath`):
      `?path=Pictures/./2024//` returns `"Pictures/2024"`. For a folder symlink inside the jail,
      `?path=link-inside` returns `path === "link-inside"`, `parentPath === ""`, and entries
      whose `path` is `link-inside/<name>` (the symlink-resolved location is never echoed).
- [ ] `entries`, `counts` and `truncated` are identical to the values returned by
      `listDirectory`; the route contains no `sort`, `filter`, `slice` or `reduce` over
      `entries`.
- [ ] `showHidden` defaults to `false`; `showHidden=true` includes hidden entries; any other
      value (`"1"`, `"0"`, `"TRUE"`, `"yes"`, `""`) returns `400 INVALID_PARAM`.
- [ ] `?path=a&path=b` and `?showHidden=true&showHidden=false` each return
      `400 INVALID_PARAM`.
- [ ] `path` containing `..` returns `403 OUTSIDE_ROOT`; `/etc`, `C:/Windows`, `\\server\share`
      and a NUL byte return `400 INVALID_PATH` on every platform, and `Pictures\2024`
      returns `400 INVALID_PATH` on Windows only (on POSIX it is an ordinary missing name,
      `404 NOT_FOUND`); a missing path returns `404 NOT_FOUND`; a file path returns
      `400 NOT_A_DIRECTORY`.
- [ ] A symlink inside the jail pointing outside it returns `403 OUTSIDE_ROOT`; a symlink
      to a folder whose real target is inside the jail is listed normally (skipped where the
      symlink cannot be created).
- [ ] An unreadable directory returns `403 ACCESS_DENIED` (POSIX, non-root only).
- [ ] `POST /api/fs/list` returns `405 METHOD_NOT_ALLOWED`; `Host: evil.example` returns
      `403 FORBIDDEN_HOST`; `HEAD` on both endpoints returns `200` with no body.
- [ ] Both endpoints send `Cache-Control: no-store`.
- [ ] No error body contains the fixture's absolute path, `ENOENT`, `EACCES` or an `errno`
      field.
- [ ] No wire-path field in any `/list` response contains a backslash or begins with `/`.
- [ ] `readStringParam` and `readBooleanParam` are exported module-level functions in
      `routes/fs.ts` that T014 imports without modification.

## 6. Tests to write

All in **`server/test/routes/fs.test.ts`** (Vitest + Supertest), satisfying specification
§12.2 ("Every endpoint against a fixture tree: happy path, each error code in §3.5, … and the
`405` / `403 FORBIDDEN_HOST` guards"). The T011 service has its own unit tests; these tests
assert the HTTP contract and use the real service (do not mock `listDirectory`, except where
stated). Tests never set `SLYDR_ROOT` and never `vi.resetModules()` for the jail: the jail
is set with `setJailRoot` inside `createTestEnv`.

### Shared harness — `server/test/helpers/testApp.ts` (created by this ticket)

```ts
import type { Express } from 'express';
import type { Logger } from '../../src/logger.js';
import type { ServerConfig } from '../../src/config/env.js';
import type { TestLogEvent } from './logger.js';

export interface TestEnvOptions {
  prefix?: string;                                             // mkdtemp prefix, default 'slydr-test-'
  populate?: (root: string, outside: string) => Promise<void>; // build the fixture tree
  config?: Partial<ServerConfig>;                              // overrides for makeTestConfig
}

export interface TestEnv {
  app: Express;
  base: string;      // temp parent (realpath'd)
  root: string;      // <base>/home, the jail root (realpath'd)
  outside: string;   // <base>/outside, a sibling directory outside the jail
  cacheDir: string;  // <base>/cache
  logger: Logger;    // the test logger passed to createApp
  events: TestLogEvent[];
  cleanup(): Promise<void>;
}

export async function createTestEnv(options?: TestEnvOptions): Promise<TestEnv>;
```

`createTestEnv` does, in order: `base = await makeTempBase(prefix)` (T011 helper); create
`<base>/home`, `<base>/outside`, `<base>/cache`; run `populate(root, outside)`; recompute
`root = await fs.realpath.native(root)`; `setJailRoot(root)`; `const { logger, events } =
createTestLogger()`; `app = createApp(makeTestConfig({ cacheDir, ...options.config }),
logger)`. `cleanup()` calls `resetJailRootForTests()` then `removeTree(base)`. T017 later
extends the options with `deps` (a third argument for `createApp`). Every route suite
(T012, T014, T015, T017) uses it in `beforeAll`/`afterAll`.

### Fixture

**The shared, repository-wide fixture generator script is T037. Do not wait for it and do
not pre-empt it.** Build a small tree through `populate`:

```ts
let env: TestEnv;
let linkInside = false;
let linkOutside = false;

beforeAll(async () => {
  env = await createTestEnv({
    prefix: 'slydr-fsroutes-',
    populate: async (root, outside) => {
      await fs.mkdir(path.join(root, 'Pictures', '2024'), { recursive: true });
      await fs.mkdir(path.join(root, 'Archive'), { recursive: true });
      await fs.mkdir(path.join(root, '.hidden-dir'), { recursive: true });
      await fs.writeFile(path.join(root, 'IMG_2.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
      await fs.writeFile(path.join(root, 'IMG_10.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
      await fs.writeFile(path.join(root, 'notes.txt'), 'hello');
      await fs.writeFile(path.join(root, '.dotfile'), 'x');
      await fs.writeFile(path.join(root, 'Pictures', '2024', 'a.png'), Buffer.from([0x89]));
      await fs.writeFile(path.join(root, 'café photo.jpg'), Buffer.from([0xff]));
      await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    },
  });
  // A directory junction (win32) needs no privilege; trySymlink returns false instead of throwing.
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  linkInside = await trySymlink(path.join(env.root, 'Pictures'), path.join(env.root, 'link-inside'), type);
  linkOutside = await trySymlink(env.outside, path.join(env.root, 'link-outside'), type);
});

afterAll(async () => { await env.cleanup(); });
```

Requests go through `request(env.app)`. The symlink fixtures (`link-inside` → `Pictures`,
`link-outside` → `outside`) are created in `beforeAll` after `createTestEnv`; dependent cases
call `ctx.skip()` with a reason when the flag is `false` rather than failing (Windows without
Developer Mode cannot create file symlinks; folder junctions need no privilege and are used on
win32 for both links).

### Cases — `GET /api/fs/root`

1. `returns the jail root description` — `200`; body keys exactly
   `['absoluteRoot','name','path','platform']` (sorted); `path === ''`;
   `name === path.basename(root)`; `absoluteRoot === root`;
   `platform === process.platform`.
2. `absoluteRoot is a native absolute path` — `path.isAbsolute(body.absoluteRoot)` is true.
3. `HEAD /api/fs/root returns 200 with an empty body and a JSON content type`.
4. `sends Cache-Control: no-store`.
5. `ignores unknown query parameters` — `?path=../..` still returns the root description
   (the endpoint reads no parameters).

### Cases — `GET /api/fs/list` happy path

6. `lists the jail root by default` — `path === ''`, `parentPath === null`,
   `name === path.basename(root)`; `Array.isArray(entries)`; `truncated === false`.
7. `folders come first, then files in numeric-collation order, hidden omitted` — entries
   names with `showHidden` off are exactly `['Archive','Pictures','caf\u00e9 photo.jpg','IMG_2.jpg','IMG_10.jpg','notes.txt']`
   (adjust for the collator's treatment of the accented name; compute the expected order with
   the same `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })` and assert
   against it so the test is locale-robust) — plus `link-inside` / `link-outside` handling
   per the symlink cases below. Assert `.hidden-dir` and `.dotfile` are absent.
8. `showHidden=true includes hidden entries flagged hidden` — `.hidden-dir` and `.dotfile`
   present with `hidden === true`; non-hidden entries have `hidden === false`.
9. `counts match the returned entries` — `counts.folders`, `counts.images`, `counts.files`
   equal the tally derived from `entries` for the non-truncated case.
10. `entry fields are populated` — a folder has `size === null` and a numeric `mtimeMs`; a
    file has numeric `size` and `mtimeMs`; each `path` equals `wireJoin('', name)` for the
    root and `Pictures/<name>` inside `Pictures`; image vs file `type` is correct for
    `IMG_2.jpg` / `notes.txt`.
11. `lists a nested folder with the right parentPath and name` — `?path=Pictures` gives
    `path === 'Pictures'`, `name === 'Pictures'`, `parentPath === ''`;
    `?path=Pictures/2024` gives `parentPath === 'Pictures'`, `name === '2024'`, and an
    `a.png` entry with `path === 'Pictures/2024/a.png'`, `type === 'image'`.
12. `path is lexically normalised` — `?path=Pictures/./2024//` returns `path === 'Pictures/2024'`
    (and `parentPath === 'Pictures'`, `name === '2024'`).
13. `empty path parameter means the root` — `?path=` returns `path === ''`.
14. `unicode and space names round-trip` — the `caf\u00e9 photo.jpg` entry appears with its
    exact name and a `path` that, URL-encoded by Supertest, can be resolved again (assert
    via a follow-up `?path=` to a folder with such a name, or by asserting the string value).
15. `no wire path contains a backslash or a leading slash` — across `path`, `parentPath` and
    every `entries[].path`.
16. `sends Cache-Control: no-store`.
17. `HEAD /api/fs/list returns 200 with an empty body` and the same `Content-Type` as `GET`.
18. `an empty folder returns no entries` — create `Archive` empty; expect `entries: []`,
    `counts: { folders: 0, images: 0, files: 0 }`, `truncated: false`.
19. `truncated is wired through` — `vi.doMock` the listing service so `listDirectory`
    resolves `{ entries: [], counts: { folders: 0, images: 5, files: 0 }, truncated: true }`
    and assert the response carries `truncated === true` and the mocked counts (proves the
    route does not hard-code the flag or recount). Seam: `createFsRouter` accepts an optional
    `listDirectory` in its deps (`{ logger, listDirectory? }`, defaulting to the real service);
    the case mounts `createFsRouter({ logger, listDirectory: stub })` on a tiny
    `express()` app under `/api/fs` (the jail is already set by `createTestEnv`). No module
    mocking and no `vi.resetModules()`.

### Cases — `GET /api/fs/list` errors (one per code in §3.5 that this endpoint can emit)

20. `INVALID_PARAM — showHidden` — table over `'1'`, `'0'`, `'TRUE'`, `'True'`, `'yes'`,
    `''`, `'maybe'`: each `400` with `error.code === 'INVALID_PARAM'`.
21. `INVALID_PARAM — repeated path` — `?path=Pictures&path=Archive` → `400 INVALID_PARAM`
    (pins the Decision in §4.2).
22. `INVALID_PARAM — repeated showHidden` — `?showHidden=true&showHidden=false` → `400`.
23. `INVALID_PARAM — object-valued path` — `?path[x]=y` → `400 INVALID_PARAM` (if the
    configured query parser yields a string key `"path[x]"` instead, the request has no
    `path` and returns `200` for the root; assert whichever the app's parser produces, with
    a comment naming the parser, so the test documents reality rather than assumption).
24. `parameter validation precedes path resolution` — `?path=does-not-exist&showHidden=maybe`
    → `400 INVALID_PARAM`, not `404`.
25. `INVALID_PATH` — table: `?path=/etc`, `?path=C:/Windows`, `?path=%5C%5Cserver%5Cshare`
    (UNC), `?path=a%00b` (NUL), a 4097-character path → `400 INVALID_PATH` on every
    platform. Separate Windows-only row: `it.runIf(process.platform === 'win32')`
    `?path=Pictures%5C2024` (backslash) → `400 INVALID_PATH`; and a POSIX counterpart
    `it.skipIf(process.platform === 'win32')` asserting the same request returns
    `404 NOT_FOUND` (a backslash is an ordinary filename character there, spec §3.3).
26. `OUTSIDE_ROOT — traversal` — `?path=../../../etc` → `403 OUTSIDE_ROOT`; also
    `?path=Pictures/../..` and `?path=..`. **This is the NFR-7 traversal test for this
    endpoint.**
27. `OUTSIDE_ROOT — symlink escape` — `?path=link-outside` → `403 OUTSIDE_ROOT`; and
    `?path=link-outside/secret.txt` → `403 OUTSIDE_ROOT`. Skip gracefully if the symlink
    could not be created. On win32 use a junction. **NFR-7 symlink-escape test.**
28. `folder symlink inside the jail is followed and keeps the navigated path` —
    `?path=link-inside` returns `200` with `path === 'link-inside'`, `parentPath === ''`,
    `name === 'link-inside'`, and the same entry names as `?path=Pictures`, each with
    `path === 'link-inside/<name>'`; `?path=link-inside/2024` returns `parentPath ===
    'link-inside'`. Skip if the symlink could not be created. Also: the root listing contains
    `link-inside` with `type === 'folder'`.
29. `NOT_FOUND` — `?path=nope` → `404 NOT_FOUND`; `?path=notes.txt/child` → `404 NOT_FOUND`.
30. `NOT_A_DIRECTORY` — `?path=notes.txt` → `400 NOT_A_DIRECTORY`.
31. `ACCESS_DENIED` — `it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)`:
    create `locked/`, `fs.chmod(dir, 0o000)`, request `?path=locked`, expect
    `403 ACCESS_DENIED`; restore mode `0o755` in a `finally` or the temp cleanup fails.
    Additionally cover the code path portably (all platforms): spy on `fs.readdir` with
    `vi.spyOn(fs, 'readdir')` (works because server code calls `fs.readdir` through the
    default import, tasks/README.md conventions) to reject with an `EPERM`-shaped error for
    the target and assert `403 ACCESS_DENIED` (this mock-based case runs on Windows too).
32. `READ_FAILED` — spy on `fs.readdir` to reject with an `EIO`-shaped error →
    `500 READ_FAILED`.
33. `error bodies leak nothing` — for the 400/403/404/500 cases above, assert the serialised
    body does not contain `root`, `base`, `ENOENT`, `EACCES`, `EPERM`, `EIO`, nor a key
    named `errno`, `syscall` or `stack`, and that the body is exactly
    `{ error: { code, message } }`.

### Cases — transport guards

34. `405 METHOD_NOT_ALLOWED` — `POST`, `PUT`, `DELETE` and `PATCH` to `/api/fs/list` and
    `/api/fs/root` → `405` with `error.code === 'METHOD_NOT_ALLOWED'`.
35. `403 FORBIDDEN_HOST` — `GET /api/fs/list` with `Host: evil.example` → `403`
    `FORBIDDEN_HOST`; also `Host: evil.example:4317` and `Host: 127.0.0.1.evil.example`.
    Control requests with `Host: 127.0.0.1:4317`, `Host: localhost` and `Host: [::1]:4317`
    return `200`.
36. `403 FORBIDDEN_HOST applies to /api/fs/root as well`.
37. `unknown route under /api/fs is 404` — `GET /api/fs/nope` returns the app's standard
    404 (no HTML stack trace).
38. `logs a fs.list debug event` — after a successful `/list`, `env.events` contains an event
    named `fs.list` at level `debug` with `path`, `showHidden`, `entries`, `truncated`, `ms`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by tests; `npm test` green on the dev machine (Windows 11) and in CI
      on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- [ ] Handlers use `RootResponse` / `ListResponse` from `@slydr/shared`; no duplicate
      interface exists in `server/`.
- [ ] Symlink-dependent and permission-dependent cases skip (with a logged reason), never
      fail, where their fixtures cannot be created.
- [ ] Each **Decision (not specified)** in §4 appears as a code comment at the relevant line.
- [ ] `readStringParam` / `readBooleanParam` are exported so T014 can reuse them without
      copying.
- [ ] `createTestEnv` is documented with a short comment block and is the only route-test
      jail setup (no `SLYDR_ROOT`, no `vi.resetModules()` for the jail).
- [ ] README unchanged — internal API surface with no new setup step (T041 creates the
      README and documents the home-directory restriction).

## 8. Notes and gotchas

- **`absoluteRoot` is display-only.** The client uses it for a tooltip or breadcrumb label.
  Feeding it back as `path` is rejected by `resolveSafe` (`INVALID_PATH`), which is the
  intended safety net; do not add a code path that tries to "accept" it.
- **`parentPath: null` is the contract for "no up".** The explorer disables its up control
  when `parentPath === null`. Returning `""` there would mean "the parent is the root", which
  is wrong for the root itself and would let the UI navigate nowhere.
- **Never coerce array query values.** Express 5 hands you arrays for repeated keys.
  `String(['a','b'])` is `"a,b"`; resolving that is a way to reach a folder the caller never
  named. Reject non-strings.
- **Do not re-sort or recount in the route.** Sorting and counting are the service's
  contract. A defensive `entries.sort` here would silently diverge from §4.2 (the numeric
  collator plus tie-breaker).
- **Navigated `path` echo.** The route returns `normalizeWirePath(rawPath)`, never a path
  derived from `realpath`. A symlinked folder keeps its own name in the breadcrumb and "up"
  returns to where the user came from (a common case: `~/Pictures` → a synced folder). Safety
  is unaffected: `resolveSafe` still proves the real target is inside the jail on every
  request. Test 28 pins it.
- **Error precedence.** Parameter validation first, then `resolveSafe`, then
  `assertDirectory`, then the listing. Keep that order; the tests depend on it.
- **`HEAD` runs the full listing.** Nothing in Slydr issues `HEAD`; do not special-case it.
- **Windows `chmod` is a no-op for read access.** Use the `fs.readdir` spy to cover
  `ACCESS_DENIED` on Windows, and the real `chmod` case on POSIX. CI containers often run as
  root, where mode bits are bypassed; the root guard is mandatory.
- **macOS and Windows temp paths.** The fixture root is always `fs.realpath.native`'d
  before it becomes the jail root (done inside `makeTempBase`/`createTestEnv`); `/var` →
  `/private/var` and 8.3 short names otherwise make every containment check fail for the
  wrong reason.
- **The jail root is cached at module scope.** `setJailRoot` throws if called again with a
  different path, so each suite must pair `createTestEnv` with `env.cleanup()` (which calls
  `resetJailRootForTests()`); Vitest isolates module graphs per test file, so suites in
  different files do not interfere.
- **Spec reference.** §5.3 (updated) states `counts` covers the whole post-filter set
  (before truncation) and `truncated` is evaluated after hidden filtering; both are T011's
  concern and are simply forwarded here.
