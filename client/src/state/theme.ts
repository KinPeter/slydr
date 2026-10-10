/**
 * Theme resolution primitives — spec §6.3, §6.2.
 * Keep in sync with client/public/theme-init.js, which reimplements the
 * read-and-apply step in dependency-free ES5 so it can run before first paint.
 */

export type Theme = 'light' | 'dark';

/** Spec §6.2 key table. `"light" | "dark"`; absent means follow the OS. */
export const THEME_STORAGE_KEY = 'slydr.theme';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Reads the stored override. Returns null when absent, invalid, or storage throws. */
export function readStoredTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

/** Stores an override. Silently does nothing when storage is unavailable. */
export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Storage disabled. The in-memory override still applies for this session. */
  }
}

/** Removes the override, returning control to the OS. Never throws. */
export function clearStoredTheme(): void {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* Storage disabled; nothing to remove. */
  }
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
