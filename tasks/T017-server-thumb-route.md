# T017 — Expose `GET /api/thumb`

**Epic:** E8 — Thumbnail service
**Spec sections:** §5.6, §12.2, §3.3, §3.5, §4.1 (FR-2.1, FR-2.4), NFR-5, NFR-10
**Depends on:** T016, T015
**Estimated size:** M

---

## 1. Context

The explorer's grid view shows a thumbnail for every image in the current folder. Serving the originals for that would be slow and memory-hungry, so Slydr resizes images on the server with `sharp` and keeps the results in an on-disk cache. The resize pipeline and the cache already exist as a service (`createThumbnailService` in `server/src/services/thumbnails.ts`, delivered by T016). This ticket adds the HTTP endpoint on top of it: `GET /api/thumb?path=<wire path>&size=<128|256|384|512>`.

The route validates its two query parameters, verifies the target is a safe, regular, supported image file (exactly the same rules as `GET /api/image`, because it **imports the same helper** that T015 created), asks the thumbnail service for the cached WebP, and streams it back with correct caching headers, reusing T015's `sendFileSafe` helpers. The most important design point is conditional requests: the cache key depends only on file-system metadata, so the route computes the key first and can answer `304 Not Modified` without ever running `sharp` or even opening the cached file.

This ticket also wires the thumbnail service into `createApp` through dependency injection (no singleton), which is what lets tests inject a service with a counting renderer and a temporary cache directory.

## 2. Scope

### In scope

- `server/src/routes/thumb.ts`: the router factory `createThumbRouter({ logger, thumbnails })` with the `GET /` handler, mounted at `/api/thumb` in `server/src/app.ts`.
- Extending `createApp` to `createApp(config, logger?, deps?: AppDeps)` with `AppDeps { thumbnails?: ThumbnailService }`; when `deps.thumbnails` is absent, `createApp` builds `createThumbnailService({ cacheDir: config.cacheDir, logger })`.
- Extending `server/test/helpers/testApp.ts` (created by T012) with a `deps` option (section 4.2).
- Validation of the `size` parameter against the shared allowlist (`THUMBNAIL_SIZES`, default `DEFAULT_THUMBNAIL_SIZE`), with `400 INVALID_PARAM` for everything else.
- Reusing, **unchanged**, T015's `readPathParam` / `resolveImageTarget` (`server/src/security/imageTarget.ts`) and `sendFileAsync` / `handleSendFileError` / `resetFileHeaders` (`server/src/http/sendFileSafe.ts`).
- Response headers: `Content-Type: image/webp`, `Cache-Control: private, max-age=604800`, strong quoted `ETag`.
- `304` handling for `If-None-Match`, before any `sharp` work.
- Streaming the cached file to the client, including correct behaviour when the client aborts mid-transfer and the single regenerate-and-retry when the cache file vanishes.
- A Supertest suite per specification §12.2.

### Out of scope

- The `sharp` pipeline, the semaphore, in-flight coalescing, the atomic temp-file write, the touch-on-hit rule and cache-directory creation — **T016**. This ticket calls the service and must not reimplement any of it.
- Cache directory location and size cap parsing — **T008** (`ServerConfig.cacheDir`, `cacheMaxMb`).
- The cache size cap and LRU eviction — **T018**.
- `GET /api/image`, `imageTarget.ts` and `sendFileSafe.ts` — **T015**. This ticket **modifies none of them**.
- `resolveSafe` and the jail — **T010**.
- The client's thumbnail loading, lazy loading and request capping — epic E12.
- Any "clear cache" endpoint. Per specification §16.1 A8 the cache is never surfaced in the application.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo with three packages, `shared/`, `server/` and `client/`. Everything is ESM (`"type": "module"`), TypeScript is in strict mode, Node >= 22 is required, the server runs Express 5, and Vitest plus Supertest are configured and run via `npm test`. Follow the import-extension convention already used in `server/src`. Server code imports `fs` as `import fs from 'node:fs/promises'`.

### `@slydr/shared`

```ts
export const THUMBNAIL_SIZES: readonly [128, 256, 384, 512];       // T004: the one allowlist
export type ThumbnailSize = 128 | 256 | 384 | 512;
export const DEFAULT_THUMBNAIL_SIZE: ThumbnailSize;                // 256
export function isImageExtension(name: string): boolean;
```

### `server/src/app.ts` (T008, T009, and as extended by T012/T015)

`createApp(config: ServerConfig, logger?: Logger): Express` builds the app: the `405 METHOD_NOT_ALLOWED` guard, the `403 FORBIDDEN_HOST` guard, the routers, and the error middleware that renders `{ "error": { "code": "...", "message": "..." } }` (with `Cache-Control: no-store`, never leaking an `errno`, a raw OS message or an absolute path). `ApiError` is `new ApiError(code, message?, cause?)`; the status is derived from the code, **never pass a status**. Express 5 forwards rejected promises from async handlers to the error middleware.

### `server/src/security/imageTarget.ts` and `server/src/http/sendFileSafe.ts` (T015)

