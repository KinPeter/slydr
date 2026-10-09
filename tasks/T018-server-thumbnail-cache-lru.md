# T018 — Implement the thumbnail cache size cap and LRU sweep

**Epic:** E8 — Thumbnail service
**Spec sections:** §5.6, §13.2, §16.1 (A8), NFR-3, NFR-5, NFR-10
**Depends on:** T009, T016
**Estimated size:** M

---

## 1. Context

Slydr stores generated thumbnails on disk so that browsing a photo folder a second time is instant. Left alone, that cache grows without bound as the user browses more folders. Specification §5.6 therefore requires a size cap, `500 MB` by default and configurable through `SLYDR_CACHE_MAX_MB`, enforced by a least-recently-used sweep that runs at startup and then at most once every ten minutes. Each run measures the cache and evicts only when it exceeds the cap.

This ticket builds that sweep as a self-contained background service, `server/src/services/cacheSweep.ts`, and wires it into the server bootstrap with a clean shutdown. The sweep is housekeeping: it must never delay a request, never throw into the request path, tolerate files appearing and disappearing while it runs, and never touch a thumbnail that is still being written. Per specification §16.1 A8 the cache is never surfaced in the application, so this ticket adds no HTTP endpoint of any kind.

The cache directory and the cap come from T008's `ServerConfig` (`cacheDir`, `cacheMaxMb`); this ticket neither resolves the directory nor parses the environment. The sweep's recency signal (`max(atime, mtime)`) is kept honest by **T016**, which refreshes a file's timestamps on cache hits; this ticket contains no touch logic.

## 2. Scope

### In scope

- `server/src/services/cacheSweep.ts`: directory walk, size accounting, least-recently-used eviction, stale temporary-file cleanup, removal of empty fan-out directories, a re-entrancy guard, the scheduler (with a throttle), and a structured summary log line.
- Startup wiring in `server/src/index.ts` and a small extension of T009's `installShutdown` so the sweeper is stopped on shutdown (section 4.8).
- Unit tests with an injectable clock and a temporary-directory file system.

### Out of scope

- Generating thumbnails, the semaphore, in-flight coalescing, the atomic write, the **touch-on-hit rule** and the mkdir-retry for a removed shard — all **T016**. This ticket relies on T016's file layout and temp-file naming (section 3) and **does not modify `thumbnails.ts`**.
- Resolving the cache directory (`SLYDR_CACHE_DIR`, per-OS defaults) and parsing `SLYDR_CACHE_MAX_MB` — **T008** (`ServerConfig.cacheDir`, `ServerConfig.cacheMaxMb`). There is no `parseCacheMaxMb` and no `DEFAULT_CACHE_MAX_MB` here; the default (500) lives in T008.
- The `GET /api/thumb` route — **T017**.
- Any HTTP endpoint, CLI flag or UI control to inspect, clear or resize the cache. Specification §16.1 A8: clearing the cache is a documented manual folder delete. **No route may be added by this ticket.**
- The README section describing where the cache lives and how to clear it — T041.
- Sweeping any directory other than the thumbnail cache directory.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo with three packages, `shared/`, `server/` and `client/`. Everything is ESM (`"type": "module"`), TypeScript is in strict mode, Node >= 22 is required, the server runs Express 5, and Vitest plus Supertest are configured and run via `npm test`. Follow the import-extension convention already used in `server/src`. Server code imports `fs` as `import fs from 'node:fs/promises'` and calls `fs.stat(...)`, `fs.unlink(...)` etc. (so `vi.spyOn(fs, ...)` works in tests).

### `server/src/config/env.ts` (T008)

```ts
export interface ServerConfig {
  port: number;
  rootOverride: string | null;
  rootOverridden: boolean;
  cacheDir: string;     // absolute thumbnail cache directory (SLYDR_CACHE_DIR or the per-OS default)
  cacheMaxMb: number;   // cap in megabytes, integer >= 1, default 500
  quiet: boolean;
}
export function readServerConfig(env?: NodeJS.ProcessEnv): ServerConfig;
```

The cap in bytes is `config.cacheMaxMb * 1024 * 1024`. **Decision (not specified):** `MB` means mebibytes (1,048,576 bytes), matching how operating systems report cache sizes to most users. T008 already falls back to `500` for invalid values, so this ticket has no parsing or validation of its own.

### `server/src/services/thumbnails.ts` (T016)

The sweep depends only on T016's **on-disk contract**:

```
<cacheDir>/
  <key[0..1]>/                       # two lower-case hex characters, e.g. "a3" (fan-out directory)
    <key>.webp                       # finished thumbnail; key = 32 lowercase hex chars; immutable
    <key>.<pid>-<random>.tmp         # in-flight temporary file, renamed to <key>.webp when complete
```

