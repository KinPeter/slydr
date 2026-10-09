# T035 — Responsive pass across all three screens

**Epic:** E20 — Responsive pass across all three screens at every breakpoint
**Spec sections:** §10 (FR-17), §7.1, §7.3, §8.1, §9.5, §12.6
**Depends on:** T026, T027, T028, T029, T030, T031, T032, T033, T034
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based application that plays customizable slide shows of images stored in folders on the user's own computer. Its React client has three screens: a file explorer, a slide show configuration screen, and a slide show player. Each screen ticket (T020, T022, T026 to T029, T033) already carries its own responsive CSS for the specification §10 table: the breakpoint documentation and gutter token live in T020, the explorer header reflow, row geometry and size-column rule in T026, the three grid bands and `gridMetrics.ts` in T027/T028, the configuration column in T029, and the controls pill sizing in T033.

This ticket is the **verification and finishing pass** over that work. It does not re-implement it. It (1) adds the mechanical tripwire tests that keep the stylesheets inside the canonical breakpoint set, (2) closes the one genuinely missing piece of the §10 table — the aggressive breadcrumb collapse below 768 px, which needs the `maxVisibleSegments` prop that T022 now provides — (3) adds the remaining `env(safe-area-inset-*)`, `scrollbar-gutter` and `touch-action` details where earlier tickets left them out, (4) audits fixed lengths, hover rules and viewport units, and (5) runs the five-viewport sweep in both themes and records the result. Nothing here changes data flow, API usage or persisted keys.

## 2. Scope

### In scope

- A Vitest tripwire suite that reads every stylesheet under `client/src` and asserts: only canonical `@media` widths; no `font-size` in px outside comments; every `:hover` rule guarded or annotated; no `100vh` without a `100dvh` partner; no `overflow-x: hidden` on `html`/`body`.
- `useBreadcrumbCap()` in the explorer (`matchMedia('(min-width: 768px)')` → `maxVisibleSegments` of `1` below 768 px, `undefined` from 768 px up), wired into `ExplorerHeader`'s `Breadcrumb`.
- `scrollbar-gutter: stable` on the explorer body (the scroll container, T026 `.body`), as T028 §8 asks.
- `env(safe-area-inset-*)` on the explorer header and footer paddings, where T026 does not already apply it (config column and footer already do, T029; the pill already does, T033).
- A `touch-action: manipulation` audit on rows, tiles and the player root; adding it where absent.
- The verbatim "swipe is not bound" comment at the top of `client/src/screens/Player/Player.tsx`.
- Verification (and a fix in the owning file only if the check fails) of every row of the §10 table, listed in §4.2.
- A `setViewport` extension to T021's `matchMedia` test helper (no second stub).
- The manual five-viewport checklist, both themes.

### Out of scope

- Re-implementing anything listed in §3 (the table). If a check fails, fix it in the file the owning ticket created, mention the ticket in the PR, and keep the change minimal.
- Contrast, ARIA, live regions, focus order, titles, headings, landmarks, forced colours — **T036**. The `prefers-reduced-motion` player override — **T032**.
- Any API, `localStorage` key, selection, playlist, timing, shuffle, loop or fullscreen change.
- Virtualization behaviour — **T028**. End-to-end (e2e) testing is out of scope; 320 px and 1920 px are verified manually in a real browser.
- Touch swipe navigation (excluded from v1, spec §10 and §16.2 item 4).
- Caps on grid width at 4K: T027 states there is no fourth grid step; `auto-fill` simply adds columns. If the 3840 × 2160 sweep looks wrong, raise it as a product question in the PR, do not add a `max-width` here.

## 3. Prerequisites and assumed state

The repository is not empty. What each earlier ticket already delivers for §10, and therefore what this ticket only verifies:

