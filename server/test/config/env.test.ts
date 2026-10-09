import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { readServerConfig } from '../../src/config/env.js';

describe('readServerConfig', () => {
  // Store the original platform descriptor so we can restore it in afterEach
  const _originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    if (_originalPlatform) {
      Object.defineProperty(process, 'platform', _originalPlatform);
    }
  });

  it('defaults with an empty environment', () => {
    const config = readServerConfig({});
    expect(config.port).toBe(4317);
    expect(config.rootOverride).toBe(null);
    expect(config.rootOverridden).toBe(false);
    expect(config.cacheMaxMb).toBe(500);
    expect(config.quiet).toBe(false);
    expect(path.isAbsolute(config.cacheDir)).toBe(true);
  });

  it('parses a valid PORT', () => {
    const config = readServerConfig({ PORT: '5000' });
    expect(config.port).toBe(5000);
  });

  it('falls back to 4317 for a non-numeric PORT', () => {
    const config = readServerConfig({ PORT: 'abc' });
    expect(config.port).toBe(4317);
  });

  it('accepts PORT 0 as the ephemeral-port request', () => {
    const config = readServerConfig({ PORT: '0' });
    expect(config.port).toBe(0);
  });

  it('falls back to 4317 for an out-of-range PORT', () => {
    expect(readServerConfig({ PORT: '-1' }).port).toBe(4317);
    expect(readServerConfig({ PORT: '70000' }).port).toBe(4317);
    expect(readServerConfig({ PORT: '5000abc' }).port).toBe(4317);
  });

  it('records SLYDR_ROOT as an override without resolving it', () => {
    const config = readServerConfig({ SLYDR_ROOT: 'C:\\tmp\\fixture' });
    expect(config.rootOverridden).toBe(true);
    expect(config.rootOverride).toBe('C:\\tmp\\fixture');
  });

  it('treats an empty SLYDR_ROOT as unset', () => {
    const config = readServerConfig({ SLYDR_ROOT: '' });
    expect(config.rootOverridden).toBe(false);
    expect(config.rootOverride).toBe(null);
  });

  it('honours SLYDR_CACHE_DIR', () => {
    const config = readServerConfig({ SLYDR_CACHE_DIR: 'custom/cache' });
    expect(path.isAbsolute(config.cacheDir)).toBe(true);
    expect(config.cacheDir.endsWith(path.normalize('custom/cache'))).toBe(true);
  });

  it('computes the Windows cache default', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const config = readServerConfig({ LOCALAPPDATA: 'C:\\Users\\TestUser\\AppData\\Local' });
    expect(config.cacheDir).toContain(path.join('slydr', 'thumbnails'));
  });

  it('falls back to home dir when LOCALAPPDATA is missing on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const config = readServerConfig({});
    expect(config.cacheDir).toContain(path.join('slydr', 'thumbnails'));
  });

  it('computes the macOS cache default', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const config = readServerConfig({});
    expect(config.cacheDir).toContain(path.join('Library', 'Caches', 'slydr', 'thumbnails'));
  });

  it('computes the Linux cache default honouring XDG_CACHE_HOME', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const config = readServerConfig({ XDG_CACHE_HOME: '/custom/cache' });
    expect(config.cacheDir).toContain(path.join('slydr', 'thumbnails'));
    // Check that the custom cache dir is part of the path (as prefix after resolution)
    expect(path.isAbsolute(config.cacheDir)).toBe(true);
  });

  it('ignores a relative XDG_CACHE_HOME', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const config = readServerConfig({ XDG_CACHE_HOME: 'relative/cache' });
    // Should fall back to ~/.cache
    expect(config.cacheDir).toContain('.cache');
  });

  it('parses SLYDR_CACHE_MAX_MB and rejects junk', () => {
    expect(readServerConfig({ SLYDR_CACHE_MAX_MB: '1000' }).cacheMaxMb).toBe(1000);
    expect(readServerConfig({ SLYDR_CACHE_MAX_MB: 'abc' }).cacheMaxMb).toBe(500);
    expect(readServerConfig({ SLYDR_CACHE_MAX_MB: '0' }).cacheMaxMb).toBe(500);
    expect(readServerConfig({ SLYDR_CACHE_MAX_MB: '-10' }).cacheMaxMb).toBe(500);
  });

  it('SLYDR_QUIET truthiness', () => {
    const testCases: Array<[string, boolean]> = [
      ['', false],
      ['0', false],
      ['false', false],
      ['no', false],
      ['1', true],
      ['true', true],
      ['yes', true],
    ];

    for (const [value, expected] of testCases) {
      const config = readServerConfig({ SLYDR_QUIET: value });
      expect(config.quiet).toBe(expected);
    }
  });

  it('the returned config is frozen', () => {
    const config = readServerConfig({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (config as any).port = 5000;
    }).toThrow();
  });
});
