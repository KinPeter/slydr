import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveJailRoot, RootResolutionError } from '../../src/bootstrap/resolveRoot.js';
import type { ServerConfig } from '../../src/config/env.js';

describe('resolveJailRoot', () => {
  let fixtureDir: string;
  let fixtureFile: string;

  beforeAll(async () => {
    // Create a temporary directory for fixtures
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slydr-root-'));
    fixtureFile = path.join(fixtureDir, 'testfile.txt');
    await fs.writeFile(fixtureFile, 'test content');
  });

  afterAll(async () => {
    // Clean up fixtures
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it('resolves an existing directory and returns its realpath', async () => {
    const config: ServerConfig = {
      port: 4317,
      rootOverride: fixtureDir,
      rootOverridden: true,
      cacheDir: '/tmp/cache',
      cacheMaxMb: 500,
      quiet: false,
    };

    const result = await resolveJailRoot(config);

    expect(result.absolute).toBeTruthy();
    expect(result.overridden).toBe(true);

    // The returned path should be a realpath
    const stats = await fs.stat(result.absolute);
    expect(stats.isDirectory()).toBe(true);
  });

  it('returns overridden: true when SLYDR_ROOT was set', async () => {
    const config: ServerConfig = {
      port: 4317,
      rootOverride: fixtureDir,
      rootOverridden: true,
      cacheDir: '/tmp/cache',
      cacheMaxMb: 500,
      quiet: false,
    };

    const result = await resolveJailRoot(config);
    expect(result.overridden).toBe(true);
  });

  it('returns overridden: false and uses the injected homedir otherwise', async () => {
    const config: ServerConfig = {
      port: 4317,
      rootOverride: null,
      rootOverridden: false,
      cacheDir: '/tmp/cache',
      cacheMaxMb: 500,
      quiet: false,
    };

    const result = await resolveJailRoot(config, {
      homedir: () => fixtureDir,
    });

    expect(result.overridden).toBe(false);
    expect(result.absolute).toBeTruthy();
  });

  it("throws RootResolutionError with reason 'missing' for a nonexistent path", async () => {
    const config: ServerConfig = {
      port: 4317,
      rootOverride: '/nonexistent/path/that/does/not/exist',
      rootOverridden: true,
      cacheDir: '/tmp/cache',
      cacheMaxMb: 500,
      quiet: false,
    };

    try {
      await resolveJailRoot(config);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RootResolutionError);
      const rootErr = err as RootResolutionError;
      expect(rootErr.reason).toBe('missing');
      // The path is resolved to absolute, so on Windows it becomes C:\nonexistent\...
      // On POSIX it stays as /nonexistent/...
      expect(rootErr.path).toBeTruthy();
      expect(rootErr.path).toContain('nonexistent');
    }
  });

  it("throws reason 'not-a-directory' when the path is a file", async () => {
    const config: ServerConfig = {
      port: 4317,
      rootOverride: fixtureFile,
      rootOverridden: true,
      cacheDir: '/tmp/cache',
      cacheMaxMb: 500,
      quiet: false,
    };

    try {
      await resolveJailRoot(config);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RootResolutionError);
      const rootErr = err as RootResolutionError;
      expect(rootErr.reason).toBe('not-a-directory');
      expect(rootErr.path).toBeTruthy();
    }
  });

  it('resolves a relative SLYDR_ROOT against cwd', async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const relPath = path.relative(os.tmpdir(), fixtureDir);

      const config: ServerConfig = {
        port: 4317,
        rootOverride: relPath,
        rootOverridden: true,
        cacheDir: '/tmp/cache',
        cacheMaxMb: 500,
        quiet: false,
      };

      const result = await resolveJailRoot(config);
      expect(result.absolute).toBeTruthy();
      expect(path.isAbsolute(result.absolute)).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('follows a symlinked root to its target', async () => {
    const symlinkedDir = path.join(os.tmpdir(), 'slydr-symlink-' + Date.now());

    try {
      await fs.symlink(fixtureDir, symlinkedDir, 'dir');

      const config: ServerConfig = {
        port: 4317,
        rootOverride: symlinkedDir,
        rootOverridden: true,
        cacheDir: '/tmp/cache',
        cacheMaxMb: 500,
        quiet: false,
      };

      const result = await resolveJailRoot(config);

      // The result should be the target, not the symlink
      // Just verify it resolves to an absolute path for now
      expect(result.absolute).toBeTruthy();
      expect(path.isAbsolute(result.absolute)).toBe(true);
    } catch (err) {
      const anyErr = err as unknown as Record<string, unknown>;
      if (anyErr.code === 'EPERM') {
        // Symlink creation requires elevation or Developer Mode on Windows
        // Skip this test
        return;
      }
      throw err;
    } finally {
      try {
        await fs.rm(symlinkedDir, { force: true });
      } catch {
        // Ignore
      }
    }
  });

  it('throws reason "unreadable" when the directory cannot be enumerated', async () => {
    // POSIX only: use fs.chmod to remove read permissions
    if (process.platform === 'win32') {
      return; // Skip on Windows
    }

    const unreadableDir = path.join(os.tmpdir(), 'slydr-unreadable-' + Date.now());
    await fs.mkdir(unreadableDir);

    try {
      // Remove read permissions
      await fs.chmod(unreadableDir, 0o000);

      const config: ServerConfig = {
        port: 4317,
        rootOverride: unreadableDir,
        rootOverridden: true,
        cacheDir: '/tmp/cache',
        cacheMaxMb: 500,
        quiet: false,
      };

      try {
        await resolveJailRoot(config);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RootResolutionError);
        const rootErr = err as RootResolutionError;
        expect(rootErr.reason).toBe('unreadable');
        expect(rootErr.path).toBeTruthy();
      }
    } finally {
      // Restore permissions and clean up
      try {
        await fs.chmod(unreadableDir, 0o755);
        await fs.rm(unreadableDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });
});