| §10 item | Owner | What already exists |
|---|---|---|
| Breakpoints | T020 | `--bp-sm/md/lg/xl` = 480/768/1024/1440px in `tokens.css`; breakpoint documentation block in `base.css`; `base.test.ts` asserts only those four values are documented |
| Type scale, base size, targets | T020 | `--text-xs … --text-2xl`, `html { font-size: 100% }`, `--target-min: 2.75rem` (44 px), `--target-min-coarse: 3rem` (48 px) |
| Gutter, no sideways scroll | T020 | `--page-gutter: 1rem`, `.page-gutter` utility (left/right padding with `safe-area-inset-left/right`), `overflow-x: clip` on `body` only (never `overflow-x: hidden`, nothing on `html`, so `position: sticky` keeps working) |
| Explorer header: two rows below 768 px, icon-only toggles below 1024 px, labels from 1024 px | T026 | Layout in `ExplorerHeader.module.css`; 768–1023 px is a single row with icon-only toggles (T026 §4.2 decision) |
| Explorer list rows, size column hidden below 480 px | T026 | Fixed `--explorer-row-h: 48px` (56 px under `pointer: coarse`) so T028's virtualizer has an exact `estimateSize`; `@media (max-width: 479.98px) { .size { display: none } }` |
| Delegated double-click / double-tap | T026 | Handlers on the `listbox`/`grid` container, 300 ms touch fallback, `handleEntryPointer` in `useEntryHighlight.ts` |
| Grid bands 104/132/160 px | T027 | `EntryGrid.module.css`, `gridMetrics.ts` (`GRID_MIN_TILE_PX`, `columnsFor`, `useTileMin`, `useGridColumns`), `data-tile-min` attribute |
| Config column | T029 | Full width with `max(var(--space-4), env(safe-area-inset-*))` gutter below 768 px, `max-width: 35rem` from 768 px, sticky footer, slider row |
| Player pill | T033 | Bottom-centre pill; below 768 px buttons are 48 px with `gap: var(--space-1)` and `padding-inline: var(--space-2)` and the counter is hidden (5 × 48 + 4 × 4 + 2 × 8 = 272 px, which fits the 288 px available at 320 px); from 768 px buttons are 44 px (48 px under `pointer: coarse`) |
| Breadcrumb collapse | T022 | `Breadcrumb` with measurement-driven collapse (Home + last two always visible) and, new in this revision, `maxVisibleSegments?: number` (last `m` segments plus an ellipsis menu that lists Home first) |
| Test helper | T021 | `client/test/helpers/matchMedia.ts` exporting `installMatchMedia(initial?)` returning `{ setMatches, listenerCount, dispose }` |

Server surface and tooling are unchanged: Vitest (jsdom for `client`), React Testing Library, `jsx-a11y`.

## 4. Implementation detail

### 4.1 Canonical media queries (tripwire test)

The four `min-width` values are 480, 768, 1024 and 1440 px (T020 `--bp-*`). Because CSS cannot read custom properties inside `@media`, every stylesheet writes the literal. Downward conditions use the `.98px` `max-width` forms — `479.98px`, `767.98px`, `1023.98px`, `1439.98px` — so a fractional viewport can never fall into both branches or neither. Whole-pixel `max-width: 767px` is not allowed.

`client/test/styles/mediaQueries.test.ts` reads `client/src/**/*.css` (recursive `node:fs`, `path.join`, `fileURLToPath`; no globbing dependency), strips CSS comments, and asserts the rules in §6.1. The allowed width set is **derived** from `tokens.css` (the four `--bp-*` values) so there is one source of truth; the `.98px` forms are computed as `value - 0.02`. On failure the message names the file and the offending literal.

Known fix required by this test: T026's size-column rule must read `(max-width: 479.98px)`. T026 has been updated; if any other stylesheet fails the test, change that literal in place.

### 4.2 Verification matrix for the §10 table

For each row, open the owning ticket's component at the stated width (component tests where cheap, otherwise the §6.3 checklist) and tick it. Only if a check fails, make the minimal fix in the owning file.

