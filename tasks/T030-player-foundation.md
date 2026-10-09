# T030 — Build the player foundation: modes, fitting, playlist and scheduler

**Epic:** E15 — Player foundation
**Spec sections:** §9.1, §9.3, §6.1, §12.3, NFR-3, NFR-5
**Depends on:** T015, T025, T029
**Estimated size:** L

---

## 1. Context

Slydr is a locally running, browser-based application that plays slide shows of images
stored in folders on the user's own computer. It has three screens: a file explorer, a
slide-show configuration screen, and the slide-show player. This ticket builds the player's
foundation — the screen that actually shows the pictures.

Concretely, this ticket delivers the player container and its two presentation modes
(native fullscreen or a fill-window overlay), the aspect-preserving image fitting, the
play-order construction including shuffling, the timestamp-based slide scheduler, the
preload-and-decode pipeline that guarantees no blank frames, looping, pause, manual
previous/next, automatic skipping of unreadable images, the screen wake lock, and the exit
path back to the configuration screen.

It deliberately stops short of the visual polish. The blurred or flat background layers,
the Ken Burns zoom and crossfade, the floating controls overlay and the keyboard shortcuts
are four separate tickets that plug into the component seams defined here. Those seams are
part of this ticket's deliverable and are specified in §4.11 below, so the follow-up work
needs no refactor of anything built here.

## 2. Scope

### In scope

- `client/src/screens/Player/Player.tsx` — the player screen component, mounted by
  `App.tsx` when `AppState.view === 'player'`.
- `client/src/screens/Player/Player.module.css` — the fill-window layer, the three stacked
  layer slots, and the `object-fit: contain` image fitting.
- `client/src/screens/Player/types.ts` — the public seam types (`PlayerSlide`,
  `PlayerEngineState`, `PlayerControls`, `SwapReason`) consumed by T031, T032, T033 and
  T034.
- `client/src/screens/Player/playOrder.ts` — pure play-order construction: identity order,
  Fisher–Yates shuffle using `crypto.getRandomValues`, and the reshuffle that guarantees the
  new cycle does not begin with the image the previous cycle ended on.
- `client/src/screens/Player/usePlayerEngine.ts` — the playback engine: timestamp-based
  scheduling, decode gating, advance/retreat, pause/resume, looping, failure skipping and
  exit.
- `client/src/screens/Player/usePreloader.ts` — off-DOM prefetch and background decode of
  the entry two places ahead in play order, with a bounded cache.
- `client/src/screens/Player/useWakeLock.ts` — `navigator.wakeLock` acquisition and
  release, including re-acquisition after the document becomes visible again.
- `client/src/screens/Player/fullscreen.ts` — prefix-tolerant fullscreen helpers
  (`getFullscreenElement`, `isFullscreen`, `exitFullscreenSafe`, `isFullscreenSupported`,
  `FULLSCREEN_CHANGE_EVENTS`) plus a re-export of `requestFullscreenSync`, which T029 already
  created in `client/src/lib/fullscreen.ts`.
- `client/src/screens/Player/SlideImage.tsx` — one image layer; a single `<img>` plus the
  ref the engine awaits `decode()` on.
- `client/src/screens/Player/PlayerStage.tsx` — the three stacked layers of §9.2, holding
  at most three mounted image layers (previous, current, next).
- `client/src/screens/Player/index.ts` re-exporting `Player`, and deleting the T024 placeholder
  `client/src/screens/Player/index.tsx` in the same change.
- Leaving the player through `useAppActions().exitPlayer({ error? })` (T024). The `notice`
  state field, the `exitPlayer` action and the configuration screen's rendering of the notice
  already exist (T024, T029); this ticket only calls the action.
- `body { overflow: hidden }` while the player is mounted, applied via a class in
  `client/src/styles/base.css`.
- Unit tests for the pure play-order module and component tests for the engine with fake
  timers, per §12.3.

### Out of scope

- The background layer — flat `--player-bg` and the blurred cover image — **T031**. This
  ticket renders an empty background slot filled with `--player-bg` so the player is usable
  on its own, and T031 replaces that slot's contents.
- Ken Burns, the double-buffered crossfade, and the `prefers-reduced-motion` override —
  **T032**. This ticket swaps layers with no transition and exposes the `SwapReason` seam
  T032 consumes.
- The controls overlay (buttons, auto-hide, cursor hiding, counter) — **T033**. This ticket
  renders an empty overlay slot and exposes the `PlayerControls` callbacks T033 wires to
  buttons.
- Keyboard shortcuts and the `fullscreenchange` Escape caveat handling — **T034**. This
  ticket exposes `isFullscreen` from `document.fullscreenElement` and a `toggleFullscreen`
  control, but attaches no key listeners.
- Fetching the playlist. The configuration screen has **already** called
  `GET /api/fs/images`; the player reads `AppState.playlist` and performs no listing
  request of its own.
- Any change to `GET /api/image` or the thumbnail endpoints.
- Touch swipe navigation. Explicitly excluded from v1 by specification §10 because it
  conflicts with browser back gestures.
- The responsive pass (**T035**, epic E20) and the accessibility pass (**T036**, epic E21).
  This ticket still carries its own `aria-label`s and must not regress either.
- The synchronous `requestFullscreen()` call inside the "Play slide show" click handler
  (FR-16.1) and the rendering of the player's exit notice on the configuration screen —
  **T029** (and the `notice` state and `exitPlayer` action — **T024**). §4.6 below restates the
   contract so the ordering can be tested here.
- **End-to-end (e2e) testing is out of scope.**

## 3. Prerequisites and assumed state

The repository is **not** empty. The following already exists and must be used as-is.

**Monorepo and tooling.** An npm workspaces monorepo with three packages — `shared/`,
`server/`, `client/`. Every `package.json` has `"type": "module"`, so the codebase is ESM
throughout; follow the relative-import extension convention already present in the repo.
TypeScript is in `strict` mode. The client is **Vite 7 + React 19**. Styling is plain CSS
with custom properties plus **CSS Modules** (`*.module.css`) and the design tokens in
`client/src/styles/tokens.css`. Tests are **Vitest + React Testing Library** in the `jsdom`
environment, with fake-timer support configured; `npm test` runs the suites,
`npm run typecheck` runs `tsc --noEmit` across workspaces, `npm run lint` runs ESLint 9.

**`@slydr/shared`** exports, among other things:

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
  fillEmptySpace: boolean;
  startFullScreen: boolean;
  includeSubfolders: boolean;
}
```

**`AppStateProvider`** (`client/src/state/AppStateProvider.tsx`, T024) owns the view state machine:

```ts
type View = 'explorer' | 'config' | 'player';

interface AppState {
  view: View;
  explorer: { path: string; viewMode: 'list' | 'grid'; showHidden: boolean };
  selection: { path: string; name: string } | null;
  config: SlideshowConfig;
  playlist: ImageItem[] | null;
  notice: string | null;      // set by exitPlayer({ error }), shown by the configuration screen
}