```ts
export interface ImageTarget { absPath: string; stats: Stats; name: string }
export function readPathParam(req: Request): string;              // 400 INVALID_PARAM unless a single string; absent is INVALID_PARAM too
export async function resolveImageTarget(rawPath: string): Promise<ImageTarget>;
// resolveSafe -> assertFile (400 NOT_A_FILE) -> isImageExtension(name) (415 UNSUPPORTED_IMAGE)
// where `name` is the last segment of the REQUESTED path, i.e. a symlink's own name (FR-2.1).

export type SendFileOptions = NonNullable<Parameters<Response['sendFile']>[1]>;
export function sendFileAsync(res: Response, filePath: string, options: SendFileOptions): Promise<void>;
export function handleSendFileError(err: unknown, req: Request, res: Response, logger: Logger): void;
// returns normally for client aborts (ECONNABORTED/EPIPE/ECONNRESET/ERR_STREAM_PREMATURE_CLOSE or
// res.destroyed), headers-already-sent (destroys the socket), 416 and 412; otherwise throws ApiError
// (ENOENT -> NOT_FOUND, EACCES/EPERM -> ACCESS_DENIED, anything else -> READ_FAILED).
export function resetFileHeaders(res: Response): void;
```

Behaviour of `/api/image` for missing `path`, repeated `path`, empty `path` (`NOT_A_FILE`), non-image names and symlink naming is therefore automatically identical for `/api/thumb`.

### `server/src/services/thumbnails.ts` (T016)

```ts
export interface ThumbnailRequest { absPath: string; size: ThumbnailSize }       // absPath: verified, from resolveSafe
export interface ThumbnailResult { filePath: string; key: string; cached: boolean }
export interface ThumbnailService {
  getThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult>;
  readonly cacheDir: string;
  inflightCount(): number;
}
export function createThumbnailService(options: ThumbnailServiceOptions): ThumbnailService;
export function computeThumbnailKey(input: { absPath: string; mtimeMs: number; fileSize: number; size: number }): string;
export function renderThumbnail(job: RenderJob): Promise<void>;                   // the real sharp pipeline
```

`key = sha256(realAbsPath + '|' + mtimeMs + '|' + fileSize + '|' + size + '|' + PIPELINE_VERSION)`, hex, first 32 characters. A decode or resize failure throws `ApiError('THUMBNAIL_FAILED')` (and logs `thumb.failed` at `warn` through the logger the service was built with). `computeThumbnailKey` is a pure, synchronous function and the only definition of the key formula.

### Logger and test helpers

`server/src/logger.ts` (T009): `Logger` with `debug/info/warn/error(event, fields?)`. Test helpers: T008 `testConfig.ts` (`makeTestConfig`), T011 `fs.ts` / `logger.ts`, T012 `testApp.ts` (`createTestEnv`), T016 `images.ts` (`makeJpeg`, `makePng`, `makeWebp`, ...). **Tests never set `SLYDR_ROOT` or `SLYDR_CACHE_DIR`.**

## 4. Implementation detail

### 4.1 Files

| File | Action |
|---|---|
| `server/src/routes/thumb.ts` | Create. |
| `server/src/app.ts` | Modify. Add `AppDeps`, the `deps` parameter, the service construction and `app.use('/api/thumb', createThumbRouter({ logger, thumbnails }))`. |
| `server/test/helpers/testApp.ts` | Modify. Add the `deps` option (section 4.2). |
| `server/test/routes/thumb.test.ts` | Create. |

`routes/image.ts`, `security/imageTarget.ts` and `http/sendFileSafe.ts` are **not touched**.

### 4.2 `createApp` wiring and the test helper

```ts
// server/src/app.ts
import { createThumbnailService, type ThumbnailService } from './services/thumbnails.js';

export interface AppDeps {
  /** Test seam: inject a service with a counting renderer or a temporary cache directory. */
  thumbnails?: ThumbnailService;
}

export function createApp(config: ServerConfig, logger?: Logger, deps: AppDeps = {}): Express {
  // ... existing guards and routers (logger defaults per T009) ...
  const thumbnails = deps.thumbnails ?? createThumbnailService({ cacheDir: config.cacheDir, logger: log });
  app.use('/api/thumb', createThumbRouter({ logger: log, thumbnails }));
  // ... error middleware last ...
}
```

`createThumbnailService` has no import-time or construction-time side effects (the cache directory is created lazily on first use), so building it for every `createApp` call, including in tests that never request a thumbnail, is free and writes nothing.

`createTestEnv` (T012) gains one option so a test can build the service against the environment's own temporary `cacheDir`:

```ts
deps?: (ctx: { cacheDir: string; logger: Logger }) => AppDeps;
// createTestEnv calls it after creating base/root/cacheDir and passes the result as createApp's third argument.
```

### 4.3 Computing the cache key before reading anything

