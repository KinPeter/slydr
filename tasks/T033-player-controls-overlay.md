# T033 — Build the player controls overlay with auto-hide

**Epic:** E18 — Player controls
**Spec sections:** §9.5 (FR-16.7, FR-16.8), §10 (design tokens), NFR-6 (accessibility)
**Depends on:** T030
**Estimated size:** M

---

## 1. Context

Once the slide show is running, the user needs a way to go back, go forward, pause, toggle full screen and stop, but the chrome must never compete with the photographs. This ticket builds the controls overlay: a small translucent pill anchored at the bottom centre of the player that fades out after two seconds of inactivity (taking the mouse cursor with it) and reappears whenever the user interacts. It also introduces `useIdleReveal`, the hook that owns the auto-hide timer and exposes `reveal()`. Keyboard shortcuts and the reaction to full-screen changes are built in T034 on top of what this ticket provides.

## 2. Scope

### In scope
- `PlayerControlsOverlay` component (`client/src/screens/Player/PlayerControlsOverlay.tsx` and `PlayerControlsOverlay.module.css`): the pill, five icon buttons, and the optional "7 / 412" counter.
- `useIdleReveal(timeoutMs = 2000)` hook (`client/src/screens/Player/useIdleReveal.ts`) exposing `visible`, `reveal()` and the hold inputs (hover, focus, paused).
- Cursor hiding: a `data-chrome="visible" | "hidden"` attribute on the player root and the CSS rule that sets `cursor: none` when hidden.
- Wiring the overlay into `Player.tsx` through the existing `PlayerStage` `overlay` slot, connected to the `PlayerControls` and `PlayerEngineState` seams from T030.
- Touch behaviour: a tap reveals the controls and does nothing else.
- Fade transition, reduced-motion handling for the fade, accessible names, focus ring, touch target sizes.
- Unit tests with fake timers.

### Out of scope
- Keyboard shortcuts (`Space`, `Escape`, arrows, `f`) and the overlay's reaction to a full-screen change — T034. T034 calls the `reveal()` function this ticket exports.
- Any full-screen state hook. The single owner of full-screen state is the engine (`state.isFullscreen`, T030); this ticket reads it and creates no second subscription.
- Slide timing, engine state, image preloading, transitions and backgrounds — T030, T031, T032.
- The verification sweep of the responsive layout at every viewport — T035. This ticket owns the pill's CSS (including the sizes below) and T035 only verifies it.
- Contrast measurements, live regions and the accessibility audit — T036.
- Swipe gestures. They are deliberately not bound in v1.
- Any error screen for a failed player. There is none: when every image fails, the engine exits to the configuration screen with a notice (T030, T029).

## 3. Prerequisites and assumed state

T030 has delivered the player foundation. The following exist and are consumed here without modification unless stated in section 4.

`client/src/screens/Player/types.ts`:

```ts
export interface PlayerControls {
  play(): void;
  pause(): void;
  togglePause(): void;
  next(): void;
  previous(): void;
  toggleFullscreen(): void;
  stop(): void;
}

export interface PlayerEngineState {
  status: 'starting' | 'playing' | 'paused' | 'failed';
  /** 1-based position and total, for the "7 / 412" readout. */
  counter: { index: number; total: number };
  /** Derived from document.fullscreenElement by the engine's own subscription. */
  isFullscreen: boolean;
  // ...other fields (current, previous, next, swapReason, durationMs, error) are not used here
}
```

`usePlayerEngine` returns `{ state, controls, registerLayer, reportLoadError, reportLoadSuccess, releasePrevious }`; consumers write `state.status`, `state.counter`, `state.isFullscreen`. `status: 'failed'` is a transient value held for an instant before the player exits (T030); no UI is ever rendered for it.

`client/src/screens/Player/Player.tsx` renders the root `div.player` with `role="region"`, `aria-label="Slide show"`, `data-status` and `data-fullscreen` (the latter from `state.isFullscreen`). `PlayerStage` accepts `overlay?: ReactNode` and renders it inside `.layerOverlay` (z-index 2, `pointer-events: none`, with direct children set to `pointer-events: auto`). T030 attaches no key listeners and no pointer listeners. T030's `stop()` already exits full screen before changing view.

