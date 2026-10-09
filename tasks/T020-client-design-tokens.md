# T020 — Define the design-token and base stylesheet layer

**Epic:** E9
**Spec sections:** §6.4, §6.3, §9.2, §10, §16.2, NFR-6, NFR-8, NFR-9
**Depends on:** T019
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based slide show application with three screens: a file explorer, a slide show configuration screen, and a slide show player. It must render correctly in a light and a dark theme, driven by the operating system's preference with a manual override, and it must meet WCAG 2.1 AA contrast in both themes (NFR-6).

This ticket builds the styling foundation that every other client ticket consumes: a single file of CSS custom properties (`tokens.css`) that defines colour, spacing, radius, typography, motion and the player-specific values for both themes, and a small base stylesheet (`base.css`) that sets the document-level defaults — box sizing, the 16 px root font size, the `rem` type scale, a visible focus-visible ring, and the responsive gutter rules. Because theming in Slydr is a token swap and nothing more, getting this layer right is what lets later tickets be written without a single hard-coded colour.

The ticket also centralizes the two tuning values the specification explicitly flags for a round of visual tuning with the product owner (§16.2 item 2): the 700 ms crossfade duration and the Ken Burns `scale(1.06)` target. They are CSS custom properties precisely so they can be changed in one file without touching any component.

## 2. Scope

### In scope

- `client/src/styles/tokens.css`: the complete §6.4 token set with concrete values for both themes, the dark-mode cascade exactly as §6.3 prescribes (including the `color-scheme` property in each theme block), the player tokens from §9.2, and the tunable motion tokens from §16.2.
- `client/src/styles/base.css`: document reset and base element styles, the root font size and `rem` type scale, `box-sizing: border-box`, the `:focus-visible` ring, the page gutter rule, the no-horizontal-scroll rule (without breaking sticky positioning), reduced-motion defaults, and the documented breakpoint convention.
- `client/src/lib/cx.ts`: the four-line class-name helper. This ticket is its single owner; T022 and later tickets only consume it. It is a small accepted addition to the client tree in specification §2.1, which does not list a `lib/` directory.
- Importing both stylesheets, in order, from `client/src/main.tsx`.
- A short authoring convention comment block in each file explaining how components are expected to consume the tokens.
- Establishing CSS Modules as the component styling mechanism, with a documented naming convention and a worked example.
- A contrast-verification test that asserts the stated contrast ratios hold for the committed values.

### Out of scope

- The `useTheme` hook, the `data-theme` attribute writer, the anti-FOUC inline script, and the theme toggle button — **T021**. This ticket only defines what `data-theme='light'` and `data-theme='dark'` mean.
- Any component (`Button`, `Toggle`, `Slider`, `Breadcrumb`, …) and any `*.module.css` file belonging to a component — **T022**.
- Screen-level layout for the explorer, configuration and player screens — **T026 onwards**.
- The player's actual background layers (**T031**), Ken Burns keyframes and crossfade implementation (**T032**), controls overlay (**T033**) and keyboard handling (**T034**) consume the tokens defined here but own their own code.
- The full responsive pass across all three screens at every breakpoint — **T035**. This ticket only establishes the breakpoint values as a convention and the global gutter/overflow rules.
- Webfont loading. There is none: NFR-9 forbids outbound requests, so `--font-ui` is a system font stack.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo with three packages — `shared/`, `server/` and `client/` — ESM throughout (`"type": "module"` everywhere), TypeScript 5.x in strict mode, and Node >= 22 enforced via `engines`. ESLint 9 flat config, Prettier and Vitest are configured at the root. The client test environment is `jsdom` with React Testing Library; the client Vitest config (T002, adjusted by T019 §4.8) processes CSS (`css: { include: /.+/, ... }`) so CSS Modules resolve during tests. **Vitest globals are off**: every test imports `describe`, `it`, `expect` from `'vitest'`. Tests live in `client/test/` (Vitest only discovers `client/test/**/*.test.{ts,tsx}`).

**T001, T002 and T019** have already created the client workspace. The following exist:

- `client/package.json` — `@slydr/client`, private, ESM, depending on `react` ^19, `react-dom` ^19, `lucide-react`, `@tanstack/react-virtual` and `@slydr/shared`.
- `client/vite.config.ts` — Vite 7 with `@vitejs/plugin-react`, dev server on `127.0.0.1:5173` with `strictPort`, a `/api` proxy to `http://127.0.0.1:4317`, and `build.outDir: 'dist'`.
- `client/index.html` — contains `<meta name="color-scheme" content="light dark">` and a commented placeholder in `<head>` reserved for the T021 anti-FOUC theme script.
- `client/src/main.tsx` — mounts `<App />` into `#root` inside `<StrictMode>`. It currently imports no stylesheets; this ticket adds those imports.
- `client/src/App.tsx` — a throwaway placeholder replaced by T024.
- `client/vitest.config.ts` and `client/test/setup.ts` — `jsdom` environment, `globals` off, `@testing-library/jest-dom/vitest` matchers, RTL `cleanup()` in `afterEach`.

`@slydr/shared` exports the API contract types (`FsEntry`, `ImageItem`, `HealthResponse`, `RootResponse`, `ListResponse`, `ImagesResponse`, `ApiErrorCode`, `ApiErrorEnvelope`), `SlideshowConfig`, `DEFAULT_CONFIG`, `parseConfig`, `IMAGE_EXTENSIONS`, and the pure POSIX wire-path helpers (`wireParent`, `wireJoin`, `wireBasename`, `wireSegments`, `breadcrumbSegments`). None of them are needed by this ticket, which is pure CSS plus one test.

