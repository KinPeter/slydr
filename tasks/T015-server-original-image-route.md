# T015 — Expose `GET /api/image` for original image streaming

**Epic:** E7 — Original image streaming
**Spec sections:** §5.5, §3.3, §3.4, §3.5, §4.1 (FR-2.1, FR-2.4), §12.2, NFR-5, NFR-7
**Depends on:** T010
**Estimated size:** M

---

## 1. Context

The slide show player displays original, full-resolution images in an `<img>` element. It
builds each URL as `/api/image?path=<wire path>` from the playlist returned by the image
scan. This ticket implements the endpoint that serves those files. It must validate the
requested path through the path jail, refuse anything that is not a regular file with a
browser-renderable image **name**, and then stream the file with correct `Content-Type`,
`ETag`, `Last-Modified`, `Accept-Ranges`, `206 Partial Content` and `304 Not Modified`
behaviour.

Rather than hand-rolling streaming and conditional-request logic, the specification (§5.5)
delegates all of that to Express's `res.sendFile`, which is backed by the `send` library.
The substance of this ticket is therefore (a) passing the path to `sendFile` in a way that
cannot undermine the jail, (b) setting the cache headers correctly (`private`), (c)
translating every `sendFile` outcome — success, client abort, a file that vanished between
validation and streaming, a bad `Range` — into the right response without ever logging a
routine client abort as an error (a slide show cancelled mid-transfer is an everyday event,
not a fault), and (d) applying the symlink rule of FR-2.1: **a symlink is an image because of
its own name**, so `Content-Type` and the extension allowlist are derived from the *requested
name*, not from the file the link points at.

This ticket also creates two small modules that **T017 (`/api/thumb`) imports unchanged**, so
the two endpoints cannot drift: `server/src/security/imageTarget.ts` (the one definition of
"a path the image endpoints may serve") and `server/src/http/sendFileSafe.ts` (the one
definition of "stream a file and map the outcome").

## 2. Scope

### In scope

- Create `server/src/routes/image.ts` exporting the router factory
  `createImageRouter({ logger })` with a single `GET /` handler, and mount it at `/api/image`
  in `server/src/app.ts` (inside `createApp(config, logger)`).
- Create `server/src/security/imageTarget.ts`: `readPathParam(req)` and
  `resolveImageTarget(rawPath)` (query validation, `resolveSafe`, regular-file requirement
  `400 NOT_A_FILE`, extension allowlist on the requested name `415 UNSUPPORTED_IMAGE`).
- Create `server/src/http/sendFileSafe.ts`: `toSendFileRelativePath`, `sendFileAsync`,
  `handleSendFileError`, `resetFileHeaders`.
- Serving with `res.sendFile` and the exact options from specification §5.5.
- Cache headers (`Cache-Control` containing `private`), `X-Content-Type-Options: nosniff`,
  `Content-Type` derived from the requested name, and a locked-down CSP for SVG.
- Mapping of `sendFile` callback errors (§4.6).
- Tests per specification §12.2 (`206` Range, `304` conditional, error codes, `405`,
  `403 FORBIDDEN_HOST`, the symlink-name rule) and unit tests for the two new helper modules.

### Out of scope

- `resolveSafe`, `assertFile`, `toWirePath` and the cached jail root — **T010**.
- The app factory, method guard, host check and error envelope — T008/T009; consumed unchanged.
- Thumbnails: the sharp pipeline and cache are **T016**, the `/api/thumb` route is **T017**
  (it imports `imageTarget.ts` and `sendFileSafe.ts` from this ticket), the cache sweep is
  **T018**.
- Directory listing routes (`/api/fs/*`) — **T012**, **T014**.
- Image decoding, transcoding or resizing of any kind. This endpoint streams bytes
  unmodified. Formats browsers cannot render (HEIC/HEIF, TIFF, RAW) are deliberately not
  supported (FR-2.4) and answer `415`.
- Compression (`Content-Encoding`). Images are already compressed; do not add a compression
  middleware for this route.
- The player's preloading and decode logic (epic E15).
- This ticket builds its fixture inline in `beforeAll` through `createTestEnv`.

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** (`shared/`, `server/`, `client/`), **ESM**
(`"type": "module"`), TypeScript **strict**, **Node >= 22**, **Express 5**, with **Vitest +
Supertest** configured (`npm test`). Follow the import-extension convention already used in
`server/src`. Server code imports the file system as `import fs from 'node:fs/promises'` and
calls `fs.stat(...)` etc. (so `vi.spyOn(fs, ...)` works in tests).

### `@slydr/shared` (implemented)

```ts
export const IMAGE_EXTENSIONS: ReadonlySet<string>;
// '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'
export function isImageExtension(name: string): boolean;     // case-insensitive, basename contract
export function mimeTypeForName(name: string): string | null; // e.g. 'photo.JFIF' -> 'image/jpeg'
export function wireBasename(path: string): string;           // last segment of a wire path
```

`IMAGE_EXTENSIONS` is the single source of truth for what counts as an image (FR-2.4).
`mimeTypeForName` knows `.jfif` (`image/jpeg`), so no local override table is needed.
HEIC/HEIF, TIFF and RAW are intentionally absent.

### Server core (T008, T009)

- `createApp(config: ServerConfig, logger?: Logger): Express` installs, before any router, the
  `405 METHOD_NOT_ALLOWED` guard, the `403 FORBIDDEN_HOST` check, and the error middleware that
  renders every failure as `{ "error": { "code": "...", "message": "..." } }` with
  `Cache-Control: no-store` and no `errno`, raw OS message or absolute path.
- ```ts
  export class ApiError extends Error {
    readonly code: ApiErrorCode;
    readonly status: number;   // derived from code (§3.5): NOT_A_FILE 400, UNSUPPORTED_IMAGE 415, ...
    constructor(code: ApiErrorCode, message?: string, cause?: unknown);   // never pass a status
  }
  ```
  Express 5 forwards rejections from `async` handlers to the error middleware, so handlers
  simply `throw new ApiError(...)`.