From the base components (T022): `IconButton` (requires `aria-label`, forwards `ref` and standard button props), `Icon` wrapper over `lucide-react`. `lucide-react` is already a client dependency.

Design tokens available in `client/src/styles/tokens.css` (T020): `--overlay-bg`, `--overlay-fg`, `--overlay-fg-muted`, `--shadow-1`, `--focus-ring`, `--radius-pill`, `--space-1` to `--space-8`, `--target-min`, `--target-min-coarse`, `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-standard`. `--overlay-fg` and `--overlay-fg-muted` are the text and icon colours for content drawn on `--overlay-bg`; they are near-identical in both themes because the backdrop is a photograph, not the page. Do **not** use `--fg` or `--fg-muted` on the pill: in the light theme `--fg` is near-black and would be unreadable on the dark pill.

Breakpoint rule used by every stylesheet in the client: `min-width` queries at 480, 768, 1024 and 1440 px, and downward cases written as `max-width` with the `.98px` form (`479.98px`, `767.98px`, `1023.98px`, `1439.98px`). Use only these in this ticket's CSS.

## 4. Implementation detail

### 4.1 Files

Create:
- `client/src/screens/Player/PlayerControlsOverlay.tsx`
- `client/src/screens/Player/PlayerControlsOverlay.module.css`
- `client/src/screens/Player/useIdleReveal.ts`
- `client/test/screens/Player/useIdleReveal.test.tsx`
- `client/test/screens/Player/PlayerControlsOverlay.test.tsx`
- `client/test/screens/Player/Player.controls.test.tsx`

Modify:
- `client/src/screens/Player/Player.tsx` (wire the hook, overlay and `data-chrome`).
- `client/src/screens/Player/Player.module.css` (cursor rule).

There is no `useFullscreen.ts` and no `useFullscreenState` hook. Full-screen state has exactly one owner, the engine (T030 §4.5).

### 4.2 `useIdleReveal(timeoutMs = 2000)`

Signature:

```ts
export interface IdleRevealOptions {
  /** When true the controls never auto-hide (the slide show is paused). */
  hold?: boolean;
}

export interface IdleReveal {
  visible: boolean;
  /** Show the controls now and restart the idle timer. Stable identity across renders. */
  reveal: () => void;
  /** Wire these onto the overlay element so hover and focus hold it open. */
  holdProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (event: React.FocusEvent) => void;
  };
  /** Attach to the pill element; used by reveal() to un-inert it synchronously (see 4.4). */
  overlayRef: React.RefObject<HTMLElement | null>;
}

export function useIdleReveal(timeoutMs = 2000, options: IdleRevealOptions = {}): IdleReveal;
```

Behaviour, in order:

1. `visible` starts `true`. On mount the timer starts, so the controls are shown for the first two seconds of the show and then fade (the user has just clicked Play and needs to see where the controls are).
2. `reveal()` sets `visible` to `true` and restarts a single `setTimeout(timeoutMs)`. Any previous timer is cleared first. When the timer fires, `visible` becomes `false` unless a hold is active.
3. Holds are tracked in refs, not state, so that pointer movement does not cause re-renders: `hovering` (pointer is over the pill), `focusWithin` (any element in the pill has focus), and the `hold` option (paused). The timer callback re-checks all three at fire time. If any is set it does not hide; it simply does nothing, and the next release of the hold restarts the timer (see 4).
4. When a hold is released (pointer leaves, focus leaves, or `hold` changes from `true` to `false`), call the equivalent of `reveal()` so a fresh full 2000 ms starts from the release moment.
5. When `hold` is `true`, `visible` is forced `true`. Pausing therefore shows the controls immediately and keeps them there.
6. The hook adds `mousemove`, `pointerdown` and `touchstart` listeners to `window` (passive) while mounted and removes them in cleanup. Each one calls `reveal()`. Listening on `window` rather than the player element guarantees movement over the overlay itself is also seen. `keydown` is *not* listened to here: T034's keyboard handler calls `reveal()` explicitly for each handled key. A bare `Tab` press while the overlay is hidden is handled in 4.4.
7. Do not call `setState` when the value is unchanged. `mousemove` fires at high frequency; the handler only clears and recreates the timer (cheap) and calls `setVisible(true)`, which React bails out on when already `true`. Do not add throttling or coordinate comparison: it would make the exact 2000 ms edge flaky in the fake-timer tests. A short comment in the hook says so.
8. Cleanup clears the timer and removes all listeners. After unmount no timer may fire (a test covers this).

