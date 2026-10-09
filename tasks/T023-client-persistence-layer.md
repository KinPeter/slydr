# T023 — Implement the validated localStorage persistence layer

**Epic:** E10
**Spec sections:** §6.2, §12.3, NFR-5, §16.1 A1
**Depends on:** T019, T006, T021
**Estimated size:** M

---

## 1. Context

Slydr remembers a handful of user choices between visits: the theme override, the explorer's view mode, whether hidden items are shown, the last folder the explorer was in, and the slide show configuration. All of them live in the browser's `localStorage`, under the `slydr.*` namespace defined in specification §6.2. Because that storage is user-editable, can hold values written by an older or newer build, and can be unavailable altogether (private mode, blocked site data, quota exhaustion), every access has to be defensive.

This ticket builds the single module through which the rest of the client touches `localStorage`: a validating reader and a debounced writer for each key, and an in-memory fallback so the app keeps working within a session when storage is unusable. The application state provider (T024), the theme system (T021, via a small refactor described in section 4.9) and the explorer (T026) all consume this layer rather than calling `localStorage` themselves.

The governing rules, from §6.2 and NFR-5, are: every read goes through a validating parser; a corrupt or stale value degrades to its default silently and never throws or shows an error; every `localStorage` access, including the `window.localStorage` accessor itself, sits inside `try/catch`; and writes are debounced at 250 ms.

## 2. Scope

### In scope

- `client/src/state/storage.ts`: the key table, the validating parsers, the raw read/write plumbing with an in-memory fallback, the 250 ms debounced writer with flush on `pagehide` and on `visibilitychange` to hidden, schema-version handling, and the typed public API (`readTheme`, `writeTheme`, `clearTheme`, `readExplorerPrefs`, `writeExplorerPrefs`, `clearLastPath`, `readConfig`, `writeConfig`, `flushWrites`).
- The `lastPath` shape validation (client-side sanity check only).
- The schema-version migration policy (labelled Decision below).
- A small, behaviour-preserving refactor of T021's `client/src/state/theme.ts` so that `slydr.theme` is read and written through this module (section 4.9).
- A `localStorage` mock helper for tests and the unit tests listed in section 6.

### Out of scope

- The reducer, the `AppStateProvider`, and deciding when to call the writers — **T024**. This ticket only provides the functions.
- The restored-`lastPath` fallback notice ("the folder you last used is no longer available"), which the explorer shows after a `404`/`403` — **T026**. This ticket exposes `clearLastPath()` and nothing flag-like (no "was fallback used" state).
- The pre-paint script `client/public/theme-init.js`, which reads `slydr.theme` with a raw `getItem` before any module loads — **T021**. It is not changed here.
- The typed API client — **T025**.
- Cross-tab synchronisation. Spec §16.1 A1 assumes single-tab use; do not add a `storage` event listener.
- Any UI. This layer shows no errors and renders nothing.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo (`shared/`, `server/`, `client/`), ESM throughout (`"type": "module"`), TypeScript 5.x strict. The client is Vite 7 + React 19, scaffolded in T019 at `client/`, with a dev proxy `/api` to `http://127.0.0.1:4317`. Design tokens exist (T020). The theme system exists (T021) and uses the key `slydr.theme`. Vitest + React Testing Library run in `jsdom` (T002): tests live only under `client/test/`, Vitest globals are **off** (tests import `describe`, `it`, `expect`, `vi` from `'vitest'`), and `client/test/setup.ts` registers `@testing-library/jest-dom/vitest` and runs RTL `cleanup()`. T021 left `client/src/state/theme.ts`, `useTheme.ts` and their tests under `client/test/`, which this ticket must keep green.

`@slydr/shared` (T006 delivers the config part; the rest is already present) exports:

```ts
export interface SlideshowConfig {
  durationSeconds: number;    // integer 1..30
  shuffle: boolean;
  loop: boolean;
  animations: boolean;
  fillEmptySpace: boolean;
  startFullScreen: boolean;
  includeSubfolders: boolean;
}

export const DEFAULT_CONFIG: SlideshowConfig = {
  durationSeconds: 5, shuffle: true, loop: true, animations: true,
  fillEmptySpace: true, startFullScreen: true, includeSubfolders: false,
};

/** Clamps durationSeconds to 1..30 and rounds it; a wrong-typed value (for example
 *  the string "false") is NOT coerced but replaced by that field's default, as is
 *  anything missing. Never throws. */
export function parseConfig(value: unknown): SlideshowConfig;
```

