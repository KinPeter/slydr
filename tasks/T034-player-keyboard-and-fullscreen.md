# T034 — Implement player keyboard shortcuts and the full-screen exit reaction

**Epic:** E19 — Player keyboard and full screen
**Spec sections:** §9.6 (FR-16.9, FR-16.10), §9.1, §12.3, §13.3
**Depends on:** T030, T033
**Estimated size:** M

---

## 1. Context

While a slide show runs, the user expects to drive it from the keyboard: Space to pause, the arrow keys to move, `f` for full screen and `Escape` to stop. This ticket adds a single global key handler to the player and makes the player behave correctly when full screen ends. The second half exists because of a browser rule that the application cannot change: when the document is in native full screen the browser consumes the first `Escape` press to leave full screen, and the page never receives that key event. The player must stay in the slide show in fill-window mode, keep playing and show the controls; a second `Escape` then stops the show.

## 2. Scope

### In scope
- `usePlayerKeyboard` hook (`client/src/screens/Player/usePlayerKeyboard.ts`): one `keydown` listener on `window`, attached while the player is mounted and removed on unmount.
- The shortcut table, `preventDefault` rules, key-repeat policy, modifier guard, composition guard and focused-element rule.
- Revealing the controls overlay for 2 s on every handled key (via `reveal()` from T033).
- `useRevealOnFullscreenChange` (`client/src/screens/Player/useRevealOnFullscreenChange.ts`): a small effect that calls `reveal()` whenever the engine's `state.isFullscreen` changes, so the controls and cursor appear when the browser consumed `Escape`.
- Reviewing and, where necessary, tightening `toggleFullscreen()` in T030 (vendor fallbacks, silent rejection handling).
- Hiding the full-screen button where the Fullscreen API does not exist, by adding an optional `fullscreenSupported` prop to T033's overlay.
- Unit tests with fake timers.

### Out of scope
- The controls overlay UI and the `useIdleReveal` hook — T033 (this ticket imports `reveal`).
- Full-screen state. The single owner is the engine (`state.isFullscreen`, T030 §4.5), which already subscribes to `fullscreenchange` / `webkitfullscreenchange` and reads `document.fullscreenElement`. This ticket creates no second subscription, no `useFullscreenState` hook and no app-side "expected exit" bookkeeping.
- The final wording of the Escape note for end users — T041 owns the README text (see section 8).
- Engine, transitions and backgrounds — T030 to T032.
- The accessibility audit of focus handling — T036.
- Configuration-screen or explorer shortcuts. None exist in v1.
- Any error screen for a failed player. There is none (the engine exits to the configuration screen with a notice).
- End-to-end (e2e) testing is out of scope.

## 3. Prerequisites and assumed state

From T030 (`client/src/screens/Player/`):

```ts
export interface PlayerControls {
  play(): void; pause(): void; togglePause(): void;
  next(): void; previous(): void;
  toggleFullscreen(): void; stop(): void;
}
```

`usePlayerEngine` returns `{ state, controls, ... }`; `state.isFullscreen` is derived from `document.fullscreenElement` (webkit fallback) by the engine's own subscription to `FULLSCREEN_CHANGE_EVENTS`. `fullscreen.ts` exports `FULLSCREEN_CHANGE_EVENTS`, `getFullscreenElement()`, `isFullscreen()`, `isFullscreenSupported()`, `requestFullscreenSync()` and `exitFullscreenSafe()`. `Player.tsx` renders `div.player` (`role="region"`, `aria-label="Slide show"`, `data-status`, `data-fullscreen` from `state.isFullscreen`) and `stop()` exits full screen before changing the app view to `config`. T030 attaches no key listeners. `body` has the class `player-open` while the player is mounted.

From T033: `useIdleReveal(timeoutMs = 2000, options)` returning `{ visible, reveal, holdProps, overlayRef }`, the `data-chrome` attribute, and `PlayerControlsOverlay` with the props listed in T033 §4.3 (no `fullscreenSupported` prop yet). `Player.tsx` already holds `idle.reveal`.

From T024: `useAppState()` returns the `AppState` (with `view: 'explorer' | 'config' | 'player'`), and `useAppActions()` returns the stable action helpers, including `exitPlayer(opts?: { error?: string })`.

## 4. Implementation detail

### 4.1 Shortcut table

