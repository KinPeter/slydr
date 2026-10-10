import { DEFAULT_CONFIG, type SlideshowConfig } from '@slydr/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageModule from '../../src/state/storage';
import {
  clearLastPath,
  clearTheme,
  flushWrites,
  isPlausibleWirePath,
  parseLastPath,
  parseShowHidden,
  parseStoredConfig,
  parseTheme,
  parseViewMode,
  readConfig,
  readExplorerPrefs,
  readTheme,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  WRITE_DEBOUNCE_MS,
  writeConfig,
  writeExplorerPrefs,
  writeTheme,
} from '../../src/state/storage';
import { installMockStorage, type MockStorageOptions } from '../helpers/storageMock';

let mock: ReturnType<typeof installMockStorage> | null = null;

function activeMock(): ReturnType<typeof installMockStorage> {
  if (mock === null) throw new Error('test setup: mock storage is not installed');
  return mock;
}

function reinstall(options?: MockStorageOptions): ReturnType<typeof installMockStorage> {
  mock?.dispose();
  mock = installMockStorage(options);
  return mock;
}

beforeEach(() => {
  mock = installMockStorage();
});

afterEach(() => {
  mock?.dispose();
  mock = null;
  vi.useRealTimers();
});

function setItemCallsFor(key: string): Array<readonly [string, string]> {
  return activeMock()
    .setItem.mock.calls.filter((call) => call[0] === key)
    .map((call) => [call[0] as string, call[1] as string] as const);
}

function setVisibilityState(state: 'hidden' | 'visible'): () => void {
  const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  return () => {
    if (original !== undefined) Object.defineProperty(document, 'visibilityState', original);
    else delete (document as unknown as Record<string, unknown>)['visibilityState'];
  };
}

function validConfig(): SlideshowConfig {
  return { ...DEFAULT_CONFIG };
}

describe('key table and constants', () => {
  it('exports exactly the six spec §6.2 key strings', () => {
    expect(STORAGE_KEYS).toEqual({
      schemaVersion: 'slydr.schemaVersion',
      theme: 'slydr.theme',
      viewMode: 'slydr.explorer.viewMode',
      showHidden: 'slydr.explorer.showHidden',
      lastPath: 'slydr.explorer.lastPath',
      config: 'slydr.config',
    });
  });

  it('exports SCHEMA_VERSION 1 and WRITE_DEBOUNCE_MS 250', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(WRITE_DEBOUNCE_MS).toBe(250);
  });

  it('exports no usePersisted, readRaw, scheduleWrite or PersistedKey', () => {
    expect('usePersisted' in storageModule).toBe(false);
    expect('readRaw' in storageModule).toBe(false);
    expect('scheduleWrite' in storageModule).toBe(false);
    expect('PersistedKey' in storageModule).toBe(false);
  });
});

