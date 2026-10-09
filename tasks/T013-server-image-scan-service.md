# T013 — Implement the flat and recursive image scan service

**Epic:** E6 (Image scan API)
**Spec sections:** §5.4, §4.2, §4.3, §12.1, NFR-5
**Depends on:** T010, T011
**Estimated size:** M

---

## 1. Context

Slydr plays slide shows from a folder the user picks in the file explorer. Before the
player can start, the server has to produce the complete, ordered list of playable
images for that folder — either just the images sitting directly inside it, or every
image in the whole subtree when the user enables the "Include subfolders" option.
This ticket builds the service that performs that collection: `server/src/services/scan.ts`.
It is pure domain logic with no knowledge of Express; the HTTP endpoint that wraps it
(`GET /api/fs/images`) is a separate ticket (T014). Getting the ordering, the limits and
the failure behaviour right here matters because the resulting array *is* the player's
playlist — there is no second request and no client-side re-sorting.

## 2. Scope

### In scope

- Create `server/src/services/scan.ts` exporting a single async scan function plus its
  options and result types.
- Flat (single-directory) collection and recursive (depth-first) collection of images.
- The exact ordering rule from specification §5.4 (depth-first; collator order within a
  directory; a directory's own images before any of its subdirectories' images).
- The recursion limits `MAX_DEPTH = 12` and `MAX_IMAGES = 20000`, including the
  `truncated` flag when the image cap is reached.
- A visited-realpath `Set` that prevents infinite recursion through symlink and junction
  loops.
- Hidden-entry filtering driven by a `showHidden` flag, reusing `isHiddenName` from the
  listing service (T011) rather than reimplementing it; ordering via `compareNames` from the
  same module; the bounded `stat` pass via `mapPool`/`STAT_CONCURRENCY` from
  `services/concurrency.ts` (T011).
- Omitting entries whose wire path `resolveSafe` would reject (`isWirePathAcceptable`), as the
  listing service does, so every returned `item.path` can be fetched.
- Silent skipping of unreadable subdirectories (NFR-5), with the error surfaced only as
  a log line through the injected `Logger`.
- Populating `size` and `mtimeMs` on each returned item via a bounded-concurrency `stat`
  pass that runs *after* traversal (see the labelled Decision in §4.7).
- Unit tests per specification §12.1, in `server/test/services/scan.test.ts`.

### Out of scope

- The `GET /api/fs/images` route, its query-parameter validation and its Supertest suite
  — **T014** owns those.
- `GET /api/fs/list`, entry classification into `FsEntry`, folders-first ordering and the
  `MAX_ENTRIES = 10000` truncation — **T011** owns the listing service. This ticket
  *consumes* its hidden predicate but does not change its behaviour.
- `resolveSafe` and the jail-containment algorithm — **T010** owns
  `server/src/security/jail.ts`.
- Thumbnails, the `sharp` pipeline and the thumbnail cache — T016, T017, T018.
- Any client-side work; the configuration screen's image count is epic E14.

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** with three packages — `shared/`,
`server/` and `client/`. Everything is **ESM** (`"type": "module"` in every
`package.json`), TypeScript is in **strict** mode, the engine requirement is
**Node >= 22**, the server runs **Express 5**, and **Vitest + Supertest** are already
configured and runnable via `npm test`. Because the project is ESM, relative imports
inside `server/src` carry explicit file extensions as configured for the workspace;
follow whatever convention the existing files in `server/src` already use rather than
introducing a second one.

### `@slydr/shared` (already implemented)

The shared package exports, among other things:

```ts
export type EntryType = 'folder' | 'image' | 'file';

export interface FsEntry {
  name: string;         // basename as it appears on disk
  path: string;         // wire path, relative to the jail root, POSIX separators
  type: EntryType;
  hidden: boolean;
  size: number | null;  // bytes; null for folders and on stat failure
  mtimeMs: number | null;
}

export interface ImageItem {
  name: string;         // basename, e.g. "IMG_0001.jpg"
  path: string;         // wire path of the image, e.g. "Pictures/2024/IMG_0001.jpg"
  dir: string;          // wire path of the containing directory, e.g. "Pictures/2024"
  size: number | null;
  mtimeMs: number | null;
}

export const MAX_DEPTH = 12;
export const MAX_IMAGES = 20000;

export const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg',
]);

export function isImageExtension(name: string): boolean;
```

It also exports the endpoint response types (including the response type for
`GET /api/fs/images`), the `ApiErrorCode` union from specification §3.5, and pure POSIX
wire-path helpers — join/parent/segment utilities that operate on forward-slash relative
paths and never touch the file system.

`isImageExtension(name)` lower-cases the extension of the given basename and tests it
against `IMAGE_EXTENSIONS`. Use it; never inline an extension check.

