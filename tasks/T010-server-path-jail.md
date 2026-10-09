# T010 — Implement `resolveSafe` path containment

**Epic:** E4 — Path jail
**Spec sections:** §3.1, §3.2, §3.3, §12.1, NFR-7
**Depends on:** T008, T009
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based slide-show application. Its server reads images
from the user's own disk and is deliberately confined to a single directory tree — the
user's home folder — called the **jail root**. This ticket implements the one function that
enforces that confinement: `resolveSafe`, which turns an untrusted, client-supplied
relative path into a verified absolute path, or throws a typed API error.

Every file-system-touching route in the application — directory listing, recursive image
scan, original-image streaming, thumbnail generation — obtains its absolute path
exclusively through this function. It is the single most security-critical module in the
codebase, and the reason the rest of the server can treat an absolute path as trustworthy.
Specification §3.3 states the algorithm as eight numbered steps; this ticket implements them
verbatim and covers them with the full test matrix of §12.1.

## 2. Scope

### In scope

- `server/src/security/jail.ts` containing:
  - `setJailRoot(absolute: string): void` and `getJailRoot(): string` — the cached,
    realpath'd jail root set once at startup by the bootstrap.
  - `resolveSafe(relPath: string): Promise<string>` — the eight-step §3.3 algorithm.
  - `toWirePath(absPath: string): string` — the inverse transform back to a POSIX wire path.
  - `isWirePathAcceptable(relPath: string): boolean` — the pure, synchronous steps 1-4.
  - `isContained(real: string, root: string): boolean` — the pure step 7 comparison, exported
    so the volume-root edge case is unit-testable without a file system.
  - `assertDirectory(absPath: string): Promise<Stats>` and
    `assertFile(absPath: string): Promise<Stats>`.
  - `mapFsError(err: unknown): ApiError` — the shared `EACCES`/`EPERM`/`ENOENT` mapping.
- The complete §12.1 unit-test matrix for the jail, including symlink escape and symlink
  containment cases and Windows junction cases.

### Out of scope

- The Express app factory, middleware, guards and error envelope — **T008** owns those; the
  `ApiError` class is consumed here unchanged.
- Resolving the jail root from `SLYDR_ROOT` / `os.homedir()`, validating it at startup, and
  calling `setJailRoot` — **T009** owns `server/src/index.ts` and
  `server/src/bootstrap/resolveRoot.ts`. This ticket owns only the cache and the accessors.
- Directory listing, classification, sorting, hidden filtering — **T011**.
- The `/api/fs/root` and `/api/fs/list` routes — **T012**.
- The recursive image scan (`/api/fs/images`), original streaming (`/api/image`) and
  thumbnails (`/api/thumb`) — later tickets in epics E6–E8. They all consume `resolveSafe`.
- The repository-wide fixture-tree generator script — **T037**. This ticket builds its own
  temporary fixtures inline with `fs.mkdtemp`.

## 3. Prerequisites and assumed state

**From T001 — monorepo scaffold:** npm workspaces monorepo with `shared/`, `server/`,
`client/`; a root `tsconfig.base.json`; `"type": "module"` (ESM) throughout; TypeScript
`strict`; `engines.node` is `>=22`; Express 5 installed in `server/`.

**From T002 — tooling:** ESLint 9 flat config, Prettier, Vitest with the `node` environment
for `server`, Supertest. `npm test`, `npm run lint` and `npm run typecheck` work.

**From T004 — `@slydr/shared`,** importable as `@slydr/shared` (via `shared/dist`). This
ticket consumes only the `ApiErrorCode` type (the 12 codes of specification §3.5). The pure
POSIX wire-path helpers of T007 (`wireJoin`, `wireParent`, …) perform no file-system access;
they are the right tool for building response `path` fields but are **not** a substitute for
any step below.

**From T008 — server core:**

```ts
// server/src/middleware/errorEnvelope.ts
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, message?: string, cause?: unknown); // cause = inherited Error.cause
}
export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>>;
```

with the §3.5 status mapping already in place:
`INVALID_PATH` 400, `INVALID_PARAM` 400, `OUTSIDE_ROOT` 403, `FORBIDDEN_HOST` 403,
`NOT_FOUND` 404, `NOT_A_DIRECTORY` 400, `NOT_A_FILE` 400, `ACCESS_DENIED` 403,
`UNSUPPORTED_IMAGE` 415, `THUMBNAIL_FAILED` 500, `READ_FAILED` 500,
`METHOD_NOT_ALLOWED` 405. T008 also fixed the rule that **no raw OS error message, `errno`
or absolute path may appear in a response body**, which is why `resolveSafe` throws
`ApiError` with fixed messages and stashes the original error in `cause` for the logger
only.