- `server/src/logger.ts` (T009): `Logger` with `debug/info/warn/error(event: string, fields?)`
  and `errorFields(err)` (log-only error detail). `SLYDR_QUIET` is honoured by the logger
  itself.
- `ServerConfig` (`server/src/config/env.ts`) carries `port`, `rootOverride`, `cacheDir`,
  `cacheMaxMb`, `quiet`. This ticket needs none of them.

### `server/src/security/jail.ts` (implemented — T010)

```ts
export function setJailRoot(absolute: string): void;
export function getJailRoot(): string;                  // cached, realpath'd absolute jail root
export function resetJailRootForTests(): void;
export function resolveSafe(relPath: string): Promise<string>;
export function toWirePath(absPath: string): string;    // absolute-in-jail -> POSIX relative; root -> ""
export function assertDirectory(absPath: string): Promise<import('node:fs').Stats>;
export function assertFile(absPath: string): Promise<import('node:fs').Stats>;
export function mapFsError(err: unknown): ApiError;
```

`resolveSafe` implements specification §3.3: NUL byte, more than 4096 characters, leading `/`,
`^[A-Za-z]:` or `^\\\\` → `400 INVALID_PATH`; **on Windows only**, any backslash →
`400 INVALID_PATH` (on POSIX a backslash is an ordinary filename character); any `..` segment →
`403 OUTSIDE_ROOT`; `realpath` `ENOENT`/`ENOTDIR` → `404 NOT_FOUND`; real path not equal to the
real jail root and not beginning with it plus `path.sep` → `403 OUTSIDE_ROOT` (this is what
defeats symlinks, junctions and reparse points that leave the home folder). It returns the
**verified, realpath'd absolute path**. `assertFile(absPath)` returns the `Stats` for a regular
file and throws `400 NOT_A_FILE` otherwise. **Every file-system access must go through
`resolveSafe`; concatenating user input into a path anywhere else is a defect.**

### Test helpers (T008, T011, T012)

- `server/test/helpers/testConfig.ts` (T008): `makeTestConfig(overrides?)`.
- `server/test/helpers/fs.ts` (T011): `makeTempBase(prefix)`, `trySymlink(target, link, type)`
  (returns `false` instead of throwing on `EPERM`/`EACCES`), `removeTree(dir)`.
- `server/test/helpers/logger.ts` (T011): `createTestLogger()` returning
  `{ logger, events }` (captured `{ level, event, fields }` records).
- `server/test/helpers/testApp.ts` (T012):
  `createTestEnv({ prefix?, populate?(root, outside), config? })` creates a temp base with a
  `home` jail root and an `outside` sibling, `realpath.native`s them, calls `setJailRoot(root)`,
  builds `createApp(makeTestConfig(...), logger)`, and returns
  `{ app, base, root, outside, cacheDir, logger, events, cleanup }`. `cleanup()` calls
  `resetJailRootForTests()` and removes the tree. **Tests never set `SLYDR_ROOT`.**

## 4. Implementation detail

### 4.1 Files

| Action | Path |
|---|---|
| Create | `server/src/routes/image.ts` (`createImageRouter`) |
| Create | `server/src/security/imageTarget.ts` |
| Create | `server/src/http/sendFileSafe.ts` |
| Modify | `server/src/app.ts` — in `createApp`, add `app.use('/api/image', createImageRouter({ logger }))` after the guards and before the error middleware |
| Create | `server/test/routes/image.test.ts` |
| Create | `server/test/security/imageTarget.test.ts` |
| Create | `server/test/http/sendFileSafe.test.ts` |

If other routers are already mounted in `createApp` (for example `/api/fs`), add the new line
alongside them; do not restructure the file.

### 4.2 `server/src/security/imageTarget.ts` — the single definition of a servable image

```ts
import type { Stats } from 'node:fs';
import type { Request } from 'express';

export interface ImageTarget {
  absPath: string;  // verified, realpath'd, inside the jail
  stats: Stats;     // stat of absPath, already known to be a regular file
  name: string;     // last segment of the REQUESTED path: a symlink's own name (FR-2.1)
}

/** Reads the `path` query parameter. Throws 400 INVALID_PARAM unless it is a single string. */
export function readPathParam(req: Request): string;

/** resolveSafe -> assertFile -> isImageExtension(name). */
export async function resolveImageTarget(rawPath: string): Promise<ImageTarget>;
```

`readPathParam(req)`, validation performed before any file-system access:

1. `const v = req.query.path`.
2. `v === undefined` → `new ApiError('INVALID_PARAM', 'Query parameter "path" is required.')`.
   **Decision (not specified):** a missing `path` is `INVALID_PARAM` rather than defaulting to
   `""`. The default for directory endpoints is the jail root, but a directory can never be an
   image, so defaulting would only produce a confusing `NOT_A_FILE`. An **explicitly empty**
   `?path=` is a present string, is passed to `resolveSafe`, resolves to the jail root and
   yields `400 NOT_A_FILE`.
3. `typeof v !== 'string'` (a repeated parameter arrives as an array and a bracketed one as an
   object in Express 5) → `INVALID_PARAM` with the message
   `Query parameter "path" must be a single string.` Never coerce with `String(v)`:
   `String(['a','b'])` is `"a,b"`, which would resolve as a real relative path the caller did
   not ask for.
4. Return `v`. Do not duplicate any of `resolveSafe`'s rules (NUL, length, absolute, `..`).

`resolveImageTarget(rawPath)`:

1. `const absPath = await resolveSafe(rawPath)`. Let its `ApiError`s propagate: `INVALID_PATH`,
   `OUTSIDE_ROOT`, `NOT_FOUND`, `ACCESS_DENIED`.
