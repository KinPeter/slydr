# T011 — Implement the directory listing service

**Epic:** E5 — Listing API
**Spec sections:** §4.1, §4.2, §4.3, §5.3, §12.1, NFR-2, NFR-5
**Depends on:** T010
**Estimated size:** L

---

## 1. Context

Slydr is a locally running, browser-based slide-show application. Its first screen is a file
explorer that browses the user's home-directory subtree, showing folders first, then images
and other files, with hidden entries filtered out by default. This ticket implements the
service that produces that listing: given a verified absolute directory path, it reads the
directory, classifies every entry as `folder`, `image` or `file`, resolves and vets
symlinks, decides which entries are hidden, filters, sorts, tallies counts and truncates
pathological directories.

All of the policy the explorer depends on lives here, on the server, by design: sorting and
hidden-filtering are server-side so that every platform produces an identical listing and
so that hidden names never reach the browser unless explicitly requested. The client renders
what it is given and **must never re-sort**.

## 2. Scope

### In scope

- `server/src/services/listing.ts` containing:
  - `listDirectory(absDir: string, options: ListOptions): Promise<ListingResult>` — the full
    read/classify/filter/sort/tally/truncate pipeline.
  - `isHiddenName(name: string, platform?: NodeJS.Platform): boolean` — the §4.3 hidden
    rules, exported for direct unit testing.
  - `WINDOWS_HIDDEN_NAMES` — the verbatim §4.3 name list as a module constant.
  - `compareNames(a: string, b: string): number` — the single FR-3 name comparator (module-scope
    `Intl.Collator` plus a code-unit tie-break), exported so the image scan (T013) orders names
    identically — and `compareEntries(a: FsEntry, b: FsEntry): number` built on it.
- `server/src/services/concurrency.ts` containing `mapPool(items, limit, fn)` and
  `STAT_CONCURRENCY = 64`, the bounded-concurrency helper reused by T013 and T018.
- The shared server test helpers, created here and reused by every later server ticket:
  `server/test/helpers/fs.ts` (`makeTempBase`, `trySymlink`, `removeTree`) and
  `server/test/helpers/logger.ts` (`createTestLogger`).
- Unit tests covering the §12.1 listing matrix.

### Out of scope

- The `GET /api/fs/root` and `GET /api/fs/list` HTTP routes, query-parameter validation and
  the Supertest API suite — **T012** owns `server/src/routes/fs.ts` and consumes this
  service.
- `resolveSafe`, `toWirePath`, `assertDirectory`, `assertFile` and `mapFsError` — **T010**
  owns `server/src/security/jail.ts`; they are consumed here unchanged.
- The recursive image scan `/api/fs/images` (`server/src/services/scan.ts`) — epic E6. It
  has its own traversal with `MAX_DEPTH`/`MAX_IMAGES` and a visited-realpath set; do not
  build recursion into `listDirectory`.
- Thumbnails (`/api/thumb`) and original streaming (`/api/image`) — epics E7 and E8.
- Client-side rendering, virtualization and the truncation notice — epics E11–E13.
- The shared repository-wide fixture generator script — **T037**. This ticket builds its own
  temporary fixtures with the `makeTempBase` helper it creates itself (§6).

## 3. Prerequisites and assumed state

**From T001 — monorepo scaffold:** npm workspaces monorepo with `shared/`, `server/`,
`client/`; a root `tsconfig.base.json`; `"type": "module"` (ESM) throughout; TypeScript
`strict`; `engines.node` is `>=22`; Express 5 installed in `server/`.

**From T002 — tooling:** ESLint 9 flat config, Prettier, Vitest with the `node` environment
for `server`, and Supertest. `npm test`, `npm run lint`, `npm run typecheck` all work.

**From T004–T007 — `@slydr/shared`,** importable as `@slydr/shared`:

```ts
export type EntryType = 'folder' | 'image' | 'file';

export interface FsEntry {
  name: string;        // basename as it appears on disk
  path: string;        // wire path, relative to jail root, POSIX separators
  type: EntryType;
  hidden: boolean;
  size: number | null; // bytes; null for folders and on stat failure
  mtimeMs: number | null;
}

export interface ImageItem { name: string; path: string; dir: string; size: number | null; mtimeMs: number | null }

export const MAX_ENTRIES = 10000;
export const MAX_DEPTH = 12;
export const MAX_IMAGES = 20000;
export const IMAGE_EXTENSIONS: Set<string>;   // .jpg .jpeg .jfif .png .gif .webp .avif .bmp .svg

export function isImageExtension(name: string): boolean;
export function classifyByName(name: string, isDirectory: boolean): EntryType;

export function wireParent(p: string): string | null;
export function wireJoin(dir: string, name: string): string;
export function wireBasename(p: string): string;
export function wireSegments(p: string): string[];
```

plus the endpoint response types, the `ApiErrorCode` union from §3.5, `DEFAULT_CONFIG` and
`parseConfig`. Use `classifyByName(name, isDirectory)` rather than re-deriving the extension
test, and `wireJoin(dir, name)` rather than string concatenation, so that the classification
and the wire format have exactly one implementation each.

**From T008 — server core:** `readServerConfig(env): ServerConfig` in `server/src/config/env.ts`
(this ticket does not read configuration; `SLYDR_ROOT` is never read by services or tests), the
test helper `server/test/helpers/testConfig.ts` (`makeTestConfig`), and `ApiError`
(`new ApiError(code, message?, cause?)`, status derived from the code) with the §3.5 code-to-status mapping
(`INVALID_PATH` 400, `INVALID_PARAM` 400, `OUTSIDE_ROOT` 403, `FORBIDDEN_HOST` 403,
`NOT_FOUND` 404, `NOT_A_DIRECTORY` 400, `NOT_A_FILE` 400, `ACCESS_DENIED` 403,
`UNSUPPORTED_IMAGE` 415, `THUMBNAIL_FAILED` 500, `READ_FAILED` 500,
`METHOD_NOT_ALLOWED` 405), and the rule that no raw OS error message, `errno` or absolute
path may appear in a response body.