**From T009 — bootstrap and logging:** `server/src/index.ts` resolves the jail root through
`fs.realpath.native` at startup (refusing to start when it is missing, is not a directory, or
cannot be enumerated) and calls `setJailRoot(resolvedRoot.absolute)` before
`createApp`. T009 may have created a minimal stub of `server/src/security/jail.ts`
containing only `setJailRoot`; replace it with the full module described here, keeping that
signature intact. `server/src/logger.ts` exports `createLogger` and `errorFields`; this
module does not log — it throws, and the route or the error envelope logs.

## 4. Implementation detail

### 4.1 The wire-path contract (§3.2)

Every path crossing the API is **POSIX-style, forward-slash, relative to the jail root** —
never absolute, never platform-specific.

- `""` (the empty string) denotes the jail root itself.
- `"Pictures/2024/summer"` denotes `<root>/Pictures/2024/summer` on every OS.
- The client never constructs an absolute path and never sees one, with the single exception
  of the display-only `absoluteRoot` string returned by `GET /api/fs/root` (owned by T012).

`resolveSafe` converts wire → absolute. `toWirePath` converts absolute → wire. Nothing else
in the server may do either conversion by hand.

### 4.2 The cached jail root

```ts
let jailRoot: string | null = null;

/**
 * Set once at startup by the bootstrap (T009) with an already-realpath'd absolute path.
 * Calling it twice with different values is a programming error.
 */
export function setJailRoot(absolute: string): void;

/** Throws if the root has not been set. */
export function getJailRoot(): string;

/** Test-only: clears the cached root. */
export function resetJailRootForTests(): void;
```

Rules:

1. `setJailRoot` requires `path.isAbsolute(absolute)`; throw a plain `Error` otherwise. This
   is a programmer error, not a request error, so it must not be an `ApiError`.
