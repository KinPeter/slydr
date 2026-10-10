import { X } from 'lucide-react';
import type React from 'react';
import { cx } from '../../lib/cx';
import { Icon } from '../Icon/Icon';
import type { IconComponent } from '../Icon/Icon';
import styles from './Chip.module.css';

export interface ChipProps extends Omit<
  React.ComponentPropsWithoutRef<'span'>,
  'children' | 'onClick'
> {
  children: React.ReactNode;
  /** Optional leading decorative icon. */
  icon?: IconComponent;
  /** Visual tone. Default 'neutral'. */
  tone?: 'neutral' | 'accent';
  /**
   * When provided, a dismiss button is rendered. Its accessible name is
   * `${dismissLabel ?? 'Remove'}`; pass a specific label such as "Remove filter".
   */
  onDismiss?: () => void;
  dismissLabel?: string; // default "Remove"
}

/**
 * Small informational pill (e.g. the explorer's image-count chip).
 *
 * Accessibility contract: a static chip is a plain `<span>` with no role and no
 * tab stop — it is information, not a control, and announces nothing by itself.
 * With `onDismiss` the dismiss `<button>` carries the accessible name and the
 * full 44px target (via an extended `::before` hit area, so the visible pill
 * keeps its size); the chip itself never becomes interactive.
 */
export function Chip({
  children,
  icon,
  tone = 'neutral',
  onDismiss,
  dismissLabel = 'Remove',
  className,
  ...rest
}: ChipProps) {
  return (
    <span className={cx(styles.chip, tone === 'accent' && styles.accent, className)} {...rest}>
      {icon !== undefined && <Icon icon={icon} size={14} />}
      <span className={styles.content}>{children}</span>
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className={cx(styles.dismiss, 'focus-ring-inset')}
        >
          <X size={14} strokeWidth={2.5} aria-hidden="true" focusable="false" />
        </button>
      )}
    </span>
  );
}