`ImageItem.size` and `ImageItem.mtimeMs` are already `number | null` (T004): a file that
vanishes between traversal and the `stat` pass must still appear in the playlist with both
fields `null` rather than disappear or fail the whole scan. No shared type changes in this
ticket.

### Server core (already implemented — T008, T009)

`createApp(config, logger?)` builds the Express application (never calls `listen`) with the
`405` method guard, the `403 FORBIDDEN_HOST` check and the error envelope. `ApiError` is
`new ApiError(code, message?, cause?)` (status derived from the code). The `Logger`
interface (`server/src/logger.ts`) is `debug|info|warn|error(event: string, fields?:
Record<string, unknown>)`; quiet mode is handled inside the logger, so this service never
reads `SLYDR_QUIET`. This ticket reads no configuration at all and no test sets `SLYDR_ROOT`:
the jail root is set in tests with `setJailRoot` (T010).

### Test helpers (already implemented — T011, T012)

`server/test/helpers/fs.ts` (`makeTempBase`, `trySymlink`, `removeTree`) and
`server/test/helpers/logger.ts` (`createTestLogger`).

### `server/src/security/jail.ts` (already implemented)

```ts
export function setJailRoot(absolute: string): void;
export function getJailRoot(): string;
export function resetJailRootForTests(): void;
export function resolveSafe(relPath: string): Promise<string>;
export function toWirePath(absPath: string): string;
export function isWirePathAcceptable(relPath: string): boolean;   // pure steps 1-4
export function isContained(real: string, root: string): boolean; // pure step 7
export function mapFsError(err: unknown): ApiError;
```

`resolveSafe` implements specification §3.3 fully: it rejects NUL bytes and inputs
longer than 4096 characters (`400 INVALID_PATH`), rejects a leading `/` and Windows
absolute/UNC shapes (`400 INVALID_PATH`; any backslash too, on Windows only), rejects any
`..` segment (`403 OUTSIDE_ROOT`), joins the surviving segments onto the jail root,
`fs.realpath.native`s the result (`404 NOT_FOUND` on `ENOENT`/`ENOTDIR`, `403 ACCESS_DENIED`
on `EACCES`/`EPERM`), and verifies that the real path is contained in the real jail root
(`403 OUTSIDE_ROOT` otherwise). It throws `ApiError` on every failure and follows
symlinks and junctions. The module also owns the cached, `realpath`-resolved jail root.
`isWirePathAcceptable` is the pure, synchronous half (steps 1-4) and `mapFsError` is the
shared `EACCES`/`EPERM`/`ENOENT` mapping.

Two consequences this ticket depends on:

1. Any absolute path handed to this service by the route has already been `realpath`'d
   and proven to live inside the jail.
2. **Every** file-system access must go through `resolveSafe`, and string concatenation
   of user input into a path is a defect. Inside the traversal, child paths are built from
   the *already verified* parent absolute path using `node:path` joins — never from the
   raw query string — and any entry that is a symlink is re-verified through `resolveSafe`
   before it is followed or emitted (§4.6).

### `server/src/services/listing.ts` (already implemented — T011)

Implements the directory listing used by `GET /api/fs/list`. This ticket consumes three
exports, unchanged:

```ts
export function isHiddenName(name: string, platform?: NodeJS.Platform): boolean; // §4.3
export function compareNames(a: string, b: string): number; // §4.2 collator + code-unit tie-break
```

and, from `server/src/services/concurrency.ts` (also T011):

```ts
export const STAT_CONCURRENCY = 64;
export function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
```

## 4. Implementation detail

### 4.1 File to create

`server/src/services/scan.ts`

### 4.2 Public surface

Export exactly these symbols:

```ts
import type { ImageItem } from '@slydr/shared';
import type { Logger } from '../logger.js';

export interface ScanOptions {
  /** Absolute path of the directory to scan. MUST already have come from resolveSafe. */
  absPath: string;
  /**
   * Wire path of that same directory ("" for the jail root): the request path lexically
   * normalised by the route (normalizeWirePath), NOT derived from the real path. Every
   * item path is built from it, so a symlinked folder keeps the name the user navigated.
   */
  wirePath: string;
  /** Descend into subdirectories depth-first when true. */
  recursive: boolean;
  /** Include hidden images, and descend into hidden directories, when true. */
  showHidden: boolean;
  /** Optional T009 Logger (events `scan.done`, `scan.dir-skipped`). Defaults to a no-op. */
  logger?: Logger;
}

export interface ScanResult {
  items: ImageItem[];
  /** True when the scan stopped because MAX_IMAGES was reached. */
  truncated: boolean;
}

export async function scanImages(options: ScanOptions): Promise<ScanResult>;
```

