# T028 — Virtualize the explorer for large folders

**Epic:** E13
**Spec sections:** NFR-2, NFR-3, §5.3, §2.3
**Depends on:** T026, T027
**Estimated size:** L

---

## 1. Context

Slydr's file explorer already renders a folder in list view (T026) and in grid view with lazy thumbnails (T027). Both render one DOM node per entry, which is correct for the typical folder and fatal for a photo library: a folder of 5,000 images means 5,000 rows or tiles, each with its own event handlers, and a scroll that stutters long before the thumbnail queue becomes the bottleneck. The server will return up to `MAX_ENTRIES = 10000` entries for one directory (spec §5.3), so the client has to cope with that size.

This ticket adds windowing with `@tanstack/react-virtual` (the library fixed by spec §2.3) to both explorer views once a folder holds more than 200 entries. Below that threshold nothing changes. The work is mostly about *preserving* what T026 and T027 already guarantee — `role="listbox"` / `role="grid"` with `aria-activedescendant`, keyboard navigation, the six-request thumbnail cap, the header and footer, the truncation notice — while the DOM underneath it becomes a moving window. It ends with a concrete, repeatable measurement procedure that proves NFR-2 on a real 2,000-entry and 10,000-entry folder.

## 2. Scope

### In scope

- Using `@tanstack/react-virtual` (v3), which T001 already installed in `client/package.json`; this ticket adds no dependency.
- A virtualized variant of the list view (`VirtualEntryList`) and of the grid view (`VirtualEntryGrid`), selected by `Explorer.tsx` when the entry count crosses the threshold, with the hysteresis rule of §4.2.
- Grid virtualization **by rows**: column count from T027's `gridMetrics.ts` (`columnsFor`, `useTileMin`, the 104 / 132 / 160 px minimums), row height derived from the tile, correct behaviour on resize and breakpoint changes.
- Keeping `aria-activedescendant` valid: the highlighted item is always rendered, even when it is outside the overscan window, and ids stay `slydr-entry-{index}` with `index` the position in `entries`.
- Collection-size announcements for screen readers: `aria-setsize` / `aria-posinset` on virtualized list options and `aria-rowindex` / `aria-colindex` on virtualized grid rows and cells.
- Replacing `scrollIntoView` with the virtualizer's `scrollToIndex` for highlight moves, and adding `Home`, `End`, `PageUp` and `PageDown` behaviour in virtualized mode (and `PageUp` / `PageDown` in non-virtualized mode so the two modes behave the same).
- Keeping the `IntersectionObserver` thumbnail loading and the six-in-flight cap of T027 intact when tiles mount and unmount during scrolling.
- Keeping the header, the footer, the notices region and the identity of the single scroll container unchanged.
- Delegated pointer handling on the virtualized containers (same pattern as T026/T027).
- A measurement procedure with pass/fail thresholds, and the fixture script it needs.
- Unit and component tests per spec §12.3, under `client/test/`.

### Out of scope

- **Server-side listing speed.** The 500 ms warm-cache target for a 2,000-entry listing belongs to the listing service and route (T011, T012). This ticket *measures* it and reports a failure against those tickets; it does not change server code.
- **The fixture generator.** T037 owns the reusable test-fixture generator. This ticket uses it if it is already merged and otherwise uses the one-off script in §4.10, which is not committed.
- **Responsive CSS for the header, footer and configuration column — T035.** The grid-column maths (`gridMetrics.ts`) is owned by T027 and imported by this ticket and by T035; this ticket restyles nothing.
- **The thumbnail queue itself — T027.** `thumbnailQueue.ts` and `useThumbnail.ts` are consumed unchanged.
- **Changing the thumbnail cache, the thumbnail size or the cap.** `THUMB_SIZE = 256` and `MAX_IN_FLIGHT = 6` stay as T027 defined them.
- **A "load more" or paged UI** for folders above 10,000 entries. The server truncates and T026 already shows the notice.
- **Client-side sorting or filtering.** The server order is rendered as received.
- **Virtualizing the skeleton states.** Skeletons are a fixed 12 rows or 24 tiles.
- **Playlist virtualization.** The player never renders the list of images.

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** with three packages — `shared/`, `server/` and `client/`. Everything is ESM (`"type": "module"`) and TypeScript in strict mode. The client is **Vite 7 + React 19**, styled with **CSS Modules** over the design tokens in `client/src/styles/tokens.css`. Tests run under **Vitest with React Testing Library** in the `jsdom` environment. The shared class-name helper is `cx` in `client/src/lib/cx.ts`.

### From `@slydr/shared`

```ts
export type EntryType = 'folder' | 'image' | 'file';
export interface FsEntry {
  name: string; path: string; type: EntryType; hidden: boolean;
  size: number | null; mtimeMs: number | null;
}
export interface ListResponse {
  path: string; name: string; parentPath: string | null;
  entries: FsEntry[];
  counts: { folders: number; images: number; files: number };
  truncated: boolean;          // true when the directory held more than MAX_ENTRIES
}
export const MAX_ENTRIES = 10000;
```

### From T026 — `client/src/screens/Explorer/`

```
Explorer.tsx            shell; holds the scrollable body element (.body, data-explorer-scroll) in state and
                        provides it through ExplorerScrollContext; contains the single renderBody() seam
ExplorerScrollContext.ts  useExplorerScroll(): HTMLElement | null
ExplorerNotices.tsx     banners (restore notice, inline error, truncation notice), OUTSIDE the scroller
EntryList.tsx           role="listbox" region; rows are role="option"; pointer handlers delegated on the container
EntryRow.tsx            one row: icon, name, size; no handlers, no tabIndex
useEntryHighlight.ts    highlight index + keyboard navigation + scrollIntoView + handleEntryPointer(kind, index)
useDirectoryListing.ts  requestedPath, fetch, abort, loading / error state
copy.ts                 every user-visible string
```

Facts this ticket relies on, all from T026:

- The body element (`.body`, `overflow-y: auto`) is the **only** scroll container. The header, the notices region and the footer are siblings of it in a flex column, not children.
- Rows have a **fixed** height: `--explorer-row-h: 48px`, raised to `56px` under `@media (pointer: coarse)`. T026 chose a fixed height on purpose so this ticket could use an exact estimate.
- The listbox is `role="listbox"`, `tabIndex={0}`, `aria-label="Folder contents"`, `aria-activedescendant={activeIndex >= 0 ? \`slydr-entry-${activeIndex}\` : undefined}`. Each row is `id="slydr-entry-{index}"`, `role="option"`, `aria-selected`, never focusable and without event handlers (click, double-click and pointer-up are delegated on the listbox via `closest('[role=option]')`).
- **Banners never live inside the scroller.** The truncation `Banner` ("This folder has more than 10,000 items. Showing the first 10,000."), the inline error `Banner` and the restore notice render in the notices region between the header and the body, so the entry region always starts at scroll offset 0. This ticket therefore needs no scroll-margin logic.
- Loading state: 12 skeleton rows in list mode, 24 skeleton tiles in grid mode, `aria-busy="true"`.

