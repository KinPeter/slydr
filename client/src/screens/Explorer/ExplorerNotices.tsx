import { Banner } from '../../components';
import { RETRY, RESTORE_NOTICE, TRUNCATION_NOTICE } from './copy';
import styles from './Explorer.module.css';
export function ExplorerNotices({
  restore,
  dismissRestore,
  error,
  retry,
  retryFocusTarget,
  truncated,
}: {
  restore: boolean;
  dismissRestore: () => void;
  error: string | null;
  retry: () => void;
  retryFocusTarget?: string;
  truncated: boolean;
}) {
  return (
    <div className={styles.notices}>
      {restore && (
        <Banner variant="info" onDismiss={dismissRestore}>
          {RESTORE_NOTICE}
        </Banner>
      )}
      {error && (
        <Banner
          variant="error"
          action={{ label: RETRY, onClick: retry, dataFocusTarget: retryFocusTarget }}
        >
          {error}
        </Banner>
      )}
      {truncated && <Banner variant="info">{TRUNCATION_NOTICE}</Banner>}
    </div>
  );
}