`parseConfig` accepts any input including `null`, strings and arrays and returns a complete valid `SlideshowConfig`. Wire paths are POSIX, forward-slash, relative to the jail root, with `""` meaning the root; the client never constructs absolute paths.

From T021, `client/src/state/theme.ts` currently exports `Theme`, `THEME_STORAGE_KEY`, `DARK_MEDIA_QUERY`, `readStoredTheme`, `writeStoredTheme`, `clearStoredTheme`, `prefersDark`, `resolveEffectiveTheme` and `applyTheme`; the first three storage functions call `window.localStorage` directly inside `try/catch`. `client/public/theme-init.js` reads the key `slydr.theme` directly and expects the stored string to be exactly `light` or `dark` (not JSON-quoted). That raw-string storage format for the theme is therefore fixed.

The persisted key table from spec §6.2 (this is the contract of this ticket):

| Key | Stored string | Default when absent or invalid |
|---|---|---|
| `slydr.schemaVersion` | `1` | On mismatch, treat every other key (except the theme) as absent |
| `slydr.theme` | `light` or `dark` | absent means follow the OS |
| `slydr.explorer.viewMode` | `list` or `grid` | `list` |
| `slydr.explorer.showHidden` | `true` or `false` | `false` |
| `slydr.explorer.lastPath` | wire path | `""` (jail root) |
| `slydr.config` | `SlideshowConfig` as JSON | `DEFAULT_CONFIG`, per field via `parseConfig` |

## 4. Implementation detail

### 4.1 Files

Create:

- `client/src/state/storage.ts`
- `client/test/state/storage.test.ts`
- `client/test/helpers/storageMock.ts` (test helper, section 6)

Modify:

- `client/src/state/theme.ts` (section 4.9)
- `client/test/setup.ts` (add one `afterEach` hook that calls `resetStorageForTests()`)

There is deliberately no generic `usePersisted` hook: nothing in T024 to T030 needs one (the app state provider uses the typed readers and writers below), and a hook with no consumer would only widen the public API.

### 4.2 Constants, types and parsers

```ts
import { DEFAULT_CONFIG, parseConfig, type SlideshowConfig } from '@slydr/shared';

export const SCHEMA_VERSION = 1;
export const WRITE_DEBOUNCE_MS = 250;
export const LAST_PATH_MAX_LENGTH = 4096;

export const STORAGE_KEYS = {
  schemaVersion: 'slydr.schemaVersion',
  theme: 'slydr.theme',
  viewMode: 'slydr.explorer.viewMode',
  showHidden: 'slydr.explorer.showHidden',
  lastPath: 'slydr.explorer.lastPath',
  config: 'slydr.config',
} as const;

export type Theme = 'light' | 'dark';
export type ViewMode = 'list' | 'grid';

export interface ExplorerPrefs {
  viewMode: ViewMode;
  showHidden: boolean;
  lastPath: string;
}

```

`Theme` is defined here and re-exported from `theme.ts`, so that `storage.ts` does not import from `theme.ts` (no circular import).

Pure parsers. Each takes the raw stored string, or `null` when absent, and is exported so tests can use them directly. None may throw.

```ts
export function parseTheme(raw: string | null): Theme | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

export function parseViewMode(raw: string | null): ViewMode {
  return raw === 'grid' ? 'grid' : 'list';
}

export function parseShowHidden(raw: string | null): boolean {
  return raw === 'true';
}

/** Client-side sanity check only; the server's resolveSafe is the authority. */
export function isPlausibleWirePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > LAST_PATH_MAX_LENGTH) return false;
  if (value.includes('\0')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.startsWith('\\\\')) return false;
  if (value.split('/').some((segment) => segment === '..')) return false;
  return true;
}

export function parseLastPath(raw: string | null): string {
  return raw !== null && isPlausibleWirePath(raw) ? raw : '';
}

export function parseStoredConfig(raw: string | null): SlideshowConfig {
  if (raw === null) return { ...DEFAULT_CONFIG };
  try {
    return parseConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

Notes on these:

- The `lastPath` rules mirror the server's `resolveSafe` steps 1 to 4 (NUL, length, absolute or UNC, `..` segment) so an obviously hostile or corrupt value is dropped before it ever becomes a request. The empty string is valid and means the jail root. The check does not normalise the value (no trimming, no collapsing of `//` or `./`); the server drops empty and `.` segments itself. A value that passes can still point to a folder that no longer exists; that is the explorer's concern (T026).
- `parseStoredConfig` always returns a fresh object, never the shared `DEFAULT_CONFIG` reference, so a caller that mutates the result cannot corrupt the defaults.
- Booleans use the exact strings `true` and `false`. Anything else, including `1`, `TRUE` and an empty string, yields `false`.

