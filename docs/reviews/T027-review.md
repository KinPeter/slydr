# T027 review — 2026-10-10

## Acceptance criteria

| Criterion | Result |
|---|---|
| Grid components, queue, metrics, hooks, and Explorer wiring exist | PASS |
| Queue has no direct `fetch` and uses `DEFAULT_THUMB_SIZE` | PASS |
| Pointer handlers are delegated and tiles have no handlers/tab stops | PASS |
| Queue cancellation clears queued/in-flight work and frees slots | PASS |
| `gridMetrics.ts` owns the grid minimums and column formula | PASS |
| CSS responsive minimums are 104/132/160 px | PASS |
| Grid is square and does not horizontally overflow at 320 px | PASS |
| Image/folder/file media selection is correct | PASS |
| Thumbnail size is the shared 256 px default | PASS |
| Names have two-line clamping and a full-name title | PASS |
| Queue never exceeds six in-flight requests | PASS |
| Observer uses the explorer body and `100% 0px` root margin | PASS |
| Pending requests cancel when they leave the observed range | PASS |
| Aborted requests call neither callback | PASS |
| Thumbnail failures silently render the image icon | PASS |
| Unsupported images silently render the image icon | PASS |
| Object URLs are revoked on load and unmount | PASS |
| Cached responses drain without an artificial timer | PASS |
| Grid/row/gridcell ARIA structure and active descendant are present | PASS |
| Two-dimensional keyboard navigation and clamping are implemented | PASS |
| Highlight survives switching between list and grid | FAIL |
| `useGridColumns` measures and re-measures the grid | PASS |
| View-mode persistence and invalid-value fallback remain wired | PASS |
| Hidden tiles have no hidden-specific visual styling | PASS |
| Required component/unit tests and theme/viewport verification are present | FAIL |

## Findings

client/src/screens/Explorer/thumbnailQueue.ts:45: <severity: MAJOR> A cancelled in-flight entry remains in `inFlight` until its promise settles, but a re-request for the same key coalesces onto that already-cancelled entry. A tile that leaves and rapidly re-enters (or is re-requested after `cancelAllThumbnails`) can therefore never start a new request or receive either callback; exclude cancelled entries from coalescing and arrange a fresh request after the old entry releases its slot.

client/src/screens/Explorer/useThumbnail.ts:9: <severity: MAJOR> The observer registry is a strong `Map` rather than the specified `WeakMap`, and callbacks are never removed when a tile is unobserved/unmounted. Every mounted tile's callback and React closures remain retained for the lifetime of the scroll root, causing substantial memory growth in large folders and across navigation; remove callback registrations and use weak root records as specified.

client/src/screens/Explorer/EntryGrid.tsx:20: <severity: MAJOR> Grid owns a separate `useGridHighlight` state instead of reusing T026's `useEntryHighlight` state/actions, so switching list → grid (or grid → list) loses the highlighted entry and violates the required highlight-preservation behavior; share the existing highlight state or lift it to the Explorer.

client/test/screens/Explorer/thumbnailQueue.stub.test.ts:1: <severity: MAJOR> The ticket's required queue, IntersectionObserver/useThumbnail, EntryGrid, keyboard, view-mode, cancellation, fallback, and object-URL tests are absent; only the old eight-line stub test and two minimal grid-metrics assertions exist. Add the prescribed tests (including controllable observer and mocked thumbnail API) before treating the six-request/cancellation/accessibility behavior as covered.