An `ETag` that equals the cache key lets the browser revalidate with `If-None-Match` and receive `304` with an empty body. For that to be cheap, the route must know the key without producing the thumbnail. The key is a pure function of `realAbsPath`, `mtimeMs`, `fileSize`, `size` and `PIPELINE_VERSION`; every input is available from the `Stats` that `resolveImageTarget` already fetched. So the route calls `computeThumbnailKey` (imported from T016, never re-implemented) with the `absPath` and `stats` from `resolveImageTarget`. On a conditional-request match it responds `304` and returns. No `sharp` call, no cache-directory access, no read of the cached file.

**Decision (not specified): `thumbnails.getThumbnail` re-stats the file itself rather than accepting the route's `Stats`.** This keeps the service signature (`{ absPath, size }`) and means the key it writes under is computed from the freshest stat. A file modified in the tiny window between the route's stat and the service's stat would make the two keys differ. The route therefore uses the key **returned by `getThumbnail`** for the `ETag` on the `200` path and only uses its own precomputed key for the `304` shortcut. The worst consequence of the race is a harmless extra full response; a stale `304` cannot occur because a changed file changes the key.

### 4.4 Parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `path` | wire path | required | Validated by T015's `readPathParam` + `resolveImageTarget`. |
| `size` | integer | `256` | Allowed values exactly the shared `THUMBNAIL_SIZES` (`128`, `256`, `384`, `512`). Anything else is `400 INVALID_PARAM`. |

**Why a fixed allowlist.** The size is part of the cache key. If any integer were accepted, a client (or a hostile web page reaching the loopback server) could request `size=1`, `size=2`, ... for every image and fill the disk with distinct cache entries and burn CPU on `sharp`. Four sizes bound the cache to four entries per image and make every grid share the same files. The list is a security property and has exactly one definition, in `@slydr/shared`; this route builds its string whitelist **from it** rather than retyping the numbers.

`size` parsing uses a strict whitelist of the literal strings rather than `Number(...)`:

```ts
import { THUMBNAIL_SIZES, DEFAULT_THUMBNAIL_SIZE, type ThumbnailSize } from '@slydr/shared';

// Built from the shared allowlist; a Map lookup cannot match inherited keys such as "__proto__".
const SIZE_BY_STRING: ReadonlyMap<string, ThumbnailSize> = new Map(
  THUMBNAIL_SIZES.map((s) => [String(s), s] as const),
);

function parseSize(raw: unknown): ThumbnailSize {
  if (raw === undefined) return DEFAULT_THUMBNAIL_SIZE;
  if (typeof raw !== 'string') {
    throw new ApiError('INVALID_PARAM', 'Query parameter "size" must be a single value.');
  }
  const size = SIZE_BY_STRING.get(raw);
  if (size === undefined) {
    throw new ApiError('INVALID_PARAM', 'Query parameter "size" must be one of 128, 256, 384, 512.');
  }
  return size;
}
```

Consequences of the whitelist approach, all intentional and all covered by tests:

- `size=` (empty string) is rejected; it is **not** treated as the default. Only an absent parameter yields `256`.
- `size=0`, `size=257`, `size=-128`, `size=128.5`, `size=abc`, `size=1e2`, `size=0x80`, `size=+128`, `size=%20128` and `size=0128` are all rejected, because none is byte-for-byte one of the four literal strings. `Number('0128')`, `Number('1e2')`, `Number(' 128')` and `Number('0x80')` would all have produced allowed-looking values, which is exactly why `Number(...)` is not used.
- A repeated parameter (`?size=128&size=256`) arrives as an array and is rejected.

### 4.5 Parameter validation order

**Decision (not specified): validate in this order, before touching the file system for the second check.** (1) `path` is a single string (`readPathParam`); (2) `size` (`parseSize`); (3) `resolveImageTarget`. The cheap syntactic checks come first, so a request with a bad `size` and a non-existent `path` deterministically returns `400 INVALID_PARAM` rather than `404 NOT_FOUND`. `readPathParam` and `parseSize` both run before `resolveSafe` is called.

### 4.6 Handler algorithm