2. Normalise by stripping a trailing separator **except** when the path *is* a root
   (`/` on POSIX, `C:\` on Windows). Store the normalised value.
   *Decision (not specified):* normalising here means the containment check in step 7 has
   exactly one shape to reason about. `path.resolve` would also collapse the separator, but
   it is not idempotent for the volume-root case on Windows, so handle that explicitly.
3. Calling `setJailRoot` a second time with a *different* path throws. Calling it with the
   same path is a no-op. This prevents a half-initialised second root in a test that forgot
   to reset.
4. `getJailRoot()` throws `new Error('Jail root has not been initialised.')` when unset,
   which turns an initialisation-order mistake into an immediate, loud failure rather than
   a request served from an undefined root.
5. The root is resolved through `fs.realpath` exactly once, at startup, by T009 (§3.1).
   `resolveSafe` must **not** re-realpath the root on every call; that would add a syscall
   per request to the hot listing path and NFR-2 gives the whole listing operation a 500 ms
   budget.

### 4.3 `resolveSafe` — the eight steps of §3.3, verbatim

```ts
export async function resolveSafe(relPath: string): Promise<string>;
```

Implement the following in exactly this order. The numbered list is the specification's own
numbering and must be traceable one-to-one in the code; put the step number in a comment on
each block.

1. **Reject if the input contains a NUL byte (`\0`) → `400 INVALID_PATH`.**
   Test with `relPath.includes('\0')`. This must be the first check, before any length or
   pattern test, because a NUL in a path is how a caller attempts to truncate a filename in
   a C-level API. Node itself throws `ERR_INVALID_ARG_VALUE` for a NUL in a path, but
   catching it here produces the correct typed error instead of a 500.
2. **Reject if the input is longer than 4096 characters → `400 INVALID_PATH`.**
   `relPath.length > 4096`. Measure the JavaScript string length (UTF-16 code units), not
   the byte length — the specification says "characters" and the string length is the cheap,
   deterministic reading. Note that Windows has a 260-character `MAX_PATH` limit by default;
   that is a separate, OS-enforced constraint which surfaces as `ENAMETOOLONG`/`ENOENT` from
   `realpath` and is handled in step 6, not here.
3. **Reject if the input starts with `/` or matches a Windows absolute/UNC pattern
   (`^[A-Za-z]:`, `^\\\\`) → `400 INVALID_PATH`.**
   Implement all three tests **on every platform**, not only on Windows. A POSIX server must
   still reject `C:\Windows\System32` and `\\server\share`, because those strings would
   otherwise be treated as ordinary relative segments and could produce a confusing path on
   disk. The patterns, as regular expressions:

   ```ts
   const STARTS_WITH_SLASH = /^\//;
   const WINDOWS_DRIVE = /^[A-Za-z]:/;
   const WINDOWS_UNC = /^\\\\/;      // two literal backslashes
   ```

   *Decision (not specified):* **on Windows only** (`path.sep === '\\'`), also reject any
   backslash anywhere in the input (this subsumes a leading single backslash, which is a
   drive-relative absolute path). The wire format is POSIX-only (§3.2), and on Windows
   `path.join` interprets a backslash as a separator — meaning `"a\\..\\..\\b"` would slip
   past the `..` segment check in step 4, which splits on `/` only. **This is a real bypass
   on Windows and the rejection is mandatory there, not cosmetic.** Use `INVALID_PATH`.
   On POSIX a backslash is an ordinary filename character (`a\b` is a legal name that the
   listing will show), so it is **not** rejected there; only the spec's leading-`\\` UNC
   pattern above applies on every platform.
4. **Split on `/`; reject any segment equal to `..` → `403 OUTSIDE_ROOT`. Drop empty and
   `.` segments.**

   ```ts
   const segments = relPath.split('/');
   for (const segment of segments) {
     if (segment === '..') throw new ApiError('OUTSIDE_ROOT');
   }
   const kept = segments.filter((s) => s !== '' && s !== '.');
   ```

   Note the deliberate asymmetry: `..` is `403 OUTSIDE_ROOT` (an escape *attempt*), while a
   malformed or absolute input is `400 INVALID_PATH`. Preserve it — the test matrix and the
   §12.4 e2e security test both assert on `OUTSIDE_ROOT` for a traversal.
   Do **not** try to be clever and allow `..` that happens to stay inside the root. A
   blanket rejection is auditable; a net-depth calculation is not, and the client never
   needs `..` because it always holds a full wire path.
   Do **not** add extra rules for segments such as `...`: they are legal, listable POSIX
   names, and every extra rejection creates an entry the explorer shows but cannot open.
5. **Join the remaining segments onto the jail root with `path.join`.**

   ```ts
   const joined = path.join(getJailRoot(), ...kept);
   ```

   Use `path.join`, not `path.resolve` and not string concatenation. `path.join` normalises
   separators for the host platform, which is what makes the single wire format work on all
   three OSes (NFR-1). When `kept` is empty the result is the jail root itself.
6. **`fs.realpath` the result. On `ENOENT` → `404 NOT_FOUND`.**

   ```ts
   let real: string;
   try {
     real = await fs.realpath.native(joined);
   } catch (err) {
     throw mapFsError(err);
   }
   ```

   `mapFsError` (§4.5) maps `ENOENT` and `ENOTDIR` to `404 NOT_FOUND`, `EACCES`/`EPERM` to
   `403 ACCESS_DENIED`, `ENAMETOOLONG` and `EINVAL` to `400 INVALID_PATH`, and everything
   else to `500 READ_FAILED`.
   `ENOTDIR` arises when an intermediate component is a file, e.g. `photo.jpg/sub`. Mapping
   it to `404` rather than `400 NOT_A_DIRECTORY` is correct: the requested *target* genuinely
   does not exist. `NOT_A_DIRECTORY` is reserved for the case where the target exists but is
   the wrong kind (see `assertDirectory`).
   Use **`fs.realpath.native`**, the same function T009 uses for the root. Verified on
   Windows 11 / Node 24: `fs.realpath('c:/users/peterkin/documents')` returns the path in
   the casing it was given, while `fs.realpath.native` returns the canonical
   `C:\Users\PeterKin\Documents`. Only the native variant also expands `8.3` short names and
   resolves junctions and other reparse points to their canonical target, which is exactly
   what makes the step 7 comparison reliable on Windows. The error codes that matter
   (`ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, `ELOOP`) are the same for both variants and are
   handled by `mapFsError`.
