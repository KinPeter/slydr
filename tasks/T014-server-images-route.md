# T014 — Expose `GET /api/fs/images`

**Epic:** E6 (Image scan API)
**Spec sections:** §5.4, §12.2, §3.5, §4.2, §4.3
**Depends on:** T013
**Estimated size:** M

---

## 1. Context

Slydr's configuration screen needs to know, before the user presses "Play slide show",
exactly which images will be played and in what order. This ticket exposes that as an
HTTP endpoint: `GET /api/fs/images`, which takes a folder plus the `recursive` and
`showHidden` flags and returns the complete, ordered playlist. The traversal itself is
already implemented as a service (`server/src/services/scan.ts`, delivered by T013); this
ticket adds the route that validates query parameters, resolves the folder safely, calls
the service, maps every failure onto the project's error envelope, and returns the exact
response shape from specification §5.4. The endpoint is the **single source of the
player's playlist** — the configuration screen's fetch result is handed straight to the
player, with no second request — so the response must be complete, ordered and
self-sufficient.

## 2. Scope

### In scope

- Extend the router factory `createFsRouter({ logger })` in `server/src/routes/fs.ts` (T012)
  with a `GET /images` handler mounted under `/api/fs`.
- Validation of the three query parameters `path`, `recursive` and `showHidden`, including
  the `400 INVALID_PARAM` rejections.
- Safe resolution of `path` through `resolveSafe`, plus the directory requirement
  (`400 NOT_A_DIRECTORY` for a file).
- Construction of the §5.4 response body: `path`, `recursive`, `count`, `truncated`,
  `items[]`.
- The complete error mapping for this endpoint (§4.6).
- `Cache-Control: no-store` on the response (same reasoning as `/api/fs/list`, T012: the
  playlist must reflect the disk at the moment of the request).
- A Supertest suite in `server/test/routes/fs.images.test.ts` against a generated fixture
  tree built with `createTestEnv` (T012), per specification §12.2.

### Out of scope

- The traversal, ordering, depth/image caps, symlink-loop protection and hidden filtering
  themselves — **T013** owns `server/src/services/scan.ts`. This ticket calls it and must
  not reimplement or post-process any part of it (in particular: **no re-sorting** of
  `items`).
- `GET /api/fs/root` and `GET /api/fs/list` — **T012** owns those handlers in this same
  file (`createFsRouter`). Do not change their behaviour; only add to the router.
- `resolveSafe` and the containment algorithm — **T010** owns
  `server/src/security/jail.ts`.
- `GET /api/image` (T015) and `GET /api/thumb` (T016–T018).
- The configuration screen that consumes this endpoint — epic E14.
- Pagination, a `limit` parameter, or any form of partial playlist. The playlist is
  returned whole, bounded only by `MAX_IMAGES`.

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** with three packages — `shared/`,
`server/` and `client/`. Everything is **ESM** (`"type": "module"` in every
`package.json`), TypeScript is in **strict** mode, the engine requirement is
**Node >= 22**, the server runs **Express 5**, and **Vitest + Supertest** are already
configured and runnable via `npm test`. Follow the import-extension convention already in
use in `server/src`.

### `@slydr/shared` (already implemented)

Exports `FsEntry`, the `ImageItem` shape used by this endpoint:

```ts
export interface ImageItem {
  name: string;         // basename, e.g. "IMG_0001.jpg"
  path: string;         // wire path, e.g. "Pictures/2024/IMG_0001.jpg"
  dir: string;          // wire path of the containing directory, e.g. "Pictures/2024"
  size: number | null;
  mtimeMs: number | null;
}
```