useAppState(): AppState;
useAppActions(): {            // every function has a stable identity
  exitPlayer(opts?: { error?: string }): void;   // view = 'config'; notice = opts?.error ?? null
  // ...plus goToExplorer, setConfig, setPlaylist, startPlayer, dismissNotice and the explorer actions
};
```

The player reads `const state = useAppState(); const actions = useAppActions();`. Actions are never
destructured from `useAppState()`.

Relevant transitions, already implemented:

| From | Trigger | To | Effect |
|---|---|---|---|
| config | "Play slide show" | player | playlist already loaded; fullscreen requested inside the click handler (T029) |
| player | stop / `Esc` / end-without-loop | config | release fullscreen, wake lock, timers (`exitPlayer`) |

The configuration screen (T029) has already fetched the playlist via `GET /api/fs/images`
and stored `items` in `AppState.playlist`, and it disables "Play slide show" when the count
is zero. **The player therefore makes no network request to list images.**

**The typed API client** (`client/src/api/client.ts`, T025) exposes:

```ts
export function imageUrl(path: string): string;   // → `/api/image?path=<encoded wire path>`
```

**Fullscreen request helper** (`client/src/lib/fullscreen.ts`, T029):

```ts
export function requestFullscreenSync(el: Element): void;   // never throws, swallows rejection
```

The server responds to `/api/image` with the original bytes, `Cache-Control: private,
max-age=1h`, an `ETag`, `Last-Modified` and Range support, so re-requesting the same URL
for a second element is served from the browser's memory or disk cache.

**Design tokens** in `client/src/styles/tokens.css` include `--player-bg` (pure black in
the dark theme, pure white in the light theme), `--overlay-bg`, `--dur-fast`, `--dur-base`,
`--dur-slow`, `--ease-standard`, `--space-1` … `--space-8`, `--focus-ring`, `--danger`,
and the tunable player custom properties for the crossfade duration (700 ms) and the
Ken Burns target scale (1.06).

**Base components** exist in `client/src/components/`: `Button`, `IconButton` (which
*requires* an `aria-label` prop), `Icon` (a thin `lucide-react` wrapper) and `Banner`.

**The theme switch must never appear in the player.** It is rendered only by the explorer
and configuration screens.

`client/src/screens/Player/` does not exist yet, or contains only a placeholder. This
ticket creates it.

## 4. Implementation detail

### 4.1 File layout

```
client/src/screens/Player/
  Player.tsx            # screen component: modes, body lock, layer composition, exit
  Player.module.css     # fill-window layer, layer stack, contain fitting
  PlayerStage.tsx       # the three stacked layers; mounts ≤3 SlideImage layers
  SlideImage.tsx        # one <img> layer, forwards a ref for decode()
  types.ts              # seam types for T031–T034
  playOrder.ts          # pure: shuffle, reshuffle, order helpers
  usePlayerEngine.ts    # the scheduler and state machine
  usePreloader.ts       # off-DOM prefetch + decode, bounded cache
  useWakeLock.ts        # navigator.wakeLock
  fullscreen.ts         # prefix-tolerant fullscreen helpers; re-exports lib/fullscreen
  index.ts              # export { Player } from './Player' (replaces the T024 placeholder index.tsx)
```

### 4.2 Seam types — `client/src/screens/Player/types.ts`

These types are the contract for T031 (background), T032 (animations), T033 (overlay) and
T034 (keyboard). Write them first; they are the stable surface those tickets code against.

```ts
import type { ImageItem } from '@slydr/shared';

/** Why the stage is swapping layers. T032 maps this onto a transition. */
export type SwapReason = 'initial' | 'auto' | 'manual';

export type PlayerStatus = 'starting' | 'playing' | 'paused' | 'failed';

/**
 * One occurrence of one image in the play order.
 * `key` is unique per occurrence (not per file), so looping the same image
 * remounts its layer and restarts any per-slide animation.
 */
export interface PlayerSlide {
  /** Stable per occurrence: `${cycle}:${position}`. */
  key: string;
  /** Zero-based index into the shuffled play order. */
  position: number;
  /** Which loop cycle this occurrence belongs to; starts at 0. */
  cycle: number;
  item: ImageItem;
  /** Result of `imageUrl(item.path)`; identical for every layer showing this file. */
  src: string;
}

export interface PlayerEngineState {
  status: PlayerStatus;
  /** The slide currently on screen. Null only during the very first decode. */
  current: PlayerSlide | null;
  /** The slide being faded out, if any. Kept mounted for the transition only. */
  previous: PlayerSlide | null;
  /** The slide being decoded off-screen, ready to become current. */
  next: PlayerSlide | null;
  /** Why `current` most recently changed. */
  swapReason: SwapReason;
  /** Full slide duration in milliseconds: `config.durationSeconds * 1000`. */
  durationMs: number;
  /** 1-based position and total, for the overlay counter: "7 / 412". */
  counter: { index: number; total: number };
  /**
   * Always derived from `document.fullscreenElement` (webkit fallback), never from local
   * state alone. `usePlayerEngine` owns the `fullscreenchange` subscription (§4.5) and is the
   * only code that assigns this field.
   */
  isFullscreen: boolean;
  /** Non-null when the player is giving up; the screen is exiting. */
  error: string | null;
}

export interface PlayerControls {
  play(): void;
  pause(): void;
  togglePause(): void;
  next(): void;
  previous(): void;
  toggleFullscreen(): void;
  /** Exit to the configuration screen, releasing fullscreen, wake lock and timers. */
  stop(): void;
}

export interface UsePlayerEngineResult {
  state: PlayerEngineState;
  controls: PlayerControls;
  /**
   * Attach to the `<img>` of every mounted layer. For the hidden `next` layer the engine
   * awaits decode() on it; the `next` layer may hold the following slide or the target of a
   * pending manual move (§4.4.4).
   */
  registerLayer(key: string, el: HTMLImageElement | null): void;
  /** Called by a layer's `onError`; marks the file failed and skips it. */
  reportLoadError(key: string): void;
  /** Called by a layer's `onLoad`; clears any prior failure bookkeeping. */
  reportLoadSuccess(key: string): void;
}
```

### 4.3 Play order — `client/src/screens/Player/playOrder.ts`

Pure module, no React, no DOM. This is the only randomness in the player and it must be
unit-testable, so the random source is injectable.

```ts
/** Returns a uniformly distributed integer in [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

/** Default: crypto.getRandomValues with rejection sampling to remove modulo bias. */
export const cryptoRandomInt: RandomInt;

/** Fisher–Yates, in place, returns the same array for convenience. */
export function shuffleInPlace<T>(items: T[], rand?: RandomInt): T[];

/** `[0, 1, …, length - 1]`. */
export function identityOrder(length: number): number[];

/**
 * Build the play order for a cycle.
 * - shuffle off → identityOrder(length)
 * - shuffle on  → a Fisher–Yates permutation of identityOrder(length)
 * When `avoidFirst` is a valid index and length > 1, the result is guaranteed
 * not to begin with it.
 */
export function buildPlayOrder(
  length: number,
  shuffle: boolean,
  rand?: RandomInt,
  avoidFirst?: number | null,
): number[];
```

`cryptoRandomInt` must not use `value % maxExclusive` on a raw 32-bit draw, because that
biases the low indices. Use rejection sampling:

```ts
export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (maxExclusive <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  let draw: number;
  do {
    crypto.getRandomValues(buf);
    draw = buf[0] ?? 0;   // noUncheckedIndexedAccess: buf[0] is number | undefined
  } while (draw >= limit);
  return draw % maxExclusive;
};
```

All array reads in this ticket's code (`order[p]`, `playlist[order[p]]`, `buf[0]`) must satisfy
`noUncheckedIndexedAccess`: narrow with a guard or `?? fallback`, never with `!`.

`buildPlayOrder` steps, in order:

1. If `length <= 0`, return `[]`.
2. Build `order = identityOrder(length)`.
3. If `shuffle` is false, skip to step 6. With shuffle off the order is the server's
   deterministic FR-3 order (folders' own images before subfolders', numeric name
   collation), which is already human-sensible.
4. `shuffleInPlace(order, rand)`.
5. If `avoidFirst` is a number, `length > 1`, and `order[0] === avoidFirst`, pick
   `j = rand(length - 1) + 1` and swap `order[0]` with `order[j]`. One swap is enough: `j`
   is never 0, so the new first element cannot be `avoidFirst`.
6. Return `order`.

Step 5 implements the §9.3 rule that, when looping with shuffle on, the first image of the
new cycle must differ from the last image of the previous cycle whenever the playlist holds
more than one image. Without it a two-image playlist shows the same picture twice in a row
roughly half the time, which reads as a bug.

With shuffle **off** and `loop` on, `avoidFirst` is ignored: the deterministic order must be
preserved exactly, and a one-image-apart repeat across the loop boundary is the correct,
expected behaviour of an unshuffled loop. *Decision (not specified):* the specification's
reshuffle guarantee is written for the shuffling case ("reshuffle (if shuffling)"), so it is
applied only when shuffling.

### 4.4 The engine — `client/src/screens/Player/usePlayerEngine.ts`

```ts
export interface UsePlayerEngineOptions {
  playlist: ImageItem[];
  config: SlideshowConfig;
  /**
   * Called to leave the player; see §4.9. `Player.tsx` passes `useAppActions().exitPlayer`,
   * which has a stable identity (do not wrap it in an inline arrow).
   */
  onExit(reason: { error?: string }): void;
  /** Injectable for tests. Defaults to the module-level helpers. */
  rand?: RandomInt;
}