**From T009 — bootstrap and logging:** `server/src/logger.ts` exporting `createLogger`, the
`Logger` interface (`debug|info|warn|error(event: string, fields?: Record<string, unknown>)`)
and `errorFields(err)` for log-only error detail. Services receive a `Logger` as an argument
(never a singleton). NFR-10: logs may contain absolute paths; API responses may not.

**From T010 — path jail,** `server/src/security/jail.ts`:

```ts
export function setJailRoot(absolute: string): void;
export function getJailRoot(): string;
export function resolveSafe(relPath: string): Promise<string>;
export function toWirePath(absPath: string): string;
export function assertDirectory(absPath: string): Promise<Stats>;
export function assertFile(absPath: string): Promise<Stats>;
export function mapFsError(err: unknown): ApiError;
export function isWirePathAcceptable(relPath: string): boolean;   // pure steps 1-4
export function isContained(real: string, root: string): boolean; // pure step 7
```

`resolveSafe` implements the eight-step §3.3 containment algorithm and is the **only** way
any absolute path may be obtained from client input. `toWirePath` is its inverse: an
absolute path inside the jail root becomes a forward-slash path relative to that root, with
the root itself becoming `""`.

## 4. Implementation detail

### 4.1 Module surface

```ts
// server/src/services/listing.ts
import type { FsEntry } from '@slydr/shared';
import type { Logger } from '../logger.js';

export interface ListOptions {
  /** When false, entries with hidden: true are removed before sorting. */
  showHidden: boolean;
  /** The wire path of the directory being listed; used to build each entry's wire path. */
  wireDir: string;
  /** Optional logger for per-entry skips (event `listing.entry-skipped`, debug). Defaults to a no-op. */
  logger?: Logger;
}

export interface ListingCounts {
  folders: number;
  images: number;
  files: number;
}

export interface ListingResult {
  entries: FsEntry[];
  counts: ListingCounts;
  truncated: boolean;
}

export async function listDirectory(
  absDir: string,
  options: ListOptions,
): Promise<ListingResult>;
```

`absDir` **must** already have come from `resolveSafe` — the service does no containment
work of its own and must document that precondition in its JSDoc. Passing `wireDir` in
rather than deriving it with `toWirePath(absDir)` avoids one redundant computation per
request and keeps the service usable in a unit test that has not initialised the jail root;
*Decision (not specified):* accept `wireDir` explicitly and have T012 supply it.

### 4.2 The pipeline, in order

1. **Read the directory with dirents.**

   ```ts
   import fs from 'node:fs/promises';   // default import: tests spy on fs.readdir / fs.stat
   const dirents = await fs.readdir(absDir, { withFileTypes: true });
   ```

   Always call through the `fs` default-import object (`fs.readdir`, `fs.stat`,
   `fs.realpath.native`), never through named imports, so `vi.spyOn(fs, ...)` in the tests
   intercepts the call (tasks/README.md, server conventions).

   Wrap in `try/catch` and rethrow `mapFsError(err)`, which turns `EACCES`/`EPERM` into
   `403 ACCESS_DENIED` (required by §5.3), `ENOENT` into `404 NOT_FOUND` and `ENOTDIR` into
   `404 NOT_FOUND`. `withFileTypes` is mandatory: the `Dirent` already answers "is this a
   directory or a regular file?" for the overwhelming majority of entries, and that is the
   single biggest factor in meeting NFR-2.

2. **Classify each dirent** (FR-2.1–FR-2.3). For each `dirent`, through `mapPool(dirents,
   STAT_CONCURRENCY, ...)` from `server/src/services/concurrency.ts` (§4.5):

   - `dirent.isDirectory()` → `type = 'folder'`, `size = null`, and `mtimeMs` from a `stat`
     (see step 3).
   - `dirent.isFile()` → `type = classifyByName(dirent.name, false)`, which yields `'image'`
     when the lower-cased extension is in `IMAGE_EXTENSIONS` and `'file'` otherwise.
   - `dirent.isSymbolicLink()` → **resolve it** and classify by the *kind of the target*
     (FR-2.1); a symlink to a folder is followed as long as the real target is inside the jail:

     ```ts
     const abs = path.join(absDir, dirent.name);
     let real: string;
     try { real = await fs.realpath.native(abs); } catch { /* omit */ }
     ```

     Then:
     - **Omit the entry entirely** when `realpath` fails for any reason — a broken symlink
       is omitted (FR-2.1).
     - **Omit the entry entirely** when the resolved target is **outside the jail root**
       (FR-2.1). Call T010's exported `isContained(real, getJailRoot())` (step 7 of §3.3), so
       the rule has exactly one implementation. Never re-implement the `startsWith` test.
     - Otherwise `stat` the resolved target. **Omit the entry entirely** when the `stat`
       fails (FR-2.1: "cannot be stat'd").
     - Classify from the target's `Stats`: `isDirectory()` → `folder`;
       `isFile()` → `classifyByName(dirent.name, false)`. **Per spec FR-2.1 the extension
       used for image classification is the *link's* name, not the target's**, because that
       is the name the user sees and the name the client later passes to `/api/image` and
       `/api/thumb` (T015/T017 apply the same rule to the requested name). Say so in a code
       comment.
     - Anything else → omit (FR-2.2).
   - **Anything that is neither a regular file nor a directory after resolution is
     omitted** (FR-2.2): sockets (`isSocket()`), FIFOs (`isFIFO()`), block devices
     (`isBlockDevice()`), character devices (`isCharacterDevice()`). On POSIX these appear in
     a home directory rarely but really (`.gnupg/S.gpg-agent` is a socket, for instance), so
     the omission is not theoretical. `Dirent` exposes the same predicates as `Stats`, so
     the check costs nothing.

   **Un-addressable names are omitted too.** Before classifying, compute the entry's wire
   path and drop the entry when T010's `isWirePathAcceptable(wirePath)` is `false` (e.g. a
   top-level POSIX entry named `C:backup` or `\\x`, which `resolveSafe` would reject per
   spec §3.3). Otherwise the explorer would list a folder it can never open. This is a
   pure string check, no syscall. Add a unit test: such an entry is absent from the
   listing and from `counts`.

   The three `Dirent` cases above are the only ones that proceed; everything else is dropped
   silently.