The server (built by **T008–T018**) serves `/api/health`, `/api/fs/root`, `/api/fs/list`, `/api/fs/images`, `/api/image` and `/api/thumb` on `127.0.0.1:4317`, `GET`/`HEAD` only, returning errors as `{ "error": { "code", "message" } }`. All wire paths are POSIX, forward-slash and relative to the jail root, with `""` meaning the root. Irrelevant to this ticket beyond explaining why no CSS may reference a remote origin.

## 4. Implementation detail

### 4.1 The dark-mode cascade (§6.3) — get this exactly right

Specification §6.3 requires a very specific structure, and the structure is the whole mechanism. Light values are the baseline on `:root`. Dark values appear **twice**:

1. Under `@media (prefers-color-scheme: dark)`, with the selector guarded as `:root:not([data-theme='light'])`. This makes the OS preference drive the theme by default, while an explicit light override still wins even on a dark OS.
2. Again under the unconditional selector `:root[data-theme='dark']`. This makes an explicit dark override win on a light OS.

Writing only the media-query block would make a dark override impossible on a light OS; writing only the attribute block would stop the OS from driving anything. Both blocks are required, and the dark values must be kept identical between them.

**`color-scheme` travels with the theme.** The `<meta name="color-scheme" content="light dark">` tag alone tells the browser to follow the OS for native scrollbars, the range slider, checkboxes and other UA-drawn parts. When the user forces a theme that differs from the OS (for example `data-theme='light'` on a dark OS), those native parts would stay dark against light tokens. So `tokens.css` also sets the `color-scheme` property inside the theme blocks: `light dark` on the `:root` baseline (the OS decides), `dark` inside both dark blocks, and a small **fourth block** `:root[data-theme='light'] { color-scheme: light; }`. The file therefore has four top-level theme blocks. `base.css` must not set `color-scheme` itself, or it would override the forced value. Extract the duplicated declarations into a single shared block if the tooling allows, but plain duplication with a loud comment is acceptable and is what this ticket specifies — it keeps `tokens.css` dependency-free and readable.

### 4.2 `client/src/styles/tokens.css`

Create the file with exactly this structure. Every value below is normative for this ticket; later tickets may add tokens but must not change these without updating the contrast test.

