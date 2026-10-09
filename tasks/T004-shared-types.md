# T004 — Define the shared API contract types

**Epic:** E2 — Shared domain package
**Spec sections:** §4.1, §5.1–§5.6, §3.5
**Depends on:** T001, T002
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based slide-show application. It is split into an Express API that reads the local file system beneath the user's home directory and a React single-page application that browses that file system, configures a slide show, and plays it. The two halves talk over a small HTTP API, and the single most valuable thing the repository can own is one authoritative TypeScript description of that API, imported unchanged by both sides so the contract cannot drift.

This ticket creates that description: the `@slydr/shared` package's `types.ts` module, plus the package barrel `index.ts`. It defines the entry-classification model, the response body of every endpoint, the error envelope and its code union, and the numeric limits that both halves must agree on (maximum entries per listing, maximum recursion depth, maximum images per scan, allowed thumbnail sizes).

Nothing in this ticket contains behaviour. It is types and constants only, and it is the dependency for essentially every other ticket in the project — the server imports it to shape its responses, the client imports it to type its fetch wrapper.

## 2. Scope

### In scope

- Create `shared/src/types.ts` containing:
  - `EntryType` and `FsEntry` (verbatim from specification §4.1).
  - `ImageItem`, derived from the `items[]` JSON shape in specification §5.4.
  - `EntryCounts`.
  - One response interface per endpoint: `HealthResponse`, `RootResponse`, `ListResponse`, `ImagesResponse`.
  - `API_ERROR_CODES` and the `ApiErrorCode` union derived from it, covering every code in the specification §3.5 table.
  - `ApiErrorEnvelope`.
  - The shared limit constants `MAX_ENTRIES`, `MAX_DEPTH`, `MAX_IMAGES`.
  - The allowed thumbnail sizes `THUMBNAIL_SIZES`, the `ThumbnailSize` type derived from them, and `DEFAULT_THUMBNAIL_SIZE`.
- Create `shared/src/index.ts` as the package barrel, re-exporting everything from `types.ts`.
- Confirm (and if absent, add) the `exports` / `types` wiring in `shared/package.json` so that `import { FsEntry } from '@slydr/shared'` resolves from the `server` and `client` workspaces.
- A test file that both type-checks the contract and asserts the runtime constants.

### Out of scope

- `SlideshowConfig`, `DEFAULT_CONFIG` and `parseConfig` — owned by T006 (`shared/src/config.ts`). Do **not** define the configuration type here even though specification §4.4 sits in the same chapter of the specification.
- `IMAGE_EXTENSIONS`, the extension-to-MIME map and the classification helpers — owned by T005 (`shared/src/images.ts`).
- The POSIX wire-path helpers (`wireJoin`, `wireParent`, `breadcrumbSegments`, …) — owned by T007 (`shared/src/paths.ts`).
- The mapping from `ApiErrorCode` to an HTTP status code, and the `ApiError` class thrown by the client's fetch wrapper. The status mapping belongs to the server's error-envelope middleware; the client-side error class belongs to the client's typed API client. This ticket documents the intended statuses in a comment table only.
- Any request or query-parameter validation. Parsing `showHidden`, `recursive` and `size` is server-side work in later tickets.
- Runtime schema validation (Zod or similar). `@slydr/shared` must stay dependency-free; see section 8.

## 3. Prerequisites and assumed state

This ticket starts from the repository produced by T001 and T002. The following is assumed to exist already and must not be re-created:

- **T001 — npm workspaces monorepo.**
  - `package.json` at the repository root declaring `"private": true`, `"type": "module"`, npm workspaces `["shared", "server", "client"]`, and an `engines` field requiring Node `>= 22`.
  - `tsconfig.base.json` at the root with `"strict": true`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `verbatimModuleSyntax`, which each workspace's `tsconfig.json` extends. Code in this ticket and its siblings must compile under these flags.
  - `shared/package.json` with `"name": "@slydr/shared"` and `"type": "module"`, `shared/tsconfig.json` (module `NodeNext`, `types: []`, includes `src` and `test`) and `shared/tsconfig.build.json`, and a placeholder `shared/src/index.ts`.
  - `server/` and `client/` workspaces exist and may already declare `@slydr/shared` as a workspace dependency.
  - Root scripts `npm run typecheck` (`tsc --noEmit` across workspaces) and `npm run build` are wired.
