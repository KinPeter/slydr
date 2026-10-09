# T031 — Implement the player background layers

**Epic:** E16 — Player backgrounds
**Spec sections:** §9.2 (FR-16.4), §6.3, NFR-4
**Depends on:** T030
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based application that plays slide shows of images from
folders on the user's own computer. Its player screen shows each image fitted inside the
viewport with its aspect ratio preserved, which means a 3:2 photograph on a 16:9 screen
leaves bars of empty space at the sides. This ticket decides what fills those bars.

There are two modes, chosen by the user's **"Fill empty space on screen"** configuration
checkbox. With it off, the empty area is a flat, uncompromising `--player-bg` — pure black
in the dark theme, pure white in the light theme. With it on, the empty area is filled with
the currently displayed image itself, scaled up to cover, heavily blurred and darkened, so
the photograph appears to bleed softly into the screen edges.

The ticket also owns the three-layer stacking structure inside the player container
(background, image layer(s), controls overlay), and it is the **only** place in the whole
player that consults the theme.

## 2. Scope

### In scope

- `client/src/screens/Player/PlayerBackground.tsx` — the background layer component,
  covering both modes.
- `client/src/screens/Player/PlayerBackground.module.css` — the flat mode, the blurred
  cover mode, and the fade-in of the incoming slide's cover over the outgoing one.
- Using the background tunables that T020 already declared in `client/src/styles/tokens.css`
  (§4.6); no token is added.
- Confirming and documenting the three stacked layers inside the player container, with
  explicit `z-index` values and the rule that the background always fills the full area in
  both modes with no gaps around the image.
- Wiring `PlayerBackground` into the `background` slot that `PlayerStage` already exposes.
- Component tests for both modes and for the no-extra-request guarantee.

### Out of scope

- The playback engine, the scheduler, the playlist and the fitting of the foreground image
  — **T030** owns `usePlayerEngine`, `Player.tsx`, `PlayerStage.tsx`, `SlideImage.tsx` and
  `Player.module.css`.
- The Ken Burns zoom and the 700 ms crossfade of the **foreground** image layers —
  **T032**. This ticket must stay in sync with that crossfade, and §4.5 specifies exactly
  how, but it must not implement it.
- The controls overlay — **T033**. This ticket only reserves the overlay's layer slot.
- Keyboard shortcuts and the `fullscreenchange` handling — **T034**.
- Theme tokens themselves. `--player-bg` already exists with the correct value in both
  themes; this ticket consumes it and must not redefine it.
- Any server change. The background reuses an already-requested URL and adds no endpoint.
- End-to-end (e2e) testing is out of scope.

## 3. Prerequisites and assumed state

The repository is **not** empty. The following already exists and must be used as-is.

**Monorepo and tooling.** An npm workspaces monorepo with three packages — `shared/`,
`server/`, `client/`. Every `package.json` has `"type": "module"`, so the codebase is ESM
throughout. TypeScript is in `strict` mode. The client is **Vite 7 + React 19**. Styling is
plain CSS with custom properties plus **CSS Modules** (`*.module.css`) and the design tokens
in `client/src/styles/tokens.css`. Tests are **Vitest + React Testing Library** in the
`jsdom` environment with fake-timer support. `npm test`, `npm run typecheck` and
`npm run lint` are the gates.

**`@slydr/shared`** exports:

```ts
export interface ImageItem {
  name: string;
  path: string;      // wire path: POSIX, forward slashes, relative to the jail root
  dir: string;
  size: number | null;
  mtimeMs: number | null;
}

export interface SlideshowConfig {
  durationSeconds: number;    // integer 1..30
  shuffle: boolean;
  loop: boolean;
  animations: boolean;
  fillEmptySpace: boolean;    // ← this ticket's switch
  startFullScreen: boolean;
  includeSubfolders: boolean;
}
```

**`AppStateProvider`** owns `{ view: 'explorer' | 'config' | 'player', explorer, selection,
config, playlist: ImageItem[] | null }`. The configuration screen has already fetched the
playlist via `GET /api/fs/images`, so the player receives `AppState.playlist` and performs
no listing request of its own. Stop, `Esc`, or the end of an unlooped show returns to the
`config` view, releasing fullscreen, the wake lock and all timers.

**The typed API client** exposes `imageUrl(path: string): string`, returning the
`/api/image?path=…` URL used as an `<img src>`. The server responds with
`Cache-Control: private, max-age=1h`, an `ETag`, `Last-Modified` and Range support, so a
second element pointing at the same URL is served from the browser's cache without a
network round trip.

