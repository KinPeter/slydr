# T026 — Build the file explorer screen with list view

**Epic:** E11
**Spec sections:** §7 (FR-14.1, FR-14.2 list half, FR-14.3, FR-14.4, FR-14.5, FR-14.6, FR-14.7, FR-14.8, FR-14.10), §7.3, §6.2, §12.3, NFR-6
**Depends on:** T012, T021, T022, T024, T025
**Estimated size:** L

---

## 1. Context

Slydr is a locally running, browser-based slide show player for images that live in folders on the user's own computer. It has three screens — file explorer, slide show configuration, and slide show player — and this ticket builds the first of them. The explorer is how the user finds and chooses the folder whose images will be played: it lists the contents of a directory beneath the user's home folder, lets the user walk down into subfolders and back up again, and ends with a single primary action, **"Select this folder"**, which hands the current folder to the configuration screen.

This ticket delivers the complete explorer shell (sticky header, scrollable body, sticky footer) and the **list** view mode, which is the default. The grid view mode with lazy thumbnails is a separate ticket, and so is virtualization for very large folders; both build on the structure created here, so the component boundaries described in §4 matter.

## 2. Scope

### In scope

- The screen directory `client/src/screens/Explorer/` with its shell, header, body and footer.
- The sticky header: breadcrumb trail, "up one level" button, a flexible spacer, the image-count chip, the list/grid view-mode toggle, the show-hidden toggle, and the theme switch as the rightmost control.
- The breadcrumb behaviour of spec §7.3, including the collapse-to-ellipsis rule.
- The scrollable body rendering **list view**: one row per entry with a type icon, the name, and a size for images and other files.
- The sticky footer: the primary **"Select this folder"** button with the current folder's name beside it.
- Directory fetching through the typed API client, including opening at the right folder on first run versus later runs (via `useExplorerRestore()`), a local `requestedPath` that separates "the folder being fetched" from "the committed folder in `AppState`", and aborting a pending request when the user navigates again (through `useAbortableRequest`).
- The `ExplorerScrollContext` that hands the scroll element to T027 and T028, and the notices region (restore notice, inline error, truncation notice) that sits **outside** the scroller.
- Single-click highlight versus double-click (and double-tap) folder navigation, with the pointer handlers delegated on the listbox container.
- The show-hidden toggle and its refetch. Hidden entries, when shown, look exactly like all other entries (FR-14.5): no opacity change, no other visual difference.
- The view-mode toggle wired to application state so the choice persists; the grid branch of the body is left as a clearly marked seam for T027.
- Full keyboard operability per FR-14.8, with `role="listbox"` and `aria-activedescendant`.
- All four of the FR-14.10 states: loading skeletons, empty folder, inline retryable error, and the truncation notice.
- Component tests per §12.3.

### Out of scope

- **Grid view, the responsive tile grid, and lazy thumbnail loading — T027.** This ticket renders a seam (`renderBody()`) that T027 fills in; it does not call `/api/thumb` at all.
- **Virtualization with `@tanstack/react-virtual` for folders above 200 entries — T028.** Render every entry directly here. Keep the row markup flat and the row height fixed so T028 can slot a virtualizer in without changing the DOM contract.
- **The slide show configuration screen — T029.** This ticket only performs the `explorer → config` transition; it does not render or validate anything on the configuration screen, and it does not fetch the image list for the player.
- **The slide show player — T030 and later.**
- The `/api/fs/list`, `/api/fs/root` endpoints themselves (T012), the thumbnail endpoint (T017), the base component library (T022), the theme system and `ThemeToggle` (T021), the application state machine (T024), the `localStorage` persistence layer (T023) and the typed API client with `useAbortableRequest` (T025). All of these are consumed, not built.
- Re-sorting or re-filtering entries on the client. The server already does both.
- **End-to-end (e2e) testing is out of scope.**

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** with three packages — `shared/`, `server/` and `client/`. Everything is ESM (`"type": "module"`) and TypeScript in strict mode. The client is **Vite 7 + React 19**, styled with **CSS Modules** over the design tokens in `client/src/styles/tokens.css`. Tests run under **Vitest with React Testing Library** in the `jsdom` environment. Icons come from `lucide-react`.

### `@slydr/shared`

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

export interface ListResponse {
  path: string;
  name: string;
  parentPath: string | null;   // null when path is the jail root
  entries: FsEntry[];          // already sorted by the server
  counts: { folders: number; images: number; files: number };
  truncated: boolean;          // true when the directory held more than MAX_ENTRIES = 10000
}

export interface RootResponse {
  path: string;          // always ""
  name: string;          // e.g. "PeterKin"
  absoluteRoot: string;  // display-only, e.g. "C:\\Users\\PeterKin"
  platform: string;      // e.g. "win32"
}

export interface ImageItem { name: string; path: string; dir: string; size: number | null; mtimeMs: number | null }

export interface ImagesResponse {
  path: string; recursive: boolean; count: number; truncated: boolean; items: ImageItem[];
}

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

export function parseConfig(value: unknown): SlideshowConfig; // never throws
```

`@slydr/shared` also exports POSIX wire-path helpers, including `breadcrumbSegments(path): { label: string; path: string }[]` (T007), which the `Breadcrumb` component (T022) calls itself; this ticket passes it the wire path and does not call it directly.

### The typed API client — `client/src/api/` (T025)

```ts
export class ApiClientError extends Error {   // `ApiError` is an alias; import ApiClientError
  readonly code: ApiErrorCode;  // e.g. 'ACCESS_DENIED'
  readonly status: number;      // e.g. 403; 0 when no response was received
}
export function isAbortError(value: unknown): boolean;

getRoot(signal?: AbortSignal): Promise<RootResponse>;
list(params: { path: string; showHidden?: boolean }, signal?: AbortSignal): Promise<ListResponse>;
getImages(params: { path: string; recursive?: boolean; showHidden?: boolean }, signal?: AbortSignal): Promise<ImagesResponse>;
imageUrl(path: string): string;
thumbUrl(path: string, size?: ThumbSize): string;
fetchThumbnailBlob(path: string, size: ThumbSize, signal?: AbortSignal): Promise<Blob>;

