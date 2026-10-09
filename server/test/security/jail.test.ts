/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  setJailRoot,
  getJailRoot,
  resetJailRootForTests,
  resolveSafe,
  isWirePathAcceptable,
  isContained,
  toWirePath,
  assertDirectory,
  assertFile,
  mapFsError,
} from '../../src/security/jail.js';
import { ApiError } from '../../src/middleware/errorEnvelope.js';

let baseDir: string;
let rootDir: string;
let outsideDir: string;

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'slydr-jail-'));
  baseDir = base;

  // Create root and outside directories
  rootDir = path.join(base, 'root');
  outsideDir = path.join(base, 'outside');

  await fs.mkdir(rootDir);
  await fs.mkdir(outsideDir);

  // Realpath both to handle macOS /var symlink and Windows short names
  const realpathNative = fsSync.realpath.native as unknown as (
    p: string,
    callback: (err: Error | null, resolved?: string) => void,
  ) => void;
  rootDir = await new Promise<string>((resolve, reject) => {
    realpathNative(rootDir, (err, resolved) => {
      if (err) reject(err);
      else resolve(resolved!);
    });
  });
  outsideDir = await new Promise<string>((resolve, reject) => {
    realpathNative(outsideDir, (err, resolved) => {
      if (err) reject(err);
      else resolve(resolved!);
    });
  });

  // Create fixture structure
  // root/
  //   Pictures/
  //     2024/
  //       IMG_0001.jpg
  //   notes.txt
  //   link-inside -> root/Pictures/2024 (symlink)
  //   link-outside -> outsideDir (symlink)
  //   link-broken -> root/nope (symlink to missing target)
  //   junction-outside -> outsideDir (win32 only)

  const picturesDir = path.join(rootDir, 'Pictures');
  const picturesYearDir = path.join(picturesDir, '2024');

  await fs.mkdir(picturesYearDir, { recursive: true });
  await fs.writeFile(path.join(picturesYearDir, 'IMG_0001.jpg'), Buffer.alloc(100));
  await fs.writeFile(path.join(rootDir, 'notes.txt'), 'test content');

  // Create a file in outside for later testing
  await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret');

  // Try to create symlinks
  const symlinkInside = await trySymlink(
    path.join(rootDir, 'Pictures', '2024'),
    path.join(rootDir, 'link-inside'),
    'dir',
  );
  const symlinkOutside = await trySymlink(outsideDir, path.join(rootDir, 'link-outside'), 'dir');
  const symlinkBroken = await trySymlink(
    path.join(rootDir, 'nope'),
    path.join(rootDir, 'link-broken'),
    'dir',
  );

  // Store creation results in beforeAll scope for access in tests
  (global as any).symlinkTests = {
    symlinkInside,
    symlinkOutside,
    symlinkBroken,
  };

  // Try junction on Windows
  if (process.platform === 'win32') {
    const junctionOutside = await trySymlink(
      outsideDir,
      path.join(rootDir, 'junction-outside'),
      'junction',
    );
    (global as any).symlinkTests.junctionOutside = junctionOutside;
  }

  // Initialize jail root
  resetJailRootForTests();
  setJailRoot(rootDir);
});

