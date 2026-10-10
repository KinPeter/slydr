# T030 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| Player exists and is rendered for `view === 'player'` | PASS |
| Play-order exports have the required signatures | PASS |
| Unshuffled order is identity | PASS |
| Shuffled order is a permutation | PASS |
| `cryptoRandomInt` uses rejection sampling | PASS |
| Shuffled order avoids `avoidFirst` | PASS |
| No `setInterval` in the player | PASS |
| One scheduling timeout (plus linger backstop) | PASS |
| Scheduling uses `performance.now()` | PASS |
| Decode gate prevents premature advance | PASS |
| At most three foreground image layers | PASS |
| Pause preserves image and stops timer | FAIL |
| Manual moves reset duration and use `manual` reason | PASS |
| Manual moves use the decode gate and accumulate | FAIL |
| Paused manual move remains paused without a timer | PASS |
| Looping and non-looping end behavior | PASS |
| Clamped manual moves are no-ops | PASS |
| Failed images are skipped | FAIL |
| All failures exit with the required notice | PASS |
| Index re-export exists and placeholder is deleted | PASS |
| No JSX return annotation or indexed-read non-null assertion | PASS |
| Fill-window CSS declarations | PASS |
| Contain fitting and no cover fitting | PASS |
| `body.player-open` lifecycle | PASS |
| Fullscreen request remains in the config click handler | PASS |
| Rejected fullscreen requests are swallowed | PASS |
| Fullscreen state is DOM-derived and event-updated | PASS |
| Wake-lock lifecycle and visibility reacquisition | PASS |
| No theme switch in the player | PASS |
| No player fetch/list request | PASS |
| Background/overlay/animation seams exist | PASS |

Findings:

client/src/screens/Player/usePlayerEngine.ts:324: MAJOR `play()` calls `beginTimer()`, but `beginTimer()` unconditionally resets `remaining` to `durationMs`; resuming after a pause therefore gives the current slide a full duration instead of only the remaining time. Preserve the paused remainder when starting the resume timeout, and add the required fake-timer test.
client/src/screens/Player/usePlayerEngine.ts:129: MAJOR The current slide's scheduling timeout is left live when a current-image error triggers `move(1, 'auto')`; while the replacement is still decoding, the old timeout can fire and request another move, violating immediate failure skipping and potentially accumulating pending moves. Cancel/reset the scheduling timer before failure-driven movement, and cover current-image failure with a test.
client/src/screens/Player/usePlayerEngine.ts:225: MAJOR A layer's `decode()` promise can resolve after its `onError` callback has marked the same slide failed; the resolution unconditionally marks it decoded and can commit the unreadable pending target. Ignore late decode success for paths/keys already failed, or invalidate the decode attempt when failure is reported.
client/src/screens/Player/Player.tsx:12: MAJOR `usePreloader` is implemented but never wired into `Player` or the engine, so the required off-DOM prefetch/decode of the entry two places ahead never occurs. Pass the actual upcoming sources/order through the preloader seam and add the bounded-cache/end-of-order tests required by §4.12.
client/test/screens/Player/playOrder.test.ts:1: MAJOR The ticket adds only play-order tests; none of the required engine, presentation/fullscreen, wake-lock, preload, decode-gating, timer, failure, or three-image-budget tests exist. Add the prescribed component tests under `client/test/screens/Player/` so the new stateful logic and regressions are exercised.

No functionality questions require escalation; the ticket specifies the disputed behaviors sufficiently.
