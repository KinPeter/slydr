# T032 — Implement Ken Burns, the crossfade and the reduced-motion override

**Epic:** E17
**Spec sections:** §9.4 (FR-16.6), §9.3, §6.4, §16.2, NFR-4, NFR-6
**Depends on:** T030, T031
**Estimated size:** L

---

## 1. Context

T030 built the player foundation: it shows one image at a time, fitted and centred, with a timestamp-based scheduler, a decode gate, and a three-layer DOM budget (`previous`, `current`, `next`). T031 added the blurred background behind the images. Neither ticket animates anything. Slides swap instantly, and `previous` lingers invisibly for a fixed 1000 ms only to keep the layer budget honest.

This ticket makes the slide show feel alive, within the strict limits the specification puts on motion:

- With **animations on**, each slide slowly zooms in (the "Ken Burns" effect) for exactly as long as it is displayed, and consecutive slides **crossfade** over 700 ms while the outgoing image drifts slightly larger and the incoming image settles from slightly smaller.
- With **animations off**, the picture is centred, fitted and completely static, and a swap is instantaneous: no fade, no zoom, no frame in which both images are visible.
- When the operating system asks for **reduced motion**, the player behaves as if animations were off, whatever the stored configuration says. The configuration checkbox keeps its stored value; only the rendering decision changes (spec §9.4). T029 owns the explanatory note on the configuration screen and created the `usePrefersReducedMotion` hook; this ticket owns the player-side decision.

Only `opacity` and `transform` may animate (NFR-4), so the compositor can run every frame without layout or paint work. The slide schedule remains JavaScript timestamp scheduling in the engine; CSS animations are decoration and must never decide when the slide changes (§6.4).

## 2. Scope

### In scope

- Ken Burns: a `transform`-only keyframe animation, `scale(1)` to `scale(1.06)`, `linear`, lasting exactly the slide duration, restarting for every slide occurrence.
- The crossfade: a double-buffered, simultaneous transition of 700 ms with `--ease-standard`. Outgoing layer `opacity 1 -> 0` with `scale 1.06 -> 1.10`; incoming layer `opacity 0 -> 1` with `scale 0.96 -> 1`.
- The animations-off path: centred, fitted, static, with no transition at all. The outgoing layer is removed in the same commit in which the incoming layer becomes visible.
- The reduced-motion override: effective animations = `config.animations && !prefersReducedMotion`, via a small `useEffectiveAnimations` hook that reuses T029's `usePrefersReducedMotion`.
- The §9.3 interactions: pause freezes Ken Burns (`animation-play-state: paused`); previous and next shorten the transition to `--dur-fast` and restart the incoming Ken Burns; the Ken Burns duration reaches CSS through the inline custom property `--kb-duration`; `animationend` and `transitionend` never advance the slide.
- Layer lifecycle: the outgoing layer unmounts on `transitionend` with a timeout safety net; the engine gains `releasePrevious(key)` and an `interrupted` flag for rapid navigation.
- Interplay with T031: the incoming background cover fades in with `opacity` only (never `filter`) over an opaque outgoing cover; both the foreground and the cover read the same `--player-transition-dur` custom property, which this ticket sets inline on the `.player` element.
- `will-change` hygiene, z-ordering of the layers, a rapid next-next-next stress rule, and a measurement procedure for 60 fps (NFR-4).
- Tests per section 6.

### Out of scope

- The engine's scheduling, play order, decode gate, preloading and failure handling (T030). This ticket makes two small, additive engine changes (section 4.4) and nothing else there.
- The blurred background's own styling (T031). This ticket only supplies it with a duration and with the correct `previous` prop.
- The overlay, its auto-hide and the keyboard shortcuts (T033, T034). A key press that calls `next()` or `previous()` is simply a manual swap for the purposes of this ticket.
- The configuration screen's controls and its reduced-motion note (T029). The hook `usePrefersReducedMotion` already exists; do not rewrite it.
- Any change to the stored configuration. The reduced-motion override never writes anything.
- Swipe gestures, per-slide custom effects, or random effect selection (excluded by the specification).
- Changing the nominal values of §16.2. They remain tunables in `tokens.css`.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo (`shared`, `server`, `client`). Everything is ESM and TypeScript strict. The client is Vite 7 and React 19, styled with CSS Modules over the tokens in `client/src/styles/tokens.css`. Tests run on Vitest with React Testing Library in `jsdom`, which has **no layout engine, no computed CSS Modules styles and no real transitions or animations**. Tests therefore assert on DOM structure, `data-*` attributes, inline styles and the source of the CSS file, never on computed visual results. The shared class-name helper is `cx` in `client/src/lib/cx.ts`.

### From T030 (`client/src/screens/Player/`)

- `types.ts` exports `SwapReason = 'initial' | 'auto' | 'manual'`, `PlayerStatus`, `PlayerSlide { key, position, cycle, item, src }`, `PlayerEngineState`, `PlayerControls` and `UsePlayerEngineResult`. `PlayerEngineState` has `status`, `current`, `previous`, `next`, `swapReason`, `durationMs`, `counter`, `isFullscreen` and `error`.
- `PlayerSlide.key` is unique per occurrence (`${cycle}:${position}`), not per file, so a loop boundary remounts the element and restarts per-slide animation. `PlayerStage` must key layers by `slide.key`, never by file path.
- `SlideImage.tsx` renders exactly one `<img>` (`alt=""`, `aria-hidden="true"`, `draggable={false}`, `decoding="async"`, no lazy loading). Its props are `slide`, `role: 'previous' | 'current' | 'next'`, `swapReason`, `durationMs`, `animations`, `onRef`, `onLoad`, `onError`. The `animations` prop is accepted and ignored. The `next` layer renders with the `slideHidden` class (opacity 0). Both `.slide` and `.slideHidden` currently live in `Player.module.css`.
- `PlayerStage.tsx` returns a fragment of `.layerBackground` (`background` slot), `.layerImages` and `.layerOverlay` and has **no root element of its own**; these three are positioned absolutely inside the `.player` element that `Player.tsx` renders, with z-indices 0, 1, 2. It mounts at most three `SlideImage` layers (NFR-3). The NFR-3 budget counts foreground images only, `img:not([data-bg])`; T031's cover images carry `data-bg="true"`.
- The engine keeps `state.previous` alive for `PREVIOUS_LAYER_LINGER_MS = 1000` after a swap, then clears it. T030 states explicitly that T032 takes over eviction through `transitionend`, replacing the timer's role while the engine's shape stays unchanged. This ticket keeps the 1000 ms timer as a last-resort backstop.
- `state.status === 'paused'` is what drives `animation-play-state: paused`. `state.swapReason` says why `current` last changed. `state.durationMs` is `config.durationSeconds * 1000`.
- Fit rules (FR-16.3): `object-fit: contain; object-position: center`. `.player` uses `height: 100vh` followed by `height: 100dvh`.
- Slide advance is timestamp scheduling in `usePlayerEngine`: a single `setTimeout` for the remaining milliseconds, with `performance.now()` timestamps (no `setInterval`, no `requestAnimationFrame`). It is not driven by animation events. The engine keeps its bookkeeping in a ref and mirrors what the UI renders into `useState`; there is no reducer.
- T030 states that a backward move always mounts and decodes its target and never reuses the lingering `previous` layer.
- `SlideImage` carries `data-testid="slide-current"` on the `<img>` of the `current` layer (required by T038); this ticket keeps it (section 4.3).