**Design tokens** in `client/src/styles/tokens.css` include `--player-bg` (**pure black in
the dark theme, pure white in the light theme**), `--overlay-bg`, `--dur-fast`,
`--dur-base`, `--dur-slow`, `--ease-standard`, `--space-1` … `--space-8`, the crossfade
duration `--slide-transition-duration` (700 ms), the Ken Burns target scale
`--kenburns-scale` (1.06), and the four background tunables `--player-bg-scale` (1.12),
`--player-bg-blur` (32px), `--player-bg-brightness` (0.55) and `--player-bg-saturate` (1.1).
All of them are already declared in `tokens.css` by T020; this ticket declares no token.

**Base components** exist in `client/src/components/`: `Button`, `IconButton` (which
requires an `aria-label`), `Icon` (a `lucide-react` wrapper) and `Banner`.

**The theme switch must never appear in the player.** It is rendered only by the explorer
and configuration screens.

**From T030 — the player foundation.** The following already exists and is the seam this
ticket plugs into:

```ts
export type SwapReason = 'initial' | 'auto' | 'manual';
export type PlayerStatus = 'starting' | 'playing' | 'paused' | 'failed';

export interface PlayerSlide {
  key: string;        // unique per occurrence: `${cycle}:${position}`
  position: number;
  cycle: number;
  item: ImageItem;
  src: string;        // imageUrl(item.path) — the already-requested URL
}

export interface PlayerEngineState {
  status: PlayerStatus;
  current: PlayerSlide | null;
  previous: PlayerSlide | null;
  next: PlayerSlide | null;
  swapReason: SwapReason;
  durationMs: number;
  counter: { index: number; total: number };
  isFullscreen: boolean;
  error: string | null;
}
```

`PlayerStage` already accepts a `background?: React.ReactNode` prop and renders it inside a
`.layerBackground` slot, and `Player.module.css` already defines:

```css
.layerBackground { position: absolute; inset: 0; z-index: 0; overflow: hidden; }
.layerImages     { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
.layerOverlay    { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
```

and the player container `.player` has `background: var(--player-bg)` as a baseline so the
player is never transparent. The foreground image layer uses
`object-fit: contain; object-position: center`.

## 4. Implementation detail

### 4.1 The three stacked layers (§9.2)

Inside the player container there are exactly three stacked layers, in this paint order:

| z-index | Layer | Owner | Contents |
|---|---|---|---|
| 0 | background layer | **this ticket** | flat colour, or the blurred cover image |
| 1 | image layer(s) | T030 / T032 | the ≤ 3 fitted `<img>` elements |
| 2 | controls overlay | T033 | the auto-hiding control pill |

Rules that this ticket is responsible for:

- The background layer is `position: absolute; inset: 0`, so it is always exactly the size
  of the player container — which is itself `position: fixed; inset: 0; width: 100vw;
  height: 100dvh`. There is therefore **no** condition under which the background fails to
  cover the full available area, in either mode, and no gap can appear around the fitted
  image.
- The background layer sets `overflow: hidden`, which is what clips the scaled-up blurred
  image so the `scale(1.12)` does not provoke a scrollbar or overflow the fixed container.
- The background layer is `pointer-events: none` throughout. It is decoration; clicks must
  reach the image layer and the overlay.
- The background contributes nothing to the accessibility tree: every element it renders
  carries `aria-hidden="true"`, and any `<img>` it renders carries `alt=""`.

### 4.2 Mode A — `fillEmptySpace` off: the flat background

A single `<div>` filling the layer:

```css
.flat {
  position: absolute;
  inset: 0;
  background-color: var(--player-bg);
}
```

`--player-bg` is **pure black in the dark theme and pure white in the light theme**. Those
values already exist in `client/src/styles/tokens.css`; do not redefine them and do not
substitute `--bg` or `--bg-sunken`, which are the chrome backgrounds and are not pure.

**This is the only place in the entire player that consults the theme**, and the
specification calls that out explicitly in §9.2. It consults it the right way — by reading
a custom property that `styles/tokens.css` has already resolved for the effective theme —
so there is no `useTheme()` call, no `matchMedia` query and no JavaScript theme branch
anywhere in this ticket. The anti-FOUC script in `index.html` sets `data-theme` before
first paint, and the token definitions handle both the OS-driven and the overridden cases,
so reading the variable is sufficient and correct.

The theme switch itself must **not** be rendered in the player (§6.3). If the user wants to
flip the player's background from black to white they do it on the configuration screen
before pressing play; a live theme change while the player is open will simply repaint the
flat background, which is harmless and requires no code.

### 4.3 Mode B — `fillEmptySpace` on: the blurred cover background