`scanImages` takes both the absolute path and the wire path because it must build each
item's `path` and `dir` in wire form without re-deriving them from the file system for
every entry. Derive child wire paths with `wireJoin(dirWire, name)` from `@slydr/shared`
(which yields `"IMG_1.jpg"`, never `"/IMG_1.jpg"`, for the root) and child absolute paths
with `path.join(parentAbs, name)`. **Do not use `toWirePath` to build item paths**: for a
symlinked folder it would yield the target's location, whereas spec §5.4 requires the path as
navigated. Import `fs` as `import fs from 'node:fs/promises'` and call `fs.readdir(...)`,
`fs.stat(...)` (the tests spy on them).

### 4.3 Reuse the §4.3 hidden predicate — do not duplicate it

The hidden rules are implemented once, in `server/src/services/listing.ts` (T011), as the
exported `isHiddenName(name: string, platform?: NodeJS.Platform): boolean`. **Import it into
`scan.ts` and use it unchanged.** Reviewers will reject a second copy of the Windows
hidden-name list, and `scan.ts` must not contain `AppData`, `Thumbs.db` or any other entry of
that list.

When `showHidden` is `false`, a hidden **image** is omitted from the results and a hidden
**directory** is not descended into. When `showHidden` is `true`, neither is filtered.
This mirrors specification §4.3 ("Hidden folders are also skipped during recursive image
scans unless `showHidden=true`") and assumption A6 in §16.1, which says the explorer's
`showHidden` setting also governs which images are playable.

### 4.4 The ordering rule (specification §5.4)

The specification states it as:

> Order: the recursive scan is depth-first; within each directory the FR-3 collator order
> applies, and a directory's own images come before its subdirectories' images. This gives
> a deterministic, human-sensible order when shuffle is off.

Use `compareNames(a, b)` exported by `listing.ts` (T011) for every name comparison. It is
the single FR-3 comparator (module-scope `Intl.Collator(undefined, { numeric: true,
sensitivity: 'base' })` plus a code-unit tie-break for collator ties such as `a.PNG` /
`A.png`), so the playlist order is identical to the explorer's order on every platform
(NFR-1). `scan.ts` creates **no** `Intl.Collator` of its own. It is what makes `IMG_2.jpg`
sort before `IMG_10.jpg`. The client must not re-sort, so this order is the contract.

Per directory:

1. Read the directory's entries once.
2. Partition them into two lists: `images` (playable files) and `subdirs` (directories).
   Everything else is dropped.
3. Sort `images` by `name` with `compareNames`.
4. Sort `subdirs` by `name` with `compareNames`.
5. Append every entry in `images` to the result array, in order.
6. Only then, and only when `recursive` is true, recurse into each entry of `subdirs` in
   order, applying this same procedure.

Step 5 before step 6 is the "own images before subdirectories' images" rule.

### 4.5 Traversal algorithm

Implement an explicit depth-first walk. Recursion depth is bounded by `MAX_DEPTH = 12`,
so ordinary function recursion is safe; an explicit stack is equally acceptable as long as
the emission order above is preserved.

```
scanImages({ absPath, wirePath, recursive, showHidden }):
  1. items = []
  2. truncated = false
  3. visited = new Set<string>()      // realpath'd absolute directory paths
  4. visited.add(absPath)             // absPath is already realpath'd by resolveSafe
  5. await walk(absPath, wirePath, depth = 0)
  6. await statPass(items)            // §4.7
  7. return { items, truncated }
```

`walk(dirAbs, dirWire, depth)`:

1. Call `fs.readdir(dirAbs, { withFileTypes: true })`.
   - If this throws **and `depth === 0`**, `throw mapFsError(err)` (T010): `EACCES`/`EPERM`
     surface as `403 ACCESS_DENIED`, `ENOENT`/`ENOTDIR` as `404 NOT_FOUND`, anything else as
     `500 READ_FAILED`. Do not write a second mapping here.
   - If this throws and `depth > 0`, **swallow the error, count it as skipped, log
     `scan.dir-skipped` at debug (no more than one line per directory), and return**. An
     unreadable subdirectory must never fail the whole scan (specification §5.4, NFR-5).
2. Create `const images: Array<{ name: string; abs: string }> = []` and
   `const subdirs: Array<{ name: string; abs: string }> = []`.
3. For each `dirent`:
   1. `const name = dirent.name`.
   2. If `!showHidden && isHiddenName(name)` → `continue`. This single check covers both
      hidden images and hidden folders.
   3. `const childAbs = path.join(dirAbs, name)` and
      `const childWire = wireJoin(dirWire, name)`. **If
      `!isWirePathAcceptable(childWire)` → `continue`** (log `scan.entry-skipped` at debug):
      such a name (for example a top-level POSIX file called `C:backup.jpg`) would make
      `/api/image` and `/api/thumb` answer `400 INVALID_PATH` for a playlist item, exactly
      the case T011 already omits from listings. This is a pure string check, no syscall.
   4. Classify:
      - `dirent.isDirectory()` → push to `subdirs`, and only bother when `recursive` is
        true; a flat scan has no use for them.
      - `dirent.isFile()` → push to `images` when `isImageExtension(name)` is true,
        otherwise `continue`.
      - `dirent.isSymbolicLink()` → resolve it per §4.6 and classify by the **target's
        kind**; for a file, image-ness comes from the **link's own name** (FR-2.1).
      - anything else (socket, FIFO, block or character device, unknown) → `continue`,
        per FR-2.2.
4. Sort and emit per §4.4. While appending images:
   - Check `if (items.length >= MAX_IMAGES) { truncated = true; stop = true; return; }`
     **before** each push, and propagate the stop so that no further directory is read.
     The cleanest shape is a mutable context object (or a module-local flag) that `walk`
     consults at the top of its loop and immediately after each recursive call.
   - Push `{ name, path: childWire, dir: dirWire, size: null, mtimeMs: null }`; the
     `stat` pass in §4.7 fills `size` and `mtimeMs` in place.
5. If `recursive && depth < MAX_DEPTH`, then for each subdir in order:
   1. Obtain its real path (§4.6).
   2. `if (visited.has(realAbs)) continue;` then `visited.add(realAbs)`.
   3. `await walk(realAbs, childWire, depth + 1)`.
   4. If the stop flag is set, `return`.

### 4.6 Symlinks, junctions and the visited set

Per spec FR-2.1 symlinks are classified by the kind of their resolved target, **a symlink to
a folder is followed for as long as its real target stays inside the jail root (the user's
home folder structure)**, and a symlink whose target lies outside the jail root, is broken,
or cannot be stat'd is **omitted entirely**. The audited implementation of exactly that
check already exists: `resolveSafe`. Therefore:

- For a `dirent` where `dirent.isSymbolicLink()` is true, call
  `await resolveSafe(childWirePath)` inside a `try/catch`. On **any** throw, skip the entry
  silently (optionally logging at debug level). On success you hold a verified, contained,
  `realpath`'d absolute path; `await fs.stat(realAbs)` once to learn whether it is a
  directory or a regular file, then treat it as that kind of entry. Classify the
  *image-ness* of a symlinked file from the **link's own name**
  (`isImageExtension(name)`), because that is the name the user sees and the name the
  player will request.
- For every directory you are about to descend into — symlink or not — the path you add to
  `visited` and the path you recurse with must be the **real** path. A plain subdirectory
  under an already-`realpath`'d parent is itself real, so it needs no extra `realpath`
  call; only symlinked directories require the resolution above. Windows **directory
  junctions** report `isSymbolicLink() === true` from `readdir`, so they travel the same
  code path and need no special-casing.
- The `visited` set is seeded with the scan's own starting directory (step 4 of
  `scanImages`), so a link pointing back at the root is caught immediately. It is keyed by
  the exact string `fs.realpath` returned, which is already normalised for case and
  separators by the platform — do not add your own lower-casing. Consequence (accepted): a
  real directory reachable twice (once directly, once through a link) is scanned once, at
  the first position in the §4.4 order, so no image appears twice in the playlist.

