import type React from 'react';
import { cx } from '../../lib/cx';
import styles from './Spinner.module.css';

export interface SpinnerProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'children'> {
  /** CSS length, e.g. "1.25rem" or "1em". Default "1.25rem". */
  size?: string;
  /**
   * Accessible name. When provided the spinner is exposed as role="status"
   * with this text; when omitted it is decorative (aria-hidden) and the
   * surrounding UI must announce the busy state itself.
   */
  label?: string;
}

/**
 * Indeterminate activity indicator.
 *
 * Accessibility contract: without `label` the SVG is `aria-hidden` and silent
 * (the surrounding control, e.g. a `loading` Button's `aria-busy`, owns the
 * announcement). With `label` it is wrapped in `role="status"` with visually
 * hidden text. Colour is `currentColor`, so it follows its context.
 */
export function Spinner({ size = '1.25rem', label, className, ...rest }: SpinnerProps) {
  const svg = (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cx(styles.svg, className)}
      {...rest}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );

  if (label === undefined) return svg;

  return (
    <span role="status" className={styles.status}>
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
