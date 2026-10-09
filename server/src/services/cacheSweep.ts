/**
 * Cache sweep service: least-recently-used eviction with size cap and stale cleanup.
 *
 * This module walks the thumbnail cache, measures its size, and evicts least-recently-used
 * entries when the total exceeds a cap. It also removes stale temporary files and empty
 * fan-out directories. The sweep is a self-contained background service that never delays
 * requests and never throws into the request path.
 *
 * On-disk layout (T016):
 * <cacheDir>/
 *   <key[0..1]>/                       # two lowercase hex characters, e.g. "a3" (fan-out directory)
 *     <key>.webp                       # finished thumbnail; key = 32 lowercase hex chars; immutable
 *     <key>.<pid>-<random>.tmp         # in-flight temporary file, renamed to <key>.webp when complete
 *
 * Every temporary file ends with the literal suffix `.tmp`. This module treats any file whose
 * name ends in `.tmp` as in-progress or abandoned work, never as a cache entry.
 *
 * Specification: §5.6, §13.2, §16.1 (A8), NFR-3, NFR-5, NFR-10.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { mapPool } from './concurrency.js';
import type { Logger } from '../logger.js';

export interface SweepOptions {
  /** Absolute path to the cache directory. */
  cacheDir: string;
  /** Cap in bytes. */
  maxBytes: number;
  /** Logger; default: no-op. */
  logger?: Logger;
  /** Target ratio for eviction; default 0.9. Decision (not specified): evict to 90% of cap. */
  targetRatio?: number;
  /** Age threshold for stale temp files in ms; default 1 hour. */
  staleTmpMs?: number;
  /** Injected clock for testing; default Date.now. */
  now?: () => number;
}

export interface SweepSummary {
  /** Whether the sweep ran (not skipped). */
  ran: boolean;
  /** Reason for skipping, if not ran. */
  skipped?: 'already-running' | 'under-cap' | 'no-cache-dir' | 'throttled';
  /** Number of files scanned (cache entries + temp files). */
  scannedFiles: number;
  /** Total bytes before eviction. */
  totalBytesBefore: number;
  /** Total bytes after eviction. */
  totalBytesAfter: number;
  /** Number of cache entries evicted. */
  evictedFiles: number;
  /** Number of bytes evicted. */
  evictedBytes: number;
  /** Number of stale temp files removed. */
  staleTmpRemoved: number;
  /** Number of empty fan-out directories removed. */
  emptyDirsRemoved: number;
  /** Non-ENOENT errors encountered (aggregated, not per-file). */
  errors: number;
  /** Elapsed time in milliseconds. */
  durationMs: number;
}

export interface CacheSweeper {
  /**
   * Run a sweep now. Without `force`, a call made less than `intervalMs` after the previous
   * run STARTED resolves immediately with a zeroed summary `{ ran: false, skipped: 'throttled' }`.
   * `force: true` bypasses the throttle (tests and startup run).
   */
  runNow(options?: { force?: boolean }): Promise<SweepSummary>;
  /** Stop the timers and await any in-flight sweep. */
  stop(): Promise<void>;
}

/**
 * Module-level re-entrancy guard: a set of cache directories currently being swept.
 */
const sweepingDirs = new Set<string>();

/**
 * Zeroed summary factory.
 */
function zeroedSummary(
  reason: 'already-running' | 'under-cap' | 'no-cache-dir' | 'throttled',
): SweepSummary {
  return {
    ran: false,
    skipped: reason,
    scannedFiles: 0,
    totalBytesBefore: 0,
    totalBytesAfter: 0,
    evictedFiles: 0,
    evictedBytes: 0,
    staleTmpRemoved: 0,
    emptyDirsRemoved: 0,
    errors: 0,
    durationMs: 0,
  };
}

/**
 * Recency signal: max(atimeMs, mtimeMs) with fallbacks for unreliable atime.
 * Decision (not specified): max(atime, mtime) since atime is unreliable on most file systems.
 */
function recency(stat: { atimeMs: number; mtimeMs: number; birthtimeMs: number }): number {
  // Treat non-finite or non-positive atime as 0
  const atime = Number.isFinite(stat.atimeMs) && stat.atimeMs > 0 ? stat.atimeMs : 0;
  // max(atime, mtime) for LRU accuracy when atime is maintained
  const result = Math.max(atime, stat.mtimeMs);
  // If both atime and mtime failed, fall back to birthtime, then 0
  if (!Number.isFinite(result) || result <= 0) {
    return Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0 ? stat.birthtimeMs : 0;
  }
  return result;
}

/**
 * One sweep. Never throws. Never runs concurrently with itself for the same cacheDir.
 */
