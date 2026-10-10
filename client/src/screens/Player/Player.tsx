// Horizontal swipe navigation is deliberately NOT bound in v1 (specification §10 and
// §16.2 item 4): on iOS Safari and Chrome on Android a horizontal drag from near the
// screen edge is the browser's back/forward gesture, and intercepting it either breaks
// navigation or produces a 50/50 race depending on where the drag started. Prev/next are
// reachable from the controls overlay (tap) and from the arrow keys. Revisit only with
// an explicit product decision.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useAppActions, useAppState } from '../../state/AppStateProvider';
import { PlayerStage } from './PlayerStage';
import { PlayerBackground } from './PlayerBackground';
import { usePlayerEngine } from './usePlayerEngine';
import { usePreloader } from './usePreloader';
import { useWakeLock } from './useWakeLock';
import styles from './Player.module.css';
import { transitionDuration } from './motion';
import { useEffectiveAnimations } from './useEffectiveAnimations';
import { PlayerControlsOverlay } from './PlayerControlsOverlay';
import { useIdleReveal } from './useIdleReveal';
import { usePlayerKeyboard } from './usePlayerKeyboard';
import { useRevealOnFullscreenChange } from './useRevealOnFullscreenChange';
import { isFullscreenSupported } from './fullscreen';

export function Player() {
  const app = useAppState();
  const { exitPlayer } = useAppActions();
  const playlist = app.playlist ?? [];
  const engine = usePlayerEngine({ playlist, config: app.config, onExit: exitPlayer });
  const { releasePrevious } = engine;
  const { animations } = useEffectiveAnimations(app.config);
  const playerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    playerRef.current?.focus({ preventScroll: true });
  }, []);
  const idle = useIdleReveal(2000, { hold: engine.state.status === 'paused' });
  const { visible: controlsVisible, reveal } = idle;
  usePlayerKeyboard({ controls: engine.controls, reveal });
  useRevealOnFullscreenChange(engine.state.isFullscreen, reveal);
  useLayoutEffect(() => {
    if (!animations && engine.state.previous) releasePrevious(engine.state.previous.key);
  }, [animations, engine.state.previous, releasePrevious]);
  usePreloader(engine.preloadSources);
  useWakeLock(engine.state.status === 'playing');
  useEffect(() => {
    document.body.classList.add('player-open');
    return () => document.body.classList.remove('player-open');
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!controlsVisible && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) reveal();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [controlsVisible, reveal]);
  return (
    <div
      className={styles.player}
      ref={playerRef}
      tabIndex={-1}
      data-focus-target="player"
      role="region"
      aria-label="Slide show"
      data-status={engine.state.status}
      data-fullscreen={engine.state.isFullscreen ? 'true' : 'false'}
      data-chrome={controlsVisible ? 'visible' : 'hidden'}
      data-testid="player"
      style={
        {
          '--kb-duration': `${app.config.durationSeconds}s`,
          '--player-transition-dur': transitionDuration({
            animations,
            swapReason: engine.state.swapReason,
            interrupted: engine.state.interrupted,
          }),
        } as CSSProperties
      }
    >
      <h1 className="sr-only">Slide show</h1>
      <PlayerStage
        state={engine.state}
        controls={engine.controls}
        config={app.config}
        animations={animations}
        releasePrevious={engine.releasePrevious}
        registerLayer={engine.registerLayer}
        reportLoadError={engine.reportLoadError}
        reportLoadSuccess={engine.reportLoadSuccess}
        overlay={
          <PlayerControlsOverlay
            ref={(element) => {
              idle.overlayRef.current = element;
            }}
            onPrev={engine.controls.previous}
            onNext={engine.controls.next}
            onTogglePause={engine.controls.togglePause}
            onToggleFullscreen={engine.controls.toggleFullscreen}
            onStop={engine.controls.stop}
            paused={engine.state.status === 'paused'}
            fullscreen={engine.state.isFullscreen}
            index={engine.state.counter.index}
            total={engine.state.counter.total}
            visible={controlsVisible}
            holdProps={idle.holdProps}
            fullscreenSupported={isFullscreenSupported()}
          />
        }
        background={
          <PlayerBackground
            fillEmptySpace={app.config.fillEmptySpace}
            current={engine.state.current}
            previous={animations ? engine.state.previous : null}
          />
        }
      />
    </div>
  );
}
