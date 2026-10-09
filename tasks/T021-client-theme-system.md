# T021 — Implement the theme system, anti-FOUC script and toggle

**Epic:** E9
**Spec sections:** §6.3, §6.2, §3.4, §12.3, NFR-6, NFR-9
**Depends on:** T020
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based slide show application with three screens: a file explorer, a slide show configuration screen, and a slide show player. Its light and dark themes are driven by the operating system's preference, with a manual override that the user can set from a toggle button and that persists across reloads.

This ticket implements the behavioural half of that theming story. The visual half — the design tokens and the `data-theme` cascade — already exists from T020. What is missing is: the code that decides which theme is effective, the code that applies it to `<html>` **before the first paint** so the page never flashes the wrong colours, the live reaction to an OS theme change while no override is stored, and the two-state toggle button that sets and clears the override.

Three details carry the real weight. First, the theme must be applied before first paint, which means it cannot be done by React — by the time React mounts, the browser has already painted. Second, the specification's Content-Security-Policy for the HTML document is `script-src 'self'` (§3.4), which forbids a bare inline script, so the "small inline script" §6.3 asks for has to be reconciled with the CSP; this ticket makes and records that decision. Third, the OS must keep driving the theme live **only while no override is stored** — once the user has made a choice, an OS change must not quietly undo it.

## 2. Scope

### In scope

- `client/public/theme-init.js` — the pre-paint theme resolver, given verbatim below, plus the `<script>` tag that loads it from `client/index.html` (replacing the placeholder comment T019 left there).
- `client/src/state/theme.ts` — the shared constants and the pure resolution helpers used by both the init script's logic and the hook (`THEME_STORAGE_KEY`, `Theme`, `readStoredTheme`, `writeStoredTheme`, `clearStoredTheme`, `prefersDark`, `applyTheme`, `resolveEffectiveTheme`).
- `client/src/state/useTheme.ts` — the React hook exposing the effective theme, the stored override, and a setter/toggler, with the `matchMedia` `change` listener active only while no override is stored.
- `client/src/components/ThemeToggle/ThemeToggle.tsx` and `ThemeToggle.module.css` — the two-state toggle button with the exact `aria-label` strings and the sun/moon `lucide-react` icons.
- Reconciling the pre-paint script with the §3.4 CSP, and recording the decision in the ticket and in code comments (the README text is carried by T041).
- An ESLint entry for `client/public/**/*.js` so the pre-paint script lints clean under the repository's flat config (section 4.10).
- Updating T019's `client/test/scaffold.test.ts`, whose "placeholder" assertion no longer holds once the script tag replaces the placeholder (section 4.11).
- The shared `matchMedia` test helper `client/test/helpers/matchMedia.ts`, reused by later tickets.
- Full component-test coverage of all four combinations of stored override × OS preference (§12.3), plus the `localStorage`-disabled case. All tests live under `client/test/` (section 6).

### Out of scope

