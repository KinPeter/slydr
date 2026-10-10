import type React from 'react';
import { cx } from '../../lib/cx';
import styles from './Skeleton.module.css';

export interface SkeletonProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> {
  /** CSS width, default "100%". */
  width?: string;
  /** CSS height, default "1em". */
  height?: string;
  /** Shape. Default 'rect'. 'circle' forces equal width and height from `height`. */
  shape?: 'rect' | 'circle' | 'text';
  /** Number of stacked lines for shape 'text'. Default 1. */
  lines?: number;
}

/**
 * Decorative loading placeholder (rows, tiles, text lines).
 *
 * Accessibility contract: always `aria-hidden="true"` with no role and no text;
 * the container that owns the loading state announces it (e.g. `aria-busy` on
 * the list plus a polite status). The shimmer is decorative motion and is
 * removed under `prefers-reduced-motion`.
 */
export function Skeleton({
  width = '100%',
  height = '1em',
  shape = 'rect',
  lines = 1,
  className,
  style,
  ...rest
}: SkeletonProps) {
  if (shape === 'text') {
    const count = Math.max(1, Math.floor(lines));
    return (
      <div aria-hidden="true" className={cx(styles.text, className)} style={style} {...rest}>
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            className={styles.line}
            style={{ height, width: count > 1 && index === count - 1 ? '60%' : '100%' }}
          />
        ))}
      </div>
    );
  }

  const size = shape === 'circle' ? { width: height, height } : { width, height };
  return (
    <div
      aria-hidden="true"
      className={cx(styles.skeleton, shape === 'circle' && styles.circle, className)}
      style={{ ...style, ...size }}
      {...rest}
    />
  );
}