7. **Verify the real path equals the real jail root or starts with the real jail root plus
   `path.sep`. Otherwise → `403 OUTSIDE_ROOT`.**

   ```ts
   const root = getJailRoot();
   const contained = real === root || real.startsWith(root + path.sep);
   if (!contained) throw new ApiError('OUTSIDE_ROOT');
   ```

   **This step is what defeats symlinks, junctions and reparse points pointing outside the
   home directory**, and it is the reason the realpath in step 6 is not optional. The
   `+ path.sep` is not decoration: without it, a sibling directory named
   `C:\Users\PeterKinEvil` would pass a bare `startsWith('C:\\Users\\PeterKin')` test.
   *Decision (not specified):* compare case-sensitively on all platforms. Windows and
   default macOS file systems are case-insensitive, but both sides of this comparison come
   from `fs.realpath.native` on the *same* machine (the root at startup in T009, the target
   here), and the native variant returns the on-disk casing, so their casing agrees.
   Introducing a case-insensitive compare would be a widening of the check for no benefit.
   Add a comment recording this reasoning, because it looks like an oversight otherwise.
   (This is only true for the native variant; with the plain JS `fs.realpath` a junction
   target spelled in a different case would be wrongly rejected.)
   Handle the volume-root edge case: when the jail root is `C:\` or `/`, `root + path.sep`
   becomes `C:\\` or `//`, which no real path starts with. Guard it: if `root` already ends
   with `path.sep`, compare against `root` directly rather than `root + path.sep`. A jail
   root of `/` or `C:\` is pathological but reachable via `SLYDR_ROOT` in a test.
8. **Return the verified absolute path.**

**The non-negotiable rule:** *every route obtains its absolute path exclusively through
`resolveSafe`. String concatenation of user input into a path anywhere else in the server is
a defect* (§3.3, final paragraph). Put that sentence as the module's header comment. Any
later ticket that needs an absolute path calls `resolveSafe`; none of them may call
`path.join(root, …)` with request data.

#### The synchronous front half, exported: `isWirePathAcceptable`

Steps 1-4 are pure string checks. Export them as a separate function so the listing service
(T011) can reuse the exact same rules:

```ts
/** True when steps 1-4 of resolveSafe would not reject `relPath`. No I/O. */
export function isWirePathAcceptable(relPath: string): boolean;
```

`resolveSafe` calls the same internal check (throwing the specific `ApiError` for each
failure) and `isWirePathAcceptable` returns `false` instead of throwing. Purpose: because the
spec's step 3 rejects some strings that are legal POSIX names (a top-level entry named
`C:backup`, or `\\x`; on Windows nothing legal is affected because those names cannot
exist), T011 must **omit** from listings any entry whose wire path
`isWirePathAcceptable` rejects, so the explorer never shows a folder it cannot open (spec
§3.3 note). This costs nothing per entry (no syscall).

### 4.4 `toWirePath`

```ts
/**
 * The inverse of resolveSafe's path construction: an absolute path inside the jail root
 * becomes a POSIX wire path relative to that root. The jail root itself becomes "".
 */
export function toWirePath(absPath: string): string;
```

Algorithm:

1. `const rel = path.relative(getJailRoot(), absPath);`
2. If `rel === ''`, return `''` — this is the jail root.
3. If `rel === '..'`, or `rel` starts with `'..' + path.sep`, or `path.isAbsolute(rel)`, the
   input was not inside the root: throw a plain `Error` (a programmer error, not a request
   error — a caller only ever passes a path that already came from `resolveSafe`). Do **not**
   test `rel.startsWith('..')`: a folder named `..cache` or `...` is a legal name inside the
   root and must convert normally.
4. Convert separators: `rel.split(path.sep).join('/')`. On Windows `path.relative` returns
   backslashes, so **every backslash must become a forward slash**; on POSIX the operation
   is a no-op. Implement it as `rel.replaceAll('\\', '/')` guarded by platform, or more
   robustly as the split/join on `path.sep` shown above — prefer the split/join so the
   function behaves identically when a test stubs `path`.
5. Do not URL-encode. The wire path is a JSON string value, not a URL component; encoding is
   the HTTP client's job.

`toWirePath` is pure and synchronous apart from reading the cached root, so it is safe to
call once per directory entry inside the listing hot loop (T011).

Round-trip property: for any wire path `w` that resolves successfully and whose target is
not reached through a symlink, `toWirePath(await resolveSafe(w)) === w` after empty and `.`
segments are dropped. The property does **not** hold through a symlink — `resolveSafe`
returns the link's *target*, so the wire path comes back as the target's location. That is
intended and must be asserted in a test so nobody later "fixes" it.

### 4.5 `mapFsError`, `assertDirectory` and `assertFile`

```ts
/** Translates a Node fs error into the typed ApiError the envelope understands. */
export function mapFsError(err: unknown): ApiError;

/** Resolves to the Stats when absPath is a directory; throws 400 NOT_A_DIRECTORY otherwise. */
export async function assertDirectory(absPath: string): Promise<import('node:fs').Stats>;