The background is the **currently displayed image**, scaled up, blurred, darkened and
slightly saturated, so it covers the whole area including the letterbox bars.

These values are normative and come verbatim from §9.2:

```css
.cover {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scale(var(--player-bg-scale));          /* 1.12 in tokens.css */
  filter:
    blur(var(--player-bg-blur))                      /* 32px */
    brightness(var(--player-bg-brightness))          /* 0.55 */
    saturate(var(--player-bg-saturate));             /* 1.1 */
  will-change: transform;
  /* The scaled-up layer is clipped by .layerBackground's overflow: hidden. */
}
```

Each piece, and why:

- **`object-fit: cover`** — the background must *cover*, never *contain*. This is the exact
  opposite of the foreground image, which is `object-fit: contain` per FR-16.3. Both
  declarations will sit in the same directory; a reviewer must be able to tell them apart at
  a glance, so keep the class names `.cover` (background) and `.slide` (foreground, owned by
  T030).
- **`transform: scale(1.12)`** — required, not cosmetic. `blur()` is a convolution: near the
  edges of the element the kernel samples pixels that lie outside the element and are
  therefore transparent. Blurring against transparency pulls the result towards
  transparency, producing a visible soft rim or vignette exactly where the background is
  supposed to be invisible. Scaling the element up by 12 % pushes that contaminated rim
  outside the clipped viewport. A `blur()` radius of 32 px needs roughly 3 × 32 px = 96 px
  of bleed on each edge to be safe; on a 1920 px-wide viewport, 12 % gives 115 px per side,
  which clears it. Do not reduce the scale without raising it in proportion to the blur
  radius.
- **`brightness(0.55)`** — darkens the background so the fitted foreground image is clearly
  the subject and so the translucent controls pill (T033) stays legible against it.
- **`saturate(1.1)`** — a slight lift that stops the blurred, darkened result from looking
  muddy and grey.
- **`will-change: transform`** — promotes the layer to its own compositor layer, so the
  expensive blur is rasterised once and then reused, rather than being recomputed by the main
  thread on every frame of the foreground's Ken Burns animation.

**The blur is never animated** (NFR-4). `filter` is applied once, as a static value, to a
single layer per slide, and it never appears in a `transition` or `@keyframes` rule in this
ticket. Animating `blur()` forces a full re-rasterisation per frame and reliably drops a
1080p slide show below 60 fps on a mid-range laptop.

Do **not** add `will-change: filter`. That hint does not help a static filter and it
increases the memory the compositor reserves for the layer, which fights NFR-3's bounded
memory goal.

### 4.4 Reusing the already-loaded image — no extra network request

The background must cost nothing extra. `PlayerSlide.src` is the result of
`imageUrl(item.path)`, which the foreground layer is already using as its `<img src>`.

Render the background as a real `<img>` with the **same `src` string**:

```tsx
<img className={styles.cover} src={slide.src} alt="" aria-hidden="true" draggable={false} decoding="async" />
```

Rules:

- The `src` must be byte-for-byte the string from `PlayerSlide.src`. Do not re-derive it by
  calling `imageUrl(item.path)` again, do not append a cache-busting parameter, and do not
  vary the query-parameter order. Any difference produces a different cache key and a second
  request.
- Because the server sends `Cache-Control: private, max-age=1h` plus a strong `ETag`
  (§5.5), the second element for the same URL is satisfied from the browser's memory cache.
  Typically no HTTP request is issued at all; in the worst case a conditional request
  returns `304`.
- *Decision (not specified):* use an `<img>` element rather than a
  `background-image: url(...)` div. An `<img>` gets `object-fit: cover` for free with
  correct aspect handling, participates in the same cache entry as the foreground element,
  and can be given `decoding="async"`. A CSS `background-image` cannot be hooked to a load
  or error event, which matters because the background should simply disappear rather than
  show a broken-image artefact if its slide fails.
- Do **not** add `loading="lazy"`; the element is on screen immediately and lazy loading
  would race the crossfade.
- The background `<img>` is not counted against NFR-3's "at most three decoded images in the
  DOM" budget in the sense of distinct decoded resources: it points at the identical URL as
  a foreground layer, so the browser shares the decoded bitmap. Never point a background
  layer at a URL no foreground layer is using. Each cover carries `data-bg="true"`, and the
  budget tests (T030, T032) count foreground images with `img:not([data-bg])`; covers are
  limited to two.

### 4.5 Staying in sync with the crossfade (the T032 interaction)