2. `const stats = await assertFile(absPath)`. A directory (including one whose *name* ends in
   `.jpg`) yields `400 NOT_A_FILE`.
3. `const name = wireBasename(rawPath)` — the last segment of the **requested** path. If the
   file is reached through a symlink, this is the link's name, which is the name the listing
   service classified (FR-2.1) and the name the playlist carries.
   `if (!isImageExtension(name)) throw new ApiError('UNSUPPORTED_IMAGE')` (**415**).
   `.JPG` and `.Jpg` are accepted; `notes.txt`, `photo.heic` and an extensionless `README` are
   `415`; a file literally named `.jpg` has no extension and is `415`.
4. Return `{ absPath, stats, name }`.

**Decision (not specified, implements spec FR-2.1/§5.5):** the allowlist is tested on the
requested name, not on the resolved target's name. Consequences, all intended: a symlink
`x.jpg → data.bin` is served (the listing shows it as an image, so the endpoint must serve
it); a symlink `photo → photo.jpg` (no extension) answers `415` (the listing shows it as a
plain file); a folder symlink anywhere on the path (`dirlink/inner.jpg`) is followed as long
as `resolveSafe` proves the real path is inside the jail. Safety does not depend on the name:
containment is decided by `resolveSafe` on the real path, and `Content-Type` plus `nosniff`
(§4.5) govern how the browser treats the bytes.

### 4.3 Handler algorithm — `server/src/routes/image.ts`

```ts
export function createImageRouter({ logger }: { logger: Logger }): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const t0 = Date.now();
    const rawPath = readPathParam(req);                          // 1
    const { absPath, name } = await resolveImageTarget(rawPath); // 2-4
    const relative = toSendFileRelativePath(absPath);            // 5 (§4.4)
    setImageHeaders(res, name, absPath);                         // 6 (§4.5)
    try {
      await sendFileAsync(res, relative, sendOptions(getJailRoot())); // 7 (§4.6)
    } catch (err) {
      handleSendFileError(err, req, res, logger);                // returns, or throws ApiError
      return;
    }
    logger.debug('image.served', { path: rawPath, status: res.statusCode, ms: Date.now() - t0 });
  });
  return router;
}
```

Steps: validate `path` (§4.2) → `resolveSafe` → `assertFile` → extension check on the requested
name → derive the `root`-relative path (§4.4) → set headers (§4.5) → `sendFile` and translate
its outcome (§4.6).

### 4.4 Passing the path to `sendFile` safely — `toSendFileRelativePath`

Specification §5.5 requires the call
`res.sendFile(<path>, { root: jailRoot, dotfiles: 'allow', acceptRanges: true, lastModified: true, etag: true, maxAge: '1h' })`.
The `root` option changes what the first argument means, and getting it wrong undoes the jail:

- When `root` is supplied, the first argument is a path **relative to `root`**. The `send`
  library joins it onto `root` and rejects any `..` component. Passing an *absolute* path
  together with `root` produces a doubled, non-existent path.
- The first argument must **never** be the raw query string. The raw value passed
  `resolveSafe`, but `resolveSafe` also follows symlinks; the jail's guarantee is about
  **`absPath`**. The argument handed to `sendFile` must be *derived from `absPath`* and
  nothing else (the file streamed is the resolved target, whatever the requested name was).

```ts
// server/src/http/sendFileSafe.ts
import path from 'node:path';
import { getJailRoot } from '../security/jail.js';

/**
 * Converts an absolute path already verified by resolveSafe into the root-relative,
 * forward-slash path that res.sendFile expects when the `root` option is set.
 * Throws a plain Error (a programming error, never a request error) if the result is not a
 * clean relative path inside the root.
 */
export function toSendFileRelativePath(absPath: string, root: string = getJailRoot()): string {
  const rel = path.relative(root, absPath);          // win32: 'Pictures\\2024\\a.jpg'
  if (rel === '' || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) {
    throw new Error('Verified path is not inside the jail root.');
  }
  const posix = rel.split(path.sep).join('/');       // always forward slashes
  if (posix.split('/').some((segment) => segment === '..')) {
    throw new Error('Relative path contains a parent segment.');
  }
  return posix;
}
```

Notes:

- The optional `root` parameter lets the helper be unit tested without initialising the jail.
  This is the same transformation `toWirePath(absPath)` performs; the explicit version keeps
  the guarantees visible at the call site. `path.relative` is purely lexical, so its safety
  depends on both arguments being realpath'd (`absPath` from `resolveSafe`, `root` from the
  cached jail root); the `..` assertions are defence in depth.
- **Cross-platform.** On Windows `path.relative` yields backslashes; split on `path.sep` and
  join with `/` so the value is identical everywhere.
- **Percent and special characters.** Express's `sendFile` applies `encodeURI` to the path and
  `send` then calls `decodeURIComponent`, so files named `100% real.jpg`, `a #1.jpg`,
  `what?.jpg` or `caf\u00e9 photo.jpg` round-trip. Do **not** pre-encode the relative path
  yourself; double-encoding turns `%` into `%2525` and the file is not found. A test covers it.
- A name containing a literal backslash (legal on POSIX) is a normal name on POSIX: the
  listing returns it and `resolveSafe` accepts it. On Windows a backslash can never occur in a
  name. Nothing special is needed.
- A name containing a lone UTF-16 surrogate makes `encodeURI` throw `URIError` inside
  `sendFile`'s synchronous prologue; `sendFileAsync` (§4.6) wraps the call so it is mapped to
  `READ_FAILED` instead of crashing the request.

The `sendFile` options (`sendOptions(root)` in `image.ts`):

```ts
{ root, dotfiles: 'allow', acceptRanges: true, lastModified: true, etag: true, maxAge: '1h' }
```

`dotfiles: 'allow'` is required because home directories routinely hold images under dot
folders (for example `~/.local/share/backgrounds`) and the jail, not `send`, is the access
control. `showHidden` is an explorer concern; a client that has the wire path of a hidden
image may fetch it. Use exactly these option values.

