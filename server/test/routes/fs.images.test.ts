/**
 * Supertest suite for GET /api/fs/images.
 * Tests the HTTP contract and error handling against a fixture tree.
 * Specification §5.4, §12.2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestEnv } from '../helpers/testApp.js';
import { trySymlink } from '../helpers/fs.js';
import type { TestEnv } from '../helpers/testApp.js';
import { createFsRouter } from '../../src/routes/fs.js';
import { createTestLogger } from '../helpers/logger.js';
import express from 'express';
import { compareNames } from '../../src/services/listing.js';
import type { ImageItem } from '@slydr/shared';

describe('GET /api/fs/images', () => {
  let env: TestEnv;
  let linkInside = false;
  let linkOutside = false;

  beforeAll(async () => {
    env = await createTestEnv({
      prefix: 'slydr-images-',
      populate: async (root, outside) => {
        // Create directory structure per spec §6
        await fs.mkdir(path.join(root, 'nested', 'deeper'), { recursive: true });
        await fs.mkdir(path.join(root, '.hiddenfolder'), { recursive: true });

        // Create top-level image files (tiny JPG/PNG magic bytes for test)
        await fs.writeFile(path.join(root, 'IMG_2.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
        await fs.writeFile(path.join(root, 'IMG_10.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
        await fs.writeFile(path.join(root, 'file-not-folder.jpg'), Buffer.from([0xff, 0xd8, 0xff]));

        // Create non-image file
        await fs.writeFile(path.join(root, 'notes.txt'), 'hello');

        // Create hidden image
        await fs.writeFile(path.join(root, '.secret.png'), Buffer.from([0x89, 0x50, 0x4e]));

        // Create nested images
        await fs.writeFile(path.join(root, 'nested', 'n1.png'), Buffer.from([0x89, 0x50, 0x4e]));
        await fs.writeFile(
          path.join(root, 'nested', 'deeper', 'd1.webp'),
          Buffer.from([0x52, 0x49, 0x46]),
        );

        // Create hidden folder with image
        await fs.writeFile(
          path.join(root, '.hiddenfolder', 'h1.jpg'),
          Buffer.from([0xff, 0xd8, 0xff]),
        );

        // Create deep nested structure for depth cap testing (each level has img.jpg)
        let currentPath = path.join(root, 'deep');
        for (let i = 1; i <= 14; i++) {
          currentPath = path.join(currentPath, `l${i}`);
          await fs.mkdir(currentPath, { recursive: true });
          await fs.writeFile(path.join(currentPath, 'img.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
        }

        // Create file outside the jail
        await fs.writeFile(path.join(outside, 'out.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
      },
    });

    // Create symlink fixtures after createTestEnv (after jail is set)
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    linkInside = await trySymlink(
      path.join(env.root, 'nested'),
      path.join(env.root, 'link-nested'),
      linkType,
    );
    linkOutside = await trySymlink(env.outside, path.join(env.root, 'link-outside'), linkType);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  // ===== Happy path =====

  it('flat scan returns only top-level images, in collator order', async () => {
    const res = await request(env.app).get('/api/fs/images');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('');
    expect(res.body.recursive).toBe(false);
    expect(res.body.truncated).toBe(false);

    const names = res.body.items.map((item: ImageItem) => item.name);
    // Collator order (case-insensitive, numeric): file-not-folder.jpg, IMG_2.jpg, IMG_10.jpg
    const expected = ['file-not-folder.jpg', 'IMG_2.jpg', 'IMG_10.jpg'].sort(compareNames);
    expect(names).toEqual(expected);

    // Verify hidden, nested, and non-images are absent
    expect(names).not.toContain('.secret.png');
    expect(names).not.toContain('n1.png');
    expect(names).not.toContain('notes.txt');
  });

  it('recursive scan walks the subtree depth-first, own images first', async () => {
    const res = await request(env.app).get('/api/fs/images?recursive=true');

    expect(res.status).toBe(200);
    expect(res.body.recursive).toBe(true);
    expect(res.body.truncated).toBe(false);

    const paths = res.body.items.map((item: ImageItem) => item.path);

    // Top-level images should come before nested ones or links
    const topLevelIndices = paths
      .map((p: string, i: number) => (!p.includes('/') ? i : -1))
      .filter((i: number) => i >= 0);
    const nestedOrLinkIndices = paths
      .map((p: string, i: number) => (p.includes('nested') || p.includes('link-nested') ? i : -1))
      .filter((i: number) => i >= 0);

    if (topLevelIndices.length > 0 && nestedOrLinkIndices.length > 0) {
      expect(Math.max(...topLevelIndices)).toBeLessThan(Math.min(...nestedOrLinkIndices));
    }

    // Verify some nested or link-nested items exist (could be either, depending on symlink support)
    const hasNestedOrLink = paths.includes('nested/n1.png') || paths.includes('link-nested/n1.png');
    expect(hasNestedOrLink).toBe(true);
  });

  it('nested folder is reachable via the path parameter', async () => {
    const res = await request(env.app).get('/api/fs/images?path=nested&recursive=false');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('nested');
    expect(res.body.recursive).toBe(false);

    const paths = res.body.items.map((item: ImageItem) => item.path);
    expect(paths).toEqual(['nested/n1.png']);

    // Verify all items have dir equal to 'nested'
    res.body.items.forEach((item: ImageItem) => {
      expect(item.dir).toBe('nested');
    });
  });

  it('hidden image and hidden folder are excluded by default and included with showHidden=true', async () => {
    // Without showHidden
    const res1 = await request(env.app).get('/api/fs/images?recursive=true');
    const paths1 = res1.body.items.map((item: ImageItem) => item.path);
    expect(paths1).not.toContain('.secret.png');
    expect(paths1).not.toContain('.hiddenfolder/h1.jpg');

    // With showHidden
    const res2 = await request(env.app).get('/api/fs/images?recursive=true&showHidden=true');
    const paths2 = res2.body.items.map((item: ImageItem) => item.path);
    expect(paths2).toContain('.secret.png');
    expect(paths2).toContain('.hiddenfolder/h1.jpg');
  });

  it('depth cap is enforced', async () => {
    const res = await request(env.app).get('/api/fs/images?path=deep&recursive=true');

    expect(res.status).toBe(200);

    const paths = res.body.items.map((item: ImageItem) => item.path);

    // Should have images from 12 levels deep (0-11), not from l13 or l14
    const hasL13 = paths.some((p: string) => p.includes('/l13/'));
    const hasL14 = paths.some((p: string) => p.includes('/l14/'));

    expect(hasL13).toBe(false);
    expect(hasL14).toBe(false);

    // Verify images from earlier levels are present
    expect(paths.length).toBeGreaterThan(0);
  });

  it('item fields are populated', async () => {
    const res = await request(env.app).get('/api/fs/images');

    expect(res.status).toBe(200);

    res.body.items.forEach((item: ImageItem) => {
      expect(item.name).toBeDefined();
      expect(item.name.length).toBeGreaterThan(0);

      expect(item.path).toBeDefined();
      expect(item.path.endsWith(item.name)).toBe(true);

      expect(item.dir).toBeDefined();
      expect(typeof item.dir).toBe('string');
      // For top-level items, dir should be ''
      if (!item.path.includes('/')) {
        expect(item.dir).toBe('');
      }

      expect(typeof item.size).toBe('number');
      expect(item.size).toBeGreaterThan(0);

      expect(typeof item.mtimeMs).toBe('number');
      expect(item.mtimeMs).toBeGreaterThan(0);
    });
  });

  it('response contains no platform separators', async () => {
    const res = await request(env.app).get('/api/fs/images?recursive=true&showHidden=true');

    expect(res.status).toBe(200);

    res.body.items.forEach((item: ImageItem) => {
      expect(item.path).not.toMatch(/\\/);
      expect(item.path).not.toMatch(/^\//);
      expect(item.dir).not.toMatch(/\\/);
      expect(item.dir).not.toMatch(/^\//);
    });
  });

  // ===== Parameter validation =====

  it('invalid recursive value is rejected', async () => {
    const invalidValues = ['1', '0', 'TRUE', 'True', 'yes', '', 'maybe'];

    for (const value of invalidValues) {
      const res = await request(env.app).get(
        `/api/fs/images?recursive=${encodeURIComponent(value)}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    }
  });

  it('invalid showHidden value is rejected', async () => {
    const invalidValues = ['1', '0', 'TRUE', 'True', 'yes', '', 'maybe'];

    for (const value of invalidValues) {
      const res = await request(env.app).get(
        `/api/fs/images?showHidden=${encodeURIComponent(value)}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    }
  });

  it('repeated path parameter is rejected', async () => {
    const res = await request(env.app).get('/api/fs/images?path=nested&path=deep');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  it('parameter validation precedes path resolution', async () => {
    const res = await request(env.app).get('/api/fs/images?path=does-not-exist&recursive=maybe');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  // ===== Path traversal and access control =====

  it('traversal attempt is refused', async () => {
    const res = await request(env.app).get('/api/fs/images?path=../../../etc');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUTSIDE_ROOT');
  });

  it('absolute and UNC paths are refused', async () => {
    const paths = ['/etc', 'C:/Windows', '\\\\server\\share'];

    for (const pathParam of paths) {
      const res = await request(env.app).get(
        `/api/fs/images?path=${encodeURIComponent(pathParam)}`,
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PATH');
    }
  });

  it('Windows backslash is refused on Windows only', async () => {
    if (process.platform === 'win32') {
      const res = await request(env.app).get('/api/fs/images?path=nested%5Cdeeper');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PATH');
    } else {
      // On POSIX, backslash is a valid filename character
      const res = await request(env.app).get('/api/fs/images?path=nested%5Cdeeper');
      // This is a missing folder, so 404
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('NUL byte is refused', async () => {
    const res = await request(env.app).get('/api/fs/images?path=a%00b');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PATH');
  });

  // ===== File vs directory =====

  it('a file is not a directory', async () => {
    const res = await request(env.app).get('/api/fs/images?path=file-not-folder.jpg');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_A_DIRECTORY');
  });

  // ===== Not found =====

  it('missing folder is 404', async () => {
    const res = await request(env.app).get('/api/fs/images?path=nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // ===== Permissions (POSIX only) =====

  it('unreadable folder is 403 ACCESS_DENIED', async () => {
    if (process.platform === 'win32') {
      // Skip on Windows; fs.chmod doesn't work the same way
      return;
    }

    const testDir = path.join(env.root, 'nested');
    try {
      await fs.chmod(testDir, 0o000);
      const res = await request(env.app).get('/api/fs/images?path=nested');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCESS_DENIED');
    } finally {
      await fs.chmod(testDir, 0o755);
    }
  });

  it('unreadable subdirectory does not fail the scan', async () => {
    if (process.platform === 'win32') {
      // Skip on Windows
      return;
    }

    const deeperDir = path.join(env.root, 'nested', 'deeper');
    try {
      await fs.chmod(deeperDir, 0o000);
      const res = await request(env.app).get('/api/fs/images?path=nested&recursive=true');

      expect(res.status).toBe(200);

      const paths = res.body.items.map((item: ImageItem) => item.path);
      // nested/n1.png should be present
      expect(paths).toContain('nested/n1.png');
      // nested/deeper/d1.webp should not be present
      expect(paths).not.toContain('nested/deeper/d1.webp');
    } finally {
      await fs.chmod(deeperDir, 0o755);
    }
  });

  // ===== Method and host guards =====

  it('method guard rejects POST', async () => {
    const res = await request(env.app).post('/api/fs/images');

    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('host guard rejects non-loopback Host', async () => {
    const res = await request(env.app).get('/api/fs/images').set('Host', 'evil.example');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_HOST');
  });

  it('host guard accepts loopback Host', async () => {
    const res = await request(env.app).get('/api/fs/images').set('Host', '127.0.0.1:4317');

    expect(res.status).toBe(200);
  });

  // ===== Error responses leak nothing =====

  it('error bodies leak nothing', async () => {
    const testCases = [
      { path: 'nope', expectedCode: 'NOT_FOUND' },
      { path: '../../../etc', expectedCode: 'OUTSIDE_ROOT' },
      { path: 'file-not-folder.jpg', expectedCode: 'NOT_A_DIRECTORY' },
    ];

    for (const testCase of testCases) {
      const res = await request(env.app).get(
        `/api/fs/images?path=${encodeURIComponent(testCase.path)}`,
      );

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(env.root); // No absolute path
      expect(body).not.toMatch(/ENOENT/); // No errno
      expect(body).not.toMatch(/EACCES/);
      expect(body).not.toContain('errno'); // No errno field
    }
  });

  // ===== Truncation flag =====

  it('truncation flag is wired through', async () => {
    // Use the documented seam: inject a stub scanImages
    const { logger } = createTestLogger();
    const app = express();
    app.use(
      '/api/fs',
      createFsRouter({
        logger,
        scanImages: async () => ({
          items: [
            { name: 'a.jpg', path: 'a.jpg', dir: '', size: 100, mtimeMs: 1000 },
            { name: 'b.jpg', path: 'b.jpg', dir: '', size: 100, mtimeMs: 1000 },
            { name: 'c.jpg', path: 'c.jpg', dir: '', size: 100, mtimeMs: 1000 },
          ] as ImageItem[],
          truncated: true,
        }),
      }),
    );

    const testRes = await request(app).get('/api/fs/images');

    expect(testRes.status).toBe(200);
    expect(testRes.body.truncated).toBe(true);
    expect(testRes.body.count).toBe(3);
    expect(testRes.body.items.length).toBe(3);
  });

  // ===== Empty folder =====

  it('empty folder returns an empty playlist', async () => {
    await fs.mkdir(path.join(env.root, 'empty'), { recursive: true });

    const res = await request(env.app).get('/api/fs/images?path=empty');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.count).toBe(0);
    expect(res.body.truncated).toBe(false);
  });

  // ===== Cache-Control =====

  it('sends Cache-Control: no-store', async () => {
    const res = await request(env.app).get('/api/fs/images');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  // ===== Symlinks =====

  it('a folder symlink inside the jail is followed with the navigated path', async () => {
    if (!linkInside) {
      // Skip if symlink creation failed
      return;
    }

    const res = await request(env.app).get('/api/fs/images?path=link-nested&recursive=true');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('link-nested');

    const paths = res.body.items.map((item: ImageItem) => item.path);
    // Items should use the navigated path, not the target's path
    expect(paths).toContain('link-nested/n1.png');
    expect(paths).toContain('link-nested/deeper/d1.webp');
    expect(paths).not.toContain('nested/n1.png');
    expect(paths).not.toContain('nested/deeper/d1.webp');

    // Verify dir paths also use the navigated path
    res.body.items.forEach((item: ImageItem) => {
      expect(item.dir.startsWith('link-nested')).toBe(true);
    });
  });

  it('a folder symlink escaping the jail is refused or omitted', async () => {
    if (!linkOutside) {
      // Skip if symlink creation failed
      return;
    }

    // Attempting to list the symlink itself should fail
    const res = await request(env.app).get('/api/fs/images?path=link-outside');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUTSIDE_ROOT');

    // When recursing at the root, link-outside should be omitted
    const res2 = await request(env.app).get('/api/fs/images?recursive=true');
    const paths = res2.body.items.map((item: ImageItem) => item.path);
    expect(paths).not.toContain('link-outside/out.jpg');
  });

  // ===== Logging =====

  it('logs fs.images', async () => {
    env.events.length = 0; // Clear previous events

    const res = await request(env.app).get('/api/fs/images?path=nested&recursive=true');

    expect(res.status).toBe(200);

    const event = env.events.find((e) => e.event === 'fs.images');
    expect(event).toBeDefined();
    expect(event?.fields.path).toBe('nested');
    expect(event?.fields.recursive).toBe(true);
    expect(typeof event?.fields.count).toBe('number');
    expect(typeof event?.fields.truncated).toBe('boolean');
    expect(typeof event?.fields.ms).toBe('number');
  });

  // ===== Response structure =====

  it('response contains exactly the expected keys', async () => {
    const res = await request(env.app).get('/api/fs/images');

    expect(res.status).toBe(200);

    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['count', 'items', 'path', 'recursive', 'truncated']);
  });

  it('count equals items.length', async () => {
    const res = await request(env.app).get('/api/fs/images?recursive=true&showHidden=true');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.items.length);
  });

  it('recursive in response is a boolean', async () => {
    const res1 = await request(env.app).get('/api/fs/images?recursive=true');
    const res2 = await request(env.app).get('/api/fs/images?recursive=false');

    expect(typeof res1.body.recursive).toBe('boolean');
    expect(res1.body.recursive).toBe(true);

    expect(typeof res2.body.recursive).toBe('boolean');
    expect(res2.body.recursive).toBe(false);
  });

  it('items are returned in service order with no sorting', async () => {
    const res = await request(env.app).get('/api/fs/images');

    expect(res.status).toBe(200);

    // Verify items are in the expected collator order (the service applies it)
    const names = res.body.items.map((item: ImageItem) => item.name);
    const sortedNames = [...names].sort(compareNames);

    expect(names).toEqual(sortedNames);
  });

  it('path in response is the normalised request path', async () => {
    // Path will vary based on whether this folder exists; test with nested which we know exists
    const res = await request(env.app).get('/api/fs/images?path=nested/./');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('nested');
  });
});