- The design tokens, the light/dark value sets and the `data-theme` cascade — **T020**. This ticket only sets the attribute; it defines no colours.
- The general validated `localStorage` persistence layer, the schema-version key, the debounced writer and the other `slydr.*` keys — **T023**. The theme key is handled directly here because it must be readable by the pre-paint script, which runs long before any React hook exists (see §8).
- `AppStateProvider` and the view state machine — **T024**.
- The base component library (`Button`, `IconButton`, `Checkbox`, …) — **T022**. `ThemeToggle` is a plain, self-contained `<button>` that owns its own 44/48 px target rules; T022 does not wrap, replace or re-implement it, and T022 does not build a theme toggle.
- Placing the toggle into the explorer and configuration headers — **T026** (explorer header) and **T029** (configuration screen). This ticket delivers the component and states where it belongs; the screens mount it.
- The README text about the theme and the pre-paint script — **T041** (T041 creates the README; no earlier ticket edits it).
- Sending the CSP response header itself — **T039** owns production headers. This ticket makes the markup compliant with the policy that ticket will send.
- End-to-end (e2e) testing is out of scope.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo with three packages — `shared/`, `server/` and `client/` — ESM throughout (`"type": "module"`), TypeScript 5.x strict, Node >= 22 enforced via `engines`. ESLint 9 flat config, Prettier and Vitest are configured at the root. The client test environment is `jsdom` with React Testing Library. Tests live only under `client/test/` (Vitest's `include` is `test/**/*.test.{ts,tsx}`), Vitest globals are **off** (every test imports `describe`, `it`, `expect`, `vi` from `'vitest'`), and CSS Modules class names are non-scoped in tests (`css.modules.classNameStrategy: 'non-scoped'`).

From **T019**:

- `client/package.json` (`@slydr/client`, private, ESM, `react` ^19, `react-dom` ^19, `@slydr/shared`).
- `client/vite.config.ts` — Vite 7 with `@vitejs/plugin-react`, dev server on `127.0.0.1:5173` (`strictPort`), `/api` proxied to `http://127.0.0.1:4317`, build output `client/dist`.
- `client/index.html` — contains `<meta name="color-scheme" content="light dark">` and, inside `<head>`, a comment placeholder explicitly reserved for this ticket's theme script.
- `client/src/main.tsx` mounting `<App />` into `#root` inside `<StrictMode>`.
- `client/vitest.config.ts` (`jsdom`, globals off) and `client/test/setup.ts` (registers `@testing-library/jest-dom/vitest` and runs RTL `cleanup()`), both created by T002.
- `client/test/scaffold.test.ts`, which asserts that `index.html` still holds the commented T021 placeholder (this ticket updates it, section 4.11).
- `lucide-react` (`^0.544.0`) is already a dependency of `client` (T001); this ticket adds no dependency.

From **T020**:

- `client/src/styles/tokens.css`, imported first from `main.tsx`. It defines the §6.4 token set with light values on `:root`, and dark values twice — under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { … } }` and under `:root[data-theme='dark'] { … }`. Consequently: `data-theme` absent means "follow the OS"; `data-theme="light"` forces light even on a dark OS; `data-theme="dark"` forces dark even on a light OS. Those are the only three states this ticket may produce.
- `client/src/styles/base.css`, imported second. It provides the `:focus-visible` ring from `var(--focus-ring)`, the `.sr-only` utility, `--target-min: 2.75rem` (44 px) and `--target-min-coarse: 3rem` (48 px), and documents the §10 breakpoints (`480px`, `768px`, `1024px`, `1440px`).
- `client/src/lib/cx.ts` exporting `cx(...parts: Array<string | false | null | undefined>): string`.
- The styling discipline: CSS Modules per component, tokens only, no colour literals outside `tokens.css`, hover affordances guarded by `@media (hover: hover)`.

`@slydr/shared` exports `EntryType`, `FsEntry`, `ImageItem`, the endpoint response types (`HealthResponse`, `RootResponse`, `ListResponse`, `ImagesResponse`), the `ApiErrorCode` union and `ApiErrorEnvelope`, `SlideshowConfig`, `DEFAULT_CONFIG`, `parseConfig`, `IMAGE_EXTENSIONS`, and the pure POSIX wire-path helpers (`wireParent`, `wireJoin`, `wireBasename`, `wireSegments`, `breadcrumbSegments`). This ticket needs none of them.

The server (**T008–T018**) serves `/api/health`, `/api/fs/root`, `/api/fs/list`, `/api/fs/images`, `/api/image` and `/api/thumb` on `127.0.0.1:4317`, `GET`/`HEAD` only, with the `{ error: { code, message } }` envelope. All wire paths are POSIX, forward-slash, relative to the jail root, with `""` meaning the root. The server's §3.4 hardening includes the CSP `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'` on the HTML document — the constraint this ticket must satisfy.

## 4. Implementation detail

### 4.1 Reconciling the pre-paint script with the CSP — the decision

Specification §6.3 says "a small inline script in `index.html` sets `data-theme` before first paint". Specification §3.4 says the HTML document is served with `script-src 'self'`. A literal inline `<script>…</script>` violates that policy: under `script-src 'self'` an inline script is blocked unless it carries a matching `'unsafe-inline'`, nonce or hash.

**Decision (not specified): move the script to a separate same-origin file, `client/public/theme-init.js`, and load it with a classic blocking `<script src="/theme-init.js"></script>` in `<head>`.**

Rationale:

- A same-origin script file satisfies `script-src 'self'` with no policy relaxation at all. No `'unsafe-inline'`, no nonce plumbing, no hash to keep in sync.
- A classic (non-`module`, non-`defer`, non-`async`) script in `<head>` is parser-blocking: the browser executes it before it builds the body and therefore before first paint. The anti-FOUC guarantee is preserved exactly.
- It is a tiny same-origin request that, in production, is served by the same Express process from `client/dist` and is cached. In development Vite serves `client/public/*` at the origin root, so the URL `/theme-init.js` is identical in both environments and no build-time substitution is needed.
- The two alternatives were rejected: a **CSP hash** (`'sha256-…'`) couples the policy header in the server workspace to a string literal in the client workspace, so every tweak to the script silently breaks theming in production until someone recomputes the hash; a **nonce** requires per-response HTML templating, which §2.2's "Express serves `client/dist` as static files" explicitly is not.

Record the decision in two code places: a comment in `client/index.html` and a comment at the top of `theme-init.js`. T041 carries it into the README. Anyone later tempted to "simplify" this back to an inline script needs to find the reason without reading this ticket.

A note for **T039** (production serving): because the file lives in `client/public/`, Vite copies it to `client/dist/theme-init.js` during the build, so static hosting of `client/dist` serves it without special handling. T039 must not apply a `script-src` policy narrower than `'self'`.

### 4.2 `client/public/theme-init.js` — verbatim

This is the file, in full. Keep it dependency-free, ES5-compatible, and defensive: it runs before anything else and must never throw, because an exception here leaves the page unthemed.