### 4.3 Storage access and the in-memory fallback

All real access goes through one helper, called fresh each time and never cached, because the accessor itself can throw and storage availability can change (the user can grant or revoke site data while the tab is open):

```ts
function getStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null; // SecurityError when site data is blocked
  }
}
```

Module-level state:

```ts
/** Writes that are scheduled but not yet committed. null means "remove". */
const pending = new Map<string, string | null>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Values that could not be persisted (storage unavailable, quota, setItem threw).
 *  They keep the session consistent: later reads return them. null means "removed". */
const shadow = new Map<string, string | null>();
```

Raw read, in this priority order:

1. If `pending` has the key, return the pending value. This makes a remount within the 250 ms window see the user's latest choice.
2. If `shadow` has the key, return the shadowed value.
3. If the key is not `slydr.theme` and the schema version is incompatible (section 4.5), return `null`.
4. Otherwise try `getStorage()?.getItem(key)`; on any exception or a `null` storage return `null`.

Raw commit (called by the debounce timer and by `flushWrites`), for one key and a `string | null` value:

1. `storage = getStorage()`. If `null`, set `shadow` for the key and return.
2. Inside one `try`: if the key is not `slydr.theme`, run the schema step (section 4.5); then `setItem` (or `removeItem` when the value is `null`); on success delete the key from `shadow`.
3. In the `catch` (quota, `SecurityError`, anything), set `shadow` for the key. Never rethrow, never log. **Decision (not specified):** nothing is logged to the console on these failures either, since §6.2 says to degrade silently and the theme tests of T021 already assert that no console output occurs.

Because `shadow` entries are only read back inside the same page session, the app remains fully functional with storage disabled: the user's choices survive navigation between screens but not a reload, which is the best that can be done.

### 4.4 The debounced writer

```ts
function schedule(key: string, value: string | null): void
```

1. Store the value in `pending`.
2. Clear any existing timer for this key and start `setTimeout(() => commitKey(key), WRITE_DEBOUNCE_MS)`.
3. Install the page-lifecycle listeners once (lazily, on the first call): `window.addEventListener('pagehide', flushWrites)` and `document.addEventListener('visibilitychange', onVisibilityChange)`, where the latter calls `flushWrites()` only when `document.visibilityState === 'hidden'`.

`commitKey(key)` takes the value out of `pending`, deletes the timer entry, and performs the raw commit.

`flushWrites(): void` clears every timer and commits every pending key synchronously. It is idempotent and safe to call with nothing pending.

**Decision (not specified):** debounce per key rather than with one shared timer, so that a fast stream of slider changes to `slydr.config` cannot postpone the write of `slydr.explorer.lastPath`. Each key still coalesces: five changes to the same key within 250 ms produce exactly one `setItem`.

**Decision (spec leaves the mechanism open, flagged "Decision" by the assignment):** flush on `pagehide` and on `visibilitychange` to `hidden`. A debounced write that is still pending when the user closes the tab or switches away would otherwise be lost, and `beforeunload` and `unload` are unreliable (they do not fire on mobile when a tab is discarded). `pagehide` covers close and navigation; `visibilitychange` covers backgrounding on mobile browsers.

The theme is not debounced; see section 4.9.

### 4.5 Schema version and the migration policy

```ts
function isSchemaCompatible(storage: Storage): boolean {
  const raw = storage.getItem(STORAGE_KEYS.schemaVersion); // inside the caller's try
  return raw === null || raw === String(SCHEMA_VERSION);
}
```

Rules:

- **Reads:** when the stored version is present and is not exactly `1`, every key except `slydr.theme` reads as absent, so each reader returns its default. Reads never modify storage. An absent version key counts as compatible: either nothing has been stored yet, or the user cleared only that key, and every value is validated by its parser anyway. **Decision (not specified):** absent means compatible.
- **Writes (the migration):** the first commit of any non-theme key does this, inside the commit's `try`, before its own `setItem`:
  1. Read the stored version. If it is present and not `1`, remove every key in `localStorage` that starts with `slydr.` except `slydr.theme` (iterate a snapshot of `Object.keys` or `storage.key(i)`, collected first and removed afterwards).
  2. If the stored version is not exactly `1`, `setItem('slydr.schemaVersion', '1')`.

  So the version is written on the first write, and a mismatch is resolved by discarding the stale data lazily at that moment.