### From T027 — `client/src/screens/Explorer/`

```
EntryGrid.tsx / EntryTile.tsx / Thumbnail.tsx
thumbnailQueue.ts       MAX_IN_FLIGHT = 6, requestThumbnail(), cancelAllThumbnails(), __inFlightCount(),
                        __queueLength(), __reset(); calls fetchThumbnailBlob (T025) with DEFAULT_THUMB_SIZE
useThumbnail.ts         shared IntersectionObserver per scroll root (from useExplorerScroll()), rootMargin '100% 0px',
                        cancels on leave and on unmount, revokes object URLs
gridMetrics.ts          GRID_MIN_TILE_PX = { base: 104, md: 132, lg: 160 }, columnsFor(containerWidth, gapPx, minTilePx),
                        useTileMin(), useGridColumns(gridEl, override?)
useGridHighlight.ts     two-dimensional arrow navigation; reuses useEntryHighlight state; pointer handling delegated
                        on the role="grid" container via closest('[role=gridcell]')
```

Facts this ticket relies on, all from T027:

- The non-virtualized grid is CSS `repeat(auto-fill, minmax(Npx, 1fr))` with N = 104 below 768 px, 132 from 768 px, 160 from 1024 px; `gap: var(--space-3)`; `padding: var(--space-3) var(--space-4)`. Its column count in JavaScript comes from `columnsFor` in `gridMetrics.ts`, not from the computed style.
- Tiles are square media plus a two-line name with `min-height: 2.5em`, so **every tile in a given grid has the same height**. T027 reserved that uniformity explicitly so rows could be virtualized.
- The non-virtualized grid wraps tiles in `role="row"` elements with `display: contents` so the accessibility tree is valid. A `display: contents` element has no box, so it **cannot be positioned**. The virtualized grid therefore needs real row boxes (§4.4).
- `useThumbnail` already cancels a pending request in its unmount cleanup and unobserves the element. The queue is a plain module, so its cap is global across mounts. The `IntersectionObserver` root is the body element.

### Test environment facts

- `jsdom` has no layout engine: `clientHeight`, `offsetHeight`, `getBoundingClientRect()` and `ResizeObserver` all return zero or do not exist. `@tanstack/react-virtual` renders **nothing** for a scroller that measures zero. §6 therefore requires a shared test helper (`client/test/helpers/virtualGeometry.ts`) that fakes the geometry.
- `Element.prototype.scrollTo` is not implemented by `jsdom`; the helper installs a spy.
- T027 added a controllable `IntersectionObserver` stub at `client/test/helpers/intersectionObserver.ts`, and T021 a `matchMedia` stub at `client/test/helpers/matchMedia.ts` (`setMatches(query, boolean)`). Reuse both; do not create third copies.

### Dependency

`@tanstack/react-virtual` `^3.13.12` is already in `client/package.json` (T001). Nothing is installed here. Do not add `@tanstack/virtual-core` directly; `defaultRangeExtractor` and `useVirtualizer` are both re-exported by `@tanstack/react-virtual`.

## 4. Implementation detail

### 4.1 Files

Create:

```
client/src/screens/Explorer/
  virtualization.ts             thresholds, overscan constants, useVirtualizationMode()
  useVirtualList.ts             useVirtualizer configuration for the list
  useVirtualGrid.ts             column measurement (via gridMetrics.ts) + useVirtualizer configuration for the grid
  VirtualEntryList.tsx          the windowed role="listbox"
  VirtualEntryList.module.css
  VirtualEntryGrid.tsx          the windowed role="grid"
  VirtualEntryGrid.module.css
client/test/helpers/
  virtualGeometry.ts            jsdom geometry fake for the virtualizer (test-only)
```

`gridMetrics.ts` (`GRID_MIN_TILE_PX`, `columnsFor`, `useTileMin`, `useGridColumns`) already exists from T027 and is **imported, not recreated or redeclared**. The only grid constant added here is `TILE_NAME_BLOCK_PX` (§4.4), kept next to the virtual grid code in `useVirtualGrid.ts`. T035 imports `columnsFor` and `GRID_MIN_TILE_PX` from `gridMetrics.ts` too.

Modify:

- `Explorer.tsx` — choose the variant in `renderBody()` and reset scroll on a path change. (`data-explorer-scroll` already exists on the body element from T026.)
- `useEntryHighlight.ts` and `useGridHighlight.ts` — accept an optional `reveal(index)` callback and a `pageSize()` callback (§4.7).
- `EntryRow.tsx` and `EntryTile.tsx` — accept optional `style`, `aria-setsize`, `aria-posinset`, `aria-colindex` and a `ref` pass-through so the virtual variants can reuse them without copying markup. Their default rendering must stay byte-identical, and they still carry no event handlers.

No new user-visible strings are added. Do not touch `copy.ts` unless a lint rule requires it. Tests live under `client/test/screens/Explorer/` and import `describe`, `it`, `expect`, `vi` from `'vitest'`.

### 4.2 Threshold and hysteresis (NFR-2)

NFR-2 says the explorer stays interactive "via virtualization above 200 entries". Define the constants in one module:

```ts
// client/src/screens/Explorer/virtualization.ts
export const VIRTUALIZE_ABOVE = 200;     // NFR-2: virtualize when entries.length > 200
export const DEVIRTUALIZE_BELOW = 180;   // hysteresis floor, see below
export const LIST_OVERSCAN = 8;          // rows rendered beyond each edge of the viewport
export const GRID_OVERSCAN = 2;          // grid rows rendered beyond each edge
```

`useVirtualizationMode(path: string, count: number): boolean` returns whether the current listing is virtualized.

**Decision (not specified): a hysteresis band of 20 entries, with the mode reset when the folder changes.** The behaviour:

1. On the first render for a given `path`, the answer is `count > VIRTUALIZE_ABOVE` (so 200 entries are *not* virtualized and 201 are).
2. While the `path` is unchanged, once the answer is `true` it stays `true` until `count < DEVIRTUALIZE_BELOW`. Once `false`, it flips to `true` only above `VIRTUALIZE_ABOVE`.
3. A change of `path` discards the remembered mode and starts again at step 1.

(NFR-2 says "above 200 entries"; the 180 to 200 band is a deliberate deviation for a folder that is already virtualized. State it in the PR description so a reviewer does not read it as a bug.)

Why: the entry count of one folder can change without leaving it — the user toggles "Show hidden items" and 205 entries become 196, or the reverse. Without hysteresis, that toggle swaps the entire body between two component trees, which remounts every row and tile, drops the highlighted element (and with it `aria-activedescendant`), loses the scroll position and cancels every in-flight thumbnail. With the band, a folder that hovers around the threshold keeps one mode. The cost is that between 180 and 200 entries a previously virtualized folder stays virtualized, which is harmless: a virtualizer with all items inside the window renders them all.

Implementation sketch (a ref, not state, so the mode never lags a render):