The hook treats a timer expiry exactly at `timeoutMs`. With fake timers, at 1999 ms after the last activity the overlay is visible; at 2000 ms it is hidden.

### 4.3 Overlay component

```ts
export interface PlayerControlsOverlayProps {
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onToggleFullscreen: () => void;
  onStop: () => void;
  paused: boolean;
  fullscreen: boolean;
  /** 1-based position of the current image (`state.counter.index`), rendered as is. */
  index: number;
  total: number;
  visible: boolean;
  holdProps: IdleReveal['holdProps'];
}
```

These map directly onto T030's `PlayerControls` (`previous`, `next`, `togglePause`, `toggleFullscreen`, `stop`) and `PlayerEngineState` (`status === 'paused'`, `isFullscreen`, `counter`). `Player.tsx` does the mapping; the overlay itself stays presentational so it can be tested with plain `vi.fn()` handlers. The overlay file forwards the pill element's ref (`forwardRef`, or a `pillRef` prop) so `useIdleReveal`'s `overlayRef` can be attached.

Counter: render `{index} / {total}` in `--overlay-fg-muted` at the left of the pill, for example `7 / 412`. `index` is already 1-based; do not add one. Hide the counter when `total` is 0 or 1. *Decision (not specified):* the counter is plain text with no `aria-hidden`, `role` or `aria-label`; screen readers read it as "7 / 412" when browsing. It is deliberately not a live region, because announcing every slide change every few seconds would be disruptive.

Buttons, left to right after the counter, with exact accessible names and lucide icons:

| Order | Action | Icon | `aria-label` |
|---|---|---|---|
| 1 | Previous image | `SkipBack` | `Previous image` |
| 2 | Pause / play | `Pause` when playing, `Play` when paused | `Pause slide show` when playing, `Play slide show` when paused |
| 3 | Next image | `SkipForward` | `Next image` |
| 4 | Toggle full screen | `Maximize` when not full screen, `Minimize` when full screen | `Enter full screen` / `Exit full screen` |
| 5 | Stop | `X` | `Stop slide show` |

*Decision (not specified):* the stop button uses `X` (close) rather than `Square`, because users read it as "leave", and the specification calls it "stop/exit". Icons are decorative (`aria-hidden="true"` via the `Icon` wrapper); the name comes from `aria-label`. Use `type="button"` on all of them.

The pause/play icon follows the *current* state (it shows `Pause` while playing), and the label describes the action the click will perform. The `paused` prop is true when `state.status` is `paused`. While status is `starting` treat as playing.

The full-screen button's icon and label follow the `fullscreen` prop, which `Player.tsx` takes from `state.isFullscreen`. It is never toggled optimistically on a click, because the browser may refuse a request or the user may leave full screen by means the app cannot observe directly; the engine's `fullscreenchange` subscription keeps `state.isFullscreen` truthful.

Root element: `<div role="toolbar" aria-label="Slide show controls" aria-orientation="horizontal" ...holdProps>`. *Decision (not specified):* use `role="toolbar"` for correct grouping, but do not implement roving tabindex; all five buttons remain in the Tab order (they are few, and arrow keys are reserved for previous/next in T034).

Click handling: each button calls its prop. A click also calls nothing else; because the window-level `pointerdown` listener already revealed the overlay, no extra work is needed.