```js
/*
 * Slydr anti-FOUC theme initialiser — spec §6.3.
 *
 * Runs as a PARSER-BLOCKING classic script in <head>, before first paint, so
 * the page never flashes the wrong theme. It is a separate same-origin file
 * rather than an inline <script> because the HTML document is served with the
 * spec §3.4 policy `script-src 'self'`, which blocks inline scripts. A
 * same-origin file satisfies that policy with no relaxation, no nonce and no
 * hash to keep in sync. Do not inline this. See tasks/T021.
 *
 * Contract with styles/tokens.css:
 *   data-theme absent  -> follow the OS (prefers-color-scheme)
 *   data-theme="light" -> force light, even on a dark OS
 *   data-theme="dark"  -> force dark, even on a light OS
 *
 * Keep this logic in sync with client/src/state/theme.ts.
 */
(function () {
  'use strict';
  var KEY = 'slydr.theme';
  var root = document.documentElement;

  var stored = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch (_err) {
    /* Storage disabled (private mode, blocked site data). Follow the OS. */
    stored = null;
  }

  if (stored === 'light' || stored === 'dark') {
    root.setAttribute('data-theme', stored);
    return;
  }

  /*
   * No valid override. Leave data-theme off entirely so the CSS
   * prefers-color-scheme block owns the decision. Setting the attribute to the
   * current OS value here would freeze the theme at load time and break the
   * live OS-change behaviour required by §6.3.
   */
  root.removeAttribute('data-theme');
})();
```

The `removeAttribute` call matters even though the attribute is normally absent on a fresh document: it makes the script idempotent, so re-running it after an override is cleared restores OS control rather than leaving a stale value.

### 4.3 `client/index.html` — replacing the placeholder

Replace the T019 placeholder comment with the script tag plus the decision note. The resulting `<head>` is:

```html
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!--
    Spec §6.3: declares support for both colour schemes so native scrollbars,
    form controls and UA styles follow the active theme.
  -->
  <meta name="color-scheme" content="light dark" />
  <title>Slydr</title>

  <!--
    Anti-FOUC theme initialiser (spec §6.3).
    Parser-blocking classic script, so data-theme is set BEFORE first paint.
    It is a separate same-origin file, not an inline script, because the
    document is served with `script-src 'self'` (spec §3.4). Do not add
    `defer`, `async` or `type="module"` — each of them defers execution past
    first paint and reintroduces the theme flash. Do not inline it.
  -->
  <script src="/theme-init.js"></script>
</head>
```

The three forbidden attributes are called out in the comment because each one looks like a harmless modernisation and each one silently reintroduces the exact bug the file exists to prevent.

### 4.4 `client/src/state/theme.ts`

The shared, testable core. Keeping these helpers separate from the hook means the resolution rules can be unit-tested without rendering a component, and gives the init script a single documented counterpart.

```ts
/**
 * Theme resolution primitives — spec §6.3, §6.2.
 * Keep in sync with client/public/theme-init.js, which reimplements the
 * read-and-apply step in dependency-free ES5 so it can run before first paint.
 */

export type Theme = 'light' | 'dark';

/** Spec §6.2 key table. `"light" | "dark"`; absent means follow the OS. */
export const THEME_STORAGE_KEY = 'slydr.theme';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Reads the stored override. Returns null when absent, invalid, or storage throws. */
export function readStoredTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

/** Stores an override. Silently does nothing when storage is unavailable. */
export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Storage disabled. The in-memory override still applies for this session. */
  }
}

/** Removes the override, returning control to the OS. Never throws. */
export function clearStoredTheme(): void {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* Storage disabled; nothing to remove. */
  }
}

/** Current OS preference. Defaults to light when matchMedia is unavailable. */
export function prefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia(DARK_MEDIA_QUERY).matches
      : false;
  } catch {
    return false;
  }
}

/**
 * Effective theme: the stored override if present, otherwise the live OS value.
 * Spec §6.3.
 */
export function resolveEffectiveTheme(
  override: Theme | null,
  osPrefersDark: boolean,
): Theme {
  if (override !== null) return override;
  return osPrefersDark ? 'dark' : 'light';
}

/**
 * Applies the override to <html>. An explicit override sets data-theme;
 * `null` REMOVES the attribute so the tokens.css prefers-color-scheme block
 * regains control. Never write the resolved value when there is no override —
 * that would freeze the theme and break live OS switching.
 */
export function applyTheme(override: Theme | null): void {
  const root = document.documentElement;
  if (override === null) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', override);
  }
}
```

The distinction in `applyTheme` is the single most important rule in this ticket: **the attribute mirrors the override, not the effective theme.** Writing the effective theme would make `data-theme` always present, which permanently disables the `:root:not([data-theme='light'])` media-query branch and kills live OS switching.

### 4.5 `client/src/state/useTheme.ts`

