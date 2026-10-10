/**
 * Theme resolution primitives — spec §6.3, §6.2.
 * Keep in sync with client/public/theme-init.js, which reimplements the
 * read-and-apply step in dependency-free ES5 so it can run before first paint.
 *
 * Storage ownership: `state/storage.ts` owns the `slydr.theme` key, its
 * string format and its validation (and the theme-init script above reads the
 * same key raw); this module owns resolution and application and delegates
 * storage to it.
 */

import { clearTheme, readTheme, STORAGE_KEYS, writeTheme, type Theme } from './storage';

export type { Theme };

/** Spec §6.2 key table. `"light" | "dark"`; absent means follow the OS. */
export const THEME_STORAGE_KEY = STORAGE_KEYS.theme;

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Reads the stored override. Returns null when absent, invalid, or storage throws. */
export function readStoredTheme(): Theme | null {
  return readTheme();
}

/** Stores an override. Silently does nothing when storage is unavailable. */
export function writeStoredTheme(theme: Theme): void {
  writeTheme(theme);
}

/** Removes the override, returning control to the OS. Never throws. */
export function clearStoredTheme(): void {
  clearTheme();
}

/** Current OS preference. Defaults to light when matchMedia is unavailable. */
export function prefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia(DARK_MEDIA_QUERY).matches
      : false;
  } catch {
    return false;
  }
}

/**
 * Effective theme: the stored override if present, otherwise the live OS value.
 * Spec §6.3.
 */
export function resolveEffectiveTheme(override: Theme | null, osPrefersDark: boolean): Theme {
  if (override !== null) return override;
  return osPrefersDark ? 'dark' : 'light';
}

/**
 * Applies the override to <html>. An explicit override sets data-theme;
 * `null` REMOVES the attribute so the tokens.css prefers-color-scheme block
 * regains control. Never write the resolved value when there is no override —
 * that would freeze the theme and break live OS switching.
 */
export function applyTheme(override: Theme | null): void {
  const root = document.documentElement;
  if (override === null) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', override);
  }
}
