import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const scriptPath = path.join(repoRoot, 'scripts', 'check-install-log.mjs');

describe('check-install-log.mjs', () => {
  it('passes on a clean npm ci log', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      const log = `added 412 packages in 9s
> esbuild@0.21.0 postinstall /path/to/node_modules/esbuild
node install.js

up to date in 2.3s
found 0 vulnerabilities`;
      writeFileSync(logFile, log);

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('OK');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails on node-gyp rebuild output', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      const log = `added 100 packages in 2s
> node-gyp rebuild
some output here`;
      writeFileSync(logFile, log);

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('node-gyp');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails on gyp ERR output', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      const log = `gyp ERR! find Python`;
      writeFileSync(logFile, log);

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'prebuild-install', text: 'prebuild-install running' },
    { label: 'node-pre-gyp', text: 'node-pre-gyp build-from-source' },
    { label: 'cmake-js', text: 'cmake-js build' },
    { label: 'MSBuild', text: 'MSBuild running' },
  ])('fails on $label mention', ({ text }) => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      writeFileSync(logFile, text);

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('matching is case-insensitive', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      writeFileSync(logFile, 'NODE-GYP rebuild');

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not flag unrelated words', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      const log = `added 100 packages
libgcc-fixture-1.0.0 installed
make-dir@1.0.0 added
found 0 vulnerabilities`;
      writeFileSync(logFile, log);

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('exits 2 for a missing file', () => {
    const result = spawnSync(process.execPath, [scriptPath, '/nonexistent/path/file.log'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(2);
  });

  it('exits 2 for an empty file', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      writeFileSync(logFile, '');

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports at most 20 hits', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slydr-log-'));
    try {
      const logFile = path.join(tmpDir, 'install.log');
      const lines = Array.from({ length: 50 }, () => 'gyp ERR! something').join('\n');
      writeFileSync(logFile, lines);

      const result = spawnSync(process.execPath, [scriptPath, logFile], { encoding: 'utf8' });

      expect(result.status).toBe(1);
      const hitCount = (result.stderr.match(/line \d+/g) || []).length;
      expect(hitCount).toBeLessThanOrEqual(20);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