- **Decision (not specified): stale keys are not deleted on read, only replaced on the next write.** The alternative, deleting eagerly at startup, would destroy data merely because a developer briefly ran another build, whereas lazy replacement loses nothing the user could not already see: while the mismatch exists every read returns defaults anyway. The cost is a few stale bytes lingering until the user changes a setting. A future build that bumps `SCHEMA_VERSION` should add real migration code in `storage.ts` ahead of this purge rather than rely on it.
- `slydr.theme` is exempt from schema-version invalidation. This matches T021, whose pre-paint script cannot validate a second key. A stale but valid `light`/`dark` string is harmless.
- A downgrade (an older build meeting version `2`) will treat everything as absent and purge on first write. That is acceptable for a single-user local app.

### 4.6 Public typed API

```ts
export function readTheme(): Theme | null;
export function writeTheme(theme: Theme): void;     // immediate, not debounced
export function clearTheme(): void;                 // immediate

export function readExplorerPrefs(): ExplorerPrefs;
export function writeExplorerPrefs(patch: Partial<ExplorerPrefs>): void; // debounced per key
export function clearLastPath(): void;

export function readConfig(): SlideshowConfig;
export function writeConfig(config: SlideshowConfig): void; // debounced

export function flushWrites(): void;
export function resetStorageForTests(): void;
```

Behaviour:

- `readExplorerPrefs()` reads the three explorer keys through `parseViewMode`, `parseShowHidden` and `parseLastPath` and returns a complete `ExplorerPrefs`; it never returns a partial object.
- `writeExplorerPrefs(patch)` schedules a write only for the keys present in `patch`. `viewMode` is written as `list`/`grid`, `showHidden` as `true`/`false`, `lastPath` as the string itself. **Decision (not specified):** a `lastPath` that fails `isPlausibleWirePath` is not written at all (the call is a no-op for that key), so a bug elsewhere cannot persist garbage.
- `writeConfig(config)` runs `parseConfig(config)` first, then stores `JSON.stringify` of the result, so out-of-range values can never be persisted even if a caller passes one.
- `clearLastPath()` cancels any pending `lastPath` write, removes it from `shadow`, and immediately calls `removeItem` for the key (in `try/catch`). Afterwards `readExplorerPrefs().lastPath` is `""`. This is what the explorer calls (T026) when a restored path no longer resolves; the explorer, not this module, decides when and shows the notice. There is deliberately no "fallback happened" flag here.
- `resetStorageForTests()` clears every timer and map, removes the page-lifecycle listeners and resets the "listeners installed" flag. It is exported for tests only; production code never calls it.

### 4.7 No generic persisted-state hook

Earlier drafts included a `usePersisted` hook (with `readRaw`, `scheduleWrite` and a `PersistedKey` type). It has no consumer: T024 reads once through `readExplorerPrefs` / `readConfig` and writes through `writeExplorerPrefs` / `writeConfig`. Do not add it, and keep the raw read and the debounce scheduler (`schedule`, section 4.4) module-private. If a later ticket genuinely needs one, it adds the hook then. Nothing in this module subscribes to storage events (§16.1 A1).

### 4.8 Cross-platform and environment notes

- No Node APIs or path separators are involved; this module is browser-only. Reference `window` and `document` only inside functions, never at module top level, so importing the module under Node or during Vitest collection cannot throw.
- Safari private mode historically exposes a `localStorage` that throws on `setItem` (quota 0); this is the quota case and is covered by the shadow map.
- Firefox with cookies blocked throws a `SecurityError` on merely reading `window.localStorage`; this is the accessor case and is covered by `getStorage()`.

### 4.9 Reconciling with T021's theme module (ownership of `slydr.theme`)

**Decision (not specified): `storage.ts` owns the `slydr.theme` key, its string format and its validation; `theme.ts` owns resolution and application (`prefersDark`, `resolveEffectiveTheme`, `applyTheme`) and delegates storage to this module.** `client/public/theme-init.js` remains a deliberate, separately maintained raw reader (it cannot import anything), and its comment already says to keep it in sync with the theme module; add `storage.ts` to that comment.

