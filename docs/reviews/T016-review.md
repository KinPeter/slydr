# T016 review — 2026-10-09

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| API exports in §4.2, no import-time side effects | FAIL |
| `service.getThumbnail` returns valid WebPs at correct sizes | PASS |
| Cache key formula matches spec | PASS |
| Cache hits work and renderer not invoked on second request | PASS |
| Edit invalidation works (mtime/size changes) | PASS |
| Size validation rejects outside allowlist before FS access | PASS |
| Sharp pipeline exactly as specified | PASS |
| EXIF orientation applied, no metadata in output | PASS |
| Centre cover crop, not stretch | PASS |
| Partial file not observable during render | PASS |
| Failure cleanup removes temp file | FAIL |
| Semaphore enforces limit, FIFO, releases on rejection | FAIL |
| N concurrent calls render once, coalesce correctly | PASS |
| Decode/resize failures map to THUMBNAIL_FAILED 500 | PASS |
| Cache directory created recursively, relative path rejected | PASS |
| Shard-vanished retry works (tests skipped) | SKIP |
| Failure logged at warn, success at debug | PASS |
| Rename retried on transient errors; destination-exists succeeds | PASS |
| Touch refreshes atime/mtime; recent hits do not | PASS |
| Source delete succeeds after render (file handles released) | PASS |

## Findings

server/src/services/thumbnails.ts:137-143: **MAJOR** Semaphore getter property names do not match spec. Spec §4.7 defines `get active(): number` and `get waiting(): number`, but implementation exports `activeCount` and `waitingCount`. This breaks the contract tests expect and T018 may rely on.

server/src/services/thumbnails.ts:182: **MAJOR** Module-level state violates §4.1 requirement "no module-level state". The `sharpConfigured` flag is a process-wide singleton. Move it into a per-instance state or document why it must be global.

server/src/services/thumbnails.ts:151-159: **MINOR** `sharpInputOptions` return type should be `sharp.SharpOptions` per spec §4.5, not `Record<string, unknown>`. Impacts type safety and IDE support.

server/src/services/thumbnails.ts:432: **MAJOR** Failure logging missing `errorFields(err)`. Spec §4.10 requires "one log line ... with `errorFields(err)`, the key, the size and the absolute path." Current implementation logs only `{ key, size, absPath }` without calling `errorFields()` from the logger. Import it from `../logger.js` and include it.

server/src/services/thumbnails.ts:408-421: **MAJOR** Cleanup logic violates spec. Spec §4.6 step 5 explicitly requires `await fs.rm(tmpPath, { force: true })` to clean only the specific temp file created. Implementation instead reads the entire shard directory and deletes all `.tmp` files, which could delete orphaned files from other crashes and is a logic mismatch. Replace with direct cleanup of the `tmpPath` variable.

server/test/helpers/images.ts:216: **MINOR** `fakeRender` handle lacks `deferred()` support mentioned in spec §6 test helpers. The function signature allows a gate pattern but the implementation's gate/resolve mechanism uses a simple array push; this works but is less clean than the spec's suggested approach. Consider if tests actually need this or if current implementation is sufficient.

server/test/services/thumbnails.test.ts:1592,1660: **INFO** Two test cases marked `.skip`: "shard directory removed between mkdir and write" and "retry happens at most once". These exercise the shard-vanished retry logic (§4.6, §4.8 spec case 58-60) and should be enabled if the logic is implemented. Current `generate()` function does include retry (lines 375-382), so these tests should pass and should not be skipped.

## Summary

**Blockers:** 5 (Semaphore property names, module-level state, missing `errorFields`, cleanup logic mismatch, skipped tests for implemented feature)
**Majors:** 4
**Minors:** 2
**Info:** 1

Tests pass (64 passing, 2 skipped) and typecheck/lint are clean, but the findings must be addressed before merge to match the specification and acceptance criteria.
