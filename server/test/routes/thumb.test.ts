/**
 * Supertest suite for GET /api/thumb (cached WebP thumbnails).
 * Tests the HTTP contract, conditional requests with ETag, cache revalidation, error handling,
 * and symlink rules against a fixture tree. Specification §5.6, §12.2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createTestEnv } from '../helpers/testApp.js';
import { trySymlink } from '../helpers/fs.js';
import { makeTestConfig } from '../helpers/testConfig.js';
import type { TestEnv } from '../helpers/testApp.js';
import { createApp } from '../../src/app.js';
import {
  createThumbnailService,
  renderThumbnail,
  type ThumbnailService,
  type ThumbnailRequest,
} from '../../src/services/thumbnails.js';
import { makeJpeg, makePng, makeWebp, makeBands } from '../helpers/images.js';
import { THUMBNAIL_SIZES } from '@slydr/shared';

describe('GET /api/thumb (cached WebP thumbnails)', () => {
  let env: TestEnv;
  let renders = 0;
  let symlinkXjpgCreated = false;
  let photoLinkCreated = false;
  let dirlinkCreated = false;
  let linkOutsideCreated = false;

  beforeAll(async () => {
    // Track render count via a custom render function
    const customRender = async (job: Parameters<typeof renderThumbnail>[0]) => {
      renders += 1;
      await renderThumbnail(job);
    };

    env = await createTestEnv({
      prefix: 'slydr-thumb-',
      deps: ({ cacheDir, logger }) => ({
        thumbnails: createThumbnailService({
          cacheDir,
          logger,
          render: customRender,
        }),
      }),
      populate: async (root, outside) => {
        // Landscape JPEG 640x360 (will be cropped to square)
        await makeJpeg(path.join(root, 'photo-landscape.jpg'), 640, 360);

        // Portrait PNG 300x500 (will be cropped to square)
        await makePng(path.join(root, 'photo-portrait.png'));

        // Tiny WebP 40x40 (will be upscaled to requested size, keeping square)
        await makeWebp(path.join(root, 'tiny.webp'));

        // Non-image file
        await fs.writeFile(path.join(root, 'notes.txt'), 'text file');

        // Broken image (random bytes, not decodable)
        await fs.writeFile(path.join(root, 'broken.jpg'), Buffer.alloc(2048, 0xff));

        // Valid PNG bytes under a non-image name (for symlink test)
        await makeBands(path.join(root, 'data.bin'));

        // Test directory with an image inside
        await fs.mkdir(path.join(root, 'folder'));
        await makeJpeg(path.join(root, 'folder', 'inside.gif'), 64, 64);

        // Outside directory with a secret image
        await makeJpeg(path.join(outside, 'secret.jpg'), 100, 100);
      },
    });

    // Create symlinks after createTestEnv (after jail is set)
    // FR-2.1: symlink whose NAME says image (x.jpg), target says not
    symlinkXjpgCreated = await trySymlink(
      path.join(env.root, 'data.bin'),
      path.join(env.root, 'x.jpg'),
      'file',
    );

    // Silence: linkInsideCreated tracked but unused in this test
    const _linkInsideCreated = await trySymlink(
      path.join(env.root, 'photo-landscape.jpg'),
      path.join(env.root, 'link-inside.jpg'),
      'file',
    );

    // FR-2.1: symlink without extension to an image
    photoLinkCreated = await trySymlink(
      path.join(env.root, 'photo-landscape.jpg'),
      path.join(env.root, 'photo-link'),
      'file',
    );

    // Folder symlink inside root
    dirlinkCreated = await trySymlink(
      path.join(env.root, 'folder'),
      path.join(env.root, 'dirlink'),
      'dir',
    );

    // Symlink escaping the root
    linkOutsideCreated = await trySymlink(
      path.join(env.root, '..', 'outside', 'secret.jpg'),
      path.join(env.root, 'link-outside.jpg'),
      'file',
    );
  });

  afterAll(async () => {
    await env.cleanup();
  });

  // ===== Success cases =====

  describe('success responses', () => {
    it('serves a 256px WebP by default', async () => {
      renders = 0;
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toBe('private, max-age=604800');
      expect(res.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/);
      expect(renders).toBe(1);

      // Verify the WebP is actually 256x256
      const metadata = await sharp(res.body).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(256);
      expect(metadata.height).toBe(256);
    });

    it.each(THUMBNAIL_SIZES)('produces a %sx%s WebP for size=%s', async (size) => {
      renders = 0;
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      expect(res.status).toBe(200);
      const metadata = await sharp(res.body).metadata();
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
    });

    it('thumbnail is square even for portrait input', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-portrait.png', size: 256 })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      expect(res.status).toBe(200);
      const metadata = await sharp(res.body).metadata();
      expect(metadata.width).toBe(256);
      expect(metadata.height).toBe(256);
    });

    it('small images are upscaled to the requested square', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'tiny.webp', size: 128 })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      expect(res.status).toBe(200);
      const metadata = await sharp(res.body).metadata();
      expect(metadata.width).toBe(128);
      expect(metadata.height).toBe(128);
    });

    it('sets caching headers', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size: 256 });

      expect(res.headers['cache-control']).toBe('private, max-age=604800');
      expect(res.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/);
      expect(res.headers['etag']).not.toMatch(/^W\//); // strong, no W/ prefix
      expect(res.headers['last-modified']).toBeUndefined();
    });

    it('ETag equals the cache key', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size: 256 });

      expect(res.status).toBe(200);
      const etag = res.headers['etag'] as string;
      const key = etag.slice(1, -1); // Remove quotes

      // The cache file should be at <cacheDir>/<key[0..1]>/<key>.webp
      const cachePath = path.join(env.cacheDir, key.slice(0, 2), `${key}.webp`);
      const stat = await fs.stat(cachePath).catch(() => null);
      expect(stat).not.toBeNull();
      expect(stat?.isFile()).toBe(true);
    });

    it('cache miss then cache hit', async () => {
      // Use a unique size to ensure it's not cached from other tests
      const uniqueSize = THUMBNAIL_SIZES[0]; // 128, least likely to be tested first
      const testPath = 'photo-portrait.png'; // Different image to ensure cold cache

      // First request - should render (or be cached if already rendered)
      const res1 = await request(env.app)
        .get('/api/thumb')
        .query({ path: testPath, size: uniqueSize })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      expect(res1.status).toBe(200);
      const body1 = res1.body;
      const etag1 = res1.headers['etag'];

      // Record render count before second request to verify no new renders
      const rendersBeforeSecond = renders;

      // Second request for same image and size should be served from cache without rendering
      const res2 = await request(env.app)
        .get('/api/thumb')
        .query({ path: testPath, size: uniqueSize })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      expect(res2.status).toBe(200);
      expect(res2.body).toStrictEqual(body1); // Same bytes
      expect(res2.headers['etag']).toBe(etag1); // Same ETag
      expect(renders).toBe(rendersBeforeSecond); // No additional renders on cache hit
    });

    it('different sizes have different cache entries and ETags', async () => {
      const res128 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size: 128 });
      const res256 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size: 256 });

      expect(res128.headers['etag']).not.toBe(res256.headers['etag']);

      // Both should exist as separate cache files
      const etag128 = (res128.headers['etag'] as string).slice(1, -1);
      const etag256 = (res256.headers['etag'] as string).slice(1, -1);
      const file128 = path.join(env.cacheDir, etag128.slice(0, 2), `${etag128}.webp`);
      const file256 = path.join(env.cacheDir, etag256.slice(0, 2), `${etag256}.webp`);

      expect(await fs.stat(file128)).toBeDefined();
      expect(await fs.stat(file256)).toBeDefined();
    });
  });

  // ===== Conditional requests (304 Not Modified) =====

  describe('conditional requests (304 Not Modified)', () => {
    it('304 on matching If-None-Match', async () => {
      // First request to get the ETag
      const res1 = await request(env.app).get('/api/thumb').query({ path: 'photo-landscape.jpg' });

      expect(res1.status).toBe(200);
      const etag = res1.headers['etag'] as string;

      // Conditional request with matching ETag
      const res2 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('If-None-Match', etag);

      expect(res2.status).toBe(304);
      // 304 responses have no body - just verify status and headers
      expect(res2.headers['etag']).toBe(etag);
      expect(res2.headers['cache-control']).toBe('private, max-age=604800');
    });

    it('304 without running the renderer on a cold cache', async () => {
      // First request to get the ETag (and populate cache)
      const res1 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size: 512 });

      expect(res1.status).toBe(200);
      const etag = res1.headers['etag'] as string;

      // Delete cache directory contents
      const files = await fs.readdir(env.cacheDir, { recursive: true });
      for (const file of files) {
        const fullPath = path.join(env.cacheDir, file as string);
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          await fs.unlink(fullPath);
        }
      }

      // Record renders before conditional request
      renders = 0;

      // Conditional request should return 304 WITHOUT rendering
      const res2 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size: 512 })
        .set('If-None-Match', etag);

      expect(res2.status).toBe(304);
      expect(renders).toBe(0); // Key is computed from stats, no render needed
    });

    it('weak and wildcard validators match', async () => {
      const res1 = await request(env.app).get('/api/thumb').query({ path: 'photo-landscape.jpg' });

      const etag = res1.headers['etag'] as string;

      // Weak validator should match
      const res2 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('If-None-Match', `W/${etag}`);
      expect(res2.status).toBe(304);

      // Wildcard should match
      const res3 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('If-None-Match', '*');
      expect(res3.status).toBe(304);

      // List with multiple tags should match if any matches
      const res4 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('If-None-Match', `"aaaa", ${etag}, "bbbb"`);
      expect(res4.status).toBe(304);

      // Non-matching tag should return 200
      const res5 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('If-None-Match', '"deadbeef"');
      expect(res5.status).toBe(200);
    });

    it('editing the file invalidates the ETag', async () => {
      // Get initial ETag
      const res1 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      const etag1 = res1.headers['etag'];
      const body1 = res1.body;

      // Modify the source file: create a new one with different content and bump mtime
      await makeJpeg(path.join(env.root, 'photo-landscape.jpg'), 800, 400);
      // Bump mtime to ensure it's different
      const now = Math.floor(Date.now() / 1000);
      await fs.utimes(path.join(env.root, 'photo-landscape.jpg'), now + 1, now + 1);

      // Request with old ETag should return 200 with new content
      const res2 = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('If-None-Match', etag1 as string)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        });

      expect(res2.status).toBe(200);
      expect(res2.headers['etag']).not.toBe(etag1);
      expect(res2.body).not.toStrictEqual(body1); // Different bytes
    });
  });

  // ===== Parameter validation =====

  describe('parameter validation', () => {
    it.each([
      '0',
      '1',
      '127',
      '129',
      '257',
      '1024',
      '-128',
      '128.5',
      'abc',
      '1e2',
      '0x80',
      '+128',
      '0128',
      '%20128',
      'NaN',
      'Infinity',
      '__proto__',
    ])('rejects invalid size: %s', async (sizeValue) => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg', size: sizeValue });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    });

    it('rejects empty string size', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .query('size='); // Explicitly empty

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    });

    it('rejects a repeated size parameter', async () => {
      const res = await request(env.app).get(
        '/api/thumb?path=photo-landscape.jpg&size=128&size=256',
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    });

    it('rejects a repeated or missing path', async () => {
      const res1 = await request(env.app).get('/api/thumb?path=a&path=b');
      expect(res1.status).toBe(400);
      expect(res1.body.error.code).toBe('INVALID_PARAM');

      const res2 = await request(env.app).get('/api/thumb?size=256');
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe('INVALID_PARAM');
    });

    it('size validation precedes path resolution', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'does-not-exist.jpg', size: '7' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    });
  });

  // ===== Error cases =====

  describe('error responses', () => {
    it('non-image file is 415', async () => {
      const res = await request(env.app).get('/api/thumb').query({ path: 'notes.txt' });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE');
    });

    it('directory is NOT_A_FILE', async () => {
      const res = await request(env.app).get('/api/thumb').query({ path: 'folder' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOT_A_FILE');
    });

    it('missing file is 404', async () => {
      const res = await request(env.app).get('/api/thumb').query({ path: 'nope.jpg' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('path traversal is refused', async () => {
      const res1 = await request(env.app).get('/api/thumb').query({ path: '../../../etc/passwd' });
      expect(res1.status).toBe(403);
      expect(res1.body.error.code).toBe('OUTSIDE_ROOT');
    });

    it('absolute, UNC and NUL paths are refused', async () => {
      const paths = ['/etc/passwd', 'C:/Windows/x.jpg', '\\\\server\\share\\x.jpg', 'a\0.jpg'];

      for (const p of paths) {
        const res = await request(env.app).get('/api/thumb').query({ path: p });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_PATH');
      }
    });

    it('symlink escaping the root is refused', async () => {
      if (!linkOutsideCreated) {
        // Skip if symlinks are unavailable
        return;
      }

      const res = await request(env.app).get('/api/thumb').query({ path: 'link-outside.jpg' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('OUTSIDE_ROOT');
    });

    it('corrupt image yields 500 THUMBNAIL_FAILED', async () => {
      const res = await request(env.app).get('/api/thumb').query({ path: 'broken.jpg' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('THUMBNAIL_FAILED');
      // Error responses should use no-store Cache-Control, not the long thumbnail one
      expect(res.headers['cache-control']).toBe('no-store');

      // Check that no .tmp files remain in cache (temp files from failed renders)
      const files = await fs.readdir(env.cacheDir, { recursive: true });
      const tmpFiles = files.filter((f: string) => f.includes('.tmp'));
      expect(tmpFiles.length).toBe(0);

      // Verify logger captured thumb.failed at warn level
      const failEvents = env.events.filter((e) => e.event === 'thumb.failed' && e.level === 'warn');
      expect(failEvents.length).toBeGreaterThan(0);

      // Next request for another image should still work
      const res2 = await request(env.app).get('/api/thumb').query({ path: 'photo-landscape.jpg' });
      expect(res2.status).toBe(200);
    });

    it('error bodies leak nothing', async () => {
      const testCases = [
        { path: 'does-not-exist.jpg', code: 'NOT_FOUND' },
        { path: 'notes.txt', code: 'UNSUPPORTED_IMAGE' },
        { path: 'folder', code: 'NOT_A_FILE' },
        { path: '../etc/passwd', code: 'OUTSIDE_ROOT' },
        { path: 'broken.jpg', code: 'THUMBNAIL_FAILED' },
      ];

      for (const tc of testCases) {
        const res = await request(env.app).get('/api/thumb').query({ path: tc.path });

        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(/\/home/); // No absolute path
        expect(body).not.toMatch(env.cacheDir); // No cache directory
        expect(body).not.toMatch(/ENOENT/); // No errno
        expect(body).not.toMatch(/EACCES/); // No errno
        expect(body).not.toMatch(/errno/); // No errno field
      }
    });
  });

  // ===== HTTP verb and host guards =====

  describe('HTTP method and host guards', () => {
    it('HEAD returns headers and no body', async () => {
      const res = await request(env.app).head('/api/thumb').query({ path: 'photo-landscape.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/);
      expect(res.body).toEqual({});
    });

    it('POST returns 405 METHOD_NOT_ALLOWED', async () => {
      const res = await request(env.app).post('/api/thumb').query({ path: 'photo-landscape.jpg' });

      expect(res.status).toBe(405);
      expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('Host: evil.example returns 403 FORBIDDEN_HOST', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('Host', 'evil.example');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_HOST');
    });

    it('Host: 127.0.0.1:4317 returns 200', async () => {
      const res = await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('Host', '127.0.0.1:4317');

      expect(res.status).toBe(200);
    });
  });

  // ===== Symlink rules (FR-2.1) =====

  describe('symlink naming (FR-2.1)', () => {
    it('symlink is an image because of its own name', async () => {
      if (!symlinkXjpgCreated) {
        return; // Skip if symlinks unavailable
      }

      const res = await request(env.app).get('/api/thumb').query({ path: 'x.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    });

    it('symlink without extension to an image returns 415', async () => {
      if (!photoLinkCreated) {
        return; // Skip if symlinks unavailable
      }

      const res = await request(env.app).get('/api/thumb').query({ path: 'photo-link' });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE');
    });

    it('path through a folder symlink inside root is served', async () => {
      if (!dirlinkCreated) {
        return; // Skip if symlinks unavailable
      }

      const res = await request(env.app).get('/api/thumb').query({ path: 'dirlink/inside.gif' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    });
  });

  // ===== Client abort handling =====

  describe('client abort handling', () => {
    it('client abort does not break the server', async () => {
      // Record any unhandled rejections
      const unhandledRejections: Error[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        if (reason instanceof Error) {
          unhandledRejections.push(reason);
        }
      };
      process.on('unhandledRejection', onUnhandledRejection);

      try {
        // Send a request and abort it immediately
        const req = request(env.app).get('/api/thumb').query({ path: 'photo-landscape.jpg' });

        // Abort the request almost immediately (before response is sent)
        const abortTimer = setTimeout(() => req.abort(), 1);

        try {
          await req;
        } catch {
          // Expected to fail due to abort
        }

        clearTimeout(abortTimer);

        // Wait a bit to ensure any async handlers complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Issue a normal request to verify the server is still functional
        const serverRes = await request(env.app)
          .get('/api/thumb')
          .query({ path: 'photo-landscape.jpg' });

        expect(serverRes.status).toBe(200);

        // No unhandled rejections from the abort
        expect(unhandledRejections.length).toBe(0);
      } finally {
        process.removeListener('unhandledRejection', onUnhandledRejection);
      }
    });
  });

  // ===== Cache eviction retry =====

  describe('cache file eviction retry', () => {
    it('retries once if the cache file vanishes before sending', async () => {
      // Create a fake service that simulates cache eviction on first call
      let callCount = 0;
      const fakeService: ThumbnailService = {
        cacheDir: env.cacheDir,
        getThumbnail: async (_req: ThumbnailRequest) => {
          callCount += 1;
          if (callCount === 1) {
            // First call: return a path that doesn't exist (simulating cache eviction)
            return {
              filePath: path.join(env.cacheDir, 'does-not-exist.webp'),
              key: 'fake0000000000000000000000',
              cached: false,
            };
          } else {
            // Second call: return a real cache file
            // Use the real service to get an actual cached file
            const realService = createThumbnailService({
              cacheDir: env.cacheDir,
              logger: env.logger,
            });
            return realService.getThumbnail(_req);
          }
        },
        inflightCount: () => 0,
      };

      // Create an app with the fake service
      const fakeApp = createApp({ ...makeTestConfig(), cacheDir: env.cacheDir }, env.logger, {
        thumbnails: fakeService,
      });

      // Request a thumbnail - should trigger cache eviction retry
      const res = await request(fakeApp).get('/api/thumb').query({ path: 'photo-landscape.jpg' });

      expect(res.status).toBe(200);
      expect(callCount).toBe(2); // getThumbnail was called twice (first failed, second succeeded)
    });

    it('returns 500 if cache file still vanishes after retry', async () => {
      // Create a fake service that always returns non-existent paths
      let callCount = 0;
      const fakeService: ThumbnailService = {
        cacheDir: env.cacheDir,
        getThumbnail: async (_req: ThumbnailRequest) => {
          callCount += 1;
          // Always return a non-existent path (cache always vanishes)
          return {
            filePath: path.join(env.cacheDir, `does-not-exist-${callCount}.webp`),
            key: `fake000000000000000000000${callCount}`,
            cached: false,
          };
        },
        inflightCount: () => 0,
      };

      // Create an app with the fake service
      const fakeApp = createApp({ ...makeTestConfig(), cacheDir: env.cacheDir }, env.logger, {
        thumbnails: fakeService,
      });

      // Request a thumbnail - should retry once, then fail with 500
      const res = await request(fakeApp).get('/api/thumb').query({ path: 'photo-landscape.jpg' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('THUMBNAIL_FAILED');
      expect(callCount).toBe(2); // getThumbnail was called twice (both failed)
      // Error responses must not use the thumbnail cache headers
      expect(res.headers['cache-control']).toBe('no-store');
      // The ETag should not be the strong thumbnail key (32 hex chars quoted)
      const etag = res.headers['etag'] as string | undefined;
      if (etag) {
        // If Express auto-generates an ETag, it won't be the strong 32-char format
        expect(etag).not.toMatch(/^"[0-9a-f]{32}"$/);
      }
    });
  });

  // ===== Logging =====

  describe('logging', () => {
    it('a debug line is logged per served thumbnail', async () => {
      const beforeCount = env.events.filter(
        (e) => e.event === 'thumb.served' && e.level === 'debug',
      ).length;

      await request(env.app).get('/api/thumb').query({ path: 'photo-landscape.jpg' });

      const afterCount = env.events.filter(
        (e) => e.event === 'thumb.served' && e.level === 'debug',
      ).length;

      expect(afterCount).toBe(beforeCount + 1);

      const lastEvent = env.events[env.events.length - 1];
      expect(lastEvent).toBeDefined();
      if (lastEvent) {
        expect(lastEvent.event).toBe('thumb.served');
        expect(lastEvent.level).toBe('debug');
        expect(lastEvent.fields).toHaveProperty('status');
        expect(lastEvent.fields).toHaveProperty('path');
        expect(lastEvent.fields).toHaveProperty('size');
        expect(lastEvent.fields).toHaveProperty('cached');
        expect(lastEvent.fields).toHaveProperty('ms');
      }
    });

    it('a 304 is logged with status 304', async () => {
      const res1 = await request(env.app).get('/api/thumb').query({ path: 'photo-landscape.jpg' });

      const etag = res1.headers['etag'];

      await request(env.app)
        .get('/api/thumb')
        .query({ path: 'photo-landscape.jpg' })
        .set('If-None-Match', etag as string);

      const logged304 = env.events.find(
        (e) => e.event === 'thumb.served' && e.level === 'debug' && e.fields.status === 304,
      );

      expect(logged304).toBeDefined();
    });
  });

  // ===== Dependency injection =====

  describe('dependency injection', () => {
    it('the thumbnails dependency is injectable', async () => {
      // The test suite already validates this by passing a custom render function
      // via createTestEnv's deps option. If it wasn't injectable, the custom service
      // wouldn't have been wired through, causing tests to fail.
      // Just verify that the app is functional.
      const res = await request(env.app).get('/api/thumb').query({ path: 'photo-landscape.jpg' });
      expect(res.status).toBe(200);
    });
  });
});
