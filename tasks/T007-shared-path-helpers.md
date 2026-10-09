# T007 — Implement POSIX wire-path helpers

**Epic:** E2 — Shared domain package
**Spec sections:** §3.2, §5.3, §7.3, §12.1, §12.6
**Depends on:** T004 (and, through it, T001 and T002)
**Estimated size:** S

---

## 1. Context

Slydr is a locally running, browser-based slide-show application split into an Express API that reads the local file system beneath the user's home directory and a React single-page application that browses that file system, configures a slide show, and plays it. Every path that crosses the HTTP boundary between them is a **wire path**: a POSIX-style, forward-slash-separated string relative to the jail root, never absolute and never platform-specific (specification §3.2). The server resolves a wire path to a real, verified absolute path through `resolveSafe` (§3.3); the client only ever manipulates the wire-path string itself — to build a breadcrumb trail, to construct the "up one level" link, to append a clicked child's name to the current directory, and so on.

This ticket creates the small set of pure, dependency-free functions that both halves of the application use to manipulate that string. They have no behaviour beyond string manipulation: no file-system access, no security check, no knowledge of the jail. Because `@slydr/shared` must be importable unchanged by a Node server and by a browser bundle, these functions must be implemented without `node:path` — a module that imports `node:path` cannot be bundled for the browser without a shim, and this package has none.

## 2. Scope

### In scope

- Create `shared/src/paths.ts` containing:
  - A wire-path normalizer (internal or exported — see §4.1) that collapses duplicate slashes, strips leading and trailing slashes, and drops `.` segments.
  - `wireJoin(base: string, segment: string): string`
  - `wireParent(path: string): string | null`
  - `wireBasename(path: string): string`
  - `wireSegments(path: string): string[]`
  - `breadcrumbSegments(path: string): { label: string; path: string }[]`
- Append `export * from './paths.js';` to `shared/src/index.ts`, as the fourth line of the barrel (see T004 §4.6; the first three lines already export `./types.js`, `./images.js`, and `./config.js` from T005 and T006).
- A test file, `shared/test/paths.test.ts`, covering every function.

### Out of scope

