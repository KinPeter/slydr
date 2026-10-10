# T036 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| T020 contrast rows are present and pass in both themes | PASS |
| Icon-only controls have exact accessible names and stable toggle labels | PASS |
| Explorer live status and existing status/Banner regions meet the live-region rules | PASS |
| Virtualized list/grid semantics hold for large fixtures | PASS |
| Configuration has one correctly labelled, keyboard-operable slider | PASS |
| Reduced-motion behaviour and configuration note are preserved | PASS |
| Headings, titles, main landmark, language, and skip link are correct | PASS |
| Focus management works for every view change and Retry outcome | FAIL |
| No positive tabindex/unreplaced outline and forced-colors coverage are present | FAIL |
| vitest-axe regression tests cover every required screen state | FAIL |
| Manual keyboard/zoom/forced-colors/reduced-motion check is recorded | FAIL |

## Findings

client/src/App.tsx:27: <severity: MAJOR> Every transition to `config` queries the Play button, so `explorer` → `config` focuses Play instead of the folder-name heading; a disabled Play button also leaves focus lost because it still matches the selector. Branch on the previous view and only use Play for `player` → `config`, falling back to the heading when disabled.

client/src/screens/Explorer/ExplorerNotices.tsx:25: <severity: MAJOR> Retry has no focus-management path: after a successful retry focus is not restored to the entries container, and after a failed retry it is not deliberately retained on Retry as required by §4.9. Add retry transition/success handling with a ref or focus callback while preserving focus on failure.

client/src/screens/Explorer/EntryList.module.css:2: <severity: MAJOR> The list stylesheet contains an unreplaced `outline: none`; it is neither scoped to `:focus:not(:focus-visible)` nor paired with a same-file `:focus-visible` replacement, violating the source-rule acceptance criterion. Remove it or add the required focus-visible replacement.

client/src/screens/Explorer/VirtualEntryList.module.css:4: <severity: MAJOR> The virtual list stylesheet contains the same unreplaced `outline: none` defect. Remove it or provide a same-file visible focus replacement.

client/src/styles/base.css:189: <severity: MAJOR> Forced-colors rules cover generic pressed/selected states and range accent color, but do not cover the required player overlay pill/buttons or the slider track/thumb with system-color borders/outlines. Add explicit forced-colors rules for those background/box-shadow-only states and verify them in the owning stylesheets.

client/test/a11y/*.a11y.test.tsx:1: <severity: MAJOR> The required vitest-axe tests for explorer, configuration, and player states (including the 1000-entry virtualized fixture) are absent; only the matcher setup/helper was added, so accessibility regressions are not automated. Add the required state coverage under `client/test/a11y/`.

PR description:1: <severity: MINOR> The required §4.11 manual keyboard, zoom, forced-colors, and reduced-motion check is not recorded in the submitted changes. Record the completed check and its results in the PR as required by the ticket.