### From T031

- `PlayerBackground` takes `{ fillEmptySpace, current, previous }`. In blurred mode it renders up to two `.cover` elements (`data-bg="true"`) keyed by `slide.key`: `.coverOut` for `previous` and `.coverIn` for `current`. Only `.coverIn` animates: a CSS `@keyframes coverFadeIn` (`opacity` 0 → 1 only) with `animation-duration: var(--player-transition-dur, var(--slide-transition-duration))`; the outgoing cover stays opaque underneath until it is unmounted, so the flat layer never shows through mid-fade. There is no JavaScript in that fade. Each `.cover` keeps a static `filter` and a static `transform: scale(var(--player-bg-scale))` and has `will-change: transform`.
- T031 uses `--player-transition-dur` as the contract name for "duration of the current swap" and leaves its definition to this ticket (section 4.6). It uses only tokens T020 already defines; no `--player-crossfade-dur` exists.
- The flat background (`fillEmptySpace` off) has no animation at all.

### From T029

- `client/src/lib/usePrefersReducedMotion.ts` exports `usePrefersReducedMotion(): boolean`, built on `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`. It returns `false` when `matchMedia` is missing (as in `jsdom`) and updates live on the media query's `change` event.
- The reduced-motion override never writes to `slydr.config`.

### Tokens that exist (T020, authoritative)

```css
--slide-transition-duration: 700ms;
--kenburns-scale: 1.06;
--slide-out-scale-from: 1.06;
--slide-out-scale-to: 1.1;
--slide-in-scale-from: 0.96;
--slide-in-scale-to: 1;
--dur-fast: 120ms;  --dur-base: 200ms;  --dur-slow: 320ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--z-player-bg: 0;  --z-player-image: 1;  --z-player-controls: 2;
--player-bg: ...;   /* solid fallback colour behind everything */
```

Use these exact names. Do not introduce second copies of 700 ms, 1.06, 1.10 or 0.96 in any CSS file or in `tokens.css`. The single, documented exception is the TypeScript constant `FADE_FALLBACK_MS` in `motion.ts` (section 4.2), which exists only for environments that cannot compute styles (jsdom, detached elements); nothing else in TypeScript may contain these numbers.

### Browser facts this ticket depends on

- Transitions only start when an element has a **before-change style**: a style computed in an earlier style recalculation. An element that is mounted directly in its final state does not transition. Section 4.3 relies on this.
- `transitionend` fires once per transitioned property that completes, bubbles, and does **not** fire for a transition that was cancelled or never ran (for example in a background tab, or when the property does not change). A timeout safety net is therefore mandatory.
- `animation-play-state: paused` freezes a running CSS animation at its current position; resuming continues from there.
- A CSS animation keeps running when only the class of the element changes, as long as `animation-name` stays the same. Section 4.3 depends on this for the outgoing layer.
- `opacity` and `transform` changes can be handled entirely by the compositor when the element is its own layer. `filter`, `width`, `height`, `top`, `left`, `margin` and `box-shadow` cannot.

## 4. Implementation detail

### 4.1 Files

Create:

```
client/src/screens/Player/
  motion.ts                      pure helpers: transitionDuration(), fadeFallbackMs(), constants
  useEffectiveAnimations.ts      config.animations && !prefersReducedMotion
  SlideImage.module.css          layer, image, roles, keyframes, will-change rules
client/test/helpers/
  transitionEvents.ts            fireTransitionEnd(el, 'opacity'), fireAnimationEnd(el)
```

Modify:

```
client/src/screens/Player/types.ts             + PlayerEngineState.interrupted, + UsePlayerEngineResult.releasePrevious
client/src/screens/Player/usePlayerEngine.ts   interrupted flag, releasePrevious(), previous cleared on interrupt
client/src/screens/Player/SlideImage.tsx       wrapper element, data attributes (incl. data-testid on the current <img>), phase handling, safety net
client/src/screens/Player/PlayerStage.tsx      effective animations, previous filtering (still no root element)
client/src/screens/Player/Player.tsx           wires useEffectiveAnimations and releasePrevious, sets the two inline custom properties on .player, passes previous to PlayerBackground
client/src/screens/Player/Player.module.css    remove .slide and .slideHidden (moved to SlideImage.module.css)
client/src/styles/tokens.css                   + a comment documenting the --player-transition-dur contract (no new token)
```

### 4.2 Effective animations — `useEffectiveAnimations.ts` and `motion.ts`

```ts
// useEffectiveAnimations.ts
import type { SlideshowConfig } from '@slydr/shared';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';

export interface EffectiveAnimations {
  /** True when Ken Burns and the crossfade should run. */
  animations: boolean;
  /** True when the OS asked for reduced motion (informational; tests use it). */
  reducedMotion: boolean;
}

export function useEffectiveAnimations(config: Pick<SlideshowConfig, 'animations'>): EffectiveAnimations {
  const reducedMotion = usePrefersReducedMotion();
  return { animations: config.animations && !reducedMotion, reducedMotion };
}
```

Rules:

- This is the only place where the two inputs are combined. `PlayerStage`, `SlideImage` and `Player` receive the resulting boolean; none of them read `config.animations` directly. Reduced motion therefore beats the configuration at one point, and cannot be forgotten at another.
- It is a rendering decision. The hook has no effects, writes nothing and never touches `config`.
- It is live. If the user changes the OS setting while a show is running, the next render picks up the new value. Section 4.5 explains why a mid-transition flip is safe.

`motion.ts` holds the pure helpers so they can be unit-tested without React:

```ts
import type { SwapReason } from './types';

/** Extra time past the computed transition duration before the safety net fires. */
export const FADE_SAFETY_MARGIN_MS = 150;
/**
 * Used only when the computed duration cannot be read (jsdom, detached element). It mirrors
 * --slide-transition-duration (700 ms) and is the one allowed copy of that number in
 * TypeScript; the stylesheet token stays the source of truth.
 */
export const FADE_FALLBACK_MS = 700;

export interface TransitionInput {
  animations: boolean;       // effective animations, after reduced motion
  swapReason: SwapReason;
  interrupted: boolean;      // a swap happened while the previous swap's fade was still running
}

/**
 * The value written to --player-transition-dur on the `.player` element (a common ancestor
 * of the background and image layers). Read by the foreground wrapper
 * (SlideImage.module.css) and by T031's incoming cover.
 *
 * Deliberate deviations from the plain reading of spec §9.3 (the spec is amended to match):
 * the first slide appears without a fade, and a swap that interrupts a running fade is a cut.
 */
export function transitionDuration({ animations, swapReason, interrupted }: TransitionInput): string {
  if (!animations) return '0ms';
  if (swapReason === 'initial') return '0ms';          // first slide: appears, Ken Burns starts
  if (interrupted) return '0ms';                        // collapse: cut, do not stack fades
  if (swapReason === 'manual') return 'var(--dur-fast)';
  return 'var(--slide-transition-duration)';
}

/** Parse the first value of a computed `transition-duration` ("0.7s", "700ms") to ms. */
export function parseFirstDurationMs(value: string): number | null { /* returns null when unparsable */ }

/** Safety-net delay for a fading layer: computed duration + margin, or the fallback. */
export function fadeFallbackMs(el: Element | null): number { /* uses getComputedStyle(el).transitionDuration */ }
```

`parseFirstDurationMs` takes the text before the first comma, trims it, and accepts `<number>s` or `<number>ms`; anything else returns `null`. `fadeFallbackMs` returns `parsed + FADE_SAFETY_MARGIN_MS`, or `FADE_FALLBACK_MS + FADE_SAFETY_MARGIN_MS` when `parsed` is `null` or the element is missing. Do not hard-code 120 or 700 anywhere else: the tokens remain the single source of truth and the safety net reads whatever the stylesheet resolved.

### 4.3 The layer: structure, roles and keyframes — `SlideImage.tsx` and `SlideImage.module.css`

**Why two elements per layer.** Ken Burns animates the picture itself; the crossfade animates the layer as a whole. If both wrote `transform` on the same element, one would overwrite the other. Each layer is therefore a wrapper that carries the crossfade (`opacity` and `transform`) and an inner `<img>` that carries Ken Burns (`transform`). The visible scale is the product of the two, which is exactly what makes the outgoing drift continuous with the Ken Burns end state (see "Composition" below). T030's rule of exactly one `<img>` per layer still holds; the wrapper is a `div`.

```tsx
export interface SlideImageProps {
  slide: PlayerSlide;
  role: 'previous' | 'current' | 'next';
  swapReason: SwapReason;
  durationMs: number;
  /** Effective animations (config AND NOT reduced motion). Already combined by the caller. */
  animations: boolean;
  /** True while the engine status is 'paused'. */
  paused: boolean;
  onRef(el: HTMLImageElement | null): void;
  onLoad(): void;
  onError(): void;
  /** Called once when this layer, as `previous`, has finished fading out (or the safety net fired). */
  onFadeComplete(): void;
}
```

Rendered structure:

```tsx
<div
  ref={layerRef}
  className={cx(styles.layer, styles[role])}
  data-role={role}
  data-motion={animations ? 'animated' : 'static'}
  data-phase={phase}                 // 'enter' | 'run' | 'rest', see below
  onTransitionEnd={handleTransitionEnd}
>
  <img
    ref={onRef}
    className={styles.img}
    src={slide.src}
    alt=""
    aria-hidden="true"
    draggable={false}
    decoding="async"
    data-testid={role === 'current' ? 'slide-current' : undefined}
    style={{ animationPlayState: paused ? 'paused' : 'running' }}
    onLoad={onLoad}
    onError={onError}
  />
</div>
```

- **`data-testid="slide-current"` stays on the `<img>`** (not the wrapper) of the layer whose `role` is `current`, exactly as T030 §4.13 requires and T038 relies on (`getByTestId('slide-current')` reads its `src`). `next` and `previous` layers carry no test id, and neither does any background cover. No other `data-testid` is added.
- `data-role`, `data-motion` and `data-phase` exist for tests and for debugging; the CSS reads them too. Tests never look at CSS Module class names.
- The inline `animationPlayState` is deliberate. `jsdom` cannot compute CSS Modules, so an inline style is the only way to assert that pausing sets `animation-play-state: paused` (spec §9.3). Changing a running animation's play state does not restart it.
- The wrapper receives the same `slide.key` key from `PlayerStage` as before. The `<img>` never gets its own key.
- `animationEnd` and `onAnimationEnd` are never attached. Ken Burns finishing at `scale(1.06)` is a visual state, not an event the engine listens to.

**Phases** (local `useState` in `SlideImage`):

| `data-phase` | Meaning |
|---|---|
| `enter` | The layer mounted already as `current` and a fade is wanted. It is drawn in the "next" visual state (opacity 0, scale 0.96) for one style recalculation so the transition has a before-change style. |
| `run` | The layer is `current` and transitioning in, or is `previous` and transitioning out. `will-change` is applied. |
| `rest` | Settled: no transition running; `will-change` is dropped from the wrapper. |

Initial phase: `'enter'` when `role === 'current' && animations && swapReason !== 'initial' && !interruptedOrCut`, otherwise `'rest'`. For the common forward path the layer was mounted earlier as `next`, so it already has a before-change style: it starts in `rest`, becomes `current`, and the transition runs without needing `enter` (a role change from `next` to `current` is a class change on an existing element). The `enter` phase exists for the cases where the layer is mounted directly as `current`: `previous()` navigation, and any forward step where the `next` slot was not yet filled.

Leaving `enter`:

```tsx
useLayoutEffect(() => {
  if (phase !== 'enter') return;
  void layerRef.current?.getBoundingClientRect();   // force a style flush: records the before-change style
  setPhase('run');
}, [phase]);
```

The state update inside `useLayoutEffect` re-renders synchronously before the browser paints, so the user never sees the intermediate frame, yet the forced style flush guarantees that the `enter` to `run` class change is observed as a transition. Do not use a double `requestAnimationFrame` for this; it costs two frames of latency on every manual key press.

Entering `run`/`rest`: `phase` becomes `'run'` whenever `role` changes to `current` or `previous` with `animations` on, and `'rest'` on `handleTransitionEnd` (for `current`), on the safety net, or immediately when `animations` is off.

