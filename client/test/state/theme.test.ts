import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  clearStoredTheme,
  DARK_MEDIA_QUERY,
  prefersDark,
  readStoredTheme,
  resolveEffectiveTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme,
} from '../../src/state/theme';
import { DARK_QUERY, installMatchMedia } from '../helpers/matchMedia';

let matchMediaController: ReturnType<typeof installMatchMedia> | null = null;

afterEach(() => {
  matchMediaController?.dispose();
  matchMediaController = null;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('readStoredTheme', () => {
  it('returns "light" when slydr.theme is "light"', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readStoredTheme()).toBe('light');
  });

  it('returns "dark" when slydr.theme is "dark"', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('returns null when slydr.theme is absent', () => {
    expect(readStoredTheme()).toBeNull();
  });

  it('returns null when slydr.theme holds an unrecognised value such as "midnight"', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'midnight');
    expect(readStoredTheme()).toBeNull();
  });

  it('returns null when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readStoredTheme()).toBeNull();
  });
});

describe('writeStoredTheme / clearStoredTheme', () => {
  it('writes the value under the exact key "slydr.theme"', () => {
    writeStoredTheme('dark');
    expect(THEME_STORAGE_KEY).toBe('slydr.theme');
    expect(window.localStorage.getItem('slydr.theme')).toBe('dark');
  });

  it('removes the key so the OS regains control', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    clearStoredTheme();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readStoredTheme()).toBeNull();
  });

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => writeStoredTheme('dark')).not.toThrow();
  });

  it('does not throw when localStorage.removeItem throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => clearStoredTheme()).not.toThrow();
  });
});

describe('prefersDark', () => {
  it('returns true when the dark media query matches', () => {
    matchMediaController = installMatchMedia({ [DARK_QUERY]: true });
    expect(DARK_MEDIA_QUERY).toBe(DARK_QUERY);
    expect(prefersDark()).toBe(true);
  });

  it('returns false when the dark media query does not match', () => {
    matchMediaController = installMatchMedia({ [DARK_QUERY]: false });
    expect(prefersDark()).toBe(false);
  });

  it('returns false when window.matchMedia is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    delete (window as { matchMedia?: unknown }).matchMedia;
    try {
      expect(prefersDark()).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
    }
  });
});

describe('resolveEffectiveTheme', () => {
  it('returns the stored override when one is present, ignoring the OS value', () => {
    expect(resolveEffectiveTheme('light', true)).toBe('light');
    expect(resolveEffectiveTheme('dark', false)).toBe('dark');
  });

  it('returns "dark" when there is no override and the OS prefers dark', () => {
    expect(resolveEffectiveTheme(null, true)).toBe('dark');
  });

  it('returns "light" when there is no override and the OS prefers light', () => {
    expect(resolveEffectiveTheme(null, false)).toBe('light');
  });
});

describe('applyTheme', () => {
  it('sets data-theme="dark" on <html> for an explicit dark override', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sets data-theme="light" on <html> for an explicit light override', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('removes the data-theme attribute entirely when the override is null', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    applyTheme(null);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('is idempotent when called twice with the same value', () => {
    applyTheme('dark');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme(null);
    applyTheme(null);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