// client/src/api/useAbortableRequest.ts
export function useAbortableRequest(): {
  run: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>; // aborts the previous run; rejects with an abort error if superseded
  cancel: () => void;
};
```

Every call accepts an `AbortSignal`. Error envelopes from the server are converted into `ApiClientError`; a failed network call is `ApiClientError('READ_FAILED', ..., 0)`. An abort rejects with an abort error that `isAbortError` recognises (never an `ApiClientError`). The error codes this screen can receive from `/api/fs/list` are `INVALID_PATH` (400), `INVALID_PARAM` (400), `OUTSIDE_ROOT` (403), `NOT_FOUND` (404), `NOT_A_DIRECTORY` (400), `ACCESS_DENIED` (403) and `READ_FAILED` (500).

### Application state — `client/src/state/` (T024)

```ts
interface AppState {
  view: 'explorer' | 'config' | 'player';
  explorer: { path: string; viewMode: 'list' | 'grid'; showHidden: boolean };
  selection: { path: string; name: string } | null;
  config: SlideshowConfig;
  playlist: ImageItem[] | null;
  notice: string | null;
}

useAppState(): AppState;
useAppActions(): {                       // every function has a stable identity
  navigateExplorer(path: string): void;
  setViewMode(mode: 'list' | 'grid'): void;
  setShowHidden(value: boolean): void;
  selectCurrentFolder(path: string, name: string): void;   // explorer -> config
  goToExplorer(): void; setConfig(patch: Partial<SlideshowConfig>): void; resetConfig(): void;
  setPlaylist(items: ImageItem[] | null): void; startPlayer(): void;
  exitPlayer(opts?: { error?: string }): void; dismissNotice(): void;
};
useExplorerRestore(): { restoredPath: string | null; markRestoreResolved: () => void };
```

The transitions are those of spec §6.1: `explorer → config` on "Select this folder" (which sets `selection` to the current folder), `config → explorer` on "Back to file explorer" (the explorer `path` is deliberately retained), `config → player` on "Play slide show", and `player → config` on stop. This ticket uses `navigateExplorer`, `setViewMode`, `setShowHidden`, `selectCurrentFolder` and `useExplorerRestore`. `navigateExplorer` is guarded by the reducer (only in the explorer view, only for a plausible wire path, only when the path differs) and T024's persistence effect writes `slydr.explorer.lastPath` whenever `explorer.path` changes, so dispatch it **only after a listing has succeeded**.

`useExplorerRestore().restoredPath` is the hydrated `lastPath` (non-empty only) until `markRestoreResolved()` is called; it is how the explorer tells a restored path from one the user navigated to, because `AppState.explorer.path` is always populated at start.

The `localStorage` persistence layer (T023) writes the §6.2 keys, debounced at 250 ms (the theme immediately), through validating readers:

| Key | Value | Fallback |
|---|---|---|
| `slydr.schemaVersion` | `1` | mismatch ⇒ treat all other keys as absent |
| `slydr.theme` | `"light" \| "dark"` | absent ⇒ follow OS |
| `slydr.explorer.viewMode` | `"list" \| "grid"` | `"list"` |
| `slydr.explorer.showHidden` | boolean | `false` |
| `slydr.explorer.lastPath` | wire path | `""` (jail root) |
| `slydr.config` | `SlideshowConfig` JSON | `DEFAULT_CONFIG`, per field |

All `localStorage` access is already wrapped in `try/catch` inside those hooks; the explorer must keep working with storage disabled, which it gets for free by reading state from the provider rather than from storage directly.

### Base components — `client/src/components/`

From T022: `Button` (`primary | secondary | ghost`, `md | lg`), `IconButton` (requires `aria-label`; toggle state via `pressed`), `Checkbox`, `Slider`, `Icon` (takes `icon={...}`), `Breadcrumb` (`path`, `onNavigate`, `rootTitle?`; collapse and ellipsis menu named "Show hidden folders" are built in), `Chip`, `Banner` (variants `info | warning | error`; every variant renders with `aria-live="polite"`; optional `action` and `onDismiss`), `Skeleton`, `Spinner`. From T021: `ThemeToggle` (positioned top-right on the explorer and configuration screens). Check each component's prop types before use; where a prop this ticket needs is missing, extend the base component rather than forking it.

### Wire-path rules

All paths crossing the API are POSIX, forward-slash, and relative to the jail root (the user's home directory). `""` is the jail root. The client never constructs or displays an absolute path, with the single exception of the display-only `absoluteRoot` string from `GET /api/fs/root`. The server sorts entries folders-first and then by name with `new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`, and **the client must not re-sort**.

## 4. Implementation detail

### 4.1 Files

Create:

```
client/src/screens/Explorer/
  Explorer.tsx              screen shell, data fetching, state wiring
  Explorer.module.css
  ExplorerScrollContext.ts  context + useExplorerScroll(): HTMLElement | null
  ExplorerHeader.tsx        breadcrumb, up button, chip, toggles, theme switch
  ExplorerHeader.module.css
  ExplorerNotices.tsx       restore notice, inline error, truncation notice (outside the scroller)
  ExplorerFooter.tsx        "Select this folder" + current folder name
  ExplorerFooter.module.css
  EntryList.tsx             the role="listbox" region and its rows; delegated pointer handlers
  EntryList.module.css
  EntryRow.tsx              a single role="option" row (no event handlers)
  useDirectoryListing.ts    requestedPath + fetch + abort + loading/error state
  useEntryHighlight.ts      highlight index + keyboard navigation
  thumbnailQueue.ts         stub: cancelAllThumbnails() (T027 replaces the contents)
  entryIcon.ts              EntryType -> lucide icon component
  formatBytes.ts            byte-count formatting
  copy.ts                   every user-visible string in one place
  index.ts                  re-exports Explorer
