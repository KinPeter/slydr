import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../../../src/components/ThemeToggle/ThemeToggle';
import { THEME_STORAGE_KEY } from '../../../src/state/theme';
import { DARK_QUERY, installMatchMedia } from '../../helpers/matchMedia';
import type { MatchMediaController } from '../../helpers/matchMedia';

let controller: MatchMediaController | null = null;

function setup(osDark: boolean, stored: 'light' | 'dark' | null = null): void {
  controller = installMatchMedia({ [DARK_QUERY]: osDark });
  window.localStorage.clear();
  if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
  document.documentElement.removeAttribute('data-theme');
}

afterEach(() => {
  controller?.dispose();
  controller = null;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('ThemeToggle', () => {
  it('renders a button labelled "Switch to dark theme" when the effective theme is light', () => {
    setup(false);
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to dark theme' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders a button labelled "Switch to light theme" when the effective theme is dark', () => {
    setup(true);
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to light theme' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders the moon icon in light mode and the sun icon in dark mode', () => {
    setup(false);
    const { unmount } = render(<ThemeToggle />);
    expect(document.querySelector('svg.lucide-moon')).not.toBeNull();
    expect(document.querySelector('svg.lucide-sun')).toBeNull();
    unmount();

    setup(true);
    render(<ThemeToggle />);
    expect(document.querySelector('svg.lucide-sun')).not.toBeNull();
    expect(document.querySelector('svg.lucide-moon')).toBeNull();
  });

  it('marks the icon aria-hidden so the button is announced once', () => {
    setup(false);
    render(<ThemeToggle />);
    const icon = document.querySelector('button svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('updates its own label after being clicked', async () => {
    setup(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('sets data-theme="dark" on <html> when clicked from the light theme', async () => {
    setup(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('sets data-theme="light" on <html> when clicked from the dark theme', async () => {
    setup(true);
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('is reachable by Tab and activates on Enter and on Space', async () => {
    setup(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.tab();
    const button = screen.getByRole('button');
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('exposes an accessible name via aria-label with no visible text content', () => {
    setup(false);
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to dark theme' });
    expect(button).toHaveAttribute('aria-label', 'Switch to dark theme');
    expect(button.textContent).toBe('');
  });
});
