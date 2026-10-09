# T018 review — 2026-10-09

## Acceptance Criteria

| # | Item | Status |
|---|------|--------|
| 1 | `cacheSweep.ts` exports only `sweepOnce`, `startCacheSweeper`, types; no `parseCacheMaxMb`, `DEFAULT_CACHE_MAX_MB`, `touchCacheFile`; no `thumbnails.ts` import | PASS |
| 2 | `index.ts` derives `maxBytes` from `config.cacheMaxMb` and `config.cacheDir`; no `process.env` reads or `resolveCacheDir` imports | PASS |
| 3 | Over-cap cache evicts LRU oldest `max(atime, mtime)` first down to 90% of cap; under-cap deletes nothing | PASS |
| 4 | Under-cap cache deletes no entries | PASS |
| 5 | Sweeper never deletes files not matching `/^[0-9a-f]{32}\.webp$/` or ending `.tmp`; never touches outside two-hex subdirs | PASS |
| 6 | Temp files fresh as one hour old kept; older than one hour deleted | PASS |
| 7 | `ENOENT` during stat/unlink tolerated; absence reflected in totals | PASS |
| 8 | Overlapping calls to `sweepOnce` serialize; second gets `already-running`; guard released on throw | PASS |
| 9 | `sweepOnce` never rejects | PASS |
| 10 | Missing cache dir yields `no-cache-dir`, no error | PASS |
| 11 | Stat pass uses `mapPool` with limit 32; no hand-rolled pool | PASS |
| 12 | Scheduler uses `setInterval().unref()` 600s period; first sweep early; unforced call within interval returns `throttled`; `stop()` clears timers and awaits sweep | PASS |
| 13 | Evicting sweep emits one `cache.sweep` info event with all keys per §4.9; nothing when `SLYDR_QUIET` | PASS |
| 14 | Empty fan-out dirs removed with `rmdir`; non-empty dir never removed | PASS |
| 15 | `installShutdown(server, logger, hooks)` awaits hooks after `server.close`, before `exit(0)`; continues after failing hook; backward-compatible | PASS |
| 16 | No Express route, `app.use` or CLI flag for cache added | PASS |
| 17 | Sweeper started after listener binds; test process exits promptly with no dangling timer | PASS |

## Findings

No findings.

## Summary

T018 implementation is complete and correct:

- **cacheSweep.ts**: Implements least-recently-used eviction with proper re-entrancy guard, scheduler with configurable intervals and throttling, robust error handling for file system races (ENOENT, EBUSY), and bounded concurrency via `mapPool` (32).
- **Recency logic**: Correctly computes `max(atimeMs, mtimeMs)` with fallbacks for unreliable access times, matching spec §5.6 and relying on T016's touch-on-hit refresh.
- **Temp file handling**: Fresh files neither counted nor deleted; stale (>1 hour) files cleaned up on every sweep regardless of cap status.
- **Logging**: Emits one aggregated `cache.sweep` info event per sweep (suppressed when under-cap and no stale cleanup); errors aggregated as `cache.sweep.warnings` at warn level; both suppressed by `SLYDR_QUIET`.
- **Bootstrap integration**: Sweeper started after listener binds; cleanly stopped on shutdown via hook in `installShutdown`; no routes added.
- **Tests**: 23 unit tests covering basic operation, recency ordering, temp files, error handling, file filtering, directory cleanup, logging, scheduler, re-entrancy, and HTTP surface. 3 integration tests verify shutdown hook contract and backward compatibility. All 722 tests green.
- **Quality**: TypeScript strict mode passes, ESLint zero warnings, Prettier formatting correct, full test coverage of new logic.