Theme rules in this layer, all inherited from T021:

- Written synchronously and never debounced (a toggle is one deliberate click, and a debounce risks losing it if the tab closes).
- Exempt from schema-version invalidation (section 4.5).
- Stored as the bare string `light` or `dark`, not JSON.
- Writing or clearing the theme does not stamp or touch `slydr.schemaVersion`.
- With storage unavailable, `writeTheme` records the value in `shadow`, so `readTheme()` returns it for the rest of the session; `useTheme` also holds it in React state, so behaviour is the same as before.

The refactor, which must not change observable behaviour, in `client/src/state/theme.ts`:

1. Remove the local `Theme` type and the key literal; instead `import { readTheme, writeTheme, clearTheme, STORAGE_KEYS, type Theme } from './storage'`.
2. Keep every existing export of `theme.ts` working with the same signature: `export type { Theme }`, `export const THEME_STORAGE_KEY = STORAGE_KEYS.theme`, `readStoredTheme = readTheme`, `writeStoredTheme = writeTheme`, `clearStoredTheme = clearTheme` (as thin wrapper functions or re-exports). `useTheme.ts`, `ThemeToggle` and the existing T021 tests then need no change.
3. Delete the now-duplicated `try/catch` bodies from `theme.ts`.
4. Run the existing T021 suites (`client/test/state/theme.test.ts`, `client/test/state/useTheme.test.tsx`, `client/test/components/ThemeToggle/ThemeToggle.test.tsx`, `client/test/theme-init.test.ts`) unchanged; they must pass. T021 is a declared dependency of this ticket, so `theme.ts` already exists when this ticket starts; the refactor is part of this ticket's scope, not optional.
5. The `followSystemTheme` export of `useTheme` (T021) and its `clearStoredTheme` call keep working through `clearTheme`.

## 5. Acceptance criteria

- [ ] `client/src/state/storage.ts` exports `STORAGE_KEYS` with exactly the six key strings in the section 3 table, `SCHEMA_VERSION` (`1`) and `WRITE_DEBOUNCE_MS` (`250`).
- [ ] With an empty `localStorage`, `readTheme()` is `null`, `readExplorerPrefs()` is `{ viewMode: 'list', showHidden: false, lastPath: '' }` and `readConfig()` deep-equals `DEFAULT_CONFIG`.
- [ ] `readTheme()` returns `null` for any stored value other than the exact strings `light` and `dark`.
- [ ] `readExplorerPrefs().viewMode` is `list` for any value other than `grid`; `showHidden` is `true` only for the exact string `true`.
- [ ] `lastPath` values that are not strings, contain a NUL, exceed 4096 characters, start with `/`, a drive letter (`C:`) or `\\`, or contain a `..` segment read back as `""`; `"Pictures/2024"` and `""` are accepted.
- [ ] `readConfig()` on malformed JSON, on a JSON `null`, and on a hand-edited object such as `{"durationSeconds":999,"shuffle":"yes"}` never throws and returns a valid config in which `durationSeconds` is 30 and `shuffle` is the default.
- [ ] If `window.localStorage` access throws, if `getItem` throws, or if `setItem` throws (including a quota `DOMException`), no function in the module throws and nothing is logged to the console.
- [ ] With storage unavailable, a value written through the module is returned by the next read in the same session.
- [ ] Five `writeExplorerPrefs({ lastPath })` calls within 250 ms result in exactly one `setItem` for `slydr.explorer.lastPath`, carrying the last value, fired 250 ms after the last call.
- [ ] A pending write is committed by a `pagehide` event and by a `visibilitychange` event with `document.visibilityState === 'hidden'`, and is not committed again afterwards.
- [ ] A `visibilitychange` event while the document is visible commits nothing.
- [ ] `writeTheme` and `clearTheme` call `localStorage` synchronously (no timer), and never write `slydr.schemaVersion`.
- [ ] The first debounced non-theme write stamps `slydr.schemaVersion` as `1`.
- [ ] With `slydr.schemaVersion` set to `2` and other keys present, all readers return defaults except `readTheme()`, which still returns the stored theme; storage is not modified by reads.
- [ ] The first write after such a mismatch removes every `slydr.*` key except `slydr.theme`, writes the new value and sets `slydr.schemaVersion` to `1`.
- [ ] `clearLastPath()` removes the key immediately and cancels a pending `lastPath` write.
- [ ] `storage.ts` exports no `usePersisted`, `readRaw`, `scheduleWrite` or `PersistedKey`, and `client/src/state/` contains no `usePersisted.ts`.
- [ ] `client/src/state/theme.ts` imports its storage behaviour from `storage.ts`, retains all its previous exports, and the unchanged T021 test suites pass.
- [ ] No file under `client/src` other than `storage.ts` (and the pre-paint file `client/public/theme-init.js`) references `localStorage`. Verify with `grep -rn "localStorage" client/src --include=*.ts --include=*.tsx` excluding `*.test.*` and `client/test`.