/** Resolves to the Stats when absPath is a regular file; throws 400 NOT_A_FILE otherwise. */
export async function assertFile(absPath: string): Promise<import('node:fs').Stats>;
```

`mapFsError` mapping table — implement exactly this:

| Node `err.code` | `ApiErrorCode` | HTTP |
|---|---|---|
| `ENOENT` | `NOT_FOUND` | 404 |
| `ENOTDIR` | `NOT_FOUND` | 404 |
| `EACCES` | `ACCESS_DENIED` | 403 |
| `EPERM` | `ACCESS_DENIED` | 403 |
| `ELOOP` | `NOT_FOUND` | 404 |
| `ENAMETOOLONG` | `INVALID_PATH` | 400 |
| `EINVAL` | `INVALID_PATH` | 400 |
| anything else, or no `code` | `READ_FAILED` | 500 |

Notes on the mapping:

- **`EACCES`/`EPERM` → `403 ACCESS_DENIED`** is required by §5.3 for the directory itself
  and by the §3.5 table generally. Windows commonly reports `EPERM` where POSIX reports
  `EACCES` — both must map to the same code, which is why they share a row.
- `ELOOP` (too many symbolic links) maps to `404 NOT_FOUND` rather than `OUTSIDE_ROOT`:
  nothing escaped, the target simply cannot be resolved. *Decision (not specified).*
- Always attach the original error as the `ApiError`'s `cause` so T009's logger can record
  `errno`, `syscall` and the absolute path. Never let any of that reach a response body.
- `mapFsError` must tolerate a non-`Error` value (a thrown string, `null`, `undefined`) and
  return `READ_FAILED` for it.

`assertDirectory` / `assertFile` behaviour:

1. `const stats = await fs.stat(absPath);` — wrap in `try/catch` and rethrow
   `mapFsError(err)`.
2. `assertDirectory`: `stats.isDirectory()` or throw `new ApiError('NOT_A_DIRECTORY')`
   (**400**).
3. `assertFile`: `stats.isFile()` or throw `new ApiError('NOT_A_FILE')` (**400**).
   `isFile()` is true only for regular files, so sockets, FIFOs, block and character devices
   all fail it, which matches FR-2.2's intent.
4. Because `absPath` always comes from `resolveSafe`, it has already been realpath'd — so
   `fs.stat` (which follows symlinks) and `fs.lstat` would agree. Use `fs.stat`.
5. Return the `Stats` object so callers do not need a second syscall for `size` and
   `mtimeMs`. This matters for `/api/thumb`, whose cache key is built from `mtimeMs` and
   `size` (§5.6).

### 4.6 Cross-platform notes

| Concern | win32 | darwin | linux |
|---|---|---|---|
| `path.sep` | `\` | `/` | `/` |
| Absolute-path forms to reject | `C:\…`, `\\server\share`, `\dir` | `/…` | `/…` |
| `fs.realpath` resolves | symlinks, junctions, mount points, other reparse points, `8.3` short names, drive-letter case | symlinks, firmlinks | symlinks, bind mounts (note: a bind mount is **not** resolved away, see gotchas) |
| Creating a file symlink | needs Administrator **or** Developer Mode | unprivileged | unprivileged |
| Creating a directory junction | unprivileged (`mklink /J`, or `fs.symlink(target, link, 'junction')`) | n/a | n/a |
| Case sensitivity of the real path | insensitive, but `realpath` returns on-disk casing | insensitive by default, same caveat | sensitive |
| Max path length | 260 by default unless long paths are enabled | 1024 per component chain | 4096 |

The containment check works identically on all three because it is performed *after*
`realpath` and uses `path.sep` rather than a hard-coded separator (NFR-1).

## 5. Acceptance criteria

- [ ] `server/src/security/jail.ts` exports `setJailRoot`, `getJailRoot`,
      `resetJailRootForTests`, `resolveSafe`, `isWirePathAcceptable`, `isContained`,
      `toWirePath`, `assertDirectory`, `assertFile` and `mapFsError` with the signatures given
      in §4.
- [ ] Targets and the root are both resolved with `fs.realpath.native` (grep: no plain
      `fs.realpath(` call in `server/src`).
- [ ] Each of the eight §3.3 steps is identifiable in the source by a comment carrying its
      step number, in order.
- [ ] `resolveSafe('')` returns exactly the cached jail root.
- [ ] `resolveSafe` throws `ApiError` with code `INVALID_PATH` (400) for: a NUL byte, a
      4097-character input, a leading `/`, `C:\Windows`, `\\server\share`; and, on Windows
      only, a leading `\` and any input containing a backslash (on POSIX a backslash inside
      a name is allowed).
- [ ] `toWirePath` converts an entry named `..cache` or `...` inside the root (`'..cache'`,
      `'Pictures/...'`) without throwing.
- [ ] `resolveSafe` throws `ApiError` with code `OUTSIDE_ROOT` (403) for any input with a
      `..` segment, including `..`, `../etc`, `a/../../b` and `Pictures/../..`.
- [ ] `resolveSafe` throws `ApiError` with code `NOT_FOUND` (404) for a well-formed path
      that does not exist.
- [ ] `resolveSafe` throws `OUTSIDE_ROOT` for a symlink inside the root whose target is
      outside the root, on every platform where the symlink can be created.
- [ ] `resolveSafe` **succeeds** for a symlink inside the root whose target is also inside
      the root, returning the target's real path.
- [ ] `resolveSafe` throws `OUTSIDE_ROOT` for a Windows **junction** pointing outside the
      root (win32 only).
- [ ] `toWirePath(root)` returns `''`; `toWirePath(path.join(root, 'Pictures', '2024'))`
      returns `'Pictures/2024'` on all three platforms.
- [ ] `toWirePath` throws a plain `Error` (not an `ApiError`) for a path outside the root.
- [ ] `assertDirectory` on a file throws `NOT_A_DIRECTORY` with status 400;
      `assertFile` on a directory throws `NOT_A_FILE` with status 400.
- [ ] `mapFsError` returns `ACCESS_DENIED` for both `EACCES` and `EPERM`.
- [ ] No thrown `ApiError` from this module carries an absolute path or an `errno` in its
      `message`; a test asserts the message is one of the fixed strings and that the detail
      lives in `cause`.
- [ ] `getJailRoot()` throws a clear `Error` when the root was never set.
- [ ] A repository-wide grep confirms that `path.join` and `path.resolve` are never applied
      to a request parameter outside `jail.ts`.

## 6. Tests to write

Per specification §12.1: "`server/security/jail`: `..` traversal, absolute and UNC inputs,
NUL byte, a symlink pointing outside the root, a symlink pointing inside the root (must be
allowed), the root itself, and a non-existent path." The matrix below spells that out as
individual cases plus the cross-platform additions.

All tests live in **`server/test/security/jail.test.ts`** unless stated. Build the fixture
tree inline — **T037 owns the shared repository-wide fixture generator script; do not wait
for it and do not pre-empt it.**

### Fixture setup

```ts
let outsideDir: string;   // a sibling of the jail root, deliberately NOT inside it
let rootDir: string;      // the jail root under test

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'slydr-jail-'));
  rootDir = await fs.realpath.native(path.join(base, 'root'));     // after mkdir
  outsideDir = await fs.realpath.native(path.join(base, 'outside'));
  // root/
  //   Pictures/
  //     2024/
  //       IMG_0001.jpg      (a few bytes)
  //   notes.txt
  //   link-inside   -> root/Pictures/2024          (symlink, 'dir' type)
  //   link-outside  -> outsideDir                  (symlink, 'dir' type)
  //   link-broken   -> root/nope                   (symlink to a missing target)
  //   junction-outside -> outsideDir               (win32 only, 'junction' type)
  setJailRoot(rootDir);
});

afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });
```

`mkdtemp` under `os.tmpdir()` is essential on macOS, where `/var` is a symlink to
`/private/var`: **always `fs.realpath.native` the fixture root before passing it to
`setJailRoot`**, or every containment assertion fails for the wrong reason.

Symlink creation helper:

```ts
async function trySymlink(target: string, link: string, type: 'dir' | 'junction') {
  try {
    await fs.symlink(target, link, type);
    return true;
  } catch (err) {
    // Windows requires Administrator or Developer Mode for symlinks: EPERM/EEXIST.
    return false;
  }
}
```

Cases whose fixture could not be created must **skip gracefully** (`ctx.skip()` inside the
test, or a `describe.skipIf(!symlinksAvailable)`), never fail. A hard failure on an
unelevated Windows developer machine would make the suite unusable there, and §12.4 already
notes the fixture tree carries "a broken symlink where the platform allows".

### Case list

Step 1 — NUL byte:
- `rejects a NUL byte anywhere in the input` — `'a\0b'`, `'\0'`, `'Pictures/2024\0.jpg'` →
  `INVALID_PATH`, status 400.

Step 2 — length:
- `accepts a 4096-character input shape` — a path of exactly 4096 characters composed of
  legal segments; it will resolve to `404 NOT_FOUND`, which proves it passed the length
  gate. Assert the code is `NOT_FOUND`, not `INVALID_PATH`.
- `rejects a 4097-character input` → `INVALID_PATH`.

Step 3 — absolute and UNC:
- `rejects a POSIX absolute path` — `'/etc/passwd'`, `'/'` → `INVALID_PATH`.
- `rejects a Windows drive path on every platform` — `'C:\\Windows\\System32'`, `'c:/Windows'`,
  `'Z:'` → `INVALID_PATH`.
- `rejects a UNC path on every platform` — `'\\\\server\\share\\file.jpg'` → `INVALID_PATH`.
- `rejects a single leading backslash on Windows` — `'\\Windows'` → `INVALID_PATH`
  (`it.runIf(process.platform === 'win32')`). On POSIX the same input is an ordinary
  one-segment name and resolves to `NOT_FOUND` (`it.skipIf(process.platform === 'win32')`).
- `rejects any backslash in the input on Windows` — `'Pictures\\2024'`,
  `'a\\..\\..\\outside'` → `INVALID_PATH` (`it.runIf(process.platform === 'win32')`).
  **This case is the backslash-bypass regression guard; label it as such in the test
  name.**
- `allows a backslash inside a name on POSIX` — create `a\b` in the fixture root
  (`it.skipIf(process.platform === 'win32')`) and assert `resolveSafe('a\\b')` returns it.
- `isWirePathAcceptable agrees with resolveSafe's synchronous rejections` — table-driven over
  every Step 1-4 case in this list: `false` exactly where `resolveSafe` throws
  `INVALID_PATH`/`OUTSIDE_ROOT`, `true` for `''`, `'Pictures/2024'`, `'...'`, `'..cache'`.