### 4.5 Response headers

`send` supplies `Content-Length`, `Accept-Ranges: bytes`, `ETag` (weak, size+mtime based),
`Last-Modified`, the `206`/`Content-Range` handling and the `304` handling. The route sets
the following **before calling `sendFile`** (`setImageHeaders`):

| Header | Value | Why |
|---|---|---|
| `Cache-Control` | `private, max-age=3600` | §5.5: must include `private`. |
| `X-Content-Type-Options` | `nosniff` | §3.4. Stops a browser reinterpreting the bytes as another type. |
| `Content-Type` | `mimeTypeForName(name)` | Derived from the **requested name** (FR-2.1). Always set explicitly. |
| `Content-Security-Policy` | only for SVG: `default-src 'none'; style-src 'unsafe-inline'; sandbox` | See below. |

**`Cache-Control` and the `maxAge` option.** `maxAge: '1h'` makes `send` emit
`Cache-Control: public, max-age=3600`. §5.5 requires `private`, and a user's personal photos
must not be stored by a shared cache. `send` only writes `Cache-Control` when the response does
not already have one, so the route sets it first and still passes `maxAge: '1h'` verbatim.
**Do not rely on `maxAge` alone; assert the final header contains `private`** (§6). Since the
pre-set header is also present on `206` and `304` responses, those carry `private` too.

**`Content-Type` from the requested name.** `send` would derive the type from the *resolved*
path, so a link `x.jpg → data.bin` would go out as `application/octet-stream` and, combined
with `nosniff`, not render. The route therefore sets the type from `mimeTypeForName(name)`
(shared T005; `.jfif` → `image/jpeg`, `.svg` → `image/svg+xml`, and so on) and `send` leaves
an existing `Content-Type` untouched. `name` already passed `isImageExtension`, so
`mimeTypeForName` is non-null; if it ever returns `null`, treat it as a programming error and
throw a plain `Error`. There is no local override table.

**SVG.** An SVG is XML that can contain `<script>`. Rendered through `<img>` scripts never run,
but a browser navigated directly to `/api/image?path=evil.svg` would execute script in the
Slydr origin. **Decision (not specified):** set
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` when **either**
the requested name **or** the resolved target's extension is `.svg`
(`path.extname(name).toLowerCase() === '.svg' || path.extname(absPath).toLowerCase() === '.svg'`),
so a symlink in either direction cannot dodge the policy. `sandbox` disables script execution
and gives the document an opaque origin; it has no effect on `<img>` rendering.

No `Content-Disposition` header is set. No `Content-Encoding` is set.

### 4.6 `server/src/http/sendFileSafe.ts` — streaming and outcome mapping

Four exports. `T017` reuses all of them for thumbnails, so they must not mention images.

```ts
import type { Request, Response } from 'express';
import type { Logger } from '../logger.js';

export type SendFileOptions = NonNullable<Parameters<Response['sendFile']>[1]>;

/** Promise wrapper around res.sendFile. Also converts a synchronous throw into a rejection. */
export function sendFileAsync(res: Response, filePath: string, options: SendFileOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      res.sendFile(filePath, options, (err?: Error) => (err ? reject(err) : resolve()));
    } catch (err) {
      reject(err);          // e.g. URIError from encodeURI on a lone surrogate
    }
  });
}

/** Removes the headers a successful response would carry so an error body is not cached. */
export function resetFileHeaders(res: Response): void;

/** Returns normally (abort, 416, 412, headers-already-sent) or throws an ApiError. */
export function handleSendFileError(err: unknown, req: Request, res: Response, logger: Logger): void;