### 4.4 Hidden state

When `visible` is `false`:

- The pill has `opacity: 0` and, after the fade finishes, `visibility: hidden`. Implement with CSS only:

```css
.pill {
  transition: opacity var(--dur-base) var(--ease-standard),
              visibility 0s linear var(--dur-base);
}
.pill[data-visible='false'] { opacity: 0; visibility: hidden; }
.pill[data-visible='true']  { opacity: 1; visibility: visible; transition-delay: 0s, 0s; }
```

The `visibility` transition with a delay equal to `--dur-base` makes the element stay rendered during the fade and become non-focusable and non-clickable afterwards. This is what keeps hidden buttons out of the Tab order.
- Also set the `inert` attribute on the pill while hidden (`inert={!visible}`; React 19 supports the boolean prop). This covers the fade window itself, so a reveal tap cannot activate a button that is still fading out, and it is the primary guard on engines where `visibility` timing differs.
- The window-level `pointerdown` listener fires before `click`, so a first tap on a hidden pill reveals it; however the pill is `inert` and the event targets whatever is beneath (the stage), so no button activates. See 4.7.

Keyboard reveal precisely: because hidden buttons are not focusable, pressing `Tab` while hidden would move focus to the next focusable thing in the page (probably nothing, or the browser chrome). To make a keypress or Tab reveal the controls, `Player.tsx` registers one extra capture-phase `keydown` listener on `window` (inside a `useEffect`, removed on unmount) that, for *any* key other than pure modifier keys (`Shift`, `Control`, `Alt`, `Meta`), calls `reveal()` when `visible` is false. For `Tab` this runs before the browser moves focus, and because `reveal()` sets state synchronously but the DOM updates after the event, the implementation must also set `inert` and `visibility` imperatively: the hook keeps `overlayRef` to the pill element, and `reveal()` clears `inert` and sets `data-visible="true"` on it directly before calling `setVisible(true)`. The first Tab press therefore both reveals the pill and focuses its first button. T034's handler additionally calls `reveal()` for handled shortcut keys; calling it twice is harmless.

### 4.5 Cursor hiding

`Player.tsx` sets `data-chrome={visible ? 'visible' : 'hidden'}` on the root `div.player`. In `Player.module.css`:

```css
@media (hover: hover) {
  .player[data-chrome='hidden'] { cursor: none; }
}
```

The cursor reappears on the same `mousemove` that reveals the overlay because both derive from the single `visible` state. While the pointer rests over the pill, `visible` stays true, so the cursor is never hidden over the controls. Touch devices have no cursor, so the media query keeps the rule off them.

### 4.6 Never-hide conditions

The overlay does not hide while any of the following is true:

1. Keyboard focus is inside it (tracked through `onFocusCapture` / `onBlurCapture`; on blur, ignore the event if `event.relatedTarget` is still inside the pill).
2. The pointer is over it (`onPointerEnter` / `onPointerLeave`).
3. The slide show is paused (`hold: state.status === 'paused'`).

The first two matter for keyboard and mouse users who are about to click; the third is deliberate: a paused show has nothing to protect, and the user will want to resume.

### 4.7 Touch behaviour

On touch devices the first tap anywhere on the player reveals the controls and nothing more:

- The window `pointerdown` listener reveals them.
- No click or tap handler on the stage advances, pauses or stops the show. T030 binds none, and this ticket must not add one.
- A tap on a visible button activates that button normally. A tap on a *hidden* (inert) pill falls through to the stage and only reveals.
- Because the pill becomes interactive only after React re-renders, a "double-tap" (reveal tap, then immediate button tap) works naturally.

### 4.8 Layout and sizing CSS