plus the endpoint response types (including the response type for this endpoint — use it
as the handler's return type rather than declaring a local interface), the `ApiErrorCode`
union from specification §3.5, `MAX_DEPTH = 12`, `MAX_IMAGES = 20000`,
`IMAGE_EXTENSIONS`, `isImageExtension(name)`, and pure POSIX wire-path helpers that
operate on forward-slash relative paths and never touch the file system.

If the shared response type for this endpoint does not yet exist, add it to
`shared/src/types.ts` as part of this ticket, named consistently with the existing list
response type (for example `ImagesResponse` alongside `ListResponse`):

```ts
export interface ImagesResponse {
  path: string;
  recursive: boolean;
  count: number;
  truncated: boolean;
  items: ImageItem[];
}
```

### `server/src/app.ts` (already implemented — T008, T009, T012)

`createApp(config: ServerConfig, logger?: Logger)` builds and returns an Express application
and never calls `listen`, so Supertest can mount it directly. It already installs:

- the `405 METHOD_NOT_ALLOWED` guard rejecting anything that is not `GET` or `HEAD`;
- the `403 FORBIDDEN_HOST` host check (`localhost`, `127.0.0.1`, `[::1]`, optional port);
- the error-handling middleware that renders every failure as
  `{ "error": { "code": "...", "message": "..." } }` and never leaks an `errno`, a raw OS
  message or an absolute path into the body;
- a typed `ApiError` class: `new ApiError(code, message?, cause?)`, the HTTP status is
  derived from the code (never pass one);
- the fs router, mounted by T012 as `app.use('/api/fs', createFsRouter({ logger }))`.

Express 5 forwards rejected promises from async handlers to the error middleware
automatically, so an `async` handler may simply `throw new ApiError(...)` and does not
need its own `try/catch` or an explicit `next(err)`.

### Configuration and test helpers (already implemented — T008, T011, T012)

`readServerConfig(env): ServerConfig` lives in `server/src/config/env.ts`; this ticket reads
no configuration. Tests never set `SLYDR_ROOT`: they use `createTestEnv()`
(`server/test/helpers/testApp.ts`, T012), which creates the temp tree, calls `setJailRoot`
and returns a Supertest-ready `app`, plus `trySymlink`/`removeTree`/`makeTempBase`
(`helpers/fs.ts`) and `createTestLogger` (`helpers/logger.ts`).

### `server/src/security/jail.ts` (already implemented)

```ts
export function resolveSafe(relPath: string): Promise<string>;
export function assertDirectory(absPath: string): Promise<import('node:fs').Stats>;
export function mapFsError(err: unknown): ApiError;
```

`resolveSafe` implements specification §3.3 fully: it rejects NUL bytes and inputs
longer than 4096 characters (`400 INVALID_PATH`), rejects a leading `/` and Windows
absolute/UNC shapes such as `^[A-Za-z]:` and `^\\\\` (`400 INVALID_PATH`; any backslash too,
on Windows only), rejects any `..` segment (`403 OUTSIDE_ROOT`), joins the surviving
segments onto the jail root, `fs.realpath.native`s the result (`404 NOT_FOUND` on
`ENOENT`/`ENOTDIR`, `403 ACCESS_DENIED` on `EACCES`/`EPERM`), and verifies containment in
the real jail root (`403 OUTSIDE_ROOT` otherwise). It follows symlinks and junctions. It
throws `ApiError` on every failure. `assertDirectory` throws `400 NOT_A_DIRECTORY` for a
non-directory and maps stat errors through `mapFsError`. **Every file-system access must go
through `resolveSafe`; string concatenation of user input into a path is a defect.**

### `server/src/routes/fs.ts` (already implemented — T012)

Exports `createFsRouter({ logger })`, which carries `GET /root` and `GET /list`, and
`readStringParam(value, name, fallback)` / `readBooleanParam(value, name)`; `createApp`
already mounts it at `/api/fs`. This ticket **adds a route inside that existing factory**
and **imports the two helpers** — it does not create a new file, a new router or a new
`app.use(...)`.

### `server/src/services/scan.ts` (already implemented — T013)

```ts
export interface ScanOptions {
  absPath: string;     // absolute path, already produced by resolveSafe
  wirePath: string;    // normalised request path of that same directory ("" for the jail root)
  recursive: boolean;
  showHidden: boolean;
  logger?: Logger;     // T009 Logger
}

export interface ScanResult {
  items: ImageItem[];
  truncated: boolean;  // true when the scan stopped at MAX_IMAGES
}

export async function scanImages(options: ScanOptions): Promise<ScanResult>;
```

Behaviour this route relies on and must not duplicate: depth-first traversal; within each
directory the §4.2 collator order
(`new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`); a directory's own
images emitted before its subdirectories' images; `MAX_DEPTH = 12` and `MAX_IMAGES = 20000`
with `truncated` set on hitting the image cap; a visited-realpath `Set` against symlink
loops; silent skipping of unreadable subdirectories; hidden images and hidden folders
skipped unless `showHidden` is true; entries whose wire path `resolveSafe` would reject are
omitted; symlinked folders inside the jail are followed and their items carry the navigated
path (`link/<name>`); a symlinked file is an image iff the link's own name has an image
extension; `size`/`mtimeMs` filled in by a bounded-concurrency `stat` pass, `null` where the
`stat` failed. A read failure on the **starting** directory is thrown as an `ApiError`
(`mapFsError`: `ACCESS_DENIED` for `EACCES`/`EPERM`, `NOT_FOUND` for `ENOENT`,
`READ_FAILED` otherwise); failures deeper in the tree never surface.

## 4. Implementation detail

### 4.1 File to modify

`server/src/routes/fs.ts` — add one handler inside the existing `createFsRouter` factory
(T012), next to the `/list` handler:

```ts
router.get('/images', async (req, res) => { /* ... */ });
```

The route therefore answers `GET /api/fs/images` (and `HEAD /api/fs/images`, which Express
serves from the same handler). Use T012's exported module-level helpers
`readStringParam(value, name, fallback)` and `readBooleanParam(value, name)` for `path`,
`recursive` and `showHidden`, so the two endpoints can never drift on what `"True"` or a
repeated parameter means; do not write a second parser. The factory deps become
`{ logger: Logger; listDirectory?: typeof listDirectory; scanImages?: typeof scanImages }`;
the optional `scanImages` is a documented test seam (default: the real service) used by
test 22, exactly like T012's `listDirectory` seam. The handler uses the injected `logger`.

### 4.2 Parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `path` | wire path | `""` | Must resolve to a directory. |
| `recursive` | `"true" \| "false"` | `"false"` | Bound to the `includeSubfolders` config. |
| `showHidden` | `"true" \| "false"` | `"false"` | Mirrors the explorer setting; hidden images and hidden folders are skipped when false. |

Validation rules, in detail:

- **`path`** — absent or `""` means the jail root. In Express 5 a repeated query parameter
  (`?path=a&path=b`) arrives as an **array**, and a bracketed parameter (`?path[x]=y`)
  arrives as an **object**; anything that is not `undefined` and not a `string` is
  rejected with `400 INVALID_PARAM`. Do not coerce with `String(...)`. Beyond that, no
  shape checking happens here: the NUL-byte, length, absolute-path and `..` rules all
  belong to `resolveSafe` and must not be duplicated.
- **`recursive`** and **`showHidden`** — absent means `"false"`. Otherwise the value must
  be exactly the string `"true"` or exactly the string `"false"`. Every other value,
  including `"1"`, `"0"`, `"TRUE"`, `"yes"`, `""` and any array or object, is rejected with
  `400 INVALID_PARAM`. The comparison is case-sensitive, matching the `"true" | "false"`
  literal types in the specification table. `readBooleanParam` (T012) is the parser, so
  `showHidden` behaves identically on both endpoints.

**Decision (not specified): all query parameters are validated before any file-system
access.** The specification does not state an error precedence. Validating first means a
request with both a bad `recursive` value and a non-existent `path` deterministically
returns `400 INVALID_PARAM` rather than `404 NOT_FOUND`, it keeps the cheap check ahead of
the expensive one, and it makes the tests order-independent. Within parameter validation,
check in declaration order (`path` type, then `recursive`, then `showHidden`) so a request
with two bad parameters reports the first one.

### 4.3 Handler algorithm

1. Parse and validate `path`, `recursive` and `showHidden` per §4.2 with `readStringParam`
   / `readBooleanParam`, which throw `new ApiError('INVALID_PARAM', message)` (no status
   argument: the status is derived from the code) with a generic message free of OS detail.
2. `const absPath = await resolveSafe(rawPath)`. Let its `ApiError`s propagate untouched —
   they already carry the right code and status.
3. `await assertDirectory(absPath)` (T010). It throws `400 NOT_A_DIRECTORY` for a file and
   maps a stat race (the directory vanished between `realpath` and `stat`) through
   `mapFsError`. Do not call `fs.stat` or re-wrap errors here.
4. `const wirePath = normalizeWirePath(rawPath)` (from `@slydr/shared`).
   Per spec §5.3/§5.4 (updated) the response echoes the request path **lexically
   normalised**, not a path derived from the resolved absolute path: `?path=Pictures/./2024//`
   comes back as `"Pictures/2024"`, and a symlinked folder keeps the name the user navigated
   (`"link-inside"`), so every item path is built from the path as navigated and resolves
   again through `resolveSafe` (which follows the link and re-checks containment). Do not use
   `toWirePath(absPath)` for the response.
5. `const { items, truncated } = await scanImages({ absPath, wirePath, recursive, showHidden, logger })`.
6. Respond `200` with exactly:

```json
{
  "path": "Pictures/2024",
  "recursive": true,
  "count": 1284,
  "truncated": false,
  "items": [
    {
      "name": "IMG_0001.jpg",
      "path": "Pictures/2024/IMG_0001.jpg",
      "dir": "Pictures/2024",
      "size": 4812345,
      "mtimeMs": 1712345678901
    }
  ]
}
```

   - `path` — the normalised wire path from step 4; `""` for the jail root.
   - `recursive` — the **boolean** form of the validated parameter, not the string.
   - `count` — `items.length`. It is always exactly the length of `items`; it is not a
     "total available" count. When `truncated` is true, `count` is `20000`.
   - `truncated` — straight from `ScanResult`. `true` only when the scan stopped at
     `MAX_IMAGES = 20000`.
   - `items` — the service's array, **in the order the service produced it**. Do not sort,
     filter, dedupe, re-map or shuffle. Shuffling is the player's job (§9.3) and sorting is
     already done (§4.2, §5.4).
   - `Content-Type: application/json` (Express sets it from `res.json`).
   - `Cache-Control: no-store`, set with `res.set('Cache-Control', 'no-store')` before
     `res.json` (same as `/api/fs/list`, T012: the playlist must reflect the disk at the
     moment of the request; the configuration screen refetches whenever
     `includeSubfolders` changes). Do not set it by hand on error responses; the error
     middleware owns those.

7. Log one event through the injected logger (quiet mode is the logger's concern, NFR-10):
   `logger.debug('fs.images', { path: 'Pictures/2024', recursive: true, count: 1284,
   truncated: false, ms: 318 })`. Logs may contain absolute paths; the response body may
   not (§3.4).

### 4.4 Why this endpoint is the whole playlist

Specification §5.4 opens with "Collects the playable image list for a folder. This is the
single source of the player's playlist", and §8.3 makes the consequence explicit: "The
response's `items` become the playlist, so the player needs no second fetch." The
configuration screen calls this endpoint on mount and again whenever `includeSubfolders`
changes, renders "**N images found**" from `count`, disables "Play slide show" when
`count === 0`, shows "Showing the first 20000 images." when `truncated` is true, and then
hands `items` directly to the player.

Three implications are binding on this route:

1. **Return the entire list in one response.** No pagination, no `limit`, no cursor. The
   only bound is `MAX_IMAGES`.
2. **The order in `items` is the play order** when shuffle is off. Preserving the service's
   order exactly is a correctness requirement, not a nicety.
3. **Each item must be independently sufficient.** The player builds `/api/image?path=...`
   and `/api/thumb?path=...` URLs from `item.path` alone, so every `path` must be a wire
   path that `resolveSafe` accepts: relative, POSIX separators, no leading slash.

### 4.5 `HEAD` requests

Express routes `HEAD` through the `GET` handler and discards the body, so `HEAD` works
without extra code. Note that the full scan still runs for a `HEAD`; that is acceptable
and no client issues one. Do not add a separate `router.head(...)`.

### 4.6 Error mapping (complete)

Every error leaves the handler as an `ApiError` and is rendered by the existing middleware
as `{ "error": { "code": "...", "message": "..." } }`.

| Condition | Code | HTTP | Raised by |
|---|---|---|---|
| `recursive` or `showHidden` is not exactly `"true"`/`"false"`; `path` is not a string | `INVALID_PARAM` | 400 | `readStringParam` / `readBooleanParam` (T012, §4.2) |
| `path` contains a NUL byte, is longer than 4096 chars, starts with `/`, matches `^[A-Za-z]:` or `^\\\\`, or (Windows only) contains a backslash | `INVALID_PATH` | 400 | `resolveSafe` |
| `path` contains a `..` segment, or the resolved real path escapes the jail root (symlink, junction, reparse point) | `OUTSIDE_ROOT` | 403 | `resolveSafe` |
| `path` does not exist | `NOT_FOUND` | 404 | `resolveSafe` |
| The OS denied reading the target directory (`EACCES`/`EPERM`) | `ACCESS_DENIED` | 403 | `resolveSafe` or `scanImages` |
| `path` resolves to a file rather than a directory | `NOT_A_DIRECTORY` | 400 | `assertDirectory` (§4.3 step 3) |
| Any other I/O failure reading the starting directory | `READ_FAILED` | 500 | `mapFsError` via `assertDirectory` or `scanImages` |
| `Host` header is not `localhost`, `127.0.0.1` or `[::1]` (optional port) | `FORBIDDEN_HOST` | 403 | app middleware |
| Method is not `GET` or `HEAD` | `METHOD_NOT_ALLOWED` | 405 | app middleware |

An unreadable **subdirectory** is explicitly *not* in this table: it is skipped silently
inside the service and produces no error (§5.4, NFR-5). Never include a raw OS error
message, an `errno` or an absolute path in a response body (§3.4).

### 4.7 Cross-platform notes

- The response contains only wire paths, so nothing in the body differs between Windows,
  macOS and Linux. Assert that in the tests: no backslashes anywhere in `items`.
- On Windows a path such as `C:/Users/...` or `\\\\server\\share` must be rejected by
  `resolveSafe` as `INVALID_PATH`, never resolved. The route adds no platform-specific
  handling of its own.
- The route never converts separators itself: the response `path` comes from
  `normalizeWirePath` and item paths from the scan's `wireJoin`; there is no
  `replace(/\\/g, '/')` in the route. A filename containing a backslash on POSIX is legal and
  its wire path contains that backslash; the "no backslash" assertions therefore use a
  fixture without such names.

## 5. Acceptance criteria

- [ ] `GET /api/fs/images` responds `200` with a body containing exactly the keys `path`,
      `recursive`, `count`, `truncated` and `items`, and no others.
- [ ] `count === items.length` in every successful response.
- [ ] `recursive` in the response is a JSON boolean, matching the request parameter.
- [ ] `path` in the response is the lexically normalised request path (`""` at the jail
      root; `normalizeWirePath`) and contains no backslash and no leading slash; for a
      symlinked folder it stays the navigated name (`link-inside`), never the target's.
- [ ] `Cache-Control: no-store` is sent on the success response.
- [ ] `recursive=false` (and the default) returns only images directly inside the folder;
      `recursive=true` returns the whole subtree.
- [ ] `showHidden=false` (and the default) omits hidden images and never descends into
      hidden folders; `showHidden=true` includes both.
- [ ] `recursive` or `showHidden` set to anything other than `"true"`/`"false"` returns
      `400` with `error.code === 'INVALID_PARAM'`; the values `"1"`, `"0"`, `"TRUE"`,
      `"yes"` and `""` are all rejected.
- [ ] A repeated `path` parameter (`?path=a&path=b`) returns `400 INVALID_PARAM`.
- [ ] `path=../../../etc` returns `403` with `error.code === 'OUTSIDE_ROOT'`.
- [ ] A `path` pointing at a file returns `400` with `error.code === 'NOT_A_DIRECTORY'`.
- [ ] A non-existent `path` returns `404` with `error.code === 'NOT_FOUND'`.
- [ ] `POST /api/fs/images` returns `405 METHOD_NOT_ALLOWED`, and a request with
      `Host: evil.example` returns `403 FORBIDDEN_HOST`.
- [ ] `items` is returned in the service's order; the handler contains no `sort`, `filter`,
      `reverse` or `slice` call applied to `items`.
- [ ] No error response body contains an absolute path, an `errno`, or a raw OS message.
- [ ] The handler lives in `server/src/routes/fs.ts` inside the existing `createFsRouter`
      factory; no new `app.use` call was added, `/root` and `/list` still behave as before,
      and it reuses `readStringParam`, `readBooleanParam`, `assertDirectory` and
      `mapFsError` instead of re-implementing them (no raw `fs.stat` in the handler).
- [ ] No `new ApiError(code, <number>, ...)` call exists; `ApiError` takes
      `(code, message?, cause?)`.

## 6. Tests to write

All in `server/test/routes/fs.images.test.ts` (Vitest + Supertest), satisfying
specification §12.2: "Every endpoint against a fixture tree: happy path, each error code in
§3.5 … and the `405` / `403 FORBIDDEN_HOST` guards."

### Fixture tree

Create it with `createTestEnv({ prefix: 'slydr-images-', populate })` (T012,
`server/test/helpers/testApp.ts`) in `beforeAll` and call `env.cleanup()` in `afterAll`;
requests go through `request(env.app)`. The test never sets `SLYDR_ROOT` and never calls
`vi.resetModules()`: `createTestEnv` calls `setJailRoot` itself. Write image files as
tiny byte buffers — no committed binaries (§12.4). Folder symlinks are created after
`createTestEnv` with `trySymlink` (`'junction'` on win32, `'dir'` elsewhere); cases that need
them call `ctx.skip()` when it returns `false`. The tree must contain:

```
<root>/
  IMG_2.jpg
  IMG_10.jpg
  notes.txt                 # non-image file
  .secret.png               # hidden image
  nested/
    n1.png
    deeper/
      d1.webp
  .hiddenfolder/
    h1.jpg
  file-not-folder.jpg       # used for the NOT_A_DIRECTORY case
  deep/
    l1/l2/l3/l4/l5/l6/l7/l8/l9/l10/l11/l12/l13/l14/   # each level holds img.jpg
  link-nested -> nested     # folder symlink inside the jail (trySymlink, may be skipped)
<outside>/
  out.jpg                   # target of link-outside
  link-outside -> <outside> # in <root>; folder symlink escaping the jail
```

Build the `deep` chain in a loop rather than literally, and give each level a file named
`img.jpg` so the depth cap is observable by counting.

### Cases

1. **`flat scan returns only top-level images, in collator order`** —
   `GET /api/fs/images` with no parameters. Asserts `200`, `recursive === false`,
   `truncated === false`, `path === ''`, and that `items.map(i => i.path)` is exactly
   `['file-not-folder.jpg','IMG_2.jpg','IMG_10.jpg']` — the collator is case-insensitive
   and numeric, so `f` sorts before `I` and `IMG_2` before `IMG_10`. Build the expectation
   with the same comparator (`[...names].sort(compareNames)` from `listing.ts`) rather than
   hard-coding it, so the test cannot drift from FR-3. Asserts `notes.txt`, `.secret.png`,
   `nested/n1.png` and `.hiddenfolder/h1.jpg` are all absent, and `count === items.length`.
2. **`recursive scan walks the subtree depth-first, own images first`** —
   `?recursive=true`. Asserts the top-level images precede `nested/n1.png`, which precedes
   `nested/deeper/d1.webp`, and that `deep/.../img.jpg` entries are present.
3. **`nested folder is reachable via the path parameter`** — `?path=nested&recursive=false`
   returns exactly `['nested/n1.png']` with `path === 'nested'` and each item's `dir`
   equal to `'nested'`.
4. **`hidden image and hidden folder are excluded by default and included with showHidden=true`**
   — two requests with `?recursive=true` and `?recursive=true&showHidden=true`; asserts
   `.secret.png` and `.hiddenfolder/h1.jpg` appear only in the second.
5. **`depth cap is enforced`** — `?path=deep&recursive=true`. Asserts images from twelve
   levels below `deep` are present and that nothing from `l13` or `l14` is, by checking
   that no returned `path` contains `/l13/`.
6. **`item fields are populated`** — asserts each item has a non-empty `name`, a `path`
   ending in that `name`, a `dir` that is the wire path of the parent (`''` for top-level
   items), a numeric `size` greater than zero, and a numeric `mtimeMs`.
7. **`response contains no platform separators`** — asserts no `path` or `dir` in `items`
   contains `\\`, and none starts with `/`, on every CI platform.
8. **`invalid recursive value is rejected`** — a table-driven test over `'1'`, `'0'`,
   `'TRUE'`, `'True'`, `'yes'`, `''` and `'maybe'`, each asserting `400` and
   `error.code === 'INVALID_PARAM'`.
9. **`invalid showHidden value is rejected`** — the same table, asserting `400`
   `INVALID_PARAM`.
10. **`repeated path parameter is rejected`** — `?path=nested&path=deep` asserts `400`
    `INVALID_PARAM`.
11. **`parameter validation precedes path resolution`** — `?path=does-not-exist&recursive=maybe`
    asserts `400 INVALID_PARAM` (not `404`), pinning the Decision in §4.2.
12. **`traversal attempt is refused`** — `?path=../../../etc` asserts `403` and
    `error.code === 'OUTSIDE_ROOT'`. This is this endpoint's contribution to NFR-7.
13. **`absolute and UNC paths are refused`** — `?path=/etc`, `?path=C:/Windows` and
    `?path=\\\\server\\share` each assert `400` and `error.code === 'INVALID_PATH'` on every
    platform. Windows-only (`it.runIf(process.platform === 'win32')`):
    `?path=nested%5Cdeeper` (a backslash) is `400 INVALID_PATH`; on POSIX
    (`it.skipIf(win32)`) the same request is an ordinary missing name, `404 NOT_FOUND`
    (spec §3.3).
14. **`NUL byte is refused`** — `?path=a%00b` asserts `400 INVALID_PATH`.
15. **`a file is not a directory`** — `?path=file-not-folder.jpg` asserts `400` and
    `error.code === 'NOT_A_DIRECTORY'`.
16. **`missing folder is 404`** — `?path=nope` asserts `404` and
    `error.code === 'NOT_FOUND'`.
17. **`unreadable folder is 403 ACCESS_DENIED`** — POSIX only
    (`it.skipIf(process.platform === 'win32')`, because `fs.chmod` does not remove read
    access on Windows): `chmod(dir, 0o000)`, request it, assert `403`
    `ACCESS_DENIED`, restore `0o755` in a `finally`.
18. **`unreadable subdirectory does not fail the scan`** — POSIX only: `chmod 0o000` on
    `nested/deeper`, request `?recursive=true`, assert `200`, that `nested/n1.png` is
    present and that `nested/deeper/d1.webp` is not.
19. **`method guard`** — `POST /api/fs/images` asserts `405` and
    `error.code === 'METHOD_NOT_ALLOWED'`.
20. **`host guard`** — `GET /api/fs/images` with `Host: evil.example` asserts `403` and
    `error.code === 'FORBIDDEN_HOST'`; a control request with `Host: 127.0.0.1:4317`
    asserts `200`.
21. **`error bodies leak nothing`** — for the `404`, `403` and `400` cases above, asserts
    the serialised body contains neither the fixture's absolute path, nor the substring
    `ENOENT`/`EACCES`, nor an `errno` field.
22. **`truncation flag is wired through`** — use the documented seam: mount
    `createFsRouter({ logger: env.logger, scanImages: stub })` on a tiny `express()` app
    under `/api/fs` (the jail is already set by `createTestEnv`), where `stub` resolves
    `{ items: [...3 items], truncated: true }`, and assert the response has
    `truncated === true` and `count === 3`. No module mocking, no `vi.resetModules()`. This
    keeps the test fast while still proving the flag is not hard-coded to `false`.
23. **`empty folder returns an empty playlist`** — an empty fixture subfolder asserts
    `200`, `items: []`, `count: 0`, `truncated: false`.
24. **`sends Cache-Control: no-store`** — success response header equals `no-store`.
25. **`a folder symlink inside the jail is followed with the navigated path`** —
    `?path=link-nested&recursive=true` returns `200` with `path === 'link-nested'`, items
    `link-nested/n1.png` and `link-nested/deeper/d1.webp`, each `dir` starting with
    `link-nested`, and no item `path` starts with `nested/` (the target's own location is
    never emitted). Skip if the symlink could not be created.
26. **`a folder symlink escaping the jail is refused or omitted`** — `?path=link-outside`
    returns `403 OUTSIDE_ROOT`; `GET ?recursive=true` at the root does not contain
    `link-outside/out.jpg`. Skip if the symlink could not be created.
27. **`logs fs.images`** — after a successful request, `env.events` contains an
    `fs.images` debug event with `path`, `recursive`, `count`, `truncated`, `ms`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by tests; `npm test` green on the dev machine (Windows 11) and in
      CI on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- [ ] The handler returns the shared response type from `@slydr/shared`; no locally
      declared duplicate of that interface exists in `server/`.
- [ ] `server/src/routes/fs.ts` is the only production file modified (the `shared`
      `ImagesResponse` type already exists from T004).
- [ ] The parameter parsing for `path`, `recursive` and `showHidden` uses T012's exported
      `readStringParam` / `readBooleanParam` rather than duplicating them.
- [ ] Tests live in `server/test/routes/` and use `createTestEnv`; none sets `SLYDR_ROOT`.
- [ ] Each labelled **Decision (not specified)** in §4 appears as a comment at the relevant
      line in the code.
- [ ] README unchanged — this endpoint is internal API surface with no new setup step.

## 8. Notes and gotchas

- **Never re-sort `items`.** Specification §4.2 says "The client must not re-sort", and the
  same applies to this route: the service already applied the collator order and the
  own-images-before-subdirectories rule, and §5.4 calls the result deterministic. A
  defensive `items.sort(...)` here would silently destroy the depth-first grouping.
- **`count` is not a total.** When `truncated` is true there are more images on disk than
  `count` reports. The configuration screen deliberately shows "Showing the first 20000
  images." rather than a real total, precisely so the server never has to walk a
  pathological tree to the end.
- **Express 5 query values are not always strings.** `req.query.path` is typed loosely and
  can be an array or an object. `String(req.query.path)` on an array yields `"a,b"`, which
  would then be resolved as a real relative path — a genuine (if exotic) way to reach a
  folder the user never asked for. Reject non-strings instead of coercing.
- **Do not add a `limit` or `offset` parameter.** The playlist is handed to the player in
  one piece (§8.3); paging it would require the player to re-fetch, which contradicts
  assumption A5 in §16.1 (the playlist is captured once when "Play slide show" is pressed).
- **A `HEAD` request runs the whole scan.** Nothing in Slydr issues one, so this is noted
  rather than optimised; do not add a special-case that returns a lie.
- **Assumption A6 (§16.1):** `showHidden` is shared between the explorer and the playlist
  on purpose. There is no separate "play hidden images" option in v1, so do not add a
  third flag.
- **`truncated` wording lives on the client.** The exact strings "N images found",
  "No playable images in this folder." and "Showing the first 20000 images." belong to the
  configuration screen (epic E14); this ticket only guarantees the data they are rendered
  from.
- **NFR-5 boundary.** The starting directory failing is a reportable error; anything deeper
  failing is a skip. Keeping that boundary crisp is what stops one bad folder in a photo
  library from making the slide show unplayable.
