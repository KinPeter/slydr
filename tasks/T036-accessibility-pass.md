# T036 — Accessibility pass across all three screens

**Epic:** E21 — Accessibility pass
**Spec sections:** NFR-6, §6.3, §6.4, §7.2 (FR-14.8), §8.2, §9.4, §9.5, §9.6, §12.3
**Depends on:** T026, T027, T028, T029, T030, T031, T032, T033, T034
**Estimated size:** M

---

## 1. Context

Slydr is a three-screen single-page application (file explorer, slide-show configuration, full-screen player). Each screen ticket applied accessibility basics as it went: T020 asserts token contrast and defines the focus ring and `.sr-only`, T022's `Banner` and `Slider` carry their live-region and value-text semantics, T026 to T028 build the `listbox`/`grid` with `aria-activedescendant`, `aria-setsize` and `aria-rowcount`, T029 has a stable status region and the reduced-motion note, T032 implements the reduced-motion override, T033 hides the overlay with `inert`. This ticket is the single systematic audit and repair pass over the finished application against WCAG 2.1 level AA (NFR-6). It **verifies** all of that, **adds** what is genuinely missing (document titles, headings, the `main` landmark, a skip link, focus management on screen changes, an explorer live status, forced-colours rules), **adds automated regression checks** (`vitest-axe`, source-rule tripwires, extra contrast rows), and fixes defects in the earlier components. Responsive layout is T035's.

## 2. Scope

### In scope

- Extending T020's contrast test (`client/test/styles/tokens.test.ts`) with the rows it lacks. There is no second contrast implementation and no CLI script.
- Verifying the accessible names, roles, live regions, `listbox`/`grid` semantics, slider semantics and reduced-motion behaviour listed in §4, and fixing what fails in the owning file.
- New: `useDocumentTitle`, the single `main` landmark, the skip link, one `h1` per screen, `lang`, focus management on view changes, the explorer's debounced live status, `@media (forced-colors: active)` rules.
- Automated tooling: `vitest-axe` unit tests per screen state; source-rule tripwire tests (positive `tabindex`, `outline: none`).
- A short manual keyboard / zoom / forced-colours / reduced-motion check, recorded in the PR.
- Fixing the defects found in earlier components.

### Out of scope

- Breakpoints, touch-target sizing and layout reflow — T035. This ticket checks 200 % zoom and 320 px reflow for accessibility defects only.
- Playwright configuration and every e2e spec, including the axe scan in a real browser (`e2e/tests/a11y.e2e.ts`, owned by **T038**, which adds `@axe-core/playwright` as a root devDependency). This ticket adds no e2e file and no CI step.
- A contrast CLI script, `check:contrast`, and any change to `.github/workflows/` — contrast runs inside `npm test` through T020's test.
- Screen-reader evidence (NVDA/VoiceOver sessions): not required. The accessibility tree is exercised by `vitest-axe` and by Testing Library role queries; names, roles and values must be correct, which is what screen readers consume.
- A player-side "failed" screen. There is none: when every image fails the player exits to the configuration screen, where T029 renders the message in a `Banner` (already `role="alert"`).
- README text — T041 (this ticket supplies the accessibility note in §8).
- New features or visual redesign.

## 3. Prerequisites and assumed state

All screens exist: explorer (T026 list, T027 grid, T028 virtualization, with image-count chip and error banner), configuration (T029), player (T030 to T034). Tokens are in `client/src/styles/tokens.css` (light baseline on `:root`, dark in both `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` and `:root[data-theme='dark']`) and include `--overlay-fg` and `--overlay-fg-muted`; `base.css` defines the global `:focus-visible` ring from `--focus-ring` and the `.sr-only` utility. Test tools: Vitest, React Testing Library (jsdom), `client/test/helpers/matchMedia.ts` (T021, extended by T035). `eslint-plugin-jsx-a11y` is already enabled by T019.

**The names every screen must expose (single contract, quoted by T026, T029, T033, T035, T036, T038):**