```css
/* SlideImage.module.css */

.layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* Crossfade state for animated motion is set below; static motion never uses it. */
}

.img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;        /* FR-16.3: always fit, never crop */
  object-position: center;
  -webkit-user-drag: none;
  user-select: none;
  -webkit-user-select: none;
}

/* ---------- Static motion (animations off, or reduced motion) ---------- */
.layer[data-motion='static'] { transition: none; transform: none; }
.layer[data-motion='static'] .img { animation: none; transform: none; will-change: auto; }
.layer[data-motion='static'].next { opacity: 0; }
.layer[data-motion='static'].current { opacity: 1; }
.layer[data-motion='static'].previous { opacity: 0; }     /* never rendered, see 4.7; belt and braces */

/* ---------- Animated motion ---------- */
.layer[data-motion='animated'] {
  transition:
    opacity   var(--player-transition-dur, var(--slide-transition-duration)) var(--ease-standard),
    transform var(--player-transition-dur, var(--slide-transition-duration)) var(--ease-standard);
}

/* Role states. The wrapper's transform is a RATIO, see "Composition". */
.layer[data-motion='animated'].next {
  opacity: 0;
  transform: scale(var(--slide-in-scale-from));            /* 0.96 */
  z-index: 0;
}
.layer[data-motion='animated'].current {
  opacity: 1;
  transform: scale(var(--slide-in-scale-to));              /* 1 */
  z-index: 2;
}
.layer[data-motion='animated'].previous {
  opacity: 0;
  transform: scale(calc(var(--slide-out-scale-to) / var(--slide-out-scale-from)));   /* 1.10 / 1.06 */
  z-index: 1;
}
/* Mounted directly as current: draw as "next" for one style recalculation. */
.layer[data-motion='animated'][data-phase='enter'] {
  opacity: 0;
  transform: scale(var(--slide-in-scale-from));
}

/* ---------- Ken Burns ---------- */
@keyframes kenburns {
  from { transform: scale(1); }
  to   { transform: scale(var(--kenburns-scale)); }       /* 1.06 */
}

/* Same animation-name on current and previous: when a layer moves from current to
   previous the animation keeps running instead of restarting. */
.layer[data-motion='animated'].current .img,
.layer[data-motion='animated'].previous .img {
  animation: kenburns var(--kb-duration) linear forwards;
  transform-origin: center center;
}
/* The next layer is hidden and must NOT have started Ken Burns: it starts when it becomes current. */
.layer[data-motion='animated'].next .img,
.layer[data-motion='animated'][data-phase='enter'] .img {
  animation: none;
}

/* ---------- will-change hygiene ---------- */
.layer[data-motion='animated'][data-phase='run'] { will-change: opacity, transform; }
.layer[data-motion='animated'].current .img,
.layer[data-motion='animated'].previous .img { will-change: transform; }

@media (prefers-reduced-motion: reduce) {
  /* Belt and braces: useEffectiveAnimations already switches to static motion. */
  .layer, .img { transition: none !important; animation: none !important; }
}
```

**Composition (why the numbers line up).** The picture's on-screen scale is the wrapper's scale times the image's Ken Burns scale. For an outgoing slide that ran its full duration, the image sits at `1.06`. The wrapper then goes from `1` to `1.10 / 1.06 = 1.0377`, so the visible scale goes from `1.06` to `1.10`, exactly the spec's outgoing values with no jump at the start of the fade. For the incoming slide the wrapper goes `0.96 -> 1` while the image starts Ken Burns from `1`, so the visible scale is `0.96` at the first frame and settles as specified. For a slide that was cut short by a manual navigation the outgoing scale starts from wherever Ken Burns had reached, which is still continuous. *Decision (not specified):* expressing the spec's outgoing scale as a ratio on the wrapper. The alternative, putting the outgoing scale on the image and cancelling Ken Burns, would need a transition from an animated value and is fragile.

**Keyframes are verbatim as above.** Ken Burns has `from` and `to` only, `linear` timing, `forwards` fill so it holds `1.06` instead of snapping back, and it changes `transform` only. The duration is `var(--kb-duration)`, set inline on the stage container (section 4.7) to `${config.durationSeconds}s`. No fixed duration appears in the stylesheet.

**Animations off.** `data-motion='static'` removes every transition and animation, and no `transform` is set. The picture is `object-fit: contain`, centred and still. Because a static layer has no transition, the swap is a class change from `next` to `current` (or a mount), and the visible result changes in one commit.

**Do not rely on `animationend`.** Nothing in the player listens to it (section 4.5 and test `animationend never advances`).

### 4.4 Engine changes — `usePlayerEngine.ts` and `types.ts`

Two additive changes. Read the engine before editing; both are small and must not alter scheduling.

1. **`interrupted: boolean` on `PlayerEngineState`.** It is `true` when the swap that produced the current state happened while the previous swap's `state.previous` was still non-null (that is, its fade had not been released yet). T030's engine keeps its bookkeeping in a ref and publishes the UI-facing fields through `useState`; the single place where a move is committed (T030 §4.4.4 step 5) publishes `previous`, `current`, `swapReason` and now `interrupted` together in one state update. That commit becomes (shown as the published state, whichever way the update is written):

   ```ts
   const interrupted = published.previous !== null;
   publish({
     ...published,
     previous: interrupted ? null : published.current,   // collapse: never keep two fading layers
     current: incoming,
     swapReason: reason,
     interrupted,
   });
   ```

   Because T030 never reuses a lingering `previous` layer as the target of a backward move (the target is always mounted and decoded as a new layer), dropping `previous` on interruption cannot conflict with a pending move.

   `interrupted` resets to `false` on every non-interrupting swap, and starts `false`.

2. **`releasePrevious(key: string): void` on `UsePlayerEngineResult`.** It clears `state.previous` only when `state.previous?.key === key`; a stale call (for a layer that was already replaced) is ignored. It does not touch the 1000 ms linger timer; the timer remains as a last-resort backstop and, when it fires after a release, finds `previous` already `null` and does nothing.

*Decision (not specified):* the engine collapses rather than the stage, because the engine owns the single `previous` slot, the rule is then one commit step that can be unit-tested without layout, and the T031 background, which also reads `state.previous`, collapses together with the foreground without extra wiring.

### 4.5 Layer lifecycle and the safety net

**Animations on.**

1. A swap makes the old `current` the `previous` layer (same React element, new `role`). Its wrapper transitions to `opacity: 0` and the drift scale; its image keeps its running Ken Burns.
2. The incoming layer transitions to `opacity: 1`, scale `1`, and its image starts Ken Burns for the first time.
3. When the outgoing wrapper's `opacity` transition ends, the layer reports completion once:

   ```tsx
   function handleTransitionEnd(e: React.TransitionEvent<HTMLDivElement>) {
     if (e.target !== e.currentTarget || e.propertyName !== 'opacity') return;
     if (role === 'previous') finishFade();
     else if (role === 'current') setPhase('rest');
   }
   ```

   `finishFade` calls `onFadeComplete()` at most once per mount (guard with a ref) and clears the safety-net timer. `PlayerStage` forwards it as `() => releasePrevious(slide.key)`.