```

Delete the T024 placeholder `client/src/screens/Explorer/index.tsx` in the same change, so module resolution is unambiguous (`index.ts` replaces it). `client/src/App.tsx` already imports the screen from its directory (T024), so it needs no edit.

Tests live under `client/test/screens/Explorer/` (mirroring `src/`; Vitest only discovers `client/test/**`), shared helpers under `client/test/helpers/`. Tests import `describe`, `it`, `expect`, `vi` from `'vitest'`.

Put every user-visible string in `copy.ts` as a named export. The tests assert on these strings, and T027/T028/T029 will not need to touch them.

### 4.2 Layout

Spec §7.1. The screen is a four-row flex column that fills the viewport: header, notices region, body (the scroller), footer.

```css
.screen {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
.header  { flex: 0 0 auto; z-index: 2; background: var(--bg-elevated);
           border-bottom: 1px solid var(--border); }
.notices { flex: 0 0 auto; }              /* empty most of the time; holds the Banners */
.body    { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.footer  { flex: 0 0 auto; z-index: 2; background: var(--bg-elevated);
           border-top: 1px solid var(--border); }
```

The header and footer stay on screen because the body is the only element that scrolls (they are flex siblings of it, not `position: sticky` children; this satisfies "sticky" in spec §7.1 and cannot be broken by an ancestor's `overflow`).

**The body is the only scroll container.** It carries `data-explorer-scroll` (used by the T028 measurement procedure and as a unit/component-test hook). **Banners never live inside it:** the restore notice, the inline error and the truncation notice render in the `.notices` region between the header and the body, so they never scroll with the entries and the entry region always starts at scroll offset 0 (T028 relies on this and has no scroll-margin logic).

`ExplorerScrollContext.ts` exposes the scroll element to descendants:

```ts
export const ExplorerScrollContext = createContext<HTMLElement | null>(null);
export function useExplorerScroll(): HTMLElement | null { return useContext(ExplorerScrollContext); }
```

`Explorer.tsx` holds the body element in **state** (`const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)`, passed as the `ref` callback), not in a ref, so that consumers (T027 `useThumbnail` as the `IntersectionObserver` root, T028 `getScrollElement`) re-render once it mounts. It provides `scrollEl` through `ExplorerScrollContext`.

Header control order, left to right: **breadcrumb trail**, **"up one level" button**, flexible spacer (`flex: 1`), **image-count chip**, **view-mode toggle**, **show-hidden toggle**, **theme switch (rightmost)**. Per §10, below 768 px the header wraps to two rows (breadcrumb on the first, the controls on the second), the breadcrumb collapses aggressively, and the toggles become icon-only; from 768 px it is a single row; at 1024 px and above the toggles show full labels. (Decision (not specified): spec §10 is silent for 768 to 1023 px. This ticket makes the labels visible only from 1024 px, so 768 to 1023 px is a single row with icon-only toggles; T035 must use the same split.) Minimum 16 px side gutter at every width, and no horizontal page scroll down to a 320 px viewport.

**Heading and title.** `Explorer.tsx` renders one visually hidden `<h1>` with the text **"Choose a folder"** (copy.ts `EXPLORER_HEADING`, using the global `.sr-only` class from T020; it is the first child of the header so a screen-reader user hears the screen name before the controls). The screen has exactly one `h1`. The document title and the other landmarks are set by T036.

### 4.3 Opening the right folder (FR-14.1, §6.2)

1. On mount, call `getRoot()` through a **module-level cache** (a `Promise<RootResponse>` kept at module scope and cleared on rejection): `RootResponse` is static for the life of the server, and the explorer remounts on every return from the configuration screen. `name` labels the footer when the current folder is the jail root; `absoluteRoot` is passed to `Breadcrumb` as `rootTitle` (the Home segment's tooltip). Never send either value back to the server.
2. Determine the initial path. `AppState.explorer.path` is **always populated** (T024 hydrates it from `slydr.explorer.lastPath`, `""` when none), so its value alone cannot say whether it was restored. Read `const { restoredPath, markRestoreResolved } = useExplorerRestore()` once on mount: if `restoredPath !== null` the path came from storage and has not been verified yet; if it is `null`, the path is either empty (root) or one the user navigated to (for example when returning from the configuration screen, where §6.1 keeps it) and is used unchanged. Initialise the hook's `requestedPath` (§4.4) to `AppState.explorer.path`.
3. Call `list({ path: requestedPath, showHidden })`.
4. **Fallback (always).** If the first listing of a **restored** path fails with **any** `ApiClientError` (not an abort; for example `NOT_FOUND`, `OUTSIDE_ROOT`, `ACCESS_DENIED`, `NOT_A_DIRECTORY`, `INVALID_PATH`, `READ_FAILED`), set `requestedPath` to the jail root `""`, refetch, and show a one-line dismissible notice in the notices region using the `Banner` component (variant `info`): **"The folder you last used is no longer available. Showing your home folder instead."** (Decision (not specified): exact wording and the fact that the notice is dismissible.) Call `markRestoreResolved()` after the restored attempt succeeds or has fallen back. If the root listing then fails too, show the inline error of §4.9 and stay there. This fallback applies **only** to the restored-path attempt, never to a navigation the user just performed: a failed user navigation shows the inline error of §4.9, reverts `requestedPath` to the committed folder and leaves the user where they are. (Spec §6.2 is amended to "any failure"; a stored folder that has become a file, or a name the server rejects, would otherwise leave the user on an error with no data and a Retry that cannot succeed.)
5. On every **successful** listing, dispatch `navigateExplorer(data.path)` through `useAppActions()` if it differs from `AppState.explorer.path`; T024's persistence effect debounces it to `slydr.explorer.lastPath`. Do not persist a path that failed to load. (`navigateExplorer` is a reducer no-op for a path equal to the current one, so the call is safe on the first load.)

### 4.4 `useDirectoryListing`

```ts
interface DirectoryListingState {
  data: ListResponse | null;        // last successfully loaded listing; survives an error
  loading: boolean;
  error: ApiClientError | null;     // the current, not-yet-retried failure
  requestedPath: string;            // the folder currently being fetched or shown
  navigate: (path: string) => void; // set requestedPath (user navigation)
  fallbackToRoot: () => void;       // used once, for a failed restored path (§4.3 step 4)
  reload: () => void;               // retry requestedPath
}