| Check | How verified | If it fails |
|---|---|---|
| Header is two rows below 768 px, one row from 768 px, toggles icon-only below 1024 px | CSS-source test of `ExplorerHeader.module.css` (§6.2) plus checklist | Fix `ExplorerHeader.module.css`; use `minmax(0, 1fr)` for the flexible track and `min-width: 0` on the breadcrumb, never `1fr` alone |
| Every header button ≥ 44 px (48 px coarse) | Uses `--target-min` / `--target-min-coarse` (T022 `IconButton` already does) | Use the tokens, not new rem literals |
| List rows ≥ 44 px, size column hidden below 480 px | CSS-source test of `EntryList.module.css`/`EntryRow` rules | Keep T026's fixed px height tokens; do **not** convert `--explorer-row-h` to rem or measure rows |
| Grid bands exactly 104/132/160 px, `auto-fill`, `1fr` | CSS-source test of `EntryGrid.module.css`; T027's `gridMetrics.test.tsx` already covers `columnsFor` | Fix the CSS to T027's values |
| Config column full width + gutter below 768 px, `35rem` centred from 768 px; slider row stretches; footer reachable at 320 px | CSS-source test of `Config.module.css` plus checklist | Fix to T029's values |
| Pill: 48 px buttons below 768 px, counter hidden, fits 288 px at 320 px, 44/48 px from 768 px | CSS-source test of `PlayerControlsOverlay.module.css` (the media-query *order* must be: pointer rule first, then the `max-width: 767.98px` rule, so the narrow band wins) plus checklist at 320 × 568 | Fix the CSS in T033's file, never hide a button |
| Gutter ≥ 16 px at 320 px on all screens | Screens use `.page-gutter` or `max(var(--space-4), env(safe-area-inset-*))` | Apply `.page-gutter`/the same `max()` form to the outer wrapper |
| Breadcrumb collapses to the current segment + overflow button below 768 px | New: §4.3 | — |
| Explorer body avoids scrollbar-driven column flicker | New: §4.4 | — |

### 4.3 Aggressive breadcrumb collapse (the one missing piece)

Spec §10: "breadcrumb collapses aggressively" below 768 px. T022's measurement-driven collapse never hides Home or the last two segments, so the product rule needs the explicit prop. In `client/src/screens/Explorer/useBreadcrumbCap.ts`:

```ts
import { useSyncExternalStore } from 'react';

const MD_QUERY = '(min-width: 768px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(MD_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(MD_QUERY).matches : true;
}

/** `1` below 768 px (current folder + overflow menu only), `undefined` from 768 px (T022 default layout). */
export function useBreadcrumbCap(): number | undefined {
  const isMdUp = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return isMdUp ? undefined : 1;
}
```

`ExplorerHeader.tsx` calls it and passes `maxVisibleSegments={cap}` to `<Breadcrumb … />`. Result at 320 px for the path `a/b/c/d`: the ellipsis button named "Show hidden folders", then the non-interactive current segment `d` (truncated with an ellipsis when long); the menu lists `Home`, `a`, `b`, `c` in that order. From 768 px the T022 default applies (Home, ellipsis, last two). The hook subscribes (not samples) to `change`, so rotating a tablet or resizing the window updates it; the `change` listener is removed on unmount.

### 4.4 Safe-area, scrollbar-gutter and touch details

1. **Safe area.** The explorer header and footer horizontal paddings use `max(var(--space-4), env(safe-area-inset-left), env(safe-area-inset-right))` (or `.page-gutter`); the footer's bottom padding uses `max(var(--space-3), env(safe-area-inset-bottom))`. Check the configuration screen and pill (already present) and leave them.
2. **`scrollbar-gutter: stable`** on the explorer body (`.body`, the scroll container, T026/T028). Without it, a classic scrollbar (Windows, most Linux) that appears narrows the container, reduces the grid's column count, lengthens the content and can toggle the scrollbar again. macOS overlays scrollbars and is unaffected, so reserve nothing by hand and do not subtract a magic number.
3. **`touch-action: manipulation`** on `.row`, grid tiles and `.player`. It removes the 300 ms tap delay and suppresses double-tap-to-zoom, which would fight the double-tap gesture. Do not set `touch-action: none` or `pan-y` on the player.
4. **Viewport units.** Any full-height layer uses `100dvh` with an optional `100vh` fallback declared first; the explorer `.screen` (T026) and the player (`100dvh`, FR-16.2) already do. The tripwire test (§6.1) rejects a lone `100vh`.
5. **Swipe comment.** Put this verbatim at the top of `client/src/screens/Player/Player.tsx`, and bind no horizontal swipe, drag or `touchmove` handler anywhere in `client/src`:

   ```ts
   // Horizontal swipe navigation is deliberately NOT bound in v1 (specification §10 and
   // §16.2 item 4): on iOS Safari and Chrome on Android a horizontal drag from near the
   // screen edge is the browser's back/forward gesture, and intercepting it either breaks
   // navigation or produces a 50/50 race depending on where the drag started. Prev/next are
   // reachable from the controls overlay (tap) and from the arrow keys. Revisit only with an
   // explicit product decision.
   ```

