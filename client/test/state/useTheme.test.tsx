import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../../src/state/theme';
import { useTheme, type UseThemeResult } from '../../src/state/useTheme';
import { DARK_QUERY, installMatchMedia } from '../helpers/matchMedia';
import type { MatchMediaController } from '../helpers/matchMedia';

let controller: MatchMediaController | null = null;
let latest: UseThemeResult | null = null;
let restoreStorage: (() => void) | null = null;

function Probe() {
  const result = useTheme();
  latest = result;
  return (
    <div>
      <span data-testid="theme">{result.theme}</span>
      <span data-testid="override">{result.override ?? 'system'}</span>
    </div>
  );
}

function setup(osDark: boolean, stored: 'light' | 'dark' | null = null): void {
  controller = installMatchMedia({ [DARK_QUERY]: osDark });
  window.localStorage.clear();
  if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
  document.documentElement.removeAttribute('data-theme');
  latest = null;
  render(<Probe />);
}

function installBrokenStorage(): void {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const throwing = {
    getItem: (): never => {
      throw new DOMException('denied', 'SecurityError');
    },
    setItem: (): never => {
      throw new DOMException('denied', 'SecurityError');
    },
    removeItem: (): never => {
      throw new DOMException('denied', 'SecurityError');
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: throwing,
  });
  restoreStorage = () => {
    if (original) Object.defineProperty(window, 'localStorage', original);
  };
}

afterEach(() => {
  controller?.dispose();
  controller = null;
  latest = null;
  restoreStorage?.();
  restoreStorage = null;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

function themeText(): string {
  return screen.getByTestId('theme').textContent ?? '';
}

describe('useTheme — stored override x OS preference (spec §12.3)', () => {
  it('no override + OS light: effective theme is light and data-theme is absent', () => {
    setup(false);
    expect(themeText()).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(latest?.override).toBeNull();
  });

  it('no override + OS dark: effective theme is dark and data-theme is absent', () => {
    setup(true);
    expect(themeText()).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(latest?.override).toBeNull();
  });

  it('stored "light" + OS dark: effective theme is light and data-theme is "light"', () => {
    setup(true, 'light');
    expect(themeText()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(latest?.override).toBe('light');
  });

  it('stored "dark" + OS light: effective theme is dark and data-theme is "dark"', () => {
    setup(false, 'dark');
    expect(themeText()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(latest?.override).toBe('dark');
  });
});

describe('useTheme — live OS changes', () => {
  it('follows an OS change from light to dark while no override is stored', () => {
    setup(false);
    expect(themeText()).toBe('light');
    act(() => {
      controller?.setMatches(DARK_QUERY, true);
    });
    expect(themeText()).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('follows an OS change from dark to light while no override is stored', () => {
    setup(true);
    expect(themeText()).toBe('dark');
    act(() => {
      controller?.setMatches(DARK_QUERY, false);
    });
    expect(themeText()).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('ignores an OS change once an override is stored', () => {
    setup(false);
    act(() => {
      latest?.setTheme('light');
    });
    expect(themeText()).toBe('light');
    act(() => {
      controller?.setMatches(DARK_QUERY, true);
    });
    expect(themeText()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('attaches no media-query listener while an override is stored', () => {
    setup(true, 'light');
    expect(controller?.listenerCount(DARK_QUERY)).toBe(0);
  });

  it('detaches the media-query listener on unmount', () => {
    controller = installMatchMedia({ [DARK_QUERY]: false });
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    const { unmount } = render(<Probe />);
    expect(controller.listenerCount(DARK_QUERY)).toBe(1);
    act(() => {
      unmount();
    });
    expect(controller.listenerCount(DARK_QUERY)).toBe(0);
  });
});

describe('useTheme — setters', () => {
  it('setTheme("dark") writes "dark" to slydr.theme and sets data-theme="dark"', () => {
    setup(false);
    act(() => {
      latest?.setTheme('dark');
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(themeText()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggleTheme stores "dark" when the effective theme is light with no override', () => {
    setup(false);
    act(() => {
      latest?.toggleTheme();
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(themeText()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggleTheme stores "light" when the effective theme is dark with no override', () => {
    setup(true);
    act(() => {
      latest?.toggleTheme();
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(themeText()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggleTheme stores the opposite of the effective theme, not of the stored value', () => {
    // Stored "light" on a dark OS: effective theme is light, so toggling must
    // store "dark" — the opposite of what is stored is "dark" here too, so use
    // the mirror case: stored "dark" on a light OS means effective dark.
    setup(true, 'light');
    expect(themeText()).toBe('light');
    act(() => {
      latest?.toggleTheme();
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(themeText()).toBe('dark');
  });

  it('followSystemTheme removes slydr.theme and removes the data-theme attribute', () => {
    setup(true, 'light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    act(() => {
      latest?.followSystemTheme();
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(latest?.override).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('followSystemTheme restores live OS tracking afterwards', () => {
    setup(true, 'light');
    act(() => {
      latest?.followSystemTheme();
    });
    expect(themeText()).toBe('dark');
    expect(controller?.listenerCount(DARK_QUERY)).toBe(1);
    act(() => {
      controller?.setMatches(DARK_QUERY, false);
    });
    expect(themeText()).toBe('light');
  });
});

describe('useTheme — localStorage disabled (spec §6.2, §12.3)', () => {
  it('falls back to the OS preference when getItem throws', () => {
    installBrokenStorage();
    controller = installMatchMedia({ [DARK_QUERY]: true });
    document.documentElement.removeAttribute('data-theme');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Probe />);
    expect(themeText()).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still toggles the effective theme for the session when setItem throws', () => {
    installBrokenStorage();
    controller = installMatchMedia({ [DARK_QUERY]: false });
    document.documentElement.removeAttribute('data-theme');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Probe />);
    expect(themeText()).toBe('light');
    act(() => {
      latest?.toggleTheme();
    });
    expect(themeText()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs no error and surfaces no error state when storage is unavailable', () => {
    installBrokenStorage();
    controller = installMatchMedia({ [DARK_QUERY]: false });
    document.documentElement.removeAttribute('data-theme');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Probe />);
    act(() => {
      latest?.setTheme('dark');
    });
    act(() => {
      latest?.followSystemTheme();
    });
    expect(themeText()).toBe('light');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
