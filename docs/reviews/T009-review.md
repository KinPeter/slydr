# T009 review — 2026-10-09

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `server/src/index.ts` exists, exports `main` and `BIND_HOST`, starts only when invoked as entry point | PASS |
| `BIND_HOST === '127.0.0.1'`, no `0.0.0.0` or bare `listen(` in `server/src` | PASS |
| `node --import tsx server/src/index.ts` prints exactly one `server.listening` JSON line, serves `/api/health` 200 | PASS |
| Starting with nonexistent `SLYDR_ROOT` exits non-zero with message naming directory and reason | FAIL |
| Starting with `SLYDR_ROOT` pointing at a file exits non-zero with `not-a-directory` message | PASS |
| `SLYDR_ROOT` set to valid directory emits `root.overridden` warning containing `TEST-ONLY` before `server.listening` | PASS |
| With occupied start port, binds `start + 1` and readiness line reports actual port | PASS |
| With all ten ports occupied, exits non-zero with message containing all ten port numbers | PASS |
| `SLYDR_QUIET=1` suppresses debug/info/warn on stdout, error still reaches stderr | PASS |
| Every log line is valid JSON with `ts`, `level` and `event` | PASS |
| `SIGINT` produces `server.stopping` then `server.stopped` and exit code 0 within 5 s | PASS |
| `createApp(config, logger)` is only injection point; no module-level mutable logger | PASS |
| `index.ts` contains T039 insertion-point comment, no static hosting or browser-opening code | PASS |

## Findings

server/src/index.ts:116: BLOCKER: Error message for missing jail root uses `config.rootOverride` which is `null` when `SLYDR_ROOT` is not set. When homedir resolution fails, the error would print "Jail root does not exist: null" instead of the actual homedir path. The `RootResolutionError` must carry the attempted path, or the error handler must reconstruct it.

server/src/bootstrap/resolveRoot.ts:54,57,74,76,77,88,94: MAJOR: `RootResolutionError` exceptions don't carry the attempted path (the `absolute` or `candidate` path). When index.ts receives these errors and tries to use `config.rootOverride` in the message, it will be `null` for the homedir case. Add a `path?: string` field to `RootResolutionError` and populate it with the path that was attempted (e.g. `absolute` from the resolution step or the initial `candidate`).

server/src/bootstrap/listen.ts:45-51: MINOR: Type assertion `addr as unknown as Record<string, unknown>` when reading `port` is fragile. `server.address()` when called on a listening IPv4 server returns `AddressInfo` with guaranteed `port` property; the cast is overly defensive. Acceptable as-is since it's safe, but the second cast layer is unnecessary.

server/src/logger.ts:39-40: MINOR: `errorFields` returns empty object `{}` for strings, numbers, null, and undefined inputs. Per spec, this is correct (those are not Error objects). However, a thrown string (e.g. `throw "error message"`) could benefit from at least capturing the string value. Acceptable as-is per spec decision.

server/src/index.ts:182: MINOR: Setting `url.port = String(port)` where `port` is already a number is correct but mixes type conversions. Could be simplified to `url.port = port` since URL.port accepts both string and number-like inputs. Not a bug; acceptable.

## Summary

- 1 BLOCKER: Error message for root resolution failure with no SLYDR_ROOT set prints "null" instead of actual homedir path.
- 1 MAJOR: `RootResolutionError` must carry the attempted path so error handler can report the correct directory.
- 2 MINOR: Type casting style and string conversion style (both cosmetic, not bugs).

Tests pass, typecheck passes, lint passes. Feature implementation is complete and correct except for the error messaging issue.
