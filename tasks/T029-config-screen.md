# T029 — Build the slide show configuration screen

**Epic:** E14
**Spec sections:** §8 (FR-15.1, FR-15.2, §8.1–§8.4), §4.4, §6.2, §9.1, §9.4, §12.3, §16.1 (A5, A6, A7), NFR-6
**Depends on:** T014, T021, T022, T024, T025
**Estimated size:** L

---

## 1. Context

Slydr is a locally running, browser-based slide show player. After the user picks a folder in the file explorer, the configuration screen is where they decide how the show behaves — how long each image stays up, whether the order is shuffled, whether it loops, whether it animates, whether empty screen space is filled with a blurred copy of the current image, whether it goes full screen, and whether images in subfolders are included. The screen also tells the user how many playable images the chosen folder contains, and that scan doubles as the preparation of the playlist: the images found become the playlist the player uses, so the player needs no second fetch.

This ticket builds that screen in full: the layout, the seven controls with their defaults and copy (six checkboxes and one slider, all taken from the T022 component library), the debounced persistence of every change, the image count and readiness logic (including the zero-image, truncated and failed-scan states), the "Reset to defaults" link, the display of the player's exit notice, and the "Play slide show" action, including the synchronous fullscreen request that browsers require. It also provides two small shared modules in `client/src/lib/`: `usePrefersReducedMotion` (reused by the player animation ticket T032) and `fullscreen.ts` (`requestFullscreenSync`, extended by T030).

## 2. Scope

### In scope

- The screen directory `client/src/screens/Config/` and the `config` branch of `App.tsx` (already routed to the `Config` export of that directory by T024; this ticket replaces the placeholder).
- The layout of spec §8.1: a centred single column of at most 560 px, a header with the "Back to file explorer" link on the left and the theme switch top-right, a title showing the selected folder's name with the wire path as muted secondary text and a `title` tooltip, the controls, and a footer holding the primary "Play slide show" button.
- The seven controls of §8.2, with exact labels, helper copy, ranges and defaults. The six boolean options are **checkboxes** (T022 `Checkbox`); the duration is T022's `Slider`.
- Persistence: every change flows into `AppState.config` through `actions.setConfig`, which the provider persists, debounced at 250 ms, to `slydr.config`.
- The image scan of §8.3: `GET /api/fs/images` on mount and whenever `includeSubfolders` changes, an `aria-live="polite"` status region showing "N images found" or "Scanning…", `items` stored as `AppState.playlist`, the zero-image state, the truncated notice, the failed-scan state with "Retry", and abort of a pending fetch when the toggle changes quickly.
- Redirecting to the explorer when `selection === null`.
- Rendering `AppState.notice` (set by the player when it exits abnormally, spec §9.3) in a dismissible error banner.
- The reduced-motion note beneath the animations checkbox, and the shared `usePrefersReducedMotion` hook (§9.4).
- The "Reset to defaults" secondary button (§8.4).
- The "Play slide show" handler, including the synchronous `requestFullscreenSync(document.documentElement)` call when `startFullScreen` is on and the silent fallback when it is refused (§9.1, FR-16.1).
- Replacing the T024 placeholder: create `client/src/screens/Config/index.ts` and delete the placeholder `client/src/screens/Config/index.tsx` in the same change.
- Component tests per spec §12.3.

### Out of scope

- The server's `GET /api/fs/images` endpoint — T014 (and the scan service, T013). This ticket consumes it.
- The base component library — T022 (`Checkbox`, `Slider`, `Button`, `Banner`, `Icon`, `Spinner`) — and the theme switch — T021 (`ThemeToggle`). They are consumed, not built. Do not re-implement a checkbox row or a slider in this ticket; if a prop is missing, extend the T022 component.
- The application state machine, its action helpers and the persistence layer — T024 and T023. This ticket calls the actions; it does not add state or storage keys.
- The player — T030 onwards. This ticket does not render a player, does not shuffle (the player does that when it starts), and does not preload images. T030 later extends `client/src/lib/fullscreen.ts` (re-exported from `screens/Player/fullscreen.ts`) and dispatches `exitPlayer({ error })`; this screen already renders the resulting `notice`.
- Image sorting. Spec §16.1 assumption **A7**: there is no sort control; the order is the server's FR-3 order unless the player shuffles. Do not add one.
- Keyboard shortcuts for the player — T034, responsive refinements beyond what is written here — T035, the audit of focus order and live regions across all screens — T036.
- A separate "hidden images" option. Spec §16.1 assumption **A6**: `showHidden` in the explorer also governs whether hidden images are played. This screen reads `AppState.explorer.showHidden`; it offers no control for it.
- A preview of the playlist (thumbnails, a list of files). The screen shows a count only.

## 3. Prerequisites and assumed state