T032 crossfades the **foreground** layers over 700 ms: the outgoing layer goes
`opacity: 1 → 0` with `scale(1.06 → 1.10)` and the incoming layer goes `opacity: 0 → 1`
with `scale(0.96 → 1)`. If the background hard-cut from slide N's blur to slide N+1's blur
at the start of that 700 ms, the eye would catch the background jumping while the
foreground was still half faded.

**Decision (chosen approach, labelled): only the incoming cover fades in, over a fully
opaque outgoing cover; the fade is a CSS `@keyframes` animation on `opacity` and needs no
JavaScript.**

The background layer renders up to **two** `.cover` elements, mirroring the foreground's
double buffering:

```tsx
// Pseudo-structure.
<div className={styles.background} aria-hidden="true">
  <div className={styles.flat} />
  {outgoing && (
    <img key={outgoing.key} className={cx(styles.cover, styles.coverOut)} src={outgoing.src} data-bg="true" … />
  )}
  {incoming && (
    <img key={incoming.key} className={cx(styles.cover, styles.coverIn)} src={incoming.src} data-bg="true" … />
  )}
</div>
```

```css
/* The incoming cover is later in the DOM, so it paints above the outgoing one. */
.coverIn {
  animation: coverFadeIn var(--player-transition-dur, var(--slide-transition-duration))
             var(--ease-standard) both;
}
@keyframes coverFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
/* .coverOut has no rule of its own: it stays at opacity 1 until it is unmounted. */
```

Properties of this approach, and why it is the right one:

- **Never a gap.** A symmetric cross-dissolve (outgoing 1 → 0 while incoming 0 → 1) passes
  through a frame where the two covers together cover only 75 % of each pixel, so the flat
  `--player-bg` layer underneath shows through. In the light theme that is a white flash
  behind a photograph whose background must "always fill the full available screen". With
  only the incoming cover fading over an opaque outgoing cover, every pixel is covered by at
  least one fully opaque cover at every frame.
- **Only `opacity` is animated.** Each `.cover` element keeps its own static `filter` and its
  own static `transform: scale(var(--player-bg-scale))` for its entire lifetime. `filter` is
  never in a transition or keyframe, so NFR-4 holds.
- **Both background layers are already rasterised.** Because each is a promoted compositor
  layer with `will-change: transform`, the blur for the incoming background is computed
  once, off the critical path, and the fade itself is a pure compositor opacity blend.
- **The durations match by construction.** The foreground crossfade (T032) and the
  background fade both read `--player-transition-dur` (falling back to
  `--slide-transition-duration`, 700 ms, declared once in `tokens.css`) and both use
  `--ease-standard`. When the product owner re-tunes 700 ms (§16.2), both change together.
- **Shortened manual transitions, cuts and animations-off all work with no code.** T030
  publishes `state.swapReason`; T032 maps it (and the effective animations flag, and an
  interrupted swap) to the single custom property `--player-transition-dur`, which T032's
  `Player.tsx` sets as an inline style on the `.player` element (a common ancestor of this
  layer and the images). `--dur-fast` shortens the fade for previous/next, and `0ms` makes
  the animation instantaneous, which is exactly the §9.4 "no transition at all" behaviour.
- **Same mechanism family as T032.** T032 mounts the foreground layer in its final
  position and animates it with CSS; this ticket uses the same CSS-only approach (a
  keyframe animation starts on mount, so no before-change style or double render is needed).
  A short comment in `PlayerBackground.module.css` names this.

Rejected alternatives, recorded so they are not re-litigated:

- *A symmetric cross-dissolve of both covers* — shows the flat layer at the midpoint (above).
- *Transitioning `filter` from one image to another* — forbidden by NFR-4 and visibly janky.
- *A single background element whose `src` is swapped* — the swap is a hard cut and causes a
  one-frame flash of the previous blur at full opacity while the new image decodes.
- *Rendering the background with `backdrop-filter` over a shared image* — `backdrop-filter`
  reads the composited result beneath it, which on this stack is the other background layer,
  producing feedback and far worse performance.
- *A `requestAnimationFrame` or layout-effect class toggle for the initial `opacity: 0`* —
  needless JavaScript and a second render; a keyframe animation with `both` fill handles it.

**Lifecycle.** `outgoing` is derived from `state.previous` and `incoming` from
`state.current`. Keyed by `slide.key` (React matches keyed siblings across positions in the
same parent, so the element that was `.coverIn` stays the same DOM node when it becomes
`.coverOut`; it must not remount, or its image would flash). The `coverIn` → `coverOut` class
change removes the animation without changing the computed opacity (1), so nothing visible
happens to the outgoing cover. The outgoing cover is unmounted when T030/T032 clear
`state.previous` (`releasePrevious`, with T030's `PREVIOUS_LAYER_LINGER_MS = 1000 ms` as a
backstop). When T032 renders `previous={null}` (animations off, reduced motion, interrupted
swap) there is no outgoing cover and the incoming one replaces it in the same commit. This
ticket must not introduce its own eviction timer; it simply renders whatever `state.previous`
and `state.current` are.