Step 4 — `..` and segment hygiene:
- `rejects a bare ..` → `OUTSIDE_ROOT`, status 403.
- `rejects ../etc` → `OUTSIDE_ROOT`.
- `rejects a .. in the middle` — `'Pictures/../../outside'` → `OUTSIDE_ROOT`.
- `rejects a .. that would stay inside the root` — `'Pictures/2024/../2024'` →
  `OUTSIDE_ROOT`. Documents the deliberate blanket rejection.
- `drops empty segments` — `'Pictures//2024'` and `'/Pictures'`… note the latter is caught
  by step 3, so use `'Pictures//2024/'` and `'Pictures/2024//'`; both must resolve to the
  same absolute path as `'Pictures/2024'`.
- `drops . segments` — `'./Pictures/./2024'` resolves to the same path as `'Pictures/2024'`.
- `does not reject dot-only or dot-prefixed names` — `'...'` and `'..cache'` pass steps 1-4
  (they resolve to `NOT_FOUND` when absent, and succeed when a fixture folder of that name
  exists; skip creating them on Windows, where `...` cannot exist).

Step 5/6 — join and realpath:
- `resolves the root itself for the empty string` — `resolveSafe('')` equals `rootDir`.
- `resolves a nested existing directory` — `'Pictures/2024'`.
- `resolves an existing file` — `'Pictures/2024/IMG_0001.jpg'`.
- `maps a missing target to NOT_FOUND` — `'does-not-exist'`, `'Pictures/nope/deeper'` →
  `NOT_FOUND`, status 404.
- `maps ENOTDIR to NOT_FOUND` — `'notes.txt/child'` → `NOT_FOUND`.
- `maps a broken symlink to NOT_FOUND` — `'link-broken'` → `NOT_FOUND`. Skip if the symlink
  could not be created.

Step 7 — containment:
- `rejects a symlink whose target is outside the root` — `'link-outside'` →
  `OUTSIDE_ROOT`, status 403. **This is the NFR-7 symlink-escape test.** Skip gracefully if
  the symlink could not be created on this platform.
- `allows a symlink whose target is inside the root` — `'link-inside'` resolves to
  `path.join(rootDir, 'Pictures', '2024')` (after realpath). Required explicitly by §12.1.
- `rejects a path reached through an outside symlink` — `'link-outside/anything'` →
  `NOT_FOUND` or `OUTSIDE_ROOT` depending on whether the child exists; create a file inside
  `outsideDir` and assert `OUTSIDE_ROOT` for `'link-outside/secret.txt'`.
- `rejects a Windows junction pointing outside the root` — `'junction-outside'` →
  `OUTSIDE_ROOT`. Use `it.runIf(process.platform === 'win32')`. Junctions do **not** require
  elevation, so this case should actually run on the Windows CI leg; if creation still
  fails, skip with a logged reason rather than failing.
- `rejects a sibling directory sharing the root's name prefix` — point `setJailRoot` at a
  root `…/root` while a sibling `…/rootEvil` exists, and assert that a symlink to
  `…/rootEvil` is rejected. This is the `+ path.sep` regression guard.
- `allows the root when the jail root is a volume root` — set the jail root to the
  temporary directory's own drive/volume root only if the environment allows, otherwise
  cover the trailing-separator branch with a focused unit test on the comparison helper
  rather than a real file system. *Decision (not specified):* extract the containment test
  into an exported pure helper `isContained(real: string, root: string): boolean` so this
  edge case is unit-testable without touching disk.

`setJailRoot` / `getJailRoot`:
- `getJailRoot throws before initialisation` — call `resetJailRootForTests()` first.
- `setJailRoot rejects a relative path`.
- `setJailRoot twice with the same path is a no-op; with a different path it throws`.
- `setJailRoot strips a trailing separator but preserves a volume root`.

`toWirePath`:
- `returns the empty string for the root`.
- `converts separators` — table-driven over `['Pictures']`, `['Pictures', '2024']`,
  `['Pictures', '2024', 'IMG_0001.jpg']`, each built with `path.join(rootDir, ...parts)` and
  asserted equal to `parts.join('/')`.
- `throws for a path outside the root`.
- `round-trips a non-symlinked wire path` — property-style over a handful of fixture paths:
  `toWirePath(await resolveSafe(w)) === w`.
- `does not round-trip through a symlink, by design` — `resolveSafe('link-inside')` then
  `toWirePath` yields `'Pictures/2024'`, not `'link-inside'`.