3. **Gather `size` and `mtimeMs`.**

   `FsEntry.size` is "bytes; null for folders and on stat failure" and `mtimeMs` is
   `number | null`. That means a `stat` is required for files to report size, and for
   folders to report `mtimeMs`.

   - For a **regular file** dirent: `const st = await fs.stat(abs);` →
     `size = st.size`, `mtimeMs = st.mtimeMs`.
   - For a **directory** dirent: `const st = await fs.stat(abs);` → `size = null`,
     `mtimeMs = st.mtimeMs`.
   - For a **symlink**: reuse the `Stats` already obtained from the resolved target in step
     2 — do not stat twice.
   - **On `stat` failure, swallow the error and omit the entry** (§5.3: "Per-entry stat
     failures are swallowed and the entry omitted"; spec §4.1 now agrees, so `size` is `null`
     only for folders; NFR-5: every such case degrades to a skip plus a log line). Call
     `options.logger?.debug('listing.entry-skipped', { reason: 'stat-failed', path: abs,
     ...errorFields(err) })` (absolute paths are permitted in logs by NFR-10) and continue.
     Every other omission (broken or escaping symlink, special file, un-addressable name)
     logs the same event with its own `reason`. **One unreadable file must never fail the
     whole listing.**

   *Decision (not specified):* `mtimeMs` is reported for folders even though the UI does not
   currently display it, because the `FsEntry` contract declares the field and leaving it
   `null` for every folder would be a silent contract narrowing. The cost is one `stat` per
   folder, which is already paid for files.

4. **Build the `FsEntry`.**

   ```ts
   const entry: FsEntry = {
     name: dirent.name,
     path: wireJoin(options.wireDir, dirent.name),
     type,
     hidden: isHiddenName(dirent.name),
     size,
     mtimeMs,
   };
   ```

   `wireJoin('', 'Pictures')` must yield `'Pictures'` and
   `wireJoin('Pictures', '2024')` must yield `'Pictures/2024'` — that is T004–T007's
   contract. Never build the wire path with template strings.

5. **Filter by `showHidden`.** When `options.showHidden` is `false`, drop every entry whose
   `hidden` is `true`. §4.3: "Filtering happens **server-side** based on the `showHidden`
   query parameter, so hidden names never reach the browser unless requested." When
   `showHidden` is `true`, keep them — the client renders them exactly like any other entry (FR-14.5).

6. **Sort** per §4.2 (see §4.4 of this ticket).

7. **Tally `counts` over the post-filter entries.** §5.3: "`counts` reflects the returned
   (post-filter) entries and feeds the explorer's informational image-count chip."

   ```ts
   const counts = { folders: 0, images: 0, files: 0 };
   for (const e of entries) {
     if (e.type === 'folder') counts.folders += 1;
     else if (e.type === 'image') counts.images += 1;
     else counts.files += 1;
   }
   ```

   Compute the tally over the **filtered** list, **before** truncation (spec §5.3, updated:
   `counts` covers the whole post-filter set), so the chip tells the user how many images the
   folder really holds even when the listing was cut at 10000. State it in the JSDoc and add
   a unit test pinning this behaviour so it is not "fixed" later.

8. **Truncate to `MAX_ENTRIES`, after sorting.** §5.3: "`truncated` is `true` when the
   directory held more than `MAX_ENTRIES = 10000` entries; the response carries the first
   10000 **after sorting**."

   ```ts
   const truncated = entries.length > MAX_ENTRIES;
   const result = truncated ? entries.slice(0, MAX_ENTRIES) : entries;
   ```

   **Order matters: sort first, then slice.** Truncating before sorting would return an
   arbitrary 10000 entries, so folders could vanish from a large directory purely because
   `readdir` happened to return them late. Put a comment on the slice saying so.

   `truncated` is evaluated against the **post-filter** count (spec §5.3, updated), which is
   what the user is being shown: a directory with 11000 entries of which 2000 are hidden
   returns `truncated: false` when `showHidden=false`, because only 9000 entries were
   actually available to return.

9. Return `{ entries: result, counts, truncated }`.

### 4.3 Hidden entries (§4.3)

```ts
export const WINDOWS_HIDDEN_NAMES: readonly string[] = [
  'AppData',
  '$RECYCLE.BIN',
  'System Volume Information',
  'desktop.ini',
  'Thumbs.db',
  'ntuser.*',
  'NTUSER.DAT*',
  'IconCache.db',
  'Application Data',
  'Local Settings',
  'My Documents',
  'Recent',
  'SendTo',
  'Start Menu',
  'Templates',
  'Cookies',
  'NetHood',
  'PrintHood',
];

export function isHiddenName(
  name: string,
  platform: NodeJS.Platform = process.platform,
): boolean;
```