```ts
import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  clearStoredTheme,
  DARK_MEDIA_QUERY,
  prefersDark,
  readStoredTheme,
  resolveEffectiveTheme,
  writeStoredTheme,
  type Theme,
} from './theme';

export interface UseThemeResult {
  /** The theme actually in effect right now. */
  theme: Theme;
  /** The stored override, or null while the OS is in control. */
  override: Theme | null;
  /** Stores an explicit override and applies it immediately. */
  setTheme: (theme: Theme) => void;
  /** Stores the opposite of the currently effective theme (spec §6.3). */
  toggleTheme: () => void;
  /** Clears the override, returning control to the OS. */
  followSystemTheme: () => void;
}

/**
 * Theme state — spec §6.3.
 *
 * - Effective theme = stored `slydr.theme` if present, else the live
 *   `matchMedia('(prefers-color-scheme: dark)')` value.
 * - OS changes apply live ONLY while no override is stored: the `change`
 *   listener is attached when `override === null` and detached as soon as an
 *   override exists. Once the user has chosen, the OS must not override them.
 */
export function useTheme(): UseThemeResult {
  const [override, setOverride] = useState<Theme | null>(() => readStoredTheme());
  const [osDark, setOsDark] = useState<boolean>(() => prefersDark());

  // Reflect the override onto <html>. The attribute mirrors the OVERRIDE, not
  // the effective theme, so that removing it hands control back to the CSS.
  useEffect(() => {
    applyTheme(override);
  }, [override]);

  // Live OS tracking, but only while unoverridden.
  useEffect(() => {
    if (override !== null) return;
    if (typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setOsDark(event.matches);
    };

    setOsDark(mql.matches); // resync in case it changed while overridden
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [override]);

  const theme = resolveEffectiveTheme(override, osDark);

  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next);
    setOverride(next);
  }, []);

  const toggleTheme = useCallback(() => {
    // Spec §6.3: the first click stores the OPPOSITE of the currently
    // EFFECTIVE theme — not the opposite of the stored value, which may be
    // absent on the first click.
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    writeStoredTheme(next);
    setOverride(next);
  }, [theme]);

  const followSystemTheme = useCallback(() => {
    clearStoredTheme();
    setOverride(null);
  }, []);

  return { theme, override, setTheme, toggleTheme, followSystemTheme };
}
```

Notes on the implementation:

- `addEventListener('change', …)` is used rather than the deprecated `addListener`. Every browser targeted by Vite's `es2022` output supports it; no Safari 13 fallback is needed.
- The theme write is **not** debounced. §6.2's 250 ms debounce (T023) exists for high-frequency writes such as the duration slider. A theme toggle is a single deliberate click, and debouncing it would risk losing the write if the user closed the tab immediately. **Decision (not specified):** `slydr.theme` is written synchronously on click.
- `followSystemTheme` is not reachable from the two-state toggle described in §6.3. It is exported because clearing the override is the only way back to OS control and a test needs it; the specification does not ask for a UI affordance, so none is added. **Decision (not specified):** no "System" option in the UI; §6.3 explicitly describes a two-state toggle.
- The function is deliberately **not** named `use…`: a `use`-prefixed function that is not a hook makes `react-hooks/rules-of-hooks` (set to `error` in T002) fail as soon as a caller invokes it from an event handler.

### 4.6 `client/src/components/ThemeToggle/ThemeToggle.tsx`

```tsx
import { Moon, Sun } from 'lucide-react';
import { cx } from '../../lib/cx';
import { useTheme } from '../../state/useTheme';
import styles from './ThemeToggle.module.css';

export interface ThemeToggleProps {
  className?: string;
}

/**
 * Two-state theme toggle — spec §6.3.
 *
 * Sits top-right on the explorer and configuration screens only. It must
 * NEVER be rendered in the player: the player is a presentation surface with
 * its own bottom-centre controls overlay (§9.5) and no chrome of its own.
 *
 * The first click stores the opposite of the currently EFFECTIVE theme, so it
 * behaves predictably whether or not an override already exists.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const goingDark = theme === 'light';

  return (
    <button
      type="button"
      className={cx(styles.toggle, className)}
      onClick={toggleTheme}
      aria-label={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}
      title={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}
      data-theme-state={theme}
    >
      {goingDark ? (
        <Moon aria-hidden="true" focusable="false" size={20} strokeWidth={2} />
      ) : (
        <Sun aria-hidden="true" focusable="false" size={20} strokeWidth={2} />
      )}
    </button>
  );
}
```

The exact label strings are normative, verbatim from §6.3: **"Switch to dark theme"** when the effective theme is light, and **"Switch to light theme"** when the effective theme is dark. The label names the *destination*, not the current state — that is the convention screen-reader users expect from an action button, and it is what the specification writes.

Icon choice follows the same logic: in light mode the button offers dark, so it shows a **moon**; in dark mode it offers light, so it shows a **sun**. The icon is `aria-hidden` because the button already has an accessible name; without that, assistive technology announces the SVG twice.

**Decision (not specified):** the component reads `useTheme()` itself rather than taking `theme` and `onToggle` props. Theme state is global and the hook is cheap, so prop-drilling it through two screen headers would add noise for no benefit. If a future ticket needs a controlled variant, add optional props rather than changing the default.

