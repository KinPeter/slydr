import type { ReactNode } from 'react';
import type { SlideshowConfig } from '@slydr/shared';
import { SlideImage } from './SlideImage';
import type { PlayerControls, PlayerEngineState } from './types';
import styles from './Player.module.css';

/* `role` below is a layer-slot prop, not an ARIA attribute. */
/* eslint-disable jsx-a11y/aria-role */

export interface PlayerStageProps {
  state: PlayerEngineState;
  controls: PlayerControls;
  config: SlideshowConfig;
  registerLayer(key: string, el: HTMLImageElement | null): void;
  reportLoadError(key: string): void;
  reportLoadSuccess(key: string): void;
  background?: ReactNode;
  overlay?: ReactNode;
}

export function PlayerStage({
  state,
  config,
  registerLayer,
  reportLoadError,
  reportLoadSuccess,
  background,
  overlay,
}: PlayerStageProps) {
  const layers = [
    state.previous === null ? null : (
      <SlideImage
        key={state.previous.key}
        slide={state.previous}
        role="previous"
        swapReason={state.swapReason}
        durationMs={state.durationMs}
        animations={config.animations}
        onRef={(el) => registerLayer(state.previous?.key ?? '', el)}
        onLoad={() => reportLoadSuccess(state.previous?.key ?? '')}
        onError={() => reportLoadError(state.previous?.key ?? '')}
      />
    ),
    state.current === null ? null : (
      <SlideImage
        key={state.current.key}
        slide={state.current}
        role="current"
        swapReason={state.swapReason}
        durationMs={state.durationMs}
        animations={config.animations}
        onRef={(el) => registerLayer(state.current?.key ?? '', el)}
        onLoad={() => reportLoadSuccess(state.current?.key ?? '')}
        onError={() => reportLoadError(state.current?.key ?? '')}
      />
    ),
    state.next === null ? null : (
      <SlideImage
        key={state.next.key}
        slide={state.next}
        role="next"
        swapReason={state.swapReason}
        durationMs={state.durationMs}
        animations={config.animations}
        onRef={(el) => registerLayer(state.next?.key ?? '', el)}
        onLoad={() => reportLoadSuccess(state.next?.key ?? '')}
        onError={() => reportLoadError(state.next?.key ?? '')}
      />
    ),
  ];
  return (
    <>
      <div className={styles.layerBackground}>{background}</div>
      <div className={styles.layerImages}>{layers}</div>
      <div className={styles.layerOverlay}>{overlay}</div>
    </>
  );
}

/* eslint-enable jsx-a11y/aria-role */
