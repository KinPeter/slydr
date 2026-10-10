import type { ApiErrorCode } from '@slydr/shared';
import type React from 'react';
import { Button, Spinner } from '../../components';
import {
  CHOOSE_ANOTHER_FOLDER,
  imageCount,
  NO_IMAGES,
  SCANNING,
  SUBFOLDER_HINT,
  TRUNCATED_NOTICE,
  UNSUPPORTED_FORMATS,
} from './copy';
import styles from './Config.module.css';

export function ImageCountStatus({
  scan,
  includeSubfolders,
  onChoose,
}: {
  scan:
    | { status: 'scanning' }
    | { status: 'ready'; count: number; truncated: boolean }
    | { status: 'error'; code: ApiErrorCode };
  includeSubfolders: boolean;
  onChoose: () => void;
}) {
  let content: React.ReactNode = '';
  if (scan.status === 'scanning')
    content = (
      <>
        <Spinner size="1em" /> {SCANNING}
      </>
    );
  else if (scan.status === 'ready' && scan.count > 0)
    content = (
      <>
        {imageCount(scan.count)}
        {scan.truncated && <span className={styles.statusLine}>{TRUNCATED_NOTICE}</span>}
      </>
    );
  else if (scan.status === 'ready')
    content = (
      <>
        <span>{NO_IMAGES}</span>
        {!includeSubfolders && <span className={styles.statusLine}>{SUBFOLDER_HINT}</span>}
        <span className={styles.statusLine}>{UNSUPPORTED_FORMATS}</span>
        <Button variant="ghost" onClick={onChoose}>
          {CHOOSE_ANOTHER_FOLDER}
        </Button>
      </>
    );
  return (
    <div
      id="cfg-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={styles.status}
    >
      {content}
    </div>
  );
}
