import type React from 'react';
import { cx } from '../../lib/cx';
import { Icon } from '../Icon/Icon';
import type { IconComponent } from '../Icon/Icon';
import { Spinner } from '../Spinner/Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

interface ButtonBaseProps extends Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'children' | 'type'
> {
  variant?: ButtonVariant; // default 'secondary'
  size?: ButtonSize; // default 'md'
  type?: 'button' | 'submit' | 'reset'; // default 'button' (never the HTML default of 'submit')
  loading?: boolean; // default false; shows a Spinner, sets aria-busy, blocks clicks
  fullWidth?: boolean; // default false
  ref?: React.Ref<HTMLButtonElement>;
}

/** A button with a visible text label. An icon may accompany the text. */
export interface LabelledButtonProps extends ButtonBaseProps {
  children: React.ReactNode; // required, non-empty visible label
  icon?: IconComponent; // optional leading icon (decorative)
  iconOnly?: false; // default
  'aria-label'?: string; // optional override; avoid unless the visible text is ambiguous
}

/** A button with only an icon. `aria-label` is REQUIRED by the type system. */
export interface IconOnlyButtonProps extends ButtonBaseProps {
  iconOnly: true;
  icon: IconComponent;
  'aria-label': string; // required
  children?: never; // an icon-only button has no visible text children
}

export type ButtonProps = LabelledButtonProps | IconOnlyButtonProps;

/**
 * Text or icon-only button with three closed variants (`primary | secondary | ghost`)
 * and two sizes (`md | lg`).
 *
 * Accessibility contract: always a native `<button>`; the `iconOnly` branch is a
 * type error without `aria-label`, so an icon-only button always has an accessible
 * name. `loading` keeps the label rendered (no layout shift) and reports
 * `aria-busy` without using native `disabled`, so focus is not lost mid-operation.
 *
 * The `ghost` variant inherits its text colour from `--button-fg` (falling back to
 * `--fg`) and its hover background from `--button-hover-bg` (falling back to
 * `--bg-sunken`). Decision (not specified): these custom properties are the
 * documented extension point for tinted surfaces such as the player controls pill,
 * which sets them to overlay tokens. Consumers set them to token values only,
 * never raw colours.
 */
export function Button(props: ButtonProps) {
  const {
    variant = 'secondary',
    size = 'md',
    type = 'button',
    loading = false,
    fullWidth = false,
    ref,
    className,
    onClick,
    iconOnly,
    icon,
    children,
    ...buttonRest
  } = props;

  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    // Decision (not specified): the loading state ignores clicks in the handler
    // instead of using native `disabled`, so focus stays on the button while the
    // operation is in flight.
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  const iconSize = size === 'lg' ? 24 : 20;

  return (
    <button
      type={type}
      ref={ref}
      className={cx(
        styles.button,
        styles[variant],
        size === 'lg' ? styles.sizeLg : styles.sizeMd,
        fullWidth && styles.fullWidth,
        loading && styles.loading,
        className,
      )}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : undefined}
      onClick={handleClick}
      {...buttonRest}
    >
      {loading && (
        <span className={styles.spinnerSlot} aria-hidden="true">
          <Spinner size="1em" />
        </span>
      )}
      {iconOnly === true && icon !== undefined ? (
        <Icon icon={icon} size={iconSize} />
      ) : (
        <>
          {icon !== undefined && (
            <span className={cx(styles.iconSlot, loading && styles.iconHidden)} aria-hidden="true">
              <Icon icon={icon} size={iconSize} />
            </span>
          )}
          <span className={styles.label}>{children}</span>
        </>
      )}
    </button>
  );
}