export function usePlayerEngine(options: UsePlayerEngineOptions): UsePlayerEngineResult;
```

#### 4.4.1 Internal state

Hold mutable playback bookkeeping in a single `useRef` object, and mirror only what the UI
renders into `useState`. Timers and timestamps must never live in React state: a `setState`
per tick would defeat the purpose and would make the scheduler re-entrant.

```ts
interface EngineRef {
  order: number[];            // play order for the current cycle (indices into playlist)
  cycle: number;              // 0-based loop cycle
  position: number;           // index into `order` of the current slide
  timer: ReturnType<typeof setTimeout> | null;
  slideStartedAt: number | null;   // performance.now() when the current run began
  remainingMs: number;             // ms still owed to the current slide
  pendingMove: PendingMove | null; // a move (auto or manual) waiting on the target's decode
  decodeState: Map<string, 'pending' | 'decoded' | 'failed'>;  // slide key → decode outcome
  failed: Set<string>;             // wire paths that failed to load or decode
  layers: Map<string, HTMLImageElement>;  // slide key → mounted <img>
  stopped: boolean;                // set once on unmount/exit; blocks all callbacks
}

interface PendingMove {
  /** Target slide (already published as `next`). */
  target: PlayerSlide;
  reason: SwapReason;              // 'auto' or 'manual'
  /** Direction used when the target fails and a further playable slide is searched. */
  direction: 1 | -1;
}
```

*Decision (not specified):* use `performance.now()` rather than `Date.now()` for
`slideStartedAt`. It is monotonic, so a system clock change, an NTP correction or a DST
transition cannot make a slide appear to have run for a negative or absurd duration.

#### 4.4.2 Scheduling — timestamp-based, never `setInterval`

This is the normative algorithm for §9.3 and must be implemented exactly.

1. **Begin a slide.** Set `remainingMs = durationMs`, `slideStartedAt = performance.now()`,
   `pendingMove = null`, then `timer = setTimeout(onTimerFired, remainingMs)`. A slide begins
   only when a move has been *committed* (§4.4.4), never when it is requested.
2. **`onTimerFired`.** Compute `elapsed = performance.now() - slideStartedAt`. If
   `elapsed < remainingMs - TIMER_EPSILON_MS`, the environment fired the timer early
   (clamping, a fake-timer boundary, a throttled background tab waking up); set
   `remainingMs = remainingMs - elapsed`, `slideStartedAt = performance.now()`, and
   reschedule a single `setTimeout` for the new `remainingMs`. Otherwise set
   `remainingMs = 0`, `timer = null`, and request an automatic move to the following
   position (`requestMove` with reason `'auto'`, §4.4.4). `TIMER_EPSILON_MS = 16`, one frame
   at 60 Hz.
3. **Pause.** `clearTimeout(timer)`, `timer = null`; if `slideStartedAt !== null`, set
   `remainingMs = Math.max(0, remainingMs - (performance.now() - slideStartedAt))`; set
   `slideStartedAt = null`. The current image stays on screen untouched.
4. **Resume.** If `remainingMs === 0`, request an automatic move immediately. Otherwise
   `slideStartedAt = performance.now()` and `timer = setTimeout(onTimerFired, remainingMs)`.
   While a move is pending (`pendingMove !== null`) there is no timer to resume; the commit
   of the move begins the next slide.
5. **Reset (prev/next).** A manual move clears the timer when it is requested (the current
   image stays on screen), and the slide that results begins per step 1 when the move
   commits, so manual navigation always gives the new image its full configured duration.

There is exactly **one** live *scheduling* `setTimeout` at any moment (other, unrelated timers
such as the linger backstop of §4.4.5 may coexist with it; see there). There is no `setInterval`
anywhere in the player. The scheduler never assumes the tab stayed in the foreground: all
of its arithmetic is done against timestamps read at the moment of the event, so a tab that
was backgrounded for ten minutes resumes with a single correct advance rather than a burst
of ten minutes' worth of queued ticks.

#### 4.4.3 Preparing the next slide and the decode gate

The engine always knows three slides: `previous` (fading out, if any), `current` (on
screen), and `next` (mounted but invisible, decoding). The `next` layer is a real `<img>`
in the DOM at `opacity: 0`, registered with the engine through `registerLayer`.

Advance is gated on decode:

1. When `current` changes, immediately compute the following slide and publish it as
   `next`. `PlayerStage` mounts its layer; the layer calls
   `registerLayer(key, imgElement)`.
2. As soon as the element is registered, call `el.decode()`. `HTMLImageElement.decode()`
   resolves when the image is fully decoded and ready to paint in the next frame, and
   rejects if the image cannot be decoded.
3. Record the outcome in `decodeState` (`'pending' | 'decoded' | 'failed'`).
4. Every move (automatic or manual, forward or backward) goes through the same gate,
   `requestMove` in §4.4.4: the engine commits the swap **only if** the target slide's decode
   state is `'decoded'`. If it is `'pending'`, the move stays in `pendingMove` and the decode
   promise's resolution handler performs the commit. If it is `'failed'`, run the failure path
   (§4.4.6) and pick a further playable slide in the move's direction.
5. Consequently a slow decode simply holds the current image on screen longer. The player
   must never paint a blank frame or a half-decoded image, whichever direction the user
   navigates.

`decode()` is not implemented in jsdom. Guard every call:

```ts
const decodePromise =
  typeof el.decode === 'function' ? el.decode() : Promise.resolve();