- **T002 — lint, format and test tooling.**
  - ESLint 9 flat config at the repository root (`eslint.config.js`) covering `shared/**/*.ts`, reachable via `npm run lint`.
  - Prettier configured at the root and reachable via `npm run format`.
  - Vitest configured (root `vitest.config.ts` with `projects`, plus `shared/vitest.config.ts`) so that **`shared/test/**/*.test.ts`** runs in the **node** environment, reachable via `npm test`. Tests live in `shared/test/`, not next to the source (T001 §4.1). Vitest globals are off: import `describe`, `it`, `expect` from `'vitest'`.

`shared/src/index.ts` currently contains only the T001 placeholder (`export {};` plus a comment). Replace its contents rather than adding a second barrel. `shared` uses `NodeNext` module resolution, so relative imports need a `.js` extension (see section 4.6).

## 4. Implementation detail

### 4.1 `shared/src/types.ts` — entry classification (verbatim, specification §4.1)

Copy these declarations exactly, including the trailing comments, which document the nullability rules the server must honour:

```ts
export type EntryType = 'folder' | 'image' | 'file';

export interface FsEntry {
  name: string;        // basename as it appears on disk
  path: string;        // wire path, relative to jail root, POSIX separators
  type: EntryType;
  hidden: boolean;     // see 4.3
  size: number | null; // bytes; null for folders and on stat failure
  mtimeMs: number | null;
}
```

Context the implementer should preserve in a short module-level comment, because it explains why the fields are shaped this way:

