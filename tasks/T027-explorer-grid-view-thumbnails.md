# T027 — Add the explorer grid view with lazy thumbnails

**Epic:** E12
**Spec sections:** FR-14.2 (grid half), FR-14.3, FR-14.9, §5.6, §10, NFR-3
**Depends on:** T017, T026
**Estimated size:** L

---

## 1. Context

Slydr is a locally running, browser-based slide show player for images stored in folders on the user's own computer. Its file explorer screen already works in **list** view: a single column of rows showing a type icon, the entry name, and a size. This ticket adds the explorer's second view mode, **grid** view — a responsive grid of square tiles where image entries show an actual thumbnail fetched from the local server, and folders and other files show their type icon.

Grid view is where the explorer becomes usable for picking a photo folder, and it is also where the app can most easily hurt itself: a folder with two thousand JPEGs would, naively implemented, fire two thousand simultaneous thumbnail requests and drive the server's `sharp` pipeline and the browser's memory into the ground. The specification therefore pins down lazy loading through an `IntersectionObserver` and a hard cap of six thumbnail requests in flight. Implementing that cap correctly is the substance of this ticket.

## 2. Scope

### In scope

- `EntryGrid.tsx`: the responsive tile grid with the exact `grid-template-columns` values and breakpoints of spec §10.
- Tiles: a square thumbnail or icon area, with the entry name below truncated to two lines plus a `title` tooltip.
- `Thumbnail.tsx`: a tile's image area, with its loading, loaded and failed states and its silent fallback to the generic image icon.
- `thumbnailQueue.ts`: replaces T026's one-function stub with the real module owning the request queue, the six-in-flight cap, per-request cancellation and `cancelAllThumbnails()`.
- `gridMetrics.ts`: the single source of the grid's column arithmetic (`GRID_MIN_TILE_PX`, `columnsFor`, `useTileMin`, `useGridColumns`), shared with T028 and T035.
- `useThumbnail.ts`: the per-tile hook tying an `IntersectionObserver` entry to a queued request.
- Lazy loading per FR-14.9: a one-viewport root margin, at most six requests in flight, cancellation when a tile scrolls out of range or the user navigates away, and a failed thumbnail falling back to the image icon without any error UI.
- Two-dimensional keyboard navigation in grid mode with `role="grid"` and `aria-activedescendant`, including the measured column count that the arrow arithmetic needs; pointer handling delegated on the grid container.
- Filling in the `renderBody()` grid branch left by T026 so the view-mode toggle reaches a real grid, and confirming the choice persists to `slydr.explorer.viewMode`.
- Component and unit tests per §12.3.

### Out of scope

- **The explorer shell, header, breadcrumb, footer, list view, directory fetching and the four loading/empty/error/truncated states — T026.** They already exist; this ticket replaces only the body's grid branch.
- **Virtualization for folders above 200 entries — T028.** Render every tile directly. Keep the tile markup and the thumbnail hook designed so a virtualizer can mount and unmount tiles freely (see §8).
- **The `/api/thumb` endpoint, the `sharp` pipeline, the on-disk cache, request coalescing and the LRU sweep — T017.** This ticket is purely a client of that endpoint.
- **The configuration screen — T029 — and the player — T030 and later.** Grid tiles never start a slide show.
- Any thumbnail use in list view. FR-14.3 is explicit: list view always uses icons.
- A client-side image decoder or any fallback for HEIC/TIFF/RAW. Those classify as `file` server-side (§4.1 FR-2.4) and show the `File` icon.

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
  truncated: boolean;          // true above MAX_ENTRIES = 10000
}

export interface ImageItem { name: string; path: string; dir: string; size: number | null; mtimeMs: number | null }
export interface ImagesResponse { path: string; recursive: boolean; count: number; truncated: boolean; items: ImageItem[] }

