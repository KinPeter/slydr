# T020 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| `tokens.css` exists and defines every token named in §6.4 | PASS |
| `--player-bg` is `#ffffff` light / `#000000` in both dark blocks | PASS |
| `--slide-transition-duration` is `700ms`, `--kenburns-scale` is `1.06`, declared only in `tokens.css` | PASS |
| Exactly four top-level theme blocks with the §6.3 selectors | PASS |
| `color-scheme: dark` in both dark blocks, none in `base.css`, forced-theme native widgets match | PASS (mechanism verified; live widget check is a manual PR step per §7) |
| `--slide-out-scale-from` is `var(--kenburns-scale)`, other three crossfade scales are literals | PASS |
| Two dark blocks declare the same properties with the same values; a test asserts this | PASS |
| `data-theme='light'` on dark OS yields light, `'dark'` on light OS yields dark, removal returns to OS | PASS (selectors correct; live cascade check is manual per §8, jsdom cannot evaluate it) |
| `base.css`: `box-sizing: border-box`, `html` `font-size: 100%`, `body` `font-family: var(--font-ui)` + `font-size: var(--text-md)` | PASS |
| `:focus-visible` outline from `var(--focus-ring)` with non-zero offset; no bare `outline: none` outside `:focus:not(:focus-visible)` (plus the ticket's own `box-shadow`-paired `.focus-ring-inset` exception) | PASS |
| `base.css` documents breakpoints 480/768/1024/1440; `tokens.css` mirrors `--bp-sm/md/lg/xl` | PASS |
| `overflow-x: clip` + `max-width: 100%` on `body` only, no `overflow` on `html`, no `hidden`; `--page-gutter: 1rem` with `.page-gutter` safe-area utility | PASS |
| Global `:focus-visible` sets no `border-radius` | PASS |
| No horizontal scrollbar at 320 px with ≥16 px gutter | PASS (mechanism verified; screenshots are a manual PR step per §7) |
| `main.tsx` imports `tokens.css` then `base.css`, in that order, before `App` | PASS |
| No hex / `rgb()` / `hsl()` / named colour outside `tokens.css`; guard enforced | PASS |
| No `@import url(...)`, remote `<link>`, or remote font; `--font-ui` is a pure system stack | PASS |
| `client/src/lib/cx.ts` exists, no classnames dependency added | PASS |
| Every contrast pair in the §4.2 table (incl. both overlay rows, `--border` on all surfaces, both themes) asserted and passing | PASS |
| Three test files live in `client/test/styles/` and are discovered by `npm test` | PASS |

Verification run: `npm run typecheck` clean, `npm run lint` (zero warnings) clean, `prettier --check` on all 8 new/touched files clean, `npm test` green (39 files, 794 passed, 6 skipped — incl. the 4 new files, 58 tests).

No findings.