4. **Safety net.** When a layer becomes `previous` with animations on, start `setTimeout(finishFade, fadeFallbackMs(layerRef.current))` in an effect and clear it in the cleanup. This covers a throttled background tab, a transition that never ran because the property did not change, and any cancelled transition. The timer reads the computed `transition-duration`, so retuning the token retunes the net.
5. `PlayerStage` renders no `previous` layer once `releasePrevious` has cleared it, so the layer count falls back to two (`current`, `next`).

**Animations off.**

- `PlayerStage` does not render a `previous` layer at all (section 4.7) and `Player` passes `previous={null}` to the background. The incoming layer becomes visible in the same commit in which the outgoing layer is absent, so no frame shows both.
- A `useLayoutEffect` in `Player` calls `releasePrevious(state.previous.key)` whenever `animations` is false and `state.previous` is non-null, so the engine does not keep an invisible layer for 1000 ms. The layout effect runs before paint.

**Flipping during a fade.** If effective animations change while a fade is running (the user toggles the OS setting), the next render re-evaluates both the filter and the layout effect: the outgoing layer vanishes and is released in the same commit. This is a cut, which is what reduced motion asks for.

**`animationend` and `transitionend` never advance a slide.** Slide advancement is the engine's timestamp scheduling (section 6.4 of the specification). A paused Ken Burns, a throttled tab or a missed event would otherwise desynchronise the show. These events are used here only to release a layer that has already finished fading.

### 4.6 Tokens — `client/src/styles/tokens.css`

Add **no token**; there is no `--player-crossfade-dur` alias (`--slide-transition-duration` from T020 is the only crossfade token). Add only a comment under `:root` next to the existing player properties, so nobody invents a second name:

```css
:root {
  /* Contract: duration of the CURRENT swap, in the property's own units.
     Set inline on the .player element by Player.tsx; read by SlideImage.module.css and
     PlayerBackground.module.css (the incoming cover's fade-in).
       0ms                 animations off, reduced motion, first slide, interrupted swap
       var(--dur-fast)     manual previous/next
       var(--slide-transition-duration)   automatic advance (700ms)
     Do not declare a default here: the var() fallbacks in the stylesheets resolve to
     --slide-transition-duration when the property has not been set. */
}
```

Do not add `--kb-duration` to `tokens.css`. It depends on the user's configuration and is always set inline on the `.player` element.

### 4.7 Wiring — `PlayerStage.tsx` and `Player.tsx`

`Player.tsx`:

```tsx
const { animations } = useEffectiveAnimations(config);
const engine = usePlayerEngine({ playlist, config, onExit });

useLayoutEffect(() => {
  if (!animations && engine.state.previous) engine.releasePrevious(engine.state.previous.key);
}, [animations, engine.state.previous, engine.releasePrevious]);

<PlayerStage
  state={engine.state}
  animations={animations}
  releasePrevious={engine.releasePrevious}
  background={
    <PlayerBackground
      fillEmptySpace={config.fillEmptySpace}
      current={engine.state.current}
      previous={animations ? engine.state.previous : null}
    />
  }
  ...
/>
```

`PlayerStage` adds the props `animations: boolean` and `releasePrevious(key: string): void` (keep the existing ones). It still returns a fragment and has no root element. `Player.tsx` sets the two inline custom properties on the `.player` element, which is the common ancestor of `.layerBackground` and `.layerImages`:

```tsx
const style = {
  '--kb-duration': `${config.durationSeconds}s`,
  '--player-transition-dur': transitionDuration({
    animations,
    swapReason: engine.state.swapReason,
    interrupted: engine.state.interrupted,
  }),
} as React.CSSProperties;
// <div className={styles.player} style={style} data-testid="player" …>
```

- `--kb-duration` uses `config.durationSeconds`, so with a 7 s duration it is `7s` and Ken Burns lasts exactly one slide. It is never derived from the transition time and never contains a fixed number.
- The property lives on `.player`, a common ancestor of the background and the images, because T031's incoming cover and `SlideImage` both read `--player-transition-dur`.
- Layer list: `[state.previous (only when animations), state.current, state.next]`, each rendered once, keyed by `slide.key`, each with `role` given by the slot it came from. When `animations` is false the `previous` slot is not rendered at all.
- Pass `paused={state.status === 'paused'}` and `onFadeComplete={() => releasePrevious(slide.key)}` to every layer; only `previous` layers use the latter.
- DOM order inside `.layerImages` is `previous`, `current`, `next`. Stacking is decided by `z-index` (section 4.9), not by order, so React reordering can never change what is on top.

### 4.8 Interplay with the T031 background

- Only the incoming background cover fades (a CSS keyframe animation of `opacity` over `--player-transition-dur`, with `--ease-standard`); the outgoing cover stays opaque underneath until released. Neither animates `filter` or `blur`. Each cover has a static `filter` and a static `transform: scale(var(--player-bg-scale))` for its entire lifetime (NFR-4). Do not add a `transition` or `animation` that mentions `filter`, `backdrop-filter`, `blur` or `brightness` anywhere in the Player CSS. A test greps for this (section 6).
- Foreground and background durations match by construction: both read `--player-transition-dur`. A manual swap shortens both to `--dur-fast`; an interrupted swap and animations-off set both to `0ms`.
- With animations off the background receives `previous={null}`. The incoming cover's animation duration is `0ms`, so it is fully visible in the same frame as the foreground.
- The cover's fade-in is T031's keyframe animation: this ticket adds no JavaScript, class toggle, second decode gate or extra timer for the background.
- Ken Burns applies to the foreground only. The blurred background stays still, which is both cheaper and calmer.

### 4.9 `will-change` hygiene and z-ordering

- `will-change` costs GPU memory per promoted layer. Rules, all enforced in `SlideImage.module.css` as shown in section 4.3:
  - Never on `.next` layers (hidden, no animation yet).
  - On the wrapper (`opacity, transform`) only while `data-phase='run'`, dropped at `rest`.
  - On the `<img>` (`transform`) only while it has a running Ken Burns (`current` or `previous` in animated motion).
  - Never in static motion.
  - Never on `.player`, `.layerImages` or `.layerBackground`.
  - Only the values `opacity` and `transform` may appear in a `will-change` declaration anywhere in the Player CSS.