*Decision (not specified):* the incoming background starts its fade as soon as it mounts,
without waiting for its own `decode()`. The slide it belongs to has **already** been decode
-gated by T030 before becoming `current`, so the bitmap is in the cache and a fresh decode of
the same resource is effectively instantaneous. Adding a second decode gate here would
desynchronise the background from the foreground by a frame or two.

### 4.6 Tunable custom properties

T020 already declares, once and theme-independent, in `client/src/styles/tokens.css`:
`--player-bg-scale: 1.12`, `--player-bg-blur: 32px`, `--player-bg-brightness: 0.55`,
`--player-bg-saturate: 1.1`, `--slide-transition-duration: 700ms` and `--player-bg`. This
ticket **adds no token and does not redeclare any**; `PlayerBackground.module.css` reads them
with plain `var(--…)` (no literal fallbacks, so no second copy of 1.12, 32px, 0.55, 1.1 or
700ms exists outside `tokens.css`). Keep the blur-rim rationale of §4.3 as a comment next to
the `transform: scale(var(--player-bg-scale))` declaration in the module CSS.

The effective transition duration is **not** declared here; it is set per swap, because it
depends on `swapReason`, on the effective animations flag and on whether the swap interrupted
a fade. T030 publishes the information needed and T032 owns the mapping and sets the
property inline on the `.player` element; this ticket consumes the single resulting property
with a fallback to the shared token, so it is fully functional on its own before T032 lands:

```css
animation-duration: var(--player-transition-dur, var(--slide-transition-duration));
```

*Decision (not specified):* `--player-transition-dur` is the agreed contract name for "the
duration of the current swap". T032 documents it in a comment in `tokens.css` and sets the
same property, so nobody invents a second one.

### 4.7 `PlayerBackground.tsx` — component contract

```tsx
import type { PlayerSlide } from './types';

export interface PlayerBackgroundProps {
  /** `config.fillEmptySpace`. */
  fillEmptySpace: boolean;
  /** `state.current` — the slide whose image is currently on screen. */
  current: PlayerSlide | null;
  /** `state.previous` — kept mounted underneath only while the incoming cover fades in. */
  previous: PlayerSlide | null;
}

export function PlayerBackground(props: PlayerBackgroundProps): React.ReactElement;
```

Rendering rules, in order:

1. Always render the outer `<div className={styles.background} aria-hidden="true">` so the
   layer exists and covers the area regardless of mode.
2. Always render the `.flat` element **underneath** the cover elements, in both modes. In
   mode B it is invisible behind the opaque cover image, but it guarantees there is never a
   transparent pixel — for instance during the very first slide's decode, or if a background
   image fails. *Decision (not specified):* the specification asks only for a flat background
   in mode A, but keeping it permanently as the bottom-most fill is the cheapest possible
   insurance against the "no gaps around the image" requirement and costs one painted
   rectangle.
3. When `fillEmptySpace` is false, render nothing else and return.
4. When `fillEmptySpace` is true, render the `.coverOut` element for `previous` (if
   non-null) and then the `.coverIn` element for `current` (if non-null), each keyed by
   `slide.key` and each carrying `data-bg="true"` (so foreground `<img>` budget tests can
   exclude it with `img:not([data-bg])`, T030 §4.8). The outgoing cover comes first in DOM
   order so the incoming one paints above it.
5. If a background `<img>` fires `error`, hide that element (set a local flag keyed by the
   slide key and apply `display: none`). The flat layer beneath takes over. Do **not** report
   the failure to the engine: T030 already receives the foreground layer's error for the same
   URL and owns the skip decision. Reporting twice would double-count the failure.

Wire it into `Player.tsx` through the slot T030 already provides:

```tsx
<PlayerStage
  state={state}
  controls={controls}
  config={app.config}
  registerLayer={registerLayer}
  reportLoadError={reportLoadError}
  reportLoadSuccess={reportLoadSuccess}
  background={
    <PlayerBackground
      fillEmptySpace={app.config.fillEmptySpace}
      current={state.current}
      previous={state.previous}
    />
  }
/>
```

### 4.8 `PlayerBackground.module.css` in full