```ts
const SEND_OPTIONS: SendFileOptions = {
  dotfiles: 'allow',      // the cache may live under ~/.cache
  etag: false,            // this route owns the ETag (the cache key)
  lastModified: false,
  cacheControl: false,    // this route owns Cache-Control
  acceptRanges: false,
};

export function createThumbRouter(deps: { logger: Logger; thumbnails: ThumbnailService }): Router {
  const { logger, thumbnails } = deps;
  const router = Router();
  router.get('/', async (req, res) => {
    const t0 = Date.now();
    const rawPath = readPathParam(req);                                      // 1
    const size = parseSize(req.query.size);                                  // 2
    const { absPath, stats } = await resolveImageTarget(rawPath);            // 3
    const expectedKey = computeThumbnailKey({                                // 4
      absPath, mtimeMs: stats.mtimeMs, fileSize: stats.size, size,
    });
    if (matchesIfNoneMatch(req.headers['if-none-match'], expectedKey)) {     // 5
      res.status(304).set(thumbHeaders(expectedKey)).end();
      logger.debug('thumb.served', { path: rawPath, size, status: 304, ms: Date.now() - t0 });
      return;
    }
    let result = await thumbnails.getThumbnail({ absPath, size });           // 6
    for (let attempt = 0; ; attempt++) {
      if (res.destroyed) return;                                             // client left while we rendered
      res.set(thumbHeaders(result.key));                                     // 7
      try {
        await sendFileAsync(res, result.filePath, SEND_OPTIONS);             // 8
        break;
      } catch (err) {
        if (isEnoent(err) && !res.headersSent) {
          resetFileHeaders(res);
          if (attempt === 0) {                                               // evicted between 6 and 8
            result = await thumbnails.getThumbnail({ absPath, size });
            continue;
          }
          throw new ApiError('THUMBNAIL_FAILED', 'Thumbnail could not be generated.');
        }
        handleSendFileError(err, req, res, logger);                          // abort => returns; else throws
        return;
      }
    }
    logger.debug('thumb.served', {                                           // 9
      path: rawPath, size, status: res.statusCode, cached: result.cached, ms: Date.now() - t0,
    });
  });
  return router;
}
```

Steps:

1. `readPathParam(req)` (T015).
2. `parseSize(req.query.size)` per section 4.4.
3. `resolveImageTarget(rawPath)` (T015): `resolveSafe`, regular file, supported extension **of the requested name** (FR-2.1: a symlink `x.jpg` is an image, `photo-link` without extension is `415`), else the errors in section 4.8. The thumbnail is rendered from the resolved target's bytes.
4. Compute the expected cache key from stat data. A single in-memory SHA-256 over a short string; no I/O.
5. Conditional request. Parse `If-None-Match` as a comma-separated list of entity tags. A request matches when any element, after trimming whitespace and stripping a leading `W/` weak marker, equals the quoted key `"<key>"`, or when the header is the literal `*`. **Decision (not specified):** weak-prefixed validators are accepted because HTTP defines `If-None-Match` as using the weak comparison function; the response still carries a strong `ETag`. On a match respond `304` with the headers of step 7 (a `304` must repeat `ETag` and `Cache-Control`), no body, and return. `sharp` has not run and the cached file has not been opened.
6. `thumbnails.getThumbnail({ absPath, size })`. On a cold cache this is the only expensive step, subject to T016's semaphore and coalescing. It throws `ApiError THUMBNAIL_FAILED` (500) for a corrupt or undecodable file and logs it itself. Do **not** cancel generation on client abort: the render is shared through the in-flight map and, once started, should finish so the cache is populated for the next scroll. After it resolves, check `res.destroyed` and return without sending.
7. Response headers (`thumbHeaders(key)`):

| Header | Value |
|---|---|
| `Content-Type` | `image/webp` |
| `Cache-Control` | `private, max-age=604800` |
| `ETag` | `"<key>"` — the 32-character key wrapped in double quotes, strong (no `W/` prefix) |
| `X-Content-Type-Options` | `nosniff` (already set globally by T008; do not remove) |

`604800` seconds is seven days. `private` is required because the content is derived from the user's personal files. Do not send `Last-Modified`: the `ETag` is the sole validator. The headers are built from the key **returned by `getThumbnail`** (which may differ from `expectedKey` in the stat race of section 4.3).

8. Send the file with T015's `sendFileAsync` and `SEND_OPTIONS` (section 4.7).
9. Log one `thumb.served` line at **debug** (honouring `SLYDR_QUIET` through the logger) with path, size, status, `cached` and ms. Logs may contain absolute paths; response bodies may not (§3.4).

### 4.7 Streaming the cached file

**Decision (not specified): use `sendFileAsync(res, result.filePath, SEND_OPTIONS)` (a wrapper around `res.sendFile`) with `etag: false, lastModified: false, cacheControl: false, acceptRanges: false, dotfiles: 'allow'`.**

Reasoning: `sendFile` already handles back-pressure, `HEAD` (no body, correct `Content-Length`), and tears the stream down when the socket closes. Because the route sets `ETag`, `Cache-Control` and `Content-Type` itself and has already evaluated `If-None-Match`, `send`'s own header logic is disabled so there is exactly one source of truth for each header. `dotfiles: 'allow'` is required because the cache directory may legitimately sit under a dot directory (`~/.cache`) on Linux; `send` otherwise refuses any path containing a dot segment. Because `filePath` is absolute and was produced by the service from a hex key, it contains no user-controlled input, so `root` is not needed and the usual `sendFile` traversal concern does not apply.

**Outcome mapping reuses T015.** Client aborts (`ECONNABORTED`, `EPIPE`, `ECONNRESET`, `ERR_STREAM_PREMATURE_CLOSE`, a destroyed response) are swallowed at `debug` level by `handleSendFileError`; a header-already-sent failure destroys the socket; other failures become `ACCESS_DENIED` / `READ_FAILED` envelopes after `resetFileHeaders` (so a failure is never cached for seven days). There is no thumbnail-specific abort logic. Grid scrolling cancels requests constantly (FR-14.9), so this path is hot.