function useDirectoryListing(initialPath: string, showHidden: boolean): DirectoryListingState;
```

**Two paths, on purpose.** `AppState.explorer.path` is the *committed* folder (persisted, shown in the breadcrumb and used by "Select this folder" via `data.path`); `requestedPath` is local to the hook and is the folder being fetched. The hook fetches `requestedPath`. A double-click only calls `navigate(entry.path)`; the screen dispatches `navigateExplorer(data.path)` once the listing has **succeeded** (§4.3 step 5). When a user navigation fails, `requestedPath` reverts to the last successfully loaded `data.path`, so the highlight, the breadcrumb and a later Retry all refer to the folder still on screen.

Rules:

- Use `useAbortableRequest().run((signal) => list({ path: requestedPath, showHidden }, signal))` for every fetch: it aborts the previous request first, aborts on unmount, and rejects a superseded request even if it had already resolved (so a slow earlier response can never overwrite a later one). This is the spec §6.5 requirement that the explorer aborts a pending `list` when the user navigates again.
- An aborted request is not an error. In the `catch`, `if (isAbortError(err)) return;` (imported from the API client; do not test `instanceof DOMException`, which is realm-specific under jsdom) before touching `loading` or `error`.
- Starting a user navigation (a changed `requestedPath` that is not the first load) calls `cancelAllThumbnails()` so queued and in-flight thumbnail requests do not hold the browser's per-host connections (HTTP/1.1 allows six) while the listing request waits. T027 owns the real implementation in `thumbnailQueue.ts`; this ticket creates that file containing only the stub `export function cancelAllThumbnails(): void {}` with a comment naming T027, and T027 replaces the file's contents. The stub has a one-line test (it does not throw) so the call site is covered now.
- Never discard `data` when a request fails. FR-14.10 requires that the previous folder's content stays visible behind the inline error.
- Clear `error` when a request succeeds, and clear it when the user navigates somewhere else.
- A changed `showHidden` triggers a refetch of the same `requestedPath` (FR-14.5).
- Reset the highlight index to `-1` whenever the committed path changes (not when only `showHidden` changes, where keeping the highlight on the same index is harmless).
- Do not hand the hook an inline callback in its dependency list: `react-hooks/exhaustive-deps` is `error`; use the stable functions from `useAppActions()` and `useAbortableRequest()`.

### 4.5 List rows (FR-14.2 list half, FR-14.3, FR-14.4)

A row is a single column: **type icon**, **name**, and — for `type === 'image'` and `type === 'file'` only — the **size**. Folders show no size at all, not even a dash.

```
[icon]  Holiday 2024                                          (folders: nothing)
[icon]  IMG_0001.jpg                                 4.6 MB
[icon]  notes.txt                                      1.2 KB
```

- Row height: at least 44 px (FR-14.2). Use a fixed `--explorer-row-h: 48px`, raised to `56px` under `@media (pointer: coarse)` for the 48 px touch-target rule of §9.5/§10. (Decision (not specified): the exact values; the spec only sets a 44 px floor. A *fixed* height is deliberate so T028's virtualizer can use an exact `estimateSize` with no dynamic measurement.)
- Icons (FR-14.3): exactly three, from `lucide-react` — `Folder` for folders, `Image` for images, `File` for everything else. **List view always uses icons and never thumbnails**, at any entry count, regardless of the view-mode toggle's history. `entryIcon.ts` maps `EntryType` to the component:

  ```ts
  import { File, Folder, Image } from 'lucide-react';
  export const ENTRY_ICON = { folder: Folder, image: Image, file: File } as const;
  ```

  The icon is decorative; the accessible name of the row is the entry name. Mark the icon `aria-hidden="true"` and convey the type instead through the row's `data-type` attribute and, for screen readers, a visually hidden prefix: `"Folder, "`, `"Image, "`, `"File, "`. (Decision (not specified): the visually hidden type prefix — FR-14.3 requires distinct icons, and NFR-6 requires the distinction to survive without sight.)
- Name: single line, `text-overflow: ellipsis`, `overflow: hidden`, `white-space: nowrap`, plus a `title` attribute carrying the full name so a truncated name is still readable.
- Size: rendered right-aligned, `var(--fg-muted)`, `font-variant-numeric: tabular-nums`. Per §10 the size column is **hidden below 480 px** (`@media (max-width: 479.98px) { .size { display: none } }`; the `.98px` form is the only `max-width` spelling the T035 media-query allowlist accepts, and it avoids a gap on fractional viewports).
- Order: render `data.entries` in the order received. Do not sort, reverse, group or re-filter. The server has already applied folders-first plus the numeric collator (§4.2).

`formatBytes.ts` (Decision (not specified) — the specification does not define a size format):

```ts
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit += 1; }
  const decimals = value < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value)} ${UNITS[unit]}`;
}
```

Base-1024 steps, one decimal below 10 and none above, locale-aware decimal separator. `size === null` renders nothing.

### 4.6 Hidden entries (FR-14.5)

Hidden entries are filtered **server-side**, so they do not reach the browser unless `showHidden=true` is sent. The show-hidden toggle therefore only flips `AppState.explorer.showHidden` (`actions.setShowHidden`; persisted to `slydr.explorer.showHidden` by T024's effect through T023) and lets `useDirectoryListing` refetch.

Hidden entries that arrive because `showHidden=true` are rendered **exactly like every other entry** (FR-14.5): same colours, same opacity, no badge. Do not add any hidden-specific style. Keep the `data-hidden` attribute on the row (it is a unit/component-test hook, not a styling hook) and add a visually hidden `", hidden"` suffix to the row's accessible name so screen-reader users still get the information the sighted user does not. (Decision (not specified).)

The toggle is an `IconButton` (`lucide-react` `Eye` / `EyeOff`, `pressed={showHidden}`, `aria-label="Show hidden items"`). It is a toggle button, not a T022 `Checkbox`: the `Checkbox` is the control of the configuration screen and always shows a text label, while this control must collapse to an icon below 1024 px. From 1024 px a visible text label **"Show hidden items"** is rendered next to the icon (a `<span>` inside the same button, so the accessible name does not change).

### 4.7 Navigation: single click, double click, double tap (FR-14.6)

**Delegated handlers (binding for T026, T027 and T028).** `EntryRow` carries **no** event handlers and no `tabIndex`. `onClick`, `onDoubleClick` and `onPointerUp` are attached **once, on the `role="listbox"` container**, and resolve the target row with `(event.target as Element).closest('[role=option]')`, reading its index from the row's `id` (`slydr-entry-{index}`) or a `data-index` attribute. Reasons: `jsx-a11y` (enabled in T019 with the recommended preset) rejects `onClick` on a non-focusable `role="option"` element (`interactive-supports-focus`, `click-events-have-key-events`); the container is already the single tab stop and has `onKeyDown`; and 10,000 handler bindings are avoided. A click that lands outside any row (padding) is ignored.

- **Single click / tap** on a row selects and highlights it. It never navigates. Highlighting is purely visual plus `aria-activedescendant`; it has no effect on what "Select this folder" does.
- **Double click** on a `folder` row navigates into it: call `navigate(entry.path)` on the directory-listing hook, which aborts any pending request.
- **Double click** on an `image` or `file` row **does nothing in v1**. Do not open a preview, do not start a slide show, do not navigate.
- A native `dblclick` also fires two `click` events first. That is fine, because highlighting the row twice is idempotent — but make sure the click handler does nothing that is expensive or that cancels an in-flight request.
- **Double tap** on touch: most mobile browsers synthesise `dblclick` from a double tap, so the `onDoubleClick` handler usually suffices. Decision (not specified): add a small explicit fallback so touch is reliable everywhere — in the container's `onPointerUp`, when `event.pointerType === 'touch'`, remember `{ index, timeStamp }` and treat a second tap on the same index within **300 ms** as a double tap. Guard against firing twice when the browser *also* dispatches `dblclick` by clearing the remembered tap as soon as either path fires.
- Put the logic in one function (`handleEntryPointer(kind, index)`) exported from `useEntryHighlight.ts` so T027's grid reuses it unchanged with its `[role=gridcell]` selector.
- Suppress the browser's double-click text selection on rows with `user-select: none`.
- The "up one level" button navigates to `data.parentPath`. It is **disabled** when `data.parentPath === null`, which is exactly how the jail root is detected (§5.3). Its `aria-label` is **"Up one level"** and its icon is `lucide-react` `ArrowUp`.

### 4.8 "Select this folder" (FR-14.7, §16.1 A3)

The sticky footer holds the primary `Button` labelled **"Select this folder"** with the current folder's name beside it (`data.name`, or the root's `name` from `RootResponse` when `data.path === ''`).