| Screen | Control / region | Accessible name |
|---|---|---|
| Explorer | up button | `Up one level` |
| Explorer | view mode | `role="group"` named `View mode` with two buttons `List view` and `Grid view`, state in `aria-pressed` |
| Explorer | show hidden | one button named `Show hidden items`, state in `aria-pressed` (the label never changes) |
| Explorer | breadcrumb | `<nav aria-label="Breadcrumb">`; ellipsis button `Show hidden folders`; Home button `Home` |
| Explorer | entry region | `role="listbox"` / `role="grid"` named `Folder contents` |
| Explorer | footer | button `Select this folder` |
| Explorer / Config | theme | `Switch to dark theme` / `Switch to light theme` |
| Config | back | `Back to file explorer` |
| Config | slider (the only one) | `Duration for image shown`; `aria-valuetext` `5 seconds` / `1 second` |
| Config | checkboxes | the labels in spec §8.2 |
| Config | primary | `Play slide show` |
| Player | region | `Slide show` |
| Player | toolbar | `Slide show controls`; buttons `Previous image`, `Pause slide show` / `Play slide show`, `Next image`, `Enter full screen` / `Exit full screen`, `Stop slide show` |

## 4. Implementation detail

### 4.1 Contrast (extend T020's test; no CLI)

T020's `client/test/styles/tokens.test.ts` already asserts the text pairs, `--border` (3:1), `--focus-ring` on `--bg` (3:1) and the overlay worst case (`--overlay-fg` / `--overlay-fg-muted` on `--overlay-bg` composited over pure white, 4.5:1) in both themes. Add the missing rows to that file (same helper, same parsing):

| Foreground | Background | Threshold | Theme | Reason |
|---|---|---|---|---|
| `--focus-ring` | `--bg-elevated`, `--bg-sunken` | 3:1 | both | the ring is drawn on headers, footers and the highlighted row |
| `--focus-ring` | `--accent` | 3:1 | dark only | ring against an accent-filled button; **light is exempt** because the light ring *is* the accent colour and the 2 px offset leaves a page-coloured gap (documented in T020) |
| `--accent` | `--bg`, `--bg-elevated` | 3:1 | both | accent as UI: slider fill, highlighted-row border, pressed toggle |
| `--overlay-fg`, `--overlay-fg-muted` | `--overlay-bg` composited over `#808080` | 4.5:1 | both | second backdrop in addition to white |

If a row fails, change the token to the smallest value that passes and note before/after in the PR; never lower a threshold. Decorative and disabled states are exempt from WCAG but must stay visibly distinguishable.

### 4.2 Keyboard operability, focus order and focus visibility

Verify, and fix in the owning component, for each screen:

- Everything is reachable and operable with the keyboard alone (Tab, Shift+Tab, Enter, Space, the arrow/Home/End/Backspace/Alt+← keys defined by T026, T033 and T034). No keyboard trap; the player is the only full-screen takeover, Tab cycles its buttons and then leaves the page, `Escape` stops the show (T034).
- Focus order follows the screen's visual order. The explorer order is T026's: breadcrumb, up button, view-mode group, show-hidden toggle, theme switch, entry region (one stop), "Select this folder". No positive `tabindex` anywhere.
- Every focusable element shows the global `:focus-visible` ring. Rows and tiles show the highlight plus a 2 px outline so `aria-activedescendant` movement is visible without colour alone.
- Native elements are preferred over `div role="button"`.
- **Forced colours.** Add `@media (forced-colors: active)` rules where a state is conveyed only by background or box-shadow (highlighted row, pressed toggle buttons, slider thumb/track, the overlay pill and its buttons): use `outline`, `border` and system colours (`Highlight`, `ButtonText`, `Canvas`, `CanvasText`). Use `outline`, not `box-shadow`, for focus.

Source-rule tripwires (`client/test/a11y/sourceRules.test.ts`): no `tabindex`/`tabIndex` with a value above 0 in `client/src`; every `outline: none` / `outline: 0` in a stylesheet is inside a `:focus:not(:focus-visible)` rule or has a `:focus-visible` replacement in the same file.

### 4.3 Accessible names

Audit every `IconButton` and clickable icon against the table in §3. Icons are decorative (`aria-hidden="true"`, `focusable="false"`); the name comes from `aria-label` or visible text. State on toggles is expressed with `aria-pressed` and a **constant** label — never a flipping label combined with `aria-pressed`. The only labels that change with state are the theme toggle and the player's pause/play and fullscreen buttons, which are plain buttons without `aria-pressed`.

### 4.4 Live regions

Keep every live region mounted from first render and change only its contents.