The wire path emitted for a symlinked entry is the path **as the user navigated it**
(parent wire path plus link name), not the target's wire path. That keeps the playlist
consistent with what the explorer showed, and `resolveSafe` resolves it again identically
when `/api/image` or `/api/thumb` is later called with it.

### 4.7 Performance rule, and the `size`/`mtimeMs` decision

Specification §5.4 states the performance rule verbatim:

> **Performance:** the scan must stream `readdir` with `withFileTypes` and must not `stat`
> entries it can classify from the dirent.

So: read every directory with `fs.readdir(dirAbs, { withFileTypes: true })` and use
`dirent.isDirectory()`, `dirent.isFile()` and `dirent.isSymbolicLink()` for
classification. **No `stat` call may be made for the purpose of classifying an entry whose
`Dirent` already answers the question.** The only `stat`s permitted during traversal are
the ones for symlinked entries in §4.6, where the dirent genuinely cannot classify the
target.

`fs.promises.opendir()` is available and gives a true async-iterable stream, but it does
not help here: the ordering rule requires a directory's full entry list before anything
can be emitted, so a per-directory `readdir` is both simpler and equivalent in peak
memory. Using `readdir` is intended, not a shortcut.

**Decision (not specified): `size` and `mtimeMs` are gathered by a bounded-concurrency
`stat` pass that runs after traversal completes.** The specification shows both fields
populated with real numbers in the §5.4 response example but also forbids stat-ing during
classification, and it never says how the two reconcile. The resolution:

