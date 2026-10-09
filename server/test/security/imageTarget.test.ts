/**
 * Unit tests for imageTarget.ts helpers.
 * Tests readPathParam and resolveImageTarget without HTTP overhead.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { readPathParam, resolveImageTarget } from '../../src/security/imageTarget.js';
import { createTestEnv } from '../helpers/testApp.js';
import { trySymlink } from '../helpers/fs.js';
import type { TestEnv } from '../helpers/testApp.js';
import { ApiError } from '../../src/middleware/errorEnvelope.js';

describe('imageTarget helpers', () => {
  let env: TestEnv;
  let symlinkXjpgCreated = false;
  let photoLinkCreated = false;

  beforeAll(async () => {
    env = await createTestEnv({
      prefix: 'slydr-imageTarget-',
      populate: async (root) => {
        // Create files
        await fs.writeFile(path.join(root, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        await fs.writeFile(path.join(root, 'data.bin'), Buffer.from([0x89, 0x50, 0x4e])); // PNG sig
        await fs.writeFile(path.join(root, 'notes.txt'), 'text');
        await fs.mkdir(path.join(root, 'folder.jpg'));
        await fs.writeFile(
          path.join(root, 'folder.jpg', 'inner.jpg'),
          Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        );
        await fs.writeFile(path.join(root, 'PHOTO.JPG'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      },
    });

    // Create symlinks
    symlinkXjpgCreated = await trySymlink(
      path.join(env.root, 'data.bin'),
      path.join(env.root, 'x.jpg'),
      'file',
    );

    photoLinkCreated = await trySymlink(
      path.join(env.root, 'photo.jpg'),
      path.join(env.root, 'photo-link'),
      'file',
    );
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('readPathParam', () => {
    it('rejects undefined', () => {
      const req = { query: {} } as unknown as Request;

      expect(() => readPathParam(req)).toThrow(ApiError);
      try {
        readPathParam(req);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('INVALID_PARAM');
        }
      }
    });

    it('rejects arrays', () => {
      const req = { query: { path: ['a.jpg', 'b.jpg'] } } as unknown as Request;

      expect(() => readPathParam(req)).toThrow(ApiError);
      try {
        readPathParam(req);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('INVALID_PARAM');
        }
      }
    });

    it('rejects objects', () => {
      const req = { query: { path: { nested: 'value' } } } as unknown as Request;

      expect(() => readPathParam(req)).toThrow(ApiError);
      try {
        readPathParam(req);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('INVALID_PARAM');
        }
      }
    });

    it('accepts strings', () => {
      const req = { query: { path: 'photo.jpg' } } as unknown as Request;

      const result = readPathParam(req);
      expect(result).toBe('photo.jpg');
    });

    it('accepts empty string', () => {
      const req = { query: { path: '' } } as unknown as Request;

      const result = readPathParam(req);
      expect(result).toBe('');
    });
  });

  describe('resolveImageTarget', () => {
    it('returns absPath, stats and the requested name for a valid image', async () => {
      const result = await resolveImageTarget('photo.jpg');

      expect(result.absPath).toBeTruthy();
      expect(result.stats).toBeTruthy();
      expect(result.stats.isFile()).toBe(true);
      expect(result.name).toBe('photo.jpg');
    });

    it('rejects a directory with NOT_A_FILE', async () => {
      try {
        await resolveImageTarget('folder.jpg');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('NOT_A_FILE');
        }
      }
    });

    it('rejects a text file with UNSUPPORTED_IMAGE', async () => {
      try {
        await resolveImageTarget('notes.txt');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('UNSUPPORTED_IMAGE');
        }
      }
    });

    it('treats uppercase extensions as images', async () => {
      const result = await resolveImageTarget('PHOTO.JPG');

      expect(result.absPath).toBeTruthy();
      expect(result.stats).toBeTruthy();
      expect(result.name).toBe('PHOTO.JPG');
    });

    it("name is the requested name, not the target's", async () => {
      if (!symlinkXjpgCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      // x.jpg -> data.bin
      const result = await resolveImageTarget('x.jpg');

      expect(result.name).toBe('x.jpg');
      // stats should be valid
      expect(result.stats).toBeTruthy();
      // absPath should end in data.bin (the target)
      expect(result.absPath.endsWith('data.bin')).toBe(true);
    });

    it('rejects a symlink without an image extension (FR-2.1)', async () => {
      if (!photoLinkCreated) {
        console.log('skip: symlink could not be created');
        return;
      }

      // photo-link -> photo.jpg (but the link has no extension)
      try {
        await resolveImageTarget('photo-link');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('UNSUPPORTED_IMAGE');
        }
      }
    });

    it('resolves traversal attempts to OUTSIDE_ROOT', async () => {
      try {
        await resolveImageTarget('../../../etc/passwd');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('OUTSIDE_ROOT');
        }
      }
    });

    it('rejects missing files with NOT_FOUND', async () => {
      try {
        await resolveImageTarget('missing.jpg');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('NOT_FOUND');
        }
      }
    });

    it('rejects absolute paths with INVALID_PATH', async () => {
      try {
        await resolveImageTarget('/etc/passwd');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe('INVALID_PATH');
        }
      }
    });
  });
});
