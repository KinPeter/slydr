import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import type React from 'react';
import { cx } from '../../lib/cx';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import type { IconComponent } from '../Icon/Icon';
import { IconButton } from '../IconButton/IconButton';
import styles from './Banner.module.css';

export type BannerVariant = 'info' | 'warning' | 'error';

export interface BannerAction {
  /** Visible button text, e.g. "Retry". */
  label: string;
  onClick: () => void;
  /** Disables the button and shows a spinner, e.g. while a retry is in flight. */
  loading?: boolean;
  dataFocusTarget?: string;
}

export interface BannerProps extends Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'children' | 'role' | 'title'
> {
  variant?: BannerVariant; // default 'info'
  /** Optional bold lead-in line. */
  title?: React.ReactNode;
  /** The message. Required. */
  children: React.ReactNode;
  /** Optional single action button, e.g. { label: 'Retry', onClick }. */
  action?: BannerAction;
  /** Optional dismiss. When provided a close IconButton named "Dismiss" is rendered. */
  onDismiss?: () => void;
}

const VARIANT_ICON: Record<BannerVariant, IconComponent> = {
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
};

const VARIANT_PREFIX: Record<BannerVariant, string> = {
  info: 'Note: ',
  warning: 'Warning: ',
  error: 'Error: ',
};

/**
 * Inline status notice ("Notice" in user-facing language).
 *
 * Accessibility contract: every variant is its own live region
 * (`aria-live="polite"`, `aria-atomic="true"`). Decision (not specified): the
 * `error` variant additionally carries `role="alert"` while keeping the explicit
 * polite value, so the announcement stays polite and the node is still exposed
 * with the alert role; `info`/`warning` use `role="status"`. A live region only
 * announces changes to content inside a region that is already in the DOM, so
 * consumers should keep a `Banner` mounted per status area where practical (a
 * newly inserted `role="alert"` still announces reliably, which is why errors
 * carry that role). Never wrap a `Banner` in another live region: nested live
 * regions announce twice or not at all.
 */
export function Banner({
  variant = 'info',
  title,
  children,
  action,
  onDismiss,
  className,
  ...rest
}: BannerProps) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      aria-atomic="true"
      className={cx(styles.banner, styles[variant], className)}
      {...rest}
    >
      <Icon icon={VARIANT_ICON[variant]} size={20} className={styles.icon} />
      <div className={styles.text}>
        <span className="sr-only">{VARIANT_PREFIX[variant]}</span>
        {title !== undefined && <p className={styles.title}>{title}</p>}
        <div className={styles.message}>{children}</div>
      </div>
      {action !== undefined && (
        <span className={styles.action}>
          <Button
            variant="secondary"
            size="md"
            loading={action.loading}
            onClick={action.onClick}
            data-focus-target={action.dataFocusTarget}
          >
            {action.label}
          </Button>
        </span>
      )}
      {onDismiss !== undefined && (
        <IconButton
          icon={X}
          aria-label="Dismiss"
          variant="ghost"
          onClick={onDismiss}
          className={styles.dismiss}
        />
      )}
    </div>
  );
}
