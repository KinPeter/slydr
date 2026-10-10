# T034 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| Keyboard and fullscreen hooks exist and `Player.tsx` calls each once | PASS |
| One window `keydown` listener is added on mount and removed on unmount | PASS |
| No duplicate fullscreen-change subscription or expected-exit state is added | PASS |
| Space, arrows, Escape, and `f`/`F` dispatch the required controls | PASS |
| `preventDefault` is limited to Space and arrows | PASS |
| Handled keys reveal the controls | PASS |
| Modifier and composition events are ignored | PASS |
| Focused-button Space handling is preserved while other shortcuts work | PASS |
| Repeat policy is implemented | PASS |
| Fullscreen exit keeps the player mounted, playing, and reveals controls | PASS |
| WebKit fullscreen-change behavior is preserved | PASS |
| Fullscreen button/key toggling keeps the show running | PASS |
| Rejected fullscreen requests are swallowed | PASS |
| Fullscreen button is hidden and `f` is inert when the API is unavailable | FAIL |
| Explorer/configuration screens have no player key handling | PASS |
| No timer or listener remains after unmount | PASS |

client/src/screens/Player/fullscreen.ts:27: <MAJOR> `isFullscreenSupported()` treats the mere presence of `fullscreenElement` or `webkitFullscreenElement` as support, even when the request/exit methods and `fullscreenEnabled` are unavailable or disabled; browsers can expose the state property without permitting the API, so the player can render a fullscreen button and attempt a no-op. Base support detection on an available request method (and the supported prefixed equivalent), with the appropriate enabled check.
client/src/screens/Player/Player.tsx:90: <MAJOR> The overlay receives `isFullscreenSupported() || engine.state.isFullscreen`, so it explicitly renders the fullscreen button when the API is reported unsupported if the engine state happens to be fullscreen; this violates the ticket's required unsupported-API behavior. Pass the support result directly (or otherwise ensure the button is hidden whenever support is false).
client/test/screens/Player/usePlayerKeyboard.test.tsx:23: <MINOR> The added tests cover only basic dispatch and a subset of guards; they do not cover repeat throttling, repeated Space/F/Escape behavior, `preventDefault` boundaries, listener spies, text-entry targets, or the required timer/reveal behavior. Add the ticket's fake-timer cases and lifecycle assertions, plus integration coverage for fullscreen exit/rejection/unsupported behavior.