- It chooses **the folder the user is currently inside** — `data.path` and `data.name` — and never a highlighted row. This is spec §16.1 assumption **A3**: selecting a highlighted subfolder without entering it is deliberately not supported. If a reviewer asks for that, it is a change request, not a bug.
- It is **always enabled**, including for folders that contain no images. FR-14.7 is explicit about this: the zero-image case is reported on the configuration screen, because the `includeSubfolders` setting that determines the real image count lives there, so the explorer cannot know the true count.
- It performs the `explorer → config` transition from §6.1 with `actions.selectCurrentFolder(data.path, <displayed name>)`, which sets `selection = { path: data.path, name }`. The reducer ignores an empty name, so the displayed name must never be the empty string (use the root's `name` from `RootResponse` at the jail root).
- Disable it only while no listing has loaded yet (`data === null`), because there is then nothing to select.

### 4.9 The four states (FR-14.10)

The loading and empty states render inside the body in place of the entry region. The inline error, the truncation notice and the restore notice (§4.3) are `Banner`s rendered in the **notices region** (`ExplorerNotices`), between the header and the body, outside the scroller. They therefore stay visible while the entries scroll, and the entry region always starts at scroll offset 0.

1. **Loading.** When `loading && data === null`, render skeleton rows using the `Skeleton` component: **12** rows at the normal row height, each with a square icon placeholder and a name bar of varying width. (Decision (not specified): 12 rows.) The region keeps `role="listbox"` with `aria-busy="true"` and no options. When `loading && data !== null` (a navigation away from a loaded folder), keep the old rows and show a slim indeterminate progress line under the header instead of replacing the content, so navigation does not flash.
2. **Empty folder.** `data.entries.length === 0 && !loading && !error` renders a centred message: **"This folder is empty."** (Decision (not specified): wording.) When `showHidden` is off, append the second line **"Some items may be hidden. Turn on Show hidden items to see them."** (Decision (not specified).)
3. **Inline error with Retry.** When `error !== null`, render a `Banner` of the `error` variant in the notices region, **keeping `data`'s rows visible in the body underneath** so the user does not lose their place. The banner holds a message and an `action={{ label: 'Retry', onClick: reload }}`. Message by `ApiClientError.code` (Decision (not specified): the exact wording; FR-14.10 only names the codes):
   - `ACCESS_DENIED` → "You do not have permission to read this folder."
   - `READ_FAILED` → "This folder could not be read."
   - `NOT_FOUND` → "That folder no longer exists."
   - `NOT_A_DIRECTORY` → "That item is not a folder."
   - `OUTSIDE_ROOT` → "That folder is outside your home folder."
   - anything else → "Something went wrong while reading this folder."

   Never show a raw server message, `errno` or absolute path; §3.4 guarantees the server does not send them, and the client must not invent them.
4. **Truncation notice.** When `data.truncated === true`, render a `Banner` of the `info` variant in the notices region: **"This folder has more than 10,000 items. Showing the first 10,000."** (Decision (not specified): wording. `MAX_ENTRIES = 10000` is spec §5.3; import it from `@slydr/shared` and format it, do not hard-code the number.) The notice is informational and not dismissible. Because it lives outside the scroller it stays visible while the user scrolls (decision: banners are pinned between header and body, never inside the scroll element).

### 4.10 Image-count chip

Use the `Chip` component with `data.counts.images`. Text (Decision (not specified): wording and pluralisation): `0` → **"No images"**; `1` → **"1 image"**; otherwise **"{n} images"** with `new Intl.NumberFormat().format(n)` so 1284 reads "1,284 images". The chip is informational text, not a control: it is not focusable and has no click behaviour. Hide it entirely while `data === null`. Because `counts` reflects the *returned, post-filter* entries (§5.3), the number changes when the show-hidden toggle changes — that is correct.

### 4.11 Breadcrumb (§7.3)

- Render T022's `Breadcrumb` as `<Breadcrumb path={data.path} rootTitle={root.absoluteRoot} onNavigate={navigate} />`. It derives the segments itself with `breadcrumbSegments(path)` (T007, `{ label, path }[]`), roots them at a **"Home"** segment that navigates to `""`, and puts `rootTitle` on the Home button as its tooltip so the user can see where they actually are. (Decision (not specified): the Home segment's visible label is the literal word "Home" rather than `RootResponse.name`, because §7.3 says "rooted at a 'Home' segment"; the real folder name and absolute path are in the tooltip.) Before the first listing has loaded (`data === null`) render the trail for `requestedPath`.
- The last segment is the current folder; T022 renders it as non-interactive text with `aria-current="page"`.
- Overflow collapse is entirely T022's: when the trail exceeds the available width the middle collapses into an ellipsis button that opens a menu of the hidden segments, and **"Home" and the last two segments are always visible** (§7.3). Do not reimplement it here. If T022's `Breadcrumb` lacks a behaviour this screen needs, extend `Breadcrumb`, not the explorer.
- The ellipsis button's accessible name is **"Show hidden folders"** (T022: `aria-haspopup="menu"`, `aria-expanded`; the menu is a `role="menu"` of `role="menuitem"` buttons, closed by `Escape` and by a click outside). Tests in this ticket use that name.

### 4.12 Keyboard access (FR-14.8, NFR-6)

The entry region is the listbox:

```tsx
<div
  ref={listRef}
  role="listbox"
  tabIndex={0}
  aria-label="Folder contents"
  aria-activedescendant={activeIndex >= 0 ? `slydr-entry-${activeIndex}` : undefined}
  onKeyDown={onKeyDown}
  onClick={onClick}              // delegated: closest('[role=option]'), see §4.7
  onDoubleClick={onDoubleClick}
  onPointerUp={onPointerUp}
>
  {entries.map((entry, index) => (
    <div
      key={entry.path}
      id={`slydr-entry-${index}`}
      role="option"
      aria-selected={index === activeIndex}
      data-type={entry.type}
      data-hidden={entry.hidden}
      /* NOT focusable and no handlers: tabIndex and on* props are never set on a row */
    >…</div>
  ))}
</div>
```