This table is verbatim from specification §9.6 (FR-16.9) and is the complete set. No other keys are bound.

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `Escape` | Stop and return to configuration (exit full screen first) |
| `←` (`ArrowLeft`) | Previous image |
| `→` (`ArrowRight`) | Next image |
| `f` / `F` | Toggle full screen |

Match on `event.key` (`' '`, `'Escape'`, `'ArrowLeft'`, `'ArrowRight'`, `'f'`, `'F'`). Do not use `event.code` for `f`, because on non-QWERTY layouts the user expects the letter printed on the key, and do not use the deprecated `keyCode`.

### 4.2 Hook signature

```ts
export interface UsePlayerKeyboardOptions {
  controls: PlayerControls;
  reveal: () => void;           // from useIdleReveal
}

export function usePlayerKeyboard(options: UsePlayerKeyboardOptions): void;
```

`Player.tsx` calls `usePlayerKeyboard({ controls, reveal: idle.reveal })`. The listener is attached in a `useEffect` on `window` (`window.addEventListener('keydown', handler)`) and removed in the cleanup. Keep `controls` and `reveal` in refs updated each render so the effect does not re-subscribe on every state change (re-subscribing would be correct but wasteful).

There is no `enabled` option: the hook lives in `Player.tsx`, which is mounted only while the view is `player` (see 4.4).

### 4.3 Handler algorithm

On each `keydown`:

1. If `event.defaultPrevented` is true, return (some other component already consumed it).
2. *Composition guard.* If `event.isComposing` is true, return. There are no text inputs in the player, so this is purely defensive.
3. *Modifier guard.* If `event.ctrlKey || event.metaKey || event.altKey`, return without doing anything and without `preventDefault`, so `Ctrl+F` (browser find), `Cmd+F`, `Alt+Left` (browser back) and similar keep their native meaning. `Shift` alone is not a guard: `F` (capital) arrives as `shiftKey === true` and must work.
4. *Focused interactive element rule.* Let `target = event.target as Element | null`. The player renders only buttons as interactive elements, so the rule covers exactly: `button`, `[role="button"]`, `a[href]`, `summary`, and text-entry controls (`input`, `textarea`, `select`, `[contenteditable]`).
   - If `target` is (or is inside) a `button`, `[role="button"]`, `a[href]` or `summary`, then `Space` is **not handled** by the player: the browser performs the native action (clicking the focused button). Arrow keys, `f` and `Escape` are still handled.
   - If `target` is (or is inside) a text-entry control, none of the keys are handled (there are none in the player today; this is defensive).

   *Decision (not specified):* this rule exists because pressing Space on the focused Pause button would otherwise toggle pause twice (once from our handler, once from the native click). Enter is never in the table, so it always keeps its native behaviour.
5. *Repeat policy* (*Decision (not specified)*): if `event.repeat` is true,
   - for `Space`, `f`/`F` and `Escape`: ignore the event (call `preventDefault` for Space so the page does not scroll, but do not act). Holding Space must not flicker pause/play, and holding `f` must not hammer the full-screen API.
   - for `ArrowLeft` / `ArrowRight`: allow, but throttled to one action per 250 ms of held key, tracked with a `lastRepeatAt` timestamp from `performance.now()` (fake timers in tests mock this through `vi.setSystemTime` or by passing a clock; see section 6). A held arrow therefore scans quickly through images without outrunning image preloading.
6. Dispatch:
   - `' '` — `event.preventDefault()`; `controls.togglePause()`.
   - `'Escape'` — `controls.stop()`. (No `preventDefault` is needed.)
   - `'ArrowLeft'` — `event.preventDefault()`; `controls.previous()`.
   - `'ArrowRight'` — `event.preventDefault()`; `controls.next()`.
   - `'f'` / `'F'` — `controls.toggleFullscreen()`.
7. For every handled key (including ignored repeats of Space/F/Escape, so the overlay does not vanish under a user who is holding a key), call `reveal()`. The reveal restarts the 2 s timer and shows the overlay and cursor. `preventDefault` is called only for Space and the arrow keys, as the specification requires.

`preventDefault` on arrows stops the page from scrolling (the player locks scrolling anyway through `body.player-open`) and stops Firefox from using them for caret browsing hints; on Space it stops scrolling and, importantly, stops the browser from "clicking" a focused element.

### 4.4 Shortcuts are inert outside the player