**Decision (not specified):** `title` duplicates `aria-label` so sighted mouse users get a tooltip. This is safe here because the button has no visible text label for the tooltip to contradict.

### 4.7 `client/src/components/ThemeToggle/ThemeToggle.module.css`

```css
.toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--target-min);   /* 44px, spec §10 / §9.5 */
  min-height: var(--target-min);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

@media (hover: hover) {
  .toggle:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
}

/* Tap/focus equivalent for the hover affordance, spec §10. */
.toggle:focus-visible,
.toggle:active {
  color: var(--fg);
}

.toggle:active {
  background: var(--bg-sunken);
}

@media (pointer: coarse) {
  .toggle {
    min-width: var(--target-min-coarse);  /* 48px */
    min-height: var(--target-min-coarse);
  }
}
```

The `:focus-visible` outline itself comes from the global rule in `base.css` (`2px solid var(--focus-ring)` with a `2px` offset); do not restate it here.

### 4.8 Dependency

No dependency is added. `lucide-react` (`^0.544.0`) was installed by T001 and must keep that version. It is tree-shaken per named import, so importing `Moon` and `Sun` adds roughly a kilobyte, well within the NFR-8 budget. Always use named imports (`import { Moon } from 'lucide-react'`) and never `import * as icons`, which defeats tree-shaking and would pull the whole icon set into the bundle.

### 4.9 Placement rules

Record these in the component's doc comment (T041 carries them into the README):

- **Explorer screen:** rightmost control in the sticky header (§7.1 lists the header order as breadcrumb, up-one-level, spacer, image-count chip, view-mode toggle, show-hidden toggle, theme switch).
- **Configuration screen:** top-right (§8.1).
- **Player screen:** never. The player's only chrome is the bottom-centre auto-hiding controls overlay (§9.5), which contains previous, pause/play, next, fullscreen and stop, and nothing else.

The explorer header (T026) and the configuration header (T029) mount `<ThemeToggle />`; neither builds a toggle of its own, and T022 does not provide one.

### 4.10 Linting `client/public/theme-init.js`

T002's flat config applies `js.configs.recommended` to every `.js` file but gives browser globals only to `client/**/*.{ts,tsx}`. Left alone, `npm run lint` reports `'window' is not defined` and `'document' is not defined` (`no-undef`) for `theme-init.js`, and ESLint 9 also reports an unused caught error. Add this entry to the root `eslint.config.js`, after T002's client entries and before the Node-tooling entry:

```js
  // client/public/*.js are plain classic scripts served as-is (theme-init.js).
  {
    files: ['client/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
```

T002's `caughtErrorsIgnorePattern: '^_'` is scoped to TypeScript files, so for this ES5 file the entry above is what allows the unused `catch (_err)` parameter (an optional catch binding would not be ES5). Prettier formats the file like any other source file.

### 4.11 Updating T019's scaffold test

`client/test/scaffold.test.ts` (T019) contains the case `index.html reserves the anti-FOUC theme script placeholder in <head>`, which asserts the commented placeholder naming T021. This ticket removes that comment, so update the case in the same change:

- Rename it to `index.html loads the anti-FOUC theme script in <head>`.
- Assert `index.html` contains `<script src="/theme-init.js"></script>` inside `<head>`, after the `color-scheme` meta and before the `type="module"` script tag.
- Keep every other case in that file unchanged.

## 5. Acceptance criteria