## 6. Tests to write

Per spec §12.3 ("`localStorage` disabled", config persistence and clamping) and NFR-5. Use Vitest fake timers for all timing tests.

All tests of this ticket live under `client/test/` (mirroring `src/`) and import `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` from `'vitest'`; Vitest globals are off.

### Test helper `client/test/helpers/storageMock.ts`

```ts
export interface MockStorageOptions {
  throwOnAccess?: boolean;   // window.localStorage getter throws
  throwOnGet?: boolean;
  throwOnSet?: boolean;
  throwOnRemove?: boolean;
  quotaOnSet?: boolean;      // setItem throws DOMException('QuotaExceededError')
  initial?: Record<string, string>;
}

/** Replaces window.localStorage with an in-memory Storage double and returns
 *  spies plus the backing map. Restores the original in the returned dispose(). */
export function installMockStorage(options?: MockStorageOptions): {
  store: Map<string, string>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  dispose: () => void;
};
```

Implement `throwOnAccess` with `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } })`; restore the original property descriptor in `dispose()`. Throw `new DOMException('denied', 'SecurityError')` from the access/get/remove cases, as a browser with blocked site data does.

`client/test/setup.ts` gets `afterEach(() => { resetStorageForTests(); })` so module state never leaks between tests.

### `client/test/state/storage.test.ts`

```
describe('parsers')
  it('parseTheme accepts "light" and "dark" and rejects "Dark", "midnight", "" and null')
  it('parseViewMode returns "grid" only for the exact string and "list" otherwise')
  it('parseShowHidden returns true only for the exact string "true"')
  it('parseLastPath accepts "" and "Pictures/2024"')
  it('parseLastPath rejects a NUL byte')
  it('parseLastPath rejects a path longer than 4096 characters and accepts one of exactly 4096')
  it('parseLastPath rejects "/etc", "C:\\Users", "C:foo" and "\\\\server\\share"')
  it('parseLastPath rejects "a/../b" and "..", but accepts a segment named "..a" or "a..b"')
  it('parseStoredConfig returns defaults for null, malformed JSON and a JSON null')
  it('parseStoredConfig returns a fresh object, not the DEFAULT_CONFIG reference')

describe('config clamping through parseConfig')
  it('clamps durationSeconds 999 to 30 and 0 to 1')
  it('rounds a fractional durationSeconds to an integer')
  it('replaces non-boolean flags with their defaults, field by field')
  it('keeps valid fields when only one field is invalid')
  it('writeConfig never persists an out-of-range duration')

describe('reads')
  it('returns every default from an empty storage')
  it('reads each key written in valid form')
  it('returns the default for each key holding an invalid value')
  it('never writes to storage during a read')

describe('storage failures')
  it('survives window.localStorage throwing on access, for every read and write function')
  it('survives getItem throwing')
  it('survives setItem throwing a SecurityError')
  it('survives setItem throwing QuotaExceededError and keeps the value for the session')
  it('survives removeItem throwing in clearLastPath and clearTheme')
  it('returns the written value on the next read when storage is unavailable')
  it('logs nothing to console.error, console.warn or console.log in any failure case')
  it('retries persisting after storage becomes available again on the next write')

describe('schema version')
  it('stamps slydr.schemaVersion as "1" on the first debounced write')
  it('does not stamp the version when only the theme is written')
  it('treats an absent version as compatible')
  it('reads defaults for every key except the theme when the version is "2"')
  it('reads defaults when the version is a non-numeric string')
  it('does not modify storage when reading under a mismatch')
  it('removes stale slydr.* keys other than the theme and rewrites the version on the next write')
  it('leaves non-slydr keys untouched during the purge')

describe('debounced writer')
  it('does not write before 250 ms have elapsed')
  it('writes once at 250 ms')
  it('coalesces five rapid writes of one key into one setItem with the last value')
  it('restarts the 250 ms window on each write')
  it('debounces keys independently')
  it('serves a pending value to readers before it is committed')
  it('flushes pending writes on pagehide')
  it('flushes pending writes on visibilitychange when hidden')
  it('does not flush on visibilitychange when visible')
  it('does not write twice after a flush when the timer would later have fired')
  it('flushWrites is a no-op with nothing pending')
  it('installs the page lifecycle listeners only once')
  it('does not write an invalid lastPath')

describe('theme API')
  it('writeTheme writes synchronously with no timer')
  it('clearTheme removes the key synchronously')
  it('readTheme ignores a schema version mismatch')

describe('clearLastPath')
  it('removes the stored key immediately')
  it('cancels a pending lastPath write')
  it('makes readExplorerPrefs().lastPath return ""')
```