**Eviction race.** T018's sweep may delete a cache file between `getThumbnail` returning and `sendFile` opening it. This is rare (the file was just created or touched, and the sweep evicts least-recently-used files) but possible. **Decision (not specified):** on `ENOENT` from `sendFile` before any bytes were sent, call `getThumbnail` once more and retry the send a single time; if it fails again, respond `500 THUMBNAIL_FAILED`. This is the `attempt < 2` loop in the handler. Do not retry on any other error. `ENOENT` is handled before `handleSendFileError` precisely because that function would otherwise map it to `404 NOT_FOUND`, which would be wrong here (the *source image* exists; the derived cache file is what vanished).

### 4.8 Error mapping (complete)

| Condition | Code | HTTP | Raised by |
|---|---|---|---|
| `path` missing, repeated or not a string | `INVALID_PARAM` | 400 | `readPathParam` (T015) |
| `size` present but not exactly one of the shared allowlist as a literal string; `size` repeated | `INVALID_PARAM` | 400 | `parseSize` |
| `path` has a NUL byte, exceeds 4096 chars, starts with `/`, matches `^[A-Za-z]:` / `^\\\\`; any backslash on Windows | `INVALID_PATH` | 400 | `resolveSafe` |
| `path` contains `..`, or its real path escapes the jail | `OUTSIDE_ROOT` | 403 | `resolveSafe` |
| `path` does not exist | `NOT_FOUND` | 404 | `resolveSafe` |
| OS denied read (`EACCES`/`EPERM`) | `ACCESS_DENIED` | 403 | `resolveSafe` / `assertFile` / service / `handleSendFileError` |
| `path` is a directory | `NOT_A_FILE` | 400 | `assertFile` |
| the requested name's extension is not in `IMAGE_EXTENSIONS` | `UNSUPPORTED_IMAGE` | 415 | `resolveImageTarget` |
| `sharp` cannot decode or resize the file, or the cache file cannot be served after one retry | `THUMBNAIL_FAILED` | 500 | service / this route |
| Any other I/O failure | `READ_FAILED` | 500 | route or service |
| Non-loopback `Host` | `FORBIDDEN_HOST` | 403 | app middleware |
| Method other than `GET`/`HEAD` | `METHOD_NOT_ALLOWED` | 405 | app middleware |

Error responses are JSON error envelopes and must **not** carry the `ETag` or the long `Cache-Control` of a successful response. Set the thumbnail headers only after all validation and generation has succeeded (steps 5 and 7), never earlier. A `THUMBNAIL_FAILED` response must not be cached by the browser for seven days; the global error middleware sends `Cache-Control: no-store` for error envelopes, and a test asserts it.

### 4.9 Concurrent client abort

- **Abort while waiting on `getThumbnail`.** Generation is not cancelled (section 4.6 step 6). When it resolves, `res.destroyed` is checked and the handler returns without calling `sendFile`.
- **Abort during `sendFile`.** Handled by `handleSendFileError` (section 4.7): nothing thrown, nothing above `debug` logged.
- An aborted request must never leave a temporary cache file behind: T016 owns the temp file and removes it on failure, and this route never touches the cache directory directly.

### 4.10 Cross-platform notes

- `filePath` is absolute and comes from the service, so `path.sep` differences are invisible to the route. Never build it from a wire path.
- On Windows `sendFile` requires an absolute path and rejects one that contains `..`; neither can occur here.
- The `ETag` is derived from file stats and a hash, so tests must not assert a literal key value, only its shape (`/^"[0-9a-f]{32}"$/`).
- Case-insensitive file systems (default on Windows and macOS): `resolveSafe` uses `realpath.native`, which returns the on-disk case, so `a.JPG` and `A.jpg` produce the same absolute path, the same key and the same cache entry.
- `mtimeMs` on some file systems has coarse resolution (FAT: 2 s). The key includes `fileSize` as well, so a same-second edit that changes the size still invalidates; a same-second edit that preserves the size is a known and accepted limitation of the specification's key design.

## 5. Acceptance criteria