The list above is reproduced **verbatim** from specification §4.3, in the specification's
own order. Do not reorder it, do not deduplicate it, and do not add entries to it without a
specification change.

An entry is `hidden: true` when **either** rule matches:

1. **`name` starts with `.` — applied on all platforms.** `name.startsWith('.')`. Note this
   makes `.` and `..` hidden, but `readdir` never returns them, so no special case is
   needed.
2. **Windows only: `name` matches the list above, case-insensitively.** Two match forms:
   - An entry **without** a `*` is an exact, case-insensitive full-name match. Compare with
     `name.toLowerCase() === pattern.toLowerCase()`. Use `toLowerCase()` rather than
     `localeCompare` with `sensitivity: 'base'` here: the names are ASCII identifiers and
     locale-aware folding would be both slower and, in a Turkish locale, wrong for the `i`
     in `desktop.ini` and `IconCache.db`.
   - An entry **ending in `*`** is a **glob-style prefix match**: strip the trailing `*` and
     test `name.toLowerCase().startsWith(prefix.toLowerCase())`. This is how `ntuser.*`
     matches `ntuser.ini` and `ntuser.dat.log1`, and how `NTUSER.DAT*` matches
     `NTUSER.DAT{016cd0cd-…}.TM.blf`. The two entries overlap deliberately; both are in the
     specification list and both are implemented.
   - A `*` anywhere other than at the end does not occur in the list. *Decision (not
     specified):* treat such a pattern, were one added, as an exact match and log nothing —
     or better, add a unit test asserting that every entry in `WINDOWS_HIDDEN_NAMES` either
     contains no `*` or ends with exactly one, so a malformed future addition fails the
     suite rather than silently never matching.

   Precompute the lower-cased exact set as a `Set<string>` and the lower-cased prefix list
   as an array at module load, so `isHiddenName` is a hash lookup plus a handful of
   `startsWith` calls rather than an 18-element scan with per-call `toLowerCase` on the
   patterns. In a 2000-entry directory this is called 2000 times and NFR-2's budget is
   500 ms.

The `platform` parameter defaults to `process.platform` and exists so the Windows rules can
be unit-tested on Linux and macOS CI legs. Rule 2 applies only when `platform === 'win32'`.

**Known limitation, reproduce in a code comment:** Node core exposes no
`FILE_ATTRIBUTE_HIDDEN` bit in `fs.Stats`, so a file flagged hidden only via NTFS
attributes is **not** detected. The name list above covers the entries that actually appear
in a Windows home directory. Adding a native attribute reader is explicitly out of scope and
the limitation is documented in the README (§13.3).

*Decision (not specified):* do not attempt to read the hidden attribute by shelling out to
`attrib.exe` or by using a native module. NFR-1 forbids shell commands and §2.3 forbids any
dependency needing a compiler toolchain, so both workarounds are ruled out by the
specification already.

Hidden folders are also skipped during recursive image scans unless `showHidden=true` — that
behaviour belongs to `server/src/services/scan.ts` in epic E6, which must import
`isHiddenName` and `compareNames` from this module rather than reimplementing them. Export
them for that reason.

### 4.4 Sorting (§4.2)

Server-side, stable, and identical on every platform:

1. **Folders before images and other files.**
2. **Within a group, by `name` using
   `new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`.**

```ts
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The single FR-3 name comparator. Exported so the image scan (T013) orders names
 * with exactly the same rule. Collator ties (`a.jpg` vs `A.jpg`) fall back to a
 * code-unit comparison so the order never depends on readdir order.
 */
export function compareNames(a: string, b: string): number {
  const c = collator.compare(a, b);
  if (c !== 0) return c;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Folders first (rank 0), then images and other files together (rank 1). */
function rank(type: EntryType): number {
  return type === 'folder' ? 0 : 1;
}

export function compareEntries(a: FsEntry, b: FsEntry): number {
  const r = rank(a.type) - rank(b.type);
  if (r !== 0) return r;
  return compareNames(a.name, b.name);
}
```

Critical details:

- **Construct the `Intl.Collator` exactly once at module load.** Constructing it per
  comparison is the classic performance trap: `Array.prototype.sort` on 2000 entries makes
  roughly 20 000 comparisons, and `new Intl.Collator` costs orders of magnitude more than
  a comparison. Doing it per call alone can blow the NFR-2 budget.
- **`rank` groups images and other files together.** §4.2 says "Folders before images and
  other files" — a two-way split, not a three-way one. Within the non-folder group, an image
  and a non-image sort purely by name. Do not invent a secondary image-before-file rule.
- The numeric collator is what makes `IMG_2.jpg` sort before `IMG_10.jpg`, which is what
  users expect of photo sets.
- `sensitivity: 'base'` makes the comparison case- and accent-insensitive, so `a.jpg` and
  `A.jpg` compare equal. `Array.prototype.sort` is stable in every engine targeted by Node
  22, so equal-comparing entries retain `readdir` order, which differs between platforms and
  file systems. *Decision (not specified):* `compareNames` adds a deterministic tie-breaker —
  `a < b ? -1 : a > b ? 1 : 0` — after the collator returns `0`, so that
  a directory containing both `a.jpg` and `A.jpg` produces the same order on every platform.
  Without it, the same fixture tree legitimately lists differently on case-sensitive ext4
  and case-insensitive NTFS, which would make a CI assertion flaky. Document the tie-breaker
  as a cross-platform determinism measure, not a spec deviation.
- `undefined` as the locale argument means "the host's default locale". That is what the
  specification says, and it is correct for a single-user local tool. Be aware that it makes
  the collation locale-dependent in principle; in practice the only observable effect for
  ASCII and common Latin filenames is nil. Do not substitute a fixed locale.