| Screen | Region | Owner | Verify / add |
|---|---|---|---|
| Explorer | listing errors, truncation and restore notices | T022 `Banner`, T026 | `Banner` is `role="alert"` (error) or `role="status"` (info) with `aria-live="polite"`, `aria-atomic`; verify, do not wrap |
| Explorer | image count | T026 chip (not live by itself, T022) | **Add** `ExplorerLiveStatus`: one always-mounted `<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">` that mirrors the chip text after **300 ms of stability** (small `setTimeout`), so rapid folder navigation announces only the final state; the visible chip still updates immediately |
| Config | "N images found" / "Scanning…" | T029 `ImageCountStatus` (`role="status"`, stays mounted) | verify |
| Config | "Settings reset to defaults." | T029 | verify |
| Config | player notice | T029 `Banner variant="error"` | verify; no extra wrapper |
| Player | none | — | Slide changes are **not** announced (the counter is plain text); there is no player error region |

### 4.5 `listbox` / `grid` semantics (verify; fix only on failure)

Using a virtualized fixture of at least 1000 entries (T028), verify: the container is the single tab stop with `aria-label="Folder contents"` and a valid `aria-activedescendant` (the highlighted element is always rendered, ids are `slydr-entry-{index}` and stable); virtualized options carry `aria-setsize={entries.length}` / `aria-posinset`; the virtualized grid carries `aria-rowcount`, `aria-colcount`, rows `aria-rowindex`, cells `aria-colindex`; `Home`, `End` and the arrow keys move the highlight; `Enter` opens a folder only; navigating into a folder keeps focus on the container and resets the highlight. `aria-selected` stays on the highlighted option as T026 builds it. If the grid has `role="gridcell"` without `role="row"` parents in the non-virtualized variant, add the rows (a `gridcell` requires a `row`).

### 4.6 The slider

The configuration screen has exactly one slider (spec §8.2). T022's `Slider` is a native `input type="range"` with a visible label association, a visible readout (`5 s`), `aria-valuetext` with units (`5 seconds`, `1 second`), arrows ±1, `PageUp`/`PageDown` ±5, `Home`/`End`. Verify through the integrated screen; fix in `Slider`, not in the screen.

### 4.7 `prefers-reduced-motion`

Verify only (T029 and T032 own the behaviour): effective animations are `config.animations && !prefersReducedMotion` through `useEffectiveAnimations`; the stored value is never written; the configuration screen shows T029's note — "Your system is set to reduce motion, so the slide show plays without animations. Your choice here is kept." — associated with the checkbox via `aria-describedby`; non-essential UI transitions are `0s` under the media query; the overlay fade is instant under the media query (T033) although it is otherwise exempt from the `animations` setting.

### 4.8 Titles, headings, landmarks, language, skip link

- `index.html` has `<html lang="en">` (English only in v1).
- `client/src/lib/useDocumentTitle.ts`, called once from `App.tsx` with the current view: explorer `Choose a folder — Slydr`, configuration `Slide show settings — Slydr`, player `Slide show — Slydr`.
- **Exactly one `h1` per screen**: explorer — visually hidden `Choose a folder` (T026); configuration — the selected **folder name** (spec §8.1, T029); player — visually hidden `Slide show` (add to `Player.tsx` inside the region). Headings do not skip levels. The `h1` of the configuration screen and the explorer carry `tabIndex={-1}` / the explorer's entry region is the focus target (§4.9).
- **One `main`.** `AppScreens` in `App.tsx` renders `<main id="main" tabIndex={-1}>` around the active screen, with `min-height: 100dvh; display: flex; flex-direction: column`; screens render no `main` of their own (remove the `<main>` from any placeholder or screen that still has one). The player region `Slide show` is a `div role="region"` inside it. The breadcrumb is a labelled `nav`. `header`/`footer` elements may be used for structure but are not required landmarks.
- **Skip link.** `App.tsx` renders `<a class="skipLink" href="#main">Skip to main content</a>` as the first focusable element when the view is `explorer` or `config`; visually hidden until focused; omitted in the player.

### 4.9 Focus management

`App.tsx` keeps the previous view in a `useRef` (no new `AppState` field). In an effect that runs after a view change (never on the initial mount, so the page load does not steal focus), using `requestAnimationFrame` so the target exists:

| Transition | Focus goes to |
|---|---|
| any → `player` | the player root (`tabIndex={-1}` on `.player`, `.focus({ preventScroll: true })`), so a screen reader announces `Slide show, region` and the first Tab reaches `Previous image` (T033). Implemented in `Player.tsx` itself. |
| `player` → `config` | the `Play slide show` button if it is enabled, otherwise the `h1` |
| `explorer` → `config` | the `h1` (folder name) |
| `config` → `explorer` | the entry region (`[data-focus-target="entries"]`: the listbox/grid container) |

Within a screen: navigating into a folder or up keeps focus on the listbox/grid container (never `body`); when Retry succeeds the banner unmounts and focus moves to the container, when it fails again focus stays on Retry. Screens expose their targets with `data-focus-target="play" | "entries"` attributes rather than the effect querying class names. There are no dialogs in v1.

### 4.10 Automated tooling

```
npm install -D vitest-axe axe-core --workspace client
```

In `client/test/setup.ts` register `expect.extend(axeMatchers)` (`import * as axeMatchers from 'vitest-axe/matchers'`) and add `client/test/helpers/axe.ts` exporting `checkA11y(container)`, which runs `axe(container, { rules: { 'color-contrast': { enabled: false } } })` — jsdom has no layout or computed colours, so contrast is covered by T020's test (§4.1) and, in a real browser, by T038's axe e2e. `client/test/a11y/*.a11y.test.tsx` renders each screen state and asserts `toHaveNoViolations()`: explorer (list, grid, error banner, empty folder, 1000-entry virtualized list), configuration (idle, scanning, zero images, reduced-motion note shown, player notice shown), player (playing, paused, overlay hidden).

### 4.11 Manual check (record in the PR)

No screen-reader session is required. Run once per release candidate, in Chrome on the dev machine:

