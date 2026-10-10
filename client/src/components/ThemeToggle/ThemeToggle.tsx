import { Moon, Sun } from 'lucide-react';
import { cx } from '../../lib/cx';
import { useTheme } from '../../state/useTheme';
import styles from './ThemeToggle.module.css';

export interface ThemeToggleProps {
  className?: string;
}

/**
 * Two-state theme toggle — spec §6.3.
 *
 * Sits top-right on the explorer and configuration screens only. It must
 * NEVER be rendered in the player: the player is a presentation surface with
 * its own bottom-centre controls overlay (§9.5) and no chrome of its own.
 *
 * The first click stores the opposite of the currently EFFECTIVE theme, so it
 * behaves predictably whether or not an override already exists.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const goingDark = theme === 'light';

  return (
    <button
      type="button"
      className={cx(styles.toggle, className)}
      onClick={toggleTheme}
      aria-label={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}
      title={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}
      data-theme-state={theme}
    >
      {goingDark ? (
        <Moon aria-hidden="true" focusable="false" size={20} strokeWidth={2} />
      ) : (
        <Sun aria-hidden="true" focusable="false" size={20} strokeWidth={2} />
      )}
    </button>
  );
}
