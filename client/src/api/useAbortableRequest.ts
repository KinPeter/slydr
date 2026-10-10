import { useCallback, useEffect, useRef } from 'react';
import { createAbortError } from './client';

export interface AbortableRequest {
  /**
   * Aborts the previous request started through this hook, then runs `run`
   * with a fresh signal. Rejects with an AbortError if this request was
   * superseded, cancelled or the component unmounted, even when `run` itself
   * resolved first. Callers ignore that rejection with isAbortError.
   */
  run: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  /** Aborts the in-flight request, if any. */
  cancel: () => void;
}

/**
 * Abort bookkeeping shared by the explorer listing (T026) and the
 * configuration screen's image scan (T029): abort the previous request,
 * ignore a late response, abort on unmount. Neither screen creates its own
 * `AbortController` for API calls.
 *
 * Example (configuration screen):
 *
 * ```ts
 * const { run } = useAbortableRequest();
 * useEffect(() => {
 *   run((signal) => getImages({ path, recursive: config.includeSubfolders, showHidden }, signal))
 *     .then(setResult)
 *     .catch((err) => { if (!isAbortError(err)) setError(err); });
 * }, [path, config.includeSubfolders, showHidden, run]);
 * ```
 */
export function useAbortableRequest(): AbortableRequest {
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const run = useCallback(<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return task(controller.signal).then(
      (value) => {
        // The abort lost the race with an already-resolved fetch: the
        // response is stale, so reject instead of returning it.
        if (controller.signal.aborted) throw createAbortError();
        return value;
      },
      (err: unknown) => {
        // A superseded request must reject with an AbortError even when
        // the task itself failed first, so callers never render a stale
        // error for a request they no longer care about.
        if (controller.signal.aborted) throw createAbortError();
        throw err;
      },
    );
  }, []);

  return { run, cancel };
}