### 4.5 Audits (no behaviour change)

- **Fixed lengths.** Convert fixed `px` lengths to `rem`/`%`/`fr` except: hairline `1px` borders, shadow offsets and blur radii, `blur(32px)` on the player background, the grid `minmax(104/132/160px, 1fr)` values (the specification states them in px), media-query widths, T026's fixed row heights (`48px`/`56px`, needed for T028's exact estimate), and anything defined by a `--target-min*` token. Do not introduce raw `rem` literals for touch targets; use the tokens.
- **Hover.** Every `:hover` rule is inside `@media (hover: hover)` or carries a `/* hover-ok: <reason> */` comment on the preceding line. Anything revealed on hover also appears on `:focus-visible`/`:focus-within` and is always visible under `@media (hover: none)`.
- **`title` tooltips** (grid tile names, the configuration wire path) are conveniences only; the same text is available without hover (tile accessible name; visible muted path text).
- **Global reset.** Do not add a global `* { min-width: 0 }`. Apply `min-width: 0` (or `minmax(0, 1fr)`) on the specific flex/grid children that hold user-supplied text.

### 4.6 Test helper: `setViewport`

Extend `client/test/helpers/matchMedia.ts` (T021) — do **not** create a second stub. Add an optional resolver to `installMatchMedia` and a factory:

```ts
export interface ViewportOptions {
  width: number;
  height?: number;
  hover?: 'hover' | 'none';
  pointer?: 'fine' | 'coarse';
  reducedMotion?: boolean;
}

/** Answers (min-width|max-width: Npx), (hover: …), (pointer: …) and (prefers-reduced-motion: reduce) for a synthetic viewport. */
export function installViewport(opts: ViewportOptions): MatchMediaController & { setViewport(next: Partial<ViewportOptions>): void };
```