1. **Keyboard only** (no mouse): traverse all three screens, start and stop a show, operate every control; confirm no trap, visible focus everywhere, correct focus after each transition of §4.9.
2. **200 % browser zoom** and a **320 CSS px** wide window: no loss of content or function (coordinate with T035's sweep).
3. **Windows forced colours** (Settings → Accessibility → Contrast themes, or DevTools → Rendering → Emulate `forced-colors: active`): focus, highlighted row, pressed toggles and the player pill stay visible.
4. **OS reduced motion on**: the show plays without animations, the note is shown on the configuration screen, the checkbox stays checked and `slydr.config` is unchanged after a reload.

### 4.12 Defect-fixing mandate and typical suspects

Fix each defect in the earlier component and list it in the PR under "Fixes". Suspects: icon-only buttons without a name; flipping labels combined with `aria-pressed`; `outline: none` without replacement; a live region created together with its text; dangling `aria-activedescendant` under virtualization; focus dropped to `body` after folder navigation, Retry or leaving the player; hidden overlay buttons still focusable (T033 uses `inert`); multiple or missing `h1`/`main`; meaning conveyed only by colour (error without an icon or the word "Error" — `Banner` has both); reduced motion not honoured by the crossfade or background layers.

## 5. Acceptance criteria

- [ ] T020's `tokens.test.ts` contains the extra rows of §4.1 and passes in both themes; no contrast CLI, no `check:contrast` script, no second contrast implementation exists.
- [ ] Every icon-only button on every screen has a non-empty accessible name matching §3 exactly; icons are `aria-hidden`; no toggle combines `aria-pressed` with a changing label.
- [ ] `ExplorerLiveStatus` is mounted from first render and announces the count only after 300 ms without change; the config status region and the `Banner`s are verified to stay mounted.
- [ ] The explorer list/grid semantics of §4.5 hold on a virtualized fixture of at least 1000 items.
- [ ] The configuration screen has exactly one slider, with a visible label association and `aria-valuetext` with units; it works with arrows, `PageUp`/`PageDown`, `Home`/`End`.
- [ ] With `prefers-reduced-motion: reduce` the player runs without animations, the stored `animations` value is unchanged, and the configuration screen shows T029's note.
- [ ] Each screen has exactly one `h1`; `document.title` matches §4.8 per view; the page has exactly one `main#main`; `<html lang="en">`; the skip link is the first Tab stop on the explorer and configuration screens and absent in the player.
- [ ] Focus lands where §4.9 says after every view change and after Retry; it is never lost to `body`; the page load does not move focus.
- [ ] No positive `tabindex` and no unreplaced `outline: none` exist in `client/src`; `@media (forced-colors: active)` rules exist for the states listed in §4.2.
- [ ] `vitest-axe` reports no violations for every state in §4.10.
- [ ] The manual check of §4.11 is done and recorded; all defects found are fixed or filed against the owning ticket in the PR.

## 6. Tests to write

Quality strategy: specification §12.3. All tests under `client/test/`, importing `describe`, `it`, `expect`, `vi` from `'vitest'`.

**`client/test/styles/tokens.test.ts`** (extend T020's file) — the rows of §4.1 for both themes, with the `#808080` composite helper.

**`client/test/a11y/sourceRules.test.ts`** — `no positive tabindex in client/src`; `every outline: none has a focus-visible replacement`; `forced-colors blocks exist in the stylesheets of the explorer, configuration and player`.

**`client/test/a11y/*.a11y.test.tsx`** — `explorer has no axe violations` (list, grid, error banner, empty folder, 1000-item virtualized list); `configuration has no axe violations` (idle, scanning, zero images, reduced-motion note, player notice); `player has no axe violations` (playing, paused, overlay hidden).

**`client/test/a11y/names.test.tsx`** — for each screen, every button with no text content has a non-empty accessible name equal to the §3 table; the view-mode group and show-hidden button keep constant labels and toggle `aria-pressed`.

**`client/test/a11y/liveRegions.test.tsx`** — `explorer status region exists before content and updates 300 ms after the last change`; `config status region stays mounted across scanning, count and error states`; `slide changes are not announced` (no live region inside the player).

**`client/test/a11y/listbox.test.tsx`** — after arrow keys, `aria-activedescendant` references an existing id; `Home`/`End` work; `aria-setsize` equals the total; the active item stays rendered when scrolled out of the overscan window.

**`client/test/a11y/slider.test.tsx`** — the config screen has one `role="slider"`; `aria-valuetext` includes units and updates (`1 second`, `5 seconds`).

**`client/test/a11y/reducedMotion.test.tsx`** — with `installMatchMedia({ '(prefers-reduced-motion: reduce)': true })` the player renders with animations off, `slydr.config` is not written, the config screen shows the note with `aria-describedby`.

**`client/test/a11y/structure.test.tsx`** — `document.title` per view; one `h1` per screen; one `main`; skip link is the first tab stop on explorer and config and absent in the player; no `tabindex` above 0.

**`client/test/a11y/focus.test.tsx`** — entering the player focuses its root; Stop returns focus to `Play slide show` when enabled, otherwise to the `h1`; `config` → `explorer` focuses the entry region; folder navigation and a successful Retry keep focus on the container; the initial page load does not move focus; **back to the explorer and selecting the same folder again does not focus Play** (focus follows the transition, not leftover state such as the retained playlist).

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on Windows, macOS and Linux.
- [ ] The PR description lists: the extended contrast rows with their ratios; the `vitest-axe` pass summary; screenshots of focus rings on each screen in both themes; the completed §4.11 check; the defects fixed with component and file.
- [ ] README: no change here; T041 carries the note in §8.

## 8. Notes and gotchas

- **Accessibility note for T041:** all three screens are fully keyboard operable; the explorer list is one tab stop navigated with the arrow keys; the player honours the OS reduced-motion setting (the configuration checkbox keeps its stored value); the first `Escape` in native full screen only leaves full screen (browser behaviour), a second one stops the show.
- **jsdom cannot test contrast or layout.** `color-contrast` is disabled in unit axe runs; T020's test and T038's real-browser axe cover it.
- **`aria-live` and re-rendering.** Replacing a live region element on every render defeats announcements. Keep one stable element and change only its text. `role="alert"` regions (error `Banner`) are the exception: they are announced when they appear.
- **Do not combine `aria-pressed` with a changing label** on the same toggle.
- **Forced colours** removes `box-shadow` and background images; outlines survive. Emulate `forced-colors: active` in DevTools.
- **Reduced motion is about the OS, not the app.** The app's own `animations` setting keeps working when the OS preference is off; the effective value is the logical AND.
- **Focus and unmounting.** The target element must exist before `focus()`: run the effect after the screen mounts and defer one frame. A disabled `Play slide show` button cannot take focus, hence the `h1` fallback.
- **Do not weaken tokens to pass tests.** If a pair fails, change the token; never lower the threshold or add an exemption without a documented WCAG reason.
