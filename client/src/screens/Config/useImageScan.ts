import { useCallback, useEffect, useState } from 'react';
import type { ApiErrorCode, ImageItem } from '@slydr/shared';
import { getImages, isAbortError, isApiClientError } from '../../api/client';
import { useAbortableRequest } from '../../api/useAbortableRequest';

export type ScanState =
  | { status: 'scanning' }
  | { status: 'ready'; count: number; truncated: boolean }
  | { status: 'error'; code: ApiErrorCode };

export function useImageScan({
  path,
  includeSubfolders,
  showHidden,
  setPlaylist,
}: {
  path: string | null;
  includeSubfolders: boolean;
  showHidden: boolean;
  setPlaylist: (items: ImageItem[] | null) => void;
}): { scan: ScanState; retry: () => void } {
  const { run, cancel } = useAbortableRequest();
  const [attempt, setAttempt] = useState(0);
  const [scan, setScan] = useState<ScanState>({ status: 'scanning' });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (path === null) return;
    let active = true;
    setScan({ status: 'scanning' });
    setPlaylist(null);
    run((signal) => getImages({ path, recursive: includeSubfolders, showHidden }, signal))
      .then((response) => {
        if (!active) return;
        setPlaylist(response.items);
        setScan({ status: 'ready', count: response.items.length, truncated: response.truncated });
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return;
        setPlaylist(null);
        setScan({ status: 'error', code: isApiClientError(error) ? error.code : 'READ_FAILED' });
      });
    return () => {
      active = false;
      cancel();
    };
  }, [path, includeSubfolders, showHidden, attempt, run, cancel, setPlaylist]);
  return { scan, retry };
}