The repository is an **npm workspaces monorepo** with three packages — `shared/`, `server/` and `client/`. Everything is ESM (`"type": "module"`) and TypeScript in strict mode (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`). The client is **Vite 7 + React 19**, styled with **CSS Modules** over the design tokens in `client/src/styles/tokens.css`. Tests run under **Vitest with React Testing Library** in the `jsdom` environment; Vitest globals are off, so tests import `describe`, `it`, `expect`, `vi` from `'vitest'`, and every client test lives under `client/test/` (Vitest only discovers `client/test/**/*.test.{ts,tsx}`). Icons come from `lucide-react`. The shared class-name helper is `cx` in `client/src/lib/cx.ts` (T020).

### `@slydr/shared`

```ts
export interface SlideshowConfig {
  durationSeconds: number;    // integer 1..30
  shuffle: boolean;
  loop: boolean;
  animations: boolean;
  fillEmptySpace: boolean;
  startFullScreen: boolean;
  includeSubfolders: boolean; // D1
}

export const DEFAULT_CONFIG: SlideshowConfig = {
  durationSeconds: 5, shuffle: true, loop: true, animations: true,
  fillEmptySpace: true, startFullScreen: true, includeSubfolders: false,
};
export const MIN_DURATION_SECONDS = 1;
export const MAX_DURATION_SECONDS = 30;

export function parseConfig(value: unknown): SlideshowConfig;   // never throws; clamps durationSeconds to an integer in 1..30; no cross-type coercion

export interface ImageItem { name: string; path: string; dir: string; size: number | null; mtimeMs: number | null }
export interface ImagesResponse {
  path: string; recursive: boolean; count: number; truncated: boolean; items: ImageItem[];
}
export const MAX_IMAGES = 20000;     // the scan stops here and sets truncated: true
```

### The typed API client — `client/src/api/client.ts` (T025)

```ts
export class ApiClientError extends Error { readonly code: ApiErrorCode; readonly status: number }
export function isApiClientError(value: unknown): value is ApiClientError;
export function isAbortError(value: unknown): boolean;

export function getImages(
  params: { path: string; recursive?: boolean; showHidden?: boolean },
  signal?: AbortSignal,
): Promise<ImagesResponse>;
```

`client/src/api/useAbortableRequest.ts` (T025):

```ts
export interface AbortableRequest {
  /** Aborts the previous request started through this hook, then runs `task` with a fresh signal.
   *  Rejects with an AbortError if this request was superseded, cancelled or the component unmounted,
   *  even when the task itself resolved first. */
  run: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  cancel: () => void;
}
export function useAbortableRequest(): AbortableRequest;   // run and cancel are referentially stable
```

Every failure `getImages` can raise (network failure, malformed body, server error envelope) is an `ApiClientError` whose `code` is an `ApiErrorCode`; an abort is an abort error (`isAbortError`), never an `ApiClientError`. The codes `GET /api/fs/images` can return are `INVALID_PATH`, `INVALID_PARAM`, `OUTSIDE_ROOT`, `NOT_FOUND`, `NOT_A_DIRECTORY`, `ACCESS_DENIED` and `READ_FAILED` (a network failure is `READ_FAILED` with status `0`).

### Application state — `client/src/state/AppStateProvider.tsx` (T024)

```ts
interface AppState {
  view: 'explorer' | 'config' | 'player';
  explorer: { path: string; viewMode: 'list' | 'grid'; showHidden: boolean };
  selection: { path: string; name: string } | null;   // chosen slide show folder
  config: SlideshowConfig;
  playlist: ImageItem[] | null;                       // fetched before entering the player
  notice: string | null;                              // set by the player on an abnormal exit (spec §9.3)
}

useAppState(): AppState;
useAppActions(): {                                    // every function has a stable identity
  goToExplorer(): void;                               // view = 'explorer'; explorer.path untouched (spec §6.1)
  setConfig(patch: Partial<SlideshowConfig>): void;   // merged through parseConfig
  resetConfig(): void;                                // config = DEFAULT_CONFIG
  setPlaylist(items: ImageItem[] | null): void;
  startPlayer(): void;                                // no-op unless playlist is non-empty
  dismissNotice(): void;
  // ...plus navigateExplorer, setViewMode, setShowHidden, selectCurrentFolder, exitPlayer (not used here)
};
```

Screens call `const state = useAppState(); const actions = useAppActions();` and never destructure actions from `useAppState()`. Because the action helpers are referentially stable, they can be used in effect dependency lists without re-running the effect (the repository sets `react-hooks/exhaustive-deps` to `error`).

Persistence is not this ticket's job. The provider debounces `state.config` to `slydr.config` at 250 ms through the validating writer of T023, so this screen only dispatches. **Verify once** that changing `state.config` really schedules a write (the test in §6 asserts it with the mock storage helper). All `localStorage` access is already wrapped in `try/catch`, so the screen works with storage disabled.

### Base components — `client/src/components/` (T022) and the theme switch (T021)

- `Checkbox` — native `<input type="checkbox">` (no `role="switch"`), props `label`, `description?`, `checked`, `onCheckedChange`.
- `Slider` — native `<input type="range">` with `label`, `value`, `onValueChange`, `min`, `max`, `step`, `pageStep` (default 5), `formatValue` (visible readout) and `formatValueText` (`aria-valuetext`, defaults to `formatValue`). It handles `PageUp`/`PageDown` itself (±`pageStep`, `preventDefault`, clamped), leaves the arrow keys, `Home` and `End` to the browser, and renders its `<output>` with `aria-live="off"`.
- `Button` (`variant` `primary | secondary | ghost`, `size` `md | lg`), `Banner` (`variant` `info | warning | error`; optional `action: { label, onClick }` and `onDismiss`; `error` carries `role="alert"`), `Icon` (`icon={...}`), `Spinner`.
- `ThemeToggle` from `client/src/components/ThemeToggle/` (T021), which carries its own `aria-label`.

A link-style action is a `Button variant="ghost"`; there is no `link` variant and no `sm` size.

### Design tokens (T020)

`--bg`, `--bg-elevated`, `--bg-sunken`, `--fg`, `--fg-muted`, `--border`, `--accent`, `--accent-fg`, `--focus-ring`, `--danger`, `--shadow-1`, `--radius-sm|md|lg`, `--space-1` … `--space-8`, `--font-ui`, `--text-*` sizes, `--dur-fast|base|slow`, `--ease-standard`, `--target-min` (44 px) and `--target-min-coarse` (48 px). Use tokens only; no hard-coded colours.

### Test helpers (T021, T023)

`client/test/helpers/matchMedia.ts` (T021): `installMatchMedia`, which installs a controllable `window.matchMedia` for any query, with `setMatches(query, boolean)` firing the `change` listeners, and returns a dispose function. Read its exact signature before use. `client/test/helpers/storageMock.ts` (T023): `installMockStorage(options?)` and the `resetStorageForTests()` reset hook that `client/test/setup.ts` already calls.

### Wire-path rules

All paths crossing the API are POSIX, forward-slash, relative to the jail root (the user's home directory); `""` is the jail root. The client never displays an absolute path. `selection.path` is such a wire path and `selection.name` is the display name the explorer stored (for the jail root it is the root's name, for example "PeterKin").

### Browser facts this ticket depends on

- Browsers grant `requestFullscreen()` only from inside a user-gesture handler, synchronously. Any `await`, `setTimeout` or state update before the call can forfeit the gesture.
- `window.matchMedia('(prefers-reduced-motion: reduce)')` is how the OS setting is read; `jsdom` has no `matchMedia`, so the hook must tolerate its absence and the tests must install the stub.

## 4. Implementation detail

### 4.1 Files

Create:

```
client/src/screens/Config/
  Config.tsx                 screen shell: redirect guard, layout, wiring
  Config.module.css
  ConfigHeader.tsx           back link + theme switch
  FolderTitle.tsx            selected folder name + wire path
  ConfigControls.tsx         the seven controls (T022 Slider + Checkbox), Reset button
  ImageCountStatus.tsx       the aria-live status region and its states
  ConfigFooter.tsx           "Play slide show"
  useImageScan.ts            GET /api/fs/images with abort, retry and playlist hand-off
  copy.ts                    every user-visible string in one place, plus durationLabel/durationValueText
  index.ts                   re-exports Config
client/src/lib/
  usePrefersReducedMotion.ts shared hook, also used by T032
  fullscreen.ts              requestFullscreenSync(el), extended by T030
```

Delete the T024 placeholder `client/src/screens/Config/index.tsx` in the same change (module resolution of `'./screens/Config'` must be unambiguous). `App.tsx` already imports from the directory and needs no edit.

Put every user-visible string in `copy.ts` as a named export; tests assert on them. `copy.ts` also exports the two formatting helpers `durationLabel(seconds)` → `"5 s"` and `durationValueText(seconds)` → `"1 second"` / `"5 seconds"`; they are formatting only. **There is no local clamp and no local duration bounds**: the slider uses `MIN_DURATION_SECONDS` and `MAX_DURATION_SECONDS` from `@slydr/shared`, and `parseConfig` (inside `actions.setConfig`) is the only authority on valid values.

### 4.2 Layout (spec §8.1)

```
┌──────────────────────────────────────────────┐
│ [← Back to file explorer]            [☾]     │  header
│                                              │
│ (error banner when the player gave up)       │  notice
│ Holiday 2024                                 │  title (folder name)
│ Pictures/Holiday 2024                        │  muted wire path
│                                              │
│ 1,284 images found                           │  status (aria-live)
│                                              │
│ Duration for image shown            5 s      │
│ ───────●──────────────────────────           │
│ ☑ Shuffle images                             │
│   Play them in random order                  │
│ ☑ Loop slide show                            │
│   Start again when all images were shown     │
│ ☑ Use animations and transitions             │
│ ☑ Fill empty space on screen                 │
│   Blurred background from the current image  │
│ ☑ Start in full screen                       │
│ ☐ Include subfolders                         │
│                                              │
│ Reset to defaults                            │
├──────────────────────────────────────────────┤
│              [ ▶ Play slide show ]           │  footer
└──────────────────────────────────────────────┘
```

The structure and the CSS values below are normative, matching the column rules T035 later refines:

```css
.screen   { min-height: 100dvh; display: flex; flex-direction: column; background: var(--bg); color: var(--fg); }
.column   {
  width: 100%;
  margin-inline: auto;
  padding-inline: max(var(--space-4), env(safe-area-inset-left), env(safe-area-inset-right));
  padding-block: var(--space-4);
  flex: 1 1 auto;
}
@media (min-width: 768px) { .column { max-width: 35rem; } }      /* 560px at a 16px root font */
.footer   {
  position: sticky; bottom: 0;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  padding: var(--space-3) max(var(--space-4), env(safe-area-inset-left), env(safe-area-inset-right));
  padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
}
.footerInner { width: 100%; margin-inline: auto; }
@media (min-width: 768px) { .footerInner { max-width: 35rem; } }
```

- The screen is one scrolling page (the document scrolls), with the footer sticky at the bottom of the viewport so "Play slide show" stays reachable at 320 px and with the browser zoomed. **Decision (not specified): sticky footer.** The spec only says "Footer: primary button".
- Header: `ConfigHeader` is a flex row; the back link on the left, `ThemeToggle` pushed to the right with `margin-inline-start: auto`. The theme switch sits top-right, as on the explorer, and is never shown in the player.
- Minimum 16 px side gutter at every width and no horizontal page scrolling down to a 320 px viewport.
- Respect `prefers-reduced-motion: reduce`: no transitions other than colour changes.

### 4.3 Guard: no selection (spec §6.1)

`selection === null` means the configuration view was reached without a chosen folder (a reload with no persisted selection, a hot-reload during development, a future deep link). Handle it in `Config.tsx`:

```tsx
const state = useAppState();
const actions = useAppActions();
useEffect(() => {
  if (state.selection === null) actions.goToExplorer();
}, [state.selection, actions]);
if (state.selection === null) return null;       // render nothing while redirecting
```

Rules:

- Render nothing at all (not a flash of the layout) while the redirect happens.
- Do not start the scan, and do not touch `playlist`, when there is no selection. Call `useImageScan` unconditionally (hook order must be constant) and pass `path: null`, which makes it do nothing.
- Do not reset `explorer.path`; the explorer opens where it was.

### 4.4 Header, title and notice (spec §8.1, §9.3)

`ConfigHeader`:

- The back link is a `Button variant="ghost"` with a `lucide-react` `ArrowLeft` icon (`aria-hidden="true"`) and the visible text **"Back to file explorer"**. It calls `actions.goToExplorer()`. It is a button, not an anchor, because the app has no URLs (spec §16.1 A2). Visually it reads as a link.
- The theme switch is T021's `ThemeToggle`, with its own `aria-label` ("Switch to dark theme" / "Switch to light theme"). This ticket only places it.

`FolderTitle`:

```tsx
<div className={styles.title}>
  <h1 className={styles.name}>{selection.name}</h1>
  <p className={styles.path} title={pathText}>{pathText}</p>
</div>
```

- `selection.name` is the heading (`<h1>`), allowed to wrap: `overflow-wrap: anywhere`, never truncated with an ellipsis, so a long folder name is fully readable.
- `pathText` is the wire path (`selection.path`), for example `Pictures/Holiday 2024`. It is muted (`color: var(--fg-muted)`), single-line, truncated with an ellipsis, and carries a `title` attribute with the same text so a truncated path can be read. **Decision (not specified): when `selection.path === ""` (the jail root) show the text "Home folder"** rather than an empty line, since an empty muted line would look like a layout bug. The `title` is the same text.
- Never display or tooltip an absolute path.

**Player notice.** When `state.notice !== null` (the player exited because every image failed, spec §9.3), render directly under the header, above the title:

```tsx
<Banner variant="error" onDismiss={actions.dismissNotice}>{state.notice}</Banner>
```

`Banner` already carries `role="alert"` and `aria-live="polite"`; do not wrap it in another live region. The banner disappears on dismiss; the reducer also clears `notice` on "Play slide show" (`startPlayer`), on "Back to file explorer" and when a new folder is selected, so this screen never clears it itself. The message text is whatever the player supplied; do not reword it.

### 4.5 The controls (spec §8.2)

The values below are normative. Labels, helper text, defaults and the corresponding `SlideshowConfig` field:

| Order | Visible label | Helper text (muted, under the label) | Component | Field | Default |
|---|---|---|---|---|---|
| 1 | Duration for image shown | — | `Slider`, 1–30, step 1, readout "N s" | `durationSeconds` | 5 |
| 2 | Shuffle images | Play them in random order | `Checkbox` | `shuffle` | on |
| 3 | Loop slide show | Start again when all images were shown | `Checkbox` | `loop` | on |
| 4 | Use animations and transitions | — (the reduced-motion note of §4.7 when active) | `Checkbox` | `animations` | on |
| 5 | Fill empty space on screen | Blurred background from the current image | `Checkbox` | `fillEmptySpace` | on |
| 6 | Start in full screen | — | `Checkbox` | `startFullScreen` | on |
| 7 | Include subfolders | Also play images from folders inside this one | `Checkbox` | `includeSubfolders` | off |

**Decision (not specified):** the helper text of "Include subfolders" ("Also play images from folders inside this one"). The spec gives no helper text for rows 4, 6 and 7. Row 7's text is added because the option is otherwise ambiguous (spec note D1); rows 4 and 6 stay without helper text, matching the spec.

All defaults come from `DEFAULT_CONFIG`. Do not repeat the values in the component; read them from `state.config`, whose initial value is `DEFAULT_CONFIG` merged with whatever was persisted.

All seven controls are **controlled**: the value comes from `state.config`, and the change handler is `actions.setConfig({ field: value })`. They are never disabled; they work while the scan is running. Spec §8.2's "checkbox" is literal: the options are checkboxes, not switches.

```tsx
<Slider
  label={copy.durationLabel}
  value={config.durationSeconds}
  onValueChange={(durationSeconds) => actions.setConfig({ durationSeconds })}
  min={MIN_DURATION_SECONDS}
  max={MAX_DURATION_SECONDS}
  step={1}
  pageStep={5}
  formatValue={durationLabel}          // visible "5 s"
  formatValueText={durationValueText}  // aria-valuetext "5 seconds" / "1 second"
/>
<Checkbox
  label={copy.shuffle.label}
  description={copy.shuffle.hint}
  checked={config.shuffle}
  onCheckedChange={(shuffle) => actions.setConfig({ shuffle })}
/>
```

Keyboard: arrow keys ±1, `Home`/`End`, and `PageUp`/`PageDown` ±5 are provided by T022's `Slider` (spec §8.2); this ticket's tests verify the behaviour through the integrated screen but do not re-implement it. The slider stretches to the full width of the column and remains operable at 320 px.

### 4.6 State and persistence (spec §8.2, §6.2)

Every control calls `actions.setConfig({ field: value })` on change. The provider owns persistence: the new `state.config` is written to `slydr.config` after 250 ms of quiet. Consequences to respect:

- The screen reads its control values from `state.config`, never from local state, so the controls always reflect what is stored.
- Do not call `writeConfig` / `localStorage` directly from this screen.
- A burst of slider changes produces a single write; a quick toggle of a checkbox and a navigation away also persists, because the T023 layer flushes pending writes on `pagehide` / `visibilitychange` and the provider flushes on a view change. Do not add your own flush on unmount.
- With storage disabled (private mode), changes still apply for the session. No error is shown.

### 4.7 The reduced-motion note and `usePrefersReducedMotion` (spec §9.4)

**`client/src/lib/usePrefersReducedMotion.ts`** is the one hook the whole app uses to read the OS setting. T032 imports it for the player's rendering decision. Implement it with `useSyncExternalStore` so the first client render is correct and OS changes apply live:

```ts
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
```

- No `matchMedia` (as in `jsdom`) means `false`, never an exception.
- Do not use `addListener` / `removeListener`; the deprecated API is not needed for the browsers Slydr targets.
- Do not cache the `MediaQueryList` at module scope: tests replace `window.matchMedia` per test.

**The note beneath the animations checkbox.** When `usePrefersReducedMotion()` is `true`, pass the following as the `description` of the "Use animations and transitions" `Checkbox` (so it is linked through `aria-describedby` by the component and sits directly under the row):

> **Your system is set to reduce motion, so the slide show plays without animations. Your choice here is kept.**

(Decision (not specified): the wording. The spec only requires that "the override is a rendering decision and is noted beneath the checkbox when active".) Rules:

- The checkbox **keeps its stored value** and stays enabled. Reduced motion does not uncheck it, disable it, or write anything to `slydr.config`. If the user turns the OS setting off later, the stored preference applies again. This is spec §9.4: "The configuration checkbox keeps the user's setting."
- The note is static text, not a live region; it appears and disappears with the OS setting. Prefix it with a `lucide-react` `Info` icon (`aria-hidden="true"`); no animation on its appearance.
- The note is purely informational. This screen does **not** implement the player-side behaviour (T032 forces animations off in the player when the media query matches).

### 4.8 "Play slide show" and fullscreen (spec §9.1, FR-16.1, §6.1)

`ConfigFooter` holds the primary `Button`, text **"Play slide show"** with a `lucide-react` `Play` icon (`aria-hidden="true"`). It is `disabled` unless the scan status is `ready` and the image count is greater than zero (§4.9.3). When disabled, give the button `aria-describedby` pointing at the status region's id so the reason is discoverable.

The click handler must be synchronous and must call the fullscreen API **before** anything else:

```tsx
function handlePlayClick() {
  if (!canPlay) return;
  // FR-16.1: must run synchronously inside the click, before any await or state change.
  if (config.startFullScreen) {
    requestFullscreenSync(document.documentElement);
  }
  actions.startPlayer();       // view = 'player'; the playlist is already in state
}
```

```ts
// client/src/lib/fullscreen.ts
type FullscreenCapable = Element & {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * Asks the browser for fullscreen. Never throws and returns nothing the caller could await:
 * a refusal (permission denied, unsupported, not allowed) is swallowed so the player simply
 * runs in fill-window mode. MUST be called synchronously from a user-gesture handler.
 */
export function requestFullscreenSync(el: Element): void {
  const target = el as FullscreenCapable;
  try {
    const result = target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.();
    void Promise.resolve(result).catch(() => {
      /* FR-16.1: silent fallback to fill-window mode */
    });
  } catch {
    /* FR-16.1: silent fallback to fill-window mode */
  }
}
```

Rules:

- No `await`, `.then`, `setTimeout` or state update may precede `requestFullscreenSync(...)` in the handler.
- The element is `document.documentElement`. The player layer does not exist yet at click time; the root element is the only one guaranteed to be present. The visual result is the same, since the player is a fixed layer covering the viewport.
- A rejected promise is caught and ignored: no dialog, no banner, no console error. The show starts in fill-window mode (FR-16.1, FR-16.2).
- When `startFullScreen` is off, `requestFullscreen` is not called at all.
- The playlist is what the latest scan stored in `AppState.playlist`. **Spec §16.1 assumption A5:** the player plays the playlist captured when "Play slide show" was pressed; files added to the folder mid-show do not appear. Because this screen re-scans each time it mounts, returning from a finished show and pressing Play again picks up new files. Do not add re-scan logic on loop boundaries.
- **Ownership of the helper.** This ticket creates `client/src/lib/fullscreen.ts` with exactly `requestFullscreenSync`. T030 adds the remaining fullscreen helpers (`getFullscreenElement`, `isFullscreen`, `exitFullscreenSafe`, ...) in `screens/Player/fullscreen.ts`, which re-exports `requestFullscreenSync` from `lib/`. This screen keeps importing from `lib/`; nothing here changes when T030 lands.

### 4.9 Image count and readiness (spec §8.3, FR-15.2)

#### 4.9.1 `useImageScan`

```ts
type ScanState =
  | { status: 'scanning' }
  | { status: 'ready'; count: number; truncated: boolean }
  | { status: 'error'; code: ApiErrorCode };

function useImageScan(args: {
  path: string | null;            // selection.path, or null when there is no selection
  includeSubfolders: boolean;
  showHidden: boolean;            // AppState.explorer.showHidden (A6)
  setPlaylist: (items: ImageItem[] | null) => void;   // actions.setPlaylist: MUST be referentially stable
}): { scan: ScanState; retry: () => void };
```

The effect depends on `[path, includeSubfolders, showHidden, attempt, run, cancel, setPlaylist]`. `run` and `cancel` come from `useAbortableRequest()` (T025) and `setPlaylist` is `actions.setPlaylist`; all three are referentially stable, so the effect re-runs only when a primitive changes or `retry()` is called. **Never pass an inline arrow as `setPlaylist`**: with `react-hooks/exhaustive-deps` at `error` it must be in the dependency list, and a new identity per render would restart the scan on every render. Algorithm:

1. If `path === null`, return without doing anything.
2. Set `scan` to `{ status: 'scanning' }` and call `setPlaylist(null)`. A playlist from a previous scan must not be playable while the new one is in flight (and the button is disabled anyway).
3. Call `run((signal) => getImages({ path, recursive: includeSubfolders, showHidden }, signal))`. `run` aborts the previous request first, and it rejects with an abort error if this request is superseded, cancelled or the component unmounts, **even if the response had already resolved**. This is the late-response protection of spec §6.5: the older, slower scan can never overwrite the newer one. The effect's cleanup calls `cancel()`.
4. On success, call `setPlaylist(response.items)` and set `{ status: 'ready', count: response.items.length, truncated: response.truncated }`. (`count` is the length of the array the player will actually play, not `response.count`.)
5. On failure, return silently when `isAbortError(err)`. Otherwise `setPlaylist(null)` and set `{ status: 'error', code }`, where `code` is `err.code` for an `ApiClientError` (`isApiClientError`). Every non-abort failure `getImages` produces is an `ApiClientError` (a network failure is `READ_FAILED`); for anything else, use `'READ_FAILED'`. There is no separate network code.
6. `retry()` increments `attempt`, which re-runs the effect.

React 19 strict mode runs the effect twice in development (mount, cleanup, mount); the first request is aborted by the cleanup and ignored by step 5, which is the intended behaviour and is why abort errors must never reach the error state.

#### 4.9.2 The status region

`ImageCountStatus` renders **one persistent element that is never unmounted**, because a live region only announces changes inside a region that already exists in the DOM:

```tsx
<div id="cfg-status" role="status" aria-live="polite" className={styles.status}>
  {content}
</div>
```

`content` by state (all strings in `copy.ts`):

| State | Content |
|---|---|
| `scanning` | **Scanning…** (with a small `Spinner`, `aria-hidden="true"`) |
| `ready`, count ≥ 1 | **N images found** (`1 image found` for exactly one; `new Intl.NumberFormat().format(n)` for thousands, so `1,284 images found`) |
| `ready`, count 0 | **No playable images in this folder.** and, when `includeSubfolders` is off, the hint **Turn on Include subfolders to look in the folders inside this one.** (Decision (not specified): the hint wording), then always the static note **HEIC, TIFF and RAW photos are not supported.** (spec §8.3, FR-2.4; shown regardless of `includeSubfolders`, because a folder of phone exports in an unsupported format otherwise looks like a bug) and a `Button variant="ghost"` **Choose another folder** that calls `actions.goToExplorer()` (Decision (not specified): the link text) |
| `ready`, `truncated` | the count line, then a second line **Showing the first 20,000 images.** |
| `error` | empty (see below) |

Notes:

- The count text is exactly "N images found"; it never includes an unrelated word like "playable".
- **Number formatting is consistent.** `MAX_IMAGES` is formatted with `new Intl.NumberFormat().format(MAX_IMAGES)` in both lines, so a truncated scan reads "20,000 images found" followed by "Showing the first 20,000 images." Spec §8.3 writes the number without a separator ("20000"); that is the number, not a formatting requirement. The tests build the expected strings with the same formatter so they pass in any locale.
- The zero-image state uses the same region; the sentence is both the visible message and what a screen reader announces. The unsupported-formats note sits in the same region directly after the message (and after the Include-subfolders hint when that is shown), so it is announced together with it.
- When `truncated` is true the count equals `MAX_IMAGES`.
- The status text is announced politely, once per change. Keep the DOM of the "Choose another folder" button stable; do not put it inside text that changes on every render.

**Error state.** A failed scan renders an inline `Banner variant="error"` below the status region, with the message chosen by `code` and an action `{ label: 'Retry', onClick: retry }`:

- `ACCESS_DENIED` → "You do not have permission to read this folder."
- `NOT_FOUND` → "That folder no longer exists."
- `NOT_A_DIRECTORY` → "That item is not a folder."
- `OUTSIDE_ROOT` → "That folder is outside your home folder."
- anything else, including network failures (`READ_FAILED`) → "Something went wrong while scanning this folder."

(Decision (not specified): the exact wording, which mirrors the explorer's error copy from T026. The spec only requires "an inline error with Retry".) Never show raw server messages, `errno` values or absolute paths. The status region shows nothing but the empty string while the error banner is visible, so the screen never says both "Scanning…" and an error; the `Banner` announces the error itself. "Play slide show" stays disabled in the error state. The controls stay usable.

#### 4.9.3 `canPlay`

```ts
const canPlay = scan.status === 'ready' && scan.count > 0;
```

The button is disabled in `scanning`, `error`, and zero-image `ready`. It enables as soon as a scan returns a non-empty result. Toggling "Include subfolders" puts the screen back into `scanning`, which disables the button until the new count arrives; this is correct, because the playlist for the new setting is not yet known.

### 4.10 "Reset to defaults" (spec §8.4)

A small secondary button with the text **Reset to defaults**, below the last control and above the footer, left-aligned:

```tsx
<Button variant="ghost" onClick={handleReset}>Reset to defaults</Button>
```

- `handleReset` calls `actions.resetConfig()`, which sets `state.config` to `DEFAULT_CONFIG`. The change persists through the normal debounced path.
- It is a real `<button type="button">`, styled as a link by the ghost variant; it has no `href` and navigates nowhere. It is not a destructive action (nothing outside the settings is lost), so it needs no confirmation dialog.
- It stays enabled even when the configuration already equals the defaults. A control that becomes disabled when nothing would change is a trap for keyboard users, who would lose their focus target.
- If `includeSubfolders` changes because of the reset (it was on), the normal effect rescans; no special-casing.
- After a reset, a visually hidden, separate `aria-live="polite"` element announces **Settings reset to defaults.** (Decision (not specified).) It is cleared the next time any control changes.
- After a reset the slider shows 5 and the readout "5 s".

### 4.11 Styling notes

```css
.rowHint, .path, .note { color: var(--fg-muted); font-size: var(--text-sm); }
.controls { display: grid; gap: var(--space-2); }
```

- The slider, checkboxes, banners and buttons carry their own styling from T022; this ticket styles only the layout (column, header, title, status, footer).
- Use design tokens only. The muted text must pass WCAG AA contrast in both themes (NFR-6); check `--fg-muted` on `--bg` and `--bg-sunken`.
- Hover styles only inside `@media (hover: hover)`, as elsewhere in the app.
- Every focusable element shows a visible focus ring using `--focus-ring` on `:focus-visible` (provided by T020's base styles and the T022 components).

### 4.12 Order of the DOM (and therefore tab order)

1. Back to file explorer
2. Theme switch
3. Dismiss on the player notice banner (only when a notice is shown)
4. Duration slider
5. Shuffle images, Loop slide show, Use animations and transitions, Fill empty space on screen, Start in full screen, Include subfolders (document order)
6. Retry (error banner) or Choose another folder (zero-image state), only when shown
7. Reset to defaults
8. Play slide show

Keep the DOM in this order. The status region and the title come before the controls in the document but are not focusable. No element has a positive `tabindex`.

## 5. Acceptance criteria

- [ ] `client/src/screens/Config/` contains `Config.tsx`, `ConfigHeader.tsx`, `FolderTitle.tsx`, `ConfigControls.tsx`, `ImageCountStatus.tsx`, `ConfigFooter.tsx`, `useImageScan.ts`, `copy.ts`, `index.ts` and matching `.module.css` files; `client/src/lib/usePrefersReducedMotion.ts` and `client/src/lib/fullscreen.ts` exist; the T024 placeholder `client/src/screens/Config/index.tsx` is deleted; `App.tsx` renders the `Config` component for the `config` view.
- [ ] The screen contains no re-implementation of a checkbox row or a range input: the six boolean options are T022 `Checkbox` components and the duration is the T022 `Slider`; there is no local duration clamp or local duration bounds (`grep -rn "clamp" client/src/screens/Config` returns nothing).
- [ ] With `selection === null` the screen renders nothing, calls `actions.goToExplorer()` once, and issues no `GET /api/fs/images` request.
- [ ] The header shows the text "Back to file explorer" on the left and the T021 `ThemeToggle` on the right; pressing the link returns to the explorer with its previous path unchanged.
- [ ] The title shows `selection.name` as an `<h1>`; the muted secondary line shows the wire path and has a matching `title` attribute; at the jail root it shows "Home folder"; no absolute path appears anywhere on the screen.
- [ ] A non-null `state.notice` renders in a dismissible `Banner variant="error"` under the header; dismissing it calls `actions.dismissNotice()`; the screen adds no second live-region wrapper around it.
- [ ] The column is centred with `max-width: 35rem` from 768 px upward, and fills the width with a 16 px gutter below 768 px, with no horizontal page scroll at 320 px.
- [ ] The seven controls render in the order, with the labels, helper texts and defaults of §4.5: duration 5, Shuffle on, Loop on, Animations on, Fill on, Start in full screen on, Include subfolders off. The six options are native `input[type=checkbox]` elements without `role="switch"`.
- [ ] The duration control is an `input[type=range]` with `min=1`, `max=30`, `step=1`, an `aria-valuetext` of "5 seconds" at the default (and "1 second" at 1), and a live readout "5 s" that updates while dragging; `PageUp` / `PageDown` change it by 5, clamped to 1–30.
- [ ] Changing any control updates `AppState.config` immediately and writes `slydr.config` to `localStorage` once, 250 ms after the last change; with storage disabled the screen still works.
- [ ] On mount the screen calls `getImages({ path: selection.path, recursive: false, showHidden }, signal)` once, where `showHidden` is `AppState.explorer.showHidden`; toggling "Include subfolders" issues a new call with `recursive: true`.
- [ ] While a scan is pending the status region reads "Scanning…" and "Play slide show" is disabled; when it succeeds the region reads "N images found" (1 reads "1 image found"), `AppState.playlist` equals the response's `items`, and the button is enabled.
- [ ] The status region has `role="status"` and `aria-live="polite"` and stays mounted across all states.
- [ ] With zero images: the button is disabled, the region reads "No playable images in this folder.", the Include-subfolders hint is shown only when `includeSubfolders` is off, the note "HEIC, TIFF and RAW photos are not supported." is always shown with it, and a "Choose another folder" control returns to the explorer.
- [ ] With `truncated: true` the screen reads "20,000 images found" and "Showing the first 20,000 images." (both numbers formatted with the same `Intl.NumberFormat`).
- [ ] A failed scan shows an inline `error` banner with a "Retry" action; the button is disabled; pressing Retry issues a new request; a successful retry clears the error and enables the button. A network failure (`READ_FAILED`, status 0) shows the generic message.
- [ ] Toggling "Include subfolders" twice quickly aborts the first request (its `signal.aborted` is `true`), and only the response to the last request reaches the playlist and the count, even if the first response arrives later.
- [ ] An aborted request never produces the error banner. Unmounting the screen aborts a pending scan.
- [ ] `useImageScan` is given `actions.setPlaylist` (a stable function); re-rendering the screen with unchanged primitives does not issue a new request.
- [ ] When `prefers-reduced-motion: reduce` matches, the note "Your system is set to reduce motion, so the slide show plays without animations. Your choice here is kept." appears beneath the animations checkbox; the checkbox stays enabled and keeps its stored value, and `slydr.config` is not modified by the media query.
- [ ] `usePrefersReducedMotion()` returns `false` when `matchMedia` is unavailable, returns the current match, and updates when the media query's `change` event fires.
- [ ] "Reset to defaults" restores `DEFAULT_CONFIG` (duration 5, all true except Include subfolders) and the restored values persist; if `includeSubfolders` was on, a new scan starts.
- [ ] Pressing "Play slide show" with `startFullScreen` on calls `document.documentElement.requestFullscreen()` synchronously in the click handler, before the view changes; a rejected promise or a synchronous throw produces no unhandled rejection, no error UI, and the view still changes to the player.
- [ ] Pressing "Play slide show" with `startFullScreen` off never calls `requestFullscreen`.
- [ ] The tab order is that of §4.12 and every control is operable with the keyboard alone; all icon-only controls have an `aria-label`.
- [ ] Contrast of the muted helper text, the note, the slider and the focus ring passes WCAG AA in both themes.

## 6. Tests to write

Vitest + React Testing Library (`jsdom`), per spec §12.3 ("config persistence and clamping; the zero-image disabled state; the reduced-motion override"). All files live under `client/test/` and import `describe`, `it`, `expect`, `vi` from `'vitest'`. Mock `client/src/api/client.ts` with `vi.mock` (keep the real `ApiClientError`, `isApiClientError` and `isAbortError` by spreading `vi.importActual`), so `getImages` returns manually resolvable promises. Build `ImagesResponse` fixtures with a small factory in `client/test/helpers/configFixtures.ts` (`makeImages(n, { truncated })`).

Render helper, `renderConfig({ selection, config, explorer, notice })` in the same helper file: wrap `<Config />` in `AppStateProvider` with the provider's `initialState` prop (T024). Use `installMockStorage()` from `client/test/helpers/storageMock.ts` for persistence assertions and `vi.useFakeTimers()` where the 250 ms debounce is observed. Control `matchMedia` with `client/test/helpers/matchMedia.ts` (T021); do not create another matchMedia stub.

**`client/test/lib/usePrefersReducedMotion.test.tsx`**

- `describe('usePrefersReducedMotion')`
  - `it('returns false when matchMedia is not available')`
  - `it('returns true when the media query matches on the first render')`
  - `it('updates when the change event fires')`
  - `it('removes its change listener on unmount')`

**`client/test/lib/fullscreen.test.ts`**

- `describe('requestFullscreenSync')`
  - `it('calls requestFullscreen on the given element')`
  - `it('falls back to webkitRequestFullscreen')`
  - `it('swallows a rejected promise without an unhandled rejection')`
  - `it('swallows a synchronous throw')`
  - `it('does nothing when the API is not implemented')`

**`client/test/screens/Config/Config.layout.test.tsx`**

- `describe('Config layout')`
  - `it('renders the folder name as the heading')`
  - `it('renders the wire path as secondary text with a matching title attribute')`
  - `it('renders "Home folder" when the selected path is the jail root')`
  - `it('shows the back link and the theme switch in the header')`
  - `it('returns to the explorer without changing its path when the back link is pressed')`
  - `it('renders nothing and goes to the explorer when there is no selection')`
  - `it('does not request the image list when there is no selection')`
  - `it('renders a player notice in an error banner and dismisses it')`
  - `it('renders no notice banner when notice is null')`

**`client/test/screens/Config/Config.controls.test.tsx`**

- `describe('Config controls')`
  - `it('renders the seven controls with their labels and helper texts')`
  - `it('renders the six boolean options as checkboxes and not as switches')`
  - `it('starts every control at its default value')`
  - `it('renders the duration slider with min 1, max 30, step 1')`
  - `it('shows the readout "5 s" and aria-valuetext "5 seconds" at the default')`
  - `it('updates the readout while the slider value changes')`
  - `it('uses the singular aria-valuetext at 1 second')`
  - `it('increases the duration by 5 on PageUp and prevents default')`
  - `it('decreases the duration by 5 on PageDown and prevents default')`
  - `it('clamps PageUp at 30 and PageDown at 1')`
  - `it('ignores a non-numeric slider value')`
  - `it('toggles each checkbox and stores the new value in the application state')`
  - `it('associates every helper text with its checkbox through aria-describedby')`
  - `it('keeps every control enabled while the scan is pending')`

**`client/test/screens/Config/Config.persistence.test.tsx`**

- `describe('Config persistence')`
  - `it('writes slydr.config once, 250 ms after the last of several slider changes')` (fake timers; assert `setItem` count)
  - `it('persists a toggled checkbox')`
  - `it('restores stored values into the controls on mount')`
  - `it('falls back to defaults for a corrupt stored config')`
  - `it('keeps working when localStorage throws')`
  - `it('restores the defaults and persists them when Reset to defaults is pressed')`
  - `it('announces the reset in a polite live region')`

**`client/test/screens/Config/Config.scan.test.tsx`**

- `describe('Config image scan')`
  - `it('calls getImages with the selection path, recursive false and the explorer showHidden flag on mount')`
  - `it('shows "Scanning…" and disables Play while the request is pending')`
  - `it('shows "N images found" and enables Play when the scan returns items')`
  - `it('shows "1 image found" for exactly one image')`
  - `it('formats large counts with a thousands separator')`
  - `it('stores the returned items as the playlist')`
  - `it('keeps the status region mounted across scanning, ready and error states')`
  - `it('sets role=status and aria-live=polite on the status region')`
  - `it('rescans with recursive true when Include subfolders is switched on')`
  - `it('aborts the first request when Include subfolders is toggled twice quickly')`
  - `it('ignores a late response from an aborted request')`
  - `it('does not show an error for an aborted request')`
  - `it('aborts a pending request on unmount')`
  - `it('clears the playlist while a new scan is pending')`
  - `it('does not restart the scan when the screen re-renders with unchanged settings')`
  - `it('passes showHidden true when the explorer had hidden items on')`
  - `it('uses the persisted includeSubfolders value for the first scan')`

**`client/test/screens/Config/Config.states.test.tsx`**

- `describe('Config readiness states')`
  - `it('disables Play and shows "No playable images in this folder." for zero images')`
  - `it('shows "HEIC, TIFF and RAW photos are not supported." in the zero-image state whether includeSubfolders is on or off, and not when images were found')`
  - `it('shows the Include subfolders hint only when includeSubfolders is off')`
  - `it('does not show the hint when includeSubfolders is on and the count is zero')`
  - `it('returns to the explorer from the "Choose another folder" control')`
  - `it('shows the count and "Showing the first 20,000 images." with the same number format when the response is truncated')`
  - `it('does not show the truncated line when the response is not truncated')`
  - `it('shows an inline error and keeps Play disabled when the scan fails')`
  - `it('shows the message that matches ACCESS_DENIED, NOT_FOUND and READ_FAILED (including a network failure with status 0)')`
  - `it('never shows a raw server message')`
  - `it('issues a new request and clears the error when Retry succeeds')`
  - `it('keeps the error and Play disabled when Retry fails again')`
  - `it('disables Play again while a rescan is pending after the toggle changes')`

**`client/test/screens/Config/Config.reducedMotion.test.tsx`**

- `describe('Config reduced motion')`
  - `it('shows the reduced-motion note when the media query matches')`
  - `it('hides the note when the media query does not match')`
  - `it('updates the note when the media query changes while mounted')`
  - `it('keeps the animations checkbox enabled and checked when reduced motion is on')`
  - `it('does not write to slydr.config because of the media query')`
  - `it('associates the note with the animations checkbox through aria-describedby')`

**`client/test/screens/Config/Config.play.test.tsx`**

- `describe('Config Play slide show')`
  - `it('calls requestFullscreen on the document element synchronously inside the click when startFullScreen is on')` (spy on `document.documentElement.requestFullscreen`; assert it was called before the view change is dispatched, and that no timer or microtask separated them)
  - `it('does not call requestFullscreen when startFullScreen is off')`
  - `it('starts the player even when requestFullscreen rejects, with no unhandled rejection')`
  - `it('starts the player even when requestFullscreen throws synchronously')`
  - `it('starts the player when requestFullscreen is not implemented')`
  - `it('does nothing when Play is pressed while disabled')`
  - `it('leaves the playlist captured at the time of the click in the state')`
  - `it('does not render a sort control')`

**`client/test/screens/Config/Config.keyboard.test.tsx`**

- `describe('Config keyboard access')`
  - `it('reaches every control with Tab in the documented order')`
  - `it('toggles a checkbox with Space')`
  - `it('gives every icon-only control an aria-label')`

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors (including `react-hooks/exhaustive-deps` on `useImageScan` and `jsx-a11y`).
- [ ] New logic covered by unit and component tests; `npm test` green.
- [ ] Verified by hand against a real server: a folder with images shows the right count; a folder with only subfolders shows the zero-image message, and switching on "Include subfolders" reveals the count; a folder with more than 20,000 images shows the truncation line.
- [ ] Verified by hand that stopping the server and pressing Retry behaves as specified (error, then recovery once the server returns).
- [ ] Verified by hand in Chrome, Firefox and Safari (or WebKit) that "Play slide show" enters fullscreen on the first click when "Start in full screen" is on, and starts in fill-window mode, with no error, when the browser refuses.
- [ ] Verified with the OS "reduce motion" setting on and off that the note appears and disappears live and that the stored checkbox value never changes.
- [ ] Verified both themes, the slider track and thumb, the checkboxes, the focus ring and the muted text contrast.
- [ ] Verified at 320 px, 768 px and 1920 px with no horizontal scrolling and the footer button always reachable.
- [ ] Keyboard-only walkthrough: change every setting, press Reset, reach "Play slide show" with Tab, no mouse.
- [ ] Screen reader pass (NVDA, VoiceOver or Narrator): the status region announces "Scanning…" and then the count; the slider reads its value text; each checkbox reads its helper text.
- [ ] README: no change; covered by T041.

## 8. Notes and gotchas

- **Fullscreen must be the first thing in the click handler.** Spec FR-16.1. A `console.log` is fine; an `await`, a `setState` before the call, or a `setTimeout` is not. If the browser refuses with "API can only be initiated by a user gesture", something ran before the call. T030's tests assert the same ordering.
- **A rejected `requestFullscreen()` is not an error.** Fullscreen can be denied by policy, by an embedded context, or by Safari on iPhone. FR-16.1 says to fall back to fill-window mode "without an error dialog". Swallow it.
- **The status region must already exist.** If you mount a live region at the same moment you put text in it, many screen readers announce nothing. Keep one stable `role="status"` element and change only its contents.
- **Abort is not failure.** An aborted `getImages` rejects. Treat that rejection as expected control flow; if it reaches the error state, every quick toggle of "Include subfolders" will flash an error banner.
- **A late response can still arrive.** `useAbortableRequest.run` re-checks the signal after the task resolves and rejects with an abort error, which is what keeps an older, slower scan from overwriting the newer one's playlist. Do not bypass it with a hand-rolled controller.
- **Stable callbacks into the scan effect.** `setPlaylist` and the other actions come from `useAppActions()` and are stable. Wrapping them in a new inline arrow restarts the scan on every render (and `exhaustive-deps` forces them into the dependency list).
- **The slider and checkboxes are T022's.** Fix keyboard, ARIA or visual problems in `Checkbox` or `Slider`, not by working around them in this screen.
- **`prefers-reduced-motion` does not change the stored setting.** Spec §9.4. If the OS flag were allowed to uncheck the box, the user's preference would be lost the moment they turned the OS setting off. The player (T032) makes the rendering decision; this screen only explains it.
- **`selection` can be absent after a reload.** The selection is not persisted by the spec's storage table (§6.2), so a reload while on the configuration screen lands here with `selection === null` and must go back to the explorer. This is by design, not a bug.
- **`showHidden` governs hidden images too (A6).** If the user had "Show hidden items" on in the explorer, hidden images are scanned and played. There is intentionally no control for this on the configuration screen.
- **No sorting here (A7).** Order is the server's order unless the player shuffles. A sort control would need a T014 change as well and is a change request, not part of this ticket.
- **The playlist lives in state, up to 20,000 items.** Storing it is cheap, but do not copy, sort or map it in render; read `.length` and pass the reference on.
- **Scan on mount, not on render.** The scan effect depends on primitive values and stable functions only. If `selection` or `config` were passed as objects into the dependency list, every state update (including every slider tick) would restart the scan.
- **A disabled button is not focusable.** The reason "Play slide show" is disabled is in the status region, which is in the page flow and announced when it changes; `aria-describedby` on the button adds it for pointer users of assistive technology.
- **The `Info` icon and the `Play` icon are decorative.** Mark them `aria-hidden="true"`; the text carries the meaning.
- **Ticket numbering.** Later tickets refer to the player as T030 and the animations as T032. Follow `tasks/README.md`.