```css
/*
 * Slydr design tokens — spec §6.4, §6.3, §9.2, §16.2.
 *
 * Rules for consumers:
 *  - Components reference tokens only. A literal colour in a *.module.css file
 *    is a defect: it will be wrong in one of the two themes.
 *  - Light values are the baseline on :root. Dark values are declared TWICE:
 *    once under @media (prefers-color-scheme: dark) guarded by
 *    :root:not([data-theme='light']), and once under :root[data-theme='dark'].
 *    The OS drives the theme; an explicit data-theme override wins in BOTH
 *    directions. Keep the two dark blocks byte-identical.
 *  - color-scheme travels with the theme (light dark on :root, light under
 *    [data-theme='light'], dark under both dark blocks) so native widgets match
 *    a forced theme even when it differs from the OS. base.css must not set it.
 *  - All colour pairs below were checked against WCAG 2.1 AA (NFR-6).
 *    Text pairs meet >= 4.5:1; control borders and focus rings meet >= 3:1 on
 *    --bg, --bg-elevated and --bg-sunken. The figures in the comments are
 *    computed with the WCAG 2.1 relative-luminance formula.
 */

:root {
  color-scheme: light dark;


  /* ---- Surfaces and text (light) ---- */
  --bg: #ffffff;
  --bg-elevated: #f6f7f9;
  --bg-sunken: #eceef2;
  --fg: #15181d;            /* 17.79:1 on --bg, 16.60 on --bg-elevated, 15.32 on --bg-sunken */
  --fg-muted: #5a6270;      /*  6.15:1 on --bg, 5.74 on --bg-elevated, 5.29 on --bg-sunken */

  /* ---- Lines ---- */
  --border: #7a8394;        /*  3.82:1 on --bg, 3.56 on --bg-elevated, 3.29 on --bg-sunken — control boundaries, WCAG 1.4.11 */
  --border-subtle: #dde1e8; /* decorative dividers only; never a control boundary */

  /* ---- Accent ---- */
  --accent: #1d4ed8;        /*  6.70:1 on --bg, 6.25 on --bg-elevated */
  --accent-fg: #ffffff;     /*  6.70:1 on --accent */
  --accent-hover: #1a44ba;
  --accent-active: #163a9e;

  /* ---- Focus and status ---- */
  --focus-ring: #1d4ed8;    /*  6.70:1 on --bg. Equals --accent in light; the 2px outline-offset
                                keeps the ring visually separate from an accent-filled control */
  --danger: #b42318;        /*  6.57:1 on --bg, 6.13 on --bg-elevated */
  --danger-fg: #ffffff;     /*  6.57:1 on --danger */

  /* ---- Overlay (player controls pill, menus) ---- */
  --overlay-bg: rgba(16, 18, 22, 0.72);
  --overlay-fg: #ffffff;    /* worst case (overlay over a pure white photo): 7.57:1, AA; >= 13:1 over mid-grey */
  --overlay-fg-muted: #d5d9e0; /* counter text on the overlay; worst case over a pure white photo: >= 4.5:1 */

  /* ---- Elevation ---- */
  --shadow-1: 0 1px 2px rgba(16, 18, 22, 0.08), 0 2px 8px rgba(16, 18, 22, 0.08);
  --shadow-2: 0 2px 4px rgba(16, 18, 22, 0.1), 0 8px 24px rgba(16, 18, 22, 0.12);

  /* ---- Player (spec §9.2) ---- */
  --player-bg: #ffffff;          /* pure white in light theme */
  --player-bg-scale: 1.12;
  --player-bg-blur: 32px;
  --player-bg-brightness: 0.55;
  --player-bg-saturate: 1.1;

  /* ---- Radius ---- */
  --radius-sm: 0.25rem;  /*  4px */
  --radius-md: 0.5rem;   /*  8px */
  --radius-lg: 1rem;     /* 16px */
  --radius-pill: 999px;

  /* ---- Spacing (4px base; 1rem === 16px) ---- */
  --space-1: 0.25rem;  /*  4px */
  --space-2: 0.5rem;   /*  8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.5rem;   /* 24px */
  --space-6: 2rem;     /* 32px */
  --space-7: 3rem;     /* 48px */
  --space-8: 4rem;     /* 64px */

  /* ---- Typography ---- */
  --font-ui:
    system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
  --font-mono:
    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
    'Liberation Mono', monospace;

  --text-xs: 0.75rem;   /* 12px */
  --text-sm: 0.875rem;  /* 14px */
  --text-md: 1rem;      /* 16px — base */
  --text-lg: 1.125rem;  /* 18px */
  --text-xl: 1.375rem;  /* 22px */
  --text-2xl: 1.75rem;  /* 28px */
  --leading-tight: 1.25;
  --leading-normal: 1.5;

  /* ---- Motion ---- */
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);

  /*
   * ---- Tunable slide-show motion (spec §16.2 item 2) ----
   * These two values are expected to need one round of visual tuning with the
   * product owner once the player is playable. They are custom properties for
   * exactly that reason: tuning them must never require touching a component.
   */
  --slide-transition-duration: 700ms;   /* crossfade length, spec §9.4 */
  --kenburns-scale: 1.06;               /* Ken Burns zoom target, spec §9.4 */

  /*
   * Crossfade geometry, spec §9.4. The outgoing layer starts exactly where the
   * Ken Burns animation ended, so --slide-out-scale-from IS --kenburns-scale:
   * tuning the zoom target in one place can never produce a jump at the start
   * of the transition. The other three values are independent literals.
   */
  --slide-out-scale-from: var(--kenburns-scale);
  --slide-out-scale-to: 1.1;
  --slide-in-scale-from: 0.96;
  --slide-in-scale-to: 1;

  /* ---- Layer order inside the player (spec §9.2) ---- */
  --z-player-bg: 0;
  --z-player-image: 1;
  --z-player-controls: 2;

  /*
   * ---- Breakpoints, spec §10 ----
   * Documentation only. CSS custom properties CANNOT be used inside a media
   * query condition, so every @media rule repeats the literal px value. These
   * declarations exist so the single source of truth is readable here and so
   * JS can read them via getComputedStyle when it genuinely needs a number.
   */
  --bp-sm: 480px;
  --bp-md: 768px;
  --bp-lg: 1024px;
  --bp-xl: 1440px;

  /* Minimum side gutter, spec §10 */
  --page-gutter: 1rem; /* 16px */

  /* Minimum interactive target sizes, spec §9.5 / §10 */
  --target-min: 2.75rem;        /* 44px */
  --target-min-coarse: 3rem;    /* 48px */
}

/* ===== DARK — OS-driven. The guard lets an explicit light override win. ===== */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;

    --bg: #121417;
    --bg-elevated: #1b1e23;
    --bg-sunken: #0c0e11;
    --fg: #e9ecf1;            /* 15.58:1 on --bg, 14.11 on --bg-elevated, 16.32 on --bg-sunken */
    --fg-muted: #a0a8b4;      /*  7.69:1 on --bg, 6.97 on --bg-elevated, 8.06 on --bg-sunken */

    --border: #6b7480;        /*  3.90:1 on --bg, 3.53 on --bg-elevated, 4.08 on --bg-sunken */
    --border-subtle: #2a2e35;

    --accent: #7ea6ff;        /*  7.72:1 on --bg, 6.99 on --bg-elevated */
    --accent-fg: #0b1020;     /*  7.92:1 on --accent */
    --accent-hover: #9ab8ff;
    --accent-active: #b4caff;

    --focus-ring: #93b4ff;    /*  8.97:1 on --bg */
    --danger: #ff9b94;        /*  9.11:1 on --bg, 8.25 on --bg-elevated */
    --danger-fg: #2a0b08;

    --overlay-bg: rgba(10, 11, 14, 0.74);
    --overlay-fg: #ffffff;    /* worst case over a pure white photo: 8.83:1 */
    --overlay-fg-muted: #d5d9e0; /* worst case over a pure white photo: >= 4.5:1 */

    --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.45);
    --shadow-2: 0 2px 4px rgba(0, 0, 0, 0.65), 0 8px 24px rgba(0, 0, 0, 0.5);

    --player-bg: #000000;     /* pure black in dark theme, spec §9.2 */
  }
}

/* ===== DARK — explicit override. Must stay byte-identical to the block above. ===== */
:root[data-theme='dark'] {
  color-scheme: dark;

  --bg: #121417;
  --bg-elevated: #1b1e23;
  --bg-sunken: #0c0e11;
  --fg: #e9ecf1;
  --fg-muted: #a0a8b4;

  --border: #6b7480;
  --border-subtle: #2a2e35;

  --accent: #7ea6ff;
  --accent-fg: #0b1020;
  --accent-hover: #9ab8ff;
  --accent-active: #b4caff;

  --focus-ring: #93b4ff;
  --danger: #ff9b94;
  --danger-fg: #2a0b08;

  --overlay-bg: rgba(10, 11, 14, 0.74);
  --overlay-fg: #ffffff;
  --overlay-fg-muted: #d5d9e0;

  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.45);
  --shadow-2: 0 2px 4px rgba(0, 0, 0, 0.65), 0 8px 24px rgba(0, 0, 0, 0.5);

  --player-bg: #000000;
}

/* ===== LIGHT — explicit override. Only the native-widget colour scheme: every
   colour token already has its light value on :root. ===== */
:root[data-theme='light'] {
  color-scheme: light;
}
```