The hook lives in `Player.tsx`, which is mounted only when `state.view === 'player'`. Unmounting removes the listener, so the explorer and configuration screens have no key handler from this ticket. Do not register the listener at app level and gate by view; mounting-based scoping removes a whole class of leaked-listener bugs.

### 4.5 Full-screen API behaviour

Review T030's `controls.toggleFullscreen()` and make sure it matches these rules; change T030's code only if it does not.

- **Entering:** call `requestFullscreenSync()` which uses `element.requestFullscreen()` or, if missing, `element.webkitRequestFullscreen()`. It must be invoked synchronously inside the key event or click handler (browsers require a user gesture; `keydown` for `f` qualifies, an `await` before the call does not).
- **Request target** — *Decision (not specified):* keep T030's target of `document.documentElement`, not the `.player` element. T030 chose it because the Play click that enters full screen happens before the player root exists, so the same element must be used by both the Play button request and the in-player toggle; otherwise a `fullscreenElement` comparison would be inconsistent. `.player` is `position: fixed; inset: 0`, so it fills the screen either way.
- **Exiting:** `document.exitFullscreen()` or `document.webkitExitFullscreen()`, through `exitFullscreenSafe()`.
- **Rejection:** `requestFullscreen()` returns a promise that can reject (permission policy, iframe, user activation expired). Catch it and ignore silently; the show continues in fill-window mode and the button label simply stays `Enter full screen`. Do not show an error and do not log at `error` level (a `console.debug` is fine).
- **No support** (`!isFullscreenSupported()`, for example iPhone Safari): `toggleFullscreen` is a no-op. T033's overlay has no prop for this, so this ticket adds an optional `fullscreenSupported?: boolean` prop (default `true`) to `PlayerControlsOverlay`; when it is `false` the full-screen button is not rendered (the other four remain). `Player.tsx` passes `fullscreenSupported={isFullscreenSupported()}`.
- **State source:** always `state.isFullscreen` from the engine, which reads `document.fullscreenElement` (with the `webkitFullscreenElement` fallback). Never track full-screen state in a boolean that is flipped by a button or key handler.

### 4.6 The Escape caveat (FR-16.10) and reacting to the end of full screen

Behaviour required by the specification, in full:

> In native full screen the browser consumes `Escape`. The first `Escape` exits full screen only; the page receives a `fullscreenchange` event and no `keydown`. The player must detect this, remain in the player in fill-window mode (the viewport-filling layout it already uses), keep playing, and show the controls. A second `Escape` is then delivered to the page as an ordinary key event and stops the slide show.

This is browser-mandated, cannot be intercepted (the Keyboard Lock API is not used; locking `Escape` would also trap users), and must **not** be "fixed" by trying to call `preventDefault` or by treating `fullscreenchange` as a request to stop. It is documented for users in the README by T041 (see section 8).

Implementation, in a small hook next to `usePlayerKeyboard`:

```ts
// client/src/screens/Player/useRevealOnFullscreenChange.ts
export function useRevealOnFullscreenChange(isFullscreen: boolean, reveal: () => void): void {
  const previous = useRef(isFullscreen);
  useEffect(() => {
    if (previous.current === isFullscreen) return;
    previous.current = isFullscreen;
    reveal();
  }, [isFullscreen, reveal]);
}
```

`Player.tsx` calls `useRevealOnFullscreenChange(state.isFullscreen, idle.reveal)`. Why this is the whole implementation:

- The engine already subscribes to both change events and keeps `state.isFullscreen` truthful, so whoever causes full screen to end (the first browser-consumed `Escape`, `f`, the button, a browser gesture) simply flips that flag. This hook only reacts to the flip by showing the overlay and cursor; it does not distinguish the cause, because the required effect is identical in every case: stay in the player, keep the play/pause status unchanged, show the controls.
- The first `Escape` in native full screen never reaches `usePlayerKeyboard`, so the show is not stopped. The player is already a `position: fixed; inset: 0` layer, so it simply continues in fill-window mode.
- A stop-initiated exit needs no special case: `controls.stop()` exits full screen and changes the view, and the player unmounts (listeners removed) before the asynchronous change event could matter.
- The second `Escape` is a normal `keydown` and flows through 4.3 to `controls.stop()`. No state machine is needed.

*Edge:* if the user presses `Escape` during the 250 ms or so the browser takes to leave full screen on some platforms (macOS Safari), the page may see both the change and a `keydown`. This is acceptable; the worst case is the show stops, which matches what two presses would do.