export function toSendFileRelativePath(absPath: string, root?: string): string;   // §4.4
```

`res.sendFile` reports completion and failure through a callback and, when a callback is
supplied, **does not call `next(err)`**; the route produces the response. The callback fires
when the response finishes (including `HEAD`, `206` and `304` responses), or with an error.

`handleSendFileError(err, req, res, logger)` algorithm:

1. **Client abort — not an error.** If `err.code` is `'ECONNABORTED'`, `'EPIPE'`,
   `'ECONNRESET'` or `'ERR_STREAM_PREMATURE_CLOSE'`, or `res.destroyed` /
   `req.socket?.destroyed` is already true, the client navigated away or cancelled (routine in
   a slide show that advances or is stopped mid-download, and in a grid that cancels thumbnail
   requests). **Log at `debug` level only** (`logger.debug('sendfile.aborted', ...)`), never
   `warn`/`error`, and write nothing: the socket is gone. Return without throwing so the error
   middleware does not log a stack trace. (NFR-5; an `error` line per cancelled image would
   flood the log.) Do not test `req.aborted`: it is deprecated.
2. **Headers already sent.** If `res.headersSent` is true (mid-stream failure), a JSON envelope
   can no longer be sent. Log at `error` with `errorFields(err)` (absolute path permitted in
   logs, NFR-10) as `sendfile.failed` and call `res.destroy()` so the client sees a failed
   transfer. Return without throwing.
3. **Unsatisfiable range / failed precondition.** If `err.status === 416`: `send` has populated
   `err.headers['Content-Range']` (`bytes */<size>`). Call `resetFileHeaders`, set
   `Content-Range` from `err.headers`, respond `res.status(416).end()` with no body. There is
   no `ApiErrorCode` for range failures in §3.5; it is a protocol-level condition. Likewise
   `err.status === 412`: `resetFileHeaders`, `res.status(412).end()`.
4. **File vanished — race.** `err.code === 'ENOENT'`, `'ENOTDIR'` or `err.status === 404`
   (deleted between `assertFile` and streaming): `resetFileHeaders(res)` then
   `throw new ApiError('NOT_FOUND')` → **404**.
5. **Permission.** `err.code` `'EACCES'` or `'EPERM'`: `resetFileHeaders`, then
   `throw new ApiError('ACCESS_DENIED')` → **403** (the §3.5 code for exactly this condition).
6. **Anything else** (including `EISDIR`, `EMFILE`, `EIO`, `URIError`, unknown `send` status,
   non-`Error` throwables): log at `error` as `sendfile.failed` with `errorFields(err)`,
   `resetFileHeaders`, then `throw new ApiError('READ_FAILED', undefined, err)` → **500**. The
   message is fixed text; the original error is attached as `cause` for the logger only and
   never reaches the body (§3.4).

**Resetting headers before an error response.** Because callers pre-set `Cache-Control`,
`Content-Type`, `ETag` and possibly a CSP, a failure after those are set would otherwise return
an error body carrying `Cache-Control: private, max-age=3600` — the browser would cache the
*failure* for an hour. `resetFileHeaders(res)` (no-op if `res.headersSent`) removes
`Cache-Control`, `Content-Type`, `Content-Security-Policy`, `Content-Length`, `ETag`,
`Last-Modified`, `Accept-Ranges`, `Content-Range`. `X-Content-Type-Options: nosniff` may stay.
The error middleware then renders the envelope with its own headers (`no-store`).

### 4.7 `HEAD`

Express routes `HEAD` to the `GET` handler; `send` sets the same headers and omits the body.
No extra code. The callback still fires.

### 4.8 Logging

On success, log a single **`debug`** line `image.served`
(`{ path, status, ms }`) — debug, not info, since a slide show makes one request per slide.
Errors other than client aborts log at their natural level through `handleSendFileError`.
`SLYDR_QUIET` is honoured by the logger. Logs may contain absolute paths; bodies may not.

### 4.9 Error mapping (complete)

| Condition | Code | HTTP | Raised by |
|---|---|---|---|
| `path` missing, repeated (array) or object-valued | `INVALID_PARAM` | 400 | `readPathParam` |
| NUL, > 4096 chars, leading `/`, `C:`/UNC pattern; any backslash **on Windows** | `INVALID_PATH` | 400 | `resolveSafe` |
| `..` segment, or real path escapes the root (symlink, junction) | `OUTSIDE_ROOT` | 403 | `resolveSafe` |
| Target does not exist (including `file.jpg/child`) | `NOT_FOUND` | 404 | `resolveSafe` |
| Target is a directory / not a regular file | `NOT_A_FILE` | 400 | `assertFile` |
| Requested name's extension not in `IMAGE_EXTENSIONS` (`.txt`, `.heic`, none) | `UNSUPPORTED_IMAGE` | 415 | `resolveImageTarget` |
| File vanished while streaming (`ENOENT`) | `NOT_FOUND` | 404 | `handleSendFileError` |
| `EACCES` / `EPERM` reading the file | `ACCESS_DENIED` | 403 | `resolveSafe` or `handleSendFileError` |
| Any other I/O failure | `READ_FAILED` | 500 | `handleSendFileError` |
| `Range` not satisfiable | — (protocol) | 416, empty body, `Content-Range: bytes */<size>` | `handleSendFileError` |
| `Host` not loopback | `FORBIDDEN_HOST` | 403 | app middleware |
| Method not `GET`/`HEAD` | `METHOD_NOT_ALLOWED` | 405 | app middleware |
| Client aborted | none | none (no response, `debug` log) | `handleSendFileError` |

### 4.10 Cross-platform notes

| Concern | win32 | darwin | linux |
|---|---|---|---|
| `path.relative` output | backslashes — converted to `/` (§4.4) | `/` | `/` |
| Open file handles | `send` opens a read stream; Windows locks an open file against deletion/rename until it closes, so a test that deletes a served file must wait for the response to finish first | no lock | no lock |
| Case-insensitive extension | `ext.toLowerCase()` rule handles `.JPG` identically everywhere | same | file names are case-sensitive; `.JPG` is a real distinct name |
| Symlinks in fixtures | need Administrator/Developer Mode for file links; use `junction` for directories; skip file-symlink cases when `trySymlink` returns `false` | unprivileged | unprivileged |
| Backslash in a request path | `400 INVALID_PATH` | ordinary character (`404` if absent) | same as darwin |
| Temp dir | 8.3 short names possible | `/var` → `/private/var` symlink | plain |

`createTestEnv` already `realpath.native`s the fixture root (macOS and Windows short-name
pitfalls; see T010).

## 5. Acceptance criteria

- [ ] `server/src/routes/image.ts` exports `createImageRouter`; `server/src/security/imageTarget.ts`
      exports `readPathParam`, `resolveImageTarget` and `ImageTarget`;
      `server/src/http/sendFileSafe.ts` exports `toSendFileRelativePath`, `sendFileAsync`,
      `handleSendFileError`, `resetFileHeaders`; `createApp` mounts the router at `/api/image`.
- [ ] A grep of `routes/image.ts` shows `res.sendFile` is reached with the options `root`,
      `dotfiles: 'allow'`, `acceptRanges: true`, `lastModified: true`, `etag: true`,
      `maxAge: '1h'` and **no** `req.query` value is passed as its first argument.
- [ ] The first argument to `sendFile` is the string returned by `toSendFileRelativePath`,
      which contains only forward slashes, no leading slash, no drive letter, and no `..`
      segment, on every platform.
- [ ] `GET /api/image?path=photo.jpg` returns `200`, body bytes identical to the file, and
      `Content-Type: image/jpeg`.
- [ ] Correct `Content-Type` for `.jpg`, `.jpeg`, `.jfif` (`image/jpeg`), `.png`, `.gif`,
      `.webp`, `.avif`, `.bmp`, `.svg` (`image/svg+xml`), taken from `mimeTypeForName`; no
      local MIME override table exists.
- [ ] Responses carry `Accept-Ranges: bytes`, a non-empty `ETag` and a `Last-Modified`.
- [ ] `Range: bytes=0-99` returns `206` with `Content-Range: bytes 0-99/<size>` and exactly
      100 body bytes; an unsatisfiable range returns `416` with `Content-Range: bytes */<size>`.
- [ ] A request with `If-None-Match` equal to the returned `ETag` returns `304` with an empty
      body; `If-Modified-Since` equal to `Last-Modified` also returns `304`.
- [ ] `Cache-Control` on `200`, `206` and `304` responses contains `private` and
      `max-age=3600`, and does not contain `public`.
- [ ] `X-Content-Type-Options: nosniff` is present; SVG responses carry the restrictive
      `Content-Security-Policy`, including when the SVG is reached through a differently
      named symlink.
- [ ] `.txt`, `.heic` and extensionless files return `415` with `UNSUPPORTED_IMAGE`;
      upper-case `.JPG` is served.
- [ ] **Symlink naming (FR-2.1):** a symlink `x.jpg` whose target `data.bin` holds PNG bytes is
      served `200` with `Content-Type: image/jpeg` and the target's bytes; a symlink named
      `photo-link` (no extension) pointing at `photo.jpg` answers `415`; a path through a
      folder symlink inside the root (`dirlink/inner.jpg`) is served.
- [ ] A directory (including one named `folder.jpg`) returns `400 NOT_A_FILE`; the jail root
      (`?path=`) returns `400 NOT_A_FILE`.
- [ ] A missing file returns `404 NOT_FOUND`; `?path=../../../etc/passwd` returns
      `403 OUTSIDE_ROOT`; an absolute, drive-letter or UNC path returns `400 INVALID_PATH`
      (a backslash path returns `400 INVALID_PATH` on Windows only); a symlink to outside the
      root returns `403 OUTSIDE_ROOT`.
- [ ] A missing or repeated `path` returns `400 INVALID_PARAM`.
- [ ] A file with a space, `%`, `#`, and non-ASCII characters in its name is served correctly.
- [ ] Error responses do not carry `Cache-Control: private, max-age=3600` and their bodies
      contain no absolute path, `errno` or raw OS message.
