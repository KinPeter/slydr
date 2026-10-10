# T041 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| Root README exists with the required heading structure | PASS |
| Install/run instructions and cross-platform guidance | PASS |
| Home-folder restriction and rationale | PASS |
| Windows NTFS hidden-attribute limitation | PASS |
| Full-screen Escape behavior and second-Escape exit | PASS |
| Excluded and supported image formats | PASS |
| Thumbnail cache locations, cap, and clearing instructions | PASS |
| Keyboard shortcuts | PASS |
| Environment-variable table and `SLYDR_QUIET` semantics | PASS |
| Required development/accessibility/styling/limitations content and no badge/license text | PASS |
| `SLYDR_ROOT` test-only placement | PASS |
| README commands exist | PASS |
| Internal links, hygiene, versions, and ports | PASS |
| `docs:check` script exits successfully with 14 rules | PASS |
| Documentation tests cover the required drift cases and run in `npm test` | FAIL |
| CI runs `docs:check` after tests | PASS |

scripts/docs/test/readme.test.mjs:21: MAJOR The ticket requires a valid minimal fixture and an individual Vitest case for every check rule and listed negative scenario, but the implementation uses the real README as its only fixture and has only one aggregate drift test plus a parser test; add the prescribed `validReadme`/`validInput` fixtures and the D1–D14 and helper-rule cases.
scripts/docs/check-readme.mjs:82: MAJOR The D4 scan skips every fenced-code line, so `SLYDR_ROOT` can be added to an Install and run code block without being reported even though the rule requires it to appear only in Development/Testing; scan fenced content for the variable while continuing to ignore fences when parsing headings.

Verdict: FAIL — the README and happy-path checker pass, but the required documentation-drift test coverage is incomplete and the SLYDR_ROOT guard has a bypass.
