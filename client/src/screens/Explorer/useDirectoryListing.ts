import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClientError } from '../../api/client';
import { isAbortError, list } from '../../api/client';
import { useAbortableRequest } from '../../api/useAbortableRequest';
import type { ListResponse } from '@slydr/shared';
import { cancelAllThumbnails } from './thumbnailQueue';

export interface DirectoryListingState {
  data: ListResponse | null;
  loading: boolean;
  error: ApiClientError | null;
  requestedPath: string;
  navigate: (path: string) => void;
  fallbackToRoot: () => void;
  reload: () => void;
}
export function useDirectoryListing(
  initialPath: string,
  showHidden: boolean,
): DirectoryListingState {
  const [requestedPath, setRequestedPath] = useState(initialPath);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const { run } = useAbortableRequest();
  const first = useRef(true);
  const revertedPath = useRef<string | null>(null);
  const dataRef = useRef<ListResponse | null>(null);
  dataRef.current = data;
  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);
  useEffect(() => {
    if (revertedPath.current === requestedPath) {
      revertedPath.current = null;
      return;
    }
    if (!first.current) cancelAllThumbnails();
    first.current = false;
    setLoading(true);
    setError(null);
    run((signal) => list({ path: requestedPath, showHidden }, signal))
      .then((result) => {
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) return;
        setError(reason as ApiClientError);
        if (dataRef.current !== null && requestedPath !== dataRef.current.path) {
          revertedPath.current = dataRef.current.path;
          setRequestedPath(dataRef.current.path);
        }
        setLoading(false);
      });
  }, [requestedPath, showHidden, reloadToken, run]);
  const navigate = useCallback(
    (path: string) => {
      if (path !== requestedPath) setRequestedPath(path);
    },
    [requestedPath],
  );
  const fallbackToRoot = useCallback(() => setRequestedPath(''), []);
  return { data, loading, error, requestedPath, navigate, fallbackToRoot, reload };
}