Every temporary file ends with the literal suffix `.tmp`. This ticket treats **any file whose name ends in `.tmp`** as in-progress or abandoned work, never as a cache entry. T016 also: creates the shard with `mkdir -p` immediately before writing, retries once if the shard vanished (the sweep removes empty shards), and refreshes a file's `atime`/`mtime` on cache hits older than one hour. The sweep reads recency from those timestamps and never writes them.

### Logging (T009)

`server/src/logger.ts` exports the `Logger` (`debug/info/warn/error(event: string, fields?)`) and `errorFields(err)`. It honours `SLYDR_QUIET` itself (suppresses `debug`/`info`/`warn`, never `error`). Logs may contain absolute paths; API responses may not. Event names are `<area>.<event>`; this ticket emits `cache.sweep`, `cache.sweep.warnings` and `cache.sweep.failed`.

### Bounded concurrency helper (T011)

`server/src/services/concurrency.ts` exports `mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>` (a bounded worker pool; results in input order; a rejection of `fn` rejects the pool, so callers catch inside `fn`). Use it for the stat pass; do not hand-roll a pool and do not add a dependency.

### Bootstrap (T009)

`server/src/index.ts` exports `main()` and `installShutdown(server: Server, logger: Logger): void` (SIGINT/SIGTERM handling, a 5000 ms forced-exit timer, `process.exit(0)` once `server.close` completes). This ticket extends `installShutdown` (section 4.8).

## 4. Implementation detail

### 4.1 Files