```css
.background {
  position: absolute;
  inset: 0;
  overflow: hidden;      /* clips the scaled-up blurred layers */
  pointer-events: none;  /* decoration only */
}

.flat {
  position: absolute;
  inset: 0;
  background-color: var(--player-bg);
}

.cover {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  /* Blur-rim guard: blur() samples transparent pixels at the element edge; scaling above 1
     pushes that soft rim outside the clipped layer. Raise the scale with the blur radius. */
  transform: scale(var(--player-bg-scale));
  filter:
    blur(var(--player-bg-blur))
    brightness(var(--player-bg-brightness))
    saturate(var(--player-bg-saturate));
  will-change: transform;
  /* NFR-4: `filter` is static. It must never appear in a transition or keyframe. */
}

/* Only the incoming cover fades (opacity only), over the opaque outgoing cover, so the flat
   layer never shows through mid-fade. Same CSS-only mechanism family as the foreground
   crossfade in T032; both read --player-transition-dur. */
.coverIn {
  animation: coverFadeIn var(--player-transition-dur, var(--slide-transition-duration))
             var(--ease-standard) both;
}

@keyframes coverFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.coverFailed { display: none; }

@media (prefers-reduced-motion: reduce) {
  /* Belt and braces: T032 already sets --player-transition-dur to 0ms when reduced motion
     forces the animations-off path. */
  .coverIn { animation: none; }
}
```

## 5. Acceptance criteria

- [ ] `client/src/screens/Player/PlayerBackground.tsx` exists and exports
      `PlayerBackground` with the props in §4.7.
- [ ] `Player.tsx` passes `PlayerBackground` to `PlayerStage`'s `background` slot; no other
      component renders a player background.
- [ ] With `fillEmptySpace: false`, the rendered background contains exactly one `.flat`
      element and **no** `<img>`.
- [ ] `.flat` uses `background-color: var(--player-bg)` and no other colour token.
- [ ] With `fillEmptySpace: true`, the background renders an `<img>` whose `src` is
      **identical** to the foreground layer's `src` for the same slide — asserted by string
      equality in a test.
- [ ] The background `<img>` never triggers a second network request: a test counts distinct
      `src` values in the DOM and asserts the background `src` is already present on a
      foreground layer.
- [ ] `.cover` contains, verbatim, `object-fit: cover`, `transform: scale(var(--player-bg-scale))`
      and
      `filter: blur(var(--player-bg-blur)) brightness(var(--player-bg-brightness)) saturate(var(--player-bg-saturate))`
      (whitespace may differ).
- [ ] This ticket adds no token: `tokens.css` is not in its diff. The values it reads
      (`--player-bg-scale: 1.12`, `--player-bg-blur: 32px`, `--player-bg-brightness: 0.55`,
      `--player-bg-saturate: 1.1`, `--slide-transition-duration: 700ms`) already exist from
      T020, and no literal copy of those numbers appears in `PlayerBackground.module.css`.
- [ ] `--player-bg-scale` (in T020) is greater than 1, and the blur-rim rationale is in a CSS
      comment next to the `transform` declaration in `PlayerBackground.module.css`.
- [ ] Grep `PlayerBackground.module.css` for `filter` inside a `transition` or
      `@keyframes` block — **zero** hits (NFR-4).
- [ ] Grep the file for `will-change: filter` — zero hits.
- [ ] `.cover` carries `will-change: transform`.
- [ ] Only `.coverIn` animates, via `@keyframes coverFadeIn` (`opacity` 0 → 1 only), with
      duration `var(--player-transition-dur, var(--slide-transition-duration))` and
      `var(--ease-standard)`; `.coverOut` has no animation or transition and stays at
      opacity 1 until unmounted, so the flat layer never shows through mid-fade.
- [ ] No JavaScript (no `requestAnimationFrame`, layout effect or state) is involved in the
      fade.
- [ ] At most two `.cover` elements exist at any time (outgoing and incoming); every one
      carries `data-bg="true"`; the same DOM node survives the `coverIn` → `coverOut` class
      change (no remount).
- [ ] Every element the background renders carries `aria-hidden="true"` and every `<img>`
      carries `alt=""`; `getByRole('img')` finds nothing inside the background layer.
- [ ] The background layer is `pointer-events: none`.
- [ ] The background layer is `position: absolute; inset: 0; overflow: hidden`, so it covers
      the full player area in both modes with no gaps around the fitted image.
- [ ] Grep this ticket's diff for `useTheme`, `matchMedia`, `prefers-color-scheme` and
      `data-theme` — **zero** hits. The theme reaches this code only through `--player-bg`.
- [ ] The player still renders no theme switch.
- [ ] A background `<img>` whose load fails is hidden and the flat layer shows through; the
      engine's failure count is **not** incremented twice.
- [ ] `@media (prefers-reduced-motion: reduce)` disables the background fade-in animation.