```ts
export function useVirtualizationMode(path: string, count: number): boolean {
  const memo = useRef<{ path: string; virtual: boolean } | null>(null);
  if (memo.current === null || memo.current.path !== path) {
    memo.current = { path, virtual: count > VIRTUALIZE_ABOVE };
  } else if (memo.current.virtual) {
    if (count < DEVIRTUALIZE_BELOW) memo.current.virtual = false;
  } else if (count > VIRTUALIZE_ABOVE) {
    memo.current.virtual = true;
  }
  return memo.current.virtual;
}
```

Mutating a ref during render is acceptable here because the computation is idempotent for identical inputs (React 19 strict-mode double render produces the same result). If the lint configuration forbids it, store the mode in `useState` and update it in a layout effect, accepting one extra render.

Expose the decision to tests and to the measurement procedure as `data-virtualized="true" | "false"` on the `role="listbox"` / `role="grid"` element in **both** variants.

### 4.3 Wiring `Explorer.tsx`

`renderBody()` stays the single seam that branches on `viewMode`; this ticket adds a second, nested decision:

```tsx
function renderBody() {
  const virtual = useVirtualizationMode(...)  // hook is called at the top level, not here
  if (viewMode === 'grid') {
    return virtual ? <VirtualEntryGrid {...gridProps} /> : <EntryGrid {...gridProps} />;
  }
  return virtual ? <VirtualEntryList {...listProps} /> : <EntryList {...listProps} />;
}
```

(Call the hook at the top of the component, not inside `renderBody`.) The two variants of each view take **identical props** so that `Explorer.tsx` has no other branching. Keep `data.entries` unmodified; never `slice` it. The truncation banner, inline error banner, empty state and skeletons continue to be rendered by `Explorer.tsx` exactly as before and need no change.

When `data.path` changes (a navigation, not a `showHidden` refetch), set the body element's `scrollTop = 0` in a layout effect. Without this, entering a folder from the middle of a long scrolled list leaves the user in the middle of the next one. Do this for both variants.

### 4.4 Grid metrics

`gridMetrics.ts` was created by T027 and is the single definition (T035 imports it too; nothing is re-declared):

```ts
import { columnsFor, GRID_MIN_TILE_PX, useTileMin } from './gridMetrics';
// GRID_MIN_TILE_PX = { base: 104, md: 132, lg: 160 }
// columnsFor(containerWidth, gapPx, minTilePx) = max(1, floor((containerWidth + gapPx) / (minTilePx + gapPx)))
// useTileMin(): 104 | 132 | 160   (matchMedia + useSyncExternalStore; never window.innerWidth)
```

`containerWidth` is the **content width** of the grid: its `clientWidth` minus the left and right padding. The formula is the exact inverse of how a browser resolves `auto-fill`, which is why the virtualized grid and the CSS grid agree on the column count. Because the non-virtualized grid (T027) also takes its column count from `columnsFor`, a folder crossing the 200/201 boundary cannot change the column count, or what `ArrowDown` does.

The grid element carries `data-tile-min="104" | "132" | "160"` (as in T027) so tests, which have no CSS engine, can assert on it. T035 adds `data-layout` to other elements; do not add that attribute here.

Gap and padding are read from the element, not hard-coded, because they come from tokens. If T027 already exports a `readGridBox`, use it; otherwise add this one helper to `gridMetrics.ts` (and only there):

```ts
export function readGridBox(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const gap = parseFloat(cs.columnGap) || 0;                 // 'normal' parses to NaN -> 0
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return { gap, contentWidth: Math.max(0, el.clientWidth - padX) };
}
```

`TILE_NAME_BLOCK_PX` is the height of everything in a tile that is not the square media: the `--space-1` margin plus two lines of 13 px text at line-height 1.25 (`2.5em` = 32.5 px). **Decision (not specified): use `40` as the *estimate* and let `measureElement` correct it** (§4.6). The estimate only needs to be close; the measured row height is what the layout uses.

### 4.5 The entry region starts at scroll offset 0

T026 renders every banner (restore notice, inline error, truncation notice) in the notices region **outside** the scroller. The virtualized region is therefore the first and only content of the scroll element, and its top edge is at scroll offset 0. The virtualizer is configured with no `scrollMargin`, items are positioned with plain `transform: translateY(${item.start}px)`, and there is no margin measurement, no `ResizeObserver` on banners and no `virtualizer.measure()` call caused by a banner appearing or disappearing. If a later change puts content above the entries inside the scroller, that change owns adding scroll-margin handling; do not add speculative code for it here.

### 4.6 `useVirtualList` and `VirtualEntryList`

```ts
// useVirtualList.ts
export function useVirtualList(args: {
  entries: FsEntry[];
  scrollEl: HTMLElement | null;     // from useExplorerScroll() (T026)
  activeIndex: number;
}) {
  const rowHeight = useRowHeightEstimate(args.scrollEl);   // see below
  const rangeExtractor = useCallback(
    (range: Range) => withActiveIndex(defaultRangeExtractor(range), args.activeIndex),
    [args.activeIndex],
  );
  return useVirtualizer({
    count: args.entries.length,
    getScrollElement: () => args.scrollEl,
    estimateSize: () => rowHeight,
    overscan: LIST_OVERSCAN,
    // No scrollMargin: the notices region is outside the scroller, so the list starts at offset 0 (§4.5).
    // noUncheckedIndexedAccess: entries[index] is FsEntry | undefined, so fall back to the index.
    getItemKey: (index) => args.entries[index]?.path ?? index,
    rangeExtractor,
  });
}
```

- **Row height.** `useRowHeightEstimate` reads `--explorer-row-h` from the computed style of the scroll element (`parseFloat(getPropertyValue('--explorer-row-h'))`); if that is `NaN` (a `rem` value, an unset variable, or `jsdom`), fall back to `48`, or `56` when `matchMedia('(pointer: coarse)').matches`. This is only the estimate. Every rendered row also carries `ref={virtualizer.measureElement}` and `data-index={index}`, so the real height wins. T035 changes the row's `min-block-size` per breakpoint; measuring (rather than hard-coding) is what keeps the scrollbar honest when it does.
- **`getItemKey` is the entry path.** The measurement cache is then keyed by path, so a `showHidden` refetch that inserts or removes entries does not leave stale heights attached to the wrong rows.
- **`withActiveIndex`** merges the active index into the rendered index list, keeping it sorted and unique:

  ```ts
  function withActiveIndex(indexes: number[], active: number): number[] {
    if (active < 0 || indexes.includes(active)) return indexes;
    return [...indexes, active].sort((a, b) => a - b);
  }
  ```

  This is what keeps `aria-activedescendant` valid. If the highlighted entry scrolls out of the window (the user highlights row 40, then drags the scrollbar to row 4000), its element must still exist in the DOM, or the attribute would point at an id that is not present and assistive technology would lose the active option. The extra element is positioned at its true offset, so it is simply off-screen. The `rangeExtractor` identity must change when `activeIndex` changes — that is why it is wrapped in `useCallback` with `activeIndex` as a dependency; the library memoizes the rendered indexes on that function's identity. Verify against the installed version and, if the memo key differs, call `virtualizer.measure()` or pass `activeIndex` through whatever the library does key on.