Measured contrast ratios for the committed values (all computed with the WCAG 2.1 relative-luminance formula; the test in §6 asserts the AA thresholds, not these exact figures, so a future palette tweak only has to stay above the threshold):

| Pair | Light | Dark | AA requirement |
|---|---|---|---|
| `--fg` on `--bg` | 17.79 : 1 | 15.58 : 1 | 4.5 : 1 |
| `--fg-muted` on `--bg` | 6.15 : 1 | 7.69 : 1 | 4.5 : 1 |
| `--fg` on `--bg-elevated` | 16.60 : 1 | 14.11 : 1 | 4.5 : 1 |
| `--fg` on `--bg-sunken` | 15.32 : 1 | 16.32 : 1 | 4.5 : 1 |
| `--fg-muted` on `--bg-elevated` | 5.74 : 1 | 6.97 : 1 | 4.5 : 1 |
| `--fg-muted` on `--bg-sunken` | 5.29 : 1 | 8.06 : 1 | 4.5 : 1 |
| `--accent` on `--bg` | 6.70 : 1 | 7.72 : 1 | 4.5 : 1 |
| `--accent` on `--bg-elevated` | 6.25 : 1 | 6.99 : 1 | 4.5 : 1 |
| `--accent-fg` on `--accent` | 6.70 : 1 | 7.92 : 1 | 4.5 : 1 |
| `--danger` on `--bg` | 6.57 : 1 | 9.11 : 1 | 4.5 : 1 |
| `--danger` on `--bg-elevated` | 6.13 : 1 | 8.25 : 1 | 4.5 : 1 |
| `--border` on `--bg` | 3.82 : 1 | 3.90 : 1 | 3.0 : 1 (1.4.11) |
| `--border` on `--bg-elevated` | 3.56 : 1 | 3.53 : 1 | 3.0 : 1 (1.4.11) |
| `--border` on `--bg-sunken` | 3.29 : 1 | 4.08 : 1 | 3.0 : 1 (1.4.11) |
| `--focus-ring` on `--bg` | 6.70 : 1 | 8.97 : 1 | 3.0 : 1 (1.4.11) |
| `--overlay-fg` on the composited `--overlay-bg` over a pure white photo (worst case) | 7.57 : 1 | 8.83 : 1 | 4.5 : 1 |
| `--overlay-fg-muted` on the composited `--overlay-bg` over a pure white photo (worst case) | about 5.4 : 1 | about 6.2 : 1 | 4.5 : 1 |

In the light theme `--focus-ring` is the same colour as `--accent`, so no contrast against an accent-filled control is claimed; the 2 px `outline-offset` leaves a gap of page background between the control and the ring, and the ring is measured against that background. The two overlay rows are asserted by the colour-pair test too: the test composites `--overlay-bg` (with its alpha) over pure white with the same helper, then measures `--overlay-fg` and `--overlay-fg-muted` against the result. That worst case guarantees the pill text stays above AA over any photograph. The player controls (T033) must use `--overlay-fg` and `--overlay-fg-muted`, never `--fg`/`--fg-muted`, which are near-black in the light theme.

**Decision (not specified):** the specification lists the minimum token set but no values. The palette above is a neutral blue-grey scale with a blue accent, chosen so that (a) every text pair clears 4.5:1 with margin, (b) `--border` clears the 3:1 non-text threshold in both themes **and on all three surfaces** (`--bg`, `--bg-elevated`, `--bg-sunken`) so cards and inputs drawn on elevated or sunken areas keep a compliant boundary, which many design systems miss, and (c) the dark surfaces are not pure black — `#121417` rather than `#000000` — so elevation reads correctly, while the *player* background remains pure black exactly as §9.2 demands.

**Decision (not specified):** `--border-subtle`, `--accent-hover`, `--accent-active`, `--danger-fg`, `--overlay-fg`, `--overlay-fg-muted`, `--shadow-2`, `--radius-pill`, the `--text-*` scale, the `--z-player-*` order, `--page-gutter`, `--target-min`, `--target-min-coarse`, the four `--slide-*-scale-*` values and the `--bp-*` documentation tokens are additions beyond the §6.4 minimum set. Each exists because a later ticket would otherwise hard-code the value in several places. `--border` is kept at the 3:1 threshold and `--border-subtle` is provided for purely decorative dividers so that components never have to choose between looking right and being accessible.

### 4.3 `client/src/styles/base.css`