## 6. Tests to write

Per specification §12.3 (component tests with React Testing Library; fake timers where
timing is asserted). Paths assume `client/test/` as the client suite root; mirror whatever
layout the repository already uses.

**`client/test/screens/Player/PlayerBackground.test.tsx`**

Render `PlayerBackground` directly with hand-built `PlayerSlide` fixtures — it is a pure
presentational component and needs no engine.

- `describe('flat mode (fillEmptySpace off)')`
  - `it('renders a single flat layer and no image element')`
  - `it('renders the flat layer even before the first slide is available')` — `current` and
    `previous` both `null`.
  - `it('applies the flat class that resolves --player-bg')` — assert the class name from
    the CSS module is present; jsdom does not resolve custom properties, so assert on the
    class, and assert separately that the module source contains
    `background-color: var(--player-bg)`.
  - `it('exposes nothing to the accessibility tree')` — `queryAllByRole('img')` is empty and
    the container has `aria-hidden="true"`.
- `describe('blurred cover mode (fillEmptySpace on)')`
  - `it('renders a cover image for the current slide')`
  - `it('uses exactly the slide src with no cache-busting parameter')` — assert
    `img.getAttribute('src') === slide.src`.
  - `it('renders the flat layer beneath the cover image')`
  - `it('renders no cover image while there is no current slide')`
  - `it('renders at most two cover images, both with data-bg="true"')` — supply both
    `previous` and `current`.
  - `it('keys the cover images by slide key so a loop boundary remounts them')` — advance
    from `0:4` to `1:0` with the same `item.path` and assert the element identity changed.
  - `it('keeps the same DOM node when a slide moves from current to previous')` — rerender
    with `current = A` then `previous = A, current = B`; the node that showed A is the same
    element and now has the outgoing class (no remount, so no flash).
  - `it('renders the outgoing cover before the incoming one in DOM order')`
  - `it('marks the cover images decorative')` — `alt=""` and `aria-hidden="true"`.
- `describe('failure handling')`
  - `it('hides a cover image whose load fails')` — fire `error` on the `<img>`, assert the
    failed class is applied.
  - `it('does not call any engine error reporter')` — pass a spy-bearing wrapper and assert
    it was never called.
- `describe('no extra network request')`
  - `it('reuses the foreground src string') ` — render the full `PlayerStage` with both
    foreground and background and assert the set of distinct `src` values in the DOM equals
    the set of distinct slide sources, i.e. the background adds no new URL.

**`client/test/screens/Player/playerBackground.css.test.ts`**

A small source-assertion suite, because jsdom cannot compute these styles. Read
`client/src/screens/Player/PlayerBackground.module.css` with `node:fs` and assert on its
text. This is cheap and it is the only way to pin exact filter and transform values in a
jsdom suite.

- `describe('PlayerBackground.module.css')`
  - `it('fills the layer absolutely and clips overflow')`
  - `it('uses object-fit: cover for the background')`
  - `it('scales the blurred layer above 1 to avoid the blur rim')`
  - `it('applies blur, brightness and saturate through the T020 custom properties without literal fallbacks')`
  - `it('never animates filter')` — assert no `transition` declaration mentions `filter` and
    no `@keyframes` block mentions `filter`.
  - `it('fades the incoming cover with an opacity-only keyframe animation and gives the outgoing cover none')`
  - `it('reads the fade duration from --player-transition-dur with the --slide-transition-duration fallback and contains no literal 700ms')`
  - `it('promotes the layer with will-change: transform and not filter')`
  - `it('disables the fade under prefers-reduced-motion')`
  - `it('declares no tokens (no custom property declarations)')`

**`client/test/screens/Player/Player.background.integration.test.tsx`** (fake timers)

Render the whole player with a stubbed `AppStateProvider` and a two-image playlist, stubbing
`HTMLImageElement.prototype.decode` with a controllable deferred as T030's suite does.

- `describe('background and crossfade synchronisation')`
  - `it('swaps the background in step with the foreground slide change')` — advance one full
    slide duration, resolve the decode, and assert the new `current` slide's `src` is the
    `.coverIn` element's `src` in the same committed render as the foreground swap.
  - `it('keeps the outgoing background mounted until the previous layer is released')` —
    immediately after a swap, both the outgoing and the incoming `[data-bg]` covers are
    present; once `state.previous` is cleared (`releasePrevious`, or T030's 1000 ms
    backstop), only the incoming one remains.
  - `it('has only foreground images in the img:not([data-bg]) count')` — at most three
    across several advances, with the background enabled.
  - `it('renders only the flat layer when fillEmptySpace is off, through several advances')`
  - `it('tracks the fill setting captured at play time')` — the player uses
    `AppState.config.fillEmptySpace`; no mid-show toggle exists in v1.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] Zero occurrences of `useTheme`, `matchMedia`, `prefers-color-scheme` or `data-theme`
      in `client/src/screens/Player/`.