```css
.pill {
  position: absolute;
  left: 50%;
  bottom: max(var(--space-6), env(safe-area-inset-bottom));
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--overlay-bg);
  color: var(--overlay-fg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-1);
  max-width: calc(100% - 2 * var(--space-4));
}
.counter { color: var(--overlay-fg-muted); font-variant-numeric: tabular-nums; padding-inline: var(--space-2); }
.button { min-width: var(--target-min); min-height: var(--target-min); color: var(--overlay-fg); }
.button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

/* Declaration order matters: the coarse-pointer rule comes first, the narrow-viewport rule last,
   and both give 48px, so a phone never gets less than 48px. */
@media (pointer: coarse) {
  .button { min-width: var(--target-min-coarse); min-height: var(--target-min-coarse); }
}
@media (max-width: 767.98px) {
  .pill { gap: var(--space-1); padding-inline: var(--space-2); }
  .button { min-width: var(--target-min-coarse); min-height: var(--target-min-coarse); }
  .counter { display: none; }
}
```

Arithmetic at the narrowest supported viewport (320 px): the pill may be at most 320 − 2 × 16 = 288 px wide. Five 48 px buttons (240) + four `--space-1` gaps (16) + two `--space-2` paddings (16) = 272 px, which fits. The counter is hidden below 768 px for exactly this reason. Do not reintroduce a wider gap, padding or button width in that band.

There is no `@supports not (backdrop-filter …)` override. `--overlay-bg` is dark enough that `--overlay-fg` meets AA with no blur at all (T020 computes the contrast without blur), so the pill stays legible when blur is unavailable. Never substitute `--bg-elevated`, `--fg` or any theme-dependent surface colour for the pill.

The spec's rule that the controls "never disturb" the image is met by the small footprint, translucency and fade; the pill never moves the image or changes its size because it lives in the overlay layer above the stage. The `transform: translateX(-50%)` is fine because the overlay layer sets no transform of its own.

### 4.9 Fade timing and reduced motion — Decision (not specified)

- The fade lasts `--dur-base` (the same token as the other chrome transitions, 200 ms in the shipped token set).
- The fade is user-interface chrome, not slide animation, so it is *exempt from the `animations` setting*: even with Animations switched off in the configuration, the overlay fades.
- Under `@media (prefers-reduced-motion: reduce)` the fade becomes instantaneous (`transition-duration: 0s`, so visibility changes immediately). Opacity fades are generally acceptable under reduced motion, but an instant change is the conservative reading of the preference and costs nothing.

### 4.10 Wiring in `Player.tsx`

1. Take everything from the engine result: `const { state, controls, ... } = usePlayerEngine(...)`. Full-screen state is `state.isFullscreen`; there is no separate hook.
2. Call `const idle = useIdleReveal(2000, { hold: state.status === 'paused' });`
3. Add `data-chrome` to the root. Attach `idle.overlayRef` (see 4.4) to the pill through `forwardRef` or a `pillRef` prop.
4. Pass `<PlayerControlsOverlay .../>` through `PlayerStage`'s `overlay` prop, mapping `onPrev={controls.previous}`, `onNext={controls.next}`, `onTogglePause={controls.togglePause}`, `onToggleFullscreen={controls.toggleFullscreen}`, `onStop={controls.stop}`, `paused={state.status === 'paused'}`, `fullscreen={state.isFullscreen}`, `index={state.counter.index}`, `total={state.counter.total}`, `visible={idle.visible}`, `holdProps={idle.holdProps}`.
5. Keep `idle.reveal` in a local variable; T034's keyboard hook and full-screen-change effect receive it. In this ticket nothing consumes it other than the any-key reveal in 4.4.
6. The overlay is always rendered while the player is mounted. There is no failed-state variant: a failed player has already exited.

## 5. Acceptance criteria

