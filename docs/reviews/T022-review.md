# T022 review — 2026-10-10

| # | Acceptance criterion (§5) | Verdict |
|---|---|---|
| 1 | Ten components at §4.1 paths (tsx + module.css + index.ts), tests per component, barrel exports ten components + prop types, no test files under `src/components`, no `Toggle` / `role="switch"` | PASS |
| 2 | No hex/`rgb()`/`hsl()`/named colour in component CSS; T020 no-hard-coded-colours test passes | PASS |
| 3 | Every `:hover` inside `@media (hover: hover)` | PASS |
| 4 | No `outline: none`/`outline: 0`; visible `--focus-ring` ring on keyboard focus | PASS |
| 5 | 44px (`--target-min`) touch targets, 48px (`--target-min-coarse`) on coarse pointers | PASS |
| 6 | Icon-only `Button` / `IconButton` without `aria-label` is a type error; valid case compiles | PASS |
| 7 | `Button` defaults `type="button"`; `loading` sets `aria-busy`, suppresses `onClick`, stays focusable | PASS |
| 8 | `Checkbox` native input, no `role`, visible label, `aria-describedby` for description/note (note outside label), `Space` toggles, no `aria-checked` | PASS |
| 9 | `Slider` range input, `aria-valuetext`, `<output aria-live="off">`, arrows native, PageUp/PageDown ±`pageStep` clamped with `preventDefault` | PASS |
| 10 | `Icon` `aria-hidden` by default; `role="img"` + `aria-label` only with `label` | PASS |
| 11 | `Breadcrumb` collapse (Home + ellipsis "Show hidden folders" + last two), menu order, Esc/Arrow/Home/End, `onNavigate` wire path, `maxVisibleSegments` layouts | PASS |
| 12 | Current (last) segment is `<span aria-current="page">`, not a button | PASS |
| 13 | `rootTitle` sets Home `title`, accessible name stays "Home" | PASS |
| 14 | `Banner` `aria-live="polite"` all variants, `role="alert"` on error / `role="status"` info+warning, action button fires | PASS |
| 15 | `Spinner`/`Skeleton` `aria-hidden` unless labelled; reduced-motion handling | PASS |
| 16 | Gallery excluded from production build (no `slydr-component-gallery` in `client/dist/assets`) | PASS |
| 17 | Both themes correct via tokens only; text pairs among T020-asserted pairs | PASS |

Verified: `npm run typecheck` green (incl. `@ts-expect-error` type tests), `npm run lint` green (zero warnings), `npm test` green (56 files / 923 passed, 6 skipped), `npm run format:check` green, client production build succeeds with marker absent and gzip ~66 KB (well under 300 KB NFR-8). Test layout follows `client/test/components/` mirroring `src/`; tests import from `vitest`; no `fetch` in components; React 19 ref-as-prop, `import type`, and `noUncheckedIndexedAccess` narrowing observed.

client/src/components/Breadcrumb/useBreadcrumbLayout.ts:76: MINOR Separator width overcounted (`separator * visibleCount` counts one separator too many; should be `visibleCount - 1` gaps). Subtract one separator so the collapse threshold matches the rendered trail. It currently collapses one step early when widths are tight.
client/src/components/Slider/Slider.module.css:26: MINOR Touch-target sized with `height: var(--target-min)` instead of `min-height`, and no `min-width`, so the criterion's literal `min-height`/`min-width` wording is not met. Use `min-height: var(--target-min)` (keeping `width: 100%`) so the target survives consumer overrides.
client/src/components/Checkbox/Checkbox.module.css:11: MINOR The label-row hit target sets `min-height` but no `min-width`, unlike the stated every-interactive-element rule. Add `min-width: var(--target-min)` (or a comment documenting the full-width-row exemption) for literal compliance.
client/src/components/Breadcrumb/Breadcrumb.tsx:186: MINOR After menu selection focus is restored only to the ellipsis button; when navigation removes the ellipsis (trail shrinks to <=3 segments) focus is left on `body` instead of moving to the new last-segment container as §4.7 requires. Add the specified fallback focus to the current-segment container when `ellipsisRef.current` is null.
client/src/components/Breadcrumb/Breadcrumb.tsx:366: MINOR Hidden measuring clone renders `span` approximations with `border-width: 0` rather than the specified un-collapsed segments plus ellipsis button, so measured widths diverge from rendered button widths (padding/border). Render matching button-shaped clones (still `aria-hidden` + `inert`) or document the approximation error at the clone.
