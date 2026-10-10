import { useEffect, useLayoutEffect } from 'react';
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

export function Player() {
  const app = useAppState();
  const { exitPlayer } = useAppActions();
  const playlist = app.playlist ?? [];
  const engine = usePlayerEngine({ playlist, config: app.config, onExit: exitPlayer });
  const { releasePrevious } = engine;
  const { animations } = useEffectiveAnimations(app.config);
  useLayoutEffect(() => {
    if (!animations && engine.state.previous) releasePrevious(engine.state.previous.key);
  }, [animations, engine.state.previous, releasePrevious]);
  usePreloader(engine.preloadSources);
  useWakeLock(engine.state.status === 'playing');
  useEffect(() => {
    document.body.classList.add('player-open');
    return () => document.body.classList.remove('player-open');
  }, []);
  return (
    <div
      className={styles.player}
      role="region"
      aria-label="Slide show"
      data-status={engine.state.status}
      data-fullscreen={engine.state.isFullscreen ? 'true' : 'false'}
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
      <PlayerStage
        state={engine.state}
        controls={engine.controls}
        config={app.config}
        animations={animations}
        releasePrevious={engine.releasePrevious}
        registerLayer={engine.registerLayer}
        reportLoadError={engine.reportLoadError}
        reportLoadSuccess={engine.reportLoadSuccess}
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