- [ ] `client/src/screens/Player/PlayerControlsOverlay.tsx` and `useIdleReveal.ts` exist with the signatures in section 4; no `useFullscreen.ts` / `useFullscreenState` exists.
- [ ] The overlay shows five buttons in the order Previous, Pause/Play, Next, Full screen, Stop, with the exact `aria-label` strings in the table in 4.3, and a counter such as `7 / 412` at the left when `total > 1`. With `state.counter = { index: 7, total: 412 }` the counter reads `7 / 412` (not `8 / 412`).
- [ ] The pause/play button shows `Pause` and the label `Pause slide show` while playing, and `Play` and `Play slide show` while paused.
- [ ] The full-screen button shows `Maximize` and `Enter full screen` when `state.isFullscreen` is false, and `Minimize` and `Exit full screen` when it is true. The value comes from the engine only.
- [ ] The pill text and icons use `--overlay-fg`, the counter uses `--overlay-fg-muted`; neither `--fg` nor `--fg-muted` appears in `PlayerControlsOverlay.module.css`.
- [ ] The pill is horizontally centred, sits `max(var(--space-6), env(safe-area-inset-bottom))` above the bottom edge, and uses `--overlay-bg`, `backdrop-filter: blur(12px)`, `--radius-pill` and `--shadow-1`.
- [ ] With no pointer activity, the overlay becomes hidden exactly 2000 ms after the last activity (visible at 1999 ms).
- [ ] `mousemove`, `pointerdown` and `touchstart` reveal the overlay and restart the 2000 ms timer.
- [ ] The overlay does not hide while the pointer is over it, while any control has keyboard focus, or while the show is paused. Releasing a hold restarts a full 2000 ms.
- [ ] `data-chrome="hidden"` is set on the player root when hidden and `cursor: none` applies inside `@media (hover: hover)`; the cursor returns with the overlay.
- [ ] When hidden, the pill has `visibility: hidden` after the fade and the `inert` attribute, so none of its buttons can be tabbed to or clicked.
- [ ] The first `Tab` (or any non-modifier key) pressed while hidden reveals the overlay and focus lands on the Previous button.
- [ ] A first tap on a hidden overlay reveals it and does not advance, pause or stop the show.
- [ ] Every button has a visible focus ring (`:focus-visible`), is at least 44 × 44 CSS px, and 48 × 48 px under `@media (pointer: coarse)` and below 768 px.
- [ ] At a 320 px viewport the pill is at most 288 px wide, all five buttons are visible, the counter is hidden, and nothing overflows the pill (272 px of content, see 4.8).
- [ ] The CSS contains no `@supports not (backdrop-filter …)` colour override and uses only the breakpoint forms listed in section 3.
- [ ] The fade uses `--dur-base`, is not disabled by the `animations` config setting, and is instantaneous under `prefers-reduced-motion: reduce`.
- [ ] Stop returns to the configuration screen, leaving full screen first (verified through T030's `controls.stop`).
- [ ] No timer or listener remains after the player unmounts.

## 6. Tests to write

All tests use Vitest and React Testing Library with `vi.useFakeTimers()`; advance time with `await vi.advanceTimersByTimeAsync(ms)`. Restore real timers in `afterEach`. Tests import `describe/it/expect/vi` from `'vitest'`. Quality strategy: specification §12.

### `client/test/screens/Player/useIdleReveal.test.tsx`
- `starts visible and hides at exactly 2000 ms` — render a harness, advance 1999 ms (still visible), advance 1 more ms (hidden).
- `mousemove restarts the timer` — advance 1500 ms, dispatch `mousemove` on `window`, advance 1500 ms (still visible), advance 500 ms (hidden).
- `pointerdown and touchstart reveal a hidden overlay`.
- `reveal() shows and restarts the timer`.
- `hold option keeps it visible indefinitely` — with `hold: true` advance 60 s, still visible; when `hold` flips to false it hides 2000 ms later, not immediately.
- `hover hold` — `onPointerEnter` stops hiding; `onPointerLeave` restarts a full 2000 ms.
- `focus hold` — `onFocusCapture` stops hiding; blur to outside restarts the timer; blur to another element inside the pill does not release.
- `no timer after unmount` — unmount, advance 10 s, spy confirms no state update warning and `vi.getTimerCount()` is 0.
- `listeners removed on unmount` — spy on `window.removeEventListener` for the three event names.

### `client/test/screens/Player/PlayerControlsOverlay.test.tsx`
- `renders five buttons with the exact labels while playing` (query with `getByRole('button', { name })`).
- `labels switch when paused and in full screen` — `Play slide show`, `Exit full screen`.
- `each button calls its handler once` — click all five, assert `onPrev`, `onTogglePause`, `onNext`, `onToggleFullscreen`, `onStop`.
- `counter text is index / total as given` — `index=7, total=412` shows `7 / 412`; `index=1, total=412` shows `1 / 412`; `total=1` shows no counter.
- `hidden state sets data-visible=false and inert`.
- `toolbar role and label`.
- `module css uses overlay tokens only` — read `PlayerControlsOverlay.module.css` with `node:fs`; assert it contains `--overlay-fg` and `--overlay-fg-muted` and contains neither `var(--fg)` nor `var(--fg-muted)`.

### `client/test/screens/Player/Player.controls.test.tsx`
(Mount `Player` inside the `AppStateProvider` test harness from T030 with a fake image set.)
- `hides after 2 s and cursor attribute toggles` — `data-chrome` changes from `visible` to `hidden` at 2000 ms, back to `visible` after a `mousemove`.
- `does not hide while paused` — pause, advance 10 s, still `visible`.
- `does not hide while a button is focused` — focus Next, advance 10 s, still visible; blur, hides after 2000 ms.
- `does not hide while hovered`.
- `tap reveals without changing slide or pause state` — hide, fire `pointerdown` with `pointerType: 'touch'` on the stage, expect visible, `data-status` unchanged and counter unchanged.
- `Tab while hidden reveals and focuses Previous`.
- `stop button leaves the player` — click Stop, the app state view becomes `config`.
- `fullscreen button label follows the engine state` — define `document.fullscreenElement`, dispatch `fullscreenchange`, label becomes `Exit full screen` and `data-fullscreen` is `true`; clear it and dispatch again, label returns to `Enter full screen`.
- `counter shows the 1-based position` — first slide shows `1 / N`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] No hard-coded colours, durations or spacing in the new CSS; tokens only.
- [ ] `useIdleReveal` is exported and documented with a short comment so T034 can import it.
- [ ] Manual check on Chromium desktop in **both themes**: controls fade after 2 s, the cursor disappears and reappears, hover/focus/pause keep them open, and the icons and counter are clearly readable over a bright photograph in the light theme.
- [ ] Manual check on a touch emulator: tap reveals without advancing.
- [ ] Manual check at 320 px: all five buttons visible inside the pill.
- [ ] README: no change from this ticket (the keyboard and full-screen section is owned by T041).

