# T016 — Implement the sharp thumbnail pipeline with an on-disk cache

**Epic:** E8 — Thumbnail service
**Spec sections:** §5.6 (D4), §12.1, §3.5, NFR-3, NFR-5, A4
**Depends on:** T004, T008, T010
**Estimated size:** L

---

## 1. Context

The explorer's grid view shows a square thumbnail for every image in a folder. Decision D4
in the specification is to produce these on the server with `sharp` (libvips) and keep them
in an on-disk cache, rather than letting the browser downscale originals that may be 20+
megapixel phone photos. A folder of 2000 images is a realistic input, so this service is the
main memory and CPU risk in the whole application (§5.6: "Unbounded parallelism on a
2000-image folder is the main memory risk in this app"). The design below exists to keep
that risk bounded: a content-addressed cache so each image is rendered at most once,
coalescing so a burst of identical requests costs one render, and a semaphore so at most
`min(4, availableParallelism)` renders run at any moment.

This ticket delivers the **service layer only**: a function that, given a verified absolute
image path and an allowed size, returns the path of a cached WebP on disk (creating it if
needed) and the cache key. The HTTP route that streams that file (`GET /api/thumb`, strong
`ETag` equal to the cache key, `304`) is T017, and the size-cap LRU sweep over the cache
directory is T018. Both consume the contract defined here, so the public API, the cache
layout and the temp-file naming in this ticket are deliberately precise.

One corrupt image must never break the grid (§5.6 step 5, NFR-5): every decode or resize
failure becomes a typed `500 THUMBNAIL_FAILED`, the client falls back to the generic image
icon, and the rest of the grid is unaffected.

## 2. Scope

### In scope

- Create `server/src/services/thumbnails.ts`.
- Add `sharp` (`^0.34`) to `server/package.json` dependencies if it is not already present.
- The size allowlist (`128`, `256`, `384`, `512`), enforced at the service boundary.
- The cache key (§4.3), the `PIPELINE_VERSION` constant, and the on-disk layout (§4.4).
- The sharp pipeline exactly as specified (§4.5), including SVG handling.
- Atomic write via temp file plus `fs.rename`, with cleanup on failure and a Windows-safe
  retry (§4.6).
- The semaphore (§4.7) and the in-flight coalescing map (§4.8).
- Lazy recursive creation of the cache directory that the caller supplies (§4.9). The
  directory *location* (per-OS defaults, `SLYDR_CACHE_DIR`) is resolved once by T008's
  `readServerConfig` and arrives here as `ServerConfig.cacheDir`; this ticket does not
  resolve it again.
- Failure mapping to `THUMBNAIL_FAILED` (§4.10).
- Global sharp configuration decisions (§4.11).
- A best-effort "last used" refresh on cache hits so T018's LRU has a reliable signal
  (§4.12). **This ticket is the only owner of the touch-on-hit rule**; T018 relies on it.
- A retry-once when the shard directory vanishes between `mkdir` and the temp-file write
  (T018's sweep removes empty shards, §4.6).
- Dependency injection: the service is a factory instance (`createThumbnailService`) built by
  `createApp` from `config.cacheDir` and the shared `Logger`. Options let tests supply a
  temporary cache directory, a fake renderer, a concurrency limit and a fake `rename` (§4.2).
  There is **no process-wide default instance** and no module-level state.
- `server/test/helpers/images.ts`: image synthesis helpers (`makeJpeg`, `makeBands`, `makePng`,
  `makeGif`, `makeWebp`, `makeAvif`, `makeSvg`, `pixelAt`) that T017 reuses.
- A Vitest suite per specification §12.1.

### Out of scope

- **The `GET /api/thumb` route**, its query validation (`path`, default `size=256`), the
  `ETag`/`Cache-Control: private, max-age=604800`/`304` handling, and calling `resolveSafe`,
  `assertFile` and the extension check before invoking this service — **T017**. The service
  trusts its caller to have verified that `absPath` is inside the jail.
- **The LRU sweep** (500 MB default cap, runs at startup and at most every 10 minutes, evicts
  by `atime` falling back to `mtime`) — **T018**. This ticket only guarantees the data that
  sweep needs (§4.12) and the naming contract for temp files (§4.4).
- Path-jail primitives — T010. Directory listing — T011. The app factory, error envelope and
  config module — already delivered.
- The client's lazy loading, 6-in-flight limit and icon fallback (epic E12).
- Pre-generation or warming of thumbnails, background queues, or progress reporting.
- HEIC/HEIF, TIFF and RAW input (excluded by FR-2.4; they never reach this service).
- Negative caching of failures (Decision, §4.10).
- Resolving the cache directory from the environment and the per-OS defaults — **T008**
  (`readServerConfig`, which also owns the tests for that table). Parsing `SLYDR_CACHE_MAX_MB`
  — T008 as well.
- The repository-wide fixture generator — **T037**. Tests here synthesise images with `sharp`
  through `server/test/helpers/images.ts`.

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** (`shared/`, `server/`, `client/`), **ESM**
(`"type": "module"`), TypeScript **strict**, **Node >= 22** (`os.availableParallelism` and
`fs/promises` features used below are available), **Express 5**, with **Vitest + Supertest**
configured (`npm test`). Follow the import-extension convention already used in
`server/src`.

### `@slydr/shared` (implemented)

Exports `FsEntry`, `ImageItem`, the endpoint response types, `ApiErrorCode`, and:

```ts
export const IMAGE_EXTENSIONS: ReadonlySet<string>;
// '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'
export function isImageExtension(name: string): boolean; // case-insensitive on the extension

// T004: the single definition of the thumbnail size allowlist (spec §5.6).
export const THUMBNAIL_SIZES: readonly [128, 256, 384, 512];
export type ThumbnailSize = 128 | 256 | 384 | 512;
export const DEFAULT_THUMBNAIL_SIZE: ThumbnailSize;   // 256
```

This service does not need `IMAGE_EXTENSIONS` (T017 filters before calling), but it must
cope with every format in that set, including the one sharp cannot read natively (see §8,
BMP). The size allowlist is **imported from `@slydr/shared`, never redefined** here: the
server route (T017), this service and the client's URL builder (T025) must share one list.

### `server/src/app.ts` (implemented)

An **app factory** (never calls `listen`) that installs the `405` method guard, the
`403 FORBIDDEN_HOST` check and the error middleware rendering
`{ "error": { "code": "...", "message": "..." } }` with no `errno`, raw OS text or absolute
path (§3.4). It exports:

```ts
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;   // derived from the code (§3.5): INVALID_PARAM 400, NOT_FOUND 404,
                             // NOT_A_FILE 400, THUMBNAIL_FAILED 500, ...
  // `cause` is the inherited Error.cause (do not redeclare it as a field)
  constructor(code: ApiErrorCode, message?: string, cause?: unknown);
}
```

The status is derived from the code; do not pass one. Express 5 forwards rejected promises
from `async` handlers to the error middleware.

### `server/src/config/env.ts` (implemented — T008)

`readServerConfig(env?): ServerConfig` returns, among other fields, `cacheDir` (absolute;
`SLYDR_CACHE_DIR` if set, else the per-OS default `%LOCALAPPDATA%\slydr\thumbnails` /
`~/Library/Caches/slydr/thumbnails` / `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails`),
`cacheMaxMb` (default `500`, consumed by T018) and `quiet`. This ticket receives
`config.cacheDir` through `createApp` and never reads the environment itself.

### Logging (T009)

`server/src/logger.ts` exports `createLogger` and the `Logger` interface:
`debug/info/warn/error(event: string, fields?: Record<string, unknown>)`, plus
`errorFields(err)` which returns loggable error detail. Logs may contain absolute paths;
response bodies may not (NFR-10). The service receives the `Logger` as a factory option
(default: a no-op logger) rather than importing a singleton. Event names are
`<area>.<event>`: this ticket emits `thumb.generated` (debug) and `thumb.failed` (warn).

### `server/src/security/jail.ts` (implemented — T010)

```ts
export function setJailRoot(absolute: string): void;
export function getJailRoot(): string;
export function resetJailRootForTests(): void;
export function resolveSafe(relPath: string): Promise<string>;   // verified, realpath'd absolute path
export function toWirePath(absPath: string): string;
export function assertDirectory(absPath: string): Promise<import('node:fs').Stats>;
export function assertFile(absPath: string): Promise<import('node:fs').Stats>;
export function mapFsError(err: unknown): ApiError;
```

`mapFsError` converts Node errors into `ApiError`s (`ENOENT` -> `NOT_FOUND`, `EACCES`/`EPERM`
-> `ACCESS_DENIED`, `ENOTDIR` -> `NOT_FOUND`, ...). This service uses it for the one `stat`
of the source file. It does **not** call `resolveSafe`: the contract is that `absPath` is
the verified output of `resolveSafe`, supplied by T017.

### Pre-existing services and routes (for orientation only)

`server/src/services/listing.ts` (T011) exports
`listDirectory(absDir, { showHidden, wireDir, logger })`; `server/src/routes/fs.ts` (T012)
exposes `/api/fs/root` and `/api/fs/list`; the images route is T014 and the original-image
route is T015. None are modified by this ticket. The `server/src/routes/thumb.ts` file named in
the specification's layout (§2) is T017, not this ticket. Test helpers available: T008
`server/test/helpers/testConfig.ts`, T011 `server/test/helpers/{fs,logger}.ts`
(`makeTempBase`, `removeTree`, `createTestLogger`).

## 4. Implementation detail

### 4.1 Files

| Action | Path |
|---|---|
| Create | `server/src/services/thumbnails.ts` |
| Create | `server/test/services/thumbnails.test.ts` |
| Create | `server/test/helpers/images.ts` (sharp-based image synthesis; reused by T017) |
| Modify | `server/package.json` — add `"sharp": "^0.34.0"` to `dependencies` if absent (`npm install sharp@^0.34 -w server`) |

No change to `app.ts`: nothing here is mounted, and the instance is wired into `createApp` by
T017 (`createThumbnailService({ cacheDir: config.cacheDir, logger })`). The module must have
**no import-time side effects** and **no module-level state**: no directory creation, no
`sharp` global configuration, no timers, no singleton. (Importing it from tests must not touch
the real user cache directory.)

### 4.2 Public API

```ts
import { THUMBNAIL_SIZES, type ThumbnailSize } from '@slydr/shared';   // T004; never redefine

export const PIPELINE_VERSION = 1;
export const DEFAULT_LIMIT_INPUT_PIXELS = 268402689;

/** Type guard built from the shared allowlist: THUMBNAIL_SIZES.includes(value as ThumbnailSize). */
export function isThumbnailSize(value: unknown): value is ThumbnailSize;

export interface ThumbnailRequest {
  absPath: string;        // verified absolute path from resolveSafe (T017's job)
  size: ThumbnailSize;    // validated here as well
}

export interface ThumbnailResult {
  filePath: string;       // absolute path of <cacheDir>/<key[0..1]>/<key>.webp, guaranteed to exist
  key: string;            // 32 lowercase hex characters; T017 uses it as the strong ETag
  cached: boolean;        // true if served from an existing cache file, false if rendered (or coalesced onto a render)
}

export function computeThumbnailKey(input: {
  absPath: string; mtimeMs: number; fileSize: number; size: number;
}): string;

export function thumbnailPathFor(cacheDir: string, key: string): string;

export interface ThumbnailServiceOptions {
  cacheDir: string;                   // required, absolute: ServerConfig.cacheDir (T008)
  logger?: Logger;                    // T009 Logger; default: a no-op logger
  concurrency?: number;               // default: defaultConcurrency()
  limitInputPixels?: number;          // default: DEFAULT_LIMIT_INPUT_PIXELS
  render?: RenderFunction;            // default: renderThumbnail (the sharp pipeline)
  rename?: (from: string, to: string) => Promise<void>;   // default: fs.promises.rename
  now?: () => number;                 // default: Date.now
  touchIntervalMs?: number;           // default: 60 * 60 * 1000
}

export type RenderFunction = (job: {
  absPath: string; size: ThumbnailSize; destPath: string; limitInputPixels: number;
}) => Promise<void>;

export interface ThumbnailService {
  getThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult>;
  readonly cacheDir: string;
  inflightCount(): number;            // for tests and diagnostics
}

export function createThumbnailService(options: ThumbnailServiceOptions): ThumbnailService;
```

Rationale: there is **no process-wide default instance**. `createApp` (T017) builds one
instance from `config.cacheDir` and the shared logger and hands it to the thumb router; tests
build isolated instances with `createThumbnailService({ cacheDir })`, so **the cache directory
is injectable** and no test ever writes to the user's real cache. `render`, `rename`,
`concurrency`, `now` and `limitInputPixels` are injectable so the concurrency, coalescing,
atomicity and failure behaviour can be tested deterministically without relying on real sharp
timing. Each service instance owns its own semaphore and in-flight map, and the logger it was
given records `thumb.failed` / `thumb.generated`, so failures are logged in production without
any per-call plumbing.

Also export, for tests and T017: `computeThumbnailKey`, `thumbnailPathFor`,
`defaultConcurrency`, `Semaphore`, `sharpInputOptions`, `renderThumbnail`, `configureSharp`
(all described below).

### 4.3 Size allowlist and the cache key

**Size validation at the service boundary.** `service.getThumbnail` first checks
`isThumbnailSize(request.size)` (a guard over the shared `THUMBNAIL_SIZES`); if false it throws `new ApiError('INVALID_PARAM',
'Unsupported thumbnail size.')` (400) **before any file-system access, cache lookup or
render**. T017 also validates the query parameter and returns the same code, but the service
must not rely on its caller: the allowlist exists to prevent cache flooding via arbitrary
sizes (§5.6), and that guarantee belongs to the component that writes the cache.
`isThumbnailSize` is strict: only the four integer values; `256.5`, `'256'`, `NaN`,
`Infinity`, negatives, `0` and `undefined` are all rejected. A non-absolute `absPath` is a
programming error: throw a plain `Error`, not an `ApiError` (it indicates a caller that
skipped `resolveSafe`).

**Cache key**, verbatim from §5.6:

```ts
sha256(realAbsPath + '|' + mtimeMs + '|' + fileSize + '|' + size + '|' + PIPELINE_VERSION)
// hex digest, first 32 characters
```

```ts
import { createHash } from 'node:crypto';

export function computeThumbnailKey(i: { absPath: string; mtimeMs: number; fileSize: number; size: number }): string {
  return createHash('sha256')
    .update(i.absPath + '|' + i.mtimeMs + '|' + i.fileSize + '|' + i.size + '|' + PIPELINE_VERSION)
    .digest('hex')
    .slice(0, 32);
}
```

- `absPath` is the **real, symlink-resolved absolute path** as supplied by the caller.
- `mtimeMs` and `fileSize` come from a single `fs.stat(absPath)` of the source (use
  `stat.mtimeMs` as the JS number, concatenated with default number formatting, and
  `stat.size`). Including them means an edited or replaced image invalidates itself with no
  explicit bookkeeping. Old entries are simply never requested again and age out via T018.
- `size` is the validated integer.
- `PIPELINE_VERSION` is a module constant, initially `1`. **Purpose:** the key is derived from
  the *input* file, not from the *output* bytes, so a change to the pipeline would otherwise
  keep serving stale thumbnails. Bump this constant in any commit that changes the rendering
  (resize fit/position, WebP quality or effort, orientation handling, the output format, the
  SVG density), and consider bumping it on a sharp major/minor upgrade that visibly changes
  encoder output. Doing so changes every key, so old cache files become unreachable and are
  collected by the sweep. Add a comment above the constant stating exactly this rule.
- The result is lowercase hex, exactly 32 characters (128 bits: ample against accidental
  collision for a personal cache).

**Decision (not specified):** the `stat` result is also used to reject non-files. If
`!stat.isFile()` the service throws `ApiError('NOT_A_FILE')` (a defensive duplicate of
T017's `assertFile`; it is one branch and costs nothing). `stat` failures go through
`mapFsError` (`ENOENT` -> 404 `NOT_FOUND`, `EACCES`/`EPERM` -> 403 `ACCESS_DENIED`).

### 4.4 On-disk layout and naming

Two-level fan-out keeps directories small (a flat directory of tens of thousands of files
is slow to list on every OS):

```
<cacheDir>/<key[0..1]>/<key>.webp                      final, immutable, content-addressed
<cacheDir>/<key[0..1]>/<key>.<pid>-<random>.tmp        in-progress write (never visible as .webp)
```

- `key[0..1]` is the first two hex characters (256 shard directories).
- `thumbnailPathFor(cacheDir, key)` returns the final path; it is a pure function and the
  only place the layout is encoded. T017 does not compute paths itself; it uses
  `ThumbnailResult.filePath`.
- The temp file is created **in the same shard directory as its destination**, so the final
  `rename` never crosses a file system (a cross-device rename is a copy and is not atomic;
  `EXDEV`). The temp name carries `process.pid` and 8+ random hex characters
  (`crypto.randomBytes(6).toString('hex')`), so two server processes, or two service
  instances, that render the same key never collide on the temp file.
- **Naming contract for T018:** completed cache files end in `.webp`; in-progress or
  orphaned writes end in `.tmp` and are never valid entries. The sweep must ignore `.tmp`
  files younger than a threshold (suggested: one hour) and delete older ones, since a crash
  can orphan a temp file. This ticket does not implement that deletion.
- Final files are never modified after the rename. Entries are immutable.

### 4.5 The sharp pipeline

The renderer (`renderThumbnail`, the default `render`) implements §5.6 step 3 exactly:

```ts
import sharp from 'sharp';

sharp(absPath, { failOn: 'none', limitInputPixels: 268402689 })
  .rotate()
  .resize(size, size, { fit: 'cover', position: 'centre' })
  .webp({ quality: 72, effort: 4 })
  .toFile(destPath);
```

Do not change any of these values. Details and reasons:

- **`failOn: 'none'`.** Do not abort on recoverable decode problems (truncated JPEG, minor
  corruption). The grid prefers a slightly damaged thumbnail over a missing one. Totally
  undecodable input still throws and becomes `THUMBNAIL_FAILED` (§4.10).
- **`limitInputPixels: 268402689`** (equals 16383 x 16383 and is also sharp's default; it is
  set explicitly so the policy is visible and testable). Larger images are rejected before
  decoding, which bounds memory (decompression bombs; NFR-3, NFR-5). The service option
  `limitInputPixels` overrides the value in tests only.
- **`.rotate()` with no argument.** Called without an angle, sharp reads the EXIF
  `Orientation` tag, rotates/flips the pixels accordingly and (because metadata is not
  re-attached) discards the tag. Portrait phone photos, which are stored landscape with
  orientation 6 or 8, therefore appear upright in the grid instead of sideways. Passing an
  angle would force a fixed rotation and break this. `.rotate()` must come **before**
  `.resize()` so the crop is computed on the upright image.
- **`.resize(size, size, { fit: 'cover', position: 'centre' })`.** `cover` scales the image so
  it fills the `size` x `size` square entirely and crops the overflow around the centre. The
  explorer grid is a chooser, not a viewer (§5.6, assumption A4): uniform square tiles keep
  the layout tidy, and cropping is acceptable because the full image is one click away in
  the player. `fit: 'inside'` would produce ragged, letterboxed tiles. (Note sharp's spelling
  `'centre'`; `'center'` is accepted too, but use the specified string.)
  **Decision (not specified):** do not set `withoutEnlargement`. A 20 x 20 icon is upscaled so
  every tile is exactly `size` x `size`, which the grid layout assumes.
- **`.webp({ quality: 72, effort: 4 })`.** Lossy WebP at quality 72 is a good size/quality
  trade-off for 128 to 512 px tiles; `effort: 4` (range 0 to 6; the default) trades encode
  time for size sensibly under the CPU cap. Format is set explicitly, so the `.tmp` extension
  of the destination does not affect the output format.
- **Metadata.** Do not call `withMetadata()`: GPS and camera EXIF in a thumbnail copy is
  unnecessary and a privacy leak should the cache directory ever be shared. Sharp strips it
  by default. A test asserts it.
- **Animated inputs.** GIF and animated WebP are decoded as their first frame only (sharp's
  default). **Decision (not specified):** thumbnails are static.
- **`toFile(destPath)`** writes the encoded WebP to the temp path (§4.6). Do not use
  `toBuffer()`: it holds the encoded output in the JS heap for no benefit.

**SVG inputs.** Vector files have no intrinsic pixel size, so the rasterisation density
matters. For an input whose lower-cased extension is `.svg`, the sharp options gain
`density: 96`:

```ts
export function sharpInputOptions(absPath: string, limitInputPixels: number): sharp.SharpOptions {
  const options: sharp.SharpOptions = { failOn: 'none', limitInputPixels };
  if (path.extname(absPath).toLowerCase() === '.svg') options.density = 96;
  return options;
}
```

`density: 96` (instead of sharp's default 72) matches the CSS pixel size of an SVG whose
`width`/`height` use physical units, so `width="1in"` rasterises to 96 px. SVGs remain
**subject to `limitInputPixels`**: an SVG declaring `width="100000" height="100000"` is
rejected rather than rasterised to ten billion pixels. `density` is passed only for SVG;
passing it for raster formats is meaningless. Other formats are detected by *content*, not
extension, so a `.jfif` (JPEG data) or a mis-named file is handled correctly.

### 4.6 Atomic write

`generate(job)` for a cache miss:

1. `await fs.mkdir(shardDir, { recursive: true, mode: 0o700 })` (idempotent; `mode` is
   ignored on Windows).
2. `tmpPath = path.join(shardDir, `${key}.${process.pid}-${randomHex}.tmp`)`.
3. Acquire a semaphore permit (§4.7), then `await render({ absPath, size, destPath: tmpPath, limitInputPixels })`, then release the permit. The permit covers **only** the sharp
   work, not the `mkdir`, `stat` or `rename`.
   **Shard-vanished retry (once).** T018's sweep removes a shard directory with a plain
   `rmdir` after evicting its last file, and that can happen between step 1 and the moment
   sharp creates the temp file inside it. If `render` rejects with `code === 'ENOENT'` **and**
   the shard directory no longer exists (`await exists(shardDir)` is false; a source image that
   vanished leaves the shard intact and is not retried), repeat step 1 and re-run `render`
   exactly once inside the same permit. A second failure is mapped like any other (§4.10).
   Because `mkdir -p` is idempotent and `rmdir` refuses a non-empty directory, either
   interleaving with the sweep is then safe.
4. `await renameWithRetry(tmpPath, finalPath)`.
5. On **any** failure in steps 1 to 4: `await fs.rm(tmpPath, { force: true })` (swallowing its
   own errors), then rethrow (mapped, §4.10). The `catch` must run for failures from `render`
   and for failures from `rename`.

A concurrent reader (T017 calling `sendFile` on the final path) can therefore only ever see
either no file or a complete one: `rename` within one directory is atomic on every
supported OS, and the final name never exists in a partial state.

**`rename` onto an existing file and Windows lock errors.** On POSIX, `rename` silently
replaces the destination. On Windows Node's `fs.rename` also replaces an existing file
(`MoveFileEx` with replace semantics) but fails with `EPERM`, `EACCES` or `EBUSY` when
another process holds the destination open without delete sharing, which antivirus
scanners, the search indexer and backup tools do for a moment after a new file appears.
Node opens files with delete sharing, so Slydr's own `sendFile` reads do not block it.
Therefore:

```ts
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const BACKOFF_MS = [25, 50, 100, 200];

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE.has(code)) throw err;
      // Content-addressed: if the destination already exists, it holds identical content
      // (another request or process produced it). Our temp copy is redundant.
      if (await exists(to)) { await fs.rm(from, { force: true }); return; }
      if (attempt >= BACKOFF_MS.length) throw err;
      await sleep(BACKOFF_MS[attempt] ?? 200);   // noUncheckedIndexedAccess
    }
  }
}
```

Because the cache is content-addressed, "the destination already exists" is success, not an
error: the existing file is byte-for-byte what this render would have installed. Apply the
retry on **all** platforms (the code is identical and cheap), but expect it to trigger only
on Windows. The injectable `rename` option is how tests exercise it.

### 4.7 Semaphore

A small FIFO counting semaphore, exported as `Semaphore` for unit testing:

```ts
export class Semaphore {
  constructor(limit: number);              // RangeError if not an integer >= 1
  run<T>(task: () => Promise<T>): Promise<T>;   // acquire, run, release in finally
  get active(): number;
  get waiting(): number;
}
```

- Waiters are served strictly first-in first-out.
- The permit is released in a `finally`, so a rejecting task never leaks a permit (a leak
  would eventually deadlock all thumbnail generation).
- The limit is `min(4, os.availableParallelism())` per §5.6 and NFR-3:

  ```ts
  export function defaultConcurrency(parallelism = os.availableParallelism()): number {
    return Math.max(1, Math.min(4, Math.floor(parallelism) || 1));
  }
  ```

- Only the render (decode, resize, encode, write) is inside the permit. Cache hits and
  coalesced waiters do not take a permit, so they never queue behind renders.

### 4.8 In-flight coalescing

Each service instance has `private inflight = new Map<string, Promise<ThumbnailResult>>()`
keyed by cache key.

```ts
const run = (async () => {
  try {
    return await this.generate(job);       // semaphore + render + atomic install
  } finally {
    this.inflight.delete(key);             // always cleared, success or failure
  }
})();
this.inflight.set(key, run);
return run;
```

Request flow in `getThumbnail`:

1. Validate size and path (§4.3).
2. `stat` the source; compute the key.
3. **Cache hit check:** `stat(finalPath)`. If it exists and `size > 0`, return
   `{ filePath, key, cached: true }` (after the touch of §4.12). A zero-length final file
   cannot be produced by this service (atomic rename), so treat it as a miss and overwrite.
4. **In-flight check:** if `inflight.has(key)`, return that same promise (mapped so the
   caller sees `cached: false`). N concurrent requests for the same key trigger exactly
   **one** sharp run; the other N-1 callers await the same promise and all receive the same
   result, or the same rejection.
5. Otherwise start `generate`, register it as above, return it.

Details that matter:

- **Clear in `finally` inside the async function**, not via `promise.finally(...)` chained
  outside. A chained `.finally` produces a second promise that rejects with the same error
  and nobody handles it, which Node reports as an unhandled rejection and, depending on
  flags, terminates the process. The structure above registers the entry synchronously
  (the `await` inside the async body guarantees the `finally` runs after `set`).
- **Re-check after acquiring the permit.** Between the hit check in step 3 and a request's
  turn on the semaphore, another request or process may have installed the file. Inside
  `generate`, after the permit is obtained and before rendering, `stat(finalPath)` again and
  return it if present. This is cheap and prevents duplicate work after a queue wait.
- A failed generation is **not** retained: the entry is removed, so the next request starts
  a fresh attempt (Decision in §4.10).
- Coalescing is keyed by the full cache key, so different sizes of the same image, or the
  same image after an edit, are distinct jobs.

### 4.9 Cache directory

The service receives an absolute `cacheDir` (`ServerConfig.cacheDir`, resolved once by T008 from
`SLYDR_CACHE_DIR` or the per-OS default: Windows `%LOCALAPPDATA%\slydr\thumbnails`, macOS
`~/Library/Caches/slydr/thumbnails`, Linux `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails`).
This ticket does **not** read the environment, does not export `resolveCacheDir` and has no
default location; the per-OS table and its tests belong to T008. `createThumbnailService` throws
a plain `Error` if `cacheDir` is not absolute.

**Creation.** The service creates the directory lazily on first use with
`fs.mkdir(cacheDir, { recursive: true, mode: 0o700 })` (memoised promise; the memo is
cleared if the call fails so a later request can retry). `recursive: true` makes it
idempotent and creates missing parents (for example `~/.cache` on a fresh account). Mode
`0o700` keeps thumbnails of private photos unreadable by other local users on POSIX; it has
no effect on Windows, where the profile directory's ACL already restricts access.
**Decision (not specified):** the directory is not created at server start-up by this
ticket; the first thumbnail request or T018's sweep creates it. Do not log the directory at
`info` level on every request; one `debug` line at creation is enough. (The bootstrap may
print it once; documentation of "where the cache lives" is owned by the docs ticket.)

### 4.10 Failure mapping

Wrap `generate` so that:

- any error thrown by `render` (corrupt data, unsupported format, pixel limit exceeded,
  missing codec, out of memory in libvips, source vanished) and any error from the cache
  directory (`mkdir`, write, `ENOSPC`, `rename` after retries) is converted to
  `new ApiError('THUMBNAIL_FAILED', 'Could not generate a thumbnail.', originalError)`
  (HTTP 500). The message is fixed text; the original is attached only as `cause` for the
  logger, and **never** reaches a response body (§3.4: no `errno`, no sharp message, no
  absolute path).
- an `ApiError` thrown inside is passed through unchanged.
- the temp file is removed (§4.6).
- one log line is emitted through the injected `Logger` as `thumb.failed` at **`warn`** level
  (a corrupt user file is data, not a server fault) with `errorFields(err)`, the key, the size
  and the absolute path. Success of generation logs `thumb.generated` at `debug` with
  `{ key, size, ms, bytes }`. Because the logger is bound to the instance at construction, T017
  needs no per-call logging argument and the warn line is emitted in production.

**Decision (not specified):** failures are **not cached** (no negative cache, no marker
file). A permanently corrupt image will be retried on each request, which costs one failed
decode attempt, bounded by the semaphore and the client's 6-in-flight cap, and the client
already stops after one failure per tile by falling back to the icon. A negative cache would
need invalidation logic keyed on the same stat data and is not justified for v1.

Everything that is *not* a render problem keeps its own code: the size check is
`INVALID_PARAM`, a missing source is `NOT_FOUND`, an unreadable source is `ACCESS_DENIED`,
a non-file is `NOT_A_FILE`.

### 4.11 Global sharp configuration

`configureSharp()` is exported, idempotent (module-level boolean), and invoked lazily the
first time the default renderer runs, never at import (§4.1). It applies:

- **`sharp.cache(false)`.** **Decision (not specified).** libvips keeps recently used files
  and decoded operations in a cache. This workload decodes each source once and never
  reuses it, so the cache gives no benefit and costs memory. More importantly, sharp's
  documentation notes that on Windows the file cache can keep source images open, which
  blocks the user (and Slydr's own tests) from deleting or moving a photo after its
  thumbnail was made. Disabling the cache removes that hazard.
- **`sharp.concurrency(n)`** with `n = Math.max(1, Math.floor(os.availableParallelism() / defaultConcurrency()))`.
  **Decision (not specified).** Each sharp operation otherwise spawns a libvips thread
  pool sized to all cores; with up to four operations in flight the machine would be
  oversubscribed 4x, increasing context switching and peak memory. Dividing the cores
  among the permitted concurrent operations keeps total thread count near the core count.
  (On a 4-core machine this is 1 thread per operation; on 16 cores, 4.)
- Leave `sharp.simd()` at its default.

Document both decisions in a comment above `configureSharp`. Because these are process-wide
settings, a test that replaces the renderer never triggers them.

### 4.12 Cache hits and "last used"

T018 evicts least-recently-used files using recency `max(atime, mtime)` (spec §5.6). This
section is the **only** place a cache hit refreshes a file's timestamps; T018 contains no
touch logic and relies on this one. Access times are unreliable: Windows disables last-access updates on NTFS by default, and Linux
and macOS commonly mount with `relatime`/`noatime`. **Decision (not specified):** on a cache
hit, if `now() - stat.mtimeMs > touchIntervalMs` (default one hour), call
`fs.utimes(filePath, now, now)` best effort (errors ignored, not awaited on the response
path beyond the call itself). This sets both `atime` and `mtime` to "last used" so the sweep
works on every file system, and the one-hour threshold limits the extra system calls to at
most one per file per hour. The final file's content is untouched, so the strong `ETag`
(the key) stays valid. Newly written files already have a current `mtime`.

### 4.13 Cross-platform notes

| Concern | win32 | darwin | linux |
|---|---|---|---|
| Cache location (resolved by T008, passed in as `cacheDir`) | `%LOCALAPPDATA%\slydr\thumbnails` | `~/Library/Caches/slydr/thumbnails` | `${XDG_CACHE_HOME:-~/.cache}/slydr/thumbnails` |
| `fs.rename` over an existing file | replaces, but `EPERM`/`EACCES`/`EBUSY` if the destination is momentarily open elsewhere (antivirus, indexer): retried (§4.6) | atomic replace | atomic replace |
| Open source file handles | libvips may hold a source image open; blocks delete/rename of the photo: mitigated by `sharp.cache(false)` | no lock | no lock |
| Path in cache key | backslashes, drive letter; case preserved as supplied | `/`, case preserved | `/`, case-sensitive |
| Directory mode `0o700` | ignored | honoured | honoured |
| Temp dir for tests | 8.3 short names possible; `fs.realpath` the base | `/var` symlinks to `/private/var`; `fs.realpath` the base | plain |
| sharp prebuilt binary | `@img/sharp-win32-x64` (optional dependency) | `@img/sharp-darwin-arm64` / `-x64` | `@img/sharp-linux-x64` (glibc) or `-linuxmusl-x64` |
| Long paths | cache path is about 100 characters; well below 260 | n/a | n/a |

## 5. Acceptance criteria

- [ ] `server/src/services/thumbnails.ts` exists and exports the API in §4.2; importing it has
      no side effects (no directory creation, no `sharp` global configuration, no singleton).
      It exports no `resolveCacheDir`, no free `getThumbnail` and no
      `resetThumbnailServiceForTests`, and it imports `THUMBNAIL_SIZES`/`ThumbnailSize` from
      `@slydr/shared` without redefining them.
- [ ] `service.getThumbnail` returns `{ filePath, key, cached }` where `filePath` is
      `<cacheDir>/<key[0..1]>/<key>.webp`, the file exists, and it is a valid WebP of exactly
      `size` x `size` pixels, for each of 128, 256, 384, 512.
- [ ] The key equals `sha256(realAbsPath|mtimeMs|fileSize|size|PIPELINE_VERSION)` rendered as
      hex and truncated to 32 characters; it changes when `mtimeMs`, file size, `size`,
      path or `PIPELINE_VERSION` changes, and is stable otherwise.
- [ ] A second request for the same unchanged image and size is a cache hit
      (`cached: true`), and the renderer is not invoked.
- [ ] Editing the source (new `mtime`, or a different size) produces a different key and a
      fresh render.
- [ ] Any size outside `{128, 256, 384, 512}` (including `256.5`, `'256'`, `0`, `NaN`)
      throws `ApiError` `INVALID_PARAM` before any file-system access.
- [ ] The pipeline is exactly the specified `sharp(...)`, `.rotate()`, `.resize(size, size,
      { fit: 'cover', position: 'centre' })`, `.webp({ quality: 72, effort: 4 })` chain with
      `failOn: 'none'` and `limitInputPixels: 268402689`; SVG inputs additionally get
      `density: 96`.
- [ ] An image with EXIF orientation 6 or 8 produces an upright (rotated) thumbnail; the
      output carries no EXIF metadata.
- [ ] The crop is centred `cover`, not a stretch.
- [ ] While a render is in progress, the final `.webp` path does not exist and the in-progress
      file has a `.tmp` extension in the same shard directory; after completion no `.tmp`
      file remains.
- [ ] A render or rename failure leaves no `.tmp` file and no final file.
- [ ] `Semaphore` never lets more than `limit` tasks run, serves waiters FIFO and releases the
      permit when a task throws; `defaultConcurrency()` equals `min(4, availableParallelism)`
      and is at least 1.
- [ ] N concurrent calls for one key run the renderer exactly once and resolve to equal
      results; the in-flight map is empty afterwards, including after a failure.
- [ ] Any decode/resize failure (garbage bytes, zero-byte file, oversize pixel count) rejects
      with `ApiError` `THUMBNAIL_FAILED` (HTTP 500) whose `message` contains no path and
      no sharp text; a following valid request on the same service still succeeds.
- [ ] The supplied `cacheDir` is created recursively on first use (mode `0o700` on POSIX); a
      relative `cacheDir` is rejected with a plain `Error`.
- [ ] If the shard directory is removed after `mkdir` and before the temp file is written, the
      render is retried once after re-creating it and the call succeeds; a vanished *source*
      is not retried.
- [ ] A generation failure is logged once through the injected `Logger` as `thumb.failed` at
      `warn`; a success as `thumb.generated` at `debug`.
- [ ] `rename` failures with `EPERM`/`EACCES`/`EBUSY` are retried; if the destination
      appears meanwhile, the call succeeds and the temp file is removed.
- [ ] Cache hits older than the touch interval refresh `atime`/`mtime`; recent hits do not.
- [ ] Deleting a source image immediately after its thumbnail was generated succeeds on
      Windows (no retained file handle).

## 6. Tests to write

All in **`server/test/services/thumbnails.test.ts`** (Vitest), per specification §12.1:
"cache-key invalidation on `mtime` / size change, in-flight coalescing, atomic rename,
`size` allowlist rejection, failure path", plus EXIF orientation and the semaphore ceiling.

### Fixture and helpers

**The shared fixture generator is T037; do not depend on it.** In `beforeAll` create a base
directory with `makeTempBase('slydr-thumbs-')` from `server/test/helpers/fs.ts` (already
`realpath.native`'d: macOS `/var` and Windows 8.3 short names). Under it create `src/` for
images and a fresh `cache-<n>/` directory **per test** (so tests never share cache state);
build each service with `createThumbnailService({ cacheDir, logger })` where `logger` comes
from `createTestLogger()` (`server/test/helpers/logger.ts`). Remove the base in `afterAll` with
`removeTree(base)`. The tests need no Express app and no jail.

The image helpers below live in **`server/test/helpers/images.ts`** (created by this ticket;
T017 imports them). Synthesise images with sharp from raw pixels, never from checked-in
binaries:

- `makeJpeg(file, width, height, { orientation? })`: build a raw RGB buffer, left half
  pure red `(255,0,0)` and right half pure blue `(0,0,255)`, then
  `sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation }).toFile(file)`.
  Use `quality: 95` and a solid-colour layout so lossy WebP at quality 72 still yields
  clearly separable colours (assert with tolerances, for example `r > 180 && b < 80`).
- `makeBands(file)`: 300 x 100 PNG with three vertical 100-px bands red / green / blue.
- `makePng(file)`, `makeGif(file)`, `makeWebp(file)`, `makeAvif(file)` (64 x 64), and an SVG as
  text (`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>`).
- `pixelAt(webpFile, x, y)`: `sharp(file).raw().toBuffer({ resolveWithObject: true })` and read
  the RGB triplet.
- A fake renderer factory: `fakeRender({ delayMs, onStart, onFinish })` that writes a small
  valid payload (any bytes) to `destPath`, records invocation count and the maximum
  simultaneous activity, and can be told to reject.
- `deferred()` for gating a fake render until the test releases it.

Never touch the real cache directory or read the environment in any test: every service gets an
explicit temporary `cacheDir`.

### Cases — cache key

1. `key matches the specified formula` — recompute with `crypto` from
   `absPath|mtimeMs|fileSize|size|PIPELINE_VERSION` and compare to `computeThumbnailKey`.
2. `key is 32 lowercase hex characters`.
3. `key is stable for identical input`.
4. `key changes when mtimeMs changes` (pure function, `mtimeMs + 1`).
5. `key changes when fileSize changes`.
6. `key changes when size changes` (256 vs 384).
7. `key changes when the path changes`.
8. `PIPELINE_VERSION is part of the key` — assert the formula in case 1 uses the exported
   constant (guards accidental removal).

### Cases — cache behaviour (fake renderer)

9. `second call for an unchanged file is a cache hit` — render count 1, second result
   `cached: true`, equal `key` and `filePath`.
10. `changing mtime invalidates` — after the first call, `fs.utimes(src, now + 60, now + 60)`;
    the next call has a different `key`, renders again, and the old file still exists
    (eviction is T018's job).
11. `changing file size invalidates` — append bytes, then restore the original `mtime` with
    `fs.utimes`; the key differs because `fileSize` differs.
12. `file layout` — `filePath === path.join(cacheDir, key.slice(0, 2), key + '.webp')`, the
    shard directory exists, the file exists.
13. `cache directory is created recursively on first use` — pass a `cacheDir` whose parents do
    not exist; first call succeeds; a second service on the same path (already existing)
    also works.
14. `cache directory is private on POSIX` — `it.skipIf(process.platform === 'win32')`:
    `(await fs.stat(cacheDir)).mode & 0o077 === 0`.
15. `a hit refreshes last-used when older than the touch interval` — inject `now`, set the
    cache file's `mtime` two hours in the past, call again; `mtime` is now within a second
    of the injected `now`. A second case with a file touched 5 minutes ago leaves `mtime`
    unchanged.
16. `a zero-length cache file is treated as a miss` — pre-create an empty final file, expect
    a render and a non-empty result.
17. `missing source is NOT_FOUND, directory is NOT_A_FILE` — `ApiError` codes, renderer not
    called.

### Cases — cache directory

18. `a relative cacheDir is rejected` — `createThumbnailService({ cacheDir: "rel/dir" })` throws a
    plain `Error` (not an `ApiError`). The per-OS default location, `XDG_CACHE_HOME` and
    `SLYDR_CACHE_DIR` handling are **T008**'s `readServerConfig` and are tested there; this ticket
    has no `resolveCacheDir`.

### Cases — size allowlist

19. `accepts 128, 256, 384, 512`.
20. `rejects other sizes` — table: `0`, `1`, `100`, `255`, `257`, `1024`, `-256`, `256.5`,
    `NaN`, `Infinity`, `'256'`, `null`, `undefined` -> rejects with `ApiError`,
    `code === 'INVALID_PARAM'`, `status === 400`; renderer not called; the cache directory
    was not created; and the rejection happens even for a non-existent `absPath`
    (proving validation precedes the file system).
21. `rejects a relative absPath` with a plain `Error` that is not an `ApiError`.

### Cases — in-flight coalescing

22. `N concurrent requests run one render` — 20 calls with `Promise.all`, renderer gated by
    a `deferred()` until all 20 are issued; render count 1; all results deep-equal;
    `inflightCount() === 0` afterwards.
23. `different sizes of the same image are separate jobs` — 256 and 384 concurrently -> two
    renders, two keys.
24. `a failure is shared and then forgotten` — gate and reject the renderer with
    `new Error('boom')`; all 20 callers reject with `THUMBNAIL_FAILED`; render count 1;
    `inflightCount() === 0`; a later call starts a new render (count 2).
25. `a caller arriving after completion gets a hit, not a render`.
26. `coalesced waiters do not occupy permits` — concurrency 1, ten callers for key A plus one
    for key B, A's render gated: B is queued behind A's single permit, A's nine duplicates
    do not add queue entries (`semaphore.waiting === 1` observable through the fake's
    activity), everything resolves with no deadlock once released.
27. `no unhandled rejection` — register `process.on('unhandledRejection')` for the duration
    of case 24 and assert it was never called (guards the `.finally` chaining mistake).

### Cases — semaphore

28. `Semaphore never exceeds its limit` — limit 2, six tasks each recording concurrent count
    with a short `setTimeout`; maximum observed is exactly 2.
29. `Semaphore is FIFO` — tasks start in submission order.
30. `Semaphore releases on rejection` — a throwing task does not stop a queued task from
    running; `active` returns to 0.
31. `Semaphore rejects invalid limits` — `0`, `-1`, `1.5`, `NaN` -> `RangeError`.
32. `defaultConcurrency` — `(1) = 1`, `(2) = 2`, `(4) = 4`, `(8) = 4`, `(64) = 4`, `(0) = 1`.
33. `service honours the ceiling` — `createThumbnailService({ concurrency: 3, render: fake })`
    with 12 **distinct** images (distinct paths), each render held about 20 ms; the
    maximum simultaneous renders is exactly 3 (and not 12), and all 12 resolve.

### Cases — atomic rename

34. `no partial file is observable` — fake renderer writes the first half of the payload to
    `destPath`, then waits on a `deferred()`. While paused: the final path does not exist;
    `readdir(shardDir)` contains exactly one entry, ending `.tmp`, in the same directory as
    the future final path. Release, await: the final file exists with the full payload and
    `readdir` shows no `.tmp`.
35. `failure after a partial write cleans up` — fake renderer writes bytes then rejects:
    rejects `THUMBNAIL_FAILED`, shard dir has no `.tmp` and no `.webp`.
36. `readers polling during a real render never see a partial file` — real sharp on a
    2000 x 1500 JPEG; start the call, poll `fs.stat(finalPath)` every 1 ms in parallel; the
    first time the path exists, `sharp(finalPath).metadata()` must succeed with the expected
    `width`/`height`.
37. `rename is retried on EPERM, EACCES and EBUSY` — injected `rename` rejects twice with
    `{ code: 'EBUSY' }` then succeeds: resolved, injected `rename` called 3 times.
38. `rename failure with the destination already present is success` — injected `rename`
    always rejects `EPERM` while the test pre-creates the final file: the call resolves, and
    the `.tmp` file is removed.
39. `rename that keeps failing without a destination fails cleanly` — always `EPERM`, no
    destination: rejects `THUMBNAIL_FAILED` after the retries (use `now`/tiny backoff
    override or fake timers), `.tmp` removed.
40. `two service instances racing on the same key both succeed` — two
    `createThumbnailService` on one `cacheDir`, real sharp, one image, `Promise.all`: both
    resolve to the same `filePath`; the file is a valid WebP; no `.tmp` remains. (This is the
    two-process scenario.)
41. `non-retryable rename errors are not retried` — `ENOSPC` -> one attempt, `THUMBNAIL_FAILED`.

### Cases — real sharp pipeline

42. `produces a square WebP of the requested size` — for sizes 128/256/384/512 and inputs
    landscape 400 x 200, portrait 200 x 400 and tiny 20 x 20 (upscaled): `sharp(out).metadata()`
    reports `format === 'webp'`, `width === height === size`.
43. `uses centre cover, not stretch` — `makeBands`, size 128: the left edge, centre and right
    edge pixels are all green (the middle band), proving the sides were cropped. A stretched
    image would show red at the left and blue at the right.
44. `applies EXIF orientation` — table over orientations: a 200 x 100 JPEG (red left, blue
    right) with `orientation: 6` -> top-centre pixel red, bottom-centre blue; with
    `orientation: 8` -> top blue, bottom red (the stored left edge ends at the bottom);
    control with no orientation -> left red, right blue. Assert with colour tolerances.
45. `output has no EXIF` — `(await sharp(out).metadata()).exif` is `undefined`.
46. `other formats` — PNG with alpha, GIF (first frame), WebP, AVIF each produce a valid
    square WebP.
47. `SVG` — a small SVG produces a valid square WebP; an SVG with `width="100000"
    height="100000"` rejects `THUMBNAIL_FAILED` (pixel limit) quickly and without large
    memory use.
48. `sharpInputOptions` — `.svg` and `.SVG` include `density: 96`; `.jpg` and `.png` do not;
    all include `failOn: 'none'` and the supplied `limitInputPixels`.
49. `BMP` — a BMP fixture either produces a WebP or rejects with `ApiError`
    `THUMBNAIL_FAILED`; it must never throw a different error type (the bundled libvips
    may not decode BMP; see §8). Do not assert which.
50. `injected limitInputPixels is enforced` — service with `limitInputPixels: 100` and a
    400 x 200 JPEG -> `THUMBNAIL_FAILED`.
51. `truncated JPEG still thumbnails (failOn none)` — truncate a valid JPEG to 90% of its
    length -> resolves with a valid WebP.
52. `release of file handles` — after a real render, `fs.unlink(sourceImage)` and
    `fs.rm(base-subdir)` succeed immediately (guards `sharp.cache(false)`; meaningful on
    Windows, harmless elsewhere).

### Cases — failure path

53. `garbage bytes in a .jpg` (`'this is not an image'`), a zero-byte `.png`, and a text file
    named `.webp` each reject with an `ApiError`: `code === 'THUMBNAIL_FAILED'`,
    `status === 500`; `message` is the fixed text; `JSON.stringify` of the error's public
    fields contains neither the absolute path nor sharp's message; `cause` is set to the
    original error; no `.tmp` and no `.webp` left in the cache.
54. `one corrupt file does not poison the service` — after case 53's failure, a valid image on
    the same service instance succeeds, and a retry of the corrupt file fails again (not
    cached).
55. `failures are logged at warn, not error` — with `createTestLogger()` injected into the
    service, one `thumb.failed` event at level `warn` carrying the key and size, none at
    `error`; a successful render logs one `thumb.generated` event at `debug`.
56. `renderer error of any type maps to THUMBNAIL_FAILED` — fake renderer throws a string,
    a plain `Error`, an `ENOENT` (source vanished) and a `TypeError`.
57. `ApiError thrown inside passes through unchanged` — fake renderer throws
    `new ApiError('ACCESS_DENIED')` -> the same code surfaces.
58. `a shard directory removed between mkdir and the temp write is recreated once` — fake
    renderer: on its first call it `fs.rm`s the shard directory and rejects with
    `{ code: 'ENOENT' }`; on the second call it writes normally. The call resolves, the renderer
    ran twice, no `.tmp` remains.
59. `a vanished source is not retried` — fake renderer rejects with `{ code: 'ENOENT' }` while the
    shard directory still exists: rejects `THUMBNAIL_FAILED`, renderer called exactly once.
60. `the retry happens at most once` — fake renderer always removes the shard and rejects
    `ENOENT`: rejects `THUMBNAIL_FAILED`, renderer called exactly twice.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by tests; `npm test` green on the dev machine (Windows 11) and in CI
      on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- [ ] No test reads or writes the real user cache directory.
- [ ] Tests that depend on file permissions skip with a reason on Windows and as root; none
      are flaky under `--repeat` (no fixed sleeps longer than needed; gate with `deferred`).
- [ ] Each **Decision (not specified)** in section 4 appears as a code comment at the relevant
      line.
- [ ] `sharp` is declared in `server/package.json` and the lockfile is updated; installation
      verified on all three CI platforms (platform binaries come from optional
      dependencies: do not use `--omit=optional`).
- [ ] No absolute path, `errno` or sharp message is reachable from any thrown `ApiError`'s
      public fields.
- [ ] README: no change needed from this ticket (the cache location and how to clear it are
      documented by T041, which should reference `ServerConfig.cacheDir` / `SLYDR_CACHE_DIR`).
- [ ] `server/test/helpers/images.ts` exists and is imported (not copied) by T017's tests.

## 8. Notes and gotchas

- **The pipeline values are specified; do not tune them.** Any change to resize, quality,
  effort, orientation handling, output format or SVG density requires bumping
  `PIPELINE_VERSION` in the same commit, or users keep seeing stale thumbnails.
- **Chained `.finally` pitfall.** `inflight.set(key, p); p.finally(() => inflight.delete(key))`
  creates an extra promise that re-throws `p`'s rejection with no handler: an unhandled
  rejection on every failed thumbnail. Clear the map inside the async function's own
  `finally` (§4.8).
- **BMP.** `IMAGE_EXTENSIONS` includes `.bmp` (browsers render it), but the libvips build
  bundled with sharp does not include a BMP decoder, so `.bmp` files will normally fail with
  `THUMBNAIL_FAILED` and show the generic icon in the grid, while the player (which streams
  originals to `<img>`) works. **Decision (not specified):** accept this in v1; no
  conversion path. Test 49 is deliberately tolerant so a future sharp that adds BMP support
  does not break the build.
- **Animated GIF/WebP** thumbnail as the first frame only.
- **Symlinked names (FR-2.1).** A file reached through a symlink is rendered from the resolved
  target's bytes; the format is detected by content. `sharpInputOptions` looks at the resolved
  path's extension only to choose `density: 96` for SVG, so a link named `x.svg` pointing at a
  file not named `.svg` still decodes (sharp detects SVG by content) but at sharp's default
  density. Accepted: rare, and affects only the raster size of an SVG with physical units.
- **Touch ownership.** The touch-on-hit rule (§4.12) and the shard-vanished retry (§4.6) live
  here only. T018 sweeps and never touches files.
- **Truncated images.** `failOn: 'none'` means a half-downloaded JPEG yields a thumbnail
  with a grey or smeared lower part, which is then cached under that file's `mtime` and
  size. If the file is later completed, `size` and `mtime` change and a new key is made. This
  is the intended behaviour.
- **mtime precision.** `mtimeMs` is a floating-point millisecond value whose precision
  differs between NTFS, ext4 and APFS. It is used verbatim and only compared for equality
  across calls on the same file system, so the difference is harmless. Tools that copy files
  and preserve `mtime` while changing content of identical length would not invalidate the
  entry; `fileSize` makes that case very unlikely. This is the trade-off the specification
  chose over hashing file contents (which would require a full read per request).
- **Case-insensitive volumes.** The key uses `absPath` exactly as supplied. If a caller ever
  passed the same file with different casing it would create two cache entries; harmless
  (wasted space only). T017 must pass the output of `resolveSafe`, never the raw query.
- **Trust boundary.** This service performs no jail check. Anything passed in is rendered and
  its path logged. Keeping `resolveSafe` -> `assertFile` -> extension check in T017 is part
  of that ticket's acceptance criteria.
- **Untrusted SVG.** librsvg does not execute scripts, and it restricts external file
  references to the SVG's own directory tree, which is acceptable for a local tool reading
  the user's own files. The pixel limit is the important protection and is covered by tests.
- **Memory.** Peak memory is approximately `concurrency x (decoded source size + working
  buffers)`. For a 24 MP JPEG that is roughly 100 MB per operation, hence the limit of 4 and
  the explicit `limitInputPixels`. Do not raise either without measuring.
- **Disk full / cache-dir unwritable.** `ENOSPC`, `EACCES` on the cache directory, or a
  read-only file system surface as `THUMBNAIL_FAILED`; the server keeps working and the grid
  falls back to icons. Users can point `SLYDR_CACHE_DIR` somewhere else.
- **Orphaned `.tmp` files** can appear if the process is killed mid-render. T018 deletes old
  ones (naming contract in §4.4). They are harmless otherwise because they never end in
  `.webp`.
- **Immutability helps T017.** Because a given key's file never changes, the strong `ETag`
  equal to the key and `Cache-Control: private, max-age=604800` are always correct, and
  `sendFile` can stream `ThumbnailResult.filePath` directly.
