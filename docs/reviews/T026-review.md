# T026 review — 2026-10-10

## Acceptance criteria

| # | Criterion | Result |
|---:|---|---|
| 1 | Explorer files are present, placeholder is deleted, and `App` imports the directory export | PASS |
| 2 | First run fetches root/list and caches `getRoot` | PASS |
| 3 | A stored path is listed on load | PASS |
| 4 | Failed restored paths fall back to root with the required notice | PASS |
| 5 | Notices are outside the scroll element | PASS |
| 6 | Scroll context provides the body element | PASS |
| 7 | Pointer delegation and row handler/tab-stop contract | PASS |
| 8 | User navigation cancels thumbnails and failed navigation retains prior state | FAIL |
| 9 | List is the default view | PASS |
| 10 | Rows show the required fields and omit folder size | PASS |
| 11 | Row touch/desktop heights meet the minimum | PASS |
| 12 | Correct icons are used and list view never requests thumbnails | PASS |
| 13 | Show-hidden refetches and does not visually distinguish hidden rows | PASS |
| 14 | Single/double click behavior | PASS |
| 15 | Selects the current folder, including empty folders | PASS |
| 16 | Listbox/option ARIA contract | PASS |
| 17 | Keyboard navigation and root no-op behavior | FAIL |
| 18 | Up button is disabled exactly at the root | PASS |
| 19 | Loading, empty, error/retry, and truncation states | FAIL |
| 20 | Quick successive navigation aborts the old request and renders only the latest | PASS |
| 21 | Breadcrumb collapse behavior is delegated to `Breadcrumb` | PASS |
| 22 | Server order is preserved | PASS |
| 23 | Responsive sizing/header and no horizontal page scrolling | PASS |
| 24 | Exactly one visually hidden `Choose a folder` h1 | PASS |
| 25 | Both themes meet contrast requirements | FAIL |

## Findings

client/src/screens/Explorer/useDirectoryListing.ts:47: <severity: MAJOR> When a user navigation fails, the hook resets `requestedPath` to the previous listing, which immediately triggers the effect at line 38 and refetches that folder; this clears the error before the user can see or retry it and violates the required “previous rows + inline error” behavior. Keep the requested path separate from the retry path (or suppress the automatic effect after reverting) so the error remains until Retry.
client/src/screens/Explorer/Explorer.tsx:76: <severity: MAJOR> The loading state renders twelve generic one-em-height `Skeleton` blocks rather than twelve fixed-height skeleton rows containing square icon placeholders and varying name bars, and the loaded-navigation state has no slim progress indicator. Implement the specified skeleton-row and in-place navigation-loading markup/styles.
client/src/screens/Explorer/useEntryHighlight.ts:38: <severity: MAJOR> At the jail root, `Backspace` and `Alt+ArrowLeft` fall through without `preventDefault()`, so they are not guaranteed no-ops and can invoke browser history navigation. Always prevent the handled keys, including when `parentPath === null`, while only calling `navigate` when a parent exists.
client/test/screens/Explorer/:1: <severity: MAJOR> The ticket requires component coverage for opening/restoration, list rendering, navigation, keyboard access, header/footer, and all four states, but the change adds only `formatBytes` and the thumbnail stub tests. Add the required Explorer component tests (including the failed-navigation, abort, fallback, retry, accessibility, and responsive-state contracts) under the prescribed directory.
client/src/screens/Explorer/EntryList.module.css:12: <severity: MINOR> The row hover rule applies unconditionally; the specification requires hover styling to be guarded by `@media (hover: hover)` so touch devices do not retain/flash hover state. Move `.row:hover` into that media query.
