/**
 * Supertest suite for GET /api/image (original image streaming).
 * Tests the HTTP contract, Range/conditional requests, error handling, and symlink rules
 * against a fixture tree. Specification §5.5, §12.2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestEnv } from '../helpers/testApp.js';
import { trySymlink } from '../helpers/fs.js';
import type { TestEnv } from '../helpers/testApp.js';

describe('GET /api/image (original image streaming)', () => {
  let env: TestEnv;
  let linkInsideCreated = false;
  let linkOutsideCreated = false;
  let symlinkXjpgCreated = false;
  let photoLinkCreated = false;
  let svgAsJpgCreated = false;
  let dirlinkCreated = false;
  let dirlinkOutsideCreated = false;

  beforeAll(async () => {
    env = await createTestEnv({
      prefix: 'slydr-image-',
      populate: async (root, outside) => {
        // Main images
        // JPEG magic bytes (SOI/EOI markers)
        await fs.writeFile(path.join(root, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

        // Large file for Range tests
        await fs.writeFile(path.join(root, 'big.jpg'), Buffer.alloc(2048, 0x61));

        // PNG 1x1 (base64 decoded)
        const pngBuf = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        );
        await fs.writeFile(path.join(root, 'pic.png'), pngBuf);

        // Various supported extensions with minimal valid bytes
        await fs.writeFile(path.join(root, 'a.jpeg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        await fs.writeFile(path.join(root, 'a.jfif'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        await fs.writeFile(path.join(root, 'a.gif'), Buffer.from([0x47, 0x49, 0x46])); // GIF header
        await fs.writeFile(path.join(root, 'a.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46])); // RIFF header
        await fs.writeFile(path.join(root, 'a.avif'), Buffer.from([0x00, 0x00, 0x00])); // AVIF header
        await fs.writeFile(path.join(root, 'a.bmp'), Buffer.from([0x42, 0x4d])); // BM header
        await fs.writeFile(path.join(root, 'a.svg'), Buffer.from('<svg/>'));

        // Upper-case extension
        await fs.writeFile(path.join(root, 'UPPER.JPG'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

        // Unsupported files
        await fs.writeFile(path.join(root, 'notes.txt'), 'text file');
        await fs.writeFile(path.join(root, 'photo.heic'), Buffer.alloc(10));
        await fs.writeFile(path.join(root, 'README'), 'readme');

        // Directory named like an image
        await fs.mkdir(path.join(root, 'folder.jpg'));
        await fs.writeFile(
          path.join(root, 'folder.jpg', 'inner.jpg'),
          Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        );

        // Special characters in filename
        await fs.writeFile(
          path.join(root, 'café photo #1 100%.jpg'),
          Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        );

        // Dotfile image
        await fs.writeFile(path.join(root, '.hidden.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

        // Non-image file with image bytes (for symlink test)
        await fs.writeFile(path.join(root, 'data.bin'), pngBuf);

        // Create outside file
        await fs.writeFile(path.join(outside, 'secret.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      },
    });

    // Create symlinks after createTestEnv (after jail is set)
    linkInsideCreated = await trySymlink(
      path.join(env.root, 'photo.jpg'),
      path.join(env.root, 'link-inside.jpg'),
      'file',
    );

    // FR-2.1: symlink whose NAME says image, target says not
    symlinkXjpgCreated = await trySymlink(
      path.join(env.root, 'data.bin'),
      path.join(env.root, 'x.jpg'),
      'file',
    );

    // FR-2.1: symlink without extension to an image
    photoLinkCreated = await trySymlink(
      path.join(env.root, 'photo.jpg'),
      path.join(env.root, 'photo-link'),
      'file',
    );

    // SVG hiding behind a .jpg name
    svgAsJpgCreated = await trySymlink(
      path.join(env.root, 'a.svg'),
      path.join(env.root, 'svg-as-jpg.jpg'),
      'file',
    );

    // Folder symlink inside root
    dirlinkCreated = await trySymlink(
      path.join(env.root, 'folder.jpg'),
      path.join(env.root, 'dirlink'),
      'dir',
    );

    // On Windows, also create a junction to outside
    if (process.platform === 'win32') {
      dirlinkOutsideCreated = await trySymlink(
        env.outside,
        path.join(env.root, 'dirlink-outside'),
        'junction',
      );
    }

    // Symlink escaping the root
    linkOutsideCreated = await trySymlink(
      path.join(env.outside, 'secret.jpg'),
      path.join(env.root, 'link-outside.jpg'),
      'file',
    );
  });

  afterAll(async () => {
    await env.cleanup();
  });

  // ===== Success cases =====

  describe('success responses', () => {
    it('serves a jpg with the correct Content-Type and bytes', async () => {
      const res = await request(env.app)
        .get('/api/image')
        .query({ path: 'photo.jpg' })
        .expect('content-type', /^image\/jpeg/);

      expect(res.status).toBe(200);
      const bytes = res.body as Buffer;
      expect(bytes).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      expect(res.headers['content-length']).toBe('4');
    });

    it('Content-Type for every supported extension', async () => {
      const cases = [
        ['a.jpeg', 'image/jpeg'],
        ['a.jfif', 'image/jpeg'],
        ['a.gif', 'image/gif'],
        ['pic.png', 'image/png'],
        ['a.webp', 'image/webp'],
        ['a.avif', 'image/avif'],
        ['a.bmp', 'image/bmp'],
        ['a.svg', 'image/svg+xml'],
      ];

      for (const [name, mimeType] of cases) {
        const res = await request(env.app).get('/api/image').query({ path: name });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe(mimeType);
      }

      // Also test .jpg
      const res = await request(env.app).get('/api/image').query({ path: 'photo.jpg' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('upper-case extension is accepted', async () => {
      const res = await request(env.app).get('/api/image').query({ path: 'UPPER.JPG' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('advertises range support and validators', async () => {
      const res = await request(env.app).get('/api/image').query({ path: 'photo.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['etag']).toBeTruthy();
      expect(res.headers['last-modified']).toBeTruthy();
      // Verify Last-Modified is parseable
      expect(Date.parse(res.headers['last-modified'] as string)).toBeGreaterThan(0);
    });

    it('Range request returns 206', async () => {
      const res = await request(env.app)
        .get('/api/image')
        .query({ path: 'big.jpg' })
        .set('Range', 'bytes=0-99');

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 0-99/2048');
      expect(res.headers['content-length']).toBe('100');
      expect((res.body as Buffer).length).toBe(100);
    });

    it('open-ended and suffix ranges', async () => {
      // bytes=2000- should give 48 bytes from 2000 to 2047
      let res = await request(env.app)
        .get('/api/image')
        .query({ path: 'big.jpg' })
        .set('Range', 'bytes=2000-');
      expect(res.status).toBe(206);
      expect(res.headers['content-length']).toBe('48');

      // bytes=-10 should give last 10 bytes
      res = await request(env.app)
        .get('/api/image')
        .query({ path: 'big.jpg' })
        .set('Range', 'bytes=-10');
      expect(res.status).toBe(206);
      expect(res.headers['content-length']).toBe('10');
    });

    it('unsatisfiable Range returns 416', async () => {
      const res = await request(env.app)
        .get('/api/image')
        .query({ path: 'big.jpg' })
        .set('Range', 'bytes=5000-6000');

      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */2048');
      expect(res.body).toEqual({}); // empty body
      // Error responses should not carry file cache headers
      const cacheControl = res.headers['cache-control'];
      if (cacheControl) {
        expect(cacheControl).not.toMatch(/max-age=3600/);
      }
    });

    it('conditional GET returns 304 for a matching If-None-Match', async () => {
      // Fetch once to get the ETag
      const res1 = await request(env.app).get('/api/image').query({ path: 'photo.jpg' });
      expect(res1.status).toBe(200);
      const etag = res1.headers['etag'];

      // Fetch again with If-None-Match
      const res2 = await request(env.app)
        .get('/api/image')
        .query({ path: 'photo.jpg' })
        .set('If-None-Match', etag as string);

      expect(res2.status).toBe(304);
      expect(res2.headers['etag']).toBe(etag);
      expect(res2.text).toBe('');
    });

    it('conditional GET returns 304 for If-Modified-Since', async () => {
      // Fetch once to get the Last-Modified
      const res1 = await request(env.app).get('/api/image').query({ path: 'photo.jpg' });
      expect(res1.status).toBe(200);
      const lastModified = res1.headers['last-modified'];

      // Fetch again with If-Modified-Since
      const res2 = await request(env.app)
        .get('/api/image')
        .query({ path: 'photo.jpg' })
        .set('If-Modified-Since', lastModified as string);

      expect(res2.status).toBe(304);
    });

    it('a non-matching If-None-Match returns 200', async () => {
      const res = await request(env.app)
        .get('/api/image')
        .query({ path: 'photo.jpg' })
        .set('If-None-Match', '"fake-etag"');

      expect(res.status).toBe(200);
    });

    it('Cache-Control contains private', async () => {
      const cases = [
        ['photo.jpg', 200],
        ['big.jpg?Range=bytes=0-99', 206], // via setting Range header below
        ['photo.jpg?If-None-Match=fake', 200], // 304 also checked separately
      ];

      for (const [_path_part] of cases) {
        const res = await request(env.app)
          .get('/api/image')
          .query({ path: 'photo.jpg' })
          .set('Range', 'bytes=0-99');

        // Note: 206 response also carries Cache-Control
        const cacheControl = res.headers['cache-control'] as string;
        if (cacheControl) {
          expect(cacheControl).toMatch(/private/);
          expect(cacheControl).toMatch(/max-age=3600/);
          expect(cacheControl).not.toMatch(/public/);
        }
      }

      // Also test 304
      const res1 = await request(env.app).get('/api/image').query({ path: 'photo.jpg' });
      const etag = res1.headers['etag'];
      const res2 = await request(env.app)
        .get('/api/image')
        .query({ path: 'photo.jpg' })
        .set('If-None-Match', etag as string);

      expect(res2.status).toBe(304);
      expect(res2.headers['cache-control']).toMatch(/private/);
      expect(res2.headers['cache-control']).toMatch(/max-age=3600/);
    });

    it('nosniff is set', async () => {
      const res = await request(env.app).get('/api/image').query({ path: 'photo.jpg' });

      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('svg responses carry a restrictive CSP', async () => {
      const res = await request(env.app).get('/api/image').query({ path: 'a.svg' });

      expect(res.status).toBe(200);
      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toMatch(/default-src 'none'/);
      expect(csp).toMatch(/sandbox/);

      // PNG should not have CSP
      const res2 = await request(env.app).get('/api/image').query({ path: 'pic.png' });
      expect(res2.status).toBe(200);
      expect(res2.headers['content-security-policy']).toBeUndefined();
    });

    it('a symlink hiding an SVG behind a .jpg name still gets the CSP', async () => {
      if (!svgAsJpgCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      const res = await request(env.app).get('/api/image').query({ path: 'svg-as-jpg.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toMatch(/default-src 'none'/);
      expect(csp).toMatch(/sandbox/);
    });

    it('HEAD returns headers without a body', async () => {
      const res = await request(env.app).head('/api/image').query({ path: 'photo.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(res.headers['content-length']).toBe('4');
      expect(res.headers['cache-control']).toMatch(/private/);
      // HEAD response body is typically an empty Buffer or empty object when not parsed
      // Don't assert on body content type; supertest handles this
    });

    it('unicode, space, hash and percent in the file name', async () => {
      // Test with the actual wire path (not encoded, since query params handle encoding)
      const name = 'café photo #1 100%.jpg';
      const res = await request(env.app).get('/api/image').query({ path: name });

      expect(res.status).toBe(200);
      const bytes = res.body as Buffer;
      expect(bytes).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    });

    it('a dotfile image is served', async () => {
      const res = await request(env.app).get('/api/image').query({ path: '.hidden.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('a symlink inside the root is served', async () => {
      if (!linkInsideCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      const res = await request(env.app).get('/api/image').query({ path: 'link-inside.jpg' });

      expect(res.status).toBe(200);
      const bytes = res.body as Buffer;
      expect(bytes).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    });

    it('a nested path is served', async () => {
      const res = await request(env.app).get('/api/image').query({ path: 'folder.jpg/inner.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('a symlink is an image because of its own name (FR-2.1)', async () => {
      if (!symlinkXjpgCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      // x.jpg -> data.bin (PNG bytes)
      const res = await request(env.app).get('/api/image').query({ path: 'x.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      const bytes = res.body as Buffer;
      // Should contain PNG bytes from data.bin
      expect(bytes[0]).toBe(0x89);
    });

    it('a folder symlink inside the root is followed', async () => {
      if (!dirlinkCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      const res = await request(env.app).get('/api/image').query({ path: 'dirlink/inner.jpg' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('a debug line is logged per served image', async () => {
      // Clear events
      env.events.length = 0;

      await request(env.app).get('/api/image').query({ path: 'photo.jpg' });

      const events = env.events.filter((e) => e.level === 'debug' && e.event === 'image.served');
      expect(events.length).toBeGreaterThan(0);
      const evt = events[0];
      if (evt) {
        expect(evt.fields?.path).toBe('photo.jpg');
        expect(evt.fields?.status).toBe(200);
        expect(typeof evt.fields?.ms).toBe('number');
      }

      // No warn/error
      const errors = env.events.filter((e) => e.level === 'error' || e.level === 'warn');
      expect(errors.length).toBe(0);
    });
  });

  // ===== Error cases =====

  describe('error responses', () => {
    it('415 for unsupported names', async () => {
      const names = ['notes.txt', 'photo.heic', 'README'];

      for (const name of names) {
        const res = await request(env.app).get('/api/image').query({ path: name });

        expect(res.status).toBe(415);
        expect(res.body.error?.code).toBe('UNSUPPORTED_IMAGE');
      }
    });

    it('a symlink without an image extension is 415', async () => {
      if (!photoLinkCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      const res = await request(env.app).get('/api/image').query({ path: 'photo-link' });

      expect(res.status).toBe(415);
      expect(res.body.error?.code).toBe('UNSUPPORTED_IMAGE');
    });

    it('400 NOT_A_FILE for a directory', async () => {
      const cases = ['folder.jpg', ''];

      for (const path_part of cases) {
        const res = await request(env.app).get('/api/image').query({ path: path_part });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('NOT_A_FILE');
      }
    });

    it('404 NOT_FOUND', async () => {
      const cases = ['missing.jpg', 'photo.jpg/child'];

      for (const path_part of cases) {
        const res = await request(env.app).get('/api/image').query({ path: path_part });

        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe('NOT_FOUND');
      }
    });

    it('403 OUTSIDE_ROOT for traversal', async () => {
      const cases = [
        '../outside/secret.jpg',
        '../../../etc/passwd',
        'sub/../../outside/secret.jpg',
      ];

      for (const path_part of cases) {
        const res = await request(env.app).get('/api/image').query({ path: path_part });

        expect(res.status).toBe(403);
        expect(res.body.error?.code).toBe('OUTSIDE_ROOT');
      }
    });

    it('403 OUTSIDE_ROOT for a symlink escape', async () => {
      if (!linkOutsideCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      const res = await request(env.app).get('/api/image').query({ path: 'link-outside.jpg' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('OUTSIDE_ROOT');
    });

    it('403 OUTSIDE_ROOT for junction to outside on Windows', async () => {
      if (process.platform !== 'win32') {
        // Skip on non-Windows
        return;
      }

      if (!dirlinkOutsideCreated) {
        console.log('skip: junction could not be created');
        return;
      }

      const res = await request(env.app)
        .get('/api/image')
        .query({ path: 'dirlink-outside/secret.jpg' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('OUTSIDE_ROOT');
    });

    it('400 INVALID_PATH', async () => {
      const cases = [
        '/etc/passwd', // absolute POSIX path
        'a\x00.jpg', // NUL byte (raw, not percent-encoded)
      ];

      for (const path_part of cases) {
        const res = await request(env.app).get('/api/image').query({ path: path_part });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('INVALID_PATH');
      }

      // Test Windows drive path format (C: pattern)
      // Note: C:x would be interpreted as a drive path
      if (process.platform === 'win32') {
        const res = await request(env.app).get('/api/image').query({ path: 'C:photo.jpg' });
        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('INVALID_PATH');
      }

      // Test UNC path (\\server\share\x.jpg)
      const res = await request(env.app)
        .get('/api/image')
        .query({ path: '\\\\server\\share\\x.jpg' });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('INVALID_PATH');
    });

    it('a backslash in the path', async () => {
      if (process.platform === 'win32') {
        // On Windows, backslash anywhere in a wire path is INVALID_PATH
        const res = await request(env.app).get('/api/image').query({ path: 'photo\\x.jpg' });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('INVALID_PATH');
      } else {
        // On POSIX, backslash is a legal filename character (just not found)
        const res = await request(env.app).get('/api/image').query({ path: 'photo\\x.jpg' });

        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe('NOT_FOUND');
      }
    });

    it('400 INVALID_PARAM', async () => {
      // No path parameter
      let res = await request(env.app).get('/api/image');

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('INVALID_PARAM');

      // Repeated path (array)
      res = await request(env.app).get('/api/image?path=a.jpg&path=b.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('INVALID_PARAM');
    });

    it('repeated path is INVALID_PARAM, never "first wins"', async () => {
      const res = await request(env.app).get('/api/image?path=photo.jpg&path=big.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('INVALID_PARAM');
    });

    it('error responses are not cacheable and leak nothing', async () => {
      const cases = [
        ['missing.jpg', 404, 'NOT_FOUND'],
        ['notes.txt', 415, 'UNSUPPORTED_IMAGE'],
        ['folder.jpg', 400, 'NOT_A_FILE'],
      ];

      for (const [path_part, status, code] of cases) {
        const res = await request(env.app).get('/api/image').query({ path: path_part });

        expect(res.status).toBe(status as number);
        expect(res.body.error?.code).toBe(code);

        // No cacheable headers
        const cacheControl = res.headers['cache-control'] as string;
        expect(cacheControl).not.toMatch(/max-age=3600/);

        // No OS message or errno
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toMatch(/ENOENT|EACCES|errno|syscall/);
        // No absolute path (check root path doesn't leak)
        expect(bodyStr).not.toContain(env.root);
      }
    });

    it('405 for write methods', async () => {
      const methods = ['post', 'put', 'delete', 'patch'] as const;

      for (const method of methods) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (request(env.app) as any)
          [method]('/api/image')
          .query({ path: 'photo.jpg' });

        expect(res.status).toBe(405);
        expect(res.body.error?.code).toBe('METHOD_NOT_ALLOWED');
      }
    });

    it('403 FORBIDDEN_HOST', async () => {
      const res = await request(env.app)
        .get('/api/image')
        .query({ path: 'photo.jpg' })
        .set('Host', 'evil.example');

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN_HOST');
    });

    it('FORBIDDEN_HOST with valid hosts', async () => {
      const hosts = ['127.0.0.1:4317', 'localhost', '[::1]:4317'];

      for (const host of hosts) {
        const res = await request(env.app)
          .get('/api/image')
          .query({ path: 'photo.jpg' })
          .set('Host', host);

        // We don't care about the exact status if the Host check passes;
        // just verify it's not 403 FORBIDDEN_HOST
        expect(res.status).not.toBe(403);
      }
    });

    it('ACCESS_DENIED for an unreadable file', async () => {
      if (process.platform === 'win32' || process.getuid?.() === 0) {
        // Skip on Windows or when running as root
        console.log('skip: cannot test permission denial on this platform');
        return;
      }

      try {
        // Make the file unreadable
        const filePath = path.join(env.root, 'photo.jpg');
        await fs.chmod(filePath, 0o000);

        const res = await request(env.app).get('/api/image').query({ path: 'photo.jpg' });

        expect(res.status).toBe(403);
        expect(res.body.error?.code).toBe('ACCESS_DENIED');
      } finally {
        // Restore permissions
        const filePath = path.join(env.root, 'photo.jpg');
        await fs.chmod(filePath, 0o644);
      }
    });
  });
});