- [ ] No `transition` or `@keyframes` rule anywhere in `client/src/screens/Player/` mentions
      `filter`.
- [ ] Manually verified in the **dark** theme with `fillEmptySpace` off: the bars beside a
      3:2 photograph on a 16:9 screen are pure black with no seams, no banding and no
      lighter rectangle where the image is not.
- [ ] Manually verified in the **light** theme with `fillEmptySpace` off: the bars are pure
      white.
- [ ] Manually verified with `fillEmptySpace` on: the blurred background reaches all four
      edges with **no visible rim, halo or vignette**, including with a portrait image on a
      wide screen, where the bars are widest and the rim would be most obvious.
- [ ] Verified in DevTools' Network panel that switching slides issues **no** additional
      `/api/image` request attributable to the background, and that the background element's
      request, if any, is served from the memory cache.
- [ ] Verified in DevTools' Performance panel that a slide change in blurred mode does not
      drop below 60 fps at 1080p, and that no paint is attributed to re-rasterising the blur
      mid-transition (NFR-4).
- [ ] Verified at a 320 px-wide viewport and at 3840 × 2160 that the background still covers
      fully and the rim is still absent at both extremes.
- [ ] README updated only if user-visible behaviour changed beyond what the configuration
      checkbox already describes; a README change is likely unnecessary.

## 8. Notes and gotchas

- **The 12 % scale is load-bearing.** It is the single most likely thing to be "cleaned up"
  by a later contributor who sees a magic number. The CSS comment explaining the blur-rim
  convolution must stay next to it. If the blur radius is ever increased, the scale must be
  increased too: the rule of thumb is `scale >= 1 + (3 * blurRadius) / viewportWidth`, per
  side, and 32 px against a 1920 px viewport is the case the 1.12 value was chosen for.
- **`object-fit: cover` versus `contain` in the same directory.** The foreground is
  `contain` (FR-16.3, never crop) and the background is `cover` (§9.2, always cover).
  Swapping them is a silent, convincing-looking bug: the show still "works", it just crops
  the photographs. The class names `.slide` and `.cover`, and the acceptance criterion
  forbidding `object-fit: cover` in T030's diff, exist to catch this.
- **`filter` on a large element is expensive.** A 4K blurred layer is a real cost. It is
  acceptable here only because it is rasterised **once per slide** and then composited. Any
  change that makes the filter value vary over time — including a seemingly innocuous
  `transition: all` — reintroduces per-frame rasterisation and violates NFR-4.
- **`will-change` is not free.** It reserves compositor memory. It is justified on the two
  `.cover` elements because they are the layers that benefit, and it must not be sprayed
  onto `.background`, `.flat` or the player container.
- **Safari and `filter` on `<img>`.** Older WebKit builds required `-webkit-filter`.
  Safari has supported unprefixed `filter` since version 9, which is far below the project's
  floor, so no prefix is needed. Do not add one speculatively; a duplicated prefixed
  declaration is a second place to forget to update.
- **jsdom computes none of this.** `getComputedStyle` in jsdom does not resolve custom
  properties, does not apply CSS Modules, and does not implement `filter`. That is why the
  CSS is asserted as source text (§6) and the components are asserted on class names and
  attributes. Do not write a test that expects a real computed `filter` value — it will pass
  vacuously or fail confusingly.
- **Theme changes mid-show are harmless but not covered by automated tests; verified manually.** The player has no theme
  switch, so the only way to change the theme while the player is open is an OS-level change
  with no stored override. The flat background simply repaints. Nothing needs to react in
  JavaScript, and nothing should.
- **Do not let the background influence the engine.** Its `onError` is local. The engine's
  skip-on-failure logic (NFR-5) is driven by the foreground layer, which points at the same
  URL and will fail at the same time. Two reporters for one failure would make the
  "every image failed" exit fire early.
- **`--player-transition-dur` is a shared contract** with T032, which sets it inline on the
  `.player` element and documents it in `tokens.css`. If the name drifts, the background
  silently falls back to the 700 ms token even on a `--dur-fast` manual step; the CSS source
  test in §6 pins the name.
- **Why the outgoing cover is not faded out.** Fading both covers symmetrically leaves a
  frame at 75 % coverage in which the flat `--player-bg` shows through (a white flash in the
  light theme). Keep the outgoing cover opaque.