`VirtualEntryList` renders:

```tsx
<div
  ref={listRef}
  role="listbox"
  tabIndex={0}
  aria-label="Folder contents"
  aria-activedescendant={activeIndex >= 0 ? `slydr-entry-${activeIndex}` : undefined}
  data-virtualized="true"
  className={styles.virtualList}
  style={{ height: virtualizer.getTotalSize() }}
  onKeyDown={onKeyDown}
  onClick={onClick}              // delegated, same handlers as the plain list (closest('[role=option]'))
  onDoubleClick={onDoubleClick}
  onPointerUp={onPointerUp}
>
  {virtualizer.getVirtualItems().map((item) => {
    const entry = entries[item.index];          // FsEntry | undefined under noUncheckedIndexedAccess
    if (!entry) return null;
    return (
      <EntryRow
        key={item.key}
        ref={virtualizer.measureElement}
        data-index={item.index}
        entry={entry}
        index={item.index}
        active={item.index === activeIndex}
        aria-setsize={entries.length}
        aria-posinset={item.index + 1}
        style={{ transform: `translateY(${item.start}px)` }}
        className={styles.virtualRow}
        /* no handlers: click, double-click and pointer-up are delegated on this listbox (T026 §4.7) */
      />
    );
  })}
</div>
```

```css
.virtualList { position: relative; width: 100%; }
.virtualRow  { position: absolute; top: 0; left: 0; width: 100%; box-sizing: border-box; }
```

Notes:

- With no scroll margin, `getTotalSize()` is exactly the content height: set it as the container's `height`. Assert `style.height` for a known count and row height in a test.
- The delegated handlers resolve the row with `closest('[role=option]')` and read its index from `data-index`/`id`, so they keep working for rows that are mounted and unmounted by the window.
- The listbox element keeps its role, its single tab stop and its `aria-label`. The rows are direct children of it, so the listbox → option relationship stays valid. Do not insert a wrapper element between them.
- The row's own display (a three-column grid from T026/T035) is untouched; only positioning is overridden.
- Rows are still never focusable. The container is the tab stop.

### 4.7 Keyboard handling and scrolling

`useEntryHighlight` and `useGridHighlight` gain two optional parameters:

```ts
interface HighlightOptions {
  /** Called after the highlight moves. Default: scrollIntoView({ block: 'nearest' }) on the active element. */
  reveal?: (index: number) => void;
  /** Number of entries a PageUp / PageDown moves. Default: derived from the scroller (below). */
  pageSize?: () => number;
}
```

Virtual variants pass `reveal: (index) => virtualizer.scrollToIndex(index, { align: 'auto' })` for the list and `reveal: (index) => virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' })` for the grid. `align: 'auto'` scrolls only when the target is not already fully visible, which gives the same feel as `block: 'nearest'`. The non-virtual variants keep the default.

Key behaviour in **both** modes (this extends T026 and T027, which defined the arrows, `Home`, `End`, `Enter`, `Backspace` and `Alt+ArrowLeft`):

| Key | List | Grid |
|---|---|---|
| `Home` | highlight index `0` | highlight index `0` |
| `End` | highlight index `entries.length - 1` | highlight index `entries.length - 1` |
| `PageDown` | `min(last, index + pageSize)` | `min(last, index + pageSize)` |
| `PageUp` | `max(0, index - pageSize)` | `max(0, index - pageSize)` |

- From `activeIndex === -1`, `PageDown` highlights index `pageSize - 1` (clamped), and `PageUp` highlights index `0`.
- `pageSize` for the list is `max(1, floor(scrollEl.clientHeight / rowHeight) - 1)`. For the grid it is `max(1, floor(scrollEl.clientHeight / rowStride) - 1) * columns`, where `rowStride` is the measured row height. The `- 1` keeps one row of context on screen across a page jump. (Decision (not specified): page size of one viewport minus one row, the convention of native listboxes.) Because `PageUp`/`PageDown` step by whole rows of columns, the highlight keeps its column.
- All four keys call `preventDefault()`, so the browser does not scroll the body on its own while `aria-activedescendant` changes.
- `End` on a 10,000-entry folder must move the highlight and the scroll position in one step. The highlight update renders the last item immediately (it is in the `rangeExtractor` set), and `scrollToIndex` brings it on screen; both happen in the same event, so there is no frame where the attribute points at a missing element.
- `scrollToIndex` with dynamic measurement can need a second pass while rows near the target are measured. The library handles this internally. Do not add a `setTimeout` retry of your own.

### 4.8 `useVirtualGrid` and `VirtualEntryGrid`

Rows, not tiles, are the virtualized unit. A "row" is `columns` consecutive entries.

```ts
// useVirtualGrid.ts (shape)
export function useVirtualGrid(args: {
  entries: FsEntry[];
  scrollEl: HTMLElement | null;
  gridEl: HTMLElement | null;
  activeIndex: number;
}): {
  columns: number;
  rowCount: number;
  virtualizer: Virtualizer<HTMLElement, Element>;
  tileMin: 104 | 132 | 160;
}
```