**The client must not re-sort** (§4.2). Nothing in this ticket enforces that, but the
service's JSDoc must say it so the client tickets inherit the rule.

### 4.5 Performance (NFR-2)

The budget: **a 2000-entry directory responds in under 500 ms on a warm cache.**

The resulting rules:

- **Avoid a `stat` per entry where the dirent already answers the question.** Use
  `readdir(..., { withFileTypes: true })` and consult `dirent.isDirectory()`,
  `dirent.isFile()` and `dirent.isSymbolicLink()` before touching the file system again.
  Only the `size`/`mtimeMs` fields and symlink resolution require a syscall.
- Because `FsEntry` declares `size` and `mtimeMs`, one `stat` per surviving entry is
  unavoidable in the current contract. Keep it to exactly one: never `stat` and then `lstat`,
  never `stat` the same path twice, and reuse the symlink target's `Stats`.
- **Run the per-entry work with bounded concurrency**, not sequentially and not with an
  unbounded `Promise.all` over 10 000 entries. A sequential loop pays full I/O latency per
  entry; an unbounded one exhausts the libuv threadpool (default 4 threads) and can hit
  `EMFILE`. *Decision (not specified):* use a fixed concurrency of **64** via the shared
  helper in `server/src/services/concurrency.ts`:

  ```ts
  /** 64 is well above the 4-thread libuv pool, so the queue stays saturated, and far below any descriptor limit. Tunable after measurement (§16.2). */
  export const STAT_CONCURRENCY = 64;
  /** Runs fn over items with at most `limit` in flight (N workers pulling from a shared index); results keep input order. */
  export async function mapPool<T, R>(
    items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]>;
  ```

  `listing.ts` uses it with `STAT_CONCURRENCY`; T013 (stat pass) and T018 (cache walk) import
  the same helper instead of hand-rolling pools. `mapPool` rejects with the first error, so
  callers catch per item inside `fn`. Add `server/test/services/concurrency.test.ts`: never
  exceeds `limit` in flight, preserves result order, handles an empty list, and
  `limit < 1` throws `RangeError`.
- Do not sort inside the concurrency loop; collect, then sort once.
- Do not build intermediate arrays you do not need: one pass to collect, one filter, one
  sort, one tally, one slice.
- Keep the `Intl.Collator` and the hidden-name sets at module scope (§4.3, §4.4).
- Do not read file contents. Classification is by extension only (FR-2.3); there is no
  magic-byte sniffing anywhere in Slydr.

Add a non-gating performance smoke test (§6) that builds 2000 files in a temp directory and
asserts the listing completes. Keep its threshold generous (for example 3000 ms) so it
catches an accidental O(n²) or a per-entry `new Intl.Collator`, without failing on a slow
shared CI runner. *Decision (not specified):* the NFR-2 figure is a product requirement
measured on a developer machine, not a CI gate; a tight assertion in CI would be flaky and
would get skipped, which is worse than a loose one that actually runs.

### 4.6 Cross-platform notes

| Concern | win32 | darwin | linux |
|---|---|---|---|
| Hidden by leading `.` | applied (rule 1) | applied | applied |
| Hidden by name list | applied (rule 2) | **not** applied | **not** applied |
| `FILE_ATTRIBUTE_HIDDEN` detection | **not available** — documented limitation | n/a | n/a |
| `Dirent.isSymbolicLink()` for a junction | **true** — junctions are reparse points and Node reports them as symlinks | n/a | n/a |
| Creating a file symlink in a fixture | needs Administrator or Developer Mode | unprivileged | unprivileged |
| Creating a directory junction in a fixture | unprivileged | n/a | n/a |
| Sockets / FIFOs in a home directory | rare | common (`.gnupg`, IPC sockets) | common |
| `readdir` order | roughly insertion order on NTFS, effectively arbitrary | arbitrary | arbitrary (ext4 hashed) |
| Case sensitivity of names | insensitive | insensitive by default | sensitive |

Because the junction case means a Windows directory junction arrives as a symlink dirent,
the symlink branch in §4.2 step 2 is also the junction branch — a junction pointing outside
the jail root is omitted from the listing by the same containment test. Assert it with a
win32-only test.

## 5. Acceptance criteria

- [ ] `server/src/services/listing.ts` exports `listDirectory`, `isHiddenName`,
      `WINDOWS_HIDDEN_NAMES`, `compareNames` and `compareEntries` with the signatures in §4.1;
      `server/src/services/concurrency.ts` exports `mapPool` and `STAT_CONCURRENCY = 64`;
      `ListOptions.logger` is an optional T009 `Logger` (there is no `log` function option).
- [ ] `server/test/helpers/fs.ts` (`makeTempBase`, `trySymlink`, `removeTree`) and
      `server/test/helpers/logger.ts` (`createTestLogger`) exist and are used by this
      ticket's tests.
- [ ] `listDirectory` calls `fs.readdir` with `{ withFileTypes: true }`; a grep of the file
      finds no `readdir` call without it.
- [ ] A directory containing folders and files returns every folder before every non-folder.
- [ ] `IMG_2.jpg` sorts before `IMG_10.jpg`, and `IMG_10.jpg` before `IMG_100.jpg`.
- [ ] The `Intl.Collator` is constructed at module scope exactly once; a grep finds exactly
      one `new Intl.Collator` in the file and it is not inside a function body.
- [ ] Entries whose name starts with `.` have `hidden: true` on all three platforms.
- [ ] `isHiddenName(name, 'win32')` returns `true` for every exact entry of
      `WINDOWS_HIDDEN_NAMES` in its own case, in upper case and in lower case.