- [ ] `client/public/theme-init.js` exists, is dependency-free ES5, wraps its `localStorage` read in `try`/`catch`, and matches the §4.2 listing.
- [ ] `client/index.html` loads it with `<script src="/theme-init.js"></script>` inside `<head>`, with no `defer`, `async` or `type="module"` attribute, and placed after the `color-scheme` meta tag.
- [ ] `client/index.html` no longer contains the T019 placeholder comment, and contains a comment recording why the script is a separate file rather than inline (the `script-src 'self'` CSP from §3.4).
- [ ] Loading the app with `slydr.theme` set to `"dark"` on a light-OS machine paints dark on the very first frame, with no visible flash of light colours.
- [ ] Loading the app with no stored value on a dark-OS machine paints dark, and `document.documentElement` has **no** `data-theme` attribute.
- [ ] `client/src/state/theme.ts` exports `Theme`, `THEME_STORAGE_KEY` (value `'slydr.theme'`), `DARK_MEDIA_QUERY`, `readStoredTheme`, `writeStoredTheme`, `clearStoredTheme`, `prefersDark`, `resolveEffectiveTheme` and `applyTheme` with the signatures in §4.4.
- [ ] `readStoredTheme()` returns `null` for an absent key, for any value other than `'light'`/`'dark'`, and when `localStorage` access throws.
- [ ] `applyTheme(null)` removes the `data-theme` attribute; `applyTheme('light')` and `applyTheme('dark')` set it to that exact value.
- [ ] `client/src/state/useTheme.ts` exports `useTheme(): UseThemeResult` with `theme`, `override`, `setTheme`, `toggleTheme` and `followSystemTheme`.
- [ ] While no override is stored, dispatching a `change` on the `(prefers-color-scheme: dark)` media query list updates `theme` live.
- [ ] Once an override is stored, the media-query `change` listener is detached and an OS change does not alter `theme`.
- [ ] `toggleTheme()` on an unoverridden dark-OS session stores `"light"`; on an unoverridden light-OS session it stores `"dark"`.
- [ ] With `localStorage` throwing on both read and write, the app renders, the toggle changes the theme for the session, and no error is logged or displayed.
- [ ] `ThemeToggle` renders a single `<button type="button">` whose `aria-label` is exactly `"Switch to dark theme"` when the effective theme is light and exactly `"Switch to light theme"` when it is dark.
- [ ] `ThemeToggle` renders a `lucide-react` `Moon` icon in light mode and a `Sun` icon in dark mode, with `aria-hidden="true"` on the SVG.
- [ ] `ThemeToggle` has a minimum 44 × 44 px target, 48 × 48 px under `@media (pointer: coarse)`, a visible `:focus-visible` ring, and uses only tokens — no colour literal in `ThemeToggle.module.css`.
- [ ] `lucide-react` is imported with named imports only; no namespace or default import of the icon set exists.
- [ ] `npm run build --workspace @slydr/client` emits `client/dist/theme-init.js` and the gzipped bundle total remains under the 300 KB NFR-8 budget.
- [ ] `useTheme()` exposes `followSystemTheme` (no `use`-prefixed non-hook export exists in `client/src/state/`).
- [ ] `eslint.config.js` has the `client/public/**/*.js` entry of section 4.10, and `npm run lint` reports no error for `client/public/theme-init.js`.
- [ ] `client/test/scaffold.test.ts` asserts the script tag instead of the placeholder comment and passes.
- [ ] `client/test/helpers/matchMedia.ts` exists with the API of section 6, and every test of this ticket lives under `client/test/` and imports `describe`, `it`, `expect`, `vi` from `'vitest'`.
- [ ] `package.json` of `client` is unchanged by this ticket (no dependency added or re-versioned).

## 6. Tests to write

Per specification §12.3, which names exactly this scenario set: "Theme resolution across all four combinations of stored override and OS preference; `localStorage` disabled".

All test files of this ticket live under `client/test/` (mirroring `src/`) and import `describe`, `it`, `expect`, `vi` and the lifecycle hooks from `'vitest'`; Vitest globals are off.

A shared test helper is needed because jsdom's `matchMedia` is a stub. This ticket owns it: create `client/test/helpers/matchMedia.ts`. It controls **any** media query (later tickets reuse it for `prefers-reduced-motion`, `(min-width: 768px)`, `(pointer: coarse)`, …) and restores `window.matchMedia` on dispose, so nothing leaks between tests:

```ts
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface MatchMediaController {
  /** Sets the result for `query` and fires `change` on every listener registered for it. */
  setMatches(query: string, matches: boolean): void;
  /** Number of `change` listeners currently registered (for one query, or for all). */
  listenerCount(query?: string): number;
  /** Restores the previous window.matchMedia (or removes the stub). Call in afterEach. */
  dispose(): void;
}

type Listener = (e: MediaQueryListEvent) => void;

/** Installs a controllable window.matchMedia. Queries not listed in `initial` start as false. */
export function installMatchMedia(initial: Record<string, boolean> = {}): MatchMediaController {
  const entries = new Map<string, { matches: boolean; listeners: Set<Listener> }>();
  const entry = (query: string) => {
    let e = entries.get(query);
    if (!e) {
      e = { matches: initial[query] ?? false, listeners: new Set() };
      entries.set(query, e);
    }
    return e;
  };
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const stub = (query: string): MediaQueryList => {
    const e = entry(query);
    return {
      get matches() { return e.matches; },
      media: query,
      onchange: null,
      addEventListener: (_type: string, fn: Listener) => { e.listeners.add(fn); },
      removeEventListener: (_type: string, fn: Listener) => { e.listeners.delete(fn); },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: stub });
  return {
    setMatches(query, matches) {
      const e = entry(query);
      e.matches = matches;
      for (const fn of [...e.listeners]) fn({ matches, media: query } as MediaQueryListEvent);
    },
    listenerCount(query) {
      if (query !== undefined) return entry(query).listeners.size;
      let n = 0;
      for (const e of entries.values()) n += e.listeners.size;
      return n;
    },
    dispose() {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}
```

Tests in this ticket call `installMatchMedia({ [DARK_QUERY]: true })` for a dark OS and `controller.setMatches(DARK_QUERY, false)` for an OS change, and call `controller.dispose()` in `afterEach`. The T023 `storageMock` helper (`client/test/helpers/storageMock.ts`) is the later, fuller equivalent for `localStorage`; this ticket's storage-disabled tests replace `window.localStorage` inline as described below.

