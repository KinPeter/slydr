import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const scriptPath = path.join(repoRoot, 'scripts', 'verify-sharp.mjs');

describe('verify-sharp.mjs', () => {
  it('succeeds with the installed prebuilt sharp', async () => {
    const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[slydr] OK: sharp');
    expect(result.stdout).toContain('libvips');
  }, 30000);

  it('fails when a source-build directory exists', () => {
    // Resolve the sharp directory
    const serverPackageJsonPath = path.join(repoRoot, 'server', 'package.json');
    const requireFromServer = createRequire(serverPackageJsonPath);
    let sharpEntry;
    try {
      sharpEntry = requireFromServer.resolve('sharp');
    } catch {
      // If sharp is not installed, skip this test
      return;
    }

    const sharpDir = path.resolve(path.dirname(sharpEntry), '..');
    const buildDir = path.join(sharpDir, 'build');

    try {
      // Create the build directory
      if (!existsSync(buildDir)) {
        mkdirSync(buildDir, { recursive: true });
      }

      const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('compiled-from-source');
    } finally {
      // Clean up: remove the build directory
      if (existsSync(buildDir)) {
        rmSync(buildDir, { recursive: true, force: true });
      }
    }
  });
});
