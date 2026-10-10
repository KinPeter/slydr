import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TransitionEvent } from 'react';
import { cx } from '../../lib/cx';
import styles from './SlideImage.module.css';
import { fadeFallbackMs } from './motion';
import type { PlayerSlide, SwapReason } from './types';

export interface SlideImageProps {
  slide: PlayerSlide;
  role: 'previous' | 'current' | 'next';
  swapReason: SwapReason;
  durationMs: number;
  animations: boolean;
  paused: boolean;
  onRef(el: HTMLImageElement | null): void;
  onLoad(): void;
  onError(): void;
  onFadeComplete(): void;
}

export function SlideImage({
  slide,
  role,
  swapReason,
  animations,
  paused,
  onRef,
  onLoad,
  onError,
  onFadeComplete,
}: SlideImageProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const initial = role === 'current' && animations && swapReason !== 'initial';
  const [phase, setPhase] = useState<'enter' | 'run' | 'rest'>(initial ? 'enter' : 'rest');
  useLayoutEffect(() => {
    if (phase !== 'enter') return;
    void layerRef.current?.getBoundingClientRect();
    setPhase('run');
  }, [phase]);
  useEffect(() => {
    if (role !== 'previous' || !animations) return;
    done.current = false;
    const timer = window.setTimeout(() => finishFade(), fadeFallbackMs(layerRef.current));
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, animations, slide.key]);
  useEffect(() => {
    if (!animations || role === 'next') setPhase('rest');
    else if (role === 'current' || role === 'previous') setPhase('run');
  }, [animations, role]);
  function finishFade() {
    if (done.current) return;
    done.current = true;
    onFadeComplete();
    setPhase('rest');
  }
  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity') return;
    if (role === 'previous') finishFade();
    else if (role === 'current') setPhase('rest');
  }
  return (
    <div
      ref={layerRef}
      className={cx(styles.layer, styles[role])}
      data-role={role}
      data-motion={animations ? 'animated' : 'static'}
      data-phase={phase}
      onTransitionEnd={handleTransitionEnd}
    >
      <img
        className={styles.img}
        src={slide.src}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="async"
        ref={onRef}
        onLoad={onLoad}
        onError={onError}
        data-testid={role === 'current' ? 'slide-current' : undefined}
        style={{ animationPlayState: paused ? 'paused' : 'running' }}
      />
    </div>
  );
}
