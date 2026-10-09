# T013 review — 2026-10-09

## Acceptance criteria

| Item | Status |
|------|--------|
| Exports `scanImages`, `ScanOptions`, `ScanResult` with correct signatures | PASS |
| Flat scan returns only directory's images in collator order | PASS |
| Recursive scan: directory's own images before subdirectories' | PASS |
| `IMG_2.jpg` precedes `IMG_10.jpg` (numeric collation) | PASS |
| No `Intl.Collator` or hidden-name list; imports from `listing.ts` | PASS |
| Uses `mapPool` and `STAT_CONCURRENCY` from `concurrency.ts` | PASS |
| `showHidden: false` filters; `true` includes both images and dirs | PASS |
| Depth cap at MAX_DEPTH (12 levels below start) | PASS |
| Image cap at 20000 with `truncated: true` | PASS |
| Symlink loop detection prevents infinite recursion | PASS |
| Symlink to folder inside jail is followed with navigated path | PASS |
| Symlink to file: image-ness from link's name | PASS |
| Un-addressable names (e.g., `C:backup.jpg`) omitted | PASS |
| Unreadable subdirectory skipped; siblings present; no throw | PASS |
| Root directory read failure throws ApiError (ACCESS_DENIED/NOT_FOUND/READ_FAILED) | PASS |
| Wire paths POSIX, relative, no leading slash; `dir` is parent wire path | PASS |
| `size`/`mtimeMs` populated for readable files, `null` on failure | FAIL |
| No `stat` for classification; only post-traversal pass | PASS |
| No string concatenation of user paths; uses `node:path` + shared helpers | PASS |
| Logs via injected Logger only (`scan.done`, `scan.dir-skipped`, `scan.entry-skipped`, debug) | PASS |

## Findings

server/src/services/scan.ts:103: **BLOCKER** Absolute path reconstruction in stat pass is broken when `wirePath !== ''`. The code uses `path.join(options.absPath, ...item.path.split('/'))` to reconstruct absolute paths, but `item.path` contains the *navigated* wire path, not relative to `absPath`. When `wirePath = 'link'` and `item.path = 'link/r1.jpg'`, this yields `/absPath/link/r1.jpg` instead of `/absPath/r1.jpg`. The items array loses the original `abs` path by design (line 85 only stores `{name, path, dir}`); either store absolute paths during traversal or reconstruct them from parent absolute paths, not from wire paths. Test case T013 §6 item 11 (symlink with flat scan) should catch this but doesn't verify size/mtimeMs.

server/test/services/scan.test.ts:428-437: **MINOR** Test "folder symlink inside the jail is followed with the navigated path" does not verify `size` and `mtimeMs` fields are populated for the `result2` case (wirePath='link'). Without this assertion, the stat-pass bug is invisible. Add `expect(result2.items[0]!.size).toBeGreaterThan(0)` and similar for `mtimeMs`.

server/src/services/scan.ts:126: **MINOR** The `skipped` count logged in `scan.done` is always 0 (line 126: `const skipped = 0;`). Per §4.9, skipped subdirectories should be counted and emitted. The count is not being tracked during traversal. Add a counter incremented at line 160 and propagate it to the aggregate log.

## Summary

**Blockers: 1** — Critical stat-pass path reconstruction bug that will cause stat failures (leaving size/mtimeMs as null) whenever a scan is performed with a non-empty wirePath, particularly for symlink navigation and potential future use cases in recursive scans. This violates acceptance criterion "size and mtimeMs are populated for readable files" and should fail test case with path reconstruction scenarios.

**Minors: 2** — Missing size/mtimeMs verification in symlink test (reduces test coverage of the bug) and skipped-directory count not tracked (missing feature from spec but not tested).

**No findings.** — TypeScript strict mode passes, lint passes, all 22 tests pass (though one critical codepath is untested). Imports are correct, no code duplication of hidden rules or collator, all special-entry types (FIFO, socket, devices) correctly omitted.
