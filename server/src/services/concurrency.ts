/**
 * Bounded concurrency helper for I/O operations.
 *
 * Runs work over items with at most `limit` concurrent operations in flight,
 * preserving input order in the result. Rejects on the first error encountered.
 */

/** 64 is well above the 4-thread libuv pool, so the queue stays saturated, and far below any descriptor limit. Tunable after measurement (§16.2). */
export const STAT_CONCURRENCY = 64;

/**
 * Runs `fn` over `items` with at most `limit` in flight (N workers pulling from a shared index).
 * Results keep input order even though work may complete out of order.
 * Rejects with the first error thrown by any `fn` call.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) {
    throw new RangeError('mapPool limit must be at least 1');
  }

  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;
  let activeCount = 0;
  let error: unknown = null;
  let resolved = false;
  let resolveFn: (v: R[]) => void = () => {};
  let rejectFn: (e: unknown) => void = () => {};

  const promise = new Promise<R[]>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });

  const trySettle = () => {
    if (resolved) return;

    if (error !== null) {
      resolved = true;
      rejectFn(error);
    } else if (nextIndex >= items.length && activeCount === 0) {
      resolved = true;
      resolveFn(results);
    }
  };

  const processOne = () => {
    // First, check if we can start a new task
    if (error !== null) {
      // Error occurred, decrement and check if done
      activeCount--;
      trySettle();
      return;
    }

    if (nextIndex >= items.length) {
      // No more items, decrement and check if done
      activeCount--;
      trySettle();
      return;
    }

    // Start a new task
    const currentIndex = nextIndex;
    nextIndex++;

    fn(items[currentIndex]!, currentIndex)
      .then((result) => {
        results[currentIndex] = result;
        processOne();
      })
      .catch((err) => {
        if (error === null) {
          error = err;
        }
        processOne();
      });
  };

  // Kick off `limit` concurrent workers
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    activeCount++;
    processOne();
  }

  return promise;
}