- Traversal emits items with `size: null, mtimeMs: null`.
- After traversal, a single pass `stat`s each collected item through
  `mapPool(items, STAT_CONCURRENCY, ...)` (T011's `services/concurrency.ts`, limit 64). Do
  not hand-roll a pool and do not declare a second concurrency constant; the per-item
  `fn` catches its own errors (see below) so `mapPool` never rejects.
- On success set `size = stats.size` and `mtimeMs = stats.mtimeMs`.
- On **any** failure — `ENOENT` because the file vanished mid-scan, `EACCES`, anything
  else — leave both fields `null`, log nothing louder than debug, and keep the item in the
  playlist. NFR-5: "the app never crashes on unreadable, corrupt, or vanished files; every
  such case degrades to a skip plus a log line." The item stays because the player can
  still try to load it, and `/api/image` will return a clean `404` if it really is gone.

This honours the §5.4 performance rule as written — no `stat` is used to classify — keeps
the response shape truthful, and bounds the cost: at most `MAX_IMAGES` = 20000 `stat`s,
`STAT_CONCURRENCY` at a time, on a code path the user already sees as "Scanning…" on the
configuration screen. It must stay consistent with the response type (`number | null`, T004).
Do not emit the fields as absent, and do not substitute `0`. Measure the scan on a very
large folder when tuning (spec §16.2 item 3).

### 4.8 Limits, verbatim

```ts
import { MAX_DEPTH, MAX_IMAGES } from '@slydr/shared';   // 12 and 20000
```

- **`MAX_DEPTH = 12`.** The starting directory is depth `0`. Recurse only while
  `depth < MAX_DEPTH`, so images are collected from the starting directory and from at
  most twelve levels of directories beneath it; directories at depth 13 and deeper are
  never read. **Decision (not specified):** the specification states the constant but not
  whether the start directory counts as a level. Counting it as depth `0` is the
  interpretation to implement, and a test must assert the boundary so it cannot drift.
- **`MAX_IMAGES = 20000`.** Checked *before* each push. On reaching the cap the scan
  **stops immediately** — no further directory is read and no further entry is examined —
  and `truncated` is set to `true`. `items.length` is then exactly `20000`. The
  configuration screen renders "Showing the first 20000 images." from this flag
  (specification §8.3).
- `truncated` is `false` in every other case, including a flat scan that returns zero
  images.

A flat scan (`recursive: false`) ignores `MAX_DEPTH` entirely — it reads one directory —
but is still subject to `MAX_IMAGES`.

### 4.9 Logging

Log through the injected `options.logger` (T009 `Logger`; quiet mode and the stdout/stderr
split are the logger's business, NFR-10). Skipped subdirectories and failed `stat`s are
normal operating conditions rather than errors: emit at most one `debug` line
(`scan.dir-skipped`) per skipped directory, and one aggregate `debug` line at the end of
the scan — `logger?.debug('scan.done', { dirs: 412, images: 1284, skipped: 2, truncated:
false, ms: 318 })` — rather than one line per failed `stat`, which could be twenty
thousand lines. Logs may contain absolute paths (local operator context); API responses
may not (§3.4).

### 4.10 Cross-platform notes

- **Windows:** directory junctions and symlinks both surface as
  `dirent.isSymbolicLink() === true`. Creating symlinks usually needs Developer Mode or
  elevation, whereas `fs.symlink(target, link, 'junction')` works unprivileged for
  directories. The tests must account for this (§6).
- **macOS:** the file system is typically case-insensitive but case-preserving, so
  `fs.realpath` returns the on-disk casing. The `visited` set therefore works as written.
- **Linux:** nothing special, but it is the easiest platform on which to reproduce
  `EACCES` on a subdirectory (`chmod 000`), which is why the unreadable-subdirectory test
  is POSIX-only.
- Never build a path by concatenating strings with `/` or `\`. Absolute paths go through
  `node:path`; wire paths go through the shared POSIX helpers.

## 5. Acceptance criteria

- [ ] `server/src/services/scan.ts` exists and exports `scanImages`, `ScanOptions` (including
      the optional `logger?: Logger`) and `ScanResult` with exactly the signatures in §4.2.
- [ ] A flat scan of a directory containing images, non-image files and subdirectories
      returns only the images in that directory, in collator order.
- [ ] A recursive scan returns a directory's own images before any image from any of its
      subdirectories, and visits subdirectories in collator order.
- [ ] `IMG_2.jpg` precedes `IMG_10.jpg` in the returned order (numeric collation).
- [ ] `scan.ts` contains no `Intl.Collator` and no copy of the §4.3 hidden-name list: it
      imports `compareNames` and `isHiddenName` from `listing.ts` (T011), which is the only
      module in the server package that constructs the collator or holds the list.
- [ ] `scan.ts` does not declare its own stat-concurrency constant; the `stat` pass uses
      `mapPool` and `STAT_CONCURRENCY` from `services/concurrency.ts`.
- [ ] With `showHidden: false`, dot-prefixed images are omitted and dot-prefixed
      directories are not descended into; with `showHidden: true`, both are included.
- [ ] A tree fifteen levels deep yields images from the start directory and twelve levels
      below it, and none from deeper.
- [ ] A tree containing more than 20000 images returns exactly 20000 items with
      `truncated: true`.
- [ ] A directory symlink pointing at one of its own ancestors does not cause infinite
      recursion, and the scan terminates.
- [ ] A symlink to a folder whose real target is inside the jail is followed, and the items
      under it carry the *navigated* path (`link/<name>`), not the target's path; a symlink
      whose target is outside the jail is omitted.
- [ ] A symlink to a file is an image iff the **link's own name** has an image extension,
      whatever the target is called.
- [ ] An entry whose wire path fails `isWirePathAcceptable` (for example a top-level
      `C:backup.jpg` on POSIX) is not returned.
- [ ] A subdirectory that cannot be read is skipped, the scan completes, and the images
      from its siblings are present.
- [ ] A read failure on the **starting** directory throws `mapFsError(err)`: an `ApiError`
      with `ACCESS_DENIED` for `EACCES`/`EPERM`, `NOT_FOUND` for `ENOENT`/`ENOTDIR`,
      `READ_FAILED` otherwise.
- [ ] Every returned item has a POSIX wire `path` with no leading slash and no backslash,
      and a `dir` equal to the wire path of its containing directory.
- [ ] `size` and `mtimeMs` are populated numbers for readable files and `null` for a file
      that cannot be stat'd, and the item is still present in that case.
- [ ] No `stat`/`lstat` call is made for any entry that the `Dirent` already classifies —
      verifiable by reading the code and by the spy test in §6.
- [ ] A search of `scan.ts` finds no string concatenation of a user-supplied name into a
      path; all joins use `node:path` or the shared wire-path helpers.
- [ ] The scan logs through the injected `Logger` only (`scan.done`, `scan.dir-skipped`,
      `scan.entry-skipped`, all at debug) and never touches `process.env`.

## 6. Tests to write

All in `server/test/services/scan.test.ts` (Vitest), per specification §12.1: "flat vs
recursive, depth cap, image cap, symlink-loop protection, skipping unreadable
subdirectories."

Build fixtures with the shared helpers (T011): `makeTempBase('slydr-scan-')` (already
realpath'd) for a fresh directory per suite, `trySymlink` for links, `removeTree` in
`afterAll`/`afterEach`, and `createTestLogger()` for the `logger` option. Generate image
files as tiny byte buffers — content never matters to this service, only the extension — and
never commit binaries (specification §12.4). `scanImages` receives an already-resolved
absolute path, so most tests call it directly with `absPath = root` and `wirePath = ''`.
The tests that exercise `resolveSafe`'s containment behaviour (the symlink cases) call
`setJailRoot(root)` before and `resetJailRootForTests()` after (in `beforeEach`/`afterEach`
or `beforeAll`/`afterAll`); **no test sets `SLYDR_ROOT` or uses `vi.resetModules()`**. Spy with
`vi.spyOn(fs, 'readdir')` / `vi.spyOn(fs, 'stat')` where `fs` is the default import of
`node:fs/promises`, which is the style the service uses.

1. **`flat scan returns only this directory's images in collator order`** — fixture with
   `IMG_10.jpg`, `IMG_2.jpg`, `a.PNG`, `notes.txt`, `sub/inner.jpg`. Asserts the result is
   exactly `['a.PNG', 'IMG_2.jpg', 'IMG_10.jpg']` by name (the collator is
   case-insensitive, so `a.PNG` sorts before `IMG_*`; derive the expectation with
   `compareNames` rather than hard-coding if the host locale could differ),
   `truncated === false`, and that `inner.jpg` is absent.
2. **`recursive scan emits a directory's own images before its subdirectories'`** —
   fixture `root/{b.jpg, a.jpg, sub1/{s1.jpg}, sub2/{s2.jpg}}`. Asserts the exact ordered
   wire-path list `['a.jpg','b.jpg','sub1/s1.jpg','sub2/s2.jpg']`.
3. **`recursive scan is depth-first, not breadth-first`** — fixture with
   `sub1/{s1.jpg, deep/{d1.jpg}}` and `sub2/{s2.jpg}`. Asserts `sub1/deep/d1.jpg` precedes
   `sub2/s2.jpg`.
4. **`non-image files and special entries are omitted`** — asserts `notes.txt`,
   `clip.mov` and a `.heic` file never appear (FR-2.4: HEIC classifies as `file`).
5. **`hidden images and hidden folders are skipped unless showHidden`** — fixture with
   `.secret.jpg` and `.hidden/h.jpg`; two assertions, one per flag value.
6. **`ordering and hidden rules are shared with the listing service`** — asserts that
   `scan.ts`'s source text (read with `fs.readFile`) contains no `Intl.Collator`, no
   `Thumbs.db`/`AppData`, and imports `compareNames` and `isHiddenName` from
   `./listing.js`; plus a behavioural check that a directory with `a.jpg` and `A.jpg`
   yields the same relative order as `compareNames`. This is the guard against the rules
   being duplicated or diverging.
7. **`depth cap stops at MAX_DEPTH levels below the start`** — programmatically create
   `l1/l2/.../l15`, each holding `img.jpg`. Asserts items from `l1` through `l12` are
   present, that `l13`, `l14` and `l15` are absent, and that the start directory's own
   image is present.
8. **`image cap truncates at MAX_IMAGES and stops the scan`** — to keep the test fast,
   stub the constant rather than creating twenty thousand files: `vi.mock('@slydr/shared')`
   re-exporting the real module with `MAX_IMAGES: 5`, build a tree with ten images across
   two directories, and assert `items.length === 5` and `truncated === true`. Add a second
   assertion with a spy on `fs.readdir` proving the second directory was never read once the
   cap was hit. If mocking the shared constant proves awkward under ESM, inject the caps as
   optional `ScanOptions` fields defaulted from `@slydr/shared` and label that in the code as
   a **Decision (not specified)** — but the defaults must remain 12 and 20000.
9. **`symlink loop does not recurse forever`** — create `root/sub/` and a link
   `root/sub/back` pointing at `root` (`trySymlink(root, ..., 'junction')` on win32,
   `'dir'` elsewhere); skip the test if `trySymlink` returns `false`. `setJailRoot(root)`.
   Asserts the scan resolves, that each image appears exactly once, and that the call
   completes within Vitest's default timeout.
10. **`symlink pointing outside the jail root is omitted`** — fixture root inside the temp
    directory plus a sibling directory outside it containing `out.jpg`, linked in as
    `root/escape`. With `setJailRoot(root)`, asserts `out.jpg` never appears and the scan
    does not throw. (NFR-7 symlink-escape contribution.)
11. **`folder symlink inside the jail is followed with the navigated path`** — fixture
    `root/{real/{r1.jpg}, link -> real}` (junction on win32). `setJailRoot(root)`; scan
    recursively with `wirePath = ''`. Asserts `real/r1.jpg` appears once (the directory is
    visited once; the `visited` set dedupes the second route) at the first position in
    collator order (`link` sorts before `real`, so the item path is `link/r1.jpg`), and that no
    item `path` contains the temp-directory path. Add a flat-scan case with
    `absPath = <root>/real`, `wirePath = 'link'` asserting `path === 'link/r1.jpg'` and
    `dir === 'link'` (the route passes the lexically normalised request path).
12. **`image-ness of a symlinked file comes from the link's name`** — `root/{pic.dat,
    notes.txt, shot.jpg -> notes.txt, photo -> pic.dat}`. Asserts `shot.jpg` is in the
    playlist (link name is an image, target is not) and `photo` is not (no image extension),
    skipping when `trySymlink` fails.
13. **`un-addressable names are omitted`** — spy on `fs.readdir` to return a fake file
    dirent named `C:backup.jpg` next to a real `ok.jpg`, scan with `wirePath = ''`; only
    `ok.jpg` is returned and a `scan.entry-skipped` event was logged. (A nested
    `sub/C:x.jpg` is accepted because only the first segment is special — assert that too.)
14. **`unreadable subdirectory is skipped silently`** — POSIX only
    (`it.skipIf(process.platform === 'win32')`, with a comment that `fs.chmod` does not
    remove read access on Windows). `chmod(sub, 0o000)`, scan recursively, assert the
    sibling's images are present, that the result excludes the unreadable subtree, and
    that no rejection occurred. Restore `0o755` in a `finally` so cleanup can run. Skip as
    root (`process.getuid?.() === 0`). Also assert a `scan.dir-skipped` event.
15. **`read failure on the starting directory propagates as ApiError`** — POSIX only, the
    same `chmod` technique applied to the start directory; asserts the rejection is an
    `ApiError` whose code is `ACCESS_DENIED`. Portable variant (all platforms): spy on
    `fs.readdir` to reject with `EACCES`, `ENOENT` and `EIO`-shaped errors and assert
    `ACCESS_DENIED`, `NOT_FOUND`, `READ_FAILED` (this is `mapFsError`'s mapping).
16. **`entries are classified from the Dirent without stat`** — spy on `fs.stat` and
    `fs.lstat`, run a recursive scan over a fixture with no symlinks, and assert the only
    `stat` calls observed are the post-traversal pass: the call count equals the number of
    returned items and every argument is a file that appears in `items`. This is the
    executable form of the §5.4 performance rule.
17. **`size and mtimeMs are populated, and null when stat fails`** — the happy path
    asserts both are finite numbers matching the fixture; then stub `fs.stat` to reject
    with `ENOENT` for one specific file and assert that item is still returned, with both
    fields `null`.
18. **`empty directory returns an empty playlist`** — asserts `items` is `[]`,
    `truncated === false`, and no throw.
19. **`wire paths are POSIX and relative`** — on every platform, asserts that no returned
    `path` or `dir` contains a backslash, that none starts with `/`, and that `dir` of a
    root-level image is `""`.
20. **`logs one scan.done aggregate`** — with `createTestLogger()`, a scan emits exactly one
    `scan.done` event at debug level with `dirs`, `images`, `skipped`, `truncated`, `ms`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on the dev machine (Windows 11)
      and in CI on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- [ ] `server/src/services/scan.ts` is the only new production file; it imports
      `isHiddenName` and `compareNames` from `listing.ts` and `mapPool`/`STAT_CONCURRENCY`
      from `concurrency.ts` (both created by T011), and `listing.ts` is not edited here.
- [ ] The §4.3 hidden rules and the FR-3 collator each exist in exactly one place in the
      `server` package.
- [ ] No shared type changed (`ImageItem.size`/`mtimeMs` are already `number | null`, T004).
- [ ] Symlink-dependent and POSIX-permission-dependent cases skip, not fail, where their
      fixtures cannot be created.
- [ ] Every labelled **Decision (not specified)** from §4 appears as a comment at the
      relevant line in the code, not only in this ticket.
- [ ] README unchanged — this ticket alters no setup step and no user-visible behaviour.

## 8. Notes and gotchas

- **The ordering is a contract, not a convenience.** The client "must not re-sort" (§4.2),
  the configuration screen hands `items` straight to the player, and with shuffle off the
  user sees this exact sequence. Any instability — an unsorted `readdir` result leaking
  through, a collator tie resolved by OS order — shows up as a slide show that plays in a
  different order on macOS than on Windows.
- **`truncated` means "the scan stopped", not "there are more".** Do not keep counting
  after the cap in order to report a total; §5.4 says the scan stops. Walking the rest of a
  200000-image tree to produce a number nobody displays is exactly the cost the cap exists
  to avoid.
- **Do not `stat` to find out whether something is a directory.** It is the single easiest
  way to turn a 500 ms scan into a twenty-second one on Windows, where each `stat` is a
  separate syscall round trip. The `Dirent` already knows.
- **`sensitivity: 'base'` is deliberately weak.** `a.PNG` and `A.png` compare equal under
  it. That is why `compareNames` (T011) carries an explicit tie-break: without one, V8's sort is stable but
  the *input* order from `readdir` is not, so the output order would vary by file system.
- **Symlinks are the security-relevant path.** Step 7 of §3.3 "is what defeats symlinks,
  junctions, and reparse points pointing outside the home directory", which is why
  symlinked entries are re-verified through `resolveSafe` rather than followed with a bare
  `fs.realpath`. NFR-7 requires an automated test for a symlink escape; test 10 above is
  this ticket's contribution to it.
- **Hidden-attribute limitation (§4.3).** Node exposes no `FILE_ATTRIBUTE_HIDDEN` bit in
  `fs.Stats`, so a Windows file hidden only via NTFS attributes is not detected and will
  appear in the playlist. This is a documented, accepted limitation — do not try to work
  around it here.
- **Assumption A5 (§16.1):** the player uses the playlist captured when "Play slide show"
  was pressed, and files added mid-show do not appear. This service therefore needs no
  invalidation or watch mechanism.
- **Assumption A7 (§16.1):** there is no sort option on the configuration screen in v1. Do
  not add a `sortBy` parameter "for later"; the order is the FR-3 order (`compareNames`) unless the
  player shuffles.
- **Memory.** Twenty thousand `ImageItem`s with full wire paths is on the order of a few
  megabytes of JSON — acceptable, and the reason `MAX_IMAGES` exists at all. Do not build
  intermediate copies of the whole array (no `items.concat(...)` in a loop); push into one
  array and mutate items in place during the `stat` pass.