export interface SlideshowConfig {
  durationSeconds: number; shuffle: boolean; loop: boolean; animations: boolean;
  fillEmptySpace: boolean; startFullScreen: boolean; includeSubfolders: boolean;
}
export const DEFAULT_CONFIG: SlideshowConfig = {
  durationSeconds: 5, shuffle: true, loop: true, animations: true,
  fillEmptySpace: true, startFullScreen: true, includeSubfolders: false,
};
export function parseConfig(value: unknown): SlideshowConfig; // never throws
```

`@slydr/shared` also exports POSIX wire-path helpers including `breadcrumbSegments`.

### The typed API client — `client/src/api/` (T025)

```ts
export type ThumbSize = 128 | 256 | 384 | 512;                // alias of ThumbnailSize from @slydr/shared
export const DEFAULT_THUMB_SIZE: ThumbSize;                   // 256, alias of DEFAULT_THUMBNAIL_SIZE
export function thumbUrl(path: string, size?: ThumbSize): string;
export function fetchThumbnailBlob(path: string, size: ThumbSize, signal?: AbortSignal): Promise<Blob>;
export function isAbortError(value: unknown): boolean;
export class ApiClientError extends Error { readonly code: ApiErrorCode; readonly status: number }
```

`fetchThumbnailBlob` is the **only** place a thumbnail is fetched: it GETs `thumbUrl(path, size)` same-origin, resolves with the response `Blob` for a 2xx, rejects with an `ApiClientError` for anything else, and rejects with an abort error (`isAbortError(err) === true`, never an `ApiClientError`) when the signal aborts. `thumbUrl` already URL-encodes the wire path (T025 §4.3). NFR-9 (T025's ESLint rule and static test) forbids `fetch(` anywhere else in the client, including this ticket's queue.

### `/api/thumb` — the endpoint being consumed (spec §5.6)

| Param | Type | Default | Notes |
|---|---|---|---|
| `path` | wire path | — | Must resolve to a regular file whose extension is in `IMAGE_EXTENSIONS` |
| `size` | integer | `256` | **Allowed values: `128`, `256`, `384`, `512`.** Anything else → `400 INVALID_PARAM` |

Response: `image/webp`, `Cache-Control: private, max-age=604800`, a strong `ETag` equal to the cache key, and `304` on `If-None-Match`. Thumbnails are produced with `fit: 'cover', position: 'centre'`, so **every thumbnail is a square crop** (§16.1 A4). EXIF orientation is applied server-side, so portrait phone photos arrive upright. A decode or resize failure returns `500 THUMBNAIL_FAILED`, and §5.6 step 5 states plainly that the client falls back to the generic image icon: *"One corrupt file must never break the grid."* An unsupported extension returns `415 UNSUPPORTED_IMAGE`. The server already caps concurrent `sharp` operations at `min(4, os.availableParallelism())` and coalesces duplicate in-flight requests for the same cache key, so the client's six-in-flight cap is about browser memory and connection pressure, not about protecting `sharp`.

### Application state — `client/src/state/`

`AppStateProvider` (T024) owns `AppState` (spec §6.1 plus `notice`), exposed through `useAppState()` and the stable action helpers of `useAppActions()` (`setViewMode`, `navigateExplorer`, ...). Persistence (T023, driven by T024's effects) writes the §6.2 `localStorage` keys debounced at 250 ms through validating readers (the theme immediately): `slydr.schemaVersion` (`1`), `slydr.theme`, `slydr.explorer.viewMode` (default `"list"`), `slydr.explorer.showHidden` (default `false`), `slydr.explorer.lastPath` (default `""`), and `slydr.config` (default `DEFAULT_CONFIG` per field). All storage access is wrapped in `try/catch`; the app stays functional with storage disabled.

### Base components — `client/src/components/`

From T022: `Button`, `IconButton` (`pressed`), `Checkbox`, `Slider`, `Icon` (takes `icon={...}`), `Breadcrumb`, `Chip`, `Banner` (`info | warning | error`, `aria-live="polite"`), `Skeleton`, `Spinner`. The theme toggle is T021's `ThemeToggle`.

### Already built by T026 — `client/src/screens/Explorer/`

```
Explorer.tsx            screen shell; holds the scroll element in state and provides it
ExplorerScrollContext.ts  ExplorerScrollContext + useExplorerScroll(): HTMLElement | null
ExplorerHeader.tsx      breadcrumb, up button, image-count chip, view-mode toggle,
                        show-hidden toggle, theme switch (rightmost)
ExplorerNotices.tsx     restore notice, inline error, truncation notice (outside the scroller)
ExplorerFooter.tsx      "Select this folder" + the current folder name
EntryList.tsx           role="listbox" region, role="option" rows; pointer handlers delegated on the container
EntryRow.tsx            no event handlers, no tabIndex
useDirectoryListing.ts  requestedPath + fetch + abort (useAbortableRequest) + loading/error state;
                        calls cancelAllThumbnails() when a user navigation starts
useEntryHighlight.ts    highlight index + one-dimensional keyboard navigation + handleEntryPointer(kind, index)
thumbnailQueue.ts       STUB: export function cancelAllThumbnails(): void {}   (this ticket replaces the contents)
entryIcon.ts            ENTRY_ICON = { folder: Folder, image: Image, file: File }
formatBytes.ts
copy.ts                 every user-visible string
```

The body (scroller) is the only scroll container; banners are rendered outside it (T026 §4.2). Pointer handling is delegated on the container with `closest('[role=option]')`; the grid does the same with `closest('[role=gridcell]')` and reuses `handleEntryPointer`.

`Explorer.tsx` contains the seam this ticket fills:

```tsx
function renderBody() {
  // T027 replaces the 'grid' branch with <EntryGrid …/>.
  // Until then grid falls back to the list so the persisted toggle is never a dead end.
  return <EntryList … />;
}
```

The view-mode toggle already exists in the header as two `IconButton`s inside `<div role="group" aria-label="View mode">` with `aria-label="List view"` / `"Grid view"` and `pressed`, calling `actions.setViewMode('list' | 'grid')`.

### Wire-path rules

All paths crossing the API are POSIX, forward-slash, and relative to the jail root (the user's home directory); `""` is the jail root. The server sorts entries folders-first then by `new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })` and **the client must not re-sort** — the grid renders `entries` in the received order, left to right then top to bottom.

## 4. Implementation detail

### 4.1 Files

Create:

```
client/src/screens/Explorer/
  EntryGrid.tsx             the role="grid" region, row grouping, tiles
  EntryGrid.module.css
  EntryTile.tsx             one tile: image area + two-line name
  EntryTile.module.css
  Thumbnail.tsx             the image area for an image entry
  Thumbnail.module.css
  gridMetrics.ts            GRID_MIN_TILE_PX, columnsFor(), useTileMin(), useGridColumns() (no JSX)
  useThumbnail.ts           IntersectionObserver -> queue -> element state
  useGridHighlight.ts       two-dimensional arrow-key navigation
```

Replace (the whole file; T026 created it as a one-function stub):

- `client/src/screens/Explorer/thumbnailQueue.ts` — in-flight cap + queue + cancellation + `cancelAllThumbnails()` (no React, no `fetch`).

Modify:

- `client/src/screens/Explorer/Explorer.tsx` — replace the grid branch of `renderBody()`.
- `client/src/screens/Explorer/useEntryHighlight.ts` — T026 already exports the highlight state and `handleEntryPointer(kind, index)`; `useGridHighlight` reuses both. Only change this file if something T026 did not expose is needed, and keep the list behaviour identical.
- `client/src/screens/Explorer/copy.ts` — add the grid-specific strings.

Create the test helper `client/test/helpers/intersectionObserver.ts` — a controllable `IntersectionObserver` stub (`jsdom` does not implement it), imported explicitly by the tests that need it. Do not edit `client/test/setup.ts` for it. Extend `client/test/helpers/explorerFixtures.ts` (T026) with grid fixtures.

Tests live under `client/test/screens/Explorer/` and import `describe`, `it`, `expect`, `vi` from `'vitest'`.

### 4.2 Grid layout (FR-14.2 grid half, §10)

Spec §10 fixes the track sizes exactly:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  align-content: start;
}

@media (min-width: 768px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); }
}

@media (min-width: 1024px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
```

The same three minimums exist in JavaScript as `GRID_MIN_TILE_PX = { base: 104, md: 132, lg: 160 }` in `gridMetrics.ts` (§4.6.2), so the column count the keyboard code uses and the one the browser lays out agree. Those three values — `minmax(104px, 1fr)` below 768 px, `minmax(132px, 1fr)` from 768 px to 1023 px, `minmax(160px, 1fr)` at 1024 px and above — are normative. Do not add a fourth step at `xl 1440px`; `auto-fill` already absorbs wider viewports by adding columns.

The grid must not introduce horizontal page scrolling at a 320 px viewport: at 320 px with a 16 px gutter each side and `minmax(104px, 1fr)`, `auto-fill` yields two columns, which is correct.

### 4.3 Tiles (FR-14.2, FR-14.3)

A tile is a square media area with the name beneath it:

