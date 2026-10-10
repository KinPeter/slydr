import styles from './Player.module.css';
import type { PlayerSlide, SwapReason } from './types';

export interface SlideImageProps {
  slide: PlayerSlide;
  role: 'previous' | 'current' | 'next';
  swapReason: SwapReason;
  durationMs: number;
  animations: boolean;
  onRef(el: HTMLImageElement | null): void;
  onLoad(): void;
  onError(): void;
}

export function SlideImage({ slide, role, onRef, onLoad, onError }: SlideImageProps) {
  return (
    <img
      className={role === 'next' ? `${styles.slide} ${styles.slideHidden}` : styles.slide}
      src={slide.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      ref={onRef}
      onLoad={onLoad}
      onError={onError}
      data-testid={role === 'current' ? 'slide-current' : undefined}
    />
  );
}
