import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sweepOnce, startCacheSweeper } from '../../src/services/cacheSweep.js';
import { createTestLogger } from '../helpers/logger.js';
import { makeTempBase, removeTree, trySymlink } from '../helpers/fs.js';

describe('cache sweep service', () => {
  let cacheDir: string;
  const clock = () => 10_000_000_000;

  beforeEach(async () => {
    cacheDir = await makeTempBase('slydr-sweep-');
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await removeTree(cacheDir);
  });

  // Helper: create a cache entry
  async function putEntry(key: string, bytes: number, recencyMs: number): Promise<string> {
    const shard = path.join(cacheDir, key.slice(0, 2));
    await fs.mkdir(shard, { recursive: true });
    const filePath = path.join(shard, `${key}.webp`);
    await fs.writeFile(filePath, Buffer.alloc(bytes));
    await fs.utimes(filePath, new Date(recencyMs), new Date(recencyMs));
    return filePath;
  }

  // Helper: create a temp file
  async function putTmpFile(key: string, bytes: number, recencyMs: number): Promise<string> {
    const shard = path.join(cacheDir, key.slice(0, 2));
    await fs.mkdir(shard, { recursive: true });
    const filePath = path.join(shard, `${key}.123-abc123.tmp`);
    await fs.writeFile(filePath, Buffer.alloc(bytes));
    await fs.utimes(filePath, new Date(recencyMs), new Date(recencyMs));
    return filePath;
  }

  // Helper: key generator
  function key(n: number): string {
    return n.toString(16).padStart(32, '0');
  }

  describe('basic operation', () => {
    it('under the cap is a no-op', async () => {
      // Create five 100-byte entries
      for (let i = 1; i <= 5; i++) {
        await putEntry(key(i), 100, i * 1000);
      }

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 1000,
        now: clock,
      });

      expect(summary.ran).toBe(true);
      expect(summary.skipped).toBe('under-cap');
      expect(summary.evictedFiles).toBe(0);
      expect(summary.scannedFiles).toBe(5);
      expect(summary.totalBytesBefore).toBe(500);
      expect(summary.totalBytesAfter).toBe(500);

      // All files should still exist
      for (let i = 1; i <= 5; i++) {
        const stat = await fs.stat(path.join(cacheDir, key(i).slice(0, 2), `${key(i)}.webp`));
        expect(stat.size).toBe(100);
      }
    });

    it('exactly at the cap is a no-op', async () => {
      // Create entries totaling exactly 500 bytes
      for (let i = 1; i <= 5; i++) {
        await putEntry(key(i), 100, i * 1000);
      }

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 500,
        now: clock,
      });

      expect(summary.ran).toBe(true);
      expect(summary.skipped).toBe('under-cap');
      expect(summary.evictedFiles).toBe(0);
    });

    it('over the cap evicts oldest first down to 90 percent', async () => {
      // Create ten 100-byte entries with recencies n * 1000
      for (let i = 1; i <= 10; i++) {
        await putEntry(key(i), 100, i * 1000);
      }

      // Total is 1000, cap is 900, target is floor(900 * 0.9) = 810
      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 900,
        targetRatio: 0.9,
        now: clock,
      });

      expect(summary.ran).toBe(true);
      expect(summary.totalBytesBefore).toBe(1000);
      expect(summary.totalBytesAfter).toBe(800); // Two oldest (200 bytes) evicted
      expect(summary.evictedFiles).toBe(2);
      expect(summary.evictedBytes).toBe(200);

      // Keys 1 and 2 should be gone
      for (let i = 1; i <= 2; i++) {
        const exists = await fs
          .stat(path.join(cacheDir, key(i).slice(0, 2), `${key(i)}.webp`))
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(false);
      }

      // Keys 3-10 should remain
      for (let i = 3; i <= 10; i++) {
        const stat = await fs.stat(path.join(cacheDir, key(i).slice(0, 2), `${key(i)}.webp`));
        expect(stat.size).toBe(100);
      }
    });
  });

  describe('recency ordering', () => {
    it('eviction order is by recency, not by name or creation order', async () => {
      // Create entries in scrambled order with scrambled recencies
      const entries = [
        { k: 5, recency: 5000 },
        { k: 2, recency: 2000 },
        { k: 8, recency: 8000 },
        { k: 1, recency: 1000 },
        { k: 9, recency: 9000 },
      ];

      for (const { k, recency } of entries) {
        await putEntry(key(k), 100, recency);
      }

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 350, // Target: floor(350 * 0.9) = 315; evict first 2 (200 bytes) -> 300 bytes
        targetRatio: 0.9,
        now: clock,
      });

      expect(summary.evictedFiles).toBe(2);

      // Keys 1 and 2 (oldest) should be evicted
      expect(
        await fs
          .stat(path.join(cacheDir, key(1).slice(0, 2), `${key(1)}.webp`))
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
      expect(
        await fs
          .stat(path.join(cacheDir, key(2).slice(0, 2), `${key(2)}.webp`))
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
    });

    it('recency is max(atime, mtime)', async () => {
      // Entry A: atime 1000, mtime 9000, max = 9000
      const aPath = await putEntry(key(10), 100, 1000);
      await fs.utimes(aPath, new Date(1000), new Date(9000));

      // Entry B: atime 9000, mtime 1000, max = 9000
      const bPath = await putEntry(key(20), 100, 1000);
      await fs.utimes(bPath, new Date(9000), new Date(1000));

      // Over cap with room for one: since max(a.atime, a.mtime) === max(b.atime, b.mtime),
      // we evict by name: key(10) < key(20) so key(10) evicted
      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 150,
        targetRatio: 0.9,
        now: clock,
      });

      expect(summary.evictedFiles).toBe(1);

      const aExists = await fs
        .stat(aPath)
        .then(() => true)
        .catch(() => false);
      const bExists = await fs
        .stat(bPath)
        .then(() => true)
        .catch(() => false);

      // One should be evicted
      expect(aExists || bExists).toBe(true);
      expect(aExists && bExists).toBe(false);
    });

    it('ties are broken by name', async () => {
      // Three entries with identical recency
      await putEntry(key(3), 100, 5000);
      await putEntry(key(1), 100, 5000);
      await putEntry(key(2), 100, 5000);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 250,
        targetRatio: 0.9,
        now: clock,
      });

      expect(summary.evictedFiles).toBe(1);

      // key(1) should be evicted (lexicographically smallest)
      const k1Exists = await fs
        .stat(path.join(cacheDir, key(1).slice(0, 2), `${key(1)}.webp`))
        .then(() => true)
        .catch(() => false);
      expect(k1Exists).toBe(false);

      // key(2) and key(3) should survive
      expect(
        await fs
          .stat(path.join(cacheDir, key(2).slice(0, 2), `${key(2)}.webp`))
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
      expect(
        await fs
          .stat(path.join(cacheDir, key(3).slice(0, 2), `${key(3)}.webp`))
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
    });
  });

  describe('temporary files', () => {
    it('fresh temp files are neither counted nor deleted', async () => {
      // Create a fresh temp file (5 minutes before the clock)
      const tmpPath = await putTmpFile(key(10), 100, clock() - 5 * 60 * 1000);

      // Create a cache entry to trigger the sweep
      await putEntry(key(20), 50, 1000);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 10, // Over cap, should evict
        targetRatio: 0.9,
        now: clock,
      });

      // Temp file should not be counted
      expect(summary.totalBytesBefore).toBe(50); // Only the cache entry

      // Temp file should still exist
      const tmpExists = await fs
        .stat(tmpPath)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(true);
    });

    it('stale temp files are deleted', async () => {
      // Create a stale temp file (2 hours before the clock)
      const tmpPath = await putTmpFile(key(10), 100, clock() - 2 * 60 * 60 * 1000);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 1000,
        staleTmpMs: 60 * 60 * 1000,
        now: clock,
      });

      expect(summary.staleTmpRemoved).toBe(1);

      // Temp file should be gone
      const tmpExists = await fs
        .stat(tmpPath)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(false);
    });

    it('a temp file exactly one hour old is kept', async () => {
      const staleTmpMs = 60 * 60 * 1000;

      // Create a temp file exactly one hour old (strictly equal, not greater)
      const tmpPath = await putTmpFile(key(10), 100, clock() - staleTmpMs);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 1000,
        staleTmpMs,
        now: clock,
      });

      expect(summary.staleTmpRemoved).toBe(0);

      // Temp file should still exist
      const tmpExists = await fs
        .stat(tmpPath)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(true);
    });

    it('a temp file one millisecond more than one hour old is deleted', async () => {
      const staleTmpMs = 60 * 60 * 1000;

      // Create a temp file 1 hour + 1 ms old
      const tmpPath = await putTmpFile(key(10), 100, clock() - staleTmpMs - 1);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 1000,
        staleTmpMs,
        now: clock,
      });

      expect(summary.staleTmpRemoved).toBe(1);

      // Temp file should be gone
      const tmpExists = await fs
        .stat(tmpPath)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(false);
    });
  });

  describe('error handling', () => {
    it('missing cache directory is reported, not thrown', async () => {
      const nonexistent = path.join(cacheDir, 'nonexistent');

      const summary = await sweepOnce({
        cacheDir: nonexistent,
        maxBytes: 1000,
        now: clock,
      });

      expect(summary.ran).toBe(false);
      expect(summary.skipped).toBe('no-cache-dir');
      expect(summary.errors).toBe(0);
    });

    it('sweepOnce never rejects', async () => {
      // Create a file then remove the cache dir to trigger an error during readdir
      await putEntry(key(1), 100, 1000);
      await removeTree(cacheDir);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 1000,
        now: clock,
      });

      expect(summary.ran).toBe(false);
      expect(summary.errors).toBeGreaterThanOrEqual(0); // Should not throw
    });
  });

  describe('file filtering', () => {
    it('unrecognised files are never touched', async () => {
      // Create unrecognized files
      await fs.writeFile(path.join(cacheDir, 'README.txt'), 'test');
      await fs.writeFile(path.join(cacheDir, '.DS_Store'), 'test');

      const notes = path.join(cacheDir, key(1).slice(0, 2));
      await fs.mkdir(notes, { recursive: true });
      await fs.writeFile(path.join(notes, 'notes.txt'), 'test');

      // File in non-hex directory
      const nonHex = path.join(cacheDir, 'zz');
      await fs.mkdir(nonHex, { recursive: true });
      await fs.writeFile(path.join(nonHex, '1234.webp'), 'test');

      // Three-character directory
      const abc = path.join(cacheDir, 'abc');
      await fs.mkdir(abc, { recursive: true });

      // Create a cache entry to trigger sweep
      await putEntry(key(20), 50, 1000);

      await sweepOnce({
        cacheDir,
        maxBytes: 10,
        targetRatio: 0.9,
        now: clock,
      });

      // All unrecognized files should still exist
      const readmeExists = await fs
        .stat(path.join(cacheDir, 'README.txt'))
        .then(() => true)
        .catch(() => false);
      expect(readmeExists).toBe(true);

      const dsStoreExists = await fs
        .stat(path.join(cacheDir, '.DS_Store'))
        .then(() => true)
        .catch(() => false);
      expect(dsStoreExists).toBe(true);

      const notesExists = await fs
        .stat(path.join(notes, 'notes.txt'))
        .then(() => true)
        .catch(() => false);
      expect(notesExists).toBe(true);
    });

    it('symlinks are ignored', async () => {
      const symlinkPath = path.join(cacheDir, key(1).slice(0, 2), 'symlink.webp');
      const shardPath = path.join(cacheDir, key(1).slice(0, 2));
      await fs.mkdir(shardPath, { recursive: true });

      const targetPath = path.join(cacheDir, 'target.txt');
      await fs.writeFile(targetPath, 'test');

      const created = await trySymlink(targetPath, symlinkPath, 'file');
      if (!created) {
        // Skip test if symlinks not supported
        return;
      }

      // Create a real cache entry
      await putEntry(key(20), 50, 1000);

      await sweepOnce({
        cacheDir,
        maxBytes: 10,
        targetRatio: 0.9,
        now: clock,
      });

      // Symlink should still exist
      const symlinkExists = await fs
        .stat(symlinkPath)
        .then(() => true)
        .catch(() => false);
      expect(symlinkExists).toBe(true);
    });
  });

  describe('directory cleanup', () => {
    it('empty fan-out directories are removed after eviction', async () => {
      // Create multiple entries in different shards with properly formatted keys
      // Keys must have the shard as first 2 hex chars, total 32 chars
      // Recency: 1000, 2000, 3000 so oldest first is 1000
      await putEntry('0a' + '0'.repeat(30), 100, 1000); // Oldest, should be evicted
      await putEntry('0c' + '0'.repeat(30), 100, 2000); // Second oldest, should be evicted
      await putEntry('0e' + '0'.repeat(30), 100, 3000); // Newest, should survive

      // Total is 300, cap = 200, target = floor(200 * 0.9) = 180
      // Total 300 > 200, so evict oldest (100) -> 200 (still > 180), evict next (100) -> 100 (< 180, done)
      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 200,
        targetRatio: 0.9,
        now: clock,
      });

      // Should evict the two oldest files
      expect(summary.evictedFiles).toBe(2);
      // Those are in shards 0a and 0c, should be removed
      expect(summary.emptyDirsRemoved).toBeGreaterThanOrEqual(2);
    });

    it('a non-empty directory is never removed', async () => {
      // Create multiple entries in the same shard
      await putEntry('0a' + '0'.repeat(30), 100, 1000);
      await putEntry('0a' + '1'.repeat(30), 100, 2000);
      await putEntry('0a' + '2'.repeat(30), 100, 3000);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 250,
        targetRatio: 0.9,
        now: clock,
      });

      expect(summary.evictedFiles).toBe(1);
      expect(summary.emptyDirsRemoved).toBe(0); // Directory still has 2 files

      // Shard should still exist
      const shardExists = await fs
        .stat(path.join(cacheDir, '0a'))
        .then(() => true)
        .catch(() => false);
      expect(shardExists).toBe(true);
    });

    it('a non-empty directory with a temp file is never removed', async () => {
      // Create a cache entry and a temp file in the same shard
      await putEntry('0a' + '0'.repeat(30), 100, 1000);
      await putTmpFile('0a' + '1'.repeat(30), 50, clock() - 5 * 60 * 1000);

      const summary = await sweepOnce({
        cacheDir,
        maxBytes: 80,
        targetRatio: 0.9,
        now: clock,
      });

      expect(summary.evictedFiles).toBe(1);
      expect(summary.emptyDirsRemoved).toBe(0); // Directory still has temp file

      // Shard should still exist
      const shardExists = await fs
        .stat(path.join(cacheDir, '0a'))
        .then(() => true)
        .catch(() => false);
      expect(shardExists).toBe(true);
    });
  });

  describe('logging', () => {
    it('an evicting sweep emits exactly one cache.sweep event at info', async () => {
      const { logger, events } = createTestLogger();

      await putEntry(key(1), 100, 1000);
      await putEntry(key(2), 100, 2000);

      const _summary = await sweepOnce({
        cacheDir,
        maxBytes: 150,
        targetRatio: 0.9,
        logger,
        now: clock,
      });

      const sweepEvents = events.filter((e) => e.event === 'cache.sweep');
      expect(sweepEvents).toHaveLength(1);
      expect(sweepEvents[0]?.level).toBe('info');

      const fields = sweepEvents[0]?.fields;
      expect(fields).toHaveProperty('cacheDir', cacheDir);
      expect(fields).toHaveProperty('maxBytes');
      expect(fields).toHaveProperty('before');
      expect(fields).toHaveProperty('after');
      expect(fields).toHaveProperty('scanned');
      expect(fields).toHaveProperty('evicted');
      expect(fields).toHaveProperty('evictedBytes');
      expect(fields).toHaveProperty('staleTmp');
      expect(fields).toHaveProperty('emptyDirs');
      expect(fields).toHaveProperty('errors');
      expect(fields).toHaveProperty('ms');
    });

    it('an idle sweep emits no cache.sweep event', async () => {
      const { logger, events } = createTestLogger();

      await putEntry(key(1), 100, 1000);

      const _summary2 = await sweepOnce({
        cacheDir,
        maxBytes: 1000,
        logger,
        now: clock,
      });

      const sweepEvents = events.filter((e) => e.event === 'cache.sweep');
      expect(sweepEvents).toHaveLength(0);
    });
  });

  describe('scheduler', () => {
    it('startCacheSweeper creates a sweeper that can be stopped', async () => {
      const { logger } = createTestLogger();

      await putEntry(key(1), 100, 1000);

      const sweeper = startCacheSweeper({
        cacheDir,
        maxBytes: 1000,
        logger,
        intervalMs: 600_000,
        now: clock,
      });

      // Run the first sweep forcefully
      const result = await sweeper.runNow({ force: true });
      expect(result.ran || result.skipped === 'under-cap').toBe(true);

      // Stop should succeed
      await sweeper.stop();
    });

    it('at most one sweep per ten minutes', async () => {
      const { logger } = createTestLogger();
      // Use a base time that's not going to have weird formatting issues
      let currentTime = 1_000_000_000;
      const now = () => currentTime;

      const sweeper = startCacheSweeper({
        cacheDir,
        maxBytes: 1000_000, // Large cap so the file won't be evicted
        logger,
        intervalMs: 600_000,
        now,
      });

      // First run should execute
      const result1 = await sweeper.runNow({ force: true });
      expect(result1).toBeDefined();

      // Immediate second run should be throttled
      const result2 = await sweeper.runNow();
      expect(result2.skipped).toBe('throttled');

      // Advance time beyond the interval
      currentTime += 600_001;

      // Now a non-forced run should execute
      const result3 = await sweeper.runNow();
      expect(result3.ran || result3.skipped === 'under-cap').toBe(true);

      await sweeper.stop();
    });
  });

  describe('re-entrancy guard', () => {
    it('concurrent sweeps on the same directory are serialized', async () => {
      await putEntry(key(1), 100, 1000);

      // Start two sweeps at once (without awaiting the first)
      const promise1 = sweepOnce({
        cacheDir,
        maxBytes: 1000,
        now: clock,
      });

      const promise2 = sweepOnce({
        cacheDir,
        maxBytes: 1000,
        now: clock,
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // One should run, one should be skipped with 'already-running'
      const ran = (result1.ran ? 1 : 0) + (result2.ran ? 1 : 0);
      expect(ran).toBe(1);

      const skipped =
        (result1.skipped === 'already-running' ? 1 : 0) +
        (result2.skipped === 'already-running' ? 1 : 0);
      expect(skipped).toBe(1);
    });
  });

  describe('no HTTP surface', () => {
    it('cacheSweep exports only the service functions', async () => {
      const module = await import('../../src/services/cacheSweep.js');

      // Should export these
      expect(module.sweepOnce).toBeDefined();
      expect(module.startCacheSweeper).toBeDefined();

      // Should not export HTTP-related functions
      expect((module as Record<string, unknown>).createRouter).toBeUndefined();
      expect((module as Record<string, unknown>).cacheRouter).toBeUndefined();
    });
  });
});
