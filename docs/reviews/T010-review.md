# T010 review — 2026-10-09

## Acceptance Criteria

| Criterion | Result |
|-----------|--------|
| Exports setJailRoot, getJailRoot, resetJailRootForTests, resolveSafe, isWirePathAcceptable, isContained, toWirePath, assertDirectory, assertFile, mapFsError | PASS |
| Targets and root resolved with fs.realpath.native (no plain fs.realpath call in server/src) | PASS |
| Each eight §3.3 steps identifiable by numbered comment | PASS |
| resolveSafe('') returns exactly the cached jail root | PASS |
| resolveSafe throws INVALID_PATH (400) for NUL byte, 4097 chars, leading /, C:\Windows, \\server\share, and (Windows-only) backslashes | PASS |
| toWirePath converts ..cache and ... without throwing | PASS |
| resolveSafe throws OUTSIDE_ROOT (403) for any .. segment | PASS |
| resolveSafe throws NOT_FOUND (404) for non-existent paths | PASS |
| resolveSafe throws OUTSIDE_ROOT for symlinks outside root (all platforms) | PASS |
| resolveSafe succeeds for symlinks inside root, returning target's real path | PASS |
| resolveSafe throws OUTSIDE_ROOT for Windows junctions outside root | PASS |
| toWirePath(root) returns ''; toWirePath(join(root, 'Pictures', '2024')) returns 'Pictures/2024' on all platforms | PASS |
| toWirePath throws plain Error (not ApiError) for paths outside root | PASS |
| assertDirectory/assertFile throw NOT_A_DIRECTORY/NOT_A_FILE with status 400 | PASS |
| mapFsError returns ACCESS_DENIED for both EACCES and EPERM | PASS |
| No ApiError carries absolute path or errno in message; detail in cause | PASS |
| getJailRoot() throws clear Error when root never set | PASS |
| Repository-wide grep confirms path.join/path.resolve never applied to request parameter outside jail.ts | PASS |

## Summary

All acceptance criteria met. Implementation complete and correct.

**Test results:** 80 passed, 2 skipped (82 total) on Windows.

## Findings

No findings. Implementation is comprehensive, secure, and well-tested.