`installViewport` calls `installMatchMedia`, resolves each queried string with the parser, and `setViewport(next)` re-evaluates every known query and fires `change` only for queries whose result flipped. Its own tests live in `client/test/helpers/matchMedia.test.ts` (add to T021's file).

## 5. Acceptance criteria

- [ ] `client/test/styles/mediaQueries.test.ts` passes: every `@media` width literal under `client/src` is one of `480px`, `768px`, `1024px`, `1440px`, `479.98px`, `767.98px`, `1023.98px`, `1439.98px` (derived from `--bp-*`).
- [ ] No `font-size` declared in `px` outside comments; no stylesheet overrides the root font size; no `overflow-x: hidden` on `html` or `body`.
- [ ] Every `:hover` rule is inside `@media (hover: hover)` or annotated `/* hover-ok: … */`.
- [ ] Below 768 px the explorer breadcrumb shows only the overflow button and the current segment, and the menu's first item is "Home"; from 768 px it shows Home, ellipsis and the last two segments. The viewport listener is removed on unmount.
- [ ] The explorer body declares `scrollbar-gutter: stable`; the explorer header/footer use the safe-area `max()` padding; rows, tiles and the player root declare `touch-action: manipulation`.
- [ ] The explorer header is two rows at 767 px and one row at 768 px; toggles are icon-only below 1024 px and labelled from 1024 px (CSS-source test plus checklist).
- [ ] The list size column is hidden below 480 px and present from 480 px; row height is ≥ 44 px (48 px coarse) via T026's fixed tokens.
- [ ] The grid uses `repeat(auto-fill, minmax(104px, 1fr))` below 768 px, `minmax(132px, 1fr)` from 768 px, `minmax(160px, 1fr)` from 1024 px.
- [ ] The configuration column is full width with ≥ 16 px gutters below 768 px and `max-width: 35rem` (560 px) centred from 768 px.
- [ ] The player pill has 48 px buttons and no counter below 768 px, 44 px (48 px coarse) from 768 px, all five buttons present, and fits inside `100% - 2 * 16px` at 320 px.
- [ ] A tap anywhere in the player reveals the controls and does not change the slide or the pause state (T033 behaviour, re-verified); `Player.tsx` carries the swipe comment from §4.4; no swipe/`touchmove` handler exists in `client/src`.
- [ ] `document.documentElement.scrollWidth <= clientWidth` at each of 320 × 568, 768 × 1024, 1366 × 768, 1920 × 1080 and 3840 × 2160 on all three screens, in both themes (manual checklist in a real browser).
- [ ] No second `matchMedia` stub exists; `installViewport` extends T021's helper.
- [ ] The completed §6.3 checklist is pasted into the pull request description.

## 6. Tests to write

Per specification §12.3 and §12.6. jsdom has no layout engine: tests assert on CSS source text, DOM attributes and `matchMedia`-driven props, never on computed layout.

### 6.1 `client/test/styles/mediaQueries.test.ts`

- `every @media width literal is a canonical breakpoint` — strip comments, match `/\((?:min|max)-width:\s*([^)]+)\)/g`; allowed set derived from `tokens.css` `--bp-*` and `value - 0.02`.
- `no max-width uses a whole-pixel breakpoint` — `(max-width: 479px)`, `767px`, `1023px`, `1439px` fail.
- `no font-size is declared in px outside comments`.
- `no stylesheet other than base.css sets the root font size`.
- `html and body never use overflow-x: hidden`.
- `every :hover rule is guarded or annotated` — crude tripwire: the occurrence sits inside an `@media (hover: hover)` block or the previous non-blank line contains `/* hover-ok:`.
- `every 100vh declaration is followed by a 100dvh declaration in the same rule`.
- `no touchmove, swipe or horizontal pointer-drag handler is bound in client/src` (greps `.ts`/`.tsx`).

### 6.2 CSS-source assertions (one small file per screen under `client/test/screens/…`)

- `client/test/screens/Explorer/responsive.css.test.ts` — header grid is one column below 768 px and two areas from 768 px; the flexible track is `minmax(0, 1fr)`; `.size` is hidden in the `479.98px` block; grid bands equal 104/132/160 px; `.body` has `scrollbar-gutter: stable`; rows, tiles have `touch-action: manipulation`.
- `client/test/screens/Config/responsive.css.test.ts` — `.column` is `width: 100%`, `max-width: 35rem` only inside `min-width: 768px`; padding uses the safe-area `max()`.
- `client/test/screens/Player/pill.css.test.ts` — inside `max-width: 767.98px`: button size 48 px (via token or literal), `.counter { display: none }`, `gap: var(--space-1)`; the `pointer: coarse` block appears **before** the `767.98px` block; no `border-radius: 999px` literal (uses `--radius-pill`).

### 6.3 Component tests

Paths below are explicit full paths under `client/test/` (mirroring `src/screens/`).

- `client/test/screens/Explorer/useBreadcrumbCap.test.tsx` — with `installViewport({ width: 767 })` returns `1`; at 768 returns `undefined`; fires on `setViewport({ width: 800 })`; returns `undefined` when `matchMedia` is missing; removes its listener on unmount (`listenerCount` is 0).
- `client/test/screens/Explorer/ExplorerHeader.responsive.test.tsx` — at width 320 and path `a/b/c/d` the header shows the button "Show hidden folders" and no "Home" button in the trail; opening the menu lists `Home`, `a`, `b`, `c` in order; at 768 the standard layout renders ("Home" button visible).
- `client/test/screens/Player/touchReveal.test.tsx` — a `pointerdown` with `pointerType: 'touch'` on the player root reveals the overlay and leaves `data-status` and the counter unchanged.
- `client/test/helpers/matchMedia.test.ts` — `installViewport` answers min/max-width, hover, pointer and reduced-motion queries; `setViewport` fires `change` only for flipped queries.

### 6.4 Manual checklist (record in the pull request)

Run in a real browser, Chrome DevTools device toolbar is enough (for 3840 × 2160 use a real 4K display or record the zoom used). For **each** of 320 × 568, 768 × 1024, 1366 × 768, 1920 × 1080, 3840 × 2160 and in **both** themes:

**Global**
- [ ] `document.documentElement.scrollWidth === clientWidth` on all three screens; ≥ 16 px between the viewport edge and the nearest text/control; nothing clipped at the bottom; no rendered font below 12 px.

**Explorer**
- [ ] 320: two-row header; breadcrumb = overflow button + current segment, menu opens fully on screen and lists Home first; toggles icon-only and ≥ 44 px; chip truncates instead of wrapping; list rows show icon + name only; grid shows two 104 px columns; footer button reachable, folder name truncates; scrolling a 2000-entry folder is smooth with no column flicker.
- [ ] 768: single row, icon-only toggles, Home + ellipsis + last two; size column visible; 132 px tiles.
- [ ] 1366 and 1920: labelled toggles, 160 px tiles, grid fills the width.
- [ ] 3840: the grid, header and footer remain readable (record what the grid does; do not add a cap here).

**Configuration**
- [ ] 320: full-width column with a visible gutter; back link, title and theme toggle fit; wire path truncates; slider spans the column and the readout does not jiggle between `9 s` and `10 s`; every option row ≥ 44 px; "Play slide show" reachable without scrolling past the sticky footer.
- [ ] 768 and up: column exactly 560 px, centred; the theme toggle is in the column's header row (T029), check it looks deliberate at 3840.

**Player**
- [ ] 320: image fitted, never cropped; blurred background reaches all edges including behind the pill; pill fits with a 16 px gutter and all five buttons; a tap reveals the controls and auto-hides after 2 s without changing the slide; a horizontal swipe does the browser's back gesture or nothing, never a slide change; landscape (568 × 320) keeps the pill on screen.
- [ ] 768 and up: pill content-sized and centred, `--space-6` above the bottom edge, counter visible; mouse movement reveals controls and cursor, both hide after 2 s.
- [ ] 3840: pill centred and clickable; note how small images are upscaled (FR-16.3 says fit; an upscale cap is a product decision, report it).

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on Windows, macOS and Linux.
- [ ] All acceptance criteria in §5 are checked and the §6.4 checklist is in the PR description, with a screenshot of each screen at 320 × 568 and at 1920 × 1080.
- [ ] No behavioural change: the existing T026 to T034 suites pass unmodified, except where a test asserted a layout value this ticket deliberately corrected; call that out in the diff.
- [ ] README: no change (T041 owns it; the double-tap interaction is already documented there).

## 8. Notes and gotchas

- **jsdom has no layout.** `getComputedStyle` does not resolve CSS Modules, does not apply `@media`, and reports zero `scrollWidth`. That is why the checks are CSS-source tripwires plus a manual sweep; "no horizontal scroll" is proven in a real browser (manual sweep here). Do not write tests that assert computed layout.
- **`minmax(0, 1fr)`, not `1fr`.** A `1fr` track has an implicit `min-content` minimum; a long unbreakable file name expands it and overflows the page. If a horizontal scrollbar appears, check this first.
- **`overflow-x: clip`, not `hidden`.** T020 uses `clip` on `body` only so sticky descendants keep sticking. Never "fix" overflow by adding `overflow-x: hidden` to `html`/`body`.
- **Scrollbar width differs by platform.** Windows and most Linux desktops reserve layout width for a scrollbar; macOS overlays it. Always run the 320 px case on Windows (the dev machine) and rely on `scrollbar-gutter: stable`, not magic numbers.
- **Pill arithmetic.** At 320 px the pill may be at most 288 px wide. With the T033 values it needs 272 px. If a future icon set or padding pushes it over, shrink gap/padding, never remove a button.
- **`backdrop-filter` on software renderers.** The pill's `--overlay-bg` is dark and opaque enough to be legible with no blur; check by turning `backdrop-filter` off in DevTools over a white image.
- **The 768–1023 px label split** is T026's decision (icon-only until 1024 px); if the product owner prefers labels at 768 px it is a one-line change to the toggle `@media` value in T026.
- **Assumption A2 (§16.1):** the browser back gesture leaves the app (no router). That is accepted v1 behaviour and one more reason not to bind swipe.
- **Assumption A4 (§16.1):** thumbnails are square-cropped, so tile height equals the `minmax` minimum; `gridMetrics.ts` relies on it.
- **Open item §16.2 item 4:** touch swipe in the player is excluded in v1; mention it in the PR so the exclusion is a visible decision.