1. **Measure the width.** A `ResizeObserver` on `gridEl` (the same element the virtualizer positions items in) calls `readGridBox` (§4.4, from `gridMetrics.ts`) and stores `{ contentWidth, gap }` in state. The first measurement happens in a layout effect so the first paint already has the right column count; before any measurement, fall back to `columns = 1` and render **zero** rows rather than a wrong number (an empty first frame is invisible, a 1-column flash is not).
2. **Derive the columns.** `columns = columnsFor(contentWidth, gap, tileMin)` where `tileMin` comes from `useTileMin()`. `rowCount = Math.ceil(entries.length / columns)`.
3. **Estimate the row height.** `tileWidth = (contentWidth - gap * (columns - 1)) / columns`, so `rowHeight ≈ tileWidth + TILE_NAME_BLOCK_PX + gap`. The `+ gap` is the vertical gap between rows; give each virtual row `padding-bottom: var(--space-3)` so the measured height includes it, and give the grid `padding-top: var(--space-3)` (use the `paddingStart` / `paddingEnd` options of the virtualizer for the grid's top and bottom padding, read as `parseFloat(getComputedStyle(gridEl).paddingTop)` and `paddingBottom`, so no pixel value is hard-coded).
4. **Measure the real height.** Each rendered row has `ref={virtualizer.measureElement}` and `data-index={rowIndex}`.
5. **React to size changes.** When `columns` or `contentWidth` changes, every cached row height is wrong (tiles are square, so the height follows the width). Call `virtualizer.measure()` in a layout effect that depends on `[columns, Math.round(contentWidth)]`. Rounding avoids re-measuring on sub-pixel noise.
6. **Anchor the scroll position on a column change.** If the number of columns changes, the same scroll offset points at different entries. Before the change takes effect, remember the first visible entry (`anchor = firstVisibleRow * oldColumns`); after the layout effect applies the new column count, call `scrollToIndex(Math.floor(anchor / newColumns), { align: 'start' })`. Skip this when the scroll offset is `0` or the column count did not change. (Decision (not specified): keep the first visible entry stable across resizes; the alternative, keeping the pixel offset, makes the user lose their place when rotating a tablet.)

Overscan is `GRID_OVERSCAN = 2` rows. With up to ten columns that is up to twenty extra tiles on each side, which is already more than a viewport of thumbnails above the visible range's one-viewport observer margin; a larger overscan only adds DOM nodes.

The active entry's **row** goes through the same `withActiveIndex` extraction, using `Math.floor(activeIndex / columns)`.

`VirtualEntryGrid` renders:

```tsx
<div
  ref={gridRef}
  role="grid"
  tabIndex={0}
  aria-label="Folder contents"
  aria-colcount={columns}
  aria-rowcount={rowCount}
  aria-activedescendant={activeIndex >= 0 ? `slydr-entry-${activeIndex}` : undefined}
  data-virtualized="true"
  data-tile-min={tileMin}
  className={styles.virtualGrid}
  style={{ height: virtualizer.getTotalSize() }}
  onKeyDown={onKeyDown}
  onClick={onClick}              // delegated, as in T027: closest('[role=gridcell]')
  onDoubleClick={onDoubleClick}
  onPointerUp={onPointerUp}
>
  {virtualizer.getVirtualItems().map((row) => (
    <div
      key={row.key}
      ref={virtualizer.measureElement}
      data-index={row.index}
      role="row"
      aria-rowindex={row.index + 1}
      className={styles.virtualRow}
      style={{
        transform: `translateY(${row.start}px)`,
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {rowEntries(row.index).map((entry, col) => (       // entry: FsEntry (rowEntries slices a defined range)
        <EntryTile key={entry.path} entry={entry} index={row.index * columns + col}
                   aria-colindex={col + 1} … />      // no handlers, no tabIndex
      ))}
    </div>
  ))}
</div>
```

```css
.virtualGrid {
  position: relative;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-4);                     /* same values as T027's .grid, so readGridBox is unchanged */
}
.virtualRow {
  position: absolute; top: 0;
  left: var(--space-4); right: var(--space-4);                /* aligns with the grid's horizontal padding */
  box-sizing: border-box;
  display: grid;                                              /* a real box, NOT display: contents */
  gap: var(--space-3);
  padding-bottom: var(--space-3);                             /* vertical gap between rows is part of the measured height */
  align-items: start;
}
```

Important differences from T027's non-virtualized grid:

- **Rows are real boxes.** T027 used `display: contents` so tiles stayed direct items of the CSS `auto-fill` grid. Rows that must be absolutely positioned cannot be `display: contents`. Each row is its own `display: grid` with `repeat(N, minmax(0, 1fr))`. With `N` computed by `columnsFor`, the resulting tile widths are identical to what `auto-fill` produces, which the manual check in §5 verifies at four widths.
- **Padding stays on `.virtualGrid`; the rows are offset by the same token.** Absolutely positioned rows are placed relative to the padding box, so `.virtualGrid` keeps `padding: var(--space-3) var(--space-4)` (identical to T027's `.grid`) and each row uses `left`/`right: var(--space-4)`. `readGridBox` (content width = `clientWidth` minus `paddingLeft`/`paddingRight` of the grid element) then equals the width the rows really have, with no horizontal padding on the rows. The tests in §6 assert that the number of columns equals `columnsFor(...)` for a faked width, which catches a mismatch.
- `aria-rowcount` is the **total** row count, not the number of rendered rows, and each rendered row declares its own `aria-rowindex`. This is the standard way to describe a partially rendered grid to assistive technology.
- Tiles keep `role="gridcell"`, `id="slydr-entry-{index}"`, `aria-selected`, `title`, the `data-hidden` attribute and visually hidden ", hidden" name suffix (no hidden-specific styling, FR-14.5) and the touch double-tap behaviour from T027. Each also gets `aria-colindex`.
- The last row can hold fewer than `columns` tiles. It keeps `repeat(columns, …)`, so those tiles stay the same width as tiles above them.

### 4.9 Screen-reader collection size

**Decision (not specified): announce the full collection size explicitly in virtualized mode.** Without it, a screen reader sees at most a few dozen options at once and would read "item 7 of 40" for a 5,000-entry folder.

- **List (virtualized):** every rendered `role="option"` carries `aria-setsize={entries.length}` and `aria-posinset={index + 1}`. These attributes are **not** added in the non-virtualized list, where the DOM already contains the whole set and the browser derives both numbers.
- **Grid (virtualized):** the `role="grid"` carries `aria-rowcount` (total rows) and `aria-colcount` (columns), every rendered `role="row"` carries `aria-rowindex` (1-based, absolute) and every `role="gridcell"` carries `aria-colindex` (1-based).
- `entries.length` is the number of entries actually returned. When the folder is truncated (more than `MAX_ENTRIES`), `aria-setsize` is still `entries.length` (at most 10,000) and not the real size on disk, which the client does not know. The truncation notice tells the user about the rest, and `Banner` is already announced politely by T026.
- Option and cell ids stay `slydr-entry-{index}` with `index` the position in `entries`, never the position among the rendered items. The id of an element therefore does not change as it scrolls in and out of the window, which is what keeps `aria-activedescendant` stable.

### 4.10 Thumbnail loading under virtualization

The thumbnail design of T027 is deliberately compatible with mounting and unmounting tiles; this ticket relies on that and adds tests rather than code. The rules to preserve:

1. **The observer root is still the body element.** The virtualized grid moves tiles with `transform: translateY`, which `IntersectionObserver` handles; do not add `overflow` or `contain: paint` to the grid or its rows, because that would clip tiles to a smaller root and make them report as non-intersecting.
2. **A tile that unmounts cancels its request.** When a row leaves the window, React unmounts its `Thumbnail`s; `useThumbnail`'s cleanup unobserves the element and calls the handle's `cancel()`, which drops a queued request or aborts an in-flight one and frees its slot. Because `thumbnailQueue.ts` is a module-level singleton, the cap of 6 holds across all the mounts and unmounts virtualization causes. Never create the queue inside a component.
3. **A scrolled-past tile that never intersected never requested anything.** Fast scrolling mounts and unmounts many rows between two `IntersectionObserver` callbacks; those tiles are never enqueued at all, which is the main reason virtualized thumbnail loading is cheaper than the original, not more expensive.
4. **Remounts re-request.** T027 revokes the object URL as soon as the `<img>` has loaded, so a tile that is unmounted and mounted again requests its thumbnail again; the response comes from the browser's HTTP cache (`Cache-Control: private, max-age=604800`) without touching the network or the server. **Decision (not specified): do not add a client-side LRU of object URLs.** It would reintroduce the memory pressure revocation was added to avoid. If the measurement in §4.11 shows a visible icon-then-thumbnail flash on scroll-back, a small LRU is the escalation, and it belongs in a follow-up ticket.
5. **The overscan must not exceed the observer margin by much.** Two grid rows of overscan is well inside the one-viewport margin, so every mounted tile is eligible to load. If a mounted tile were outside the margin it would simply stay an icon until scrolled closer, which is correct.

No change to `thumbnailQueue.ts`, `useThumbnail.ts` or `Thumbnail.tsx` is expected. If one proves necessary, make the smallest change and update the T027 tests that cover it.

### 4.11 Measurement procedure (NFR-2)

Run this once before opening the PR and paste the numbers in the PR description. It needs a production-like build (`npm run build` then the server serving `client/dist`), because `vite dev` adds React development overhead that distorts frame times.

**Step 1 — create the fixtures.** If T037's generator is already merged, use it to create one folder of 2,000 and one of 10,000 small image files plus some subfolders and non-image files (run its `--help` to find the folder-size options). Otherwise save the script below *outside the repository* (for example `%TEMP%\make-virt-fixture.mjs`, `$TMPDIR/make-virt-fixture.mjs`) and run it with `node`. It writes under the home folder because that is the server's jail root. It is cross-platform and uses a 1x1 PNG so thumbnails decode.

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const root = join(homedir(), 'slydr-virt-fixture');
for (const total of [2000, 10000]) {
  const dir = join(root, String(total));
  mkdirSync(dir, { recursive: true });
  const folders = Math.round(total * 0.02);
  const texts = Math.round(total * 0.05);
  for (let i = 0; i < folders; i += 1) mkdirSync(join(dir, `folder ${String(i).padStart(4, '0')}`), { recursive: true });
  for (let i = 0; i < texts; i += 1) writeFileSync(join(dir, `notes ${String(i).padStart(5, '0')}.txt`), 'x');
  for (let i = 0; i < total - folders - texts; i += 1) writeFileSync(join(dir, `IMG_${String(i).padStart(5, '0')}.png`), PNG);
}
console.log('created', root);
```

Delete `~/slydr-virt-fixture` when finished. The wire paths of the two folders are `slydr-virt-fixture/2000` and `slydr-virt-fixture/10000`.

**Step 2 — server listing time (target: under 500 ms warm).** Start the server and note the port it prints. Request the 2,000-entry folder twice; the first call warms the file-system cache, and the *second* is the measurement. Repeat five times and take the median.

```
curl -s -o /dev/null -w "%{time_total}\n" "http://127.0.0.1:<port>/api/fs/list?path=slydr-virt-fixture%2F2000"
```

On Windows PowerShell or `cmd`, replace `/dev/null` with `NUL`. **Pass:** median under `0.500` seconds. **Fail:** report it against T011 / T012 with the number; do not paper over it in the client. Also record the 10,000-entry time for information (it is not gated).

**Step 3 — DOM size.** Open the explorer on `slydr-virt-fixture/2000` in Chrome at a 1920 × 1080 window. In the console:

```js
const n = (sel) => document.querySelectorAll(sel).length;
({ virtualized: document.querySelector('[data-virtualized]')?.dataset.virtualized,
   options: n('[role=option]'), rows: n('[role=row]'), cells: n('[role=gridcell]') })
```

**Pass (list view):** `options ≤ visibleRows + 2 × LIST_OVERSCAN + 2`, where `visibleRows = ceil(bodyHeight / rowHeight)`; at 1080p that is roughly 19 + 16 + 2 = 37. **Pass (grid view):** `rows ≤ visibleRows + 2 × GRID_OVERSCAN + 2` and `cells ≤ rows × columns`. Repeat on the 10,000-entry folder: the counts must be the same, not larger. Press `End` and re-run: the counts must still be within the same bound.

**Step 4 — scroll smoothness.** In the console on the 2,000-entry folder, install the observers and drive a 5-second programmatic scroll from top to bottom and back:

```js
const root = document.querySelector('[data-explorer-scroll]');
const long = []; const frames = [];
new PerformanceObserver((l) => long.push(...l.getEntries().map((e) => e.duration)))
  .observe({ type: 'longtask', buffered: false });
let last = performance.now(); const t0 = last;
(function tick(now) {
  frames.push(now - last); last = now;
  const p = ((now - t0) % 5000) / 5000;
  root.scrollTop = (p < 0.5 ? p * 2 : (1 - p) * 2) * (root.scrollHeight - root.clientHeight);
  if (now - t0 < 10000) requestAnimationFrame(tick);
  else console.log({ longTasks: long, maxLongTask: Math.max(0, ...long),
    p95Frame: frames.sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] });
})(t0);
```

**Pass:** no long task above 50 ms (`maxLongTask` is `0` or at most `50`) and `p95Frame ≤ 20` ms (a 60 fps frame is 16.7 ms; 20 ms tolerates timer jitter). Run it in list view and in grid view. In grid view, also open the Network panel while it runs: no more than six `/api/thumb` requests may be pending at any moment, and requests for tiles scrolled past must show as cancelled. Then capture one DevTools Performance recording of a manual mouse-wheel scroll and confirm the main thread has no block above 50 ms.

**Step 5 — repeat once on a throttled CPU.** In DevTools Performance settings choose "4× slowdown" and repeat step 4. This is informational (record the numbers) because the target is a mid-range laptop and CI cannot reproduce it.

## 5. Acceptance criteria

- [ ] `@tanstack/react-virtual` v3 (installed by T001, `^3.13.12`) is used; `package.json` and the lockfile are unchanged by this ticket, and its peer range includes React 19.
- [ ] `VIRTUALIZE_ABOVE` is `200`, `DEVIRTUALIZE_BELOW` is `180`, `LIST_OVERSCAN` is `8` and `GRID_OVERSCAN` is `2`, each defined once in `client/src/screens/Explorer/virtualization.ts`.
- [ ] A folder with exactly 200 entries renders the non-virtualized `EntryList` / `EntryGrid` (`data-virtualized="false"`) and a folder with 201 entries renders the virtualized variant (`data-virtualized="true"`), in both view modes.
- [ ] Hysteresis holds: a virtualized folder whose entry count drops to 190 (by turning "Show hidden items" off) stays virtualized, and one that drops to 179 becomes non-virtualized; navigating to another folder resets the decision.
- [ ] With 5,000 entries and a 900 px tall scroller, the list renders no more than `ceil(900 / rowHeight) + 2 × 8 + 2` `role="option"` elements, and the grid renders no more than `visibleRows + 2 × 2 + 2` `role="row"` elements.
- [ ] The virtualized list's `getTotalSize()` equals `entries.length × rowHeight` for fixed-height rows, so the scrollbar length matches the content.
- [ ] The listbox/grid keeps `role`, `tabIndex={0}`, `aria-label="Folder contents"` and `aria-activedescendant`; no row, option, cell or tile is a tab stop.
- [ ] `aria-activedescendant` always names an element that exists in the document: after `End` on a 5,000-entry list, after `Home`, after `PageDown`, and after dragging the scroller far away from the highlighted entry.
- [ ] Every rendered virtualized option has `aria-setsize` equal to `entries.length` and `aria-posinset` equal to its 1-based position; the virtualized grid has `aria-rowcount`, `aria-colcount`, and rows and cells carry `aria-rowindex` / `aria-colindex`.
- [ ] Ids are `slydr-entry-{index}` with `index` the position in `entries`, and do not change when an element scrolls out and back into the window.
- [ ] The grid's column count equals `columnsFor(contentWidth, gap, tileMin)` (imported from T027's `gridMetrics.ts`, which is the only definition) and agrees with the non-virtualized CSS grid at widths of 320, 768, 1024 and 1920 px.
- [ ] `useTileMin` returns 104 below 768 px, 132 from 768 px to 1023 px, and 160 from 1024 px, driven by `matchMedia` and updated on a `change` event.
- [ ] Resizing the window or crossing a breakpoint re-measures the columns and row height, and the first visible entry stays visible after a column-count change.
- [ ] `Home`, `End`, `PageUp` and `PageDown` move the highlight as specified in §4.7 in both modes, call `preventDefault()`, and scroll the target into view through `scrollToIndex` in virtualized mode.
- [ ] A tile that unmounts because its row left the window has its pending thumbnail request cancelled: a queued request is removed, or the in-flight `AbortController` reports `signal.aborted === true`, and the slot is freed.
- [ ] While scrolling through a virtualized grid of 1,000 image tiles, `__inFlightCount()` never exceeds 6.
- [ ] The body element remains the only scroll container; no element inside it has `overflow: auto` or `overflow: scroll`, and the header, the notices region and the footer are still siblings of the scroller.
- [ ] With `truncated: true` and 10,000 entries, the "This folder has more than 10,000 items. Showing the first 10,000." banner renders in the notices region (outside the scroller), the first row is at scroll offset 0, and scrolling to the end shows the last entry.
- [ ] A banner appearing or disappearing in the notices region does not move or re-measure any row (the virtualizer has no `scrollMargin`).
- [ ] `EntryRow` and `EntryTile` still have no event handlers; the virtualized listbox and grid delegate click, double-click and pointer-up on their containers, and `npm run lint` (with `jsx-a11y`) is clean without disable comments.
- [ ] Entering another folder resets the body scroll position to the top.
- [ ] The measurement procedure of §4.11 has been run and its numbers are in the PR description: median warm server list time for 2,000 entries below 500 ms, DOM node counts within the bounds above, no long task above 50 ms, p95 frame interval at or below 20 ms.
- [ ] No hard-coded colours or spacing values were introduced; all styling uses design tokens.

## 6. Tests to write

Vitest + React Testing Library (`jsdom`), per spec §12.3. Because `jsdom` has no layout, the virtualizer needs a faked scroller.

**Test helper — `client/test/helpers/virtualGeometry.ts`.** Exports `installVirtualGeometry({ scroller, width, height, rowHeight?, gridWidth? })`, which for the scroll element and the virtual region: defines `clientHeight`, `clientWidth`, `offsetHeight`, `offsetWidth` and `getBoundingClientRect()` returning the given size (and `top: 0`); stubs `Element.prototype.scrollTo` and `scrollTo` on the element with a `vi.fn()`; provides a controllable `ResizeObserver` (`triggerResize(element, { width, height })`) if the T027 stub does not already; stubs `getComputedStyle` just enough to return `columnGap`, `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom` and `--explorer-row-h`; and delegates `window.matchMedia` to T021's `client/test/helpers/matchMedia.ts` (`setMatches('(min-width: 768px)', true)`) rather than defining a third matchMedia stub. Give rows a fixed `getBoundingClientRect().height` so `measureElement` agrees with the estimate. The helper returns an `uninstall()` for `afterEach`. Verify against the installed library version whether it reads `offsetHeight`, `getBoundingClientRect()` or `ResizeObserver` entries, and fake all three.

Fixture factory: `makeEntries(count, { folders?, hidden? })` in `client/test/helpers/explorerFixtures.ts` (extend the one from T026/T027). Tests import `describe`, `it`, `expect`, `vi` from `'vitest'`, wrap the components in `ExplorerScrollContext.Provider` with the faked scroller, and use `useAppActions()`-based providers only where a screen-level test needs them.

**`client/test/screens/Explorer/virtualization.test.ts`**

- `describe('useVirtualizationMode')`
  - `it('does not virtualize a folder with exactly 200 entries')`
  - `it('virtualizes a folder with 201 entries')`
  - `it('keeps a virtualized folder virtualized while the count stays at or above 180')`
  - `it('stops virtualizing when the count drops below 180')`
  - `it('does not start virtualizing a small folder until the count exceeds 200')`
  - `it('forgets the remembered mode when the path changes')`
- `columnsFor`, `useTileMin` and `useGridColumns` are unit-tested in T027's `gridMetrics.test.tsx`; this ticket does not duplicate those tests. It adds one cross-check: `it('the virtualized grid and the non-virtualized grid report the same column count at 320, 768, 1024 and 1920 px')`.

**`client/test/screens/Explorer/VirtualEntryList.test.tsx`**

- `describe('VirtualEntryList')`
  - `it('renders only a window of options for 5000 entries')` (asserts the bound from §5)
  - `it('sets the container height to the total size of all rows')`
  - `it('positions each row with a translateY transform and no inline top')`
  - `it('renders entries in the order received, starting at the first index')`
  - `it('sets aria-setsize and aria-posinset on every rendered option')`
  - `it('keeps role=listbox, aria-label and a single tab stop')`
  - `it('keeps the id of an option equal to its position in entries after scrolling')`
  - `it('renders the highlighted option even when it is outside the overscan window')`
  - `it('keeps aria-activedescendant pointing at an element that exists after a jump to the end')`
  - `it('keeps aria-activedescendant valid after the scroller is moved far from the highlight')`
  - `it('starts the first row at offset 0 and uses a plain translateY(item.start) transform (no scroll margin)')`
  - `it('delegates click, double-click and pointer-up on the listbox container; rows have no handlers')`
  - `it('does not render a row for an index whose entry is undefined')`
  - `it('does not make any row focusable')`
  - `it('sets data-virtualized to true')`

**`client/test/screens/Explorer/VirtualEntryList.keyboard.test.tsx`**

- `describe('VirtualEntryList keyboard access')`
  - `it('moves the highlight with ArrowDown and calls scrollToIndex')`
  - `it('jumps to index 0 with Home and to the last index with End')`
  - `it('moves by one viewport minus one row with PageDown and PageUp')`
  - `it('clamps PageDown at the last entry and PageUp at the first')`
  - `it('prevents default on Home, End, PageUp and PageDown')`
  - `it('opens a highlighted folder with Enter')`
  - `it('still goes up one level with Backspace and Alt+ArrowLeft')`

**`client/test/screens/Explorer/VirtualEntryGrid.test.tsx`**

- `describe('VirtualEntryGrid')`
  - `it('derives the column count from the container width and the tile minimum')`
  - `it('renders no rows before the first width measurement')`
  - `it('renders only a window of rows for 5000 entries')`
  - `it('renders real row boxes and never uses display: contents')`
  - `it('sets aria-rowcount to the total row count and aria-colcount to the columns')`
  - `it('sets aria-rowindex on rows and aria-colindex on cells')`
  - `it('renders a shorter final row without stretching its tiles')`
  - `it('re-derives columns and re-measures when the ResizeObserver fires')`
  - `it('keeps the first visible entry in view when the column count changes')`
  - `it('switches the tile minimum from 104 to 132 at a matchMedia change')`
  - `it('sets data-tile-min and data-virtualized')`
  - `it('renders the highlighted tile even when its row is outside the window')`

**`client/test/screens/Explorer/VirtualEntryGrid.keyboard.test.tsx`**

- `describe('VirtualEntryGrid keyboard access')`
  - `it('moves one column with ArrowLeft and ArrowRight')`
  - `it('moves one row down and up with the current column count')`
  - `it('scrolls the target row into view through scrollToIndex')`
  - `it('keeps the column on PageDown and PageUp')`
  - `it('jumps to the first and last entry with Home and End')`
  - `it('keeps aria-activedescendant valid after End on 5000 entries')`

**`client/test/screens/Explorer/VirtualEntryGrid.thumbnails.test.tsx`**

- `describe('virtualized grid thumbnails')`
  - `it('requests thumbnails only for tiles the observer reports as intersecting')`
  - `it('never has more than 6 requests in flight while the window moves across 1000 tiles')`
  - `it('cancels a pending request when its row unmounts')`
  - `it('frees the in-flight slot of an unmounted tile so a queued request starts')`
  - `it('does not enqueue a tile that unmounted before the observer reported it')`
  - `it('re-requests a thumbnail when a tile mounts again')`
  - `it('keeps the observer root equal to the explorer body element')`

**`client/test/screens/Explorer/Explorer.virtualization.test.tsx`**

- `describe('Explorer with a large folder')`
  - `it('uses the plain list for 200 entries and the virtualized list for 201')`
  - `it('uses the plain grid for 200 entries and the virtualized grid for 201')`
  - `it('keeps the virtualized mode when Show hidden items takes the count from 205 to 190')`
  - `it('renders the truncation notice together with a virtualized 10000-entry list')`
  - `it('announces aria-setsize 10000 for a truncated listing')`
  - `it('resets the body scroll position when navigating into a folder')`
  - `it('does not reset the scroll position when only showHidden changes')`
  - `it('keeps the highlight when the view mode switches while virtualized')`
  - `it('keeps the header and footer outside the scroll container')`

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit and component tests; `npm test` green.
- [ ] `@tanstack/react-virtual` (already installed by T001) is imported only by the virtual hooks/components; `package.json` and the lockfile are unchanged.
- [ ] The PR description names the 180 to 200 hysteresis band as a deliberate deviation from the literal "above 200 entries" of NFR-2.
- [ ] The measurement procedure of §4.11 has been run on a production build on at least one platform, and the results (server median, DOM counts in list and grid, max long task, p95 frame interval, peak thumbnail requests in flight) are recorded in the PR description.
- [ ] Verified by hand on a 10,000-entry folder in list and grid views: scrolling is smooth, `End` and `Home` land on the right entries, keyboard highlight follows the scroll, and a screen reader (NVDA, VoiceOver or Narrator) announces positions such as "item 4,213 of 10,000".
- [ ] Verified by hand that a window resize across 767 px / 768 px and 1023 px / 1024 px does not blank the grid, does not leave a gap of the wrong size under it, and keeps the same entry visible.
- [ ] Verified that toggling between exactly 200 and 201 entries (via show-hidden) does not lose the highlight or restart thumbnails.
- [ ] Verified in both themes that the focus ring and highlighted row are still visible on virtualized rows.
- [ ] No scroll container other than the explorer body exists (checked in the DOM inspector).
- [ ] The scratch fixture folder `~/slydr-virt-fixture` has been deleted and the fixture script is not committed.
- [ ] README: no change; T041 creates the README. There is no user-visible change.

## 8. Notes and gotchas

- **A zero-height scroller renders nothing.** In `jsdom` and in a hidden browser tab the scroll element measures `0`, and the virtualizer returns an empty list. Never treat "no virtual items" as a bug in the component; it is the symptom of a missing geometry fake in a test.
- **Do not wrap the options.** `role="listbox"` requires its owned elements to be `role="option"` (or groups). A wrapper `<div>` for positioning between the listbox and the rows silently breaks the accessibility tree. Size the listbox itself and put the rows directly in it.
- **`display: contents` rows cannot be absolutely positioned.** This is why the virtualized grid is not a straight reuse of T027's markup. If you find yourself wanting `display: contents` back, you are re-virtualizing by tile, which doubles the bookkeeping for no gain.
- **The `rangeExtractor` identity matters.** If it is created inline without `useCallback`, the library recomputes on every render; if it is memoized without the active index, the active row is dropped on scroll. Test it explicitly (the "outside the overscan window" tests exist for this).
- **Do not add `scrollIntoView` back.** On an element that has been unmounted it silently does nothing, and on a freshly mounted one it fights `scrollToIndex`. In virtualized mode every highlight move goes through `scrollToIndex`.
- **`scrollbar-gutter: stable` prevents a feedback loop.** T035 puts it on the scroll container (T035 is a later ticket; if the flicker is seen before it lands, add the declaration to `.body` here and tell T035). Without it, a scrollbar appearing narrows the container, which reduces the column count, which makes the content taller, which can toggle the scrollbar again. If you see the grid flicker between two column counts at one width, check this first.
- **Round widths before comparing.** Fractional widths from browser zoom can make `ResizeObserver` report slightly different values on every frame. Compare `Math.round(contentWidth)` before calling `measure()`.
- **Measure only what changed.** `virtualizer.measure()` discards every cached row size. Calling it from a plain `useEffect` with no dependency array resets the cache on every render and makes scrolling slower than not virtualizing at all.
- **Thumbnails flash on scroll-back by design.** Revoking object URLs on load (T027) trades a brief icon-to-image swap on remount for bounded memory. The HTTP cache makes the second load nearly instant. Leave it unless the measurement shows a problem.
- **Overscan is a DOM-budget decision.** Each extra overscan row in the grid adds up to ten or more tiles, each with an observer registration. The values of 8 list rows and 2 grid rows are starting points; §16.2 treats performance values as tunable, so keep them as named constants and adjust only with measurements.
- **Strict indexing.** The repo compiles with `noUncheckedIndexedAccess`: `entries[i]` is `FsEntry | undefined`. Guard every lookup (`getItemKey` falls back to the index; the render loops skip an undefined entry) rather than using `!`.
- **Truncation is at 10,000, not at the window.** The truncation banner is about the server's `MAX_ENTRIES`. It is unrelated to virtualization and must appear identically whether or not the list is windowed.
- **The 500 ms server target is not a client concern.** If step 2 of the measurement fails, the cause is almost certainly in directory reading and `stat` concurrency in T011; do not compensate with client caching or pagination.
- **Windows and path length.** The scratch fixture creates 10,000 files in a single directory. NTFS handles it, but antivirus scanning can make creation slow; allow a minute on a managed Windows laptop and exclude the fixture folder from the scan if you can.