- `Tab` / `Shift+Tab` move between **controls**: the breadcrumb segments, the up button, the chip is skipped, the view-mode toggle, the show-hidden toggle, the theme switch, the listbox itself (one stop), and the "Select this folder" button. Rows are never individual tab stops — that is the whole point of the `aria-activedescendant` pattern.
- `↓` moves the highlight down one, `↑` up one; both `preventDefault()` so the page does not scroll. From `activeIndex === -1`, `↓` highlights index 0 and `↑` highlights the last entry. Both clamp at the ends; they do not wrap. (Decision (not specified): no wrapping.)
- `Home` jumps to the first entry, `End` to the last. (Decision (not specified): a cheap addition expected of a listbox.)
- `Enter` opens the highlighted entry **if and only if** its type is `folder`; on an image or other file it does nothing, mirroring FR-14.6.
- `Backspace` and `Alt+ArrowLeft` go up one level, and are no-ops when `parentPath === null`. Both `preventDefault()`; `Alt+ArrowLeft` in particular must not be allowed to trigger browser history navigation, which §16.1 A2 says is not wired to the view machine.
- Moving the highlight must scroll it into view: `rowEl.scrollIntoView({ block: 'nearest' })`. Use `block: 'nearest'` so the sticky header and footer do not fight the scroll. T028 replaces this with a virtualizer `scrollToIndex`.
- Every icon-only button has an `aria-label`, and every focusable element has a visible focus ring using `--focus-ring`. Verify both themes.
- Do not intercept keys while focus is inside a text input; there are none on this screen today, but the guard keeps T027/T028 safe.

Put the highlight index, the key handler and the scroll-into-view in `useEntryHighlight.ts` so T027 can reuse the state with two-dimensional arrow arithmetic.

### 4.13 The grid seam

The view-mode toggle writes `'list' | 'grid'` into `AppState.explorer.viewMode`, (`actions.setViewMode`), which T024's effect persists to `slydr.explorer.viewMode` through T023. The toggle is a two-button group:

```tsx
<div role="group" aria-label="View mode">
  <IconButton icon={List} aria-label="List view" pressed={viewMode === 'list'} onClick={() => actions.setViewMode('list')} />
  <IconButton icon={LayoutGrid} aria-label="Grid view" pressed={viewMode === 'grid'} onClick={() => actions.setViewMode('grid')} />
</div>
```

Icons: `lucide-react` `List` and `LayoutGrid`. `pressed` is T022's prop and renders `aria-pressed`. (Decision (not specified): the pressed two-button group rather than a `radiogroup`, and the icon choices.)

Because the grid is owned by T027, `Explorer.tsx` must contain a single explicit seam and nothing else that branches on `viewMode`:

```tsx
function renderBody() {
  // T027 replaces the 'grid' branch with <EntryGrid …/>.
  // Until then grid falls back to the list so the persisted toggle is never a dead end.
  return <EntryList … />;
}
```

Leave that comment in the code verbatim. Do not stub a half-built grid.

### 4.14 Styling notes

- Use CSS Modules and design tokens only; no hard-coded colours. Rows alternate nothing by default; the highlighted row uses `--bg-sunken` with a 2 px `--accent` inset border, and hover uses `--bg-sunken` guarded by `@media (hover: hover)` per §10.
- Respect `prefers-reduced-motion: reduce`: no row transitions beyond colour, and no animated skeleton shimmer.
- The body must not introduce horizontal scrolling at 320 px.

## 5. Acceptance criteria

- [ ] `client/src/screens/Explorer/` contains `Explorer.tsx`, `ExplorerScrollContext.ts`, `ExplorerHeader.tsx`, `ExplorerNotices.tsx`, `ExplorerFooter.tsx`, `EntryList.tsx`, `EntryRow.tsx`, `useDirectoryListing.ts`, `useEntryHighlight.ts`, `thumbnailQueue.ts` (the `cancelAllThumbnails` stub), `entryIcon.ts`, `formatBytes.ts`, `copy.ts`, `index.ts` and matching `.module.css` files; the T024 placeholder `index.tsx` is deleted; `App.tsx` renders `<Explorer />` for the `explorer` view through the directory import.
- [ ] On a first run with no `slydr.explorer.lastPath`, the screen calls `GET /api/fs/root` and then `GET /api/fs/list?path=` and shows the home folder's contents; `getRoot` is requested at most once per page load, however often the explorer remounts.
- [ ] With `slydr.explorer.lastPath` set to `"Pictures/2024"`, the screen lists that folder on load without visiting the root first.
- [ ] With a stored `lastPath` whose first listing fails with **any** API error (`404`, `403`, `400 NOT_A_DIRECTORY`, `500`, ...), the screen lists the jail root and shows the one-line notice "The folder you last used is no longer available. Showing your home folder instead."; a failed navigation the user performed is not given this fallback.
- [ ] The restore notice, the inline error and the truncation notice are rendered outside the scroll element (between header and body); the body element (`data-explorer-scroll`) contains no `Banner`.
- [ ] `ExplorerScrollContext` provides the body element (held in state) and `useExplorerScroll()` returns it.
- [ ] `EntryRow` has no `onClick`, `onDoubleClick`, `onPointerUp` or `tabIndex`; the three pointer handlers are on the listbox container and resolve the row with `closest('[role=option]')`; `npm run lint` (with `jsx-a11y`) is clean without disable comments.
- [ ] While a user navigation is requested, `cancelAllThumbnails()` is called once; a failed navigation reverts `requestedPath`, leaves the previous rows and breadcrumb in place and does not dispatch `navigateExplorer`.
- [ ] `slydr.explorer.viewMode` is absent on first run and the list view renders — list is the default.
- [ ] A list row shows the type icon, the name, and a size for `image` and `file` entries; a `folder` row shows no size text at all.
- [ ] Measured row height is at least 44 px at desktop width and at least 48 px under `@media (pointer: coarse)`.
- [ ] The three icons rendered are `lucide-react` `Folder`, `Image` and `File`; no list row ever requests `/api/thumb`.
- [ ] With show-hidden off, the request carries `showHidden=false` (or omits it); turning the toggle on issues a new request with `showHidden=true`, and the hidden rows are rendered with the same styling as all other rows (no reduced opacity).
- [ ] A single click highlights a row without navigating; a double click on a folder navigates into it; a double click on an image or other file changes nothing observable.
- [ ] "Select this folder" is enabled for a folder containing zero images, and transitions to the configuration screen with `selection` equal to the folder the user is inside, not the highlighted row.
- [ ] The entry region has `role="listbox"` and `aria-activedescendant`; rows are `role="option"` with `aria-selected`; no row is a tab stop.
- [ ] `↑`/`↓` move the highlight and do not scroll the page; `Enter` on a highlighted folder navigates; `Enter` on a file does nothing; `Backspace` and `Alt+←` go up and are no-ops at the jail root.
- [ ] The "up one level" button is disabled exactly when `parentPath === null`.
- [ ] Skeleton rows appear during the first load; an empty folder shows "This folder is empty."; an `ACCESS_DENIED` or `READ_FAILED` failure shows an inline error with a working "Retry" **while the previous folder's rows stay on screen**; `truncated: true` shows the 10,000-item notice.
- [ ] Navigating twice in quick succession aborts the first `list` request (observable as `signal.aborted === true` on the first controller) and only the second response is rendered.
- [ ] The breadcrumb always shows "Home" plus the last two segments, with the middle collapsed behind an ellipsis menu when the trail does not fit.
- [ ] Entries are rendered in server order; no `sort`, `reverse` or comparator appears anywhere in `client/src/screens/Explorer/`.
- [ ] No horizontal page scrolling at a 320 px viewport; the size column is hidden below 480 px (`@media (max-width: 479.98px)`); the header is two rows below 768 px.
- [ ] The explorer renders exactly one `h1`, visually hidden, with the text "Choose a folder".
- [ ] Both themes pass a WCAG AA contrast check on the row text, the muted size text, the chip and the focus ring.