### `client/test/state/theme.test.ts`

```
describe('readStoredTheme')
  it('returns "light" when slydr.theme is "light"')
  it('returns "dark" when slydr.theme is "dark"')
  it('returns null when slydr.theme is absent')
  it('returns null when slydr.theme holds an unrecognised value such as "midnight"')
  it('returns null when localStorage.getItem throws')

describe('writeStoredTheme / clearStoredTheme')
  it('writes the value under the exact key "slydr.theme"')
  it('removes the key so the OS regains control')
  it('does not throw when localStorage.setItem throws')
  it('does not throw when localStorage.removeItem throws')

describe('prefersDark')
  it('returns true when the dark media query matches')
  it('returns false when the dark media query does not match')
  it('returns false when window.matchMedia is unavailable')

describe('resolveEffectiveTheme')
  it('returns the stored override when one is present, ignoring the OS value')
  it('returns "dark" when there is no override and the OS prefers dark')
  it('returns "light" when there is no override and the OS prefers light')

describe('applyTheme')
  it('sets data-theme="dark" on <html> for an explicit dark override')
  it('sets data-theme="light" on <html> for an explicit light override')
  it('removes the data-theme attribute entirely when the override is null')
  it('is idempotent when called twice with the same value')
```

### `client/test/state/useTheme.test.tsx`

The four §12.3 combinations are the first four cases. Render a tiny probe component that prints `theme` and the current `data-theme` attribute.

```
describe('useTheme — stored override x OS preference (spec §12.3)')
  it('no override + OS light: effective theme is light and data-theme is absent')
  it('no override + OS dark: effective theme is dark and data-theme is absent')
  it('stored "light" + OS dark: effective theme is light and data-theme is "light"')
  it('stored "dark" + OS light: effective theme is dark and data-theme is "dark"')

describe('useTheme — live OS changes')
  it('follows an OS change from light to dark while no override is stored')
  it('follows an OS change from dark to light while no override is stored')
  it('ignores an OS change once an override is stored')
  it('attaches no media-query listener while an override is stored')
  it('detaches the media-query listener on unmount')

describe('useTheme — setters')
  it('setTheme("dark") writes "dark" to slydr.theme and sets data-theme="dark"')
  it('toggleTheme stores "dark" when the effective theme is light with no override')
  it('toggleTheme stores "light" when the effective theme is dark with no override')
  it('toggleTheme stores the opposite of the effective theme, not of the stored value')
  it('followSystemTheme removes slydr.theme and removes the data-theme attribute')
  it('followSystemTheme restores live OS tracking afterwards')

describe('useTheme — localStorage disabled (spec §6.2, §12.3)')
  it('falls back to the OS preference when getItem throws')
  it('still toggles the effective theme for the session when setItem throws')
  it('logs no error and surfaces no error state when storage is unavailable')
```

For the storage-disabled cases, replace `window.localStorage` with an object whose `getItem`/`setItem`/`removeItem` throw `new DOMException('denied', 'SecurityError')`, which is what a browser with blocked site data actually throws. Assert with a `console.error` spy that nothing is logged.

### `client/test/components/ThemeToggle/ThemeToggle.test.tsx`

```
describe('ThemeToggle')
  it('renders a button labelled "Switch to dark theme" when the effective theme is light')
  it('renders a button labelled "Switch to light theme" when the effective theme is dark')
  it('renders the moon icon in light mode and the sun icon in dark mode')
  it('marks the icon aria-hidden so the button is announced once')
  it('updates its own label after being clicked')
  it('sets data-theme="dark" on <html> when clicked from the light theme')
  it('sets data-theme="light" on <html> when clicked from the dark theme')
  it('is reachable by Tab and activates on Enter and on Space')
  it('exposes an accessible name via aria-label with no visible text content')
```

### `client/test/theme-init.test.ts`

Loads `client/public/theme-init.js` into the jsdom window with `new Function(source)` and asserts the pre-paint behaviour, plus reads `client/index.html` for the markup guarantees.

```
describe('theme-init.js (anti-FOUC, spec §6.3)')
  it('sets data-theme="dark" when slydr.theme is "dark"')
  it('sets data-theme="light" when slydr.theme is "light"')
  it('leaves data-theme absent when slydr.theme is missing, so CSS follows the OS')
  it('leaves data-theme absent when slydr.theme holds an invalid value')
  it('does not throw when localStorage access throws')
  it('removes a pre-existing data-theme attribute when no override is stored')

describe('index.html script wiring')
  it('loads /theme-init.js with a classic script tag in <head>')
  it('does not mark the theme script defer, async or type="module"')
  it('places the theme script after the color-scheme meta tag')
  it('contains no inline <script> body, which the §3.4 CSP would block')
```

### `client/test/scaffold.test.ts` (existing, from T019; update one case)

```
describe('client scaffold')
  it('index.html loads the anti-FOUC theme script in <head>')   // replaces the "reserves ... placeholder" case; see section 4.11
```

