# T028 review — 2026-10-10

| Acceptance criterion | Status |
|---|---|
| Uses the existing `@tanstack/react-virtual` v3 dependency without package changes | PASS |
| Defines the four virtualization constants once with the required values | PASS |
| Threshold behavior is 200 non-virtualized and 201 virtualized in both views | PASS |
| Hysteresis and path reset behavior | PASS |
| Virtualized list/grid window size stays within the specified bounds | PASS |
| Virtualized list total size represents the full collection | PASS |
| Required container roles, tab stop, label, and no item tab stops | PASS |
| `aria-activedescendant` remains valid through highlight jumps and scrolling | PASS |
| Collection-size and position ARIA attributes | PASS |
| Stable `slydr-entry-{index}` IDs | PASS |
| Grid column count matches `columnsFor` | PASS |
| Existing `useTileMin` breakpoint behavior is retained | PASS |
| Resize/breakpoint remeasurement and first-visible-entry anchoring | FAIL |
| Home/End/PageUp/PageDown behavior and virtual scrolling | FAIL |
| Thumbnail cancellation on unmount | PASS |
| Six-request thumbnail cap | PASS |
| Single body scroll container and shell placement | PASS |
| Truncation banner and end-of-list behavior | PASS |
| Notices do not add virtualizer scroll margin/remeasurement | PASS |
| Delegated pointer handling, handler-free items, and clean lint | PASS |
| Folder navigation resets scroll position | PASS |
| Required performance measurement procedure and reported results | FAIL |
| No hard-coded colors or spacing values | PASS |

## Findings

client/src/screens/Explorer/useVirtualGrid.ts:15: <severity: MAJOR> Column changes do not preserve the first visible entry: there is no anchor capture before a column change and no `scrollToIndex` correction afterward. Track the old first visible row/entry and restore that entry after the new column count is applied.
client/src/screens/Explorer/VirtualEntryList.tsx:31: <severity: MAJOR> Virtualized list PageUp/PageDown uses a hard-coded 48px row height, so coarse-pointer layouts (56px) and any measured CSS row height move by the wrong page size. Reuse `useRowHeightEstimate`/the actual measured row height when calculating the page size.
client/src/screens/Explorer/VirtualEntryGrid.tsx:30: <severity: MAJOR> Virtualized grid PageUp/PageDown uses `rowEstimate` rather than the measured row stride required by §4.7, so wrapped names or responsive tile dimensions can produce incorrect page jumps. Maintain/read the measured row height for the page-size calculation.
client/test/screens/Explorer/virtualization.test.tsx:1: <severity: MAJOR> The ticket's required component coverage is absent: only one combined hysteresis test exists, with no `virtualGeometry` helper and no VirtualEntryList/VirtualEntryGrid rendering, ARIA, keyboard, resize, delegation, active-descendant, thumbnail-cap, or cancellation tests. Add the specified tests under `client/test/screens/Explorer/` and the shared geometry helper under `client/test/helpers/`.
tasks/T028-explorer-virtualization.md:574: <severity: MAJOR> The required §4.11 measurement procedure has not been run or reported (DOM bounds, warm listing median, long-task/frame results, and throttled run). Run it against the production build and record the results in the PR description before accepting the ticket.

## Overall verdict

FAIL — the implementation typechecks, lints, and passes the existing suite, but it misses required scroll anchoring, exact page-size behavior, comprehensive component tests, and the mandatory performance evidence.
