# T033 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| Overlay and `useIdleReveal` files/signatures; no fullscreen hook | PASS |
| Five buttons, order, labels, and 1-based counter | PASS |
| Pause/play icon and label state | PASS |
| Fullscreen icon and label from engine state | PASS |
| Overlay token colours | PASS |
| Bottom-centred pill layout and visual tokens | PASS |
| Exact 2-second idle expiry | PASS |
| Pointer/touch activity reveals and restarts timer | PASS |
| Hover, focus, and paused holds | PASS |
| `data-chrome` and hover-only cursor hiding | PASS |
| Hidden visibility and inert behavior | PASS |
| Keyboard reveal and first-Tab focus behavior | PASS |
| Hidden-overlay tap only reveals | PASS |
| Focus rings and target sizing | PASS |
| 320px layout and no overflow | PASS |
| Breakpoint and backdrop-filter CSS constraints | PASS |
| Fade timing and reduced-motion behavior | PASS |
| Stop delegates to engine exit behavior | PASS |
| Timer/listener cleanup on unmount | PASS |

client/test/screens/Player/Player.controls.test.tsx:3: MAJOR The required player integration suite is a placeholder that only asserts `true`, so the changed `Player` wiring is not tested at all; replace it with the ticket's integration cases for auto-hide/cursor state, pause/hover/focus holds, touch reveal, keyboard reveal/focus, stop, fullscreen state, and the counter.

client/test/screens/Player/useIdleReveal.test.tsx:8: MAJOR The hook suite covers only initial expiry and one paused/reveal path; it omits the required pointer/touch listeners, hover and focus release semantics, hold-to-unhold timing, exact listener/timer cleanup, and post-unmount behavior; add those fake-timer tests before relying on this hook.