All other cases of that file stay as T019 wrote them.

### Verification scope

End-to-end (e2e) testing is out of scope. No e2e counterpart exists.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] All four stored-override × OS-preference combinations from §12.3 are covered by passing tests, as is the `localStorage`-disabled case.
- [ ] Verified manually in a browser: a stored dark override on a light-OS machine shows no flash of light colours on reload, and vice versa.
- [ ] Verified manually: changing the OS theme while the app is open and no override is stored switches the app live; after clicking the toggle, changing the OS theme has no effect.
- [ ] Both themes checked, and the toggle verified keyboard-operable with a visible focus ring at 320 px and 1920 px.
- [ ] `ThemeToggle.module.css` contains no colour literal; `npm test` includes the T020 "no hard-coded colours" guard and it passes.
- [ ] `npm run build --workspace @slydr/client` emits `client/dist/theme-init.js`; gzipped bundle total still under 300 KB.
- [ ] `npm run lint` is clean for `client/public/theme-init.js` (section 4.10) and the updated `client/test/scaffold.test.ts` passes (section 4.11).
- [ ] README: no change; T041 creates the README and carries the theme behaviour and the "pre-paint script is a separate same-origin file because of `script-src 'self'`" note.

## 8. Notes and gotchas

- **`data-theme` mirrors the override, never the effective theme.** If the attribute is always present, the `:root:not([data-theme='light'])` branch in `tokens.css` is permanently inert and live OS switching stops working. The only three valid states are: attribute absent, `"light"`, `"dark"`.
- **Do not add `defer`, `async` or `type="module"` to the theme script tag.** All three defer execution until after the document is parsed, which is after first paint — the flash comes straight back. A classic parser-blocking script in `<head>` is the point.
- **Do not inline the script "for speed".** It would violate `script-src 'self'` (§3.4) in production and the theme would silently stop applying, with only a console CSP violation to explain it. The §4.1 decision and its comments exist to stop that regression.
- **Two implementations of one rule** (three files once T023 lands, but only `theme-init.js` is a separate reader; `theme.ts` then delegates to `storage.ts`). `theme-init.js` and `theme.ts` both read `slydr.theme` and both map it to `data-theme`. That duplication is unavoidable: one must run before any bundle is parsed, the other inside React. Both files carry a "keep in sync" comment, and `theme-init.test.ts` plus `theme.test.ts` assert the same behaviour so a divergence fails the suite. Do not try to import the TypeScript helper from the public file — that would make it a module and defeat the pre-paint guarantee.
- **The theme key is special in the T023 persistence layer.** T023 (which depends on this ticket) owns a validating, debounced, schema-versioned `localStorage` module for the other `slydr.*` keys, and it later moves the storage calls of `theme.ts` into that module without changing `theme.ts`'s exports. `slydr.theme` is read by `theme-init.js` before any module loads, so it must stay readable with a raw `getItem` and a literal key, and it must be written immediately rather than debounced. T023 must not route it through the debounced writer. One consequence worth knowing: `slydr.schemaVersion` mismatch handling (treat all other keys as absent) does **not** apply to `slydr.theme`, because the pre-paint script cannot afford to validate a second key. **Decision (not specified):** the theme key is exempt from schema-version invalidation; the worst case is a stale but still-valid `"light"`/`"dark"` string, which is harmless.
- **jsdom cannot evaluate media queries.** `window.matchMedia` in jsdom returns a stub with `matches: false` and no working listeners, so every test touching OS preference must install the helper from §6. Real cascade verification is done manually in a browser at both OS preferences (see Definition of done); component tests cover the `data-theme` attribute contract jsdom can observe.
- **`StrictMode` double-invokes effects** in development. The `matchMedia` effect therefore attaches, detaches and reattaches its listener. The cleanup function makes this harmless; if a listener-count assertion is flaky, check that the cleanup actually removes the same function reference it added.
- **No cross-tab synchronisation** (§16.1 A1). Do not add a `storage`-event listener to sync the theme between tabs. Slydr assumes single-tab use, and a `storage` listener here would also have to reason about the override-versus-OS precedence a second time.
- **No "System" third state in the UI** (§6.3 specifies a two-state toggle). `followSystemTheme` exists for completeness and tests. If a third state is ever wanted, note that it needs a different control shape — a two-state button cannot express three states accessibly.
- **The player must never render the toggle** (§6.3, §9.5). The player's chrome is only the auto-hiding bottom-centre pill. A theme control there would both violate the specification and visually intrude on image presentation.
- **Icon import discipline.** `lucide-react` tree-shakes per named export. A namespace import pulls in roughly a thousand icon components and would blow the NFR-8 budget on its own.
- **`color-scheme` is what fixes native widgets.** The `<meta name="color-scheme" content="light dark">` in `index.html` plus `color-scheme: light dark` on `html` in `base.css` are what make scrollbars, the range input's track and the checkbox glyphs follow the theme. If a native control looks wrong in dark mode, check that pair first rather than adding custom styling.