```

*Decision (not specified):* when `decode` is absent, fall back to the element's
`complete`/`naturalWidth` state and to its `load`/`error` events. This keeps the component
tests honest — they drive `load`/`error` on the `<img>` — and costs nothing in a real
browser, where `decode` always exists.

#### 4.4.4 Advancing, retreating and looping

All movement, forward or backward, automatic or manual, is one operation with a decode gate.

`requestMove(direction: 1 | -1, reason: 'auto' | 'manual')`:

1. If `order.length === 0`, exit with an error (§4.9).
2. **Resolve the target position.** The base is `pendingMove?.target.position ?? position`
   (a second manual press while a move is pending accumulates on the pending target instead
   of restarting from the on-screen slide). `targetPosition = base + direction`.
   - Forward and `targetPosition >= order.length`:
     - `config.loop` **false**: if `reason === 'auto'` call `onExit({})` (the last image has
       just been shown for its full duration, which is exactly when `onTimerFired` calls
       this); if `reason === 'manual'` do **nothing at all** (a clamped press is a no-op: it
       does not exit, does not clear or reset the timer, changes nothing on screen).
       *Decision (not specified):* a clamped press resets nothing, since silently restarting
       the timer on a press that visibly does nothing is confusing.
     - `config.loop` **true**: start a new cycle for the target: `const lastShown =
       order[order.length - 1]` (narrowed, see §4.3), `cycle + 1`, `order =
       buildPlayOrder(playlist.length, config.shuffle, rand, config.shuffle ? lastShown :
       null)`, `targetPosition = 0`.
   - Backward and `targetPosition < 0`: `config.loop` **false** → no-op as above;
     `config.loop` **true** → wrap to the last position of the *current* `order`.
     *Decision (not specified):* it stays within the current cycle's order rather than
     reconstructing the prior cycle's permutation, because the prior permutation is not
     retained and retaining it would unbound memory on a long show.
3. **Skip failed files** with `findNextPlayable(targetPosition, direction)` (§4.4.6). If it
   returns `null`, treat it like running off the end (step 2).
4. **Prepare the target.** Build the `PlayerSlide` for the target (`key = ${cycle}:${position}`).
   Set `pendingMove = { target, reason, direction }`. For a manual move, `clearTimeout(timer)`
   now (the current image stays on screen; the old `remainingMs` is irrelevant). Publish the
   target as `next`. If the target is already the mounted `next` slide its layer and decode
   state are reused; otherwise `PlayerStage` mounts the target layer in the `next` slot (the
   previously published `next` layer is dropped, so the DOM budget of three layers holds), and
   registering it triggers `decode()` (§4.4.3). A backward move therefore always mounts and
   decodes its target; it never reuses the lingering `previous` layer (the browser's image
   cache makes the re-decode of a just-shown file fast, and one code path is simpler to keep
   correct).
5. **Commit** as soon as `decodeState` of the target is `'decoded'` (immediately, in this
   same call, when it already is; otherwise from the decode handler): `previous = current`,
   `current = target`, `position = target.position`, `swapReason = reason`, `pendingMove =
   null`, begin a slide (§4.4.2 step 1) — or, when `status === 'paused'`, set `remainingMs =
   durationMs` and `slideStartedAt = null` without a timer — and then recompute `next` as the
   slide after the new position (the same rules as step 2, without side effects when it would
   run off the end with `loop` off: `next` is `null`).
6. If the target's decode ends `'failed'`, run §4.4.6 and repeat from step 3 in the same
   direction with the failed file excluded.

`advance` in the rest of this ticket means `requestMove(1, 'auto')`; the `next` control is
`requestMove(1, 'manual')` and the `previous` control is `requestMove(-1, 'manual')`.

Manual moves publish `swapReason: 'manual'`, which T032 maps to the shortened `--dur-fast`
transition; automatic moves publish `'auto'`; the very first slide publishes `'initial'`.

#### 4.4.5 `previous`, `current`, `next` and the three-element DOM budget

`PlayerStage` mounts at most three `SlideImage` layers at any instant: `previous`,
`current` and `next` (NFR-3). `previous` exists only for the duration of a transition and is
then dropped. This ticket has no transition, so:

*Decision (not specified):* keep `previous` in state for `PREVIOUS_LAYER_LINGER_MS = 1000`
after a swap, then clear it. 1000 ms comfortably exceeds the 700 ms crossfade T032 will
introduce, so T032 can take over the eviction trigger by replacing the timer with its
`transitionend` handler without the engine's shape changing. Until then the extra invisible
layer is harmless and keeps the budget honest at three.

The linger timer is a *backstop* and not the scheduling timer. The timers that may be alive
at the same time are: the single slide **scheduling timer** (§4.4.2), this linger timer, and
(added by later tickets) the fade safety net and the overlay idle timer. The rule "exactly one
timer" in this ticket therefore means exactly one *scheduling* timer. In the engine-only test
harness the only other timer is the linger backstop, so tests assert `vi.getTimerCount() <= 2`
while `state.previous !== null` and `vi.getTimerCount() <= 1` once it has been cleared (and
exactly 1 while paused-then-resumed mid-slide with no `previous`); never a bare `<= 1` right
after a swap.

#### 4.4.6 Failure handling and skipping (NFR-5)

A slide fails when its layer fires `onError`, when `decode()` rejects, or when the
`<img>` reports `complete === true` with `naturalWidth === 0`.

1. Add the slide's `item.path` to `failed`.
2. Log one line: `console.warn('[slydr] skipping unreadable image', { path: item.path })`.
   This is a browser console warning; it carries a wire path, never an absolute path.
3. When choosing a slide, skip every position whose `playlist[order[p]].path` is in
   `failed`. Implement this as a `findNextPlayable(fromPosition, direction)` helper that
   walks positions and returns `null` when it exhausts the order.
4. If the **current** slide fails, move to the next playable slide immediately
   (`requestMove(1, 'auto')`) rather than waiting out its duration — there is nothing to
   look at. If the target of a pending move fails, repeat the search in that move's direction
   (§4.4.4 step 6).
5. If `failed.size >= playlist.length`, every image is unusable: call
   `onExit({ error: 'None of the images in this folder could be displayed.' })`. Set
   `status = 'failed'` first so the UI does not attempt another swap on the way out.
6. A single failure must never throw, must never unmount the player with a React error
   boundary, and must never stop the show.

### 4.5 Fullscreen — `client/src/screens/Player/fullscreen.ts`

```ts
/** Event names to listen on for a fullscreen state change (unprefixed + webkit). */
export const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

/** Reads document.fullscreenElement, falling back to webkitFullscreenElement. */
export function getFullscreenElement(): Element | null;

export function isFullscreen(): boolean;

/** True when the API exists at all. */
export function isFullscreenSupported(): boolean;

/**
 * Re-exported from client/src/lib/fullscreen.ts (created by T029, which needs it first).
 * Calls requestFullscreen (or webkitRequestFullscreen) and swallows rejection.
 * MUST be called synchronously inside a user-gesture handler.
 */
export { requestFullscreenSync } from '../../lib/fullscreen';

/** Calls exitFullscreen (or webkitExitFullscreen) if anything is fullscreen. */
export function exitFullscreenSafe(): void;
```

Implementation notes:

- `getFullscreenElement` must read the live DOM on every call:

  ```ts
  type FsDocument = Document & { webkitFullscreenElement?: Element | null };
  export function getFullscreenElement(): Element | null {
    const d = document as FsDocument;
    return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
  }
  ```

  **Never** cache fullscreen state in a React state variable as the source of truth. The
  user can leave fullscreen by pressing `Escape`, by `F11`, by a window-manager shortcut, or
  by an OS gesture — none of which the application can observe except through
  `fullscreenchange` and `document.fullscreenElement`.
- `requestFullscreenSync` is implemented once, in `client/src/lib/fullscreen.ts` (T029). It
  is not `async`, is never awaited, returns `void`, and swallows both a synchronous `throw`
  and a rejected promise (FR-16.1: fall back to fill-window mode with no error dialog).
  Do not re-implement it here; `Player/fullscreen.ts` only re-exports it so that later
  tickets (T033, T034) keep importing every fullscreen helper from one place.
- **The engine owns the subscription.** `usePlayerEngine` subscribes to **both** event names
  in `FULLSCREEN_CHANGE_EVENTS` on `document` (in an effect that is idempotent under React
  strict mode), reads `isFullscreen()` once on mount and again in every handler, and
  publishes the result as `state.isFullscreen`. No other module assigns that field.
  `Player.tsx` only reads it. T034 adds the behavioural rules that hang off this event; this
  ticket only keeps the flag truthful.

### 4.6 FR-16.1 — requesting fullscreen from the click handler

This is the single most easily broken requirement in the player, so it is specified
precisely. **The handler itself belongs to the configuration screen (T029 §4.8); this ticket
adds no code to it and only tests the ordering fully.**

Browsers grant fullscreen only from inside a user-gesture handler, synchronously. By the
time React has mounted `Player.tsx`, the gesture has expired and the request is refused.
Therefore the request is made from the **"Play slide show"** button's click handler on the
configuration screen, before the view changes, and it targets `document.documentElement`
rather than the player element, which does not exist yet. T029's handler reads:

```tsx
import { requestFullscreenSync } from '../../lib/fullscreen';