- [ ] `GET /api/thumb?path=<image>` returns `200` with `Content-Type: image/webp`, `Cache-Control: private, max-age=604800` and a strong `ETag` matching `/^"[0-9a-f]{32}"$/`.
- [ ] Omitting `size` produces a 256 × 256 WebP; `size=128`, `256`, `384`, `512` each produce a WebP of exactly that width and height.
- [ ] Each of these `size` values returns `400` with `error.code === 'INVALID_PARAM'`: `0`, `1`, `127`, `129`, `257`, `1024`, `-128`, `128.5`, `abc`, `1e2`, `0x80`, `+128`, `0128`, ` 128`, the empty string, and a repeated `size=128&size=256`.
- [ ] The size whitelist is derived from `THUMBNAIL_SIZES` imported from `@slydr/shared`; the numbers `128`, `256`, `384`, `512` do not appear as a second list in `routes/thumb.ts` (a grep finds none outside comments and the error message).
- [ ] A second request for the same image and size is served from the cache without invoking the renderer (asserted with a counting renderer injected through `AppDeps`).
- [ ] A request carrying `If-None-Match: "<etag>"` from a previous response returns `304` with an empty body, repeating `ETag` and `Cache-Control`, and the renderer is not invoked even on a cold cache.
- [ ] A `304` is returned for `If-None-Match: W/"<etag>"` and for `If-None-Match: *`, and a non-matching validator yields `200`.
- [ ] Modifying the source image (new `mtime` or new size) changes the `ETag`; a request with the old `ETag` returns `200` with a new `ETag`.
- [ ] **Symlink naming (FR-2.1):** a symlink named `x.jpg` (target `data.bin`, valid PNG bytes) returns a `200` WebP; a symlink named `photo-link` (no extension) pointing at a JPEG returns `415`; a path through a folder symlink inside the root is served.
- [ ] A regular file with a non-image name returns `415 UNSUPPORTED_IMAGE`; a directory returns `400 NOT_A_FILE`; a missing file returns `404 NOT_FOUND`.
- [ ] `path=../../../etc/passwd` returns `403 OUTSIDE_ROOT`; absolute and UNC forms return `400 INVALID_PATH`; a NUL byte returns `400 INVALID_PATH`.
- [ ] A file named `broken.jpg` containing random bytes returns `500 THUMBNAIL_FAILED`, the next request for another image still works, and no `.tmp` file remains in the cache directory.
- [ ] Error responses carry neither `ETag` nor `Cache-Control: private, max-age=604800`, and contain no absolute path, `errno` or raw OS message.
- [ ] `HEAD /api/thumb?...` returns the same headers as `GET` with no body; `POST` returns `405`; `Host: evil.example` returns `403 FORBIDDEN_HOST`.
- [ ] `routes/thumb.ts` imports `readPathParam`/`resolveImageTarget` from `security/imageTarget.ts` and `sendFileAsync`/`handleSendFileError`/`resetFileHeaders` from `http/sendFileSafe.ts`; it contains no copy of the `resolveSafe` → `assertFile` → extension sequence and no abort-handling logic of its own. `routes/image.ts` is unchanged by this ticket.
- [ ] An aborted client request does not produce an unhandled rejection, a `warn`/`error` log line or a leftover temp file; the code does not reference `req.aborted`.
- [ ] `createApp(config, logger, { thumbnails })` uses the injected service; with no `deps` it builds one from `config.cacheDir` and the same logger. There is no module-level thumbnail singleton.
- [ ] `computeThumbnailKey` (T016) is the only place the key formula appears in the codebase.

## 6. Tests to write

Per specification §12.2: every endpoint against a fixture tree, with `304` on `If-None-Match` for thumbnails and the `405` / `403 FORBIDDEN_HOST` guards. All in **`server/test/routes/thumb.test.ts`**; the `readPathParam` / `resolveImageTarget` unit tests live in T015's `server/test/security/imageTarget.test.ts`, and `routes/image.ts` is not modified, so T015's tests are not re-run for regression here.

### Fixture setup

Use `createTestEnv` from `server/test/helpers/testApp.ts`, extended in this ticket with the `deps` option. Build one counting service per test file:

```ts
let renders = 0;
const env = await createTestEnv({
  prefix: 'slydr-thumb-',
  deps: ({ cacheDir, logger }) => ({
    thumbnails: createThumbnailService({
      cacheDir, logger,
      render: async (job) => { renders += 1; await renderThumbnail(job); },
    }),
  }),
  populate: async (root) => { /* fixtures below, generated with server/test/helpers/images.ts */ },
});
```

Neither `SLYDR_ROOT` nor `SLYDR_CACHE_DIR` is set. Generate fixtures programmatically with the helpers from T016's `server/test/helpers/images.ts` (no committed binaries, §12.4):

```
<root>/
  photo-landscape.jpg   # 640 x 360, solid colour
  photo-portrait.png    # 300 x 500
  tiny.webp             # 40 x 40 (smaller than 128: must still produce a square 128)
  notes.txt             # non-image
  broken.jpg            # 2 KB of random bytes
  data.bin              # a valid PNG under a non-image name
  x.jpg        -> data.bin               # symlink: image by NAME (FR-2.1)
  photo-link   -> photo-landscape.jpg    # symlink without extension
  dirlink      -> folder                 # folder symlink inside the root
  folder/inside.gif
```

Symlinks are created with `trySymlink`; dependent cases call `ctx.skip()` with a reason when it returns `false`. `env.cleanup()` runs in `afterAll`.

### Cases