- [ ] `isHiddenName('ntuser.ini', 'win32')` and
      `isHiddenName('NTUSER.DAT{016cd0cd}.TM.blf', 'win32')` are both `true`;
      `isHiddenName('ntuserdata.txt', 'win32')` is `false`.
- [ ] `isHiddenName('AppData', 'linux')` is `false`, and `isHiddenName('.config', 'linux')`
      is `true`.
- [ ] With `showHidden: false`, no returned entry has `hidden: true`; with
      `showHidden: true`, hidden entries are present and still carry `hidden: true`.
- [ ] A symlink pointing **outside** the jail root is absent from the result.
- [ ] A symlink pointing **inside** the jail root is present and classified by its target's
      kind, using the link's own name for the image-extension test (FR-2.1). A symlink to a
      folder inside the jail is listed as a `folder`.
- [ ] A **broken** symlink is absent from the result.
- [ ] A FIFO or socket is absent from the result (POSIX platforms).
- [ ] A Windows junction pointing outside the jail root is absent from the result (win32).
- [ ] An entry whose `stat` fails is absent from the result and the listing still succeeds.
- [ ] `size` is `null` for every folder and a number for every file;
      `mtimeMs` is a number for both.
- [ ] `counts` sums to the post-filter entry count when the listing is not truncated.
- [ ] A directory with `MAX_ENTRIES + 1 = 10001` visible entries returns exactly 10000
      entries, `truncated: true`, and the returned slice is the **sorted** prefix.
- [ ] A directory with exactly 10000 visible entries returns `truncated: false`.
- [ ] `EACCES`/`EPERM` on the directory itself propagates as an `ApiError` with code
      `ACCESS_DENIED` and status 403.
- [ ] No `ApiError` thrown by this module carries an absolute path or an `errno` in its
      `message`.
- [ ] The module's JSDoc states that `absDir` must come from `resolveSafe` and that the
      client must never re-sort.

## 6. Tests to write

Per specification §12.1: "`server/services/listing`: folders-first ordering, numeric name
collation, hidden filtering on both rule sets, omission of broken symlinks and special
files, `truncated` behaviour."

All in **`server/test/services/listing.test.ts`** unless stated. This ticket creates the
shared server test helpers (every later server ticket imports them):

```ts
// server/test/helpers/fs.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** mkdtemp under os.tmpdir(), then realpath.native: macOS /var -> /private/var, Windows 8.3 names. */
export async function makeTempBase(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return fs.realpath.native(dir);
}

/** Returns false instead of throwing (Windows needs Developer Mode/elevation for file and dir symlinks). */
export async function trySymlink(
  target: string, link: string, type: 'file' | 'dir' | 'junction',
): Promise<boolean> {
  try { await fs.symlink(target, link, type); return true; } catch { return false; }
}

/** fs.rm recursive+force with maxRetries (Windows EBUSY/EPERM while handles close). */
export async function removeTree(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
```

```ts
// server/test/helpers/logger.ts
import type { Logger } from '../../src/logger.js';
export interface TestLogEvent { level: 'debug' | 'info' | 'warn' | 'error'; event: string; fields: Record<string, unknown> }
/** A Logger that records every call instead of writing; `events` is mutable so tests can clear it. */
export function createTestLogger(): { logger: Logger; events: TestLogEvent[] };
```