## 6. Tests to write

Component and unit tests under Vitest + React Testing Library (`jsdom`), per spec §12.3. All tests live under `client/test/screens/Explorer/` (Vitest only discovers `client/test/**/*.test.{ts,tsx}`) and import `describe`, `it`, `expect`, `vi` from `'vitest'`. Mock `client/src/api/client.ts` with `vi.mock` (keep the real `isAbortError` and `ApiClientError`) and build `ListResponse` fixtures from a small factory in `client/test/helpers/explorerFixtures.ts` (`makeListing`, `makeEntries`; T027 and T028 extend it). Render with the real `AppStateProvider` (its `initialState` prop) so `useAppActions()` and `useExplorerRestore()` are exercised.

**`client/test/screens/Explorer/formatBytes.test.ts`**

- `describe('formatBytes')`
  - `it('renders byte counts under 1024 with a B suffix')`
  - `it('renders 1536 bytes as 1.5 KB')`
  - `it('drops the decimal once the value reaches 10 of a unit')`
  - `it('steps up through KB, MB, GB and TB')`
  - `it('returns an empty string for a negative or non-finite input')`

**`client/test/screens/Explorer/Explorer.open.test.tsx`**

- `describe('Explorer opening folder')`
  - `it('calls getRoot and lists the jail root on a first run with no stored last path')`
  - `it('lists the stored slydr.explorer.lastPath on a later run')`
  - `it('falls back to the jail root and shows the one-line notice when the stored path returns NOT_FOUND')`
  - `it('falls back to the jail root when the stored path returns ACCESS_DENIED')`
  - `it('falls back to the jail root when the stored path returns NOT_A_DIRECTORY, INVALID_PATH or READ_FAILED')`
  - `it('shows the inline error and stays put when the fallback root listing fails too')`
  - `it('does not fall back when the user navigates to a folder that fails; it keeps the previous listing and the committed path')`
  - `it('does not treat the path as restored after returning from the configuration screen')` (`markRestoreResolved` was called; `restoredPath` is `null`)
  - `it('keeps the explorer path already held in application state when returning from the configuration screen')`
  - `it('persists the path to application state only after a successful listing')`
  - `it('requests getRoot only once across several mounts')`
  - `it('renders the restore notice, the inline error and the truncation notice outside the scroll element')`
  - `it('provides the scroll element through ExplorerScrollContext')`

**`client/test/screens/Explorer/EntryList.test.tsx`**

- `describe('Explorer list view')`
  - `it('renders list view by default when no view mode is stored')`
  - `it('renders one row per entry in the order returned by the server')`
  - `it('renders a size for image and file entries')`
  - `it('renders no size for folder entries')`
  - `it('renders the Folder, Image and File icons for the three entry types')`
  - `it('never requests a thumbnail URL in list view')`
  - `it('gives every row an accessible name containing the entry name')`
  - `it('renders hidden entries without any reduced opacity or hidden-specific class, keeps data-hidden, and appends a visually hidden ", hidden" to the accessible name')`

**`client/test/screens/Explorer/Explorer.navigation.test.tsx`**

- `describe('Explorer navigation')`
  - `it('attaches pointer handlers to the listbox container only; rows have no on* props and no tabindex')`
  - `it('ignores a click on the listbox padding that is not inside a row')`
  - `it('calls cancelAllThumbnails when a user navigation starts')`
  - `it('highlights a row on a single click without issuing a new listing request')`
  - `it('navigates into a folder on a double click')`
  - `it('does nothing when an image row is double clicked')`
  - `it('does nothing when a non-image file row is double clicked')`
  - `it('treats two touch taps on the same row within 300 ms as a double tap')`
  - `it('navigates to parentPath from the up one level button')`
  - `it('disables the up one level button when parentPath is null')`
  - `it('aborts the pending list request when the user navigates again')`
  - `it('renders only the response of the last navigation when two requests overlap')`

**`client/test/screens/Explorer/Explorer.keyboard.test.tsx`**

- `describe('Explorer keyboard access')`
  - `it('exposes the entry region as a listbox with aria-activedescendant')`
  - `it('marks rows as options with aria-selected and no tab stop')`
  - `it('moves the highlight down with ArrowDown and up with ArrowUp')`
  - `it('clamps the highlight at the first and last entry')`
  - `it('jumps to the first entry with Home and the last with End')`
  - `it('prevents default on the arrow keys so the page does not scroll')`
  - `it('opens a highlighted folder with Enter')`
  - `it('does not act on Enter when the highlighted entry is an image')`
  - `it('goes up one level with Backspace')`
  - `it('goes up one level with Alt+ArrowLeft and prevents the browser history navigation')`
  - `it('ignores Backspace at the jail root')`
  - `it('reaches every header control and the footer button by tabbing')`