- `path` is a **wire path**: POSIX-style, forward-slash separated, relative to the jail root (the user's home directory), never absolute and never platform-specific. The empty string `''` denotes the jail root itself. This is normative in specification §3.2.
- `type` is `'folder'` for directories, `'image'` when the lower-cased extension is in the shared image-extension set, and `'file'` otherwise (specification §4.1, FR-2.3).
- `hidden` is computed server-side: `true` when the name starts with `.` on any platform, or when the name matches the Windows hidden-name list (specification §4.3). Filtering happens on the server, so hidden names never reach the browser unless `showHidden=true` was requested.
- `size` and `mtimeMs` are nullable so that a `stat` failure degrades to `null` instead of failing the whole listing (NFR-5). Folders always report `size: null`.

### 4.2 `ImageItem` and `EntryCounts`

`ImageItem` is derived from the `items[]` objects in the `GET /api/fs/images` example response (specification §5.4):

```json
{
  "name": "IMG_0001.jpg",
  "path": "Pictures/2024/IMG_0001.jpg",
  "dir": "Pictures/2024",
  "size": 4812345,
  "mtimeMs": 1712345678901
}
```

Declare it as:

```ts
/**
 * One playable image in a slide-show playlist, as returned by
 * `GET /api/fs/images`. `path` and `dir` are wire paths; `dir` is the wire
 * path of the directory containing the image and is `''` when the image sits
 * directly in the jail root.
 */
export interface ImageItem {
  name: string;
  path: string;
  dir: string;
  size: number | null;
  mtimeMs: number | null;
}
```

> **Decision (not specified).** The specification's example shows `size` and `mtimeMs` as plain numbers and says nothing about a `stat` failure during a recursive scan. They are typed `number | null` here, mirroring `FsEntry`, so that a file which vanishes or cannot be `stat`'d between `readdir` and `stat` can still be played (the player only needs `path`) instead of being dropped from the playlist or crashing the scan. NFR-5 requires exactly that kind of graceful degradation. The scan implementation in a later ticket is therefore permitted to emit `null` for either field. (T013 populates them in a bounded-concurrency `stat` pass *after* traversal, so classification itself never needs a `stat`, honouring the spec §5.4 performance rule. Every other ticket must treat these two fields as `number | null`, never `number`.)

> **Decision (not specified).** `ImageItem` is deliberately **not** declared as a subtype of `FsEntry`. The two are produced by different code paths with different cost profiles — specification §5.4 requires the scan to classify from the `readdir` dirent without `stat`-ing for classification — and `ImageItem` carries `dir`, which `FsEntry` does not, while omitting `type` and `hidden`, which the playlist does not need. Keeping them independent avoids a false inheritance relationship that would later force one to carry the other's fields.

`EntryCounts` is the shape of `ListResponse.counts`:

```ts
export interface EntryCounts {
  folders: number;
  images: number;
  files: number;
}
```

It is exported as a named interface rather than inlined in `ListResponse` so the explorer's image-count chip component can accept it as a prop type. Structurally it is identical to the inline `{ folders: number; images: number; files: number }` shown in specification §5.3.

### 4.3 Response types, one per endpoint

Each interface below mirrors exactly one endpoint in specification §5. Keep the doc comments: they are the only place where an implementer of a route or of the API client learns the semantics of the trickier fields.

```ts
/** `GET /api/health` — specification §5.1. */
export interface HealthResponse {
  status: 'ok';
  /** The server package's version string. */
  version: string;
}

/**
 * `GET /api/fs/root` — specification §5.2. The explorer's starting point.
 */
export interface RootResponse {
  /** Always `''`: the jail root as a wire path. */
  path: string;
  /**
   * Basename of the jail root, e.g. `"PeterKin"`. Display-only (tooltip next to the
   * breadcrumb's "Home" root segment, which carries the fixed label "Home" per spec §7.3).
   */
  name: string;
  /**
   * Absolute path of the jail root, e.g. `"C:\\Users\\PeterKin"`.
   * DISPLAY ONLY (tooltip). It must never be sent
   * back to the server in any request.
   */
  absoluteRoot: string;
  /** `process.platform` of the host, e.g. `"win32"`, `"darwin"`, `"linux"`. */
  platform: string;
}

/**
 * `GET /api/fs/list` — specification §5.3. One directory's contents.
 */
export interface ListResponse {
  /** Wire path of the listed directory; `''` for the jail root. */
  path: string;
  /** Basename of the listed directory. */
  name: string;
  /**
   * Wire path of the parent directory, or `null` when `path` is the jail
   * root. The UI uses `null` to disable the "up one level" control.
   */
  parentPath: string | null;
  /**
   * Entries after hidden-filtering, sorted server-side per specification
   * §4.2 (folders first, then the numeric collator). The client must not
   * re-sort.
   */
  entries: FsEntry[];
  /** Counts of the returned (post-filter) entries. Feeds the explorer's image-count chip. */
  counts: EntryCounts;
  /**
   * `true` when the directory held more than `MAX_ENTRIES` entries. The
   * response then carries the first `MAX_ENTRIES` after sorting and the UI
   * shows a notice.
   */
  truncated: boolean;
}

/**
 * `GET /api/fs/images` — specification §5.4. The player's playlist, and the
 * single source of it: the configuration screen fetches this and hands the
 * result to the player, which performs no second fetch.
 */
export interface ImagesResponse {
  /** Wire path of the scanned directory. */
  path: string;
  /** Echo of the effective `recursive` flag, bound to the `includeSubfolders` config option. */
  recursive: boolean;
  /** `items.length`, repeated for convenience. */
  count: number;
  /** `true` when the scan stopped at `MAX_IMAGES`. */
  truncated: boolean;
  /**
   * Depth-first order: within each directory the specification §4.2
   * collator order applies, and a directory's own images precede its
   * subdirectories' images.
   */
  items: ImageItem[];
}
```

> **Decision (not specified).** `RootResponse.platform` is typed `string`, not a union such as `'win32' | 'darwin' | 'linux'`. `@slydr/shared` must be importable by a browser bundle and therefore cannot depend on `@types/node` for `NodeJS.Platform`, and the value is only ever used for display. A narrow union would also lie about the other values `process.platform` can return (`freebsd`, `aix`, and so on).

> **Decision (not specified).** `count` is kept even though it duplicates `items.length`, because specification §5.4 shows it in the response body and the configuration screen's "N images found" readout reads it directly. The server must guarantee `count === items.length`.

### 4.4 Error envelope and code union (specification §3.5)

Every API error returns the same body:

```json
{ "error": { "code": "OUTSIDE_ROOT", "message": "Path is outside the allowed root." } }
```

Declare the codes as a runtime tuple and derive the union from it, so the API client can validate an unknown payload at runtime and tests can iterate every code without a second hand-maintained list:

```ts
/**
 * Every error code the API can return — specification §3.5. The tuple is the
 * single source of truth; `ApiErrorCode` is derived from it so a code can
 * never be added to one without the other.
 *
 * Intended HTTP statuses (enforced server-side, not encoded here):
 *   INVALID_PATH        400   Malformed, absolute, or oversized path input.
 *   INVALID_PARAM       400   A query parameter failed validation.
 *   OUTSIDE_ROOT        403   Resolved target escapes the jail root.
 *   FORBIDDEN_HOST      403   Host header check failed.
 *   NOT_FOUND           404   Target does not exist.
 *   NOT_A_DIRECTORY     400   A directory was required, a file was given.
 *   NOT_A_FILE          400   A file was required, a directory was given.
 *   ACCESS_DENIED       403   OS denied read (EACCES, EPERM).
 *   UNSUPPORTED_IMAGE   415   Extension is not in the supported image set.
 *   THUMBNAIL_FAILED    500   Decode or resize failed.
 *   READ_FAILED         500   Any other I/O failure.
 *   METHOD_NOT_ALLOWED  405   Non-GET/HEAD request.
 */
export const API_ERROR_CODES = [
  'INVALID_PATH',
  'INVALID_PARAM',
  'OUTSIDE_ROOT',
  'FORBIDDEN_HOST',
  'NOT_FOUND',
  'NOT_A_DIRECTORY',
  'NOT_A_FILE',
  'ACCESS_DENIED',
  'UNSUPPORTED_IMAGE',
  'THUMBNAIL_FAILED',
  'READ_FAILED',
  'METHOD_NOT_ALLOWED',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The body of every API error response — specification §3.5. `message` is a
 * short, human-readable sentence safe to show in the UI. It must never
 * contain a raw OS error message, an `errno`, or an absolute path
 * (specification §3.4); those are logged server-side only.
 */
export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
```

> **Decision (not specified).** The specification states the codes as a table, not as a TypeScript union. Deriving the union from an `as const` tuple rather than writing a bare union literal is deliberate: it costs nothing at runtime beyond a 12-element array, it lets the API client ask `API_ERROR_CODES.includes(code)` when deciding whether a response really is a Slydr error envelope, and it lets the Supertest suite required by specification §12.2 ("each error code in §3.5") assert coverage by iterating the tuple.

### 4.5 Shared limits and thumbnail sizes

```ts
/**
 * Maximum entries returned by `GET /api/fs/list` — specification §5.3. The
 * response carries the first `MAX_ENTRIES` after sorting and sets
 * `truncated: true`. Bounds memory on pathological directories.
 */
export const MAX_ENTRIES = 10000;

/** Maximum recursion depth for `GET /api/fs/images` — specification §5.4. */
export const MAX_DEPTH = 12;

/**
 * Maximum images collected by `GET /api/fs/images` — specification §5.4. On
 * hitting it the scan stops and sets `truncated: true`.
 */
export const MAX_IMAGES = 20000;

/**
 * Allowed `size` values for `GET /api/thumb` — specification §5.6. A fixed
 * allowlist prevents cache-flooding via arbitrary sizes; any other value is
 * rejected with `400 INVALID_PARAM`.
 */
export const THUMBNAIL_SIZES = [128, 256, 384, 512] as const;

export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

/** Default `size` for `GET /api/thumb`, and the size the explorer grid requests. */
export const DEFAULT_THUMBNAIL_SIZE: ThumbnailSize = 256;
```

Keep the literal types: declare `MAX_ENTRIES` and friends with `const` and no explicit type annotation so they infer as the literal types `10000`, `12` and `20000`. `THUMBNAIL_SIZES` must be `as const` so `ThumbnailSize` resolves to `128 | 256 | 384 | 512` and an out-of-allowlist number is a compile error rather than a runtime surprise.

> **Decision (not specified).** The limits live in `types.ts` rather than in a separate `limits.ts` module. The package has four modules by design (specification §2.1: `types.ts`, `images.ts`, `config.ts`, `paths.ts`) and these constants are part of the wire contract — `truncated` is meaningless without `MAX_ENTRIES` and `MAX_IMAGES`, and `size` validation is meaningless without `THUMBNAIL_SIZES` — so they belong beside the response types that reference them.

### 4.6 `shared/src/index.ts` — the barrel

```ts
export * from './types.js';
```

Later tickets append one line each: `export * from './images.js';` (T005), `export * from './config.js';` (T006), `export * from './paths.js';` (T007). Leave the file with a single export now; do not pre-declare exports for modules that do not exist yet, because that breaks `tsc --noEmit`.

> **Decision (not specified).** Relative specifiers carry an explicit `.js` extension. `shared` uses `module`/`moduleResolution: "NodeNext"` (fixed in T001 §4.4), which requires the emitted-JavaScript extension on relative imports. Use it in all four shared modules.

### 4.7 Package wiring

T001 already wired `shared/package.json` (`exports["."]` pointing at `./dist/index.js` and `./dist/index.d.ts`, `build` = `tsc -p tsconfig.build.json`). Change nothing; just verify that `import { type FsEntry } from '@slydr/shared'` resolves from `server/` and `client/` after `npm run build -w @slydr/shared`. Do **not** add a `dependencies` section. See section 8.

## 5. Acceptance criteria

- [ ] `shared/src/types.ts` exists and exports `EntryType`, `FsEntry`, `ImageItem`, `EntryCounts`, `HealthResponse`, `RootResponse`, `ListResponse`, `ImagesResponse`, `API_ERROR_CODES`, `ApiErrorCode`, `ApiErrorEnvelope`, `MAX_ENTRIES`, `MAX_DEPTH`, `MAX_IMAGES`, `THUMBNAIL_SIZES`, `ThumbnailSize` and `DEFAULT_THUMBNAIL_SIZE` — and nothing else.
- [ ] The `FsEntry` declaration is character-identical to the one in specification §4.1, comments included.
- [ ] `ListResponse.parentPath` has type `string | null`; `FsEntry.size`, `FsEntry.mtimeMs`, `ImageItem.size` and `ImageItem.mtimeMs` all have type `number | null`.
- [ ] `API_ERROR_CODES` has exactly 12 members and contains every code from the specification §3.5 table, spelled identically.
- [ ] `MAX_ENTRIES === 10000`, `MAX_DEPTH === 12`, `MAX_IMAGES === 20000`, `THUMBNAIL_SIZES` deep-equals `[128, 256, 384, 512]`, and `DEFAULT_THUMBNAIL_SIZE === 256`.
- [ ] `ThumbnailSize` resolves to `128 | 256 | 384 | 512`: assigning `300` to a `ThumbnailSize` variable is a compile error.
- [ ] `shared/src/index.ts` re-exports `./types.js`, and the package's public API is reachable as `import { type FsEntry, MAX_ENTRIES } from '@slydr/shared'`.
- [ ] `shared/package.json` has no `dependencies` and no `peerDependencies`.
- [ ] `shared/src/types.ts` contains no `import` statement of any kind — no `node:*`, no DOM-library usage, no third-party package.
- [ ] `npx tsc --noEmit -p shared/tsconfig.json` reports no errors.
- [ ] `npm test` runs `shared/test/types.test.ts` (the Vitest `shared` project lists it) and it passes.

## 6. Tests to write

Specification §12.1 asks for unit coverage of the shared package. This module has no behaviour, so its test file has two jobs: pin the runtime constants, and act as a compile-time fixture that fails `npm run typecheck` if a response shape drifts. Both live in one file.

**`shared/test/types.test.ts`** (import the subject from `'../src/index.js'`)

- `describe('limit constants')`
  - `it('fixes MAX_ENTRIES at 10000, the /api/fs/list truncation threshold')`
  - `it('fixes MAX_DEPTH at 12, the recursive scan depth cap')`
  - `it('fixes MAX_IMAGES at 20000, the recursive scan image cap')`
- `describe('thumbnail sizes')`
  - `it('allows exactly 128, 256, 384 and 512, in ascending order')`
  - `it('defaults to 256')`
  - `it('includes DEFAULT_THUMBNAIL_SIZE in THUMBNAIL_SIZES')`
- `describe('API_ERROR_CODES')`
  - `it('contains all twelve codes from the specification error table')` — assert against a literal array written out in the test, so a typo in `types.ts` cannot be mirrored by the same typo in the assertion.
  - `it('has no duplicate codes')`
  - `it('includes FORBIDDEN_HOST and METHOD_NOT_ALLOWED, the two transport-guard codes')`
- `describe('contract shapes (compile-time)')` — each case constructs an explicitly annotated literal and makes one trivial runtime assertion, so it is both type-checked and executed:
  - `it('accepts a fully populated FsEntry for an image')`
  - `it('accepts an FsEntry for a folder with null size and mtimeMs')`
  - `it('accepts a ListResponse at the jail root with parentPath null')`
  - `it('accepts a ListResponse in a subfolder with a parentPath string')`
  - `it('accepts a truncated ListResponse')`
  - `it('accepts a recursive ImagesResponse whose items carry dir wire paths')`
  - `it('accepts an ImageItem whose size and mtimeMs are null')`
  - `it('accepts a RootResponse with a Windows absoluteRoot and platform win32')`
  - `it('accepts a HealthResponse whose status is the literal "ok"')`
  - `it('accepts an ApiErrorEnvelope for every code in API_ERROR_CODES')` — build one envelope per code by iterating the tuple, proving the union and the tuple agree.

A note for the implementer: Vitest's `expectTypeOf` is only evaluated under `vitest --typecheck`, which this repository does not necessarily run. The explicitly annotated literals above are the mechanism that makes type drift fail the build, via the ordinary `npm run typecheck` pass over the workspace. Do not rely on `expectTypeOf` alone.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] `shared/src/types.ts` and `shared/src/index.ts` exist, with `index.ts` exporting only `./types.js`.
- [ ] `@slydr/shared` still declares zero runtime dependencies.
- [ ] A scratch `import type { ListResponse } from '@slydr/shared'` compiles from inside both `server/` and `client/`; the scratch file is deleted afterwards.
- [ ] README updated if setup or user-visible behaviour changed (not expected for this ticket).

## 8. Notes and gotchas

- **No runtime dependencies, ever (specification §2.1).** `@slydr/shared` is described in the architecture as "types + constants, no runtime deps". This is not a stylistic preference: the package is imported by a Node server *and* bundled into a browser application that must stay under 300 KB gzipped (NFR-8) and must work fully offline (NFR-9). Adding Zod, `mime-types`, or anything else here ships it to the browser. Validation of untrusted input is performed by hand-written, dependency-free functions in T005–T007 and by the server's own parameter checks.
- **Browser-safe means no Node types.** Do not reference `NodeJS.*`, `Buffer`, `process`, `URL` from `node:url`, or `import('node:fs').Stats` anywhere in `types.ts`. `shared/tsconfig.json` sets `"types": []` on purpose (T001), so any Node-typed reference fails the typecheck. The quickest self-check is the acceptance criterion above: `types.ts` has no `import` statements at all.
- **`absoluteRoot` is a one-way string.** It is the single absolute path the client is ever allowed to see (specification §3.2) and it exists for a tooltip. Any future code that feeds it back into a request is a security defect; the doc comment on the field is what keeps that from happening.
- **`truncated` versus `count`.** `ListResponse` has `truncated` but no `total`, and `ImagesResponse.count` means "items returned", not "items that exist". The specification deliberately avoids promising a true total, because computing one would defeat the purpose of the cap. Do not add a `total` field.
- **Keep the union and the tuple in lockstep.** Because `ApiErrorCode` is derived from `API_ERROR_CODES`, the only way to add a code is to add it to the tuple. If a future ticket needs a new code, it must also add a row to the specification §3.5 table; the code list and the table are a pair.
- **Related assumption (specification §16.1, A2).** There is no routing or deep-linking in the client, so no URL-serialisation type is needed for a wire path. If A2 is ever revisited, those helpers belong in T007's `paths.ts`, not here.
