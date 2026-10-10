import type { LucideIcon } from 'lucide-react';
import type React from 'react';
import { cx } from '../../lib/cx';
import styles from './Icon.module.css';

export type IconComponent = LucideIcon;

export interface IconProps extends Omit<
  React.SVGAttributes<SVGSVGElement>,
  'children' | 'aria-label' | 'aria-hidden'
> {
  /** The lucide icon component to render, e.g. `Folder`. */
  icon: IconComponent;
  /** Pixel size of the square icon. Default 20. */
  size?: number;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /**
   * When provided, the icon is meaningful: it gets role="img" and aria-label={label}.
   * When omitted, the icon is decorative: aria-hidden="true", no role, not focusable.
   */
  label?: string;
}

/**
 * Decorative-by-default lucide icon wrapper.
 *
 * Accessibility contract: without `label` the SVG is `aria-hidden="true"` and
 * never in the tab order, so it is silent beside a visible text label or inside
 * a labelled button. With `label` it is exposed as `role="img"` with that name.
 * Colour is always inherited (`currentColor`); there is no colour prop.
 */
export function Icon({
  icon: Glyph,
  size = 20,
  strokeWidth = 2,
  label,
  className,
  ...rest
}: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={cx(styles.icon, className)}
      focusable="false"
      {...(label === undefined
        ? { 'aria-hidden': true as const }
        : { role: 'img' as const, 'aria-label': label })}
      {...rest}
    />
  );
}
