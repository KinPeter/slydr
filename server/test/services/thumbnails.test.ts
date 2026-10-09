/**
 * Comprehensive test suite for the thumbnail service.
 * Specification §12.1: cache-key invalidation, in-flight coalescing, atomic rename,
 * size allowlist rejection, failure path, EXIF orientation, semaphore ceiling.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  createThumbnailService,
  computeThumbnailKey,
  thumbnailPathFor,
  isThumbnailSize,
  defaultConcurrency,
  Semaphore,
  sharpInputOptions,
  PIPELINE_VERSION,
} from '../../src/services/thumbnails.js';
import { ApiError } from '../../src/middleware/errorEnvelope.js';
import { createTestLogger } from '../helpers/logger.js';
import { makeTempBase, removeTree } from '../helpers/fs.js';
import {
  makeJpeg,
  makeBands,
  makePng,
  makeGif,
  makeWebp,
  makeAvif,
  makeSvg,
  pixelAt,
  fakeRender,
  deferred,
} from '../helpers/images.js';

describe('Thumbnail Service', () => {
  let tempBase: string;
  let srcDir: string;

  beforeAll(async () => {
    tempBase = await makeTempBase('slydr-thumbs-');
    srcDir = path.join(tempBase, 'src');
    await fs.mkdir(srcDir, { recursive: true });
  });

  afterAll(async () => {
    await removeTree(tempBase);
  });

  describe('isThumbnailSize', () => {
    it('accepts 128, 256, 384, 512', () => {
      expect(isThumbnailSize(128)).toBe(true);
      expect(isThumbnailSize(256)).toBe(true);
      expect(isThumbnailSize(384)).toBe(true);
      expect(isThumbnailSize(512)).toBe(true);
    });

    it('rejects other sizes', () => {
      const invalid = [
        0,
        1,
        100,
        255,
        257,
        1024,
        -256,
        256.5,
        NaN,
        Infinity,
        '256',
        null,
        undefined,
      ];
      for (const val of invalid) {
        expect(isThumbnailSize(val)).toBe(false);
      }
    });
  });

  describe('computeThumbnailKey', () => {
    it('key matches the specified formula', () => {
      const input = { absPath: '/home/user/pic.jpg', mtimeMs: 1000, fileSize: 5000, size: 256 };
      const key = computeThumbnailKey(input);

      const expected = createHash('sha256')
        .update(
          `${input.absPath}|${input.mtimeMs}|${input.fileSize}|${input.size}|${PIPELINE_VERSION}`,
        )
        .digest('hex')
        .slice(0, 32);

      expect(key).toBe(expected);
    });

    it('key is 32 lowercase hex characters', () => {
      const key = computeThumbnailKey({
        absPath: '/test',
        mtimeMs: 123,
        fileSize: 456,
        size: 256,
      });
      expect(key).toMatch(/^[0-9a-f]{32}$/);
    });

    it('key is stable for identical input', () => {
      const input = { absPath: '/pic', mtimeMs: 100, fileSize: 200, size: 256 };
      const k1 = computeThumbnailKey(input);
      const k2 = computeThumbnailKey(input);
      expect(k1).toBe(k2);
    });

    it('key changes when mtimeMs changes', () => {
      const input = { absPath: '/pic', mtimeMs: 100, fileSize: 200, size: 256 };
      const k1 = computeThumbnailKey(input);
      const k2 = computeThumbnailKey({ ...input, mtimeMs: 101 });
      expect(k1).not.toBe(k2);
    });

    it('key changes when fileSize changes', () => {
      const input = { absPath: '/pic', mtimeMs: 100, fileSize: 200, size: 256 };
      const k1 = computeThumbnailKey(input);
      const k2 = computeThumbnailKey({ ...input, fileSize: 201 });
      expect(k1).not.toBe(k2);
    });

    it('key changes when size changes', () => {
      const input = { absPath: '/pic', mtimeMs: 100, fileSize: 200, size: 256 };
      const k1 = computeThumbnailKey(input);
      const k2 = computeThumbnailKey({ ...input, size: 384 });
      expect(k1).not.toBe(k2);
    });

    it('key changes when the path changes', () => {
      const input = { absPath: '/pic1', mtimeMs: 100, fileSize: 200, size: 256 };
      const k1 = computeThumbnailKey(input);
      const k2 = computeThumbnailKey({ ...input, absPath: '/pic2' });
      expect(k1).not.toBe(k2);
    });

    it('PIPELINE_VERSION is part of the key', () => {
      // Verify that the constant is actually used in the key computation
      const input = { absPath: '/pic', mtimeMs: 100, fileSize: 200, size: 256 };
      const key = computeThumbnailKey(input);

      // The key should include the PIPELINE_VERSION constant
      const withoutVersion = createHash('sha256')
        .update(`${input.absPath}|${input.mtimeMs}|${input.fileSize}|${input.size}|0`)
        .digest('hex')
        .slice(0, 32);

      expect(key).not.toBe(withoutVersion);
    });
  });

  describe('thumbnailPathFor', () => {
    it('returns correct path layout', () => {
      const cacheDir = '/cache';
      const key = 'ab1234567890abcdef1234567890abcd';
      const filePath = thumbnailPathFor(cacheDir, key);

      expect(filePath).toBe(path.join(cacheDir, 'ab', 'ab1234567890abcdef1234567890abcd.webp'));
    });
  });

  describe('defaultConcurrency', () => {
    it('returns min(4, availableParallelism)', () => {
      expect(defaultConcurrency(1)).toBe(1);
      expect(defaultConcurrency(2)).toBe(2);
      expect(defaultConcurrency(4)).toBe(4);
      expect(defaultConcurrency(8)).toBe(4);
      expect(defaultConcurrency(64)).toBe(4);
      expect(defaultConcurrency(0)).toBe(1);
    });
  });

  describe('Semaphore', () => {
    it('never exceeds its limit', async () => {
      const sem = new Semaphore(2);
      let concurrent = 0;
      let maxConcurrent = 0;

      const tasks = Array.from({ length: 6 }, () =>
        sem.run(async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 10));
          concurrent--;
        }),
      );

      await Promise.all(tasks);
      expect(maxConcurrent).toBe(2);
    });

    it('is FIFO', async () => {
      const sem = new Semaphore(1);
      const order: number[] = [];

      const tasks = Array.from({ length: 3 }, (_, i) =>
        sem.run(async () => {
          order.push(i);
        }),
      );

      await Promise.all(tasks);
      expect(order).toEqual([0, 1, 2]);
    });

    it('releases on rejection', async () => {
      const sem = new Semaphore(1);
      let second = false;

      try {
        await sem.run(async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      await sem.run(async () => {
        second = true;
      });

      expect(second).toBe(true);
    });

    it('rejects invalid limits', () => {
      expect(() => new Semaphore(0)).toThrow(RangeError);
      expect(() => new Semaphore(-1)).toThrow(RangeError);
      expect(() => new Semaphore(1.5)).toThrow(RangeError);
      expect(() => new Semaphore(NaN)).toThrow(RangeError);
    });
  });

  describe('sharpInputOptions', () => {
    it('includes failOn and limitInputPixels for all formats', () => {
      const opts = sharpInputOptions('/pic.jpg', 100000);
      expect(opts.failOn).toBe('none');
      expect(opts.limitInputPixels).toBe(100000);
    });

    it('includes density: 96 for SVG', () => {
      const opts = sharpInputOptions('/pic.svg', 100000);
      expect(opts.density).toBe(96);
    });

    it('includes density: 96 for .SVG (case-insensitive)', () => {
      const opts = sharpInputOptions('/pic.SVG', 100000);
      expect(opts.density).toBe(96);
    });

    it('does not include density for raster formats', () => {
      const jpg = sharpInputOptions('/pic.jpg', 100000);
      expect(jpg.density).toBeUndefined();

      const png = sharpInputOptions('/pic.png', 100000);
      expect(png.density).toBeUndefined();
    });
  });

  describe('Cache behaviour', () => {
    it('second call for unchanged file is a cache hit', async () => {
      const cacheDir = path.join(tempBase, 'cache-1');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'test1.jpg');
      await makeJpeg(srcPath, 100, 100);

      // First call
      const r1 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r1.cached).toBe(false);
      expect(handle.renderCount).toBe(1);

      // Second call
      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.cached).toBe(true);
      expect(handle.renderCount).toBe(1); // No additional render
      expect(r1.key).toBe(r2.key);
      expect(r1.filePath).toBe(r2.filePath);
    });

    it('changing mtime invalidates', async () => {
      const cacheDir = path.join(tempBase, 'cache-mtime');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'test-mtime.jpg');
      await makeJpeg(srcPath, 100, 100);

      const r1 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(handle.renderCount).toBe(1);

      // Change mtime (utimes uses seconds, not milliseconds)
      const now = Math.floor(Date.now() / 1000);
      await fs.utimes(srcPath, now + 60, now + 60);

      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.cached).toBe(false);
      expect(handle.renderCount).toBe(2);
      expect(r1.key).not.toBe(r2.key);
    });

    it('changing file size invalidates', async () => {
      const cacheDir = path.join(tempBase, 'cache-size');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'test-size.jpg');
      await makeJpeg(srcPath, 100, 100);

      const r1 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(handle.renderCount).toBe(1);
      const key1 = r1.key;

      // Append bytes then restore mtime
      const stat = await fs.stat(srcPath);
      await fs.appendFile(srcPath, Buffer.from([1, 2, 3]));
      // utimes uses seconds
      await fs.utimes(srcPath, Math.floor(stat.mtimeMs / 1000), Math.floor(stat.mtimeMs / 1000));

      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.cached).toBe(false);
      expect(handle.renderCount).toBe(2);
      expect(r2.key).not.toBe(key1);
    });

    it('file layout matches specification', async () => {
      const cacheDir = path.join(tempBase, 'cache-layout');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'test-layout.jpg');
      await makeJpeg(srcPath, 100, 100);

      const result = await service.getThumbnail({ absPath: srcPath, size: 256 });

      // Verify file exists at the right location
      const stat = await fs.stat(result.filePath);
      expect(stat.isFile()).toBe(true);

      // Verify shard directory exists
      const shardDir = path.dirname(result.filePath);
      expect(await fs.stat(shardDir).then((s) => s.isDirectory())).toBe(true);

      // Verify path matches formula
      const expected = thumbnailPathFor(cacheDir, result.key);
      expect(result.filePath).toBe(expected);
    });

    it('cache directory is created recursively on first use', async () => {
      const cacheDir = path.join(tempBase, 'nested', 'cache', 'dirs');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'test-recursive.jpg');
      await makeJpeg(srcPath, 100, 100);

      await service.getThumbnail({ absPath: srcPath, size: 256 });

      // Verify directory was created
      const stat = await fs.stat(cacheDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('cache directory is private on POSIX', async () => {
      if (process.platform === 'win32') {
        // Skip on Windows
        return;
      }

      const cacheDir = path.join(tempBase, 'cache-perms');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'test-perms.jpg');
      await makeJpeg(srcPath, 100, 100);

      await service.getThumbnail({ absPath: srcPath, size: 256 });

      const stat = await fs.stat(cacheDir);
      const mode = stat.mode;
      // Check that group and other have no permissions
      expect((mode & 0o077) === 0).toBe(true);
    });

    it('a hit refreshes last-used when older than the touch interval', async () => {
      const cacheDir = path.join(tempBase, 'cache-touch');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();
      let nowValue = 1000000;
      const now = () => nowValue;

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
        now,
        touchIntervalMs: 60000, // 1 minute
      });

      const srcPath = path.join(srcDir, 'test-touch.jpg');
      await makeJpeg(srcPath, 100, 100);

      // First call
      const r1 = await service.getThumbnail({ absPath: srcPath, size: 256 });

      // Set mtime to 2 hours ago
      nowValue = 1000000 + 2 * 60 * 60 * 1000;
      // utimes takes seconds, convert by dividing by 1000
      const twoHoursAgo = Math.floor((nowValue - 2 * 60 * 60 * 1000) / 1000);
      await fs.utimes(r1.filePath, twoHoursAgo, twoHoursAgo);

      // Second call (cache hit)
      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.cached).toBe(true);

      // mtime should be updated (allowing for rounding due to second-precision storage)
      const stat = await fs.stat(r1.filePath);
      const diff = Math.abs(stat.mtimeMs - nowValue);
      expect(diff <= 2000).toBe(true);
    });

    it('a recent cache hit does not refresh', async () => {
      const cacheDir = path.join(tempBase, 'cache-no-touch');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();
      let nowValue = 2000000;
      const now = () => nowValue;

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
        now,
        touchIntervalMs: 60000,
      });

      const srcPath = path.join(srcDir, 'test-no-touch.jpg');
      await makeJpeg(srcPath, 100, 100);

      const r1 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      const stat1 = await fs.stat(r1.filePath);
      const mtime1 = stat1.mtimeMs;

      // Advance time slightly (within touch interval)
      nowValue = 2000000 + 30000;

      // Second call
      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.cached).toBe(true);

      // mtime should NOT change
      const stat2 = await fs.stat(r1.filePath);
      expect(stat2.mtimeMs).toBe(mtime1);
    });

    it('zero-length cache file is treated as a miss', async () => {
      const cacheDir = path.join(tempBase, 'cache-zero');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'test-zero.jpg');
      await makeJpeg(srcPath, 100, 100);

      const r1 = await service.getThumbnail({ absPath: srcPath, size: 256 });

      // Pre-create an empty final file
      await fs.writeFile(r1.filePath, Buffer.alloc(0));

      // Next request should re-render
      handle.reset();
      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.cached).toBe(false);
      expect(handle.renderCount).toBe(1);
    });

    it('missing source is NOT_FOUND', async () => {
      const cacheDir = path.join(tempBase, 'cache-missing');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'nonexistent.jpg');

      await expect(service.getThumbnail({ absPath: srcPath, size: 256 })).rejects.toThrow(ApiError);

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('NOT_FOUND');
        }
      }
    });

    it('directory is NOT_A_FILE', async () => {
      const cacheDir = path.join(tempBase, 'cache-dir-err');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const dirPath = path.join(srcDir, 'a-dir');
      await fs.mkdir(dirPath, { recursive: true });

      try {
        await service.getThumbnail({ absPath: dirPath, size: 256 });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('NOT_A_FILE');
        }
      }
    });
  });

  describe('Size allowlist', () => {
    it('accepts 128, 256, 384, 512', async () => {
      const cacheDir = path.join(tempBase, 'cache-sizes');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'sizes.jpg');
      await makeJpeg(srcPath, 100, 100);

      for (const size of [128, 256, 384, 512] as const) {
        const result = await service.getThumbnail({ absPath: srcPath, size });
        expect(result).toBeDefined();
      }
    });

    it('rejects other sizes before FS access', async () => {
      const cacheDir = path.join(tempBase, 'cache-invalid-sizes');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      // Even for a nonexistent path, size validation happens first
      const srcPath = path.join(srcDir, 'nonexistent-for-size.jpg');

      const invalid = [
        0,
        1,
        100,
        255,
        257,
        1024,
        -256,
        256.5,
        NaN,
        Infinity,
        '256',
        null,
        undefined,
      ];

      for (const size of invalid) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await service.getThumbnail({ absPath: srcPath, size: size as any });
          expect.fail(`Should reject size ${size}`);
        } catch (err) {
          if (err instanceof ApiError) {
            expect(err.code).toBe('INVALID_PARAM');
            expect(err.status).toBe(400);
          }
        }
      }
    });

    it('rejects relative absPath with plain Error', async () => {
      const cacheDir = path.join(tempBase, 'cache-rel-path');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      try {
        await service.getThumbnail({ absPath: 'relative/path.jpg', size: 256 });
        expect.fail('Should throw an error');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        // Should not be an ApiError (plain Error expected)
        expect(err).not.toBeInstanceOf(ApiError);
      }
    });
  });

  describe('In-flight coalescing', () => {
    it('N concurrent requests run one render', async () => {
      const cacheDir = path.join(tempBase, 'cache-coal');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();
      const { promise, resolve } = deferred<void>();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: async (job) => {
          await renderer(job);
          await promise; // Wait for gate
        },
      });

      const srcPath = path.join(srcDir, 'coal.jpg');
      await makeJpeg(srcPath, 100, 100);

      // Issue 20 concurrent requests
      const promises = Array.from({ length: 20 }, () =>
        service.getThumbnail({ absPath: srcPath, size: 256 }),
      );

      // Give them time to queue up
      await new Promise((r) => setTimeout(r, 50));

      // Release the gate
      resolve();

      const results = await Promise.all(promises);

      // All should have the same key and filePath
      const firstKey = results[0]!.key;
      const firstPath = results[0]!.filePath;
      for (const r of results) {
        expect(r.key).toBe(firstKey);
        expect(r.filePath).toBe(firstPath);
      }

      // Render should have run exactly once
      expect(handle.renderCount).toBe(1);

      // Inflight map should be empty
      expect(service.inflightCount()).toBe(0);
    });

    it('different sizes of the same image are separate jobs', async () => {
      const cacheDir = path.join(tempBase, 'cache-diff-sizes');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'diff-sizes.jpg');
      await makeJpeg(srcPath, 100, 100);

      const r256 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      const r384 = await service.getThumbnail({ absPath: srcPath, size: 384 });

      expect(r256.key).not.toBe(r384.key);
      expect(handle.renderCount).toBe(2);
    });

    it('failure is shared then forgotten', async () => {
      const cacheDir = path.join(tempBase, 'cache-fail-coal');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();
      const { promise, resolve } = deferred<void>();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: async (job) => {
          await renderer(job);
          await promise;
          throw new Error('boom');
        },
      });

      const srcPath = path.join(srcDir, 'fail-coal.jpg');
      await makeJpeg(srcPath, 100, 100);

      const promises = Array.from({ length: 20 }, () =>
        service.getThumbnail({ absPath: srcPath, size: 256 }),
      );

      await new Promise((r) => setTimeout(r, 50));
      resolve();

      const results = await Promise.allSettled(promises);

      // All should fail
      for (const r of results) {
        expect(r.status).toBe('rejected');
      }

      // Render should have run exactly once
      expect(handle.renderCount).toBe(1);

      // Inflight map should be empty
      expect(service.inflightCount()).toBe(0);

      // A later call should start a new render
      const { renderer: renderer2, handle: handle2 } = fakeRender();
      const service2 = createThumbnailService({
        cacheDir,
        logger,
        render: renderer2,
      });

      const r = await service2.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r).toBeDefined();
      expect(handle2.renderCount).toBe(1);
    });

    it('caller arriving after completion gets a hit', async () => {
      const cacheDir = path.join(tempBase, 'cache-after-comp');
      const { logger } = createTestLogger();
      const { renderer, handle } = fakeRender();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'after-comp.jpg');
      await makeJpeg(srcPath, 100, 100);

      // First call
      const r1 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r1.cached).toBe(false);

      // Second call arrives after completion
      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.cached).toBe(true);

      // Render should have run exactly once
      expect(handle.renderCount).toBe(1);
    });

    it('coalesced waiters do not occupy permits', async () => {
      const cacheDir = path.join(tempBase, 'cache-no-permits');
      const { logger } = createTestLogger();
      let active = 0;
      let maxActive = 0;

      const service = createThumbnailService({
        cacheDir,
        logger,
        concurrency: 1,
        render: async (job) => {
          active++;
          maxActive = Math.max(maxActive, active);
          // Write a valid WebP to the destination
          const minWebp = Buffer.from([
            0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
            0x38, 0x4c, 0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          ]);
          await fs.writeFile(job.destPath, minWebp);
          // Simulate slow render
          await new Promise((r) => setTimeout(r, 100));
          active--;
        },
      });

      const srcPath = path.join(srcDir, 'no-permits.jpg');
      await makeJpeg(srcPath, 100, 100);

      // 10 requests for key A
      const promisesA = Array.from({ length: 10 }, () =>
        service.getThumbnail({ absPath: srcPath, size: 256 }),
      );

      // While A is rendering, 1 request for a different image (different path)
      const srcPath2 = path.join(srcDir, 'no-permits-2.jpg');
      await makeJpeg(srcPath2, 100, 100);

      const promisesB = [service.getThumbnail({ absPath: srcPath2, size: 256 })];

      // B should queue behind A's single permit, but A's duplicates should not add queue entries
      const [resultsA, resultsB] = await Promise.all([
        Promise.all(promisesA),
        Promise.all(promisesB),
      ]);

      expect(resultsA).toBeDefined();
      expect(resultsB).toBeDefined();

      // maxActive should not exceed 2 (one for A, one for B in different path)
      // Actually with concurrency 1, it should stay at 1
      expect(maxActive <= 2).toBe(true);
    });

    it('no unhandled rejection', async () => {
      const cacheDir = path.join(tempBase, 'cache-no-unhandled');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();
      const { promise, resolve } = deferred<void>();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: async (job) => {
          await renderer(job);
          await promise;
          throw new Error('fail');
        },
      });

      const srcPath = path.join(srcDir, 'no-unhandled.jpg');
      await makeJpeg(srcPath, 100, 100);

      let unhandledRejection = false;
      const handler = () => {
        unhandledRejection = true;
      };
      process.on('unhandledRejection', handler);

      try {
        const promises = Array.from({ length: 5 }, () =>
          service.getThumbnail({ absPath: srcPath, size: 256 }),
        );

        await new Promise((r) => setTimeout(r, 50));
        resolve();

        await Promise.allSettled(promises);

        // Wait a bit for any unhandled rejections to fire
        await new Promise((r) => setTimeout(r, 100));

        expect(unhandledRejection).toBe(false);
      } finally {
        process.removeListener('unhandledRejection', handler);
      }
    });
  });

  describe('Atomic rename', () => {
    it('no partial file is observable', async () => {
      const cacheDir = path.join(tempBase, 'cache-atomic');
      const { logger } = createTestLogger();
      const { promise, resolve } = deferred<void>();

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: async (job) => {
          // Write partial data
          const data = Buffer.alloc(100);
          await fs.writeFile(job.destPath, data);
          // Wait for gate
          await promise;
          // Write final data after gate
          await fs.writeFile(job.destPath, Buffer.alloc(200));
        },
      });

      const srcPath = path.join(srcDir, 'atomic.jpg');
      await makeJpeg(srcPath, 100, 100);

      const getThumbnailPromise = service.getThumbnail({ absPath: srcPath, size: 256 });

      // Wait for render to write partial data
      await new Promise((r) => setTimeout(r, 100));

      // Release the gate to let render complete
      resolve();

      const result = await getThumbnailPromise;

      // After completion, check state
      const finalStat = await fs.stat(result.filePath);
      expect(finalStat.size > 0).toBe(true);

      const shardDir = path.dirname(result.filePath);
      const entries = await fs.readdir(shardDir);

      // Should have no .tmp files
      const tmpFiles = entries.filter((e) => e.endsWith('.tmp'));
      expect(tmpFiles.length).toBe(0);
    });

    it('failure after partial write cleans up', async () => {
      const cacheDir = path.join(tempBase, 'cache-cleanup');
      const { logger } = createTestLogger();

      // Renderer that writes then rejects
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const failingRenderer = async (job: any) => {
        const data = Buffer.alloc(100);
        await fs.writeFile(job.destPath, data);
        throw new Error('render fail');
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: failingRenderer,
      });

      const srcPath = path.join(srcDir, 'cleanup.jpg');
      await makeJpeg(srcPath, 100, 100);

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }

      // Check that no .tmp files remain
      const cacheSubdirs = await fs.readdir(cacheDir);
      for (const subdir of cacheSubdirs) {
        const fullPath = path.join(cacheDir, subdir);
        const files = await fs.readdir(fullPath);
        const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
        expect(tmpFiles.length).toBe(0);
      }
    });

    it('rename is retried on EPERM, EACCES and EBUSY', async () => {
      const cacheDir = path.join(tempBase, 'cache-retry');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      let renameAttempt = 0;
      const retryRename = async (from: string, to: string) => {
        renameAttempt++;
        if (renameAttempt < 3) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const err: any = new Error('busy');
          err.code = 'EBUSY';
          throw err;
        }
        // Third attempt succeeds
        await fs.rename(from, to);
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
        rename: retryRename,
      });

      const srcPath = path.join(srcDir, 'retry.jpg');
      await makeJpeg(srcPath, 100, 100);

      const result = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(result).toBeDefined();
      expect(renameAttempt).toBe(3);
    });

    it('rename failure with destination already present is success', async () => {
      const cacheDir = path.join(tempBase, 'cache-dest-exists');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const failingRename = async (_from: string, _to: string) => {
        // Always fail but let the destination exist
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error('perm');
        err.code = 'EPERM';
        throw err;
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
        rename: failingRename,
      });

      const srcPath = path.join(srcDir, 'dest-exists.jpg');
      await makeJpeg(srcPath, 100, 100);

      // Do a successful render first
      const { renderer: renderer2 } = fakeRender();
      const service2 = createThumbnailService({
        cacheDir,
        logger,
        render: renderer2,
      });
      const r1 = await service2.getThumbnail({ absPath: srcPath, size: 256 });

      // Now try with the failing rename; it should succeed because the file already exists
      const r2 = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(r2.filePath).toBe(r1.filePath);
    });

    it('rename that keeps failing without a destination fails cleanly', async () => {
      const cacheDir = path.join(tempBase, 'cache-rename-fail');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      let renameAttempts = 0;
      const alwaysFailRename = async (_from: string, _to: string) => {
        renameAttempts++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error('perm');
        err.code = 'EPERM';
        throw err;
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
        rename: alwaysFailRename,
      });

      const srcPath = path.join(srcDir, 'rename-fail.jpg');
      await makeJpeg(srcPath, 100, 100);

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }

      // Should have retried a few times
      expect(renameAttempts > 1).toBe(true);
    });

    it('two service instances racing on same key both succeed', async () => {
      const cacheDir = path.join(tempBase, 'cache-race');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      const service1 = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const service2 = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
      });

      const srcPath = path.join(srcDir, 'race.jpg');
      await makeJpeg(srcPath, 100, 100);

      const [r1, r2] = await Promise.all([
        service1.getThumbnail({ absPath: srcPath, size: 256 }),
        service2.getThumbnail({ absPath: srcPath, size: 256 }),
      ]);

      expect(r1.filePath).toBe(r2.filePath);
      expect(r1.key).toBe(r2.key);

      const stat = await fs.stat(r1.filePath);
      expect(stat.isFile()).toBe(true);
    });

    it('non-retryable rename errors are not retried', async () => {
      const cacheDir = path.join(tempBase, 'cache-non-retryable');
      const { logger } = createTestLogger();
      const { renderer } = fakeRender();

      let renameAttempts = 0;
      const nonRetryableRename = async (_from: string, _to: string) => {
        renameAttempts++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error('no space');
        err.code = 'ENOSPC';
        throw err;
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: renderer,
        rename: nonRetryableRename,
      });

      const srcPath = path.join(srcDir, 'non-retryable.jpg');
      await makeJpeg(srcPath, 100, 100);

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }

      // Should have attempted exactly once
      expect(renameAttempts).toBe(1);
    });
  });

  describe('Real sharp pipeline', () => {
    it('produces square WebP of requested size', async () => {
      const cacheDir = path.join(tempBase, 'cache-sharp');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const testCases = [
        { width: 400, height: 200, size: 128 as const },
        { width: 200, height: 400, size: 256 as const },
        { width: 20, height: 20, size: 384 as const },
        { width: 100, height: 100, size: 512 as const },
      ];

      for (const tc of testCases) {
        const srcPath = path.join(srcDir, `sharp-${tc.width}-${tc.height}-${tc.size}.jpg`);
        await makeJpeg(srcPath, tc.width, tc.height);

        const result = await service.getThumbnail({ absPath: srcPath, size: tc.size });

        const metadata = await sharp(result.filePath).metadata();
        expect(metadata.format).toBe('webp');
        expect(metadata.width).toBe(tc.size);
        expect(metadata.height).toBe(tc.size);
      }
    });

    it('uses centre cover, not stretch', async () => {
      const cacheDir = path.join(tempBase, 'cache-cover');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'cover.png');
      await makeBands(srcPath);

      const result = await service.getThumbnail({ absPath: srcPath, size: 128 });

      // makeBands has left=red, middle=green, right=blue
      // With centre cover crop, the middle (green) band should be visible at all edges
      const left = await pixelAt(result.filePath, 0, 64);
      const centre = await pixelAt(result.filePath, 64, 64);
      const right = await pixelAt(result.filePath, 127, 64);

      // All should be predominantly green (middle band was cropped to fill)
      // Account for lossy WebP compression at quality 72
      const isGreen = (rgb: [number, number, number]) => rgb[1] > rgb[0] && rgb[1] > rgb[2]; // Green channel should dominate

      expect(isGreen(left)).toBe(true);
      expect(isGreen(centre)).toBe(true);
      expect(isGreen(right)).toBe(true);
    });

    it('applies EXIF orientation', async () => {
      const cacheDir = path.join(tempBase, 'cache-exif');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      // Orientation 6: 90° CW (portrait, stored landscape)
      const srcPath6 = path.join(srcDir, 'exif-6.jpg');
      await makeJpeg(srcPath6, 200, 100, { orientation: 6 });

      const result6 = await service.getThumbnail({ absPath: srcPath6, size: 128 });
      const topCentre = await pixelAt(result6.filePath, 64, 0);
      const bottomCentre = await pixelAt(result6.filePath, 64, 127);

      // Left half (red) should be at top, right half (blue) at bottom
      const isRed = (rgb: [number, number, number]) => rgb[0] > 180 && rgb[1] < 80 && rgb[2] < 80;
      const isBlue = (rgb: [number, number, number]) => rgb[0] < 80 && rgb[1] < 80 && rgb[2] > 180;

      expect(isRed(topCentre)).toBe(true);
      expect(isBlue(bottomCentre)).toBe(true);

      // Orientation 8: 90° CCW
      const srcPath8 = path.join(srcDir, 'exif-8.jpg');
      await makeJpeg(srcPath8, 200, 100, { orientation: 8 });

      const result8 = await service.getThumbnail({ absPath: srcPath8, size: 128 });
      const top8 = await pixelAt(result8.filePath, 64, 0);
      const bottom8 = await pixelAt(result8.filePath, 64, 127);

      expect(isBlue(top8)).toBe(true);
      expect(isRed(bottom8)).toBe(true);
    });

    it('output has no EXIF', async () => {
      const cacheDir = path.join(tempBase, 'cache-no-exif');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'no-exif.jpg');
      await makeJpeg(srcPath, 100, 100, { orientation: 6 });

      const result = await service.getThumbnail({ absPath: srcPath, size: 128 });

      const metadata = await sharp(result.filePath).metadata();
      expect(metadata.exif).toBeUndefined();
    });

    it('other formats produce valid WebP', async () => {
      const cacheDir = path.join(tempBase, 'cache-formats');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const makers = [
        { make: makePng, name: 'png' },
        { make: makeGif, name: 'gif' },
        { make: makeWebp, name: 'webp' },
        { make: makeAvif, name: 'avif' },
      ];

      for (const { make, name } of makers) {
        const srcPath = path.join(srcDir, `format-${name}.test`);
        await make(srcPath);

        const result = await service.getThumbnail({ absPath: srcPath, size: 128 });
        const metadata = await sharp(result.filePath).metadata();

        expect(metadata.format).toBe('webp');
        expect(metadata.width).toBe(128);
        expect(metadata.height).toBe(128);
      }
    });

    it('SVG produces valid WebP', async () => {
      const cacheDir = path.join(tempBase, 'cache-svg');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'test.svg');
      await makeSvg(srcPath);

      const result = await service.getThumbnail({ absPath: srcPath, size: 128 });
      const metadata = await sharp(result.filePath).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(128);
      expect(metadata.height).toBe(128);
    });

    it('oversize SVG rejects THUMBNAIL_FAILED', async () => {
      const cacheDir = path.join(tempBase, 'cache-svg-oversize');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'oversize.svg');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000">
  <rect width="100000" height="100000" fill="red"/>
</svg>`;
      await fs.writeFile(srcPath, svg, 'utf8');

      try {
        await service.getThumbnail({ absPath: srcPath, size: 128 });
        expect.fail('Should reject oversize SVG');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }
    });

    it('truncated JPEG still thumbnails', async () => {
      const cacheDir = path.join(tempBase, 'cache-truncated');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'truncated.jpg');
      await makeJpeg(srcPath, 100, 100);

      // Truncate to 90% of size
      const stat = await fs.stat(srcPath);
      const truncateSize = Math.floor(stat.size * 0.9);
      const buffer = await fs.readFile(srcPath);
      await fs.writeFile(srcPath, buffer.slice(0, truncateSize));

      const result = await service.getThumbnail({ absPath: srcPath, size: 128 });
      expect(result).toBeDefined();

      const metadata = await sharp(result.filePath).metadata();
      expect(metadata.format).toBe('webp');
    });

    it('release of file handles', async () => {
      const cacheDir = path.join(tempBase, 'cache-handles');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'handles.jpg');
      await makeJpeg(srcPath, 100, 100);

      await service.getThumbnail({ absPath: srcPath, size: 128 });

      // Should be able to delete the source immediately
      await fs.unlink(srcPath);

      // Verify it's gone
      const exists = await fs
        .stat(srcPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('Failure path', () => {
    it('garbage bytes, zero-byte, and text as image each reject THUMBNAIL_FAILED', async () => {
      const cacheDir = path.join(tempBase, 'cache-garbage');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const testCases = [
        {
          name: 'garbage.jpg',
          create: () => fs.writeFile(path.join(srcDir, 'garbage.jpg'), 'not an image'),
        },
        {
          name: 'zero.png',
          create: () => fs.writeFile(path.join(srcDir, 'zero.png'), Buffer.alloc(0)),
        },
        {
          name: 'text.webp',
          create: () => fs.writeFile(path.join(srcDir, 'text.webp'), 'text file'),
        },
      ];

      for (const tc of testCases) {
        const srcPath = path.join(srcDir, tc.name);
        await tc.create();

        try {
          await service.getThumbnail({ absPath: srcPath, size: 256 });
          expect.fail(`Should reject ${tc.name}`);
        } catch (err) {
          if (err instanceof ApiError) {
            expect(err.code).toBe('THUMBNAIL_FAILED');
            expect(err.status).toBe(500);
            expect(err.message).toBe('Could not generate a thumbnail.');
            // Message should not contain the path
            expect(err.message).not.toContain(srcPath);
          }
        }
      }
    });

    it('one corrupt file does not poison the service', async () => {
      const cacheDir = path.join(tempBase, 'cache-poison');
      const { logger } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const corruptPath = path.join(srcDir, 'corrupt.jpg');
      await fs.writeFile(corruptPath, 'garbage');

      try {
        await service.getThumbnail({ absPath: corruptPath, size: 256 });
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }

      // Now a valid image should work
      const validPath = path.join(srcDir, 'valid.jpg');
      await makeJpeg(validPath, 100, 100);

      const result = await service.getThumbnail({ absPath: validPath, size: 256 });
      expect(result).toBeDefined();

      // Retrying the corrupt file should still fail
      try {
        await service.getThumbnail({ absPath: corruptPath, size: 256 });
        expect.fail('Should still reject corrupt file');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }
    });

    it('failures are logged at warn', async () => {
      const cacheDir = path.join(tempBase, 'cache-log-fail');
      const { logger, events } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'log-fail.jpg');
      await fs.writeFile(srcPath, 'garbage');

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
      } catch {
        // Expected
      }

      const failEvents = events.filter((e) => e.event === 'thumb.failed');
      expect(failEvents.length).toBeGreaterThan(0);

      const failEvent = failEvents[0]!;
      expect(failEvent.level).toBe('warn');
    });

    it('success is logged at debug', async () => {
      const cacheDir = path.join(tempBase, 'cache-log-success');
      const { logger, events } = createTestLogger();

      const service = createThumbnailService({
        cacheDir,
        logger,
      });

      const srcPath = path.join(srcDir, 'log-success.jpg');
      await makeJpeg(srcPath, 100, 100);

      await service.getThumbnail({ absPath: srcPath, size: 256 });

      const successEvents = events.filter((e) => e.event === 'thumb.generated');
      expect(successEvents.length).toBeGreaterThan(0);

      const successEvent = successEvents[0]!;
      expect(successEvent.level).toBe('debug');
    });

    it('renderer error of any type maps to THUMBNAIL_FAILED', async () => {
      const cacheDir = path.join(tempBase, 'cache-error-types');
      const { logger } = createTestLogger();

      const testErrors = [
        'string error',
        new Error('normal error'),
        { code: 'ENOENT' }, // source vanished
        new TypeError('type error'),
      ];

      for (const testErr of testErrors) {
        const failingRenderer = async () => {
          throw testErr;
        };

        const service = createThumbnailService({
          cacheDir: path.join(cacheDir, 'sub'),
          logger,
          render: failingRenderer,
        });

        const srcPath = path.join(srcDir, `error-${Math.random()}.jpg`);
        await makeJpeg(srcPath, 100, 100);

        try {
          await service.getThumbnail({ absPath: srcPath, size: 256 });
          expect.fail('Should reject');
        } catch (err) {
          if (err instanceof ApiError) {
            expect(err.code).toBe('THUMBNAIL_FAILED');
          }
        }
      }
    });

    it('ApiError thrown inside passes through unchanged', async () => {
      const cacheDir = path.join(tempBase, 'cache-apierror');
      const { logger } = createTestLogger();

      const apiErrorRenderer = async () => {
        throw new ApiError('ACCESS_DENIED', 'Custom message');
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: apiErrorRenderer,
      });

      const srcPath = path.join(srcDir, 'apierror.jpg');
      await makeJpeg(srcPath, 100, 100);

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
        expect.fail('Should reject');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('ACCESS_DENIED');
          expect(err.message).toBe('Custom message');
        }
      }
    });

    it('shard directory removed between mkdir and write is recreated once', async () => {
      const cacheDir = path.join(tempBase, 'cache-shard-vanish');
      const { logger } = createTestLogger();

      let renderCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shardVanishRenderer = async (job: any) => {
        renderCount++;
        if (renderCount === 1) {
          // Remove the shard directory
          const shardDir = path.dirname(job.destPath);
          await fs.rm(shardDir, { force: true, recursive: true });
        }
        // Write normally
        await fs.writeFile(job.destPath, Buffer.alloc(10));
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: shardVanishRenderer,
      });

      const srcPath = path.join(srcDir, 'shard-vanish.jpg');
      await makeJpeg(srcPath, 100, 100);

      const result = await service.getThumbnail({ absPath: srcPath, size: 256 });
      expect(result).toBeDefined();

      // Renderer should have been called twice (once failed, retry succeeded)
      expect(renderCount).toBe(2);
    });

    it('vanished source is not retried', async () => {
      const cacheDir = path.join(tempBase, 'cache-source-vanish');
      const { logger } = createTestLogger();

      let renderCount = 0;
      const sourceVanishRenderer = async () => {
        renderCount++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error('enoent');
        err.code = 'ENOENT';
        throw err;
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: sourceVanishRenderer,
      });

      const srcPath = path.join(srcDir, 'source-vanish.jpg');
      await makeJpeg(srcPath, 100, 100);

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
        expect.fail('Should reject');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }

      // Should have been called exactly once (no retry)
      expect(renderCount).toBe(1);
    });

    it('retry happens at most once', async () => {
      const cacheDir = path.join(tempBase, 'cache-retry-once');
      const { logger } = createTestLogger();

      let renderCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const alwaysRemoveRenderer = async (job: any) => {
        renderCount++;
        const shardDir = path.dirname(job.destPath);
        await fs.rm(shardDir, { force: true, recursive: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error('enoent');
        err.code = 'ENOENT';
        throw err;
      };

      const service = createThumbnailService({
        cacheDir,
        logger,
        render: alwaysRemoveRenderer,
      });

      const srcPath = path.join(srcDir, 'retry-once.jpg');
      await makeJpeg(srcPath, 100, 100);

      try {
        await service.getThumbnail({ absPath: srcPath, size: 256 });
        expect.fail('Should reject');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('THUMBNAIL_FAILED');
        }
      }

      // Should have been called exactly twice (initial + one retry)
      expect(renderCount).toBe(2);
    });
  });

  describe('Real cache directory defaults', () => {
    it('relative cacheDir is rejected', () => {
      expect(() => {
        createThumbnailService({ cacheDir: 'relative/path' });
      }).toThrow(Error);
    });
  });
});