export async function sweepOnce(options: SweepOptions): Promise<SweepSummary> {
  const {
    cacheDir,
    maxBytes,
    logger,
    targetRatio = 0.9,
    staleTmpMs = 60 * 60 * 1000, // 1 hour
    now = Date.now,
  } = options;

  const t0 = now();
  let scannedFiles = 0;
  let totalBytesBefore = 0;
  let totalBytesAfter = 0;
  let evictedFiles = 0;
  let evictedBytes = 0;
  let staleTmpRemoved = 0;
  let emptyDirsRemoved = 0;
  let errors = 0;

  try {
    // Step 1: Re-entrancy guard
    if (sweepingDirs.has(cacheDir)) {
      return zeroedSummary('already-running');
    }
    sweepingDirs.add(cacheDir);

    try {
      // Step 3: Walk the cache directory
      let entries: Dirent[];
      try {
        entries = (await fs.readdir(cacheDir, { withFileTypes: true })) as Dirent[];
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return zeroedSummary('no-cache-dir');
        }
        errors++;
        logger?.error('cache.sweep.failed', {
          cacheDir,
          errCode: (err as NodeJS.ErrnoException).code,
        });
        return {
          ran: false,
          scannedFiles: 0,
          totalBytesBefore: 0,
          totalBytesAfter: 0,
          evictedFiles: 0,
          evictedBytes: 0,
          staleTmpRemoved: 0,
          emptyDirsRemoved: 0,
          errors,
          durationMs: now() - t0,
        };
      }

      // Collect files to stat
      interface CacheEntry {
        filePath: string;
        size: number;
        recencyMs: number;
      }

      const cacheEntries: CacheEntry[] = [];
      const shardDirs: string[] = [];

      // Walk fan-out directories
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Only scan two-hex-character directories
        if (!/^[0-9a-f]{2}$/.test(entry.name)) continue;

        const shardPath = path.join(cacheDir, entry.name);
        shardDirs.push(shardPath);

        let shardEntries: Dirent[];
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          shardEntries = (await fs.readdir(shardPath, { withFileTypes: true })) as any as Dirent[];
        } catch {
          // Shard disappeared or is unreadable; skip it
          continue;
        }

        for (const file of shardEntries) {
          // Skip directories and symlinks
          if (!file.isFile()) continue;

          scannedFiles++;

          const filePath = path.join(shardPath, file.name);

          // Classify by name
          if (file.name.endsWith('.tmp')) {
            // Temporary file: check if stale
            try {
              const stat = await fs.stat(filePath);
              if (t0 - stat.mtimeMs > staleTmpMs) {
                // Stale: delete it
                try {
                  await fs.unlink(filePath);
                  staleTmpRemoved++;
                } catch (err) {
                  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    errors++;
                  }
                }
              }
              // Fresh temp files are neither counted nor deleted
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                errors++;
              }
            }
          } else if (/^[0-9a-f]{32}\.webp$/.test(file.name)) {
            // Cache entry: queue for stat and eviction
            cacheEntries.push({ filePath, size: 0, recencyMs: 0 });
          }
          // Anything else: ignore
        }
      }

      // Step 4: Stat all cache entries with bounded concurrency
      try {
        const statResults = await mapPool(cacheEntries, 32, async (entry, idx) => {
          try {
            const stat = await fs.stat(entry.filePath);
            cacheEntries[idx] = {
              filePath: entry.filePath,
              size: stat.size,
              recencyMs: recency(stat),
            };
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              // File vanished: skip it silently
              cacheEntries[idx] = { filePath: entry.filePath, size: 0, recencyMs: 0 };
            } else {
              errors++;
              cacheEntries[idx] = { filePath: entry.filePath, size: 0, recencyMs: 0 };
            }
          }
          return idx;
        });
        void statResults; // Satisfy no-unused-vars
      } catch {
        // mapPool rejected; treat as error
        errors++;
      }

      // Step 5: Sum sizes
      totalBytesBefore = cacheEntries.reduce((sum, entry) => sum + entry.size, 0);

      // Step 6: Under-cap check
      if (totalBytesBefore <= maxBytes) {
        const durationMs = now() - t0;
        const shouldLog = staleTmpRemoved > 0;
        if (shouldLog && logger) {
          logger.info('cache.sweep', {
            cacheDir,
            maxBytes,
            before: totalBytesBefore,
            after: totalBytesBefore,
            scanned: scannedFiles,
            evicted: 0,
            evictedBytes: 0,
            staleTmp: staleTmpRemoved,
            emptyDirs: 0,
            errors,
            ms: durationMs,
          });
        }
        return {
          ran: true,
          skipped: 'under-cap',
          scannedFiles,
          totalBytesBefore,
          totalBytesAfter: totalBytesBefore,
          evictedFiles: 0,
          evictedBytes: 0,
          staleTmpRemoved,
          emptyDirsRemoved: 0,
          errors,
          durationMs,
        };
      }

      // Step 7: Choose eviction target
      const targetBytes = Math.floor(maxBytes * targetRatio);

      // Step 8: Sort cache entries by recency (oldest first), then by name
      const validEntries = cacheEntries.filter((e) => e.size > 0);
      validEntries.sort((a, b) => {
        if (a.recencyMs !== b.recencyMs) {
          return a.recencyMs - b.recencyMs;
        }
        return a.filePath.localeCompare(b.filePath);
      });

      // Step 9: Evict oldest first
      let currentTotal = totalBytesBefore;
      const evictedShards = new Set<string>();

      for (const entry of validEntries) {
        if (currentTotal <= targetBytes) break;

        try {
          await fs.unlink(entry.filePath);
          currentTotal -= entry.size;
          evictedFiles++;
          evictedBytes += entry.size;
          evictedShards.add(path.dirname(entry.filePath));
        } catch (err) {
          const errCode = (err as NodeJS.ErrnoException).code;
          if (errCode === 'ENOENT') {
            // File vanished: treat as success for accounting, do not count it
            currentTotal -= entry.size;
          } else if (errCode === 'EBUSY' || errCode === 'EPERM' || errCode === 'EACCES') {
            // File locked: skip and continue
            errors++;
          } else {
            errors++;
          }
        }
      }

      totalBytesAfter = currentTotal;

      // Step 10: Remove empty fan-out directories
      for (const shardPath of evictedShards) {
        try {
          await fs.rmdir(shardPath);
          emptyDirsRemoved++;
        } catch (err) {
          const errCode = (err as NodeJS.ErrnoException).code;
          // Ignore ENOTEMPTY, ENOENT, EBUSY
          if (errCode !== 'ENOTEMPTY' && errCode !== 'ENOENT' && errCode !== 'EBUSY') {
            errors++;
          }
        }
      }

      // Step 11: Compute duration and build summary
      const durationMs = now() - t0;

      // Step 12: Log
      if ((evictedFiles > 0 || staleTmpRemoved > 0) && logger) {
        logger.info('cache.sweep', {
          cacheDir,
          maxBytes,
          before: totalBytesBefore,
          after: totalBytesAfter,
          scanned: scannedFiles,
          evicted: evictedFiles,
          evictedBytes,
          staleTmp: staleTmpRemoved,
          emptyDirs: emptyDirsRemoved,
          errors,
          ms: durationMs,
        });
      }

      if (errors > 0 && logger) {
        logger.warn('cache.sweep.warnings', {
          cacheDir,
          errors,
        });
      }

      return {
        ran: true,
        scannedFiles,
        totalBytesBefore,
        totalBytesAfter,
        evictedFiles,
        evictedBytes,
        staleTmpRemoved,
        emptyDirsRemoved,
        errors,
        durationMs,
      };
    } finally {
      sweepingDirs.delete(cacheDir);
    }
  } catch (err) {
    const durationMs = now() - t0;
    logger?.error('cache.sweep.failed', {
      cacheDir,
      errMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      ran: false,
      scannedFiles,
      totalBytesBefore,
      totalBytesAfter,
      evictedFiles,
      evictedBytes,
      staleTmpRemoved,
      emptyDirsRemoved,
      errors: errors + 1,
      durationMs,
    };
  }
}