- Stacking inside `.layerImages` (which is itself `position: absolute; z-index: 1`, so it creates its own stacking context): `next` is `0`, `previous` is `1`, `current` is `2`. The incoming image therefore always draws over the fading one, which is what makes the simultaneous crossfade a true dissolve. These integers are local to the stacking context and are deliberately not tokens; the three global player layers keep `--z-player-bg|image|controls` (0, 1, 2).
- The overlay (T033) remains above both, because `.layerOverlay` is `z-index: 2` in the parent context.

### 4.10 Rapid next-next-next

Manual navigation can arrive faster than a fade. The collapse rule is:

1. A manual swap while `state.previous` is still non-null sets `interrupted: true` and clears `previous` in the same state commit (section 4.4).
2. `transitionDuration` returns `0ms` for an interrupted swap, so the new `current` appears fully opaque in that frame (no fade that could expose a half-transparent layer).
3. No layer was left fading out, so the stage never holds more than `current` and `next`, plus at most one `previous` while a non-interrupted fade runs.

The consequence for users: pressing next repeatedly yields clean, fast cuts with Ken Burns restarting on each new slide, and never a flash of the empty `--player-bg` colour, because there is always one fully opaque layer. Only the first press after a quiet period gets the `--dur-fast` (120 ms) fade. *Decision (not specified):* cut on interruption instead of retargeting the running fades, because retargeting would need up to three simultaneously fading layers (breaking the DOM budget) and would visibly dip to the background colour mid-flurry.

Visible layers are therefore at most two (`previous` + `current`), and at most three foreground `<img>` elements (`img:not([data-bg])`) exist including the hidden `next` layer T030 keeps for decoding. T031's background covers (at most two, `data-bg="true"`) are not part of that count.

### 4.11 Measuring 60 fps (NFR-4)

Jank cannot be asserted in `jsdom`, so verify by hand in a Chromium browser on the slowest machine available, on a folder of at least 30 large photographs (10 MP or more).