```tsx
<div
  id={`slydr-entry-${index}`}
  role="gridcell"
  aria-selected={index === activeIndex}
  data-type={entry.type}
  data-hidden={entry.hidden}
  className={styles.tile}
  title={entry.name}
  /* no on* handlers and no tabIndex: pointer handling is delegated on the role="grid" container */
>
  <div className={styles.media}>{media}</div>
  <span className={styles.name}>{entry.name}</span>
</div>
```

```css
.media {
  aspect-ratio: 1 / 1;
  display: grid;
  place-items: center;
  background: var(--bg-sunken);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.media img { width: 100%; height: 100%; object-fit: cover; display: block; }

.name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  margin-top: var(--space-1);
  font-size: 0.8125rem;
  line-height: 1.25;
  text-align: center;
}
```

- The name is truncated to **two lines** with a `title` tooltip carrying the full name (FR-14.2). `-webkit-line-clamp` is the only cross-browser way to clamp two lines; keep the unprefixed `line-clamp` alongside it for forward compatibility. Reserve space for two lines (`min-height: 2.5em` on `.name`) so a one-line name does not make its tile shorter than its neighbours — uniform tile height is what lets T028 virtualize by rows.
- Media content by entry type (FR-14.3):
  - `folder` → the `lucide-react` `Folder` icon, sized to roughly 40 % of the tile, `aria-hidden="true"`.
  - `file` → the `lucide-react` `File` icon, same treatment.
  - `image` → `<Thumbnail entry={entry} />`, which renders the fetched WebP, or the `lucide-react` `Image` icon while loading or after a failure.
- Hidden entries render exactly like all other tiles, matching list view (FR-14.5): no opacity change and no hidden-specific style. Keep `data-hidden` as a test hook and append a visually hidden `", hidden"` suffix to the accessible name.
- Single click highlights the tile; **double click** (or double tap) on a `folder` navigates into it; double click on an `image` or `file` does nothing (FR-14.6). `EntryTile` has no event handlers (a `role="gridcell"` with `onClick` and no `tabIndex` is rejected by the `jsx-a11y` preset enabled in T019). `EntryGrid` attaches `onClick`, `onDoubleClick` and `onPointerUp` **once, on the `role="grid"` container**, resolves the tile with `(event.target as Element).closest('[role=gridcell]')` and calls T026's `handleEntryPointer(kind, index)` (which contains the 300 ms touch double-tap fallback) instead of duplicating it. Clicks that miss a tile are ignored.
- Tiles are not individual tab stops; the grid container is the single tab stop and uses `aria-activedescendant` (§4.6 below).

### 4.4 Thumbnail size

**Decision (not specified for the DPR question): request a fixed `size=256` and do not use a device-pixel-ratio-aware size step in v1.**

FR-14.2 states the grid loads thumbnails "from `/api/thumb?size=256`", and §5.6 fixes the server allowlist to `128 | 256 | 384 | 512`. The size is defined **once**, in `@slydr/shared` as `DEFAULT_THUMBNAIL_SIZE` (T004), re-exported by the client API module as `DEFAULT_THUMB_SIZE` (T025). This ticket imports `DEFAULT_THUMB_SIZE` and defines no size constant of its own (the earlier `THUMB_SIZE` is gone):

```ts
import { DEFAULT_THUMB_SIZE } from '../../api/client';   // 256
```

Rationale, recorded so a future reviewer does not re-litigate it:

- The largest CSS tile is 160 px wide (§10 at `lg`), plus whatever `1fr` adds on a wide viewport — in practice up to roughly 200 px. A 256 px source therefore covers 1 CSS pixel density comfortably and still downsamples on a typical 1.25–1.5× display.
- On a 2× display a 160 px tile ideally wants a 320 px source, which would round up to the `384` step. That would be sharper, but it also **doubles the server-side cache**: §5.6 includes `size` in the cache key, so every image that is viewed at two densities is resized and stored twice, against a 500 MB cap. For a chooser grid of square crops, the sharpness gain does not justify doubling the cache and the `sharp` work.
- A single fixed size maximises cache hits across devices and makes the §12.1 thumbnail tests deterministic.
- The size is read from one module-level constant (`DEFAULT_THUMB_SIZE`), so switching to a DPR step later is a one-line change in the queue's call to `fetchThumbnailBlob` plus a test update. If the product owner asks for it during the §16.2 item 3 tuning pass, the implementation is `const size = (window.devicePixelRatio ?? 1) > 1.5 ? 384 : 256`.

Never send a `size` outside the allowlist; the server answers `400 INVALID_PARAM` and the tile would fall back to an icon for a reason no user could diagnose.

### 4.5 Lazy loading and the request queue (FR-14.9, NFR-3)

FR-14.9 is the binding requirement: *"Thumbnails load lazily via `IntersectionObserver` with a one-viewport root margin, at most 6 requests in flight, cancelled when a tile scrolls far out of view. A failed thumbnail silently falls back to the image icon."* NFR-3 repeats the cap.

#### 4.5.1 `thumbnailQueue.ts` — the module that owns the cap

A plain TypeScript module with no React dependency, so it can be unit-tested directly and so the cap is global across every mounted tile (which matters once T028 mounts and unmounts tiles during scrolling).

```ts
export const MAX_IN_FLIGHT = 6;        // FR-14.9 / NFR-3

export interface ThumbnailHandle {
  /** Drop a queued request, or abort it if it is already in flight. Idempotent. */
  cancel(): void;
}

export interface ThumbnailRequest {
  /** Stable identity and the argument to fetchThumbnailBlob: the entry's wire path. */
  key: string;
  /** Called once with an object URL the caller must assign to an <img src>. */
  onLoad: (objectUrl: string) => void;
  /** Called once on any non-abort failure. No arguments: the caller never shows a reason. */
  onError: () => void;
}

export function requestThumbnail(request: ThumbnailRequest): ThumbnailHandle;

/**
 * Drops every queued request and aborts every in-flight one, without calling onLoad or onError.
 * Called when a user navigation starts (T026) so thumbnails of the folder being left do not hold
 * the browser's six HTTP/1.1 connections to the server while the new listing is requested.
 * Idempotent; frees every slot.
 */
export function cancelAllThumbnails(): void;

/** Test-only introspection. */
export function __inFlightCount(): number;
export function __queueLength(): number;
export function __reset(): void;
```

This file replaces T026's stub (`cancelAllThumbnails(): void {}`); keep that export name and signature.

Internal state:

- `queue: Map<string, QueuedRequest>` — insertion-ordered, which `Map` guarantees, giving first-in-first-out dispatch with O(1) removal by key. A plain array would make cancellation O(n), and during a fast scroll through 2000 tiles that cost is real.
- `inFlight: Map<string, { controller: AbortController; request: QueuedRequest }>`.
- Re-requesting a `key` that is already queued or in flight replaces the callbacks rather than starting a second fetch; the returned handle cancels the single underlying request.

`drain()`:

1. While `inFlight.size < MAX_IN_FLIGHT` and the queue is non-empty, shift the first queued entry and start it.
2. Starting an entry means: create an `AbortController`, move the entry into `inFlight`, and call `fetchThumbnailBlob(key, DEFAULT_THUMB_SIZE, controller.signal)` (T025). The queue never calls `fetch` itself (NFR-9: T025's ESLint rule and static test allow `fetch(` only in `client/src/api/client.ts`).
3. On settle — success, failure or abort — remove the entry from `inFlight` and call `drain()` again.
4. `drain()` is called synchronously at the end of every `requestThumbnail`, every `cancel`, and every settle. It is a `while` loop, **not** a timer or a `requestAnimationFrame` callback: a grid whose thumbnails are all served from the browser cache must saturate at full speed, and any artificial delay would make the cap feel like throttling.

Request handling:

```ts
try {
  const blob = await fetchThumbnailBlob(entry.key, DEFAULT_THUMB_SIZE, controller.signal);
  if (controller.signal.aborted) return;               // lost the race with a cancel
  entry.request.onLoad(URL.createObjectURL(blob));
} catch (err) {
  if (isAbortError(err) || controller.signal.aborted) return;   // silent: no onLoad, no onError
  entry.request.onError();
} finally {
  inFlight.delete(entry.key);
  drain();
}
```

- `fetchThumbnailBlob` rejects with an `ApiClientError` for `500 THUMBNAIL_FAILED`, `415 UNSUPPORTED_IMAGE`, `403 ACCESS_DENIED`, `404 NOT_FOUND` and network failures. All of them take the `onError` path. The queue never inspects the code and never surfaces a reason; FR-14.9 requires silence.
- An abort must call **neither** `onLoad` nor `onError`. A cancelled tile has no state to update, and treating an abort as a failure would leave icons behind wherever the user scrolled quickly. Detect it with T025's `isAbortError` (not `instanceof DOMException`).
- Catch everything else. A malformed blob or an offline browser (NFR-9 says the app must work fully offline — the local server is still local, but a dev-server restart looks like a network failure) resolves to `onError`.
- `finally` removes the entry and calls `drain()` on every path, abort included; that is what frees the slot (see §8).

`cancelAllThumbnails()`: clear `queue` (no callbacks), then for every `inFlight` entry mark it cancelled and call `controller.abort()`. The aborted promises settle through the `finally` block above, which removes the entries and calls `drain()` (a no-op, the queue being empty), so the in-flight count returns to 0 and later `requestThumbnail` calls start immediately. Tiles still mounted at that moment (the old rows stay on screen while the new listing loads) keep their `pending` state until they unmount or intersect again; they are not failed. (If the navigation then fails and the old rows stay, those tiles show the generic icon until they are scrolled out of range and back, which re-requests them. Accepted: it is the rare error path.)

#### 4.5.2 Why `fetch` + `AbortController` (inside `fetchThumbnailBlob`) rather than `new Image()`

**Decision (not specified).** The specification requires real cancellation and an exact in-flight count, and only `fetch` gives both:

- `new Image(); img.src = url` is simpler and inherits the HTTP cache for free, but cancellation is best-effort — clearing `img.src` aborts the transfer in Chromium and historically did not in Safari — and the browser gives no observable signal for "in flight", so the cap would have to be inferred.
- `fetch` with an `AbortController` cancels deterministically, and because the queue itself starts and settles every request, `inFlight.size` *is* the number of requests in flight. That is directly testable, which the acceptance criteria require.

The cost is object-URL bookkeeping, addressed next.

#### 4.5.3 Object URLs and the HTTP cache

- A blob object URL leaks until revoked. **Revoke it inside the `<img>`'s own `load` handler**, after the bitmap is decoded: the decoded image stays on screen, and no long-lived object URL accumulates. For a 10,000-entry folder that is the difference between zero retained blobs and hundreds of megabytes.

  ```tsx
  <img
    src={objectUrl}
    alt=""
    decoding="async"
    draggable={false}
    onLoad={(e) => { URL.revokeObjectURL(e.currentTarget.src); }}
    onError={() => setState('failed')}
  />
  ```

  Also revoke in the hook's cleanup if the component unmounts before `load` fires, and guard against a double revoke (it is harmless but noisy in tests).
- Because the URL is revoked, **a remounted tile must request again**. That is fine and is the intended design: `/api/thumb` sends `Cache-Control: private, max-age=604800`, so the second request is served from the browser's HTTP cache with no network and no server work.
- **How a cached or `304` response interacts with the queue.** The Fetch API hides revalidation: a fresh cache entry resolves from cache without touching the network, and a stale-but-valid entry triggers a conditional request whose `304` the browser transparently turns into a `200` with the cached body. Either way the queue sees an ordinary fast success. Two consequences to design for:
  1. A cached response still **occupies a slot** for its (very short) lifetime. Because `drain()` runs synchronously on settle, an all-cached grid of 2000 tiles drains in a tight burst rather than being rate-limited — correct behaviour, and the reason `drain()` must not be deferred.
  2. Because resolution can be synchronous-ish, `requestThumbnail` must not assume the handle is created before the first callback fires. Create and register the entry in `inFlight` *before* awaiting, and have `cancel()` tolerate being called on an already-settled entry.

#### 4.5.4 `useThumbnail` — observer, state, cancellation

```ts
type ThumbnailState = 'idle' | 'pending' | 'loaded' | 'failed';

function useThumbnail(path: string): {
  ref: (el: HTMLElement | null) => void;   // attach to the tile's media element
  state: ThumbnailState;
  src: string | null;                      // object URL while state === 'loaded'
};
```

1. The hook takes the explorer body's scroll element from `useExplorerScroll()` (T026's `ExplorerScrollContext`) and uses it as the observer `root`. The context value is `null` until the body mounts (and in an isolated test render without a provider); in that case do not create an observer yet, and create it when the element arrives (the hook re-runs because the value is state). For an isolated test that wants the viewport, render inside an `ExplorerScrollContext.Provider` with `document.body`.
2. One **shared** `IntersectionObserver` per scroll root, created lazily in a module-level `WeakMap<Element | null, ObserverRecord>` and holding an `Element → callback` map. Thousands of individual observers would be wasteful; one observer with thousands of targets is the supported pattern.
3. Options: `{ root, rootMargin: '100% 0px', threshold: 0 }`. `100%` of the root's height above and below is exactly the "one-viewport root margin" of FR-14.9. (Decision (not specified): the margin is vertical only — the grid never scrolls horizontally, so a horizontal margin would be dead weight.)
4. On `isIntersecting: true` with `state === 'idle'`, set `state = 'pending'` and call `requestThumbnail`, storing the handle in a ref.
5. On `isIntersecting: false`, **cancel the handle if the request has not completed**, and reset `state` from `'pending'` back to `'idle'` so re-entry re-requests. Do **not** discard a `'loaded'` or `'failed'` result: a completed thumbnail costs nothing to keep while its tile is mounted, and re-requesting it on every scroll reversal would defeat the point of the cap.

   **Decision (not specified): cancel at the one-viewport boundary rather than adding a second, wider "far out of view" observer.** FR-14.9 says "cancelled when a tile scrolls far out of view"; with a one-viewport root margin, the cancellation boundary is already a full viewport beyond the visible area, which is "far" by any reasonable reading, and a single observer keeps the mechanism testable. If scroll-direction thrashing shows up in the T028 measurement pass, the escalation is a second observer at `rootMargin: '300% 0px'` that owns cancellation while the inner one owns enqueueing — note that as a follow-up, do not build it speculatively.