- [ ] `handleSendFileError` does not log at `warn`/`error` for `ECONNABORTED`, `EPIPE`,
      `ECONNRESET` or `ERR_STREAM_PREMATURE_CLOSE`, and the code does not reference
      `req.aborted`.
- [ ] `POST /api/image` returns `405`; `Host: evil.example` returns `403 FORBIDDEN_HOST`;
      `HEAD` returns `200` with headers and no body.

## 6. Tests to write

Per specification §12.2 ("`206` Range for originals, and the `405` / `403 FORBIDDEN_HOST`
guards"). Files: `server/test/routes/image.test.ts` (Supertest),
`server/test/security/imageTarget.test.ts`, `server/test/http/sendFileSafe.test.ts`.

### Fixture (`image.test.ts`)

Use `createTestEnv({ prefix:
'slydr-image-', populate })` from `server/test/helpers/testApp.ts` in `beforeAll` and
`env.cleanup()` in `afterAll`. Never set `SLYDR_ROOT`. `populate(root, outside)` creates:

```
home/
  photo.jpg            # a few real bytes (JPEG SOI/EOI marker bytes are sufficient)
  big.jpg              # Buffer.alloc(2048, 0x61): large enough for Range tests
  pic.png              # a valid 1x1 PNG (base64 iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)
  a.jpeg  a.jfif  a.gif  a.webp  a.avif  a.bmp  a.svg    # small byte buffers; <svg/> text for the svg
  UPPER.JPG            # upper-case extension
  notes.txt   photo.heic   README    # unsupported
  folder.jpg/          # a DIRECTORY named like an image
    inner.jpg
  caf\u00e9 photo #1 100%.jpg   # unicode + space + hash + percent
  .hidden.jpg          # dotfile image
  data.bin             # PNG bytes under a non-image name
  link-inside.jpg  -> photo.jpg                  # symlink inside the root, same extension
  x.jpg            -> data.bin                   # symlink whose NAME says image, target says not (FR-2.1)
  photo-link       -> photo.jpg                  # symlink without extension
  svg-as-jpg.jpg   -> a.svg                      # symlink hiding an SVG behind a .jpg name
  dirlink          -> folder.jpg                 # folder symlink inside the root
  link-outside.jpg -> ../outside/secret.jpg      # symlink escaping the root
outside/
  secret.jpg
```

Use `trySymlink` from `server/test/helpers/fs.ts`; dependent cases call `ctx.skip()` with a
reason when it returned `false`. For win32 where file symlinks may be impossible, also create
`dirlink-outside` as a **junction** to `outside/` (no privilege needed; `trySymlink(...,
'junction')`) and request `?path=dirlink-outside/secret.jpg`.

### Cases — success

1. `serves a jpg with the correct Content-Type and bytes` — `200`; `Content-Type` matches
   `/^image\/jpeg/`; `res.body` equals the file's bytes (use `.buffer(true).parse(...)`);
   `Content-Length` equals the size.
2. `Content-Type for every supported extension` — table over `.jpg`/`.jpeg`/`.jfif`
   (`image/jpeg`), `.png`, `.gif`, `.webp`, `.avif`, `.bmp` (`image/bmp`), `.svg`
   (`image/svg+xml`): each `200` with the type `mimeTypeForName` returns.
3. `upper-case extension is accepted` — `UPPER.JPG` → `200`, `image/jpeg`.
4. `advertises range support and validators` — `Accept-Ranges: bytes`, `ETag` non-empty,
   `Last-Modified` parseable by `Date.parse`.
5. `Range request returns 206` — `big.jpg` with `Range: bytes=0-99`: `206`,
   `Content-Range: bytes 0-99/2048`, `Content-Length: 100`, body length 100.
6. `open-ended and suffix ranges` — `bytes=2000-` → `206`, 48 bytes; `bytes=-10` → `206`, 10 bytes.
7. `unsatisfiable Range returns 416` — `bytes=5000-6000` → `416`, `Content-Range: bytes */2048`,
   empty body, no `Cache-Control: ...max-age=3600`.
8. `conditional GET returns 304 for a matching If-None-Match` — fetch once, read `ETag`,
   fetch again with `If-None-Match: <etag>` → `304`, empty body, `ETag` still present.
9. `conditional GET returns 304 for If-Modified-Since` — use the `Last-Modified` value.
10. `a non-matching If-None-Match returns 200`.
11. `Cache-Control contains private` — on `200`, `206` and `304`: includes `private` and
    `max-age=3600`, not `public`. The required assertion for §5.5.
12. `nosniff is set` — `X-Content-Type-Options: nosniff`.
13. `svg responses carry a restrictive CSP` — `Content-Security-Policy` contains
    `default-src 'none'` and `sandbox` for `a.svg`; a `.png` response has no CSP header.
14. `a symlink hiding an SVG behind a .jpg name still gets the CSP` — `svg-as-jpg.jpg` → `200`,
    `Content-Type: image/jpeg`, CSP present. Skip if the symlink could not be created.
15. `HEAD returns headers without a body` — `200`, same `Content-Type`, `Content-Length`,
    `Cache-Control` as `GET`, empty body.
16. `unicode, space, hash and percent in the file name` — `?path=` with
    `encodeURIComponent('caf\u00e9 photo #1 100%.jpg')` → `200` and the correct bytes (pins the
    "do not pre-encode" rule).
17. `a dotfile image is served` — `.hidden.jpg` → `200` (`dotfiles: 'allow'`).
18. `a symlink inside the root is served` — `link-inside.jpg` → `200`, same bytes as
    `photo.jpg`. Skip if the symlink could not be created.
19. `a nested path is served` — `folder.jpg/inner.jpg` → `200`.
20. `a symlink is an image because of its own name (FR-2.1)` — `x.jpg` (target `data.bin`,
    PNG bytes) → `200`, `Content-Type: image/jpeg`, bytes equal to `data.bin`. Skip if the
    symlink could not be created.
21. `a folder symlink inside the root is followed` — `dirlink/inner.jpg` → `200`, same bytes
    as `folder.jpg/inner.jpg`. Skip if the symlink could not be created.
22. `a debug line is logged per served image` — the test logger captured an `image.served`
    event at level `debug`, and no `warn`/`error`.

### Cases — errors

23. `415 for unsupported names` — `notes.txt`, `photo.heic`, `README` each → `415`,
    `error.code === 'UNSUPPORTED_IMAGE'`.
24. `a symlink without an image extension is 415` — `photo-link` (target `photo.jpg`) → `415`,
    even though the target is a JPEG (FR-2.1). Skip if the symlink could not be created.
25. `400 NOT_A_FILE for a directory` — `?path=folder.jpg` and `?path=` (the jail root) →
    `400 NOT_A_FILE`.
26. `404 NOT_FOUND` — `?path=missing.jpg` and `?path=photo.jpg/child` → `404 NOT_FOUND`.
27. `403 OUTSIDE_ROOT for traversal` — `?path=../outside/secret.jpg`,
    `?path=../../../etc/passwd`, `?path=sub/../../outside/secret.jpg` → `403 OUTSIDE_ROOT`.
    **NFR-7 traversal test for this endpoint.**
28. `403 OUTSIDE_ROOT for a symlink escape` — `link-outside.jpg` → `403 OUTSIDE_ROOT`; on
    win32 also the junction case `dirlink-outside/secret.jpg`. Skip gracefully if the fixture
    could not be created. **NFR-7 symlink-escape test.**
29. `400 INVALID_PATH` — `/etc/passwd`, `C:/Windows/win.ini`, a UNC path
    (`%5C%5Cserver%5Cshare%5Cx.jpg`), `a%00.jpg` → `400 INVALID_PATH` on every platform.
30. `a backslash in the path` — `it.runIf(process.platform === 'win32')`:
    `photo.jpg%5C..%5Cx` → `400 INVALID_PATH`. `it.skipIf(process.platform === 'win32')`: the
    same request is an ordinary missing name → `404 NOT_FOUND` (on POSIX a backslash is a
    legal filename character, spec §3.3).
31. `400 INVALID_PARAM` — no `path` parameter; `?path=a.jpg&path=b.jpg`.
32. `repeated path is INVALID_PARAM, never "first wins"` — `?path=photo.jpg&path=big.jpg` is
    `400 INVALID_PARAM` even though both files exist (validation precedes the file system).
33. `error responses are not cacheable and leak nothing` — for the 404, 400 and 415 cases:
    no `Cache-Control` containing `max-age=3600`; body is exactly `{ error: { code, message } }`;
    the serialised body contains neither the fixture's absolute path nor `ENOENT`/`EACCES`,
    nor keys `errno`, `syscall`, `stack`.
34. `405 for write methods` — `POST`, `PUT`, `DELETE`, `PATCH` → `405 METHOD_NOT_ALLOWED`.
35. `403 FORBIDDEN_HOST` — `Host: evil.example` → `403 FORBIDDEN_HOST`; controls with
    `Host: 127.0.0.1:4317`, `localhost` and `[::1]:4317` → `200`.
36. `ACCESS_DENIED for an unreadable file` — `it.skipIf(process.platform === 'win32' ||
    process.getuid?.() === 0)`: `fs.chmod(file, 0o000)`, request → `403 ACCESS_DENIED`; restore
    `0o644` in a `finally`.

### Unit tests — `imageTarget.test.ts` (set the jail with `createTestEnv`)

37. `readPathParam rejects undefined, arrays and objects and accepts strings` (fake `req`).
38. `resolveImageTarget returns absPath, stats and the requested name for a valid image`.
39. `resolveImageTarget rejects a directory with NOT_A_FILE and a text file with UNSUPPORTED_IMAGE`.
40. `resolveImageTarget treats uppercase extensions as images` — `PHOTO.JPG` accepted.
41. `name is the requested name, not the target's` — symlink `x.jpg → data.bin`: `name === 'x.jpg'`,
    `absPath` ends in `data.bin`; symlink `photo-link → photo.jpg` rejects `UNSUPPORTED_IMAGE`.
    Skip if symlinks are unavailable.

### Unit tests — `sendFileSafe.test.ts`

`toSendFileRelativePath` (pass an explicit `root`, no jail needed):

42. `returns forward-slash relative paths` — `['photo.jpg']`, `['Pictures','2024','a.jpg']` built
    with `path.join(root, ...parts)` → `parts.join('/')`.
43. `never returns a leading slash or backslash`.
44. `throws for a path outside the root`, for the root itself, and for a sibling directory
    sharing the root's name prefix (`<root>Evil/x.jpg`).
45. `does not double-encode` — the result for `a #1 100%.jpg` is the literal string.

`handleSendFileError` (fake `req`/`res`, `createTestLogger()`):

46. `ECONNABORTED and EPIPE are not errors` — returns without throwing, writes nothing; no
    `warn`/`error` event, a `debug` event.
47. `ECONNRESET, ERR_STREAM_PREMATURE_CLOSE and a destroyed response behave like an abort`.
48. `ENOENT before headers are sent throws NOT_FOUND (404)` and the image headers were removed.
49. `err.status 404 throws NOT_FOUND`.
50. `EACCES and EPERM throw ACCESS_DENIED (403)`.
51. `EISDIR, EMFILE, EIO and URIError throw READ_FAILED (500)`, `cause` set to the original
    error, `message` free of the original message and any path; an `error` event was logged.
52. `headers already sent: destroys the socket and does not throw` — `res.headersSent = true`;
    `res.destroy` called and one `error` event logged.
53. `416 responds with Content-Range and no body`; `412 responds with no body`.
54. `a thrown value that is not an Error` (string, `null`, `undefined`) → `READ_FAILED`.
55. `resetFileHeaders removes the success headers and keeps nosniff; is a no-op after headers are sent`.
56. `sendFileAsync rejects (does not throw) when res.sendFile throws synchronously`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by tests; `npm test` green on the dev machine (Windows 11) and in CI
      on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- [ ] Symlink-, junction- and permission-dependent cases **skip with a reason**, never fail,
      where their fixtures cannot be created.
- [ ] No request value is ever passed to `sendFile` or concatenated into a path; a repository
      grep for `path.join`/`path.resolve` applied to `req.query` in `routes/image.ts` and
      `imageTarget.ts` returns nothing.
- [ ] `imageTarget.ts` and `sendFileSafe.ts` contain no image-route-specific code that would
      stop T017 importing them for thumbnails.
- [ ] Each **Decision (not specified)** in §4 appears as a comment at the relevant line.
- [ ] Routine client aborts never log above `debug`.
- [ ] README unchanged: internal API surface with no new setup step. (The excluded-formats
      note, FR-2.4, is owned by T041.)

## 8. Notes and gotchas

- **The `root` option reinterprets the first argument.** With `root` set, the argument is a
  path relative to `root`. Handing it an absolute path (or the raw query string) either fails
  or re-derives a path outside the verified `absPath`. Always derive the relative path from the
  already-verified absolute path (§4.4). This is the most likely place for an implementer to
  break the jail.
- **`maxAge` produces `public`.** `send` writes `Cache-Control: public, max-age=3600` for
  `maxAge: '1h'`. The route pre-sets `private, max-age=3600` so `send` leaves it alone. Verify
  with a test; a future `send` upgrade changing that behaviour will be caught.
- **Pre-set headers must be cleaned on failure**, or the browser caches the error for an hour
  (§4.6).
- **Express `sendFile` with a callback does not call `next(err)`.** Supplying the callback and
  mapping explicitly is what keeps aborts quiet and errors enveloped.
- **Aborts are the common failure.** The player prefetches the next two images and cancels when
  the user skips; expect `ECONNABORTED`/`EPIPE` constantly. They are not errors.
- **Windows file locks.** An in-flight `send` stream holds the file open; on Windows that
  blocks deletion. Tests that delete a file must wait for the response to end first, and
  `env.cleanup()` must run after all requests have finished (otherwise `EBUSY`/`EPERM`).
- **Name versus target (FR-2.1, owner decision).** Image-ness and `Content-Type` come from the
  requested name; the bytes come from the resolved target. A link named `x.jpg` pointing at a
  non-image is therefore sent as `image/jpeg`; the browser's `<img>` decoder will fail and the
  player skips it. That is the accepted cost of "the name the user sees is the truth", and it
  keeps the explorer, the playlist, `/api/image` and `/api/thumb` in agreement. Containment is
  never decided by the name.
- **TOCTOU.** Between `resolveSafe` and `sendFile` the file may be replaced. For a single-user
  loopback read-only local tool that requires local write access to the user's own home
  directory, this is accepted (see T010). `sendFile`'s own `stat` plus the ENOENT mapping keep
  the failure mode benign.
- **Do not add compression, `Content-Disposition` or `Vary` headers.** `send` already sets what
  is needed; images are precompressed.
- **`304` and `Cache-Control`.** The `Cache-Control` header is on the `304` response too, which
  is correct and lets the browser extend the freshness lifetime.
- **Weak ETags.** `send` generates weak ETags from size and mtime. They are sufficient here; do
  not compute content hashes (that would force a full read per request). Thumbnails (T017) use a
  strong ETag equal to the cache key instead.
- **Spec reference.** §5.5 fixes the `sendFile` options, and §3.4 forbids absolute paths and OS
  messages in bodies; both are enforced above.