- Any security validation of a wire path — containment, traversal rejection, NUL-byte rejection, length limits. These are the server's `resolveSafe` in `server/src/security/jail.ts` (specification §3.3), owned by **T010**. This ticket's functions must not be mistaken for, or documented as, a safety boundary; §8 below states this explicitly and the doc comments in `paths.ts` must repeat it.
- Converting a wire path to an absolute file-system path, or vice versa. That conversion only ever happens inside `resolveSafe` on the server; `@slydr/shared` has no concept of the jail root's absolute location.
- The React breadcrumb UI component that renders the array `breadcrumbSegments` returns (specification §7.3's collapsing-ellipsis behaviour, keyboard handling, and styling) — a later client ticket. This ticket only produces the data the component consumes.
- `EntryType`, `FsEntry`, and the other response types (`T004`); `IMAGE_EXTENSIONS` and the classification helpers (`T005`); `SlideshowConfig` and `parseConfig` (`T006`).

## 3. Prerequisites and assumed state

This ticket starts from the repository produced by T001, T002, and T004. The following is assumed to exist already and must not be re-created:

- **T001 — npm workspaces monorepo.** Root `package.json` with `"private": true`, `"type": "module"`, npm workspaces `["shared", "server", "client"]`, and `engines.node >= 22`. Root `tsconfig.base.json` with `"strict": true` and related strictness flags (including `noUncheckedIndexedAccess`), extended by each workspace's `tsconfig.json`. `shared/package.json` declares `"name": "@slydr/shared"` and `"type": "module"`. Root scripts `npm run typecheck` and `npm run build` are wired.
- **T002 — lint, format and test tooling.** ESLint 9 flat config at the repository root covering `shared/**/*.ts`, reachable via `npm run lint`. Prettier reachable via `npm run format`. Vitest configured so tests in `shared/test/**/*.test.ts` run in the **node** environment (globals off: import from `'vitest'`), reachable via `npm test`.
- **T004 — shared API contract types.** `shared/src/types.ts` exists and exports, among other things, `EntryType`, `FsEntry`, the endpoint response types, `ApiErrorCode`, and the shared limit constants. `shared/src/index.ts` exists as the package barrel and currently contains (at minimum) `export * from './types.js';`. This ticket does not need any symbol from `types.ts` — the path helpers operate on plain `string` and have no dependency on the types module — but it must not disturb the existing barrel exports, and it appends to the barrel rather than replacing it.

The relevant normative text from the specification, restated here so this ticket is self-contained:

- Specification §3.2 ("Wire path format", FR-SEC-1): "All paths crossing the API are POSIX-style, forward-slash, relative to the jail root — never absolute, never platform-specific. `""` (empty string) denotes the jail root itself. `"Pictures/2024/summer"` denotes `<home>/Pictures/2024/summer` on every OS. The client never constructs an absolute path and never sees one, except a single display-only `absoluteRoot` string returned by `GET /api/fs/root`."
- Specification §5.3 (`GET /api/fs/list`): the response carries `parentPath`, which is `null` when `path` is the jail root — "which is how the UI disables the 'up' control." This is the exact contract `wireParent` must satisfy.
- Specification §7.3 (Breadcrumb): "Segments derived from the wire path, rooted at a 'Home' segment. Each segment is a button navigating to that depth. When the trail exceeds the available width, collapse the middle into an ellipsis button that opens a menu of the hidden segments; always keep 'Home' and the last two segments visible." The collapsing/ellipsis behaviour is UI work for a later ticket; this ticket only produces the ordered `{ label, path }` array the breadcrumb component walks.
- Specification §12.1 (Unit tests, Vitest): "`shared`: `parseConfig` clamping and coercion; image-extension classification; wire-path helpers." This ticket's test file is the "wire-path helpers" item.
- Specification §12.6 (Definition of done per task): "Types live in `shared` where shared; unit tests cover new logic; no new ESLint or `tsc --noEmit` errors; ... README updated when behaviour or setup changes." (The keyboard/screen-reader/theme/viewport clauses in §12.6 are UI-specific and do not apply to this ticket, which produces no UI.)

`shared/src/paths.ts` does not exist yet; this ticket creates it from nothing.

## 4. Implementation detail

### 4.1 File: `shared/src/paths.ts`

This module must contain **no `import` statement of any kind** — no `node:path`, no `node:*` of any kind, no third-party package, and no relative import of another module in this package. Every function in it is a pure string transformation with no side effects, so the module is safe to import unchanged into a Vite-bundled browser app and into the Node server.

Open the file with a module-level doc comment stating the invariants that every function in it relies on and that every caller must honour:

```ts
/**
 * POSIX wire-path helpers (specification §3.2).
 *
 * A "wire path" is the string form every path takes while crossing the
 * Slydr HTTP API: forward-slash separated, always relative to the jail
 * root, and never a platform-specific or absolute path.
 *
 *   - `''` denotes the jail root itself.
 *   - `'Pictures/2024/summer'` denotes `<jail root>/Pictures/2024/summer`
 *     on every OS, including Windows.
 *
 * These functions must never see or produce a Windows path, a drive
 * letter (`C:`), a UNC prefix (`\\server\share`), a backslash separator,
 * or an absolute path of any kind. The one sanctioned exception in the
 * whole system is `RootResponse.absoluteRoot` (specification §3.2, §4
 * — defined in `types.ts`), which is a display-only string that never
 * flows back into any of the functions below.
 *
 * SECURITY NOTE: nothing in this module performs or substitutes for
 * security validation. There is no containment check here, no rejection
 * of `..`, no NUL-byte or length check. Containment is enforced
 * exclusively server-side by `resolveSafe` in
 * `server/src/security/jail.ts` (specification §3.3, ticket T010).
 * Treating any function in this file as a safety boundary is a defect:
 * a crafted wire path must reach `resolveSafe` unmodified so the jail
 * can reject it explicitly, rather than have a client-side helper
 * silently rewrite it into something that looks safe.
 */
```

Implement the normalizer first, as a private (non-exported) helper the other functions build on:

```ts
/**
 * Normalizes a wire path: collapses runs of consecutive slashes into one,
 * strips any leading and trailing slash, and drops `.` segments. Does
 * **not** resolve or reject `..` segments — see the module-level
 * "Decision (not specified)" note below.
 */
function normalizeWirePath(path: string): string {
  if (path === '') return '';
  const segments = path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  return segments.join('/');
}
```

> **Decision (not specified).** The specification states the wire-path *format* (§3.2) but is silent on how a path-manipulation helper should treat a `..` segment it is handed — for example a client bug that calls `wireJoin('Pictures', '..')`, or a crafted value arriving from somewhere other than the server's own `parentPath`/`entries[].path` fields. This ticket's `normalizeWirePath` deliberately preserves `..` segments untouched rather than resolving them (e.g. collapsing `Pictures/../Pictures` to `Pictures`, or `../etc` to `etc`). The alternative — resolving `..` client-side — would make the client's path arithmetic silently "fix" a suspicious path before it ever reaches the server, which is exactly the kind of silent rewriting specification §3.3 and §8 (below) say this layer must never do: a `..` segment is a security-relevant signal that belongs in front of `resolveSafe`'s explicit `403 OUTSIDE_ROOT` rejection (specification §3.3 step 4), not quietly absorbed by a shared string helper that both the server and an attacker-controlled client bundle happen to share. Preserving `..` also keeps `normalizeWirePath` a mechanical, allocation-free function (collapse slashes, trim ends, drop `.` — nothing more) rather than a second, weaker implementation of jail logic that could drift from `resolveSafe` and give a false sense of safety. Every exported function built on top of this normalizer inherits the same behaviour and the same caveat.

Export the normalizer under the name `normalizeWirePath` as well; the client's typed API client (a later ticket) and the test file both need to call it directly, not only indirectly through `wireJoin`.

### 4.2 `wireJoin`

```ts
/**
 * Joins a child segment onto a base wire path, producing a normalized
 * wire path. `segment` may itself contain `/` (e.g. a multi-level
 * relative append) and may be `''`, in which case the result is simply
 * `base` normalized.
 */
export function wireJoin(base: string, segment: string): string {
  if (segment === '') return normalizeWirePath(base);
  if (base === '') return normalizeWirePath(segment);
  return normalizeWirePath(`${base}/${segment}`);
}
```

### 4.3 `wireParent`

```ts
/**
 * Returns the wire path of the parent of `path`, or `null` when `path`
 * is the jail root (`''`) — the jail root has no parent. This mirrors
 * `ListResponse.parentPath` (specification §5.3), which the explorer
 * uses to enable or disable the "up one level" control.
 */
export function wireParent(path: string): string | null {
  const normalized = normalizeWirePath(path);
  if (normalized === '') return null;
  const segments = normalized.split('/');
  segments.pop();
  return segments.join('/');
}
```

Note that a single-segment path (e.g. `"Pictures"`) returns `''` — the jail root — not `null`. `null` is reserved exclusively for the case where `path` already denotes the jail root; see the table in §4.6.

### 4.4 `wireBasename`

```ts
/**
 * Returns the final segment of a wire path — the name a folder or file
 * would show in a directory listing. Returns `''` for the jail root,
 * since the jail root's display name (`RootResponse.name`) is computed
 * server-side from the real directory name, not derived from the wire
 * path.
 */
export function wireBasename(path: string): string {
  const normalized = normalizeWirePath(path);
  if (normalized === '') return '';
  // `.at(-1)` is `string | undefined` under noUncheckedIndexedAccess; it is never
  // undefined here because `normalized` is non-empty.
  return normalized.split('/').at(-1) ?? '';
}
```

### 4.5 `wireSegments`

```ts
/**
 * Splits a wire path into its ordered path segments. Returns `[]` for
 * the jail root.
 */
export function wireSegments(path: string): string[] {
  const normalized = normalizeWirePath(path);
  if (normalized === '') return [];
  return normalized.split('/');
}
```

### 4.6 `breadcrumbSegments`

```ts
/**
 * Builds the ordered list of breadcrumb entries for `path`, for the
 * explorer's breadcrumb trail (specification §7.3). The first entry is
 * always the "Home" root, pointing at the jail root (`''`); one further
 * entry follows per path segment, each `path` being the cumulative wire
 * path up to and including that segment. The caller (a later client
 * ticket) is responsible for the collapsing-ellipsis behaviour described
 * in §7.3 when the trail is wider than the available space; this
 * function only produces the full, uncollapsed trail.
 */
export function breadcrumbSegments(
  path: string,
): { label: string; path: string }[] {
  const segments = wireSegments(path);
  const result: { label: string; path: string }[] = [
    { label: 'Home', path: '' },
  ];
  let cumulative = '';
  for (const segment of segments) {
    cumulative = wireJoin(cumulative, segment);
    result.push({ label: segment, path: cumulative });
  }
  return result;
}
```

### 4.7 Full signatures (summary)

```ts
export function normalizeWirePath(path: string): string;
export function wireJoin(base: string, segment: string): string;
export function wireParent(path: string): string | null;
export function wireBasename(path: string): string;
export function wireSegments(path: string): string[];
export function breadcrumbSegments(
  path: string,
): { label: string; path: string }[];
```

### 4.8 Input/output examples

The implementer must verify every function against this table. "n/a" means the function is not the primary one being exercised by that row but should still behave sensibly on it (see §6 for the full cross-product of cases per function).

| Input | `normalizeWirePath` | `wireBasename` | `wireParent` | `wireSegments` |
|---|---|---|---|---|
| `""` | `""` | `""` | `null` | `[]` |
| `"Pictures"` | `"Pictures"` | `"Pictures"` | `""` | `["Pictures"]` |
| `"Pictures/2024/summer"` | `"Pictures/2024/summer"` | `"summer"` | `"Pictures/2024"` | `["Pictures", "2024", "summer"]` |
| `"/Pictures"` | `"Pictures"` | `"Pictures"` | `""` | `["Pictures"]` |
| `"Pictures/"` | `"Pictures"` | `"Pictures"` | `""` | `["Pictures"]` |
| `"Pictures//2024"` | `"Pictures/2024"` | `"2024"` | `"Pictures"` | `["Pictures", "2024"]` |
| `"./Pictures"` | `"Pictures"` | `"Pictures"` | `""` | `["Pictures"]` |
| `"Pictures/./2024"` | `"Pictures/2024"` | `"2024"` | `"Pictures"` | `["Pictures", "2024"]` |
| `"Pictures/2024/"` (trailing slash) | `"Pictures/2024"` | `"2024"` | `"Pictures"` | `["Pictures", "2024"]` |

For `wireParent` specifically, the single-segment case above (`"Pictures"` → `""`) is the one that must not be confused with the jail-root case (`""` → `null`): the function returns `null` only when its *input*, once normalized, is already `""`.

`wireJoin` examples:

| `base` | `segment` | Result |
|---|---|---|
| `""` | `"Pictures"` | `"Pictures"` |
| `"Pictures"` | `"2024"` | `"Pictures/2024"` |
| `"Pictures"` | `""` | `"Pictures"` |
| `"Pictures/2024"` | `"summer"` | `"Pictures/2024/summer"` |
| `"/Pictures/"` | `"2024"` | `"Pictures/2024"` |

`breadcrumbSegments` examples:

| Input | Result |
|---|---|
| `""` | `[{ label: "Home", path: "" }]` |
| `"Pictures"` | `[{ label: "Home", path: "" }, { label: "Pictures", path: "Pictures" }]` |
| `"Pictures/2024/summer"` | `[{ label: "Home", path: "" }, { label: "Pictures", path: "Pictures" }, { label: "2024", path: "Pictures/2024" }, { label: "summer", path: "Pictures/2024/summer" }]` |

### 4.9 `shared/src/index.ts` — barrel update

Append one line, after the existing `export * from './types.js';` (and, if T005/T006 have already landed, their `./images.js` and `./config.js` lines):

```ts
export * from './paths.js';
```

Follow the relative-import extension convention already established by T004 (`.js` extensions on relative specifiers, per `tsconfig.base.json`'s module resolution mode) — do not introduce a different convention for this module.

### 4.10 Cross-platform notes

This module runs identically on win32, darwin, and linux because it never touches `node:path`, `node:os`, or anything else that varies by platform. There is deliberately no behavioural difference to document per OS: the entire point of the wire-path format (specification §3.2) is that the client-visible path arithmetic is platform-invariant, and this module is where that invariant is implemented. The only platform-sensitive path handling in the whole system is server-side, inside `resolveSafe` (T010), which is explicitly out of scope here.

## 5. Acceptance criteria

- [ ] `shared/src/paths.ts` exists and exports `normalizeWirePath`, `wireJoin`, `wireParent`, `wireBasename`, `wireSegments`, and `breadcrumbSegments` — and nothing else.
- [ ] `shared/src/paths.ts` contains no `import` statement of any kind.
- [ ] `normalizeWirePath('')`, `normalizeWirePath('/Pictures')`, `normalizeWirePath('Pictures/')`, `normalizeWirePath('Pictures//2024')`, `normalizeWirePath('./Pictures')`, and `normalizeWirePath('Pictures/./2024')` all match the table in §4.8.
  - [ ] `wireJoin`, `wireParent`, `wireBasename`, and `wireSegments` all match the table in §4.8 for every row.
  - [ ] `wireParent('')` is `null`; `wireParent('Pictures')` is `''` (not `null`).
  - [ ] `breadcrumbSegments('')` returns exactly one entry, `{ label: 'Home', path: '' }`.
  - [ ] `breadcrumbSegments('Pictures/2024/summer')` returns four entries matching the table in §4.8, in order, each `path` being the cumulative wire path.
  - [ ] A `..` segment passed to any function (e.g. `wireJoin('Pictures', '..')`, `normalizeWirePath('../etc')`) is preserved untouched in the output, not resolved and not rejected.
  - [ ] `shared/src/index.ts` now re-exports `./paths.js` in addition to its existing exports, and `import { wireJoin, breadcrumbSegments } from '@slydr/shared'` resolves.
  - [ ] `npx tsc --noEmit -p shared/tsconfig.json` reports no errors.
  - [ ] `npm test` runs `shared/test/paths.test.ts` and it passes.
  - [ ] `npm run lint` reports no new errors in `shared/src/paths.ts` or `shared/test/paths.test.ts`.

## 6. Tests to write

Specification §12.1 explicitly calls for Vitest coverage of the shared package's "wire-path helpers." All of it lives in one file.

**`shared/test/paths.test.ts`** (import the subject from `'../src/index.js'`; Vitest only discovers `shared/test/**/*.test.ts`)

- `describe('normalizeWirePath')`
  - `it('returns the empty string unchanged for the jail root')`
  - `it('leaves a single-segment path unchanged')`
  - `it('leaves a multi-segment path unchanged')`
  - `it('strips a leading slash')`
  - `it('strips a trailing slash')`
  - `it('collapses duplicate internal slashes into one')`
  - `it('drops a leading "." segment')`
  - `it('drops an internal "." segment')`
  - `it('preserves a ".." segment untouched rather than resolving it')`
  - `it('is idempotent: normalizing an already-normalized path returns the same string')`
  - `it('is idempotent: normalizing the output of a previous normalization of a messy path returns the same string')`
- `describe('wireJoin')`
  - `it('joins a segment onto the jail root')`
  - `it('joins a segment onto a non-root base')`
  - `it('returns the normalized base unchanged when segment is empty')`
  - `it('returns the normalized segment unchanged when base is the jail root')`
  - `it('normalizes slashes contributed by either base or segment')`
- `describe('wireParent')`
  - `it('returns null for the jail root')`
  - `it('returns the jail root for a single-segment path')`
  - `it('returns the immediate parent for a multi-segment path')`
  - `it('normalizes its input before computing the parent, e.g. a trailing slash')`
- `describe('wireBasename')`
  - `it('returns the empty string for the jail root')`
  - `it('returns the whole path for a single-segment path')`
  - `it('returns the final segment of a multi-segment path')`
  - `it('ignores a trailing slash')`
- `describe('wireSegments')`
  - `it('returns an empty array for the jail root')`
  - `it('returns a single-element array for a single-segment path')`
  - `it('returns an ordered array for a multi-segment path')`
  - `it('collapses duplicate slashes and drops "." segments before splitting')`
- `describe('breadcrumbSegments')`
  - `it('returns only the Home root segment for the jail root')`
  - `it('returns Home followed by one entry per segment for a three-segment path, each with the cumulative wire path')`
  - `it('uses the raw segment name as the label for every non-root entry')`

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] `shared/src/paths.ts` exists, contains no `import` statement, and is exported from `shared/src/index.ts`.
- [ ] `@slydr/shared` still declares zero runtime dependencies.
- [ ] A scratch `import { wireJoin, wireParent, wireBasename, wireSegments, breadcrumbSegments } from '@slydr/shared'` compiles from inside both `server/` and `client/`; the scratch file is deleted afterwards.
- [ ] README updated if setup or user-visible behaviour changed (not expected for this ticket).

## 8. Notes and gotchas

- **This module is not a security boundary.** Repeating the module-level doc comment's warning here because it is the single most important fact about this ticket: nothing in `paths.ts` validates, rejects, or sanitizes anything. It does not reject `..`, does not reject a NUL byte, does not reject an absolute-looking input, and does not know what the jail root's real location is. All of that is `resolveSafe`'s job (specification §3.3, T010), running server-side against the real file system. Any later code review that finds a call to `normalizeWirePath` or `wireJoin` being used as a guard before a file-system operation should treat that as a defect in the caller, not evidence that this module needs strengthening.
- **`..` is preserved, not resolved — restated.** See the "Decision (not specified)" note in §4.1 for the full justification. The practical consequence for implementers of later tickets: if the explorer ever constructs a wire path from user-adjacent input (it currently does not — paths come only from the server's own `entries[].path`, `parentPath`, and `images[].path`/`dir` fields), a `..` segment will survive unchanged all the way to the API call, and the server will reject it with `403 OUTSIDE_ROOT`. That round trip is intentional.
- **`wireParent('')` vs. `wireParent('Pictures')`.** These are easy to conflate. Only the former is `null`. The explorer's "up one level" control must check specifically for `null`, not for falsiness or for an empty string, exactly mirroring how `ListResponse.parentPath` behaves (specification §5.3).
- **No `node:path`, ever.** It is tempting to reach for `path.posix.join`, `path.posix.dirname`, or `path.posix.basename` here, since they would correctly implement most of this ticket's behaviour. Do not: importing anything from `node:path` — even `path.posix`, which is pure string logic with no OS calls — reintroduces a Node-specific dependency into a module whose entire purpose is to be bundlable into a browser build with zero shims (specification §2.1's "no runtime dependencies" rule for `@slydr/shared`, restated in T004 §8). Hand-roll the string manipulation, as this ticket's reference implementations in §4 do.
- **Trailing-slash and double-slash inputs are not expected from the server.** The server's own `ListResponse.path` / `parentPath` / `ImageItem.path` / `ImageItem.dir` fields are already clean, normalized wire paths (they are built from `path.join` server-side and converted once, in T010/T011's listing code, to forward slashes). The normalizer's tolerance of `//`, trailing slashes, and `.` segments exists primarily so that `wireJoin` and the breadcrumb builder are forgiving of client-side construction (e.g. concatenating a clicked folder name onto the current path) and so that the test matrix in §6 has deterministic, documented behaviour — not because the server is expected to send messy paths.
- **Keep the barrel append minimal.** `shared/src/index.ts` should end this ticket with exactly one new line (`export * from './paths.js';`) appended after whatever T004/T005/T006 already left there. Do not reorder or restate the earlier exports.