In `beforeAll` create the fixture with `makeTempBase('slydr-listing-')` (already
realpath'd, so containment checks do not fail for the wrong reason), call
`setJailRoot(root)`; in `afterAll` call `resetJailRootForTests()` and `removeTree(base)`.
Tests never set `SLYDR_ROOT`. **The shared repository-wide fixture generator script is owned
by T037; do not depend on it.**

Any case whose fixture could not be created (`trySymlink` returned `false`) must **skip
gracefully** (`ctx.skip()`), never fail — symlink creation requires elevation or Developer
Mode on Windows.

**`isHiddenName` — pure unit tests, no file system.**

- `leading dot is hidden on every platform` — table over `win32`, `darwin`, `linux` for
  `.config`, `.DS_Store`, `.a`.
- `a non-dot ordinary name is not hidden on any platform` — `Pictures`, `notes.txt`.
- `every exact Windows name matches case-insensitively` — generated from
  `WINDOWS_HIDDEN_NAMES.filter((n) => !n.endsWith('*'))`, each asserted in original, upper
  and lower case with `platform: 'win32'`.
- `ntuser.* prefix matching` — `ntuser.ini`, `ntuser.dat`, `NTUSER.POL`, `nTuSeR.whatever`
  all `true`; `ntuser` alone is `true` as well (prefix `ntuser.` does not match `ntuser`, so
  assert the actual behaviour deliberately — **decide and pin it**: *Decision (not
  specified):* the pattern `ntuser.*` strips only the trailing `*`, leaving the prefix
  `ntuser.`, so the bare name `ntuser` is **not** hidden. Assert `false` for `'ntuser'`).
- `NTUSER.DAT* prefix matching` — `NTUSER.DAT`, `NTUSER.DAT.LOG1`,
  `NTUSER.DAT{016cd0cd-0000-0000-0000-000000000000}.TM.blf` all `true`.
- `prefix patterns do not over-match` — `ntuserdata.txt`, `my-ntuser.ini`,
  `NOTNTUSER.DAT` all `false`.
- `the Windows list does not apply on darwin or linux` — `AppData`, `Thumbs.db`,
  `desktop.ini`, `$RECYCLE.BIN` all `false` for both platforms.
- `WINDOWS_HIDDEN_NAMES is well-formed` — every entry contains either no `*` or exactly one
  trailing `*`; the array length is 18 and its contents equal an inline literal copied from
  §4.3. This is the guard that a future edit to the list is deliberate.

**`compareNames` / `compareEntries` — pure unit tests.**

- `compareNames orders by numeric collation and breaks collator ties by code unit` —
  `compareNames('a.jpg','A.jpg')` is non-zero and antisymmetric; `compareNames('x','x') === 0`.
- `folders sort before images and other files` — a folder, an image and a file in every
  input order.
- `images and other files sort together by name only` — `b.txt` after `a.jpg` and before
  `c.png`.
- `numeric collation` — `['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg', 'IMG_100.jpg']` sorts to
  `['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg', 'IMG_100.jpg']`.
- `case-insensitive grouping with a deterministic tie-break` — `['b.jpg', 'A.jpg', 'a.jpg']`
  produces a stable, asserted order; the test documents the tie-breaker.
- `the sort is stable for equal-comparing entries`.

**`listDirectory` — fixture-backed tests.** Fixture tree:

```
root/
  Pictures/                    (folder)
  Archive/                     (folder)
  .hidden-folder/              (folder, hidden rule 1)
  AppData/                     (folder, hidden rule 2 on win32 only)
  IMG_2.jpg                    (image)
  IMG_10.jpg                   (image)
  IMG_1.JPEG                   (image, upper-case extension)
  photo.svg                    (image)
  notes.txt                    (file)
  archive.zip                  (file)
  .dotfile                     (file, hidden rule 1)
  Thumbs.db                    (file, hidden rule 2 on win32 only)
  link-inside   -> Pictures    (symlink)
  link-img      -> IMG_2.jpg   (symlink to an image; no extension, so a plain file)
  link-img.jpg  -> IMG_2.jpg   (symlink to an image; image by its own name)
  link-data.jpg -> notes.txt   (symlink whose target has no image extension; image by its own name)
  link-outside  -> <outsideDir>(symlink, must be omitted)
  link-broken   -> ./nope      (symlink, must be omitted)
  fifo                         (POSIX only, must be omitted)
  junction-outside             (win32 only, must be omitted)
```

- `returns folders first, then images and files by name` — assert the exact `name` sequence
  with `showHidden: false`.
- `classifies images by extension, case-insensitively` — `IMG_1.JPEG` and `photo.svg` are
  `image`; `notes.txt` and `archive.zip` are `file`.
- `folders have size null and a numeric mtimeMs`.
- `files have a numeric size and mtimeMs`.
- `wire paths are POSIX and relative to the jail root` — with `wireDir: 'sub'`, an entry's
  `path` is `'sub/IMG_2.jpg'`; with `wireDir: ''` it is `'IMG_2.jpg'`. Assert there is no
  backslash in any returned `path` (this is the NFR-1 cross-platform guard and it will catch
  a hand-rolled join on Windows).
- `a symlink to a directory inside the root is classified as a folder` — `link-inside` has
  `type: 'folder'` and `size: null`.
- `a folder symlink inside the jail is followed` — `listDirectory` on the resolved target of
  `link-inside` (called with `wireDir: 'link-inside'`) returns the entries of `Pictures`
  with `path` values `link-inside/<name>` (the navigated name, spec FR-2.1/§5.3).
- `image-ness comes from the symlink's own name (FR-2.1)` — `link-img` (no extension) has
  `type: 'file'`; `link-img.jpg` has `type: 'image'`; `link-data.jpg`, whose target is
  `notes.txt`, has `type: 'image'`. **Pin all three explicitly.**
- `a symlink whose target is outside the root is omitted` — `link-outside` absent. Skip if
  unavailable.
- `a broken symlink is omitted` — `link-broken` absent. Skip if unavailable.
- `a socket, FIFO or device dirent is omitted (simulated)` — Node has no FIFO-creation API
  and NFR-1 forbids shelling out, so spy on `fs.readdir` (`vi.spyOn(fs, 'readdir')`) to
  return fake `Dirent`-shaped objects (`name`, and `isFile`/`isDirectory`/`isSymbolicLink`
  all `false`, with `isFIFO`/`isSocket` `true`) mixed with real ones from the fixture; assert
  the fake entries are absent from `entries` and `counts`, and that
  `listing.entry-skipped` was logged (via `createTestLogger`). The name states that the
  real-device case is covered by this simulation.
- `an un-addressable name is omitted` — spy on `fs.readdir` to return a fake file dirent
  named `C:backup.jpg` with `wireDir: ''`; it is absent from `entries` and `counts` because
  `isWirePathAcceptable('C:backup.jpg')` is `false`.
- `a Windows junction pointing outside the root is omitted` — `it.runIf(process.platform === 'win32')`,
  created with `fs.symlink(outsideDir, link, 'junction')`.
- `hidden entries are excluded by default` — `.hidden-folder` and `.dotfile` absent with
  `showHidden: false`.
- `hidden entries are included when requested and still flagged` — present with
  `showHidden: true`, each with `hidden: true`.
- `the Windows name list filters on win32` — `it.runIf(process.platform === 'win32')`:
  `AppData` and `Thumbs.db` absent with `showHidden: false`.
- `the Windows name list does not filter on POSIX` —
  `it.skipIf(process.platform === 'win32')`: `AppData` and `Thumbs.db` present with
  `showHidden: false`.
- `counts tallies the post-filter entries` — assert the exact `{ folders, images, files }`
  for both `showHidden` values, with platform-conditional expectations for the Windows-only
  hidden names.
- `an entry whose stat fails is omitted and the listing still succeeds` — spy on `fs.stat`
  with `vi.spyOn` and make it reject with an `EACCES`-shaped error for one specific path;
  assert that path is absent, that the rest of the listing is intact, that the promise
  resolved rather than rejected (NFR-5), and that a `listing.entry-skipped` debug event with
  `reason: 'stat-failed'` was recorded by the test logger.
- `the directory itself being unreadable throws ACCESS_DENIED` — spy on `fs.readdir` to
  reject with `EACCES`; assert the thrown value is an `ApiError` with
  `code: 'ACCESS_DENIED'` and `status: 403`, and that its `message` contains no path and no
  `errno`. On POSIX, additionally cover the real case with `fs.chmod(dir, 0o000)`, skipping
  on `win32` and when `process.getuid?.() === 0` (CI containers often run as root, where
  mode bits are bypassed and the assertion would invert).
- `a missing directory throws NOT_FOUND`.
- `an empty directory returns no entries, zero counts and truncated false`.

**Truncation — its own `describe` with a generated directory.**

- `10000 entries are not truncated` — create 10000 small files (use `fs.writeFile` with an
  empty buffer through `mapPool(..., STAT_CONCURRENCY, ...)`; this is the slowest test in the suite, so
  give it a 60 s timeout and create the fixture once for the whole block).
- `10001 entries are truncated to 10000 with truncated true`.
- `truncation keeps the sorted prefix` — name the files `f00001.txt` … `f10001.txt` so the
  collated order is the numeric order, and assert the last returned entry is `f10000.txt`
  and that `f10001.txt` is absent. **This is the "sort before slice" regression guard.**
- `counts reflect the full post-filter set, not the truncated slice` — pins the §4.2 step 7
  rule (spec §5.3).
- `truncation is evaluated after hidden filtering` — a directory of 10001 entries where 500
  are dot-files returns `truncated: false` with `showHidden: false`.

**Performance smoke — `server/test/services/listing.perf.test.ts`.**

- `lists a 2000-entry directory within a generous budget` — build 2000 files once, run
  `listDirectory` and assert it resolves in under 3000 ms. Name the test so its purpose is
  obvious and add a comment pointing at NFR-2's real 500 ms target and explaining that the
  loose CI threshold exists to catch algorithmic regressions, not to measure the product
  requirement.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on Windows, macOS and Linux.
- [ ] Symlink-dependent and POSIX-permission-dependent cases skip, not fail, where their
      fixtures cannot be created; the CI log shows the skip.
- [ ] `WINDOWS_HIDDEN_NAMES` matches §4.3 verbatim and is guarded by a test comparing it to
      an inline literal.
- [ ] Exactly one `new Intl.Collator` exists in `listing.ts`, at module scope.
- [ ] `readdir` is always called with `withFileTypes: true`.
- [ ] The sort happens before the `MAX_ENTRIES` slice, with a comment saying why.
- [ ] A code comment records the Windows `FILE_ATTRIBUTE_HIDDEN` limitation and points at
      the README (T041 creates the README and documents the limitation, §13.3; no README
      change in this ticket).
- [ ] The shared test helpers and `concurrency.ts` are in place and have their own tests.

## 8. Notes and gotchas

- **The client must never re-sort** (§4.2). If the explorer appears mis-ordered, the bug is
  here, not there. Say so in the module JSDoc so a future client ticket does not "fix" it by
  sorting in React.
- **Sort before slicing.** This is the single easiest mistake in the ticket and it is
  invisible in a small fixture: with 50 files, the sorted prefix and the `readdir` prefix are
  both "all of them". Only the 10001-entry test catches it.
- **`new Intl.Collator` inside the comparator is a performance cliff**, not a style nit. On
  2000 entries it can turn a 40 ms sort into several seconds and blow NFR-2 on its own.
- **A Windows junction arrives as a symlink dirent.** `Dirent.isSymbolicLink()` is `true`
  for junctions because they are reparse points. That means the symlink branch already
  handles them and a junction escaping the jail root is omitted by the same containment
  test — but only if the branch is written against `isSymbolicLink()` and not against a
  POSIX-only mental model.
- **`realpath` on every symlink costs a syscall.** In a home directory with a handful of
  links this is nothing. In a directory that is mostly symlinks it doubles the syscall count.
  Accepted: the alternative is `lstat` plus `stat` plus a manual containment walk, which is
  strictly more work.
- **Per-entry failures must never fail the listing** (§5.3, NFR-5). Swallow, log at `debug`,
  omit. A home directory on a corporate Windows machine routinely contains entries the user
  cannot stat (`AppData\Local\Application Data` is a permission-denied reparse loop), and a
  listing that throws for the whole home folder because of one of them is unusable. Note
  that `AppData` itself is on the hidden-name list, which mitigates but does not eliminate
  this.
- **The libuv threadpool is 4 threads by default.** All of `fs.promises`' work happens
  there. An unbounded `Promise.all` over 10 000 `stat` calls does not go faster than a
  bounded 64 — it just allocates 10 000 pending promises and risks `EMFILE`. The bounded
  pool is the right shape.
- **`counts` is pre-truncation per spec §5.3** (§4.2 step 7). It is the only field in the
  response whose relationship to `entries` is not one-to-one, so it is the field a future
  reader will question. The pinning test and the JSDoc exist for them.
- **`showHidden` in the explorer also governs whether hidden images are played**
  (§16.1 A6). That coupling is realised in the scan service (epic E6) by reusing
  `isHiddenName` from this module. Export it with that consumer in mind.
- **§16.2 item 3** notes that limits and defaults are expected to be tuned after measuring
  on a real folder. `STAT_CONCURRENCY` (in `concurrency.ts`) is the tunable shared by this
  ticket, T013 and T018; keep it a named constant with a comment rather than an inline
  literal.
- **Symlink semantics are binding spec text (FR-2.1):** classified by target kind, image-ness
  from the link's own name, folder links followed while the real target is inside the jail.
  The listing never rewrites a symlinked folder's path: its `path` is `wireDir/<link name>`.