`assertDirectory` / `assertFile`:
- `assertDirectory accepts a directory and returns Stats`.
- `assertDirectory rejects a file with NOT_A_DIRECTORY and status 400`.
- `assertFile accepts a regular file and returns Stats with a numeric size and mtimeMs`.
- `assertFile rejects a directory with NOT_A_FILE and status 400`.
- `assertDirectory maps a vanished path to NOT_FOUND` — delete the target between
  `resolveSafe` and `assertDirectory` to simulate the race NFR-5 cares about.

`mapFsError`:
- table-driven over `ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, `ELOOP`, `ENAMETOOLONG`,
  `EINVAL`, `EMFILE`, a code-less `Error`, a thrown string and `undefined`, asserting the
  resulting `code` and `status`.
- `preserves the original error as cause`.
- `never puts the original message or errno into the ApiError message`.

Permission-denied behaviour:
- `maps an unreadable directory to ACCESS_DENIED` — POSIX only: `fs.chmod(dir, 0o000)` then
  `resolveSafe('locked/child')`. Use `it.skipIf(process.platform === 'win32')` and restore
  the mode in a `finally`, or the temp-directory cleanup fails. Also skip when running as
  root (`process.getuid?.() === 0`), because root bypasses mode bits and the assertion would
  be inverted — CI containers frequently run as root, so this guard is not optional.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on Windows, macOS and Linux.
- [ ] Symlink-dependent and POSIX-permission-dependent cases **skip**, not fail, on
      platforms or privilege levels where their fixtures cannot be created; the CI log shows
      the skip with a reason.
- [ ] The eight §3.3 steps are each traceable to a numbered comment in
      `server/src/security/jail.ts`.
- [ ] The module header carries the sentence: *"Every route obtains its absolute path
      exclusively through `resolveSafe`. String concatenation of user input into a path
      anywhere else is a defect."*
- [ ] NFR-7's path-traversal and symlink-escape cases are each covered by a named automated
      test.
- [ ] README: no change in this ticket (T041 creates the README, including the
      home-directory-only restriction and why, §13.3).

## 8. Notes and gotchas

- **`realpath` before caching, always.** On macOS, `os.tmpdir()` returns `/var/folders/…`
  where `/var` is a symlink to `/private/var`. A test that sets the jail root to the
  non-realpath'd temp directory will see every containment check fail, because `resolveSafe`
  realpaths the *target* and compares it against a root string that still contains the
  symlink. The same class of problem appears on Windows with `8.3` short names
  (`C:\Users\PETERK~1`). T009 already realpaths (native) the production root; the tests must do the
  same for fixtures.
- **The backslash rejection is a genuine bypass fix, not pedantry.** Step 4 splits on `/`
  only. On Windows, `path.join(root, 'a\\..\\..\\x')` normalises the backslashes as
  separators and escapes the root *before* step 6, and `realpath` of the escaped path may
  well succeed — step 7 would then catch it, but only by luck of ordering. Rejecting
  backslashes outright removes the entire class.
- **Do not add a `..`-allowing "normalise then check" shortcut.** `path.normalize('a/../..')`
  gives `'..'`, and reasoning about whether a normalised path stays inside the root is
  exactly the kind of logic that produces CVEs. The specification's blanket rejection is
  intentional.
- **TOCTOU is unavoidable and acceptable here.** Between `resolveSafe` returning and the
  caller opening the file, the path could be replaced with a symlink pointing outside. For a
  single-user, loopback-only, read-only local tool (§1.2) the attacker would already need
  local write access to the user's own home directory, at which point they do not need
  Slydr. Do not attempt `O_NOFOLLOW`-style hardening; do note the reasoning in a comment so
  a future reviewer does not mistake it for an oversight.
- **Bind mounts and `subst` drives are not resolved away.** `fs.realpath` resolves symlinks
  and reparse points, but a Linux bind mount of `/etc` into the home directory, or a Windows
  `subst` drive, presents a genuinely different path that realpath cannot see through. This
  is an accepted limitation: it requires an administrative action by the user on their own
  machine. Record it in a comment next to step 7.
- **Performance.** `resolveSafe` performs exactly one `realpath` syscall. The listing path
  (T011) calls it once per request, not once per entry, and NFR-2's 500 ms budget for a
  2000-entry directory depends on that staying true. Do not add a `stat` here —
  `assertDirectory`/`assertFile` exist so the caller pays for it only when it needs the
  `Stats`.
- **`ERROR_STATUS` is single-sourced in T008.** Do not hard-code `403` or `404` in this
  module; construct `ApiError` by code and let the envelope map the status.
- **Node 22 long paths on Windows.** If a fixture path exceeds 260 characters and long paths
  are not enabled in the OS, `realpath` fails with `ENOENT` and the length test in step 2
  never fires. Keep the fixture tree shallow; the 4096-character test uses a string that is
  rejected before any syscall, so it is unaffected.
