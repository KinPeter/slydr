import { useEffect, useState } from 'react';
import { Banner } from '../../components';
import { useAppActions, useAppState } from '../../state/AppStateProvider';
import { requestFullscreenSync } from '../../lib/fullscreen';
import { ConfigHeader } from './ConfigHeader';
import { FolderTitle } from './FolderTitle';
import { ConfigControls } from './ConfigControls';
import { ImageCountStatus } from './ImageCountStatus';
import { ConfigFooter } from './ConfigFooter';
import { useImageScan } from './useImageScan';
import { GENERIC_SCAN_ERROR, RESET_ANNOUNCEMENT, RETRY, SCAN_ERRORS } from './copy';
import styles from './Config.module.css';

export function Config() {
  const state = useAppState();
  const actions = useAppActions();
  const [resetAnnouncement, setResetAnnouncement] = useState('');
  useEffect(() => {
    if (state.selection === null) actions.goToExplorer();
  }, [state.selection, actions]);
  const scanResult = useImageScan({
    path: state.selection?.path ?? null,
    includeSubfolders: state.config.includeSubfolders,
    showHidden: state.explorer.showHidden,
    setPlaylist: actions.setPlaylist,
  });
  if (state.selection === null) return null;
  const { selection } = state;
  const canPlay = scanResult.scan.status === 'ready' && scanResult.scan.count > 0;
  const scanError =
    scanResult.scan.status === 'error'
      ? (SCAN_ERRORS[scanResult.scan.code] ?? GENERIC_SCAN_ERROR)
      : null;
  function play(): void {
    if (!canPlay) return;
    if (state.config.startFullScreen) requestFullscreenSync(document.documentElement);
    actions.startPlayer();
  }
  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <ConfigHeader onBack={actions.goToExplorer} />
        {state.notice !== null && (
          <Banner variant="error" onDismiss={actions.dismissNotice}>
            {state.notice}
          </Banner>
        )}
        <FolderTitle name={selection.name} path={selection.path} />
        <ImageCountStatus
          scan={scanResult.scan}
          includeSubfolders={state.config.includeSubfolders}
          onChoose={actions.goToExplorer}
        />
        {scanError !== null && (
          <Banner variant="error" action={{ label: RETRY, onClick: scanResult.retry }}>
            {scanError}
          </Banner>
        )}
        <ConfigControls
          config={state.config}
          onConfig={(patch) => {
            setResetAnnouncement('');
            actions.setConfig(patch);
          }}
          onReset={() => {
            setResetAnnouncement(RESET_ANNOUNCEMENT);
            actions.resetConfig();
          }}
        />
        <div className={styles.announcement} aria-live="polite">
          {resetAnnouncement}
        </div>
      </div>
      <ConfigFooter canPlay={canPlay} onPlay={play} />
    </main>
  );
}
