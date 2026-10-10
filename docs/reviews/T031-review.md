# T031 review — 2026-10-10

## Acceptance criteria

| Criterion | Result |
|---|---|
| `PlayerBackground.tsx` exports the required component and props | PASS |
| `Player.tsx` wires the component through `PlayerStage.background` | PASS |
| Flat mode renders exactly one `.flat` and no image | PASS |
| Flat mode uses `var(--player-bg)` | PASS |
| Cover source is identical to the slide source | PASS |
| No-extra-network-request guarantee is covered by a DOM source test | FAIL |
| Cover uses the required cover, scale, blur, brightness and saturation rules | PASS |
| No token is added or duplicated | PASS |
| Scale is above 1 and has blur-rim rationale | PASS |
| No animated filter / no `will-change: filter` | PASS |
| Cover uses `will-change: transform` | PASS |
| Only incoming cover opacity-fades with the shared duration/easing | PASS |
| Fade uses CSS only | PASS |
| At most two keyed covers are rendered and the current-to-previous node is retained | PASS |
| Background content is decorative and images have empty alt text | PASS |
| Background ignores image failures and hides the failed cover | PASS |
| Background is absolute, clipped, full-size and pointer-transparent | PASS |
| No JavaScript/theme branching or player theme switch is introduced | PASS |
| Reduced-motion media rule disables the background fade | PASS |
| New logic has the prescribed component/integration test coverage | FAIL |

## Spec compliance

The implementation has the required three-layer wiring, flat and blurred-cover styling, source reuse, accessibility hiding, failure fallback, and reduced-motion CSS. Typecheck, lint, all tests, and format check pass. However, the initial/current cover is always given `.coverIn`, including when there is no `previous` slide, so the first slide fades in instead of appearing immediately as required by §9.4 and T031 §4.5.

## Findings

client/src/screens/Player/PlayerBackground.tsx:50: MAJOR The current cover receives `styles.coverIn` even when `previous` is null, so the first slide (and any no-outgoing-cover replacement) runs the 700 ms fade and exposes the flat layer, violating the immediate-first-slide/no-transition rule. Apply the incoming animation class only when an outgoing `previous` cover exists, and add a regression test for the null-previous case.

client/test/screens/Player/PlayerBackground.test.tsx:16: MINOR The required test coverage is incomplete: there is no explicit first-slide/no-fade assertion, no loop-boundary key/remount assertion, and no test that proves the background source is already present on a rendered foreground layer (the required no-extra-request guarantee). Add the prescribed focused tests, including the PlayerStage integration test.

## Fixer decision

A fixer pass is required because the initial background fade is a MAJOR behavioral defect. The missing regression/integration coverage should be added in the same pass.
