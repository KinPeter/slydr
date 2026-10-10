import { describe, expect, it, vi } from 'vitest';
import { openBrowser, shouldOpen } from '../src/openBrowser.js';

describe('openBrowser', () => {
  it.each([
    ['win32', 'cmd', ['/c', 'start', '', 'http://127.0.0.1:4317']],
    ['darwin', 'open', ['http://127.0.0.1:4317']],
    ['linux', 'xdg-open', ['http://127.0.0.1:4317']],
  ])('%s uses the platform opener', (platform, command, args) => {
    const on = vi.fn();
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ on, unref }));
    expect(openBrowser('http://127.0.0.1:4317', platform as NodeJS.Platform, spawn)).toBe(true);
    expect(spawn).toHaveBeenCalledWith(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(unref).toHaveBeenCalled();
  });

  it('swallows opener errors and rejects unsafe URLs', () => {
    const on = vi.fn((_event: string, callback: (error: Error) => void) =>
      callback(new Error('ENOENT')),
    );
    const spawn = vi.fn(() => ({ on, unref: vi.fn() }));
    expect(openBrowser('http://127.0.0.1:4317', 'linux', spawn)).toBe(true);
    for (const url of [
      'http://127.0.0.1:4317/&calc',
      'https://127.0.0.1:4317',
      'http://localhost:4317',
      'http://evil.example',
      '',
    ]) {
      expect(openBrowser(url, 'linux', spawn)).toBe(false);
    }
  });
});

describe('shouldOpen', () => {
  it('requires --open and honors all opt-outs', () => {
    expect(shouldOpen({ argv: ['--open'], env: {} })).toBe(true);
    expect(shouldOpen({ argv: [], env: {} })).toBe(false);
    expect(shouldOpen({ argv: ['--open', '--no-open'], env: {} })).toBe(false);
    expect(shouldOpen({ argv: ['--open'], env: { SLYDR_NO_OPEN: '1' } })).toBe(false);
    expect(shouldOpen({ argv: ['--open'], env: { NODE_ENV: 'test' } })).toBe(false);
  });
});