describe('parsers', () => {
  it('parseTheme accepts "light" and "dark" and rejects "Dark", "midnight", "" and null', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('Dark')).toBeNull();
    expect(parseTheme('midnight')).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it('parseViewMode returns "grid" only for the exact string and "list" otherwise', () => {
    expect(parseViewMode('grid')).toBe('grid');
    expect(parseViewMode('list')).toBe('list');
    expect(parseViewMode('Grid')).toBe('list');
    expect(parseViewMode('table')).toBe('list');
    expect(parseViewMode('')).toBe('list');
    expect(parseViewMode(null)).toBe('list');
  });

  it('parseShowHidden returns true only for the exact string "true"', () => {
    expect(parseShowHidden('true')).toBe(true);
    expect(parseShowHidden('false')).toBe(false);
    expect(parseShowHidden('TRUE')).toBe(false);
    expect(parseShowHidden('1')).toBe(false);
    expect(parseShowHidden('')).toBe(false);
    expect(parseShowHidden(null)).toBe(false);
  });

  it('parseLastPath accepts "" and "Pictures/2024"', () => {
    expect(parseLastPath('')).toBe('');
    expect(parseLastPath('Pictures/2024')).toBe('Pictures/2024');
  });

  it('parseLastPath rejects a NUL byte', () => {
    expect(parseLastPath('a\0b')).toBe('');
    expect(isPlausibleWirePath('a\0b')).toBe(false);
  });

  it('parseLastPath rejects a path longer than 4096 characters and accepts one of exactly 4096', () => {
    expect(parseLastPath('a'.repeat(4097))).toBe('');
    expect(parseLastPath('a'.repeat(4096))).toBe('a'.repeat(4096));
  });

  it('parseLastPath rejects "/etc", "C:\\Users", "C:foo" and "\\\\server\\share"', () => {
    expect(parseLastPath('/etc')).toBe('');
    expect(parseLastPath('C:\\Users')).toBe('');
    expect(parseLastPath('C:foo')).toBe('');
    expect(parseLastPath('\\\\server\\share')).toBe('');
  });

  it('parseLastPath rejects "a/../b" and "..", but accepts a segment named "..a" or "a..b"', () => {
    expect(parseLastPath('a/../b')).toBe('');
    expect(parseLastPath('..')).toBe('');
    expect(parseLastPath('../a')).toBe('');
    expect(parseLastPath('..a')).toBe('..a');
    expect(parseLastPath('a..b')).toBe('a..b');
  });

  it('accepts a leading single backslash but rejects a UNC prefix', () => {
    expect(isPlausibleWirePath('\\foo')).toBe(true);
    expect(parseLastPath('\\foo')).toBe('\\foo');
    expect(isPlausibleWirePath('\\\\server\\share')).toBe(false);
    expect(parseLastPath('\\\\server\\share')).toBe('');
  });

  it('parseStoredConfig returns defaults for null, malformed JSON and a JSON null', () => {
    expect(parseStoredConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseStoredConfig('not json{{{')).toEqual(DEFAULT_CONFIG);
    expect(parseStoredConfig('null')).toEqual(DEFAULT_CONFIG);
    expect(parseStoredConfig('"just a string"')).toEqual(DEFAULT_CONFIG);
    expect(parseStoredConfig('[1,2,3]')).toEqual(DEFAULT_CONFIG);
  });

  it('parseStoredConfig returns a fresh object, not the DEFAULT_CONFIG reference', () => {
    const parsed = parseStoredConfig(null);
    expect(parsed).toEqual(DEFAULT_CONFIG);
    expect(parsed).not.toBe(DEFAULT_CONFIG);
    parsed.durationSeconds = 1;
    expect(DEFAULT_CONFIG.durationSeconds).toBe(5);
    expect(parseStoredConfig(null)).toEqual(DEFAULT_CONFIG);
  });
});

describe('config clamping through parseConfig', () => {
  it('clamps durationSeconds 999 to 30 and 0 to 1', () => {
    expect(parseStoredConfig('{"durationSeconds":999}').durationSeconds).toBe(30);
    expect(parseStoredConfig('{"durationSeconds":0}').durationSeconds).toBe(1);
  });

  it('rounds a fractional durationSeconds to an integer', () => {
    expect(parseStoredConfig('{"durationSeconds":4.4}').durationSeconds).toBe(4);
    expect(parseStoredConfig('{"durationSeconds":4.6}').durationSeconds).toBe(5);
  });

  it('replaces non-boolean flags with their defaults, field by field', () => {
    const parsed = parseStoredConfig(
      '{"durationSeconds":5,"shuffle":"yes","loop":1,"animations":null,' +
        '"fillEmptySpace":"true","startFullScreen":0,"includeSubfolders":"no"}',
    );
    expect(parsed).toEqual(DEFAULT_CONFIG);
  });

  it('keeps valid fields when only one field is invalid', () => {
    const parsed = parseStoredConfig('{"durationSeconds":999,"shuffle":"yes"}');
    expect(parsed.durationSeconds).toBe(30);
    expect(parsed.shuffle).toBe(DEFAULT_CONFIG.shuffle);
    expect(parsed.loop).toBe(DEFAULT_CONFIG.loop);
    const kept = parseStoredConfig('{"durationSeconds":7,"shuffle":false}');
    expect(kept.durationSeconds).toBe(7);
    expect(kept.shuffle).toBe(false);
  });

  it('writeConfig never persists an out-of-range duration', () => {
    vi.useFakeTimers();
    writeConfig({ ...validConfig(), durationSeconds: 999 });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    const stored = activeMock().store.get(STORAGE_KEYS.config);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored as string).durationSeconds).toBe(30);
  });
});