```css
/*
 * Slydr base styles — spec §10, NFR-6.
 * Loaded after tokens.css. Element-level defaults only; everything
 * component-specific belongs in that component's *.module.css.
 */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  /* Spec §10: base font 16 px, type scale in rem. Never set a px font-size
     on html other than 100% — doing so breaks the user's browser zoom
     and font-size preference. */
  font-size: 100%;
  -webkit-text-size-adjust: 100%;
  /* No color-scheme here: tokens.css sets it per theme block, and a value on
     html would override the forced light/dark value. */
}

body {
  margin: 0;
  min-height: 100dvh;
  font-family: var(--font-ui);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--fg);
  background-color: var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/*
 * Spec §10: no horizontal page scrolling from 320 px upward.
 * `overflow-x: clip` on body ONLY. Do not use `hidden`, and do not put any
 * overflow value on html: `hidden` (on body, or on html and body together)
 * turns the body into a scroll container, which silently breaks
 * `position: sticky` against the viewport. Spec §7.1 needs a sticky explorer
 * header and footer. `clip` crops without creating a scroll container.
 * This is only a safety net: a component that overflows at 320 px is still a
 * bug to fix in that component (and `clip` also clips focus rings at the edge).
 */
body {
  max-width: 100%;
  overflow-x: clip;
}

#root {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

/* Spec §10: minimum 16 px side gutter on page-level content. Screens opt in
   by using this class on their outermost content wrapper. */
.page-gutter {
  padding-left: max(var(--page-gutter), env(safe-area-inset-left));
  padding-right: max(var(--page-gutter), env(safe-area-inset-right));
}

h1, h2, h3, h4 {
  margin: 0;
  line-height: var(--leading-tight);
  font-weight: 650;
}
h1 { font-size: var(--text-2xl); }
h2 { font-size: var(--text-xl); }
h3 { font-size: var(--text-lg); }
h4 { font-size: var(--text-md); }

p { margin: 0; }

img,
picture,
svg,
canvas {
  display: block;
  max-width: 100%;
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

a {
  color: var(--accent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.15em;
}

/* ---- Focus (NFR-6) ---------------------------------------------------- */

/* Remove the UA ring only where we replace it. Never a bare `outline: none`. */
:focus:not(:focus-visible) {
  outline: none;
}

/* No border-radius here: setting one on every focused element would reshape
   pill and circular controls (--radius-pill) the moment they receive focus.
   Browsers already follow the element's own border-radius for outlines. */
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* Reusable ring for elements that cannot use `outline` (clipped containers,
   tiles inside overflow:hidden parents). */
.focus-ring-inset:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--focus-ring);
}

/* ---- Screen-reader-only text ------------------------------------------ */

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* ---- Motion (spec §9.4, NFR-6) ---------------------------------------- */

/*
 * Global safety net. The player ALSO checks prefers-reduced-motion in JS,
 * because §9.4 requires reduced motion to force the whole animations-off
 * code path (no Ken Burns, instant swap), not merely a shorter transition.
 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* ---- Breakpoint convention, spec §10 ----------------------------------
 *
 * Mobile-first, min-width only. Use these literal values and no others
 * (sm, md, lg, xl in this order):
 *
 *   @media (min-width:  480px) { ... }
 *   @media (min-width:  768px) { ... }
 *   @media (min-width: 1024px) { ... }
 *   @media (min-width: 1440px) { ... }
 *
 * Never introduce a max-width breakpoint or an intermediate value; §10's
 * layout table is written entirely in terms of these four. The mirrored
 * --bp-* tokens in tokens.css exist for documentation and for JS that needs
 * the number, because custom properties cannot appear in a media condition.
 *
 * Hover affordances must be guarded, spec §10:
 *   @media (hover: hover) { .thing:hover { ... } }
 * and every hover-only affordance needs a tap or focus equivalent.
 *
 * Coarse pointers get larger targets, spec §9.5:
 *   @media (pointer: coarse) { .btn { min-height: var(--target-min-coarse); } }
 */
```

The breakpoint block above deliberately contains no inline `/* sm */`-style markers: CSS comments do not nest, so such a marker inside an outer `/* ... */` block would terminate it early and leak the rest of the text into the stylesheet as invalid CSS. Keep it that way, and keep the `base.css` test that checks for it (§6).

### 4.4 Wiring the stylesheets

Edit `client/src/main.tsx` so the two stylesheets are imported before the app, in this order:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import App from './App';
```

Order matters: `base.css` consumes the tokens, so `tokens.css` must come first. Vite preserves import order when it concatenates CSS for the production build.

### 4.5 CSS Modules as the component styling mechanism

**CSS Modules are the styling mechanism for every component in Slydr.** State this in the authoring comment at the top of `base.css` and follow it everywhere:

- A component lives in `client/src/components/<Name>/` with `<Name>.tsx` and `<Name>.module.css` beside it; a screen lives in `client/src/screens/<Screen>/` with the same pairing.
- Vite handles `*.module.css` out of the box, with no configuration. Class names are locally scoped and hashed in the production build.
- Import as a namespace and index it: `import styles from './Button.module.css';` then `className={styles.button}`.
- Use `camelCase` class names in the CSS file so the TypeScript property access reads naturally (`styles.iconOnly`, not `styles['icon-only']`).
- Only the two files in this ticket are global stylesheets. Any other global CSS file is a defect; if a rule feels global, it almost always belongs on a shared component instead.
- Compose multiple classes with a tiny local helper rather than a dependency:

```ts
// client/src/lib/cx.ts
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
```

`cx.ts` is created by this ticket and consumed by T022 and later tickets; no other ticket creates it.

**Decision (not specified):** no `clsx`/`classnames` dependency. A four-line helper covers every need in this app and keeps the NFR-8 bundle budget untouched.

For TypeScript, add a module declaration so `import styles from './X.module.css'` typechecks. `vite/client` already provides `declare module '*.module.css'`, which is in the client `tsconfig.json` `types` array from T019, so no extra file should be needed — verify this and only add `client/src/styles/css-modules.d.ts` if `tsc --noEmit` complains.

A note for the `position: sticky` consumers (T026/T029): sticky headers and footers rely on no ancestor having a non-`visible`/non-`clip` overflow. The e2e suite (T038) should include a scroll check on the explorer.

### 4.6 A worked example for the authoring convention

Put this snippet in the header comment of `base.css` (or in the README's styling section) so later tickets have a pattern to copy — it is the canonical shape of a Slydr component stylesheet:

```css
/* Example.module.css */
.card {
  background: var(--bg-elevated);
  color: var(--fg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-1);
  transition: background-color var(--dur-fast) var(--ease-standard);
}

