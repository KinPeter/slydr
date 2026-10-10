import { useState } from 'react';
import type { ReactElement } from 'react';
import type { PlayerSlide } from './types';
import styles from './PlayerBackground.module.css';

export interface PlayerBackgroundProps {
  /** `config.fillEmptySpace`. */
  fillEmptySpace: boolean;
  /** The slide whose image is currently on screen. */
  current: PlayerSlide | null;
  /** The slide kept underneath while the incoming cover fades in. */
  previous: PlayerSlide | null;
}

/** The decorative layer behind the fitted foreground slides. */
export function PlayerBackground({
  fillEmptySpace,
  current,
  previous,
}: PlayerBackgroundProps): ReactElement {
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(() => new Set());

  const markFailed = (key: string) => {
    setFailedKeys((failed) => {
      if (failed.has(key)) return failed;
      const next = new Set(failed);
      next.add(key);
      return next;
    });
  };

  const cover = (slide: PlayerSlide, className: string) => (
    <img
      key={slide.key}
      className={`${styles.cover} ${className}${failedKeys.has(slide.key) ? ` ${styles.coverFailed}` : ''}`}
      src={slide.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      data-bg="true"
      onError={() => markFailed(slide.key)}
    />
  );

  return (
    <div className={styles.background} aria-hidden="true">
      <div className={styles.flat} aria-hidden="true" />
      {fillEmptySpace && previous !== null ? cover(previous, 'coverOut') : null}
      {fillEmptySpace && current !== null
        ? cover(current, previous === null ? '' : (styles.coverIn ?? ''))
        : null}
    </div>
  );
}