| File | Action |
|---|---|
| `server/src/services/cacheSweep.ts` | Create. |
| `server/test/services/cacheSweep.test.ts` | Create. |
| `server/src/index.ts` | Modify. Start the sweeper after the listener is up; add the `hooks` parameter to `installShutdown` and pass the sweeper's `stop` (section 4.8). |
| `server/test/index.test.ts` (T009's bootstrap tests) | Modify. Add the `installShutdown` hook tests (section 6). |

`thumbnails.ts`, `env.ts` and `app.ts` are **not** modified.

### 4.2 The cap

```ts
const maxBytes = Math.floor(config.cacheMaxMb * 1024 * 1024);
```

That is the whole derivation. Tests that need a tiny cap pass `maxBytes` directly in `SweepOptions` (for example `900` bytes); there is no fractional-MB environment syntax.

### 4.3 Public API

```ts
import type { Logger } from '../logger.js';

export interface SweepOptions {
  cacheDir: string;                 // absolute: ServerConfig.cacheDir
  maxBytes: number;                 // cap in bytes
  logger?: Logger;                  // default: a no-op logger
  targetRatio?: number;             // default 0.9
  staleTmpMs?: number;              // default 60 * 60 * 1000 (1 hour)
  now?: () => number;               // injectable clock, default Date.now
}

export interface SweepSummary {
  ran: boolean;                     // false when skipped
  skipped?: 'already-running' | 'under-cap' | 'no-cache-dir' | 'throttled';
  scannedFiles: number;
  totalBytesBefore: number;
  totalBytesAfter: number;
  evictedFiles: number;
  evictedBytes: number;
  staleTmpRemoved: number;
  emptyDirsRemoved: number;
  errors: number;                   // non-ENOENT failures that were swallowed
  durationMs: number;
}

/** One sweep. Never throws. Never runs concurrently with itself for the same cacheDir. */
export function sweepOnce(options: SweepOptions): Promise<SweepSummary>;

export interface CacheSweeper {
  /**
   * Run a sweep now. Without `force`, a call made less than `intervalMs` after the previous
   * run STARTED resolves immediately with a zeroed summary `{ ran: false, skipped: 'throttled' }`
   * (it does not return the previous result). `force: true` bypasses the throttle (tests,
   * and the startup run). The re-entrancy guard of section 4.4 still applies.
   */
  runNow(options?: { force?: boolean }): Promise<SweepSummary>;
  /** Stop the timers. An in-flight sweep, if any, is allowed to finish; resolves when it has. */
  stop(): Promise<void>;
}

export function startCacheSweeper(options: SweepOptions & { intervalMs?: number }): CacheSweeper;
```

`intervalMs` defaults to `600_000` (10 minutes). A "zeroed summary" has every count and byte field `0`, `ran: false` and the given `skipped` reason.

### 4.4 The sweep algorithm

`sweepOnce` returns a summary and swallows every error. Steps:

1. **Re-entrancy guard.** Keep a module-level `Set<string>` of cache directories currently being swept (keyed by `cacheDir`). If a sweep is already running for this `cacheDir`, return immediately with `{ ran: false, skipped: 'already-running', ... }`. Add to the set before the first `await`, and delete in a `finally`, so a thrown error can never leave the guard stuck.
2. Read the clock once: `const t0 = now()`.
3. **Walk.** `fs.readdir(cacheDir, { withFileTypes: true })`. If this fails with `ENOENT` (nothing has been cached yet) return `{ ran: false, skipped: 'no-cache-dir' }`. For any other failure, count one error, log it, and return. For each directory entry that is itself a directory and whose name matches `/^[0-9a-f]{2}$/` (the fan-out directories), `readdir` it with `withFileTypes`. **Ignore everything else at the top level** (stray files, other directories): the sweep only ever deletes inside the `<aa>/` layout, so a user who points `SLYDR_CACHE_DIR` at a directory containing other things cannot lose them.
4. **Classify each file** in a fan-out directory using its name only (no `stat` yet):
   - Name ends with `.tmp`: a temporary file. Stat it; if `t0 - mtimeMs > staleTmpMs` (strictly older than 1 hour, an abandoned write from a crashed process) unlink it and count it under `staleTmpRemoved`; otherwise leave it entirely alone and **do not count its bytes** toward the total. Never evict a temp file for size reasons, because T016 may be about to rename it.
   - Name matches `/^[0-9a-f]{32}\.webp$/`: a cache entry. Stat it and record `{ filePath, size, recency }`.
   - Anything else (including unexpected names): ignore. Never delete files the sweep does not recognise.
   Run the stats through `mapPool(files, 32, ...)` from `services/concurrency.ts`, catching inside the callback, so a cache of 100,000 files does not open 100,000 handles at once. A `stat` that fails with `ENOENT` means the file vanished (a concurrent eviction, the user, or another instance): skip it silently. Any other stat failure counts one error and skips the file.
5. Sum the sizes: `totalBytesBefore`.
6. **Under-cap check.** If `totalBytesBefore <= maxBytes` return `{ ran: true, skipped: 'under-cap', ... }` after the cheap housekeeping already done in step 4 (stale temp removal is still done on every walk). No eviction.

   Because the walk is required to compute the total, "evict only when the cache exceeds the cap" (spec §5.6) is what is implemented: each run measures, and destructive work happens only above the cap. The walk is cheap (names plus one `stat` each) compared with the thumbnails it protects.
7. **Choose a target.** `targetBytes = Math.floor(maxBytes * targetRatio)` with `targetRatio = 0.9`.
   **Decision (not specified): evict down to 90 % of the cap, not to exactly the cap.** Evicting only to the cap means the very next thumbnail written pushes the cache over again and the next sweep must evict again; the 10 % headroom (50 MB at the default cap) gives the cache room to grow between sweeps and avoids thrashing around the boundary. `0.9` is exposed as an option purely so tests can pick round numbers.
8. **Order by recency, oldest first.** Sort entries ascending by `recency`, breaking ties by file name so the order is fully deterministic across platforms. Recency is defined in section 4.5.
9. **Evict.** Iterate oldest first; `fs.unlink` each file, subtracting its size from a running total, until `total <= targetBytes`. `ENOENT` on unlink means someone else already removed it: treat it as success for accounting (subtract the size, because it is no longer on disk) but do not count it under `evictedFiles`. `EBUSY`, `EPERM` and `EACCES` (Windows can refuse to delete a file that a client is still streaming) count one error, leave the file, and the sweep **continues with the next oldest file**; it never aborts the whole sweep for one stubborn file. Do not subtract the size of a file that could not be removed.
10. **Empty fan-out directories (enabled).** After evicting, for each fan-out directory that had at least one file removed, attempt `fs.rmdir` (not `fs.rm` recursive; `rmdir` fails with `ENOTEMPTY` if anything is inside, which is exactly the safe behaviour). Ignore `ENOTEMPTY`, `ENOENT`, `EBUSY`; count `emptyDirsRemoved` on success.
    **Decision (not specified): remove empty fan-out directories, but only plain `rmdir` and only after an eviction in that directory.** Without this a long-lived cache accumulates up to 256 empty directories, which is harmless but untidy. The risk is a race with T016 creating a file inside the directory at the instant it is removed; **T016 owns the mitigation** (`mkdir -p` immediately before writing, and a single retry when the shard vanished, section 3). Because `mkdir -p` is idempotent and `rmdir` fails on a non-empty directory, either interleaving is safe. Nothing in this ticket touches `thumbnails.ts`.
11. Compute `durationMs = now() - t0` and build the summary.
12. **Log** (section 4.9) and return the summary.

Every `await` inside the sweep is wrapped so that any unexpected exception is caught at the top level of `sweepOnce`: the function has an outer `try { ... } catch (err) { errors++; log } finally { release guard }` and always resolves.

### 4.5 Recency: `atime`, `mtime` and why the rule is what it is

`stat` gives `atimeMs` (last access) and `mtimeMs` (last modification). For a cache whose entries are written once and then read many times, `atime` is the natural LRU signal. The difficulty is that `atime` is frequently not maintained:

- **Windows:** NTFS last-access time updates have been disabled by default since Windows Vista; even when enabled, updates can lag by up to an hour. On a default Windows 11 machine `atime` is effectively frozen at creation time.
- **Linux:** the default mount option is `relatime`, which updates `atime` only if it is older than `mtime` or older than 24 hours. Mounts with `noatime` never update it.
- **macOS (APFS):** access times are updated, but with coarse behaviour on some volumes.

A file written once and read a hundred times may therefore carry an `atime` equal to its creation time, or even earlier than `mtime`. Using `atime` alone would evict a hot thumbnail before a cold one that happens to have been written slightly later.

**Rule (this ticket, now stated in spec §5.6): `recency = Math.max(atimeMs, mtimeMs)`.**

- Where `atime` is maintained it is at least `mtime` and the maximum is the true last-access time, so LRU is accurate.
- Where `atime` is frozen or lags, `max(atime, mtime)` degrades gracefully to `mtime`. **T016 refreshes `atime` and `mtime` on cache hits** (hits older than its touch interval), so `mtime` then *is* the "last used" time on every file system; without that the policy would degrade to "least recently created".
- Some file systems report `atime` as `0` or `NaN`; treat any non-finite or non-positive `atimeMs` as `0` before taking the maximum, and fall back to `mtimeMs`, then to `birthtimeMs`, then to `0`.

This is a strict superset of the specification's earlier "atime, falling back to mtime" wording.

### 4.6 Scheduling

**Decision (not specified): a single `setInterval(...)` with `unref()`, started once at server startup, rather than a request-triggered throttle.**

```ts
const timer = setInterval(() => { void sweeper.runNow(); }, intervalMs);
timer.unref();
```

Reasoning:

- `unref()` means the timer never keeps the Node process alive, so a clean shutdown (or a test run) is not held open by housekeeping.
- A request-triggered throttle couples background work to the request path. Even when the sweep is not awaited, the walk competes for the event loop and disk at the moment the grid is loading hundreds of thumbnails, the worst possible time.
- A timer needs no state shared with the route code, so T017 and T016 stay ignorant of eviction.
- The cost of an idle timer is one callback every ten minutes that returns quickly when the walk finds the cache under the cap.

Behaviour:

1. `startCacheSweeper` schedules the **first** sweep at startup with `setTimeout(() => void runNow({ force: true }), 0)`, unref'd, so the listener has already bound and the first request is never delayed. **Decision (not specified):** do not delay the startup sweep by a fixed number of seconds; a stale oversized cache should be reduced as early as possible, and the sweep is already asynchronous.
2. Thereafter run every `intervalMs` (600,000 ms) via the interval above (unforced).
3. "At most once every 10 minutes" is enforced two ways: the interval, and a `lastRunAt` timestamp (set when a sweep starts) inside `runNow()`: an unforced call with `now() - lastRunAt < intervalMs` resolves with the zeroed `{ ran: false, skipped: 'throttled' }` summary and does nothing. A `now()` that equals the interval exactly is allowed to run.
4. The re-entrancy guard of section 4.4 step 1 means a sweep that takes longer than ten minutes (a huge cache on a slow disk) cannot overlap with the next tick; the next tick simply gets `skipped: 'already-running'`.
5. `stop()` calls `clearInterval`, clears the pending startup timeout, and returns a promise that resolves once any in-flight sweep has settled, so shutdown never abandons a half-finished `unlink` loop.

### 4.7 Recency relies on T016 (no code here)

Because `atime` cannot be trusted (section 4.5), a cache hit must refresh the file's timestamps for the LRU order to be true on Windows and on `relatime`/`noatime` Linux mounts. That refresh is implemented, throttled and tested **entirely in T016** (`touchIntervalMs`, default one hour, injected `now`). This ticket adds no `touchCacheFile`, no shared module state with the thumbnail service, and no import from `thumbnails.ts`.

The route's `304` path does not call the service, so a `304` revalidation does not refresh recency (see T017 notes). **Decision (not specified): accept that.** A thumbnail revalidated forever by `304` while never re-downloaded can look idle to the sweep, but revalidations only happen after the browser's seven-day `max-age` expires, and any full response touches the file.

### 4.8 Bootstrap wiring and shutdown (`server/src/index.ts`)

1. After `server.listen(...)` has succeeded (the listener is bound and the readiness line has been logged), and before `installShutdown`:

```ts
const sweeper = startCacheSweeper({
  cacheDir: config.cacheDir,
  maxBytes: Math.floor(config.cacheMaxMb * 1024 * 1024),
  logger,
});
```

2. **Extend T009's `installShutdown`** with an optional third parameter and use it:

```ts
export function installShutdown(
  server: Server,
  logger: Logger,
  hooks: Array<() => void | Promise<void>> = [],
): void;

// in main():
installShutdown(server, logger, [() => sweeper.stop()]);
```

   On `SIGINT`/`SIGTERM`, in order: log `server.stopping`, `server.close()` + `closeIdleConnections()` (unchanged), and once `server.close` completes, **await every hook (sequentially, each wrapped so a rejection is logged at `warn` and does not stop the next hook or the exit)**, then log `server.stopped` and `process.exit(0)`. The existing 5000 ms forced-exit timer keeps running throughout, so a hung hook can delay exit by at most that long and then the forced path (`closeAllConnections`, `exit`) applies. Existing behaviour with no hooks is unchanged. A second signal still exits immediately with `130`/`143`.
3. `startCacheSweeper` must be called **after** the jail-root validation and port selection from earlier tickets, so a server that fails to start never leaves a timer behind.
4. Never `await` the first sweep in the bootstrap path. Startup latency (NFR-8: under 2 s) must not depend on cache size.
5. No new Express route and no `app.use` call is added anywhere. Search the diff for `router.` and `app.` additions: there must be none.

### 4.9 Logging

A sweep that evicted or removed anything logs one line through the logger as `cache.sweep` at **info** (so `SLYDR_QUIET` suppresses it). A sweep that skipped (`already-running`, `no-cache-dir`, `throttled`) or found the cache under the cap logs nothing at info level when `evictedFiles === 0 && staleTmpRemoved === 0`; this keeps a healthy idle server silent. Example (as emitted by T009's logger, fields after `event`):

```json
{"ts":"2026-10-08T09:41:12.512Z","level":"info","event":"cache.sweep","cacheDir":"C:\\Users\\PeterKin\\AppData\\Local\\slydr\\thumbnails","maxBytes":524288000,"before":561234567,"after":470103884,"scanned":14210,"evicted":1312,"evictedBytes":91130683,"staleTmp":0,"emptyDirs":3,"errors":0,"ms":284}
```

Individual `unlink`/`stat` errors other than `ENOENT` are aggregated into `errors` and logged **once** at the end as `cache.sweep.warnings` at `warn`, not once per file, so a locked Windows cache cannot flood the log. **Decision (not specified): this warn line is suppressed by `SLYDR_QUIET`** (the logger's contract), because a failed eviction is not an error from the user's point of view. Only an unexpected exception caught at the top level of `sweepOnce` is logged as `cache.sweep.failed` at `error` (with `errorFields(err)`).

### 4.10 Cross-platform notes

- **Windows:** deleting a file that a client is currently streaming can fail with `EBUSY` or `EPERM`. The sweep tolerates it (section 4.4 step 9). Antivirus scanners can also hold files briefly; the next sweep retries naturally. Paths are handled with `node:path` throughout; never concatenate with `/`.
- **Windows `atime`:** see section 4.5. This is the reason T016 touches files on hits.
- **macOS:** `fs.readdir` returns entries in no guaranteed order and the file system is case-insensitive; fan-out names are lower-case hex, so no collision is possible. `.DS_Store` files may appear in a cache directory the user has browsed with Finder; the sweep ignores unrecognised names, so it neither counts nor deletes them.
- **Linux:** `relatime` and `noatime` as described in section 4.5.
- **Symlinks:** the sweep never follows symlinks. A `Dirent` that is not `isFile()` or `isDirectory()` (a symlink, socket, etc.) is ignored.
- **Network or unusual file systems** may report `size` of `0` for some entries; they simply contribute nothing to the total.

## 5. Acceptance criteria

- [ ] `server/src/services/cacheSweep.ts` exports `sweepOnce`, `startCacheSweeper`, and the `SweepOptions` / `SweepSummary` / `CacheSweeper` types with the signatures in section 4.3. It exports no `parseCacheMaxMb`, no `DEFAULT_CACHE_MAX_MB` and no `touchCacheFile`, and does not import from `thumbnails.ts`.
- [ ] `server/src/index.ts` derives `maxBytes` from `config.cacheMaxMb` and the directory from `config.cacheDir`; nothing in this ticket reads `process.env` or imports `resolveCacheDir`.
- [ ] With a cache of total size `T > cap`, a sweep deletes least-recently-used `<aa>/<key>.webp` files, oldest `max(atime, mtime)` first, until the remaining total is `<= floor(cap * 0.9)`, and deletes nothing else.
- [ ] With a cache at or under the cap, a sweep deletes no cache entries.
- [ ] A sweep never deletes a file whose name does not match `/^[0-9a-f]{32}\.webp$/` or end in `.tmp`, and never touches anything outside two-hex-character subdirectories of the cache directory.
- [ ] Files ending in `.tmp` that are newer than one hour (or exactly one hour) are neither counted nor deleted; those older than one hour are deleted.
- [ ] A file that disappears between listing and `stat` or `unlink` (`ENOENT`) does not make the sweep fail, and its absence is reflected correctly in the totals.
- [ ] Two overlapping calls to `sweepOnce` for the same directory run one sweep; the second resolves immediately with `skipped: 'already-running'`, and the guard is released even if the first sweep throws internally.
- [ ] `sweepOnce` never rejects, whatever the file system does.
- [ ] A missing cache directory yields `skipped: 'no-cache-dir'` and no error.
- [ ] The stat pass runs through `mapPool` with a limit of 32; no hand-rolled pool exists in `cacheSweep.ts`.
- [ ] The scheduler uses `setInterval(...).unref()` with a 600,000 ms period; the first sweep runs once shortly after startup without delaying the first request; an unforced `runNow()` within one interval resolves with the zeroed `{ ran: false, skipped: 'throttled' }` summary; `stop()` clears all timers and awaits any in-flight sweep.
- [ ] A sweep that evicted something emits exactly one `cache.sweep` info event containing the keys shown in section 4.9, and emits nothing when `SLYDR_QUIET` is set (logger-level suppression).
- [ ] Empty fan-out directories left behind by eviction are removed with `rmdir`, and a non-empty directory is never removed.
- [ ] `installShutdown(server, logger, hooks)` awaits every hook after `server.close` completes and before `process.exit(0)`, continues after a failing hook, and behaves exactly as before when no hooks are passed; `main()` passes `() => sweeper.stop()`.
- [ ] No Express route, `app.use` or CLI flag related to the cache was added.
- [ ] `server/src/index.ts` starts the sweeper after the listener binds; a process started under test exits promptly with no dangling timer.

## 6. Tests to write

Per specification §12.1 (unit) and NFR-5. All sweep tests in **`server/test/services/cacheSweep.test.ts`** (Vitest). No test touches the real cache directory or the environment. Use `makeTempBase` / `removeTree` from `server/test/helpers/fs.ts` and `createTestLogger` from `server/test/helpers/logger.ts`.

### Helpers

```ts
async function makeCache(): Promise<string>; // makeTempBase('slydr-sweep-')
async function putEntry(cacheDir: string, key: string, bytes: number, recencyMs: number): Promise<string>;
```

`putEntry` creates `<cacheDir>/<key.slice(0,2)>/<key>.webp` with `bytes` bytes (`Buffer.alloc(bytes)`), then calls `fs.utimes(file, new Date(recencyMs), new Date(recencyMs))` so that `atime === mtime === recencyMs`. Generate deterministic 32-character hex keys with `key(n) => n.toString(16).padStart(32, '0')`. Use a fixed clock `const clock = () => 10_000_000_000`. Clean up with `removeTree(dir)` in `afterEach`.

When a test needs `atime` and `mtime` to differ, call `fs.utimes(file, atimeDate, mtimeDate)` explicitly. Do not rely on the real file system updating `atime` on read.

### Cases

1. `under the cap is a no-op` — five 100-byte entries, `maxBytes` 1000: `evictedFiles === 0`, all five files still exist, `skipped === 'under-cap'`.
2. `exactly at the cap is a no-op` — total equals `maxBytes`.
3. `over the cap evicts oldest first down to 90 percent` — ten 100-byte entries with recencies `n * 1000` for `n = 1..10`, `maxBytes` 900, so the target is `floor(900 * 0.9) = 810`. The total of 1000 exceeds the cap, so the sweep evicts oldest first until the total is `<= 810`: the two oldest (keys 1 and 2) go, leaving 800. Assert exactly keys 1 and 2 were removed, keys 3 to 10 remain, and `totalBytesAfter === 800`.
4. `eviction order is by recency, not by name or creation order` — create entries in a scrambled order with scrambled recencies and assert the survivors are the most recent ones.
5. `recency is max(atime, mtime)` — entry A has `atime` far in the past and `mtime` recent; entry B has `atime` recent and `mtime` far in the past. Over the cap with room to evict one: the one with the larger of the two timestamps survives. Add a variant where `atime < mtime` (simulating `relatime`) and verify `mtime` decides.
6. `ties are broken by name` — three entries with identical recency; the lexicographically smallest key is evicted first, identically on every run.
7. `non-finite or zero atime falls back to mtime` — stub `fs.stat` (via `vi.spyOn(fs, 'stat')`) to return `atimeMs: 0` and `NaN`; ordering follows `mtimeMs`.
8. `ENOENT during stat is tolerated` — spy on `fs.stat` so that one specific path rejects with `Object.assign(new Error('gone'), { code: 'ENOENT' })`; the sweep completes, `errors === 0`, and the totals exclude that file.
9. `ENOENT during unlink is tolerated` — spy on `fs.unlink` so the first victim rejects with `ENOENT`; the sweep continues, the loop still reaches the target, `errors === 0`, and `evictedFiles` does not count the vanished file.
10. `EBUSY during unlink skips that file and continues` — the oldest file's `unlink` rejects with `EBUSY`; the next oldest is evicted instead, `errors === 1`, and the busy file still exists.
11. `fresh temp files are neither counted nor deleted` — a `<key>.123-abc123.tmp` file modified 5 minutes before the fake clock: still present after a sweep that is over the cap; its bytes are absent from `totalBytesBefore`.
12. `stale temp files are deleted` — a `.tmp` file modified 2 hours before the fake clock is removed, `staleTmpRemoved === 1`, even when the cache is under the cap.
13. `a temp file exactly one hour old is kept` — `t0 - mtime === staleTmpMs` is not stale (strictly greater is required); one millisecond more is.
14. `unrecognised files are never touched` — `README.txt` in the cache root, `.DS_Store`, `notes.txt` inside a fan-out directory, a file `zz/1234.webp` (non-hex directory), and a directory `abc/` (three characters) all survive an over-cap sweep.
15. `symlinks are ignored` — where `trySymlink` succeeds (skip otherwise), a symlink named like a cache entry is neither counted nor followed nor deleted.
16. `empty fan-out directories are removed after eviction` — evict every file from directory `0a`; the directory is gone, `emptyDirsRemoved >= 1`; a directory that still holds a surviving entry is retained.
17. `a non-empty directory is never removed` — a fan-out directory left holding a fresh temp file after its entries were evicted remains and no error is counted.
18. `missing cache directory is reported, not thrown` — `sweepOnce` on a non-existent path resolves with `skipped === 'no-cache-dir'`.
19. `sweepOnce never rejects` — make `fs.readdir` reject with `EIO`; the promise resolves with `errors >= 1`.
20. `overlapping sweeps are guarded` — start `const a = sweepOnce(opts)` and `const b = sweepOnce(opts)` synchronously without awaiting between them (use a deferred `readdir` so `a` is genuinely in flight); `b` resolves with `skipped === 'already-running'`, `a` completes normally, and a third call after both finish runs normally. Add a variant where `a` fails internally and a following call is still allowed (the guard was released).
21. `guard is per cache directory` — two sweeps on two different directories run concurrently without skipping.
22. `scheduler runs on an interval and unrefs the timer` — with `vi.useFakeTimers()`, `startCacheSweeper({ ..., intervalMs: 600_000 })`: advance 0 ms (startup sweep), 600,000 ms, 1,200,000 ms and assert three sweeps (observe via the test logger or a spy on `fs.readdir`). Assert the `setInterval` handle has `hasRef() === false` (wrap `setInterval` with a spy that records the returned handle).
23. `at most one sweep per ten minutes` — calling `runNow()` repeatedly within one interval executes the sweep once; the other calls resolve with `{ ran: false, skipped: 'throttled' }` and all-zero counts; `runNow({ force: true })` runs again.
24. `stop clears timers and waits for the in-flight sweep` — start a sweep with a deferred `readdir`, call `stop()`, assert the returned promise is pending until the deferred is released, and that `vi.getTimerCount()` is `0` afterwards.
25. `logging` — with `createTestLogger()`: an evicting sweep emits exactly one `cache.sweep` event at `info` with every key listed in section 4.9; an idle sweep (under cap, nothing stale) emits no `cache.sweep` event; a sweep with an `EBUSY` emits one `cache.sweep.warnings` event at `warn` (not one per file). With a real `createLogger({ quiet: true, writeOut })` the evicting sweep writes nothing.
26. `no HTTP surface was added` — a Supertest request through `createTestEnv()` to `/api/cache`, `/api/thumb/cache`, `/api/cache/clear` and `/api/cache/sweep` each return `404` (and `405` for non-GET methods, via the existing guard). Guards against accidental scope creep (§16.1 A8).
27. `the stat pass is bounded` — create 100 entries and spy on `fs.stat` recording the number of simultaneously pending calls (each resolves after a macrotask tick); the maximum is `<= 32` and `> 1`.

### Bootstrap tests (in T009's `server/test/index.test.ts`)

28. `installShutdown awaits hooks after close and before exit` — with the fake server and `process.exit` stub from T009's tests: two hooks recording order; assert `server.close` completes, then hook 1, then hook 2, then `exit(0)`.
29. `a failing hook is logged and does not block the next hook or the exit` — hook 1 rejects; hook 2 still runs; `exit(0)` is called; a `warn` event was logged.
30. `a hanging hook is bounded by the forced-exit timer` — with fake timers, a hook that never resolves: after 5000 ms the forced path runs (`closeAllConnections`, `exit(0)`).
31. `installShutdown without hooks behaves as before` — T009's existing shutdown tests pass unchanged.
32. `bootstrap starts the sweeper after the listener and stops it on shutdown` — via a thin seam (for example `main()` with injected `startCacheSweeper`, or a spy on the module), assert the sweeper was started once with `cacheDir === config.cacheDir` and `maxBytes === config.cacheMaxMb * 1024 * 1024`, and that its `stop` was passed to `installShutdown` as a hook; and that `vi.getTimerCount()` returns to the pre-start count after the hook runs.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green on the dev machine (Windows 11) and in CI on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- [ ] No test depends on the real `atime` behaviour of the host file system; every test sets timestamps explicitly with `fs.utimes`.
- [ ] The temp-file convention (`<key>.<pid>-<random>.tmp` in the fan-out directory, renamed to `<key>.webp`) is documented in a comment at the top of `cacheSweep.ts` (T016 documents it in `thumbnails.ts`).
- [ ] Every item labelled **Decision (not specified)** in section 4 appears as a short comment at the relevant line in the code.
- [ ] No new route, query parameter or CLI option exists for the cache.
- [ ] Manual check: with `SLYDR_CACHE_MAX_MB=1` and a folder of a few hundred photos browsed in grid view, the cache directory settles at or below 1 MiB within one sweep interval, and the grid keeps working throughout.
- [ ] README unchanged by this ticket; the documentation of `SLYDR_CACHE_MAX_MB`, the cache location and manual clearing is T041's.

## 8. Notes and gotchas

- **The sweep must never delay a request.** It is asynchronous end to end, bounded in concurrency, started from a deferred timer and unref'd. Do not call `fs.*Sync` anywhere in this module, and do not `await` it from the bootstrap or from a route.
- **The sweep must never throw into the request path.** There is no request path in this module.
- **Do not trust `atime`.** Section 4.5 is the heart of this ticket. A sweep that sorts by `atimeMs` alone will behave correctly on a developer's Linux box and wrongly on every default Windows install, and the failure is silent: the cache still stays under the cap, it just evicts the wrong files. The other half of the fix (touching on hits) is in T016.
- **Never delete what you do not recognise.** The name filters (`/^[0-9a-f]{2}$/` directories, `/^[0-9a-f]{32}\.webp$/` files, `.tmp` suffix) are a safety net against `SLYDR_CACHE_DIR` being pointed at a directory with other content. Keep them strict.
- **Total accounting excludes fresh temp files.** A thumbnail being written is not yet a cache entry. Counting it would let a burst of concurrent writes trigger a premature eviction; ignoring it means the cache may briefly exceed the cap by at most `min(4, availableParallelism())` partial files, which is negligible.
- **Eviction races with readers.** Deleting a file while `GET /api/thumb` is about to stream it is possible. T017 retries once after regenerating; the least-recently-used choice makes this rare because a file about to be served has just been touched.
- **Interpretation of "only when the cache exceeds the cap" (spec §5.6, owner-confirmed).** The walk to measure the cache is unavoidable; what is avoided is evicting or doing destructive work when the cache is under the cap. Do not "optimise" by caching the total in memory: other processes and the user may add or delete files, and an in-memory counter drifts. At 500 MB of roughly 20 KB thumbnails a run is on the order of 25,000 `stat` calls every ten minutes, bounded to 32 at a time; accepted.
- **Cap is a soft limit.** Between sweeps the cache can exceed the cap, by design.
- **Specification §16.2 item 3.** The 500 MB default is a tuning value expected to be adjusted after measuring on a real photo library. It lives in one place: T008's `readServerConfig`.
- **No `clear cache` feature.** Assumption A8 is explicit. If a future ticket adds one, it would reuse `sweepOnce` with `maxBytes: 0`; keep the function free of assumptions that forbid that, but do not build it now.