6. On unmount: unobserve the element, cancel the handle, and revoke any object URL that has not yet been revoked by a `load`.
7. Never retry automatically. A `'failed'` tile stays failed until it is unmounted and recreated (which a directory change or T028's virtualizer will do). FR-14.9's "silently falls back" forbids retry storms on a folder full of corrupt files.

#### 4.5.5 `Thumbnail.tsx` — the failure fallback

```tsx
const { ref, state, src } = useThumbnail(entry.path);

return (
  <div ref={ref} className={styles.media}>
    {state === 'loaded' && src
      ? <img src={src} alt="" … />
      : <Icon icon={ImageIcon} className={state === 'pending' ? styles.iconPending : styles.icon} />}   {/* T022 Icon: decorative (aria-hidden) by default */}
  </div>
);
```

- `'idle'` and `'pending'` render the generic `Image` icon, optionally at reduced opacity while pending. Do **not** render a `Spinner` per tile — a hundred spinners is visual noise and an animation cost.
- `'failed'` renders the same generic `Image` icon with no badge, no tooltip and no error text. A corrupt file must be indistinguishable from an ordinary un-loaded tile (§5.6 step 5).
- `alt=""` on the thumbnail image: the tile's accessible name already carries the entry name, and a duplicate alt text would make every tile read twice. (Decision (not specified).)
- Respect `prefers-reduced-motion: reduce` by skipping any fade-in on load.

### 4.6 Keyboard navigation in grid mode (FR-14.8)

FR-14.8 requires `role="grid"` with `aria-activedescendant`, and arrow keys in two dimensions.

#### 4.6.1 Valid `role="grid"` markup over an `auto-fill` grid

`role="grid"` requires `role="row"` children containing `role="gridcell"` cells, but a CSS `auto-fill` grid has no DOM rows and its column count is decided by the browser. Resolve it with `display: contents` row wrappers plus a measured column count:

```tsx
<div
  ref={gridRef}
  role="grid"
  tabIndex={0}
  aria-label="Folder contents"
  aria-colcount={columns}
  aria-rowcount={rowCount}
  aria-activedescendant={activeIndex >= 0 ? `slydr-entry-${activeIndex}` : undefined}
  data-tile-min={tileMin}
  data-virtualized="false"        // the T028 variant renders "true"
  onKeyDown={onKeyDown}
  onClick={onClick}               // delegated: closest('[role=gridcell]'), see §4.3
  onDoubleClick={onDoubleClick}
  onPointerUp={onPointerUp}
  className={styles.grid}
>
  {rows.map((rowEntries, rowIndex) => (
    <div key={rowIndex} role="row" aria-rowindex={rowIndex + 1} className={styles.row}>
      {rowEntries.map((entry, colIndex) => (
        <EntryTile key={entry.path} entry={entry} index={rowIndex * columns + colIndex}
                   aria-colindex={colIndex + 1} … />
      ))}
    </div>
  ))}
</div>
```

```css
.row { display: contents; }
```

`display: contents` makes the row wrapper invisible to layout, so the tiles remain direct grid items of the `auto-fill` grid and the §10 track sizes behave exactly as written, while the accessibility tree sees valid rows. (Decision (not specified): this markup strategy. The alternative — a flat list of `role="gridcell"` children with no rows — is invalid ARIA and screen readers handle it inconsistently.)

#### 4.6.2 `gridMetrics.ts`: one source for the column count

This ticket creates `client/src/screens/Explorer/gridMetrics.ts`. T028 (virtualized grid) and T035 (responsive pass) import it; none of them re-declares any of it. The column count used for keys, ARIA and (in T028) layout is **always computed with `columnsFor`**, never read back from the computed style, so the non-virtualized and the virtualized grids cannot disagree by a column at an odd width.

```ts
export const GRID_MIN_TILE_PX = { base: 104, md: 132, lg: 160 } as const;

/** Mirrors CSS repeat(auto-fill, minmax(minTilePx, 1fr)) with a column gap of gapPx. */
export function columnsFor(containerWidth: number, gapPx: number, minTilePx: number): number {
  return Math.max(1, Math.floor((containerWidth + gapPx) / (minTilePx + gapPx)));
}

/** 104 below 768 px, 132 from 768 px, 160 from 1024 px; driven by matchMedia 'change' events. */
export function useTileMin(): 104 | 132 | 160;

/**
 * Column count of the grid element: columnsFor(contentWidth, gap, tileMin), re-measured by a
 * ResizeObserver on gridEl. contentWidth = clientWidth - paddingLeft - paddingRight; gap = columnGap.
 */
export function useGridColumns(gridEl: HTMLElement | null, override?: number): number;
```

1. `containerWidth` is the grid's **content width** (its `clientWidth` minus left and right padding); the gap is `parseFloat(getComputedStyle(gridEl).columnGap) || 0` (`normal` parses to NaN, so 0) and the padding is read the same way, because both come from tokens. The formula is the exact inverse of how a browser resolves `auto-fill`.
2. `useTileMin()` uses `useSyncExternalStore` over `window.matchMedia('(min-width: 1024px)')` and `('(min-width: 768px)')` and their `change` events. Do not compare `window.innerWidth` by hand: under browser zoom the viewport width can be fractional and the media query is the only value that agrees with the CSS. The grid element carries `data-tile-min="104" | "132" | "160"` so tests (no CSS engine) can assert on it.
3. `useGridColumns` re-measures on a `ResizeObserver` of the grid element (window resizes, breakpoint crossings, the explorer header wrapping to two rows) and returns at least `1`. When the element is null, or `jsdom` reports zero widths, return `1`. The optional `override` parameter (tests only) pins the column count so keyboard arithmetic can be tested without layout.
4. Round the content width before comparing it with the previous measurement so sub-pixel `ResizeObserver` noise does not cause re-renders.

#### 4.6.3 Key handling

Operate on the flat index into `entries`; `columns` converts between flat and two-dimensional.

| Key | Action |
|---|---|
| `ArrowRight` | `index + 1`, clamped to `entries.length - 1` |
| `ArrowLeft` | `index - 1`, clamped to `0` |
| `ArrowDown` | `index + columns`; if that exceeds the last index, clamp to the last index |
| `ArrowUp` | `index - columns`; if negative, stay |
| `Home` | `0` |
| `End` | `entries.length - 1` |
| `Enter` | navigate into the highlighted entry **only** when its type is `folder`; otherwise do nothing |
| `Backspace` | up one level; no-op when `parentPath === null` |
| `Alt+ArrowLeft` | up one level; `preventDefault` so the browser does not navigate history |

- All four arrows, `Home`, `End` and `Backspace` call `preventDefault()` so the page does not scroll and the browser does not go back.
- `ArrowLeft` and `ArrowRight` move by one in flat order, so they walk from the end of one row to the start of the next. They do not wrap at the collection ends. (Decision (not specified): flat-order movement rather than row-bounded movement, because it matches how the eye reads the grid and makes every entry reachable with a single key.)
- From `activeIndex === -1`, any arrow key highlights index `0`.
- After a highlight move, scroll the active tile into view with `tileEl.scrollIntoView({ block: 'nearest' })`. T028 replaces this with the virtualizer's `scrollToIndex`.
- Tiles are never tab stops; the grid container is the single tab stop, exactly as the listbox is in list view.

Reuse the highlight state from `useEntryHighlight` so switching view modes keeps the highlighted entry. (Decision (not specified): the highlight survives a view-mode switch, because losing it would be surprising.)

### 4.7 Wiring the view mode

Replace the T026 seam:

```tsx
function renderBody() {
  if (viewMode === 'grid') return <EntryGrid entries={data.entries} … />;
  return <EntryList entries={data.entries} … />;
}
```

- The view-mode toggle already lives in the header and already calls `actions.setViewMode`; T024's persistence effect (through T023) debounces it to `slydr.explorer.viewMode` at 250 ms. This ticket must verify the round trip fully: pressing "Grid view", reloading, and landing in grid view.
- A corrupt or unknown stored value degrades to `"list"` silently through the validating reader (§6.2). Add a test for a stored `"mosaic"`.
- All four FR-14.10 states are shared: skeletons during the first load become **skeleton tiles** in grid mode (Decision (not specified): render 24 skeleton tiles, since a grid shows far more entries per screen than a list); the empty message, the inline retryable error and the truncation notice are rendered by `Explorer.tsx` and need no change.

## 5. Acceptance criteria

- [ ] `client/src/screens/Explorer/` contains `EntryGrid.tsx`, `EntryTile.tsx`, `Thumbnail.tsx`, `thumbnailQueue.ts` (real implementation, replacing T026's stub), `gridMetrics.ts`, `useThumbnail.ts`, `useGridHighlight.ts` and their CSS Modules, and `Explorer.tsx`'s `renderBody()` renders `<EntryGrid>` for `viewMode === 'grid'`.
- [ ] `thumbnailQueue.ts` contains no `fetch(` and no size constant; it calls `fetchThumbnailBlob(path, DEFAULT_THUMB_SIZE, signal)`; `npm run lint` (T025's `no-restricted-globals`) and `client/test/no-outbound-requests.test.ts` pass.
- [ ] `EntryTile` has no event handlers and no `tabIndex`; `EntryGrid` attaches click, double-click and pointer-up handlers once on the `role="grid"` container; `npm run lint` is clean with the `jsx-a11y` preset and no disable comments.
- [ ] `cancelAllThumbnails()` empties the queue, aborts every in-flight request without calling `onLoad` or `onError`, returns `__inFlightCount()` to 0, and lets a following `requestThumbnail` start at once.
- [ ] `gridMetrics.ts` is the only place the 104 / 132 / 160 minimums and `columnsFor` are defined (T028 and T035 import it).
- [ ] The computed `grid-template-columns` is `repeat(auto-fill, minmax(104px, 1fr))` below 768 px, `repeat(auto-fill, minmax(132px, 1fr))` from 768 px to 1023 px, and `repeat(auto-fill, minmax(160px, 1fr))` at 1024 px and above.
- [ ] No horizontal page scrolling at a 320 px viewport in grid mode; tiles stay square.
- [ ] An `image` entry renders an `<img>` whose request URL is `/api/thumb?path=…&size=256`; `folder` and `file` entries render the `lucide-react` `Folder` and `File` icons and issue no thumbnail request.
- [ ] Thumbnails are requested with `DEFAULT_THUMB_SIZE` (`256`, one of `128 | 256 | 384 | 512`); no other `size` value and no `THUMB_SIZE` constant appears in the grid code.
- [ ] The tile name is clamped to two lines and the tile carries a `title` attribute with the full name.
- [ ] With 100 image tiles all intersecting at once, `__inFlightCount()` never exceeds **6**, and the remaining requests are queued and dispatched as slots free.
- [ ] The `IntersectionObserver` is created with `rootMargin: '100% 0px'` and the explorer body element as its `root`.
- [ ] A tile that leaves the observed range while still pending has its request cancelled: the queued entry is dropped, or the in-flight `AbortController` reports `signal.aborted === true`.
- [ ] An aborted request calls neither `onLoad` nor `onError`.
- [ ] A `500 THUMBNAIL_FAILED` response renders the generic `Image` icon with no error text, no banner and no retry, and the other tiles in the grid still load.
- [ ] A `415 UNSUPPORTED_IMAGE` response behaves identically.
- [ ] The object URL handed to an `<img>` is revoked in the image's `load` handler, and on unmount when `load` never fired.
- [ ] A grid of tiles whose responses all resolve from cache drains without any artificial delay — `drain()` contains no timer, `setTimeout` or `requestAnimationFrame`.
- [ ] The grid container has `role="grid"`, `tabIndex={0}`, `aria-activedescendant`, `aria-colcount` and `aria-rowcount`; rows are `role="row"` with `display: contents`; tiles are `role="gridcell"` and are not tab stops.
- [ ] `ArrowRight` / `ArrowLeft` move by one entry, `ArrowDown` / `ArrowUp` move by the measured column count, `Home` / `End` jump to the ends, and all of them clamp without wrapping.
- [ ] `Enter` opens a highlighted folder and does nothing on an image or other file; `Backspace` and `Alt+←` go up one level.
- [ ] `useGridColumns` returns `columnsFor(contentWidth, gap, tileMin)` (for example 5 for a 900 px content width, 12 px gap and 160 px minimum), and re-measures when a `ResizeObserver` callback fires.
- [ ] Pressing "Grid view" writes `slydr.explorer.viewMode = "grid"`, and a reload lands in grid view; a stored value of `"mosaic"` degrades to list view with no error.
- [ ] Both themes pass a WCAG AA contrast check on the tile name text and the focus ring; hidden tiles carry no hidden-specific styling (no reduced opacity).

## 6. Tests to write

Vitest + React Testing Library (`jsdom`), per spec §12.3. All tests live under `client/test/screens/Explorer/` and import `describe`, `it`, `expect`, `vi` from `'vitest'`. `jsdom` implements neither `IntersectionObserver` nor `URL.createObjectURL` reliably, so `client/test/helpers/intersectionObserver.ts` installs a controllable stub exposing `triggerIntersect(element, isIntersecting)` and recording the constructor options, plus stubs for `URL.createObjectURL` / `revokeObjectURL` that count calls (restore them in the returned dispose function). The queue tests `vi.mock('../../../src/api/client')` to replace `fetchThumbnailBlob` with a factory returning manually resolvable promises (keeping the real `isAbortError` and `ApiClientError`) so the in-flight cap can be observed between settles. No test stubs `globalThis.fetch` for the queue: the queue does not call it.

**`client/test/screens/Explorer/thumbnailQueue.test.ts`**

- `describe('thumbnailQueue')`
  - `it('exports MAX_IN_FLIGHT as 6 and requests DEFAULT_THUMB_SIZE (256) from fetchThumbnailBlob')`
  - `it('contains no direct fetch call')` (reads the source file with `node:fs` and asserts there is no `fetch(`, complementing T025's static scan)
  - `it('cancelAllThumbnails drops every queued request without starting it')`
  - `it('cancelAllThumbnails aborts every in-flight request, calls neither onLoad nor onError, and returns the in-flight count to 0')`
  - `it('starts a new request immediately after cancelAllThumbnails')`
  - `it('cancelAllThumbnails is idempotent and safe with nothing queued')`
  - `it('starts a request immediately when a slot is free')`
  - `it('never exceeds 6 requests in flight when 50 requests are enqueued')`
  - `it('dispatches the next queued request as soon as one settles')`
  - `it('dispatches queued requests in first-in-first-out order')`
  - `it('coalesces a second request for the same key into the existing one')`
  - `it('removes a queued request on cancel without starting it')`
  - `it('aborts an in-flight request on cancel and marks the signal aborted')`
  - `it('calls neither onLoad nor onError when a request is aborted')`
  - `it('frees the slot when a request is aborted so a queued request starts')`
  - `it('calls onLoad with an object URL on a 200 response')`
  - `it('calls onError when fetchThumbnailBlob rejects with THUMBNAIL_FAILED (500)')`
  - `it('calls onError when fetchThumbnailBlob rejects with UNSUPPORTED_IMAGE (415)')`
  - `it('calls onError when fetchThumbnailBlob rejects with a network failure (READ_FAILED, status 0)')`
  - `it('tolerates cancel being called after the request has already settled')`
  - `it('drains synchronously with no timer when every response resolves from cache')`

**`client/test/screens/Explorer/useThumbnail.test.tsx`**

- `describe('useThumbnail')`
  - `it('creates the IntersectionObserver with the explorer body (from ExplorerScrollContext) as root and a 100% vertical root margin')`
  - `it('creates no observer until the scroll element is available')`
  - `it('enqueues no request before the tile intersects')`
  - `it('enqueues a request when the tile intersects')`
  - `it('cancels a pending request when the tile stops intersecting')`
  - `it('re-requests when a cancelled tile intersects again')`
  - `it('keeps a loaded thumbnail when the tile stops intersecting')`
  - `it('does not retry automatically after a failure')`
  - `it('revokes the object URL in the image load handler')`
  - `it('revokes the object URL on unmount when load never fired')`
  - `it('unobserves and cancels on unmount')`

**`client/test/screens/Explorer/EntryGrid.test.tsx`**

- `describe('Explorer grid view')`
  - `it('renders one tile per entry in the order returned by the server')`
  - `it('requests a thumbnail of size 256 for image entries only')` (asserts the mocked `fetchThumbnailBlob` call arguments)
  - `it('gives tiles no event handlers and no tabindex; pointer handling is on the grid container')`
  - `it('ignores a click inside the grid that is not on a tile')`
  - `it('renders the Folder icon for folder entries and issues no thumbnail request')`
  - `it('renders the File icon for other file entries and issues no thumbnail request')`
  - `it('clamps the tile name to two lines and sets a title attribute with the full name')`
  - `it('renders hidden entries without reduced opacity or hidden-specific styling, keeps data-hidden and the visually hidden ", hidden" suffix')`
  - `it('renders skeleton tiles while the first listing is loading')`
  - `it('renders the generic image icon and no error text when a thumbnail returns 500')`
  - `it('keeps loading the remaining tiles after one thumbnail fails')`
  - `it('highlights a tile on a single click without navigating')`
  - `it('navigates into a folder on a double click')`
  - `it('does nothing when an image tile is double clicked')`

**`client/test/screens/Explorer/EntryGrid.keyboard.test.tsx`**

- `describe('Explorer grid keyboard access')`
  - `it('exposes the grid as role=grid with aria-activedescendant, aria-colcount and aria-rowcount')`
  - `it('wraps tiles in role=row groups that use display: contents')`
  - `it('marks tiles as gridcell with aria-selected and no tab stop')`
  - `it('moves one entry right with ArrowRight and one left with ArrowLeft')`
  - `it('moves one row down with ArrowDown using the measured column count')`
  - `it('moves one row up with ArrowUp using the measured column count')`
  - `it('clamps ArrowDown at the last entry on a partially filled final row')`
  - `it('jumps to the first and last entry with Home and End')`
  - `it('prevents default on the arrow keys so the page does not scroll')`
  - `it('opens a highlighted folder with Enter and ignores Enter on an image')`
  - `it('goes up one level with Backspace and with Alt+ArrowLeft')`
  - `it('keeps the highlighted entry when the view mode switches from list to grid')`

**`client/test/screens/Explorer/gridMetrics.test.tsx`**

- `describe('columnsFor')`
  - `it('returns 2 for a 288 px content width with a 12 px gap and a 104 px minimum')`
  - `it('returns at least 1 for a zero or negative width')`
  - `it('matches the CSS auto-fill result at 320, 768, 1024 and 1920 px')` (a table computed by hand from the formula)
- `describe('useTileMin')`
  - `it('returns 104 below 768 px, 132 from 768 px and 160 from 1024 px')` (uses `client/test/helpers/matchMedia.ts`)
  - `it('updates when a matchMedia change event fires')`
  - `it('unsubscribes on unmount')`
- `describe('useGridColumns')`
  - `it('returns columnsFor(contentWidth, gap, tileMin) from the measured grid box')` (faked `clientWidth` and `getComputedStyle`)
  - `it('returns 1 when the element is null or reports zero width')`
  - `it('re-measures when the ResizeObserver callback fires')`
  - `it('honours the test-only override')`

**`client/test/screens/Explorer/Explorer.viewMode.test.tsx`**

- `describe('Explorer view mode persistence')`
  - `it('renders list view when slydr.explorer.viewMode is absent')`
  - `it('renders grid view when slydr.explorer.viewMode is "grid"')`
  - `it('falls back to list view for an unrecognised stored value')`
  - `it('stores "grid" when the grid button is pressed')`
  - `it('keeps working when localStorage throws')`

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit and component tests; `npm test` green.
- [ ] `@tanstack/react-virtual` is **not** introduced here; that is T028.
- [ ] Manually verified against a real folder of at least 300 images: scrolling fast never exceeds six concurrent `/api/thumb` requests in the browser network panel, and requests for tiles scrolled past show as cancelled.
- [ ] Manually verified that a deliberately corrupted image file renders the generic icon and breaks nothing else in the grid.
- [ ] Verified in both light and dark themes, and at 320 px, 768 px, 1024 px and 1920 px viewport widths.
- [ ] Keyboard-only walkthrough in grid mode: arrow across and down, open a folder with `Enter`, go back up with `Backspace`.
- [ ] The view-mode choice survives a page reload.
- [ ] Manually verified with a screen reader on Safari/VoiceOver (and one other browser) that the `role="grid"` / `role="row"` (`display: contents`) / `role="gridcell"` structure is announced as rows and columns (older Safari releases have dropped the semantics of `display: contents` elements); report the result in the PR.
- [ ] Manually verified in the network panel that starting a folder navigation while thumbnails are loading cancels the pending `/api/thumb` requests.
- [ ] README: no change; T041 creates the README.

## 8. Notes and gotchas

- **Square crops are intended.** §16.1 assumption **A4**: "Thumbnails are square-cropped (`fit: cover`) in grid view." If that is wrong the fix is a server change to `fit: 'inside'` plus letterboxed tiles — not a client-side `object-fit: contain`, which would show inconsistent tile content against a cropped source.
- **The six-in-flight cap must be global, not per component.** Once T028 virtualizes the grid, tiles mount and unmount continuously. A cap held in React state or in a per-component ref would reset and the real concurrency would drift far above six. That is why `thumbnailQueue.ts` is a plain module.
- **Cancellation must free the slot.** The easiest bug here is aborting an in-flight request without decrementing the in-flight set, which silently stalls the queue after six cancellations. The `drain()`-on-settle rule covers abort because an aborted `fetch` still settles — make sure the `finally` block, not just the success path, removes the entry.
- **`display: contents` and borders.** An element with `display: contents` generates no box, so it cannot carry a background, border, padding or transform. Keep the row wrappers purely structural; all visual styling belongs on the tiles.
- **Safari and `line-clamp`.** `-webkit-line-clamp` needs `display: -webkit-box` and `-webkit-box-orient: vertical` together; dropping either silently disables the clamp. Keep all three declarations.
- **The column count is computed, not read back.** `getComputedStyle(...).gridTemplateColumns` is unusable in `jsdom` (it returns the authored value or `none`) and could disagree with T028's computation at an odd width. `gridMetrics.ts` computes the count with `columnsFor`; tests fake `clientWidth`, `columnGap` and padding, or pass the `override`.
- **Connection pressure.** The cap of six equals a browser's per-host HTTP/1.1 connection limit. While the old rows stay mounted during a navigation (T026), their pending thumbnails would delay the new `list` request, hence `cancelAllThumbnails()` at the start of every user navigation (decision, spec FR-14.9 amended).
- **Do not add a per-tile spinner.** Hundreds of simultaneous CSS animations cost real frames and work against NFR-4's 60 fps goal. The pending state is a static icon.
- **Never show a thumbnail error to the user.** §5.6 step 5 and FR-14.9 both say the fallback is silent. A badge, tooltip or banner on a failed tile would turn one corrupt file in a 3000-image folder into a wall of warnings.
- **`alt=""` is deliberate.** With a non-empty `alt` every tile is announced twice, once for the image and once for the tile's own accessible name.
- **The thumbnail cache is invisible in-app.** §16.1 assumption **A8**: clearing it is a documented manual folder delete, so do not add a "refresh thumbnails" control.
- **Thumbnail size is a tuning item.** §16.2 item 3 flags both the 256 px default and the 500 MB cache cap as values to revisit after measuring on a real library. Keeping the size in one place (`DEFAULT_THUMBNAIL_SIZE` in `@slydr/shared`) is what makes that revisit cheap.
- **Do not re-sort.** The server has already applied folders-first plus the numeric collator (§4.2 / FR-14.4). The grid reads `entries` in order, row-major.