afterAll(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

async function trySymlink(
  target: string,
  link: string,
  type: 'dir' | 'junction',
): Promise<boolean> {
  try {
    await fs.symlink(target, link, type);
    return true;
  } catch (_err) {
    return false;
  }
}

describe('jail — setJailRoot / getJailRoot', () => {
  afterEach(() => {
    // Restore the jail root after each test that resets it
    resetJailRootForTests();
    setJailRoot(rootDir);
  });

  it('getJailRoot throws before initialisation', () => {
    resetJailRootForTests();
    expect(() => getJailRoot()).toThrow('Jail root has not been initialised.');
  });

  it('setJailRoot rejects a relative path', () => {
    resetJailRootForTests();
    expect(() => setJailRoot('relative/path')).toThrow(/requires an absolute path/);
  });

  it('setJailRoot twice with the same path is a no-op', () => {
    resetJailRootForTests();
    setJailRoot(rootDir);
    setJailRoot(rootDir); // should not throw
    expect(getJailRoot()).toBe(rootDir);
  });

  it('setJailRoot with a different path throws', () => {
    resetJailRootForTests();
    setJailRoot(rootDir);
    expect(() => setJailRoot(outsideDir)).toThrow(/called twice with different paths/);
  });

  it('setJailRoot strips a trailing separator but preserves a volume root', () => {
    resetJailRootForTests();
    const withTrailing = rootDir + path.sep;
    setJailRoot(withTrailing);
    expect(getJailRoot()).toBe(rootDir);
  });

  it('setJailRoot preserves volume root (/) on POSIX', function (this: any) {
    if (process.platform === 'win32') {
      return; // skip
    }
    resetJailRootForTests();
    setJailRoot('/');
    expect(getJailRoot()).toBe('/');
  });

  it('setJailRoot preserves volume root (C:\\) on Windows', function (this: any) {
    if (process.platform !== 'win32') {
      return; // skip
    }
    resetJailRootForTests();
    // Use C:\ as volume root
    const volumeRoot = 'C:\\';
    setJailRoot(volumeRoot);
    expect(getJailRoot()).toBe(volumeRoot);
  });
});

describe('jail — isWirePathAcceptable (steps 1-4)', () => {
  describe('step 1: NUL byte', () => {
    it('rejects a NUL byte at the start', () => {
      expect(isWirePathAcceptable('\0')).toBe(false);
    });

    it('rejects a NUL byte in the middle', () => {
      expect(isWirePathAcceptable('a\0b')).toBe(false);
    });

    it('rejects a NUL byte at the end', () => {
      expect(isWirePathAcceptable('Pictures/2024\0')).toBe(false);
    });
  });

  describe('step 2: length', () => {
    it('accepts a 4096-character input', () => {
      const path4096 = 'a'.repeat(4096);
      expect(isWirePathAcceptable(path4096)).toBe(true);
    });

    it('rejects a 4097-character input', () => {
      const path4097 = 'a'.repeat(4097);
      expect(isWirePathAcceptable(path4097)).toBe(false);
    });
  });

  describe('step 3: absolute and UNC paths', () => {
    it('rejects POSIX absolute path /', () => {
      expect(isWirePathAcceptable('/')).toBe(false);
    });

    it('rejects POSIX absolute path /etc/passwd', () => {
      expect(isWirePathAcceptable('/etc/passwd')).toBe(false);
    });

    it('rejects Windows drive path C:\\Windows\\System32', () => {
      expect(isWirePathAcceptable('C:\\Windows\\System32')).toBe(false);
    });

    it('rejects Windows drive path c:/Windows', () => {
      expect(isWirePathAcceptable('c:/Windows')).toBe(false);
    });

    it('rejects Windows drive path Z:', () => {
      expect(isWirePathAcceptable('Z:')).toBe(false);
    });

    it('rejects UNC path \\\\server\\share\\file.jpg', () => {
      expect(isWirePathAcceptable('\\\\server\\share\\file.jpg')).toBe(false);
    });

    it('rejects leading backslash on Windows only', function (this: any) {
      if (process.platform === 'win32') {
        expect(isWirePathAcceptable('\\Windows')).toBe(false);
      } else {
        expect(isWirePathAcceptable('\\Windows')).toBe(true); // ordinary name on POSIX
      }
    });

    it('rejects backslash in input on Windows (bypass guard)', function (this: any) {
      if (process.platform === 'win32') {
        expect(isWirePathAcceptable('Pictures\\2024')).toBe(false);
        expect(isWirePathAcceptable('a\\..\\..\\outside')).toBe(false);
      } else {
        return; // skip
      }
    });

    it.skipIf(process.platform === 'win32')('allows backslash inside a name on POSIX', () => {
      expect(isWirePathAcceptable('a\\b')).toBe(true);
    });
  });

  describe('step 4: .. segments', () => {
    it('rejects bare ..', () => {
      expect(isWirePathAcceptable('..')).toBe(false);
    });

    it('rejects ../etc', () => {
      expect(isWirePathAcceptable('../etc')).toBe(false);
    });

    it('rejects .. in the middle', () => {
      expect(isWirePathAcceptable('Pictures/../../outside')).toBe(false);
    });

    it('rejects .. that would stay inside the root', () => {
      expect(isWirePathAcceptable('Pictures/2024/../2024')).toBe(false);
    });

    it('accepts empty and . segments', () => {
      expect(isWirePathAcceptable('Pictures//2024')).toBe(true);
      expect(isWirePathAcceptable('./Pictures/./2024')).toBe(true);
    });

    it('accepts ... and ..cache', () => {
      expect(isWirePathAcceptable('...')).toBe(true);
      expect(isWirePathAcceptable('..cache')).toBe(true);
      expect(isWirePathAcceptable('Pictures/...')).toBe(true);
    });
  });
});

async function expectResolveSafeError(wirePath: string, expectedCode: string): Promise<ApiError> {
  try {
    await resolveSafe(wirePath);
    throw new Error(`Expected resolveSafe to throw for ${wirePath}, but it succeeded`);
  } catch (err) {
    if (!(err instanceof ApiError)) {
      throw err;
    }
    expect(err.code).toBe(expectedCode);
    return err;
  }
}

describe('jail — resolveSafe (steps 1-8)', () => {
  describe('step 1: NUL byte rejection', () => {
    it('rejects a NUL byte', async () => {
      const err = await expectResolveSafeError('a\0b', 'INVALID_PATH');
      expect(err.status).toBe(400);
    });
  });

  describe('step 2: length rejection', () => {
    it('accepts a 4096-character path shape', async () => {
      const longPath = 'a'.repeat(4096);
      // A 4096-character path that doesn't exist should throw NOT_FOUND, proving it passed the length gate
      const err = await expectResolveSafeError(longPath, 'NOT_FOUND');
      expect(err.status).toBe(404);
    });

    it('rejects a 4097-character path', async () => {
      const err = await expectResolveSafeError('a'.repeat(4097), 'INVALID_PATH');
      expect(err.status).toBe(400);
    });
  });

  describe('step 3: absolute path rejection', () => {
    it('rejects POSIX absolute path', async () => {
      await expectResolveSafeError('/etc/passwd', 'INVALID_PATH');
    });

    it('rejects Windows drive path', async () => {
      await expectResolveSafeError('C:\\Windows\\System32', 'INVALID_PATH');
    });

    it('rejects UNC path', async () => {
      await expectResolveSafeError('\\\\server\\share\\file.jpg', 'INVALID_PATH');
    });
  });

  describe('step 4: .. rejection', () => {
    it('rejects bare ..', async () => {
      const err = await expectResolveSafeError('..', 'OUTSIDE_ROOT');
      expect(err.status).toBe(403);
    });

    it('rejects ../etc', async () => {
      await expectResolveSafeError('../etc', 'OUTSIDE_ROOT');
    });

    it('rejects .. in the middle', async () => {
      await expectResolveSafeError('Pictures/../../outside', 'OUTSIDE_ROOT');
    });

    it('rejects .. that would stay inside the root', async () => {
      await expectResolveSafeError('Pictures/2024/../2024', 'OUTSIDE_ROOT');
    });
  });

  describe('step 5-6: join and realpath', () => {
    it('resolves the root itself for empty string', async () => {
      const result = await resolveSafe('');
      expect(result).toBe(rootDir);
    });

    it('resolves a nested existing directory', async () => {
      const result = await resolveSafe('Pictures/2024');
      expect(result).toBe(path.join(rootDir, 'Pictures', '2024'));
    });

    it('resolves an existing file', async () => {
      const result = await resolveSafe('Pictures/2024/IMG_0001.jpg');
      expect(result).toBe(path.join(rootDir, 'Pictures', '2024', 'IMG_0001.jpg'));
    });

    it('maps a missing target to NOT_FOUND', async () => {
      const err = await expectResolveSafeError('does-not-exist', 'NOT_FOUND');
      expect(err.status).toBe(404);
    });

    it('maps ENOTDIR to NOT_FOUND', async () => {
      await expectResolveSafeError('notes.txt/child', 'NOT_FOUND');
    });

    it('maps a broken symlink to NOT_FOUND', async function (this: any) {
      const symlinks = (global as any).symlinkTests;
      if (!symlinks?.symlinkBroken) {
        return; // skip
      }
      await expectResolveSafeError('link-broken', 'NOT_FOUND');
    });
  });

  describe('step 7: symlink containment', () => {
    it('rejects a symlink whose target is outside the root', async function (this: any) {
      const symlinks = (global as any).symlinkTests;
      if (!symlinks?.symlinkOutside) {
        return; // skip
      }
      const err = await expectResolveSafeError('link-outside', 'OUTSIDE_ROOT');
      expect(err.status).toBe(403);
    });

    it('allows a symlink whose target is inside the root', async function (this: any) {
      const symlinks = (global as any).symlinkTests;
      if (!symlinks?.symlinkInside) {
        return; // skip
      }
      const result = await resolveSafe('link-inside');
      expect(result).toBe(path.join(rootDir, 'Pictures', '2024'));
    });

    it('rejects a path reached through an outside symlink', async function (this: any) {
      const symlinks = (global as any).symlinkTests;
      if (!symlinks?.symlinkOutside) {
        return; // skip
      }
      await expectResolveSafeError('link-outside/secret.txt', 'OUTSIDE_ROOT');
    });

    it('rejects a Windows junction pointing outside the root', async function (this: any) {
      if (process.platform !== 'win32') {
        return; // skip
      }
      const symlinks = (global as any).symlinkTests;
      if (!symlinks?.junctionOutside) {
        return; // skip
      }
      await expectResolveSafeError('junction-outside', 'OUTSIDE_ROOT');
    });

    it('rejects a sibling directory sharing the root name prefix', async () => {
      // Create sibling with similar name
      const evil = path.join(path.dirname(rootDir), 'rootEvil');
      await fs.mkdir(evil, { recursive: true });

      try {
        // Create a symlink to the evil directory
        const evilLink = path.join(rootDir, 'evil-link');
        const created = await trySymlink(evil, evilLink, 'dir');

        if (!created) {
          // Skip if symlink creation not available
          return;
        }

        const err = await expect(resolveSafe('evil-link')).rejects.toThrow(ApiError);
        expect((err as any).thrownError?.code).toBe('OUTSIDE_ROOT');
      } finally {
        await fs.rm(evil, { recursive: true, force: true });
      }
    });

    it('allows the root when the jail root is a volume root', async () => {
      // Test the isContained helper directly for volume root edge case
      // Note: this test uses POSIX paths, valid on all platforms for the helper function
      if (process.platform === 'win32') {
        // On Windows, test with Windows paths
        expect(isContained('C:\\', 'C:\\')).toBe(true);
        expect(isContained('C:\\Windows', 'C:\\')).toBe(true);
        expect(isContained('C:\\Windows\\System32', 'C:\\')).toBe(true);
      } else {
        // On POSIX
        expect(isContained('/mnt/data', '/')).toBe(true);
        expect(isContained('/etc/passwd', '/')).toBe(true);
        expect(isContained('/', '/')).toBe(true);
      }
    });
  });

  describe('segment dropping', () => {
    it('drops empty segments', async () => {
      const result1 = await resolveSafe('Pictures//2024');
      const result2 = await resolveSafe('Pictures/2024');
      expect(result1).toBe(result2);
    });

    it('drops . segments', async () => {
      const result1 = await resolveSafe('./Pictures/./2024');
      const result2 = await resolveSafe('Pictures/2024');
      expect(result1).toBe(result2);
    });
  });

  describe('dot-prefixed names', () => {
    it('does not reject ... or ..cache', async () => {
      // These will resolve to NOT_FOUND when absent
      await expectResolveSafeError('...', 'NOT_FOUND');
      await expectResolveSafeError('..cache', 'NOT_FOUND');
    });
  });
});

describe('jail — toWirePath', () => {
  it('returns the empty string for the root', () => {
    expect(toWirePath(rootDir)).toBe('');
  });

  it('converts separators for a single-segment path', () => {
    const absPath = path.join(rootDir, 'Pictures');
    expect(toWirePath(absPath)).toBe('Pictures');
  });

  it('converts separators for a nested path', () => {
    const absPath = path.join(rootDir, 'Pictures', '2024');
    expect(toWirePath(absPath)).toBe('Pictures/2024');
  });

  it('converts separators for a nested path with file', () => {
    const absPath = path.join(rootDir, 'Pictures', '2024', 'IMG_0001.jpg');
    expect(toWirePath(absPath)).toBe('Pictures/2024/IMG_0001.jpg');
  });

  it('throws for a path outside the root', () => {
    expect(() => toWirePath(outsideDir)).toThrow(/outside the jail root/);
  });

  it('round-trips a non-symlinked wire path', async () => {
    const wirePath = 'Pictures/2024';
    const absPath = await resolveSafe(wirePath);
    const roundTrip = toWirePath(absPath);
    expect(roundTrip).toBe(wirePath);
  });

  it('does not round-trip through a symlink, by design', async () => {
    const symlinks = (global as any).symlinkTests;
    if (!symlinks?.symlinkInside) {
      return; // skip test
    }
    const absPath = await resolveSafe('link-inside');
    const wirePath = toWirePath(absPath);
    expect(wirePath).toBe('Pictures/2024'); // target, not 'link-inside'
  });

  it('handles ..cache and ... in names without throwing', async () => {
    // Create a subdirectory with a dotted name
    const dotsDir = path.join(rootDir, 'Pictures', '..cache');
    const tripleDir = path.join(rootDir, 'Pictures', '...');

    try {
      await fs.mkdir(dotsDir, { recursive: true });
      const wirePath1 = toWirePath(dotsDir);
      expect(wirePath1).toBe('Pictures/..cache');

      // ... cannot be created on Windows, so skip on that platform
      if (process.platform !== 'win32') {
        await fs.mkdir(tripleDir, { recursive: true });
        const wirePath2 = toWirePath(tripleDir);
        expect(wirePath2).toBe('Pictures/...');
      }
    } finally {
      await fs.rm(dotsDir, { recursive: true, force: true });
      if (process.platform !== 'win32') {
        await fs.rm(tripleDir, { recursive: true, force: true });
      }
    }
  });
});

describe('jail — assertDirectory / assertFile', () => {
  it('assertDirectory accepts a directory and returns Stats', async () => {
    const stats = await assertDirectory(path.join(rootDir, 'Pictures'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('assertDirectory rejects a file with NOT_A_DIRECTORY', async () => {
    try {
      await assertDirectory(path.join(rootDir, 'notes.txt'));
      expect.fail('Expected assertDirectory to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('NOT_A_DIRECTORY');
      expect((err as ApiError).status).toBe(400);
    }
  });

  it('assertFile accepts a regular file and returns Stats', async () => {
    const stats = await assertFile(path.join(rootDir, 'Pictures', '2024', 'IMG_0001.jpg'));
    expect(stats.isFile()).toBe(true);
    expect(typeof stats.size).toBe('number');
    expect(typeof stats.mtimeMs).toBe('number');
  });

  it('assertFile rejects a directory with NOT_A_FILE', async () => {
    try {
      await assertFile(path.join(rootDir, 'Pictures'));
      expect.fail('Expected assertFile to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('NOT_A_FILE');
      expect((err as ApiError).status).toBe(400);
    }
  });

  it('assertDirectory maps a vanished path to NOT_FOUND', async () => {
    const tempFile = path.join(rootDir, 'temp-test-file.txt');
    await fs.writeFile(tempFile, 'content');

    // First verify it works
    const stats = await assertFile(tempFile);
    expect(stats.isFile()).toBe(true);

    // Delete it and verify the error
    await fs.unlink(tempFile);
    try {
      await assertFile(tempFile);
      expect.fail('Expected assertFile to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('NOT_FOUND');
    }
  });
});

describe('jail — mapFsError', () => {
  it('maps ENOENT to NOT_FOUND', () => {
    const err = new Error('Not found');
    (err as any).code = 'ENOENT';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('NOT_FOUND');
    expect(apiErr.status).toBe(404);
    expect(apiErr.cause).toBe(err);
  });

  it('maps ENOTDIR to NOT_FOUND', () => {
    const err = new Error('Not a directory');
    (err as any).code = 'ENOTDIR';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('NOT_FOUND');
  });

  it('maps EACCES to ACCESS_DENIED', () => {
    const err = new Error('Permission denied');
    (err as any).code = 'EACCES';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('ACCESS_DENIED');
    expect(apiErr.status).toBe(403);
  });

  it('maps EPERM to ACCESS_DENIED', () => {
    const err = new Error('Operation not permitted');
    (err as any).code = 'EPERM';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('ACCESS_DENIED');
    expect(apiErr.status).toBe(403);
  });

  it('maps ELOOP to NOT_FOUND', () => {
    const err = new Error('Too many symlinks');
    (err as any).code = 'ELOOP';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('NOT_FOUND');
  });

  it('maps ENAMETOOLONG to INVALID_PATH', () => {
    const err = new Error('Name too long');
    (err as any).code = 'ENAMETOOLONG';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('INVALID_PATH');
    expect(apiErr.status).toBe(400);
  });

  it('maps EINVAL to INVALID_PATH', () => {
    const err = new Error('Invalid argument');
    (err as any).code = 'EINVAL';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('INVALID_PATH');
  });

  it('maps unknown error codes to READ_FAILED', () => {
    const err = new Error('Unknown error');
    (err as any).code = 'EACME';
    const apiErr = mapFsError(err);
    expect(apiErr.code).toBe('READ_FAILED');
    expect(apiErr.status).toBe(500);
  });

  it('maps a non-Error value to READ_FAILED', () => {
    const apiErr1 = mapFsError('string error');
    expect(apiErr1.code).toBe('READ_FAILED');

    const apiErr2 = mapFsError(null);
    expect(apiErr2.code).toBe('READ_FAILED');

    const apiErr3 = mapFsError(undefined);
    expect(apiErr3.code).toBe('READ_FAILED');
  });

  it('preserves the original error as cause', () => {
    const originalErr = new Error('Original message');
    const apiErr = mapFsError(originalErr);
    expect(apiErr.cause).toBe(originalErr);
  });

  it('never puts the original message or errno into the ApiError message', () => {
    const originalErr = new Error('Specific OS error with /absolute/path/to/file');
    (originalErr as any).errno = -2;
    (originalErr as any).code = 'ENOENT';

    const apiErr = mapFsError(originalErr);
    expect(apiErr.message).toBe('Not found.');
    expect(apiErr.message).not.toContain('Specific OS error');
    expect(apiErr.message).not.toContain('/absolute/path');
    expect(apiErr.message).not.toContain('-2');
  });
});

describe('jail — permission denied behaviour', () => {
  it.skipIf(process.platform === 'win32')(
    'maps an unreadable directory to ACCESS_DENIED',
    async () => {
      // Skip if running as root
      if (process.getuid?.() === 0) {
        return;
      }

      const lockedDir = path.join(rootDir, 'locked');
      await fs.mkdir(lockedDir);

      try {
        await fs.chmod(lockedDir, 0o000);

        await expectResolveSafeError('locked/child', 'ACCESS_DENIED');
      } finally {
        // Restore permissions so cleanup can succeed
        await fs.chmod(lockedDir, 0o755);
      }
    },
  );
});

describe('jail — isContained edge cases', () => {
  it('handles volume root with trailing separator', () => {
    // On Windows, path.sep is \ so we need to use Windows paths
    if (process.platform === 'win32') {
      expect(isContained('C:\\', 'C:\\')).toBe(true);
      expect(isContained('C:\\Windows', 'C:\\')).toBe(true);
    } else {
      expect(isContained('/', '/')).toBe(true);
      expect(isContained('/home', '/')).toBe(true);
      expect(isContained('/etc/passwd', '/')).toBe(true);
    }
  });

  it('rejects sibling with similar name prefix', () => {
    // Use path-agnostic approach
    const sep = path.sep;
    const root = `${sep}home${sep}user`;
    const evil = `${sep}home${sep}userEvil`;
    expect(isContained(evil, root)).toBe(false);
  });

  it('accepts exact match and contained paths', () => {
    const sep = path.sep;
    const root = `${sep}home${sep}user`;
    expect(isContained(root, root)).toBe(true);
    expect(isContained(`${sep}home${sep}user${sep}Pictures`, root)).toBe(true);
    expect(isContained(`${sep}home${sep}user${sep}Pictures${sep}2024`, root)).toBe(true);
  });
});

describe('jail — no ApiError leaks absolute paths or errno', () => {
  it('does not include absolute path in error messages', async () => {
    const apiErr = await expectResolveSafeError('nonexistent', 'NOT_FOUND');
    expect(apiErr.message).not.toContain(rootDir);
    expect(apiErr.message).not.toContain('/');
    expect(apiErr.message).not.toContain('\\');
  });

  it('stores detail in cause, not message', async () => {
    const apiErr = await expectResolveSafeError('nonexistent', 'NOT_FOUND');
    expect(apiErr.cause).toBeDefined();
    expect(apiErr.message).toBe('Not found.');
  });
});