**`client/test/screens/Explorer/Explorer.states.test.tsx`**

- `describe('Explorer states')`
  - `it('renders skeleton rows while the first listing is loading')`
  - `it('renders "This folder is empty." for a folder with no entries')`
  - `it('suggests turning on Show hidden items in the empty state when hidden entries are filtered out')`
  - `it('renders an inline error with a Retry action for ACCESS_DENIED')`
  - `it('renders an inline error with a Retry action for READ_FAILED')`
  - `it('keeps the previous folder rows visible while the inline error is shown')`
  - `it('refetches the same path when Retry is pressed')`
  - `it('renders the truncation notice when truncated is true')`
  - `it('renders no truncation notice when truncated is false')`
  - `it('announces the error through an aria-live polite region')`

**`client/test/screens/Explorer/ExplorerHeader.test.tsx`**

- `describe('Explorer header')`
  - `it('shows "No images", "1 image" and "1,284 images" in the chip for counts 0, 1 and 1284')`
  - `it('refetches with showHidden=true when the show hidden toggle is switched on')`
  - `it('stores the view mode when the grid button is pressed')`
  - `it('renders the theme switch as the last control in the header')`
  - `it('renders a Home breadcrumb segment whose title is the absolute root')`
  - `it('keeps Home and the last two segments visible and collapses the middle behind an ellipsis menu named "Show hidden folders"')`
  - `it('shows icon-only toggles below 1024 px and a visible "Show hidden items" label from 1024 px')`
  - `it('navigates to the clicked breadcrumb depth')`
  - `it('renders a single visually hidden h1 "Choose a folder"')`

**`client/test/screens/Explorer/thumbnailQueue.stub.test.ts`**

- `describe('cancelAllThumbnails stub')`
  - `it('can be called with nothing queued and does not throw')`

**`client/test/screens/Explorer/ExplorerFooter.test.tsx`**

- `describe('Explorer footer')`
  - `it('renders the current folder name beside the Select this folder button')`
  - `it('keeps Select this folder enabled for a folder with zero images')`
  - `it('selects the folder the user is inside and not the highlighted row')`
  - `it('transitions the view to config when Select this folder is pressed')`
  - `it('disables Select this folder only while no listing has loaded')`

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit and component tests; `npm test` green.
- [ ] Every icon-only control in the header and footer has an `aria-label`, and the entry region implements `role="listbox"` + `aria-activedescendant` exactly as described.
- [ ] Verified by hand in both light and dark themes, including the focus ring, and that hidden entries look identical to the others.
- [ ] Verified at 320 px, 768 px and 1920 px viewport widths with no horizontal page scrolling.
- [ ] Keyboard-only walkthrough completed: tab to every control, navigate three levels down and back up, select a folder — no mouse used.
- [ ] The `renderBody()` seam and its `// T027 replaces the 'grid' branch` comment are present and the view-mode toggle persists.
- [ ] No sort or filter of `entries` anywhere in the client.
- [ ] `npm run lint` is clean with the `jsx-a11y` preset and no `eslint-disable` for the row/listbox handlers.
- [ ] README: no change; T041 creates the README and documents explorer behaviour.

## 8. Notes and gotchas

- **Selection means the folder you are inside.** Spec §16.1 assumption **A3**: "Explorer selection means 'the folder you are inside', so selecting a *highlighted* subfolder without entering it is not supported." The impact if that assumption is wrong is a second action button on folder rows. Do not add one here, and do not let the highlighted row leak into `selection`.
- **"Select this folder" is never disabled for an empty folder.** It is tempting to disable it when `counts.images === 0`, and it is wrong: with `includeSubfolders` on, a folder with zero direct images can still have thousands of playable images. FR-14.7 puts that report on the configuration screen for exactly this reason.
- **Do not re-sort.** §4.2 and FR-14.4 make sorting a server responsibility, and the server uses `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`. A client-side `localeCompare` would reorder `IMG_2.jpg` and `IMG_10.jpg` differently and the mismatch would be invisible until someone noticed a photo set out of order.
- **`counts` is post-filter.** §5.3: the counts describe the entries actually returned, so the chip number legitimately changes when show-hidden is toggled.
- **Abort errors are not errors.** If an aborted request is allowed to set `error`, every fast navigation will flash an error banner. Test this explicitly.
- **Keep the row DOM flat and fixed-height.** T028 will wrap the rows in a `@tanstack/react-virtual` window above 200 entries. A variable row height, a nested scroll container, or rows that are individual tab stops would all have to be undone.
- **Hidden rows are not styled differently.** An earlier draft dimmed them to 60 % opacity, which pushes `--fg-muted` text (file sizes) below WCAG AA. FR-14.5 now requires identical rendering, so there is nothing to tune; do not reintroduce a dimming treatment.
- **`Alt+ArrowLeft` is the browser's Back.** §16.1 A2 says browser history is not wired to the view machine, so swallowing the key with `preventDefault()` is correct and intentional.
- **`position: sticky` plus `scrollIntoView`.** Without `block: 'nearest'`, a highlighted row can end up underneath the sticky header or footer. If it still happens, add `scroll-padding-block` on the scroll container matching the header and footer heights.
- **`100dvh`, not `100vh`.** Mobile browser chrome crops `100vh`; §9.1 already mandates `dvh` for the player and the same reasoning applies to a full-height explorer.
- **Two paths: committed and requested.** `AppState.explorer.path` is persisted and must only ever hold a folder that listed successfully; `requestedPath` is the in-flight target. Mixing them either persists a folder that does not exist or leaves the breadcrumb pointing at a folder the user never reached.
- **Banners stay outside the scroller.** Keeping them out of the scroll element is what lets T028 position virtualized rows at plain offsets with no scroll-margin bookkeeping. Do not move a banner into `.body`.
- **Why the pointer handlers are on the container.** A `role="option"` row with `onClick` and no `tabIndex` is rejected by `jsx-a11y`, and silencing it would only hide the real design point: the container is the one focusable, keyboard-operable element. Event delegation also keeps the DOM contract T028 needs (flat rows, no per-row handlers).
- **Spec §6.2 amendment.** The restored-path fallback applies to any listing failure (spec amended from "404 / 403"); a stored folder that became a file returns `400 NOT_A_DIRECTORY`.
- **Windows hidden entries.** §4.3 notes that Node exposes no `FILE_ATTRIBUTE_HIDDEN` bit, so some Windows files flagged hidden only through NTFS attributes will appear as normal entries. That is a documented server-side limitation, not something the explorer should try to compensate for.