### 4.7 Stop, exit and focus

`controls.stop()` (T030) exits full screen first and then calls `useAppActions().exitPlayer()`. With `Escape`, the sequence is: handler → `stop()` → `exitFullscreenSafe()` → view change. The user lands on the configuration screen; T036 decides where keyboard focus goes.

## 5. Acceptance criteria

- [ ] `client/src/screens/Player/usePlayerKeyboard.ts` and `useRevealOnFullscreenChange.ts` exist, and `Player.tsx` calls each exactly once.
- [ ] Exactly one `keydown` listener is added to `window` on mount and removed on unmount (verified by spies on `addEventListener` / `removeEventListener`).
- [ ] No code added by this ticket subscribes to `fullscreenchange` / `webkitfullscreenchange`, creates a full-screen state hook, or keeps an "expected exit" flag; grep `client/src/screens/Player/` for `expectedExit` finds nothing, and only `usePlayerEngine` (T030) subscribes to the change events.
- [ ] `Space` toggles pause and calls `preventDefault`; `ArrowLeft` / `ArrowRight` call previous / next and `preventDefault`; `Escape` stops; `f` and `F` toggle full screen. No other key calls any control.
- [ ] `preventDefault` is not called for `Escape`, `f` or any unbound key.
- [ ] Every handled key reveals the overlay and cursor for 2 s via `reveal()`.
- [ ] Events with `ctrlKey`, `metaKey` or `altKey` set are ignored and not prevented (`Ctrl+F`, `Alt+ArrowLeft`); events with `isComposing` set are ignored.
- [ ] With a button focused, `Space` is not handled by the player (the native click happens once); arrows, `f` and `Escape` still work.
- [ ] Repeated keydown events (`repeat: true`): Space, `f` and `Escape` do not act again; arrows act at most once per 250 ms.
- [ ] When full screen ends without an app-initiated request (simulated by changing `fullscreenElement` and dispatching `fullscreenchange`), the player stays mounted, `view` remains `player`, playback status is unchanged, and the overlay becomes visible.
- [ ] After that, a further `Escape` `keydown` stops the show and returns to the configuration screen.
- [ ] The same behaviour holds for `webkitfullscreenchange` with `webkitFullscreenElement`.
- [ ] Toggling with the button or `f` while in full screen exits full screen, keeps the show running, and shows the overlay.
- [ ] A rejected `requestFullscreen()` is swallowed with no unhandled rejection and no visible error.
- [ ] When the Fullscreen API is unavailable, the full-screen button is not rendered and `f` does nothing; the other four buttons remain.
- [ ] No key handling is active on the explorer or configuration screens.
- [ ] No timer or listener remains after unmount.

## 6. Tests to write

All in Vitest and React Testing Library with `vi.useFakeTimers()`, importing `describe/it/expect/vi` from `'vitest'`; use `fireEvent.keyDown(window, { key })`. Quality strategy: specification §12.3. Mock full-screen state with a small helper `setFullscreenElement(el | null)` defined in `client/test/helpers/fullscreen.ts` that uses `Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el })`, with a `webkit` variant, and `afterEach` resets it.

### `client/test/screens/Player/usePlayerKeyboard.test.tsx`
- `Space calls togglePause and preventDefault` — create the event with `new KeyboardEvent('keydown', { key: ' ', cancelable: true })` and assert `defaultPrevented`.
- `ArrowLeft / ArrowRight call previous / next with preventDefault`.
- `Escape calls stop and does not preventDefault`.
- `f and F call toggleFullscreen`.
- `unbound keys do nothing` (`a`, `Enter`, `ArrowUp`, `Tab`).
- `ctrl, meta and alt combinations are ignored` — `Ctrl+f`, `Meta+f`, `Alt+ArrowLeft`; no control called, not prevented.
- `composing events are ignored` — `isComposing: true`.
- `Shift+F is handled`.
- `Space on a focused button is not handled` — render a `<button>`, focus it, dispatch `keyDown` on it, expect `togglePause` not called; arrows on the same button still call `next`.
- `repeat: Space, f and Escape ignored; arrows throttled` — dispatch an arrow with `repeat: true` at 0, 100, 250, 260, 500 ms (using `vi.advanceTimersByTime` and `vi.setSystemTime`) and assert exactly three actions.
- `every handled key calls reveal`.
- `listener added once and removed on unmount`.
- `no handler after unmount` — unmount, fire keys, controls untouched.

