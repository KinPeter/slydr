import type React from 'react';
import { cx } from '../../lib/cx';
import { Button } from '../Button/Button';
import type { ButtonSize, ButtonVariant } from '../Button/Button';
import type { IconComponent } from '../Icon/Icon';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'children' | 'type' | 'aria-label'
> {
  icon: IconComponent;
  /** Accessible name. Required. Also used as the default tooltip. */
  'aria-label': string;
  variant?: ButtonVariant; // default 'ghost'
  size?: ButtonSize; // default 'md'
  type?: 'button' | 'submit' | 'reset'; // default 'button'
  /** Optional pressed state for a toggle-style icon button (e.g. view mode). Sets aria-pressed. */
  pressed?: boolean;
  /** Native tooltip. Defaults to the aria-label. Pass an empty string to suppress. */
  title?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

// Decision (not specified): the type system enforces `aria-label`, but plain
// JavaScript (or an `as any` cast) can bypass it, so a development-only runtime
// guard logs once instead of throwing.
let warnedMissingLabel = false;

/**
 * Toolbar-style icon-only button with the `iconOnly` guarantees baked in.
 *
 * Accessibility contract: the required `aria-label` is the accessible name and,
 * by default, the native tooltip, so mouse, touch and screen-reader users share
 * one name. `pressed` exposes a toggle state through `aria-pressed`. All sizing,
 * focus and loading behaviour comes from `Button`.
 */
export function IconButton({
  icon,
  'aria-label': ariaLabel,
  variant = 'ghost',
  size = 'md',
  type = 'button',
  pressed,
  title,
  ref,
  className,
  ...rest
}: IconButtonProps) {
  if (import.meta.env.DEV && (ariaLabel === undefined || ariaLabel === '')) {
    if (!warnedMissingLabel) {
      warnedMissingLabel = true;
      console.error('IconButton requires a non-empty aria-label.');
    }
  }

  return (
    <Button
      iconOnly
      icon={icon}
      aria-label={ariaLabel}
      variant={variant}
      size={size}
      type={type}
      aria-pressed={pressed}
      title={title ?? ariaLabel}
      ref={ref}
      className={cx(pressed === true && styles.pressed, className)}
      {...rest}
    />
  );
}
