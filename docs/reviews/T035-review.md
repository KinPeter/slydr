# T035 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| Canonical media-query widths | PASS |
| No pixel font sizes, root-size override, or global hidden horizontal overflow | PASS |
| Hover rules are guarded or annotated | PASS |
| Responsive breadcrumb cap, menu ordering, and listener cleanup | PASS |
| Explorer scrollbar gutter, safe-area padding, and touch-action declarations | PASS |
| Responsive explorer header breakpoints | PASS |
| Responsive list size column and row heights | PASS |
| Responsive grid bands | PASS |
| Responsive configuration column | PASS |
| Responsive player pill | PASS |
| Player tap reveal, swipe exclusion, and verbatim comment | PASS |
| Five-viewport, two-theme no-horizontal-scroll sweep | FAIL |
| Single matchMedia helper with installViewport | PASS |
| §6.3 checklist pasted into the pull request description | FAIL |

Findings:

client/test/screens/Explorer/responsive.css.test.ts:12: <MINOR> The responsive CSS test does not assert the required header row/track or 1024px label breakpoint, so regressions in the core header responsive contract can pass the tripwire. Add source assertions for the below-768 `nav`/two-row rule, the 768px single-row flexible `minmax(0, 1fr)` track, and the 1024px label split.
tasks/T035-responsive-pass.md:203: <MAJOR> The required real-browser sweep at 320×568, 768×1024, 1366×768, 1920×1080, and 3840×2160 in both themes is not recorded or otherwise evidenced in the changes. Run the sweep and attach the completed §6.4 checklist/screenshots to the pull request.
tasks/T035-responsive-pass.md:171: <MAJOR> The required §6.3 checklist is not available in this review context or represented by a pull-request record. Paste the completed checklist into the pull request description.