### Regression

Run the unchanged T021 suites (`client/test/state/theme.test.ts`, `client/test/state/useTheme.test.tsx`, `client/test/components/ThemeToggle/ThemeToggle.test.tsx`, `client/test/theme-init.test.ts`) after the section 4.9 refactor; all must pass without edits.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] The unchanged T021 test suites still pass after the theme refactor.
- [ ] `grep` check from the acceptance criteria shows no `localStorage` use in `client/src` outside `storage.ts`.
- [ ] Verified manually in a browser with site data blocked (Chrome: block third-party and first-party cookies for localhost; Firefox: strict mode): the app loads and the theme toggle still works for the session, with nothing in the console.
- [ ] Verified manually by setting `slydr.config` to `{"durationSeconds":"abc"}` and `slydr.explorer.lastPath` to `/etc` in dev tools, reloading, and seeing defaults with no error.
- [ ] README: no change; T041 creates the README and already carries the note that preferences live in the browser's local storage and are lost when site data is cleared.

## 8. Notes and gotchas

- **Theme is special.** It is written immediately, stored as a bare string, readable without validating the schema version, and read separately by `client/public/theme-init.js`. Do not route it through the debounced `schedule` writer, and do not JSON-quote it; the pre-paint script compares against the literal strings `light` and `dark`.
- **The `window.localStorage` accessor can throw**, not just its methods. A `try` around only `getItem` is a defect; always go through `getStorage()`.
- **Reads must not write.** Self-healing a corrupt value by rewriting it on read looks tidy but turns every page load in a quota-exhausted browser into a stream of failing writes. Corrupt values are simply ignored, and replaced when the user next changes the setting.
- **Pending values win over stored values** in the module-private raw read. Without this, a component that unmounts and remounts inside the 250 ms window (for example a quick explorer to config to explorer round trip) would briefly rehydrate stale data.
- **Do not cache the "storage is broken" verdict.** It can change during a session, and the shadow map plus retry-on-next-write handles recovery naturally.
- **Flush on `visibilitychange` only for `hidden`**, otherwise returning to the tab would needlessly flush. `pagehide` may fire together with a hidden visibility change; a second flush finds nothing pending and is a no-op.
- **Fake timers and the lifecycle listeners:** `resetStorageForTests()` must remove the `pagehide` and `visibilitychange` listeners, or each test file accumulates handlers and a later `dispatchEvent` flushes state belonging to an earlier test.
- **No cross-tab sync** (§16.1 A1). A second tab last-writer-wins on each key. If that assumption is ever dropped, a `storage` event listener belongs in this module and nowhere else.
- **`lastPath` validation is not security.** It is a sanity filter against corrupt values. The server's `resolveSafe` is the authority, and a value that passes may still return `404` or `403`; the explorer (T026) handles any failure of the restored folder by falling back to the jail root and showing its notice (`clearLastPath()` is available to it, and the stale value is otherwise overwritten the next time the explorer path is written).
- **`isPlausibleWirePath` does not reject a backslash.** A backslash is a legal filename character on POSIX, and the client does not know the platform here. On Windows the server answers such a stored path with `INVALID_PATH`; because the explorer falls back to the root on *any* failure of a restored path, this is harmless. Do not add a platform sniff to this module.
- **`parseConfig` is the only place config rules live.** Do not duplicate the `1..30` clamp here; call it. If `parseConfig` changes, this layer follows automatically.
- **Do not store absolute paths or file names of images.** Only the explorer's wire path and the settings above are persisted; the slide show's playlist and selection are intentionally session-only.
