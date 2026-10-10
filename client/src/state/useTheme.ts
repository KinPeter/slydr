import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  clearStoredTheme,
  DARK_MEDIA_QUERY,
  prefersDark,
  readStoredTheme,
  resolveEffectiveTheme,
  writeStoredTheme,
  type Theme,
} from './theme';

export interface UseThemeResult {
  /** The theme actually in effect right now. */
  theme: Theme;
  /** The stored override, or null while the OS is in control. */
  override: Theme | null;
  /** Stores an explicit override and applies it immediately. */
  setTheme: (theme: Theme) => void;
  /** Stores the opposite of the currently effective theme (spec §6.3). */
  toggleTheme: () => void;
  /** Clears the override, returning control to the OS. */
  followSystemTheme: () => void;
}

/**
 * Theme state — spec §6.3.
 *
 * - Effective theme = stored `slydr.theme` if present, else the live
 *   `matchMedia('(prefers-color-scheme: dark)')` value.
 * - OS changes apply live ONLY while no override is stored: the `change`
 *   listener is attached when `override === null` and detached as soon as an
 *   override exists. Once the user has chosen, the OS must not override them.
 */
export function useTheme(): UseThemeResult {
  const [override, setOverride] = useState<Theme | null>(() => readStoredTheme());
  const [osDark, setOsDark] = useState<boolean>(() => prefersDark());

  // Reflect the override onto <html>. The attribute mirrors the OVERRIDE, not
  // the effective theme, so that removing it hands control back to the CSS.
  useEffect(() => {
    applyTheme(override);
  }, [override]);

  // Live OS tracking, but only while unoverridden.
  useEffect(() => {
    if (override !== null) return;
    if (typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setOsDark(event.matches);
    };

    setOsDark(mql.matches); // resync in case it changed while overridden
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [override]);

  const theme = resolveEffectiveTheme(override, osDark);

  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next);
    setOverride(next);
  }, []);

  const toggleTheme = useCallback(() => {
    // Spec §6.3: the first click stores the OPPOSITE of the currently
    // EFFECTIVE theme — not the opposite of the stored value, which may be
    // absent on the first click.
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    writeStoredTheme(next);
    setOverride(next);
  }, [theme]);

  const followSystemTheme = useCallback(() => {
    clearStoredTheme();
    setOverride(null);
  }, []);

  return { theme, override, setTheme, toggleTheme, followSystemTheme };
}
