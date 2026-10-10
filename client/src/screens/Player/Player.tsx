import { useEffect } from 'react';
import { useAppActions, useAppState } from '../../state/AppStateProvider';
import { PlayerStage } from './PlayerStage';
import { usePlayerEngine } from './usePlayerEngine';
import { usePreloader } from './usePreloader';
import { useWakeLock } from './useWakeLock';
import styles from './Player.module.css';

export function Player() {
  const app = useAppState();
  const { exitPlayer } = useAppActions();
  const playlist = app.playlist ?? [];
  const engine = usePlayerEngine({ playlist, config: app.config, onExit: exitPlayer });
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
    >
      <PlayerStage
        state={engine.state}
        controls={engine.controls}
        config={app.config}
        registerLayer={engine.registerLayer}
        reportLoadError={engine.reportLoadError}
        reportLoadSuccess={engine.reportLoadSuccess}
      />
    </div>
  );
}