1. Set the duration to 3 s, animations on, fill empty space on, and press Play. Let it run through three transitions.
2. Open DevTools, Performance. Enable "Screenshots", set CPU throttling to 4x slowdown, record 15 s covering at least four crossfades, then stop.
3. In the Frames lane every frame must be green and the median frame time near 16.7 ms. No frame in the crossfade or Ken Burns windows may exceed about 33 ms. Allow occasional isolated drops when a new image decodes, but none may coincide with a fade in progress, since the decode gate runs before the swap.
4. In the Main thread track, during Ken Burns and the crossfade there must be no Layout, Recalculate Style or Paint tasks. Only Composite Layers (and, at slide boundaries, the engine's single `setTimeout` callback) should appear.
5. Open Rendering, tick "Paint flashing": no green flashes may appear over the picture while it zooms or fades. Tick "Layer borders" and confirm the wrapper and image appear as their own composited layers during a fade.
6. Open the Layers panel and confirm the compositing memory does not grow across several minutes of looping (no more than three promoted image layers at once; `will-change` is dropped at rest).
7. Repeat with animations off and with the OS reduced-motion setting on: no animation work should appear at all.
8. Hold the right arrow key (when T034 is merged) or click next quickly: frames stay green and nothing flashes to the background colour.

Record the browser, machine, and median/worst frame times in the pull request description.

## 5. Acceptance criteria

- [ ] `client/src/screens/Player/` contains `motion.ts`, `useEffectiveAnimations.ts` and `SlideImage.module.css`; `.slide` and `.slideHidden` are gone from `Player.module.css`; `client/test/helpers/transitionEvents.ts` exists.
- [ ] `tokens.css` documents the `--player-transition-dur` contract in a comment and gains **no** new token (there is no `--player-crossfade-dur`); no second copy of 700 ms, 1.06, 1.10 or 0.96 exists in any CSS file outside `tokens.css`. The only TypeScript copy of 700 is `FADE_FALLBACK_MS` in `motion.ts`, documented as the jsdom/detached-element fallback.
- [ ] `--kb-duration` and `--player-transition-dur` are set as inline `style` on the `.player` element by `Player.tsx`; `PlayerStage` has no root element and sets no style.
- [ ] The `<img>` of the layer with `role="current"` carries `data-testid="slide-current"` (no other layer, no wrapper, no background cover does).
- [ ] Effective animations equal `config.animations && !prefersReducedMotion`. With reduced motion on and `config.animations === true`, the player renders static motion, and `slydr.config` and `AppState.config` are not modified.
- [ ] With animations off, every layer has `data-motion="static"`, no `previous` layer is rendered, the incoming layer is `current` in the same render in which the outgoing layer is absent, and `--player-transition-dur` is `0ms`.
- [ ] With animations off the picture is centred and fitted (`object-fit: contain`), has no `transform`, and has no `transition` or `animation` anywhere in its CSS path.
- [ ] With animations on, a layer is a wrapper `div` containing exactly one `<img>`; the wrapper carries `data-role` and `data-motion="animated"`.
- [ ] Ken Burns is `@keyframes kenburns { from { transform: scale(1) } to { transform: scale(var(--kenburns-scale)) } }`, `linear`, `forwards`, duration `var(--kb-duration)`, applied to the image of `current` and `previous` layers only, never to `next`.
- [ ] `--kb-duration` is set inline and equals `${config.durationSeconds}s` (for example `7s` for 7 seconds).
- [ ] The crossfade uses CSS transitions on the wrapper: outgoing `opacity 1 -> 0` with scale `1.10 / 1.06`; incoming `opacity 0 -> 1` with scale `0.96 -> 1`; both simultaneous, using `var(--player-transition-dur)` and `var(--ease-standard)`.
- [ ] Only `opacity` and `transform` appear in any `transition` or `@keyframes` in the Player CSS; `filter`, `backdrop-filter`, `width`, `height`, `top`, `left`, `margin` and `box-shadow` do not.
- [ ] Automatic swaps use `var(--slide-transition-duration)`; manual swaps use `var(--dur-fast)`; the first slide and interrupted swaps use `0ms`.
- [ ] A manual previous or next restarts the incoming slide's Ken Burns from `scale(1)`.
- [ ] While paused, every layer image has inline `animation-play-state: paused`; on resume it is `running` and the animation continues from where it stopped.
- [ ] The outgoing layer unmounts on the wrapper's `opacity` `transitionend` (target equal to currentTarget); a timeout safety net based on the computed duration releases it if the event never arrives; `releasePrevious` is called at most once per layer.
- [ ] A swap while `state.previous` is non-null sets `interrupted: true`, drops `previous` and produces a `0ms` swap; after any burst of swaps there are at most two visible layers and at most three foreground `<img>` elements (`img:not([data-bg])`).
- [ ] `animationend` and `transitionend` never change `state.current`, never call `next()` and never alter the schedule; no `onAnimationEnd` or `animationend` listener exists in `client/src/screens/Player/`.
- [ ] `will-change` appears only with the values `opacity` and `transform`, never on `.next`, never in static motion, never on the player containers; the wrapper loses it at `data-phase="rest"`.
- [ ] z-order inside the image container is `next` 0, `previous` 1, `current` 2; the overlay stays above the image container.
- [ ] The background receives `previous={null}` when animations are off; its covers never animate or transition `filter`.
- [ ] Spec §9.3/§9.4 are amended (by the ticket-set owner) to state that the first slide appears without a fade and that a swap interrupting a running fade is a cut.
- [ ] The measurement procedure of section 4.11 was run and its results are recorded in the pull request.

## 6. Tests to write

Vitest and React Testing Library in `jsdom`. Build `PlayerSlide` fixtures with a small factory `makeSlide(position, cycle = 0)` returning `{ key: `${cycle}:${position}`, position, cycle, item, src }`. Build engine states with `makeState(overrides)`. Install the shared `matchMedia` stub from T021 (`client/test/helpers/matchMedia.ts`, `setMatches(query, boolean)`), whose match result and `change` listeners the test controls; do not create another stub. `jsdom` has no `TransitionEvent`, so use the helper in `client/test/helpers/transitionEvents.ts`:

```ts
export function fireTransitionEnd(el: Element, propertyName = 'opacity'): void {
  const ev = new Event('transitionend', { bubbles: true });
  Object.defineProperty(ev, 'propertyName', { value: propertyName });
  act(() => { el.dispatchEvent(ev); });
}
export function fireAnimationEnd(el: Element): void { /* same pattern with 'animationend' */ }
```

Never assert on CSS Module class names or on computed style. Assert on `data-role`, `data-motion`, `data-phase`, inline styles, DOM counts and the text of the CSS file.

**`client/test/screens/Player/motion.test.ts`**

- `describe('transitionDuration')`
  - `it('returns 0ms when animations are off, for every swap reason')`
  - `it('returns 0ms for the initial swap')`
  - `it('returns 0ms for an interrupted swap')`
  - `it('returns var(--dur-fast) for a manual swap')`
  - `it('returns var(--slide-transition-duration) for an automatic swap')`
  - `it('prefers off over manual and interrupted')`
- `describe('parseFirstDurationMs')`
  - `it('parses seconds and milliseconds')`
  - `it('uses only the first value of a comma-separated list')`
  - `it('returns null for empty or unparsable text')`
- `describe('fadeFallbackMs')`
  - `it('adds the safety margin to the computed duration')`
  - `it('falls back to 700 ms plus the margin when the duration cannot be read')`
  - `it('falls back for a null element')`

**`client/test/screens/Player/useEffectiveAnimations.test.tsx`**

- `describe('useEffectiveAnimations')`
  - `it('is true when animations are configured and reduced motion is off')`
  - `it('is false when animations are configured but reduced motion is on')`
  - `it('is false when animations are off, whatever the media query says')`
  - `it('reports reducedMotion separately from the result')`
  - `it('updates when the media query changes while mounted')`
  - `it('does not modify the config object it receives')`

**`client/test/screens/Player/PlayerStage.animationsOff.test.tsx`**

- `describe('PlayerStage with animations off')`
  - `it('renders every layer with data-motion static')`
  - `it('renders no previous layer even when the state has one')`
  - `it('swaps in the same render: the new current is present and the old current is gone')`
  - `it('keeps the hidden next layer in the DOM')`
  - `it('renders exactly one img per layer')`
  - `it('puts data-testid="slide-current" only on the img of the current layer')`
  - `it('returns a fragment: no wrapper element is added around the three layer slots')`

**`client/test/screens/Player/PlayerStage.animationsOn.test.tsx`**

- `describe('PlayerStage with animations on')`
  - `it('renders previous, current and next layers with matching data-role')`
  - `it('keeps data-testid="slide-current" on the current layer only as roles change')`

**`client/test/screens/Player/Player.customProperties.test.tsx`** (render `Player` with a stubbed engine state; the properties are inline style on the `.player` element, `data-testid="player"`)

- `describe('Player inline custom properties')`
  - `it('sets --player-transition-dur to 0ms when animations are off')`
  - `it('sets --kb-duration to the configured seconds (3, 7 and 30)')`
  - `it('sets --player-transition-dur to var(--slide-transition-duration) for an automatic swap')`
  - `it('sets --player-transition-dur to var(--dur-fast) for a manual swap')`
  - `it('sets --player-transition-dur to 0ms for the initial swap and for an interrupted swap')`

**`client/test/screens/Player/PlayerStage.layers.test.tsx`**

- `describe('PlayerStage layers')`
  - `it('keys layers by slide key so a looped file remounts its layer')`
  - `it('does not start Ken Burns on the hidden next layer')` (assert the layer has `data-role="next"`; the CSS test below asserts the rule)
  - `it('keeps the same layer element when it moves from next to current')`
  - `it('keeps the same layer element when it moves from current to previous')`

**`client/test/screens/Player/reducedMotion.test.tsx`**

- `describe('Player with reduced motion')`
  - `it('renders static motion when config.animations is true and the OS requests reduced motion')`
  - `it('keeps config.animations true in the application state')`
  - `it('does not write slydr.config')`
  - `it('switches to animated motion when the OS setting turns off')`
  - `it('releases a fading previous layer in the same commit when reduced motion turns on')`
  - `it('passes previous null to the background when animations are off')`

**`client/test/screens/Player/pause.test.tsx`**

- `describe('pausing')`
  - `it('sets animation-play-state paused on every layer image while status is paused')`
  - `it('sets animation-play-state running again on resume')`
  - `it('does not remount layers when pausing or resuming')`

**`client/test/screens/Player/layerLifecycle.test.tsx`** (fake timers)

- `describe('outgoing layer lifecycle')`
  - `it('calls releasePrevious with the layer key when the opacity transition ends')`
  - `it('ignores transitionend for other properties')`
  - `it('ignores transitionend that bubbled from a descendant')`
  - `it('calls releasePrevious from the safety net when no transitionend arrives')`
  - `it('calls releasePrevious at most once when both the event and the safety net fire')`
  - `it('does not start the safety net for current or next layers')`
  - `it('clears the safety net when the layer unmounts')`
  - `it('moves a current layer to the rest phase on its opacity transitionend')`
  - `it('starts a layer mounted directly as current in the enter phase and moves to run before paint')`

**`client/test/screens/Player/engine.interrupted.test.tsx`**

- `describe('usePlayerEngine animation seams')`
  - `it('sets interrupted false for a swap with no previous layer')`
  - `it('sets interrupted true and drops previous when a swap happens while previous is set')`
  - `it('resets interrupted on the next non-interrupted swap')`
  - `it('releasePrevious clears the matching previous layer')`
  - `it('releasePrevious ignores a key that is no longer previous')`
  - `it('does not change when the next slide is scheduled')`
  - `it('keeps the 1000 ms linger timer as a backstop and tolerates it firing after a release')`

**`client/test/screens/Player/rapidNavigation.test.tsx`**

- `describe('rapid navigation')`
  - `it('keeps at most two visible layers after ten consecutive next swaps')`
  - `it('keeps at most three foreground img elements (img:not([data-bg])) including the hidden next layer, with the background enabled')`
  - `it('uses 0ms for every swap after the first when swaps are interrupted')`
  - `it('always keeps the current layer in the DOM during a burst')`
  - `it('restores a var(--dur-fast) fade for the first swap after the burst has been released')`
  - `it('renders the same structure for ten previous swaps in a row')`

**`client/test/screens/Player/noAnimationEndDriving.test.tsx`**

- `describe('animation events never drive the schedule')`
  - `it('does not change the current slide when animationend is dispatched on a layer image')`
  - `it('does not change the current slide when transitionend is dispatched on a current layer')`
  - `it('contains no animationend listener in any Player source file')` (read `client/src/screens/Player/**/*.ts*` with `node:fs`, excluding tests, and assert no match for `animationend` or `onAnimationEnd`)

**`client/test/screens/Player/slideImage.css.test.ts`** (reads the CSS text with `node:fs`; keeps the rules of NFR-4 from regressing)

- `describe('SlideImage.module.css')`
  - `it('defines the kenburns keyframes from scale(1) to scale(var(--kenburns-scale))')`
  - `it('uses linear timing and var(--kb-duration) for the Ken Burns animation')`
  - `it('animates only transform in keyframes and only opacity and transform in transitions')`
  - `it('reads the transition duration from --player-transition-dur and the easing from --ease-standard')`
  - `it('uses the T020 scale tokens and no literal 1.06, 1.1 or 0.96')`
  - `it('contains no filter, backdrop-filter, width, height, top, left, margin or box-shadow inside a transition or keyframes')`
  - `it('uses only opacity and transform as will-change values')`
  - `it('does not set will-change on the next role')`
  - `it('orders the roles next 0, previous 1, current 2')`
  - `it('contains a prefers-reduced-motion block that disables transition and animation')`
- `describe('Player CSS and T031')`
  - `it('does not mention filter in any transition or keyframe of PlayerBackground.module.css')`
  - `it('PlayerBackground.module.css reads --player-transition-dur and contains no literal 700ms')`
  - `it('tokens.css contains no --player-crossfade-dur')`

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit and component tests; `npm test` green.
- [ ] Section 4.11 measurement procedure performed in Chrome; results recorded.
- [ ] Verified by eye in Chrome, Firefox and Safari (or WebKit): Ken Burns is smooth and ends exactly when the slide ends; the crossfade shows no flash and no jump at its start or end; the blurred background's incoming cover fades in with the foreground and the flat background colour never shows through mid-fade (check in the light theme with fill empty space on).
- [ ] Verified with animations off: the picture is centred, fitted and static, and a swap shows no dissolve.
- [ ] Verified with the OS reduced-motion setting on and with `animations` checked on the configuration screen: the show plays without animation, the checkbox is still checked and the note is shown (T029); turning the OS setting off mid-show restores the animations on the next swap.
- [ ] Verified pause: Ken Burns freezes at once and continues on resume; the slide changes at the expected moment after resuming.
- [ ] Verified rapid next and previous presses (with T034 or the on-screen controls of T033): no flash of the empty background, no growth in the number of foreground `<img>` elements, `img:not([data-bg])` (inspect the DOM).
- [ ] The README documents the "Use animations and transitions" option and the reduced-motion behaviour only if it does not already do so.

## 8. Notes and gotchas

- **Ticket numbering.** The player animations are T032 per `tasks/README.md`. Some comments in T020 use older numbers; follow the README.
- **Where Ken Burns and the crossfade live.** Do not move Ken Burns onto the wrapper or the crossfade onto the image. Two sources writing `transform` on one element overwrite each other, and the composition arithmetic of section 4.3 only holds with two elements.
- **Transitions need a before-change style.** A layer mounted straight into its final state does not animate. That is the reason for the `enter` phase. If a fade seems to be missing only on `previous()` navigation, check that the `getBoundingClientRect()` flush still runs before `setPhase('run')`.
- **The Ken Burns animation must not restart when a layer becomes `previous`.** Both roles share the same `animation-name`, so the browser keeps the running animation. Changing the name, or putting the animation on only one role's selector, restarts the zoom and the outgoing picture jumps back to `scale(1)`.
- **`animation-fill-mode: forwards` holds the last frame.** Without it the zoom snaps back to `scale(1)` when the animation ends, which is visible if the slide runs a few milliseconds longer than the animation (the timestamp scheduler can fire late).
- **The animation and the schedule are independent.** They share a duration, not a clock. A late scheduler tick leaves a picture frozen at `1.06` for a moment, which is invisible. Do not try to make them agree by listening to `animationend`.
- **Pausing interacts with a fade in progress.** Transitions are not paused. A fade that began before the pause completes; the engine's `previous` is released normally. Only Ken Burns freezes.
- **Do not animate the blurred background.** The blur is expensive. Fading two already-rasterised covers is a compositor opacity blend; transitioning the `filter` would repaint every frame (NFR-4).
- **`will-change` is not free.** Each promoted layer holds a full-resolution texture. Drop it at rest, keep it off hidden layers and keep to the two values `opacity` and `transform`.
- **A custom property can hold `var()`.** `--player-transition-dur` is set inline to `var(--dur-fast)` or `var(--slide-transition-duration)`; it resolves where it is used. Do not replace these with literals in TypeScript.
- **`transitionend` is not guaranteed.** Background tabs, a layer whose style did not actually change, and cancelled transitions all skip it. The safety net is a requirement, not an optimisation.
- **Reduced motion is a rendering decision.** Do not write to storage, do not uncheck the box, and do not change `config.animations`. T029 shows the note.
- **First slide.** It appears immediately (`0ms`) and Ken Burns starts. Fading it in from the background colour is a possible later refinement.
- **Looping a one-image playlist.** The key is per occurrence, so the same file remounts on each cycle and restarts Ken Burns. This is intended.
- **Performance budgets are per image size.** Very large images (50 MP) can drop frames while decoding even with a perfect CSS path; the decode gate in T030 exists to keep that off the animation window. If frames drop during a fade, measure whether the swap waited for decode before changing the CSS.

