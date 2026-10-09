# T011 review — 2026-10-09

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| Exports and signatures | PASS |
| readdir with withFileTypes | PASS |
| Folders before files | PASS |
| Numeric collation | PASS |
| Intl.Collator at module scope | PASS |
| Dot-file hidden on all platforms | PASS |
| Windows name exact matches | PASS |
| Windows prefix matching | PASS |
| Windows list applies only on win32 | PASS |
| showHidden filtering | PASS |
| Symlink outside root omitted | PASS |
| Symlink inside root as folder | PASS |
| Broken symlink omitted | PASS |
| FIFO/socket omitted | PASS |
| Un-addressable name omitted | PASS |
| Size/mtimeMs fields | PASS |
| Counts post-filter | PASS |
| Truncation at 10001 | PASS |
| 10000 entries not truncated | PASS |
| ACCESS_DENIED on unreadable dir | PASS |
| No paths/errno in errors | PASS |
| JSDoc precondition stated | PASS |
| WINDOWS_HIDDEN_NAMES well-formed | PASS |
| **Windows junction outside root** | **FAIL** |
| **Windows name list filtering on win32** | **FAIL** |
| **Folder symlink following** | **FAIL** |

## Findings

server/test/services/listing.test.ts:735-736: **BLOCKER**: Missing Windows junction test. Spec §6 requires test case "a Windows junction pointing outside the root is omitted" with `it.runIf(process.platform === 'win32')`, created with `fs.symlink(outsideDir, link, 'junction')`. The symlink branch handles junctions correctly (Dirent.isSymbolicLink returns true for junctions and the containment check applies), but test coverage is absent. Add this test case to the basic listing structure describe block.

server/test/services/listing.test.ts:741-745: **BLOCKER**: Missing Windows hidden-name filtering integration test. Spec §6 requires two platform-conditional tests: (1) "`the Windows name list filters on win32`" with `it.runIf(process.platform === 'win32')` asserting `AppData` and `Thumbs.db` absent with `showHidden: false`, and (2) "`the Windows name list does not filter on POSIX`" with `it.skipIf(process.platform === 'win32')` asserting they are present on POSIX. While the fixture creates AppData/Thumbs.db only on win32 and the counts test implicitly validates filtering, an explicit assertion is required. Add these tests after the existing hidden entries tests.

server/test/services/listing.test.ts:716-718: **BLOCKER**: Missing folder symlink following test. Spec §6 requires test case "a folder symlink inside the jail is followed" — call `listDirectory` on the resolved target of `link-inside` (with `wireDir: 'link-inside'`) and verify it returns the entries of `Pictures` with `path` values `link-inside/<name>`. The existing test at line 370-383 only verifies classification as a folder, not navigation into its contents. Add this test case to verify folder symlinks are followed and paths are built correctly.

No other findings.
