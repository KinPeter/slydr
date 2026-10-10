import { forwardRef } from 'react';
import { Maximize, Minimize, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import type { IdleReveal } from './useIdleReveal';
import styles from './PlayerControlsOverlay.module.css';

export interface PlayerControlsOverlayProps {
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onToggleFullscreen: () => void;
  onStop: () => void;
  paused: boolean;
  fullscreen: boolean;
  index: number;
  total: number;
  visible: boolean;
  holdProps: IdleReveal['holdProps'];
  fullscreenSupported?: boolean;
}
export const PlayerControlsOverlay = forwardRef<HTMLDivElement, PlayerControlsOverlayProps>(
  function PlayerControlsOverlay(
    {
      onPrev,
      onNext,
      onTogglePause,
      onToggleFullscreen,
      onStop,
      paused,
      fullscreen,
      index,
      total,
      visible,
      holdProps,
      fullscreenSupported = true,
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={styles.pill}
        role="toolbar"
        aria-label="Slide show controls"
        aria-orientation="horizontal"
        data-visible={visible ? 'true' : 'false'}
        inert={!visible}
        {...holdProps}
      >
        {total > 1 && (
          <span className={styles.counter}>
            {index} / {total}
          </span>
        )}
        <IconButton
          className={styles.button}
          icon={SkipBack}
          aria-label="Previous image"
          onClick={onPrev}
        />
        <IconButton
          className={styles.button}
          icon={paused ? Play : Pause}
          aria-label={paused ? 'Play slide show' : 'Pause slide show'}
          onClick={onTogglePause}
        />
        <IconButton
          className={styles.button}
          icon={SkipForward}
          aria-label="Next image"
          onClick={onNext}
        />
        {fullscreenSupported && (
          <IconButton
            className={styles.button}
            icon={fullscreen ? Minimize : Maximize}
            aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
            onClick={onToggleFullscreen}
          />
        )}
        <IconButton
          className={styles.button}
          icon={X}
          aria-label="Stop slide show"
          onClick={onStop}
        />
      </div>
    );
  },
);