1. `serves a 256px WebP by default` — `GET ?path=photo-landscape.jpg` returns `200`, `Content-Type` exactly `image/webp`, and `sharp(res.body).metadata()` reports `format: 'webp'`, `width: 256`, `height: 256`. Use `.buffer(true).parse(binaryParser)` to receive a `Buffer`.
2. `produces the requested size for every allowed value` — `it.each(THUMBNAIL_SIZES)`: the decoded WebP is exactly `size` × `size`.
3. `thumbnail is square even for portrait input` — `photo-portrait.png` at 256 decodes to 256 × 256.
4. `small images are upscaled to the requested square` — `tiny.webp` at 128 decodes to 128 × 128.
5. `sets caching headers` — `Cache-Control` equals `private, max-age=604800`; `ETag` matches `/^"[0-9a-f]{32}"$/`; no `W/` prefix; no `Last-Modified`.
6. `ETag equals the cache key` — the unquoted ETag equals the file name (without `.webp`) found on disk at `<env.cacheDir>/<key.slice(0, 2)>/<key>.webp`.
7. `cache miss then cache hit` — read `renders` before and after: the first request adds 1; a second identical request adds 0, with identical bytes and ETag.
8. `different sizes have different cache entries and ETags` — 128 and 256 for the same image yield different ETags and two files on disk.
9. `304 on matching If-None-Match` — take the ETag from a first response, repeat with `If-None-Match` set to it: `304`, empty body, `ETag` and `Cache-Control` repeated.
10. `304 without running the renderer on a cold cache` — capture an ETag, delete the cache directory contents, record `renders`, repeat the conditional request: `304`, `renders` unchanged. Pins the key-from-stat-data design in section 4.3.
11. `weak and wildcard validators match` — `If-None-Match: W/"<etag>"` and `*` both return `304`; a list `"aaaa", "<etag>"` returns `304`; `"deadbeef"` returns `200`.
12. `editing the file invalidates the ETag` — capture an ETag, rewrite the image with different content and bump `mtime` with `fs.utimes`, request with the old `If-None-Match`: `200` with a different ETag, and the new body differs.
13. `rejects every invalid size` — table-driven: `'0'`, `'1'`, `'127'`, `'129'`, `'257'`, `'1024'`, `'-128'`, `'128.5'`, `'abc'`, `'1e2'`, `'0x80'`, `'+128'`, `'0128'`, `'%20128'`, `''`, `'NaN'`, `'Infinity'`, `'__proto__'`, each asserting `400` and `error.code === 'INVALID_PARAM'`. For the empty-string case use a URL written literally as `?path=photo-landscape.jpg&size=`.
14. `rejects a repeated size parameter` — `?path=photo-landscape.jpg&size=128&size=256` returns `400 INVALID_PARAM`.
15. `rejects a repeated or missing path` — `?path=a&path=b` and no `path` at all each return `400 INVALID_PARAM`.
16. `size validation precedes path resolution` — `?path=does-not-exist.jpg&size=7` returns `400 INVALID_PARAM`, not `404`.
17. `non-image file is 415` — `?path=notes.txt` returns `415` with `UNSUPPORTED_IMAGE`.
18. `directory is NOT_A_FILE` — `?path=folder` returns `400` with `NOT_A_FILE`.
19. `missing file is 404` — `?path=nope.jpg` returns `404 NOT_FOUND`.
20. `path traversal is refused` — `?path=../../../etc/passwd` returns `403 OUTSIDE_ROOT`; `?path=%2e%2e/%2e%2e/secret.jpg` also returns `403`.
21. `absolute, UNC and NUL paths are refused` — `/etc/passwd`, `C:/Windows/x.jpg`, `\\\\server\\share\\x.jpg`, and `a%00.jpg` each return `400 INVALID_PATH` on every platform.
22. `symlink escaping the root is refused` — create a symlink inside the root pointing at an image in `env.outside` (use a junction for a directory on Windows; skip if `trySymlink` returns `false`); expect `403 OUTSIDE_ROOT`. A symlink to an image inside the root is served normally.
23. `corrupt image yields 500 THUMBNAIL_FAILED` — `?path=broken.jpg` returns `500` with `error.code === 'THUMBNAIL_FAILED'`, a JSON envelope, no `ETag`, `Cache-Control` not the thumbnail value, and the cache directory contains no `.tmp` and no `.webp` for it. A following request for `photo-landscape.jpg` still returns `200`. The test logger captured one `thumb.failed` event at `warn` (proves the service logger is wired through `createApp`).
24. `error bodies leak nothing` — for the 400, 403, 404, 415 and 500 cases, the serialised body contains neither the fixture's absolute path, the cache directory path, `ENOENT`, `EACCES`, nor an `errno` field.
25. `HEAD returns headers and no body` — `200`, same `Content-Type` and `ETag` as `GET`, empty body.
26. `method guard` — `POST` returns `405 METHOD_NOT_ALLOWED`.
27. `host guard` — `Host: evil.example` returns `403 FORBIDDEN_HOST`; `Host: 127.0.0.1:4317` returns `200`.
28. `client abort does not break the server` — open a request with a raw `http.request`, call `req.destroy()` immediately after sending, wait briefly, then issue a normal request and assert `200`; assert no `unhandledRejection` was recorded via `process.on('unhandledRejection', ...)` and the test logger holds no `warn`/`error` event caused by the abort.
29. `retries once if the cache file vanishes before sending` — build a **fake** `ThumbnailService` (object with `getThumbnail: vi.fn()`, `cacheDir`, `inflightCount`) and inject it with `deps`: the first call resolves a path that does not exist, the second a real WebP; the response is `200` and `getThumbnail` was called twice. A second variant returning a missing path both times yields `500 THUMBNAIL_FAILED` (and no `ETag`).
30. `a symlink is an image because of its own name (FR-2.1)` — `?path=x.jpg` (target `data.bin`, PNG bytes) returns a `200` WebP; `?path=photo-link` (no extension, target a JPEG) returns `415 UNSUPPORTED_IMAGE`; `?path=dirlink/inside.gif` returns `200`. Skip when symlinks are unavailable.
31. `a debug line is logged per served thumbnail` — the test logger holds a `thumb.served` event at `debug` with `status` 200 for a full response and 304 for a conditional one; no `warn`/`error`.
32. `the thumbnails dependency is injectable` — `createApp(makeTestConfig(), logger, { thumbnails: fake })` uses the fake (assert via the fake's call count), proving there is no module-level singleton.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on the dev machine (Windows 11) and in CI on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- [ ] `routes/image.ts`, `security/imageTarget.ts` and `http/sendFileSafe.ts` are unmodified by this ticket's diff.
- [ ] `computeThumbnailKey` is the single definition of the cache-key formula; `THUMBNAIL_SIZES` the single definition of the allowlist.
- [ ] Every item labelled **Decision (not specified)** in section 4 appears as a short comment at the relevant line in the code.
- [ ] No temporary file remains in the test cache directory after any test, including the corrupt-image and abort cases.
- [ ] README unchanged — the endpoint is internal API surface. (The cache location documentation belongs to T041.)

## 8. Notes and gotchas

- **The allowlist is a security property, not a convenience.** If someone later "helpfully" accepts any integer between 64 and 1024, the cache becomes unboundedly floodable by a single script. The size set is also what makes the T018 cap predictable. Do not widen it without revisiting both tickets, and change it only in `@slydr/shared`.
- **Never parse `size` with `Number`, `parseInt` or `parseFloat`.** Each of them accepts inputs (`"1e2"`, `"0x80"`, `" 128"`, `"128abc"` for `parseInt`) that would silently map to an allowed value and give two different URLs for one cache entry. The literal-string whitelist keeps the URL space canonical.
- **Compute the key before reading the cache.** The 304 shortcut is the main reason the grid feels fast on a second visit: the browser revalidates hundreds of thumbnails and every one answers from a single `stat` plus a hash. Anything that makes the route call `getThumbnail` before checking `If-None-Match` defeats that, and test 10 exists to catch it.
- **`304` must repeat `ETag` and `Cache-Control`.** RFC 9110 requires validators and cache-relevant headers in a `304`. Omitting `Cache-Control` would reset the browser's freshness lifetime to heuristic.
- **Do not set the thumbnail headers on error responses.** A cached `500` for seven days would leave a corrupt tile broken even after the user fixes the file. The client falls back to the generic image icon for any non-200 (FR-14.9), which is the correct behaviour for `THUMBNAIL_FAILED` (§5.6 step 5).
- **A `304` does not refresh recency.** The 304 path never calls `getThumbnail`, so T016's touch-on-hit does not run for revalidations. Accepted: revalidation only happens after the seven-day `max-age` expires, and any full response touches the file.
- **A freshly edited file within the mtime resolution window.** See section 4.10. Inherent in the specification's key and accepted.
- **Express 5 query values are not always strings.** A repeated key is an array and a bracketed key is an object. Reject, never coerce; `String(['a','b'])` is `"a,b"`. `readPathParam` and `parseSize` both enforce it.
- **`dotfiles: 'allow'` on `sendFile`.** Without it a Linux user whose cache lives under `~/.cache` would get `404` for every thumbnail, a failure that shows up only on one platform.
- **ENOENT is not `NOT_FOUND` here.** After a successful `resolveImageTarget` the source exists, so an `ENOENT` from `sendFile` means the *cache file* vanished. It is retried once and then reported as `THUMBNAIL_FAILED`, never `404`.
- **Eviction race with T018.** The sweep may delete a file between generation and sending. The single retry in section 4.7 covers this. Do not add more retries.
- **Symlinks.** The thumbnail is rendered from the symlink target's bytes, but whether the entry is an image at all is decided by the requested name (FR-2.1), exactly as in `/api/image`.
- **NFR-5.** One corrupt image must never break the grid. The route maps decode failure to a clean `500` envelope, the service cleans up its temporary file, and nothing is logged above `debug` for an aborted client.
- **Assumption A4 (§16.1).** Thumbnails are square-cropped. If that assumption changes to `fit: 'inside'`, the dimension assertions in cases 1 to 4 change with it, and `PIPELINE_VERSION` must be bumped so existing caches are invalidated.