describe('reads', () => {
  it('returns every default from an empty storage', () => {
    expect(readTheme()).toBeNull();
    expect(readExplorerPrefs()).toEqual({ viewMode: 'list', showHidden: false, lastPath: '' });
    expect(readConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('reads each key written in valid form', () => {
    const store = activeMock().store;
    store.set(STORAGE_KEYS.theme, 'dark');
    store.set(STORAGE_KEYS.viewMode, 'grid');
    store.set(STORAGE_KEYS.showHidden, 'true');
    store.set(STORAGE_KEYS.lastPath, 'Pictures/2024');
    store.set(STORAGE_KEYS.config, JSON.stringify({ ...validConfig(), durationSeconds: 7 }));
    expect(readTheme()).toBe('dark');
    expect(readExplorerPrefs()).toEqual({
      viewMode: 'grid',
      showHidden: true,
      lastPath: 'Pictures/2024',
    });
    expect(readConfig()).toEqual({ ...validConfig(), durationSeconds: 7 });
  });

  it('returns the default for each key holding an invalid value', () => {
    const store = activeMock().store;
    store.set(STORAGE_KEYS.theme, 'midnight');
    store.set(STORAGE_KEYS.viewMode, 'table');
    store.set(STORAGE_KEYS.showHidden, 'yes');
    store.set(STORAGE_KEYS.lastPath, '/etc');
    store.set(STORAGE_KEYS.config, '{"durationSeconds":999,"shuffle":"yes"}');
    expect(readTheme()).toBeNull();
    expect(readExplorerPrefs()).toEqual({ viewMode: 'list', showHidden: false, lastPath: '' });
    const config = readConfig();
    expect(config.durationSeconds).toBe(30);
    expect(config.shuffle).toBe(DEFAULT_CONFIG.shuffle);
  });

  it('never writes to storage during a read', () => {
    readTheme();
    readExplorerPrefs();
    readConfig();
    expect(activeMock().setItem).not.toHaveBeenCalled();
    expect(activeMock().removeItem).not.toHaveBeenCalled();
  });
});

describe('storage failures', () => {
  it('survives window.localStorage throwing on access, for every read and write function', () => {
    reinstall({ throwOnAccess: true });
    expect(() => {
      readTheme();
      readExplorerPrefs();
      readConfig();
      writeTheme('dark');
      clearTheme();
      writeExplorerPrefs({ viewMode: 'grid', showHidden: true, lastPath: 'a/b' });
      writeConfig(validConfig());
      clearLastPath();
      flushWrites();
    }).not.toThrow();
  });

  it('survives getItem throwing', () => {
    reinstall({ throwOnGet: true });
    expect(readTheme()).toBeNull();
    expect(readExplorerPrefs()).toEqual({ viewMode: 'list', showHidden: false, lastPath: '' });
    expect(readConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('survives setItem throwing a SecurityError', () => {
    reinstall({ throwOnSet: true });
    vi.useFakeTimers();
    expect(() => {
      writeTheme('dark');
      writeExplorerPrefs({ viewMode: 'grid' });
      writeConfig(validConfig());
      vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
      flushWrites();
    }).not.toThrow();
  });

  it('survives setItem throwing QuotaExceededError and keeps the value for the session', () => {
    reinstall({ quotaOnSet: true });
    expect(() => writeTheme('dark')).not.toThrow();
    expect(readTheme()).toBe('dark');
  });

  it('survives removeItem throwing in clearLastPath and clearTheme', () => {
    reinstall({ throwOnRemove: true });
    expect(() => {
      clearLastPath();
      clearTheme();
    }).not.toThrow();
  });

  it('returns the written value on the next read when storage is unavailable', () => {
    reinstall({ throwOnAccess: true });
    writeTheme('dark');
    expect(readTheme()).toBe('dark');
    writeExplorerPrefs({ viewMode: 'grid', showHidden: true, lastPath: 'a/b' });
    expect(readExplorerPrefs()).toEqual({ viewMode: 'grid', showHidden: true, lastPath: 'a/b' });
    const config = { ...validConfig(), durationSeconds: 9 };
    writeConfig(config);
    flushWrites();
    expect(readExplorerPrefs()).toEqual({ viewMode: 'grid', showHidden: true, lastPath: 'a/b' });
    expect(readConfig()).toEqual(config);
    expect(readTheme()).toBe('dark');
  });

  it('logs nothing to console.error, console.warn or console.log in any failure case', () => {
    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');
    const logSpy = vi.spyOn(console, 'log');
    const cases: MockStorageOptions[] = [
      { throwOnAccess: true },
      { throwOnGet: true },
      { throwOnSet: true },
      { throwOnRemove: true },
      { quotaOnSet: true },
    ];
    for (const options of cases) {
      reinstall(options);
      readTheme();
      readExplorerPrefs();
      readConfig();
      writeTheme('dark');
      clearTheme();
      writeExplorerPrefs({ viewMode: 'grid', showHidden: true, lastPath: 'a/b' });
      writeConfig(validConfig());
      clearLastPath();
      flushWrites();
    }
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('retries persisting after storage becomes available again on the next write', () => {
    reinstall({ throwOnSet: true });
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/b' });
    flushWrites();
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toHaveLength(0);
    reinstall();
    writeExplorerPrefs({ lastPath: 'a/c' });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toEqual([[STORAGE_KEYS.lastPath, 'a/c']]);
    expect(readExplorerPrefs().lastPath).toBe('a/c');
  });
});

describe('schema version', () => {
  it('stamps slydr.schemaVersion as "1" on the first debounced write', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ showHidden: true });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(activeMock().store.get(STORAGE_KEYS.schemaVersion)).toBe('1');
  });

  it('does not stamp the version when only the theme is written', () => {
    writeTheme('dark');
    expect(setItemCallsFor(STORAGE_KEYS.theme)).toEqual([[STORAGE_KEYS.theme, 'dark']]);
    expect(activeMock().store.has(STORAGE_KEYS.schemaVersion)).toBe(false);
    clearTheme();
    expect(activeMock().store.has(STORAGE_KEYS.schemaVersion)).toBe(false);
  });

  it('treats an absent version as compatible', () => {
    const store = activeMock().store;
    store.set(STORAGE_KEYS.viewMode, 'grid');
    store.set(STORAGE_KEYS.showHidden, 'true');
    store.set(STORAGE_KEYS.lastPath, 'a/b');
    store.set(STORAGE_KEYS.theme, 'dark');
    expect(readExplorerPrefs()).toEqual({ viewMode: 'grid', showHidden: true, lastPath: 'a/b' });
    expect(readTheme()).toBe('dark');
  });

  it('reads defaults for every key except the theme when the version is "2"', () => {
    const store = activeMock().store;
    store.set(STORAGE_KEYS.schemaVersion, '2');
    store.set(STORAGE_KEYS.theme, 'dark');
    store.set(STORAGE_KEYS.viewMode, 'grid');
    store.set(STORAGE_KEYS.showHidden, 'true');
    store.set(STORAGE_KEYS.lastPath, 'a/b');
    store.set(STORAGE_KEYS.config, JSON.stringify({ ...validConfig(), durationSeconds: 7 }));
    expect(readTheme()).toBe('dark');
    expect(readExplorerPrefs()).toEqual({ viewMode: 'list', showHidden: false, lastPath: '' });
    expect(readConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('reads defaults when the version is a non-numeric string', () => {
    const store = activeMock().store;
    store.set(STORAGE_KEYS.schemaVersion, 'banana');
    store.set(STORAGE_KEYS.viewMode, 'grid');
    store.set(STORAGE_KEYS.theme, 'light');
    expect(readExplorerPrefs().viewMode).toBe('list');
    expect(readTheme()).toBe('light');
  });

  it('does not modify storage when reading under a mismatch', () => {
    const store = activeMock().store;
    store.set(STORAGE_KEYS.schemaVersion, '2');
    store.set(STORAGE_KEYS.theme, 'dark');
    store.set(STORAGE_KEYS.viewMode, 'grid');
    const before = new Map(store);
    readTheme();
    readExplorerPrefs();
    readConfig();
    expect(new Map(store)).toEqual(before);
    expect(activeMock().setItem).not.toHaveBeenCalled();
    expect(activeMock().removeItem).not.toHaveBeenCalled();
  });

  it('removes stale slydr.* keys other than the theme and rewrites the version on the next write', () => {
    vi.useFakeTimers();
    const store = activeMock().store;
    store.set(STORAGE_KEYS.schemaVersion, '2');
    store.set(STORAGE_KEYS.theme, 'dark');
    store.set(STORAGE_KEYS.viewMode, 'grid');
    store.set(STORAGE_KEYS.showHidden, 'true');
    store.set(STORAGE_KEYS.lastPath, 'a/b');
    store.set(STORAGE_KEYS.config, JSON.stringify(validConfig()));
    store.set('slydr.future', 'stale');
    store.set('other.key', 'keep');
    writeExplorerPrefs({ showHidden: false });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(store.get(STORAGE_KEYS.schemaVersion)).toBe('1');
    expect(store.get(STORAGE_KEYS.theme)).toBe('dark');
    expect(store.get(STORAGE_KEYS.showHidden)).toBe('false');
    expect(store.has(STORAGE_KEYS.viewMode)).toBe(false);
    expect(store.has(STORAGE_KEYS.lastPath)).toBe(false);
    expect(store.has(STORAGE_KEYS.config)).toBe(false);
    expect(store.has('slydr.future')).toBe(false);
  });

  it('leaves non-slydr keys untouched during the purge', () => {
    vi.useFakeTimers();
    const store = activeMock().store;
    store.set(STORAGE_KEYS.schemaVersion, '2');
    store.set('other.key', 'keep');
    store.set('unrelated', 'also keep');
    writeExplorerPrefs({ showHidden: true });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(store.get('other.key')).toBe('keep');
    expect(store.get('unrelated')).toBe('also keep');
  });
});

describe('debounced writer', () => {
  it('does not write before 250 ms have elapsed', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/b' });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS - 1);
    expect(activeMock().setItem).not.toHaveBeenCalled();
  });

  it('writes once at 250 ms', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/b' });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toEqual([[STORAGE_KEYS.lastPath, 'a/b']]);
  });

  it('coalesces five rapid writes of one key into one setItem with the last value', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i += 1) writeExplorerPrefs({ lastPath: `a/${i}` });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toEqual([[STORAGE_KEYS.lastPath, 'a/4']]);
  });

  it('restarts the 250 ms window on each write', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/1' });
    vi.advanceTimersByTime(200);
    writeExplorerPrefs({ lastPath: 'a/2' });
    vi.advanceTimersByTime(200);
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toEqual([[STORAGE_KEYS.lastPath, 'a/2']]);
  });

  it('debounces keys independently', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/b' });
    writeExplorerPrefs({ viewMode: 'grid' });
    writeExplorerPrefs({ showHidden: true });
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toEqual([[STORAGE_KEYS.lastPath, 'a/b']]);
    expect(setItemCallsFor(STORAGE_KEYS.viewMode)).toEqual([[STORAGE_KEYS.viewMode, 'grid']]);
    expect(setItemCallsFor(STORAGE_KEYS.showHidden)).toEqual([[STORAGE_KEYS.showHidden, 'true']]);
  });

  it('serves a pending value to readers before it is committed', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/pending', viewMode: 'grid' });
    expect(readExplorerPrefs().lastPath).toBe('a/pending');
    expect(readExplorerPrefs().viewMode).toBe('grid');
    expect(activeMock().setItem).not.toHaveBeenCalled();
  });

  it('flushes pending writes on pagehide', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'Pictures/2024' });
    expect(activeMock().setItem).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toEqual([
      [STORAGE_KEYS.lastPath, 'Pictures/2024'],
    ]);
  });

  it('flushes pending writes on visibilitychange when hidden', () => {
    vi.useFakeTimers();
    const restore = setVisibilityState('hidden');
    try {
      writeExplorerPrefs({ viewMode: 'grid' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(setItemCallsFor(STORAGE_KEYS.viewMode)).toEqual([[STORAGE_KEYS.viewMode, 'grid']]);
    } finally {
      restore();
    }
  });

  it('does not flush on visibilitychange when visible', () => {
    vi.useFakeTimers();
    const restore = setVisibilityState('visible');
    try {
      writeExplorerPrefs({ viewMode: 'grid' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(activeMock().setItem).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('does not write twice after a flush when the timer would later have fired', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/b' });
    window.dispatchEvent(new Event('pagehide'));
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toHaveLength(1);
  });

  it('flushWrites is a no-op with nothing pending', () => {
    expect(() => flushWrites()).not.toThrow();
    expect(activeMock().setItem).not.toHaveBeenCalled();
    expect(activeMock().removeItem).not.toHaveBeenCalled();
  });

  it('installs the page lifecycle listeners only once', () => {
    vi.useFakeTimers();
    const windowSpy = vi.spyOn(window, 'addEventListener');
    const documentSpy = vi.spyOn(document, 'addEventListener');
    writeExplorerPrefs({ lastPath: 'a' });
    writeExplorerPrefs({ viewMode: 'grid' });
    writeConfig(validConfig());
    expect(windowSpy.mock.calls.filter((call) => call[0] === 'pagehide')).toHaveLength(1);
    expect(documentSpy.mock.calls.filter((call) => call[0] === 'visibilitychange')).toHaveLength(1);
  });

  it('does not write an invalid lastPath', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: '/etc' });
    vi.advanceTimersByTime(10_000);
    flushWrites();
    expect(activeMock().setItem).not.toHaveBeenCalled();
    expect(readExplorerPrefs().lastPath).toBe('');
  });
});

describe('theme API', () => {
  it('writeTheme writes synchronously with no timer', () => {
    vi.useFakeTimers();
    writeTheme('dark');
    expect(setItemCallsFor(STORAGE_KEYS.theme)).toEqual([[STORAGE_KEYS.theme, 'dark']]);
    expect(readTheme()).toBe('dark');
    vi.advanceTimersByTime(10_000);
    expect(setItemCallsFor(STORAGE_KEYS.theme)).toHaveLength(1);
  });

  it('clearTheme removes the key synchronously', () => {
    activeMock().store.set(STORAGE_KEYS.theme, 'dark');
    clearTheme();
    expect(activeMock().removeItem).toHaveBeenCalledWith(STORAGE_KEYS.theme);
    expect(readTheme()).toBeNull();
  });

  it('readTheme ignores a schema version mismatch', () => {
    activeMock().store.set(STORAGE_KEYS.schemaVersion, '2');
    activeMock().store.set(STORAGE_KEYS.theme, 'dark');
    expect(readTheme()).toBe('dark');
  });
});

describe('clearLastPath', () => {
  it('removes the stored key immediately', () => {
    activeMock().store.set(STORAGE_KEYS.lastPath, 'a/b');
    clearLastPath();
    expect(activeMock().removeItem).toHaveBeenCalledWith(STORAGE_KEYS.lastPath);
    expect(activeMock().store.has(STORAGE_KEYS.lastPath)).toBe(false);
  });

  it('cancels a pending lastPath write', () => {
    vi.useFakeTimers();
    writeExplorerPrefs({ lastPath: 'a/b' });
    clearLastPath();
    vi.advanceTimersByTime(10_000);
    flushWrites();
    expect(setItemCallsFor(STORAGE_KEYS.lastPath)).toHaveLength(0);
  });

  it('makes readExplorerPrefs().lastPath return ""', () => {
    activeMock().store.set(STORAGE_KEYS.lastPath, 'a/b');
    clearLastPath();
    expect(readExplorerPrefs().lastPath).toBe('');
  });

  it('masks the stored value when removeItem throws', () => {
    reinstall({ throwOnRemove: true });
    activeMock().store.set(STORAGE_KEYS.lastPath, 'a/b');
    clearLastPath();
    expect(readExplorerPrefs().lastPath).toBe('');
  });
});