## 8. Notes and gotchas

- **Do not hide with `display: none`.** It would defeat the fade, and it would also drop focus abruptly. Use opacity, delayed `visibility` and `inert`.
- **Never colour the pill with `--fg`.** `--fg` follows the page theme; the pill sits on a photograph. Use `--overlay-fg` / `--overlay-fg-muted`.
- **`mousemove` fires on layout changes** in some browsers even when the user has not moved the mouse (for example when an element appears under a stationary pointer). This can keep the overlay awake. Accept it; do not compare coordinates, which adds complexity for little gain.
- **Cursor hiding in full screen.** `cursor: none` on the player root works in full screen because the root fills the viewport. Do not apply it to `body`.
- **Safari.** `backdrop-filter` needs the `-webkit-` prefix on older versions; the declaration pair above covers it, and the pill stays legible without blur.
- **Focus returning to the page.** When Stop is clicked while a button has focus, the button unmounts with the player; T036 decides where focus lands on the configuration screen.
- **Do not bind `click` on the stage.** Tap-to-advance is a v1 non-goal and would collide with the reveal tap.
- **Strict mode.** React 19 development double-invokes effects. The hook's effect must be idempotent: clear the timer in cleanup and register listeners exactly once per mount.
- **Fake timers.** The hook uses only `setTimeout`, so `vi.useFakeTimers()` controls it fully. Avoid `Date.now()` comparisons.
- **jsdom has no layout**, so `visibility` after the transition is not computed. Assert on `data-visible`, `inert` and `data-chrome`, not on computed style.