@media (hover: hover) {
  .card:hover { background: var(--bg-sunken); }
}

.cardTitle {
  font-size: var(--text-lg);
  margin-bottom: var(--space-2);
}

.cardMeta {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
```

Note what it does **not** contain: no hex colours, no px font sizes, no unguarded `:hover`, and no `outline: none`.

## 5. Acceptance criteria

- [ ] `client/src/styles/tokens.css` exists and defines every token named in §6.4: `--bg`, `--bg-elevated`, `--bg-sunken`, `--fg`, `--fg-muted`, `--border`, `--accent`, `--accent-fg`, `--focus-ring`, `--danger`, `--overlay-bg`, `--shadow-1`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--space-1` through `--space-8`, `--font-ui`, `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-standard`.
- [ ] `--player-bg` is `#ffffff` under the light baseline and `#000000` in both dark blocks.
- [ ] `--slide-transition-duration` is `700ms` and `--kenburns-scale` is `1.06`, both declared only in `tokens.css`.
- [ ] `tokens.css` contains exactly four top-level theme blocks: `:root` (baseline, `color-scheme: light dark`), `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { … } }`, `:root[data-theme='dark'] { … }`, and `:root[data-theme='light'] { color-scheme: light; }`.
- [ ] Both dark blocks set `color-scheme: dark`; `base.css` sets no `color-scheme`; on a dark OS with `data-theme='light'` (and the reverse) the native range slider, checkbox and scrollbars match the forced theme.
- [ ] `--slide-out-scale-from` is `var(--kenburns-scale)` and the other three crossfade scale values are literals.
- [ ] The two dark blocks declare the same set of custom properties with the same values; a test asserts this.
- [ ] Setting `document.documentElement.dataset.theme = 'light'` in a browser simulating a dark OS preference yields light colours; setting `'dark'` on a light OS preference yields dark colours; removing the attribute returns control to the OS.
- [ ] `client/src/styles/base.css` sets `box-sizing: border-box` on all elements, `font-size: 100%` on `html`, and `font-family: var(--font-ui)` with `font-size: var(--text-md)` on `body`.
- [ ] `base.css` defines a `:focus-visible` rule whose outline colour is `var(--focus-ring)` with a non-zero `outline-offset`, and contains no bare `outline: none` outside the `:focus:not(:focus-visible)` rule.
- [ ] `base.css` documents the four §10 breakpoints as `480px`, `768px`, `1024px`, `1440px`, and `tokens.css` mirrors them as `--bp-sm`, `--bp-md`, `--bp-lg`, `--bp-xl`.
- [ ] `base.css` prevents horizontal page scroll with `overflow-x: clip` and `max-width: 100%` on `body` only (no `overflow` declaration on `html`, no `overflow-x: hidden` anywhere), so a `position: sticky` header still sticks; it provides a `--page-gutter` of `1rem` consumed by a `.page-gutter` utility that pads left and right separately with `safe-area-inset-left` / `safe-area-inset-right`.
- [ ] The global `:focus-visible` rule sets no `border-radius`.
- [ ] The app renders with no horizontal scrollbar at a 320 px-wide viewport and with at least a 16 px side gutter.
- [ ] `client/src/main.tsx` imports `./styles/tokens.css` then `./styles/base.css`, in that order, before importing `App`.
- [ ] No hex, `rgb()`, `hsl()` or named colour literal appears anywhere in the client source outside `tokens.css`; a lint or test guard enforces this.
- [ ] No `@import url(...)`, `<link>` to an external host, or any remote font reference exists; `--font-ui` is a pure system font stack (NFR-9).
- [ ] `client/src/lib/cx.ts` exists (T020 is its only owner) and is used in place of a classnames dependency.
- [ ] Every text and non-text contrast pair in the §4.2 table (including the two translucent-overlay rows, composited over pure white) is asserted by an automated test and passes, including `--border` on `--bg-elevated` and `--bg-sunken` in both themes.
- [ ] The three test files live in `client/test/styles/` and are discovered by `npm test`.

## 6. Tests to write

Per specification §12.3. All files go under `client/test/styles/` (Vitest only discovers `client/test/**/*.test.{ts,tsx}`) and import `describe`, `it`, `expect` from `'vitest'` (globals are off). CSS has no behaviour to test directly, so these tests read the stylesheets from disk (resolve paths with `new URL('../../src/styles/tokens.css', import.meta.url)` and `node:fs`) and assert on their contents and on computed colour maths. They are cheap and they catch the two failure modes that matter: a broken dark cascade and a contrast regression.

### `client/test/styles/tokens.test.ts`

```
describe('tokens.css — token completeness')
  it('declares every token required by spec §6.4 on :root')
  it('declares --player-bg as pure white on the light baseline')
  it('declares --player-bg as pure black in both dark blocks')
  it('declares --slide-transition-duration as 700ms')
  it('declares --kenburns-scale as 1.06')
  it('declares --slide-out-scale-from as var(--kenburns-scale)')
  it('declares the four spec §10 breakpoints as --bp-sm/md/lg/xl with 480/768/1024/1440px')

describe('tokens.css — dark cascade (spec §6.3)')
  it('has exactly four top-level theme blocks')
  it('sets color-scheme: light dark on :root, light under [data-theme=light], dark in both dark blocks')
  it('guards the prefers-color-scheme block with :root:not([data-theme=\'light\'])')
  it('also declares the dark values under :root[data-theme=\'dark\']')
  it('declares the identical property set in both dark blocks')
  it('declares the identical value for every property in both dark blocks')

describe('tokens.css — WCAG 2.1 AA contrast (NFR-6)')
  it('light: --fg on --bg meets 4.5:1')
  it('light: --fg-muted on --bg meets 4.5:1')
  it('light: --fg-muted on --bg-elevated and --bg-sunken meets 4.5:1')
  it('light: --fg on --bg-elevated meets 4.5:1')
  it('light: --fg on --bg-sunken meets 4.5:1')
  it('light: --accent on --bg meets 4.5:1')
  it('light: --accent-fg on --accent meets 4.5:1')
  it('light: --accent and --danger on --bg-elevated meet 4.5:1')
  it('light: --danger on --bg meets 4.5:1')
  it('light: --border on --bg, --bg-elevated and --bg-sunken meets 3:1 for non-text contrast')
  it('light: --focus-ring on --bg meets 3:1 for non-text contrast')
  it('light: --overlay-fg and --overlay-fg-muted on --overlay-bg composited over pure white meet 4.5:1')
  it('dark: --fg on --bg meets 4.5:1')
  it('dark: --fg-muted on --bg meets 4.5:1')
  it('dark: --fg-muted on --bg-elevated and --bg-sunken meets 4.5:1')
  it('dark: --fg on --bg-elevated meets 4.5:1')
  it('dark: --fg on --bg-sunken meets 4.5:1')
  it('dark: --accent on --bg meets 4.5:1')
  it('dark: --accent-fg on --accent meets 4.5:1')
  it('dark: --accent and --danger on --bg-elevated meet 4.5:1')
  it('dark: --danger on --bg meets 4.5:1')
  it('dark: --border on --bg, --bg-elevated and --bg-sunken meets 3:1 for non-text contrast')
  it('dark: --focus-ring on --bg meets 3:1 for non-text contrast')
  it('dark: --overlay-fg and --overlay-fg-muted on --overlay-bg composited over pure white meet 4.5:1')
```

Implementation sketch: read `client/src/styles/tokens.css` with `node:fs`, split it into the four blocks with a regex on the block selectors, parse `--name: value;` pairs (skip the `color-scheme` declaration and `var(...)` values; only `#rrggbb` values are fed to the contrast helper) into two `Map<string, string>` objects (light baseline, and the dark values merged over it), then compute contrast with a small local helper:

```ts
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = srgbToLinear((n >> 16) & 0xff);
  const g = srgbToLinear((n >> 8) & 0xff);
  const b = srgbToLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
```

For the overlay rows the test also needs `rgba(r, g, b, a)` parsing for `--overlay-bg` and a composite step over `#ffffff` (`channel = round(a * fg + (1 - a) * 255)`), whose result is fed to `contrast()`. T036 extends this same test file for further rows (focus ring on accent); there is no second contrast implementation.

Keep the helper inside the test file. It is test scaffolding, not application code, and must not reach the bundle.

### `client/test/styles/base.test.ts`

```
describe('base.css')
  it('applies box-sizing: border-box to all elements')
  it('sets html font-size to 100% so browser zoom and font preferences still work')
  it('sets body font-family to var(--font-ui) and font-size to var(--text-md)')
  it('defines a :focus-visible outline built from var(--focus-ring) with a non-zero offset')
  it('contains no bare "outline: none" outside the :focus:not(:focus-visible) rule')
  it('prevents horizontal page scroll with overflow-x: clip on body, and never uses overflow-x: hidden or any overflow on html (sticky positioning, spec §7.1)')
  it('does not set color-scheme (tokens.css owns it)')
  it('the global :focus-visible rule sets no border-radius')
  it('.page-gutter pads left and right with the matching safe-area insets')
  it('contains no nested comment terminator inside the breakpoint documentation block')
  it('documents only the four spec §10 breakpoint values and no others')
  it('forces reduced motion under prefers-reduced-motion: reduce')
```

### `client/test/styles/no-hardcoded-colours.test.ts`

```
describe('styling discipline')
  it('no client source file outside tokens.css contains a hex colour literal')
  it('no client source file outside tokens.css contains rgb(), rgba(), hsl() or hsla()')
  it('no client stylesheet references an external origin via @import or url(http...)')
  it('client/index.html contains no <link> to a remote host (NFR-9)')
```

Walk `client/src/**/*.{css,ts,tsx}` with `node:fs` (the test file itself sits in `client/test/`, so no test-file skip is needed inside `src`), skip `tokens.css`, and assert no match for `/#[0-9a-f]{3,8}\b/i` or `/\b(rgba?|hsla?)\(/`. Allow an explicit, commented opt-out list (initially empty) so a genuinely justified exception is visible in a diff rather than silent. The hex pattern can false-positive on ids and anchors that happen to be valid hex (`#add`, `#face`, `href="#fade"`); the opt-out list is the expected escape for those, entered as `file:line` plus a reason. This test is the enforcement mechanism behind "tokens only" in every subsequent client ticket, so it is worth the few lines.

### Visual verification (manual, recorded in the pull request)

Per §12.6, both themes must be checked and the layout verified at 320 px and 1920 px. Record in the pull request: a light-theme and a dark-theme screenshot of the placeholder page, and confirmation that no horizontal scrollbar appears at 320 × 568.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] `client/src/styles/tokens.css` and `client/src/styles/base.css` exist, are imported in that order from `main.tsx`, and contain no colour value outside `tokens.css`.
- [ ] All contrast assertions in §6 pass, covering every pair in the §4.2 table, including the two overlay rows, in both themes.
- [ ] The cascade is verified in a real browser in all four states (and the native range slider/scrollbar colour is checked in the two forced states): dark OS with no override, dark OS with `data-theme='light'`, light OS with no override, light OS with `data-theme='dark'`.
- [ ] Verified at 320 px and 1920 px with no horizontal page scroll and at least a 16 px side gutter.
- [ ] `npm run build --workspace @slydr/client` succeeds and the gzipped bundle total is still well under the 300 KB NFR-8 budget.
- [ ] README: no change; T041 creates the README. Content T041 should carry into a short "Styling" section: tokens in `tokens.css`, base rules in `base.css`, CSS Modules per component, tokens-only discipline, and where to tune the 700 ms crossfade and the `scale(1.06)` Ken Burns target (`--slide-transition-duration`, `--kenburns-scale`).