function handlePlayClick() {
  // FR-16.1: must be synchronous, inside the gesture, before any await or state change.
  if (config.startFullScreen) {
    requestFullscreenSync(document.documentElement);
  }
  actions.startPlayer();   // view = 'player'
}
```

Rules:

- No `await`, no `Promise.then`, no `setTimeout`, and no state update may precede the
  `requestFullscreenSync` call in that handler.
- Target `document.documentElement`. Targeting the player container would require the
  element to exist, which would force an `await` on a mount and lose the gesture.
  *Decision (not specified):* the specification says "`element.requestFullscreen()`" without
  naming the element; `document.documentElement` is the only element guaranteed to exist at
  gesture time and produces the same visual result, since the player is a `position: fixed`
  layer covering the viewport either way.
- The player must work identically whether the request succeeded or not. Both modes render
  the same fill-window layer; fullscreen merely removes the browser chrome around it.
- When `config.startFullScreen` is false, no request is made at all.

### 4.7 Fill-window mode and fitting — `Player.module.css`

Per FR-16.2 and FR-16.3. These values are normative.

```css
.player {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;   /* fallback for engines without dynamic viewport units */
  height: 100dvh;  /* FR-16.2 */
  overflow: hidden;
  background: var(--player-bg);
  /* Browser gestures must keep working: §10 excludes swipe navigation in v1
     precisely so the back gesture is not stolen. Do not set touch-action: none. */
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

/* The three stacked layers of §9.2. */
.layerBackground { position: absolute; inset: 0; z-index: 0; overflow: hidden; }
.layerImages     { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
.layerOverlay    { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.layerOverlay > * { pointer-events: auto; }

/* One image layer. */
.slide {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;      /* FR-16.3: always fit, never crop */
  object-position: center;
  pointer-events: none;
  -webkit-user-drag: none;
}
.slideHidden { opacity: 0; }
```

`100dvh` is the *dynamic* viewport height: on mobile browsers whose URL bar collapses on
scroll, `100vh` is the **largest** viewport height, which makes a fixed layer taller than
the visible area and crops the bottom of the picture behind the browser chrome. `100dvh`
tracks the currently visible height instead. Keep the plain `100vh` declaration immediately
before it as a cascade fallback for engines that do not understand `dvh` — they ignore the
later declaration and keep the earlier one.

`document.body` must not scroll while the player is up. Add to
`client/src/styles/base.css`:

```css
body.player-open { overflow: hidden; }
```

and in `Player.tsx`:

```tsx
useEffect(() => {
  document.body.classList.add('player-open');
  return () => { document.body.classList.remove('player-open'); };
}, []);
```

*Decision (not specified):* a class rather than an inline `document.body.style.overflow`
assignment, so no previous inline value has to be captured and restored, and so two
overlapping mounts (React 18+ strict-mode double effects) cannot leak a wrong value.

### 4.8 `SlideImage.tsx` and `PlayerStage.tsx`

`SlideImage` is deliberately minimal — it is the element T032 will animate:

```tsx
export interface SlideImageProps {
  slide: PlayerSlide;
  /** 'previous' | 'current' | 'next' — drives visibility and, later, animation. */
  role: 'previous' | 'current' | 'next';
  swapReason: SwapReason;
  durationMs: number;
  animations: boolean;          // consumed by T032; accepted and ignored here
  onRef(el: HTMLImageElement | null): void;
  onLoad(): void;
  onError(): void;
}
```

Requirements:

- Render exactly one `<img>`, with `src={slide.src}`, `alt=""` and
  `aria-hidden="true"`. *Decision (not specified):* the images are decorative in the
  accessibility tree — a slide show of photographs has no text alternative available from
  the file system, and announcing a file name on every slide would be noise. The player
  container carries `role="region"` and `aria-label="Slide show"` instead.
- `draggable={false}`, `decoding="async"`, and **no** `loading="lazy"` — lazy loading would
  fight the decode gate.
- The `next` layer renders with the `slideHidden` class so it occupies no visual space while
  it decodes.
- `key` on the element in `PlayerStage` must be `slide.key`, never `slide.item.path`. Using
  the path would let React reuse one DOM node across a loop boundary and skip the remount
  that restarts the per-slide animation T032 adds.
- **Counting rule for the NFR-3 budget.** The budget of three counts *foreground* images only:
  `img:not([data-bg])`. The background cover images that T031 adds carry `data-bg="true"`
  and are counted separately (at most two). Every test in this ticket and in T031/T032 that
  asserts "at most three `<img>`" queries `img:not([data-bg])` inside the player root.

`PlayerStage` returns a fragment of the three layer slots below and has **no root element of
its own**. Per-swap custom properties that later tickets need on a common ancestor of the
background and image layers (`--kb-duration`, `--player-transition-dur`, T032) are set as an
inline `style` on the `.player` element by `Player.tsx`.

`PlayerStage` composes the three layer slots:

```tsx
export interface PlayerStageProps {
  state: PlayerEngineState;
  controls: PlayerControls;
  config: SlideshowConfig;
  registerLayer(key: string, el: HTMLImageElement | null): void;
  reportLoadError(key: string): void;
  reportLoadSuccess(key: string): void;
  /** Filled by T031. */
  background?: React.ReactNode;
  /** Filled by T033. */
  overlay?: React.ReactNode;
}
```

It renders `.layerBackground` containing `background` (or nothing, in which case the
container's `--player-bg` shows through), `.layerImages` containing the mounted
`SlideImage` layers, and `.layerOverlay` containing `overlay`.

### 4.9 Exiting to the configuration screen

Per §6.1, stop / `Esc` / end-without-loop all return to the `config` view and must release
fullscreen, the wake lock and every timer.

`controls.stop()` and the internal `exit(reason)` path both do, in order:

1. Set `stopped = true` so no queued decode handler or timer callback can act afterwards.
2. `clearTimeout(timer)`; `timer = null`.
3. Release the wake lock (§4.10).
4. `exitFullscreenSafe()` — exit native fullscreen **before** changing the view, so the
   configuration screen is never painted inside a fullscreen viewport.
5. Call `onExit(reason)`, which dispatches the view change.

Unmount cleanup must do steps 1–3 unconditionally in the effect's teardown, because the
player can also be unmounted by something that did not go through `stop()` (a view change
dispatched elsewhere, or a hot reload).

**Carrying the error back.** §9.3 requires that when every image fails, the player exits
"to the configuration screen with an inline error". The state for this already exists:
T024 added `AppState.notice` and the `exitPlayer(opts?: { error?: string })` action (which
sets `view: 'config'` and `notice = opts?.error ?? null`), and T029's configuration screen
renders a non-null `notice` in a dismissible `Banner variant="error"`. This ticket changes no
state shape and adds nothing to the configuration screen: `onExit(reason)` is simply
`useAppActions().exitPlayer`, called with `{ error }` for the "every image failed" and
"empty playlist" cases and with `{}` for a normal end or a user stop.

**Guard against an empty or missing playlist.** If `AppState.playlist` is `null` or empty
when the player mounts — which should be impossible, since T029 disables the play button at
zero images — exit immediately with
`onExit({ error: 'No playable images in this folder.' })` rather than rendering an empty
black screen.

### 4.10 Wake lock — `useWakeLock.ts`

```ts
/** Holds a screen wake lock while `active` is true. All failures are ignored. */
export function useWakeLock(active: boolean): void;
```

Behaviour:

1. Feature-detect: `'wakeLock' in navigator && navigator.wakeLock != null`. The API is
   unavailable in Firefox and Safari and in any non-secure context other than `localhost`;
   its absence is normal and must produce no warning visible to the user.
2. When `active` becomes true, `await navigator.wakeLock.request('screen')` inside a
   `try/catch` and keep the returned `WakeLockSentinel`.
3. When `active` becomes false, or on unmount, `await sentinel.release()` inside a
   `try/catch` and drop the reference.
4. The browser **automatically releases** a screen wake lock when the document becomes
   hidden. Listen for `visibilitychange` and, when `document.visibilityState === 'visible'`
   and `active` is still true and the sentinel is released, request a fresh one. Without
   this, a tab-switch silently and permanently loses the lock for the rest of the show.
5. Also drop the reference when the sentinel fires its own `release` event.
6. Never surface a failure. No banner, no console error — a `console.debug` at most.

`active` is `state.status === 'playing'`, so pausing releases the lock and resuming
re-acquires it, exactly as §9.3 requires.

If `tsc` does not know `navigator.wakeLock` in the configured `lib`, add a minimal
ambient declaration in `client/src/types/wake-lock.d.ts` rather than casting to `any`.

### 4.11 Seams for T031, T032, T033 and T034

Build these now; they are part of this ticket's acceptance criteria. Each follow-up ticket
must be implementable without editing the engine.

| Consumer | Seam provided here |
|---|---|
| **T031** background | The `.layerBackground` slot and the `background` prop on `PlayerStage`. `state.current.src` and `state.previous?.src` are the already-loaded sources the background reuses, so it costs no extra network request. `config.fillEmptySpace` is passed through. |
| **T032** animations | `state.swapReason` (`'initial' \| 'auto' \| 'manual'`), `state.durationMs`, `state.status` (`'paused'` is what drives `animation-play-state: paused`), the `role` prop on `SlideImage`, and `slide.key` remounting the element on every occurrence. The `animations` prop is threaded from `config.animations` down to `SlideImage` and is accepted but unused here. |
| **T033** overlay | The `overlay` prop on `PlayerStage` and the whole `PlayerControls` object (`play`, `pause`, `togglePause`, `next`, `previous`, `toggleFullscreen`, `stop`), plus `state.counter` for the "7 / 412" readout, `state.status` for the pause/play icon, and `state.isFullscreen` for the fullscreen icon. |
| **T034** keyboard | `PlayerControls` as above, `FULLSCREEN_CHANGE_EVENTS`, `getFullscreenElement()` and `isFullscreen()` from `fullscreen.ts`, and `state.isFullscreen` kept truthful from the DOM. |

`controls.toggleFullscreen()` is implemented here: if `isFullscreen()` then
`exitFullscreenSafe()`, else `requestFullscreenSync(document.documentElement)`. It is safe
to call from a click or key handler because it is synchronous.

### 4.12 Preloader — `usePreloader.ts`

```ts
/**
 * Prefetches and decodes the given sources off-DOM.
 * Keeps at most `maxEntries` HTMLImageElements alive.
 */
export function usePreloader(sources: string[], maxEntries?: number): void;
```

- The slide at `order[position + 1]` is already a mounted, hidden `<img>` in the DOM
  (§4.4.3). The preloader covers exactly one more entry, the slide at `order[position + 2]`,
  so between the two mechanisms "the next two entries in play order" are prefetched and
  decoded in the background, as §9.3 requires. (Spec §9.3 says both are prefetched "with
  `new Image()`"; mounting the first one as the hidden `next` layer is a deliberate
  deviation so the engine can `decode()` the real element it will show. The NFR-3 budget of
  three `<img>` elements in the DOM is unaffected.) Do not prefetch past `order.length`; at
  a loop boundary with `shuffle` on, the next cycle's order does not exist yet, so nothing is
  prefetched for it.
- Prefetch with `const img = new Image(); img.decoding = 'async'; img.src = src;` then
  `img.decode().catch(() => {})`. The element is never appended to the document, so it does
  not count against the three-elements-in-the-DOM budget, and the decoded bitmap is held by
  the browser's cache for the real element that follows.
- `maxEntries` defaults to **1**: only `order[position + 2]` is ever needed. Evict the
  oldest entry by setting `img.src = ''` and deleting it from the map, which lets the
  browser discard the decoded bitmap.
- A prefetch failure is ignored here; the real layer's `onError` is what drives the skip
  logic in §4.4.6.
- No `<link rel="prefetch">`, no `fetch()`. `new Image()` is specified and it also warms the
  decode, which `fetch` does not.

### 4.13 `Player.tsx` wiring

```tsx
// No return-type annotation: @types/react 19 has no global JSX namespace.
export function Player() {
  const app = useAppState();
  const { exitPlayer } = useAppActions();     // stable identity
  const playlist = app.playlist ?? [];
  const { state, controls, registerLayer, reportLoadError, reportLoadSuccess } =
    usePlayerEngine({ playlist, config: app.config, onExit: exitPlayer });

  useWakeLock(state.status === 'playing');
  // body.player-open effect (§4.7)
  // (the fullscreenchange subscription lives inside usePlayerEngine, §4.5)

  return (
    <div
      className={styles.player}
      role="region"
      aria-label="Slide show"
      data-status={state.status}
      data-fullscreen={state.isFullscreen ? 'true' : 'false'}
      data-testid="player"
    >
      <PlayerStage
        state={state}
        controls={controls}
        config={app.config}
        registerLayer={registerLayer}
        reportLoadError={reportLoadError}
        reportLoadSuccess={reportLoadSuccess}
        /* background: T031, overlay: T033 */
      />
    </div>
  );
}
```

The `data-status` and `data-fullscreen` attributes are the hooks the component tests assert
on and are cheap, stable selectors for T032 and T033. The `.player` element is also where T032 adds
its inline `style` custom properties (`--kb-duration`, `--player-transition-dur`); this ticket
sets no inline style.

**Test hooks.** The player root carries `data-testid="player"` (shown above). In `SlideImage.tsx`, the `<img>` of the layer currently shown (the `current` layer, never the hidden `next` layer and never a blurred background layer from T031) carries `data-testid="slide-current"`; the `next` layer carries none. Add no other `data-testid` attributes in this ticket.

**No theme switch, and no theme-dependent logic, anywhere in this file or its children.**
The player's only contact with the theme is the `--player-bg` custom property, and that
belongs to T031.

## 5. Acceptance criteria

- [ ] `client/src/screens/Player/Player.tsx` exists and is rendered by `App.tsx` when
      `AppState.view === 'player'`.
- [ ] `playOrder.ts` exports `cryptoRandomInt`, `shuffleInPlace`, `identityOrder` and
      `buildPlayOrder` with the signatures in §4.3.
- [ ] `buildPlayOrder(n, false)` returns `[0, 1, …, n-1]` for every `n`, unchanged.
- [ ] `buildPlayOrder(n, true, rand)` returns a permutation: same length, no duplicates,
      same set of indices.
- [ ] `cryptoRandomInt` calls `crypto.getRandomValues` and never uses a bare
      `% maxExclusive` on an unfiltered 32-bit draw.
- [ ] `buildPlayOrder(n, true, rand, avoidFirst)` never returns an array whose first
      element equals `avoidFirst` when `n > 1`.
- [ ] Grep the player directory for `setInterval` — there are **zero** hits.
- [ ] The engine holds exactly one live *scheduling* `setTimeout` at a time (the only other
      engine timer is the `PREVIOUS_LAYER_LINGER_MS` backstop); a test asserts
      `vi.getTimerCount() <= 2` while `state.previous` is set and `<= 1` after it is cleared.
- [ ] `slideStartedAt` is taken from `performance.now()`, not `Date.now()`.
- [ ] A slide whose `next` layer has not decoded does not advance when its duration
      elapses; it advances on the decode resolution instead, and no frame renders with
      `current === null` after the first slide.
- [ ] At most three `SlideImage` layers are mounted at any time; a test counts
      `container.querySelectorAll('img:not([data-bg])')` (foreground images only, §4.8)
      through several advances.
- [ ] Pause stops the timer, leaves the current `<img>` in the DOM with the same `src`, and
      resume runs only the remaining milliseconds — verified with fake timers.
- [ ] `next` and `previous` give the new slide its full `durationMs` and publish
      `swapReason === 'manual'`.
- [ ] `previous` (and a manual `next` pressed before the next image has decoded) goes
      through the same decode gate as an automatic advance (§4.4.4): the current image stays
      on screen until the target has decoded, and no frame shows a blank or half-decoded
      image. A second manual press while a move is pending accumulates on the pending target.
- [ ] A manual move while paused swaps the image, stays paused, and starts no timer.
- [ ] With `loop: true`, advancing past the last position starts cycle 1 and keeps playing;
      with `loop: false`, it calls `onExit({})` after the last slide's full duration.
- [ ] With `loop: false`, `next` on the last slide and `previous` on the first slide are
      no-ops that neither exit nor reset the timer.
- [ ] An `<img>` that fires `error` is skipped, its path is recorded, and the show continues
      with the following playable slide.
- [ ] When every image fails, the player calls
      `onExit({ error: 'None of the images in this folder could be displayed.' })`
      (`useAppActions().exitPlayer`), after which `AppState.notice` holds that text and the
      T029 configuration screen shows it. The player adds no field or action to `AppState`.
- [ ] `client/src/screens/Player/index.ts` exports `Player`, the T024 placeholder
      `index.tsx` is deleted, and `App.tsx` needs no edit.
- [ ] `Player.tsx` has no return-type annotation `JSX.Element`, and no code in the directory
      uses a non-null assertion (`!`) on an indexed read.
- [ ] `Player.module.css` `.player` contains, verbatim, `position: fixed`, `inset: 0`,
      `width: 100vw`, `height: 100dvh` (preceded by a `100vh` fallback) and
      `overflow: hidden`.
- [ ] `.slide` contains `object-fit: contain` and `object-position: center`, and no
      `object-fit: cover` appears in this ticket's diff.
- [ ] `body` carries the class `player-open` (`overflow: hidden`) while the player is
      mounted and loses it on unmount.
- [ ] The configuration screen's "Play slide show" handler (T029) calls
      `requestFullscreenSync(document.documentElement)` **synchronously**, with no `await`
      or state update before it, and only when `config.startFullScreen` is true; this ticket
      adds no code to that handler and `Player/fullscreen.ts` re-exports
      `requestFullscreenSync` from `client/src/lib/fullscreen.ts` instead of redefining it.
- [ ] A rejected `requestFullscreen` promise produces no unhandled rejection, no console
      error and no dialog, and the player still renders in fill-window mode.
- [ ] `state.isFullscreen` is computed from `getFullscreenElement()` on mount and on every
      `fullscreenchange` / `webkitfullscreenchange` event by the subscription inside
      `usePlayerEngine`, and no other code path assigns it.
- [ ] `useWakeLock` requests a lock when status is `playing`, releases it on pause and on
      unmount, re-requests after a `visibilitychange` back to visible, and swallows every
      rejection.
- [ ] The player renders no theme switch; grep this ticket's diff for `ThemeSwitch` /
      `useTheme` — zero hits.
- [ ] The player issues **no** `fetch` call; grep the directory for `fetch(` and for
      `fsImages` — zero hits. The playlist comes from `AppState.playlist`.
- [ ] `PlayerStage` accepts `background` and `overlay` props and `SlideImage` accepts
      `animations` and `swapReason`, so T031–T033 need no engine change.

## 6. Tests to write

Per specification §12.3: "player keyboard handling and timer behaviour with fake timers".
Client tests run in the Vitest `jsdom` environment with React Testing Library. Every test
lives under `client/test/` (the only place Vitest looks), mirrors `src/`, and imports
`describe`, `it`, `expect`, `vi` from `'vitest'` (globals are off). Reuse the T021
`client/test/helpers/matchMedia.ts` helper if a test needs `matchMedia`; do not add another.

**`client/test/screens/Player/playOrder.test.ts`** (pure, no DOM)

- `describe('identityOrder')`
  - `it('returns an empty array for length 0')`
  - `it('returns [0,1,2,3] for length 4')`
- `describe('shuffleInPlace')`
  - `it('returns a permutation of the input')` — sorted copy equals sorted original.
  - `it('mutates in place and returns the same array reference')`
  - `it('uses the injected random source for every swap')` — a recording `RandomInt` stub;
    assert it was called `length - 1` times with the expected descending bounds.
  - `it('leaves a one-element array untouched')`
- `describe('cryptoRandomInt')`
  - `it('returns 0 for maxExclusive 1')`
  - `it('draws from crypto.getRandomValues')` — stub `crypto.getRandomValues` via
    `vi.spyOn` and assert it was called.
  - `it('rejects biased draws above the acceptance limit')` — stub the generator to return
    `0xFFFFFFFF` once and then `7`, with `maxExclusive = 10`; assert the result is `7`,
    proving the first draw was rejected rather than taken modulo.
  - `it('never returns a value outside [0, maxExclusive)')` — 1000 real draws for
    `maxExclusive` values 2, 3, 7 and 256.
- `describe('buildPlayOrder')`
  - `it('returns the deterministic identity order when shuffle is off')`
  - `it('ignores avoidFirst when shuffle is off')`
  - `it('returns a permutation when shuffle is on')`
  - `it('never starts with avoidFirst when the playlist has more than one image')` — a
    stubbed `RandomInt` forced to produce an order beginning with `avoidFirst`; assert the
    corrective swap happened and the set of indices is unchanged.
  - `it('returns the single index when the playlist has one image, even when it equals avoidFirst')`
  - `it('returns an empty array for an empty playlist')`

**`client/test/screens/Player/usePlayerEngine.test.tsx`** (fake timers; drive the hook
through a tiny harness component, or render `Player` with a stubbed `AppStateProvider`)

Setup for the whole file: `vi.useFakeTimers()` with `performance` included in the faked
APIs, so `performance.now()` advances with `vi.advanceTimersByTimeAsync`. Stub
`HTMLImageElement.prototype.decode` with a controllable deferred so the decode gate can be
opened on demand. Use `vi.advanceTimersByTimeAsync` (not the synchronous variant) because
the engine awaits promises between ticks.

- `describe('startup')`
  - `it('shows the first playable slide and publishes swapReason "initial"')`
  - `it('exits immediately with an error when the playlist is empty')`
  - `it('mounts the next slide hidden and calls decode on it')`
- `describe('scheduling')`
  - `it('advances after exactly durationSeconds * 1000 ms')`
  - `it('does not advance one millisecond early')`
  - `it('schedules exactly one scheduling timeout at a time')` — right after a swap assert
    `vi.getTimerCount() === 2` (scheduling timer plus the linger backstop); after
    `PREVIOUS_LAYER_LINGER_MS` has elapsed assert `vi.getTimerCount() === 1`.
  - `it('uses no setInterval')` — `vi.spyOn(globalThis, 'setInterval')`, assert not called.
  - `it('recovers from a long background period with a single advance, not a burst')` —
    advance by ten slide durations in one jump and assert the slide index moved by one
    step per resolved decode rather than ten queued ticks firing synchronously.
  - `it('reschedules the remainder when the timer fires early')` — force an early fire and
    assert the slide has not advanced until the full duration has elapsed.
- `describe('decode gating')`
  - `it('holds the current image when the next image has not decoded yet')` — elapse the
    duration with the deferred unresolved; assert `current` is unchanged and no `<img>`
    was removed.
  - `it('advances as soon as the pending decode resolves')`
  - `it('never renders a state with no current slide after the first slide')`
- `describe('pause and resume')`
  - `it('halts the timer and keeps the current image on screen')`
  - `it('resumes with only the remaining time')` — pause at 2000 ms of a 5000 ms slide,
    advance 10 000 ms while paused, resume, assert the advance happens 3000 ms later.
  - `it('togglePause flips status between playing and paused')`
- `describe('manual navigation')`
  - `it('next resets the timer to the full duration')`
  - `it('previous goes back one slide')`
  - `it('publishes swapReason "manual" for both')`
  - `it('wraps at both ends when loop is on')`
  - `it('clamps at both ends when loop is off without exiting or resetting the timer')`
- `describe('manual navigation decode gate')`
  - `it('previous mounts the earlier slide hidden and keeps the current image until it has decoded')` — the deferred decode of the target is unresolved: `current` is unchanged and no blank frame occurs; resolving it commits the swap.
  - `it('previous pressed within the linger window still mounts and decodes its target as a new layer')`
  - `it('previous skips a file that failed and goes to the next earlier playable slide')`
  - `it('a manual next pressed before the next image has decoded waits for the decode, then swaps')`
  - `it('a second previous press while the first is pending accumulates on the pending target')`
  - `it('a manual move while paused swaps the image, stays paused and starts no timer')`
  - `it('after a backward move, next is recomputed as the slide after the new position')`
  - `it('keeps at most three foreground img elements (img:not([data-bg])) in the DOM during a backward move')`
- `describe('looping')`
  - `it('starts a new cycle after the last slide when loop is on')` — assert
    `current.cycle === 1`.
  - `it('reshuffles on the loop boundary when shuffle is on')`
  - `it('never repeats the previous cycle last image as the new cycle first image')` — a
    two-image playlist, run twenty cycles with the real `cryptoRandomInt`, assert no
    adjacent duplicate across any boundary.
  - `it('exits to the configuration screen after the last slide full duration when loop is off')`
- `describe('failure handling (NFR-5)')`
  - `it('skips an image whose layer fires error and continues the show')`
  - `it('skips an image whose decode rejects')`
  - `it('logs one warning per failed image with the wire path')` — spy on `console.warn`.
  - `it('exits with an inline error when every image fails')` — assert `onExit` was called
    with `{ error: 'None of the images in this folder could be displayed.' }`; in an
    integration test with the real `AppStateProvider`, assert `notice` holds that text and
    `view` is `config`.
  - `it('does not throw or unmount when a single image fails')`
- `describe('memory budget (NFR-3)')`
  - `it('keeps at most three foreground img elements (img:not([data-bg])) in the DOM across ten advances')`
  - `it('keeps at most one off-DOM preload entry')`
  - `it('does not prefetch beyond the end of the play order')`

**`client/test/screens/Player/Player.presentation.test.tsx`**

- `describe('fill-window mode (FR-16.2)')`
  - `it('renders a fixed full-viewport container')` — assert the computed inline/module
    class is applied and that the module CSS text contains the five required declarations
    (read the CSS module source once in the test, or assert on a `data-` attribute; jsdom
    does not apply CSS Modules styles).
  - `it('adds body.player-open on mount and removes it on unmount')`
- `describe('fitting (FR-16.3)')`
  - `it('renders the slide with the contain-fitting class and never a cover class')`
- `describe('fullscreen (FR-16.1)')`
  - `it('calls requestFullscreen synchronously from the Play slide show click handler when startFullScreen is on')`
    — integration test through T029's configuration screen:
    `vi.spyOn(document.documentElement, 'requestFullscreen')`; assert it was called
    during the click, before the view state changed.
  - `it('re-exports the lib requestFullscreenSync instead of redefining it')` — the
    function exported by `Player/fullscreen` is identical (`toBe`) to the one in
    `lib/fullscreen`.
  - `it('does not call requestFullscreen when startFullScreen is off')`
  - `it('falls back to fill-window mode with no dialog when the promise rejects')` — stub
    `requestFullscreen` to reject; assert the player renders, no `role="alert"` appears,
    and no unhandled rejection is reported.
  - `it('reads fullscreen state from document.fullscreenElement on every fullscreenchange')`
    — define `document.fullscreenElement` with a getter, dispatch `fullscreenchange`,
    assert `data-fullscreen` flipped.
  - `it('falls back to webkitFullscreenElement when fullscreenElement is undefined')`
- `describe('exit')`
  - `it('stop releases fullscreen before dispatching the view change')` — assert call order
    with a shared spy recorder.
  - `it('clears the scheduling timer and the linger backstop on unmount')` — assert `vi.getTimerCount() === 0` after unmount.
- `describe('theme isolation')`
  - `it('renders no theme switch')` — query by the theme toggle's `aria-label` patterns
    `/Switch to (dark|light) theme/` and assert absence.

**`client/test/screens/Player/useWakeLock.test.tsx`**

- `describe('useWakeLock')`
  - `it('requests a screen lock while active')`
  - `it('releases the lock when active becomes false')`
  - `it('releases the lock on unmount')`
  - `it('re-requests the lock after the document becomes visible again')`
  - `it('is a no-op when navigator.wakeLock is undefined')`
  - `it('swallows a rejected request without logging an error')` — spy on `console.error`
    and assert it was not called.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] Zero occurrences of `setInterval` in `client/src/screens/Player/`.
- [ ] Zero occurrences of `fetch(`, `useTheme` or `ThemeSwitch` in
      `client/src/screens/Player/`.
- [ ] Manually verified in a real browser: the show plays, advances, pauses, steps forward
      and back, loops, and exits with the stop control; fullscreen is granted when
      "Start in full screen" is on.
- [ ] Manually verified at a 320 px-wide viewport and at 1920 × 1080 that the image is
      fitted and never cropped, and that no horizontal page scrollbar appears.
- [ ] Manually verified in both themes that the uncovered background area is the
      `--player-bg` colour (flat black in dark, flat white in light) with no gaps.
- [ ] A folder containing one deliberately corrupt image plays the rest of the folder
      without interruption, and a console warning names the skipped file.
- [ ] README: no change; covered by T041 (the `Escape`/fullscreen note belongs to T034).

## 8. Notes and gotchas

- **The gesture is the whole trick.** If fullscreen "silently does nothing", the cause is
  almost always that something `await`ed or re-rendered before `requestFullscreen` ran.
  Keep that call the first statement in the click handler, forever.
- **`decode()` does not exist in jsdom.** Every call site must be guarded, and the test
  suite must stub it with a controllable deferred. A bare `el.decode()` throws
  `TypeError: el.decode is not a function` in the component tests.
- **`performance.now()` and fake timers.** `vi.useFakeTimers()` fakes `performance` by
  default through `@sinonjs/fake-timers`, but pass `toFake` explicitly and assert in one
  test that `performance.now()` advances with `vi.advanceTimersByTime`, so a future Vitest
  default change surfaces as a failing test instead of a flaky scheduler.
- **Use `vi.advanceTimersByTimeAsync`.** The engine awaits a decode promise between the
  timer firing and the layer swap. The synchronous `vi.advanceTimersByTime` does not flush
  microtasks, so the swap will appear not to happen.
- **React 19 strict mode double-invokes effects** in development. Every effect in the player
  must be idempotent: the body class, the `fullscreenchange` subscription, the wake lock and
  the timer must all tolerate being set up, torn down and set up again. Using a class rather
  than an inline body style (§4.7) is one defence; the `stopped` flag is another.
- **Timer clamping in background tabs.** Browsers clamp `setTimeout` in hidden tabs to
  roughly one second, and may coalesce or defer it much further. The timestamp arithmetic in
  §4.4.2 is what makes this a non-issue. Do not add a "catch-up" loop that advances several
  slides at once to compensate — the user did not see them, and NFR-3's memory budget forbids
  decoding them.
- **`previous` (the layer) is not history.** It exists only so a transition has something to
  fade out. The engine keeps no navigation history, and with `loop` on, the previous-image
  *control* from position 0 wraps within the current cycle's order rather than reconstructing
  the prior cycle. Going back always mounts and decodes the earlier slide, even when it is
  still the lingering `previous` layer; it is never assumed to be decoded.
- **Do not annotate components with `JSX.Element`.** `@types/react` 19 removed the global
  `JSX` namespace; let the return type be inferred or use `React.ReactElement`.
- **`noUncheckedIndexedAccess` is on.** `order[p]`, `playlist[i]` and `buf[0]` are
  `T | undefined`; narrow them with a guard or `??`, not with `!`.
- **Specification assumption A5** (§16.1): the player uses the playlist captured when
  "Play slide show" was pressed. Files added to the folder mid-show do not appear, and the
  player must not re-scan on a loop boundary.
- **Specification assumption A6**: the explorer's `showHidden` setting also governs whether
  hidden images are in the playlist. That filtering already happened server-side; the player
  does no filtering of its own.
- **Never introduce a second `/api/fs/images` call.** §5.4 states that endpoint is the single
  source of the playlist and §8.3 states the configuration screen's response becomes the
  playlist. A refetch in the player would double the scan cost on a 20 000-image folder and
  could legitimately return a different list.
- **`--player-bg` on the container** is a convenience so the player is never transparent
  while T031 is unbuilt. Do not build any further theme logic here: §9.2 makes the
  background layer the *only* place the player consults the theme.
- **Tuned values live in CSS** (§16.2): the 700 ms crossfade and the `scale(1.06)` Ken Burns
  target are expected to be re-tuned once with the product owner. Do not put either number
  into TypeScript in this ticket; `durationMs` is the only timing the engine owns.