/**
 * Start a cache sweeper with scheduled runs.
 *
 * Decision (not specified): a single setInterval with unref(), started once at server startup.
 */
export function startCacheSweeper(options: SweepOptions & { intervalMs?: number }): CacheSweeper {
  const { intervalMs = 600_000, ...sweepOpts } = options;
  let lastRunAt = 0;
  let startupTimeout: ReturnType<typeof setTimeout> | null = null;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let inFlightPromise: Promise<SweepSummary> | null = null;

  async function runNowInternal(force = false): Promise<SweepSummary> {
    const now = (sweepOpts.now || Date.now)();
    if (!force && now - lastRunAt < intervalMs) {
      return zeroedSummary('throttled');
    }
    lastRunAt = now;
    inFlightPromise = sweepOnce(sweepOpts);
    try {
      return await inFlightPromise;
    } finally {
      inFlightPromise = null;
    }
  }

  // Start with a deferred startup run
  startupTimeout = setTimeout(() => {
    void runNowInternal(true);
  }, 0);
  startupTimeout.unref();

  // Then schedule recurring runs
  intervalHandle = setInterval(() => {
    void runNowInternal();
  }, intervalMs);
  intervalHandle.unref();

  return {
    async runNow(opts?: { force?: boolean }): Promise<SweepSummary> {
      return runNowInternal(opts?.force || false);
    },
    async stop(): Promise<void> {
      if (startupTimeout) clearTimeout(startupTimeout);
      if (intervalHandle) clearInterval(intervalHandle);
      if (inFlightPromise) {
        await inFlightPromise;
      }
    },
  };
}