## 8. Notes and gotchas

- **Both dark blocks are mandatory.** It is tempting to keep only `@media (prefers-color-scheme: dark)` and add `[data-theme]` handling in JS. That breaks the override in one direction: a user on a light OS could never force dark. Equally, keeping only the attribute block means the OS no longer drives anything until the user clicks the toggle. §6.3 asks for both because both are needed, and the duplication is the cost of a mechanism that needs no JavaScript to be correct at first paint.
- **Keep the two dark blocks in sync.** Duplicated values drift. The §6 test that compares the two property maps exists specifically to catch that, and it should be treated as load-bearing rather than noise. If you refactor to avoid duplication (for example by promoting a `[data-theme='dark']` class onto the media-query selector list), keep the test and update it to match the new structure.
- **`@media (prefers-color-scheme: dark)` in jsdom.** jsdom's `matchMedia` has no real media-query evaluation, so a component test cannot observe the cascade. That is why the tests in this ticket parse the CSS text instead of asserting on `getComputedStyle`. Live cascade verification belongs to the Playwright suite (§12.4 scenario 3, which uses Playwright's `colorScheme` emulation).
- **CSS comments do not nest.** The breakpoint documentation block in §4.3 therefore has no inline `/* ... */` markers inside the outer comment. An inner `*/` would close the outer comment and leak the rest of the block into the stylesheet as invalid CSS.
- **Never `overflow-x: hidden` on html/body.** It makes the body a scroll container and silently disables viewport-relative `position: sticky`. Use `overflow-x: clip` on `body` only, and fix the component that overflows rather than relying on the clip.
- **`color-scheme` lives in `tokens.css`.** A value on `html` in `base.css` would override the per-theme values and bring back dark scrollbars on a forced-light page.
- **Hidden entries are not a token concern.** Per FR-14.5 hidden entries render exactly like all others, so no opacity or `--fg-hidden` token exists.
- **Never set `html { font-size: 14px }` or similar.** §10 requires a 16 px base and a `rem` scale, and overriding the root pixel size defeats the user's own browser font-size setting, which is an accessibility regression that no amount of `rem` usage elsewhere repairs.
- **`100dvh`, not `100vh`.** §9.1 calls for `height: 100dvh` in the player because mobile browser chrome otherwise crops the image. Using `dvh` at the `body` and `#root` level too keeps the behaviour consistent, and the fallback on very old browsers is simply a slightly taller page, which is harmless.
- **`--overlay-bg` is for content over images.** The player controls pill sits on top of arbitrary photographs, so it cannot rely on `--bg`/`--fg`. It uses `--overlay-bg` with `--overlay-fg` (and `--overlay-fg-muted` for secondary text such as the counter), and the pair is intentionally near-identical in both themes: the backdrop is a photo, not the page.
- **The player's flat background is the only place the player consults the theme** (§9.2). Everything else in the player is theme-independent. Do not add more theme-reactive tokens to the player surface.
- **`--slide-transition-duration` and `--kenburns-scale` will change.** §16.2 item 2 says to expect one round of visual tuning with the owner. Any component that bakes `700ms` or `1.06` into its own stylesheet silently opts out of that tuning. The lint-style test in §6 catches hard-coded colours; reviewers should watch for hard-coded timings the same way.
- **NFR-9 forbids outbound requests.** That means no Google Fonts, no icon CDN, no remote `@import`. The system font stack in `--font-ui` is the deliberate consequence: it is also faster and renders natively on all three platforms (Segoe UI on Windows, the system font on macOS, Roboto/Noto on Linux), which suits an app that must look native on each.
- **Reduced motion is handled twice on purpose.** The global `@media (prefers-reduced-motion: reduce)` rule here is a safety net for incidental transitions. §9.4 requires more than that in the player: reduced motion must force the complete animations-off path, with no Ken Burns at all and an instant swap. The player therefore also reads the preference in JavaScript. Do not treat the CSS rule as sufficient.