### `client/test/screens/Player/useRevealOnFullscreenChange.test.tsx`
- `calls reveal when isFullscreen changes in either direction`.
- `does not call reveal on the first render or when the value is unchanged`.

### `client/test/screens/Player/Player.keyboard.test.tsx`
- `Space pauses and overlay stays visible` (integration with the real engine and overlay).
- `overlay reappears on key after hidden` — advance 2000 ms (hidden), `keyDown` ArrowRight, overlay visible for another 2000 ms and then hides.
- `fullscreenchange to not-fullscreen keeps the player mounted` — enter full screen (`setFullscreenElement(document.documentElement)` plus event), let the overlay hide, then clear it and dispatch `fullscreenchange`; expect `view === 'player'`, status unchanged, `data-chrome="visible"`.
- `second Escape exits` — continue from the previous test, `keyDown` Escape, expect the view to become `config` and `exitFullscreen` not to be called (already out).
- `first Escape (browser consumed) does not stop the show` — the change event alone never stops the show.
- `f toggles full screen` — spy on `document.documentElement.requestFullscreen` (mock returning a resolved promise), press `f`, expect one call; set the element and press `f` again, expect `document.exitFullscreen` called once and show still mounted.
- `webkit fallback` — delete `requestFullscreen`, provide `webkitRequestFullscreen`, press `f`, expect it called; use `webkitfullscreenchange` with `webkitFullscreenElement` for the exit path and assert the overlay is revealed.
- `rejected requestFullscreen is swallowed` — mock a rejected promise, press `f`, assert no unhandled rejection (`process.on('unhandledRejection')` spy) and the label is still `Enter full screen`.
- `stop while in full screen exits full screen and leaves cleanly` — click Stop while in full screen; `exitFullscreen` called, view changes to `config`, no state-update-after-unmount warning.
- `full-screen button is absent when the API is unsupported` — remove `fullscreenEnabled`/request methods, assert the other four buttons are present and `f` is a no-op.
- `explorer and config have no key handler` — render the app at `view: 'config'`, fire `Space` and `f`, nothing changes; `window.addEventListener` spy has no `keydown` registrations from the player.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] Manual check on Chromium (Windows): `f` enters full screen, first `Escape` leaves full screen and the show keeps playing with controls visible, second `Escape` returns to configuration.
- [ ] Manual check on Firefox and Safari (macOS) of the same sequence, confirming the prefixed events work.
- [ ] The user-facing wording of the Escape behaviour is T041's (its "Full screen and Escape" section is canonical); this ticket only guarantees the behaviour it describes (section 8).
- [ ] README: no change from this ticket (T041 owns the text).

## 8. Notes and gotchas

- **Do not try to "fix" the double Escape.** It is a browser security and usability rule. The README (T041) must say, in its own words, that in full screen the first Escape press exits full screen (the browser's own behaviour, not a bug), that a second Escape stops the slide show, and that the Stop button always works. T041's wording is canonical.
- **F11.** Browser-level F11 full screen is not the Fullscreen API; `document.fullscreenElement` stays `null`. The player works the same in that mode, and the full-screen button reads `Enter full screen`. Do not bind F11.
- **Listener on `window`, not on the player element.** The player root is not focusable by default and focus may be on `body` or a button. A window listener receives the key regardless.
- **Capture vs bubble.** Use the default bubble phase. T033's separate capture-phase reveal listener handles `Tab` and other unbound keys; this handler only handles the table.
- **`Space` and `event.key`.** The value is the single space character `' '`, not `'Space'`. (`event.code` is `'Space'`.) Older code that tests for `'Spacebar'` is for pre-2017 browsers and is not needed.
- **User activation.** `requestFullscreen()` must be called from a trusted user gesture. `fireEvent.keyDown` in tests is not trusted, so the tests mock the method rather than relying on it succeeding.
- **Cross-platform.** macOS Safari fires `webkitfullscreenchange` and may lack the unprefixed API on older versions; Windows and Linux Chromium and Firefox use the standard names. The engine (T030) handles both event/property paths; the tests cover both.
- **Sequence with T033.** `Player.tsx` must call `useIdleReveal` before `usePlayerKeyboard` and `useRevealOnFullscreenChange`, since both need `reveal`.
