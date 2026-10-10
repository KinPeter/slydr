import { renderHook } from '@testing-library/react';
import { act, StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { isAbortError } from '../../src/api/client';
import { useAbortableRequest } from '../../src/api/useAbortableRequest';

function pendingOn(signal: AbortSignal): Promise<string> {
  return new Promise<string>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
      { once: true },
    );
  });
}

describe('useAbortableRequest', () => {
  it('passes a live signal to the task', async () => {
    const { result } = renderHook(() => useAbortableRequest());
    const seen: { signal: AbortSignal | null } = { signal: null };
    await result.current.run((signal) => {
      seen.signal = signal;
      return Promise.resolve('ok');
    });
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.signal?.aborted).toBe(false);
  });

  it('aborts the previous request when run is called again', async () => {
    const { result } = renderHook(() => useAbortableRequest());
    const firstSignals: AbortSignal[] = [];
    const pendingFirst = result.current.run((signal) => {
      firstSignals.push(signal);
      return pendingOn(signal);
    });
    const assertion = expect(pendingFirst).rejects.toSatisfy(isAbortError);
    await result.current.run(() => Promise.resolve('second'));
    await assertion;
    expect(firstSignals[0]?.aborted).toBe(true);
  });

  it('rejects the superseded request with an AbortError', async () => {
    const { result } = renderHook(() => useAbortableRequest());
    const pendingFirst = result.current.run((signal) => pendingOn(signal));
    await result.current.run(() => Promise.resolve('latest'));
    const err = await pendingFirst.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(err)).toBe(true);
  });

  it('rejects a superseded request with an AbortError even when its task had already resolved', async () => {
    const { result } = renderHook(() => useAbortableRequest());
    const pendingFirst = result.current.run(() => Promise.resolve('stale'));
    const pendingSecond = result.current.run(() => Promise.resolve('fresh'));
    await expect(pendingSecond).resolves.toBe('fresh');
    const err = await pendingFirst.then(
      () => {
        throw new Error('should have rejected');
      },
      (rejection: unknown) => rejection,
    );
    expect(isAbortError(err)).toBe(true);
  });

  it('resolves the latest request normally', async () => {
    const { result } = renderHook(() => useAbortableRequest());
    await expect(result.current.run(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('cancel aborts the in-flight request', async () => {
    const { result } = renderHook(() => useAbortableRequest());
    const pending = result.current.run((signal) => pendingOn(signal));
    const assertion = expect(pending).rejects.toSatisfy(isAbortError);
    act(() => {
      result.current.cancel();
    });
    await assertion;
  });

  it('aborts the in-flight request on unmount', async () => {
    const { result, unmount } = renderHook(() => useAbortableRequest());
    const pending = result.current.run((signal) => pendingOn(signal));
    const assertion = expect(pending).rejects.toSatisfy(isAbortError);
    unmount();
    await assertion;
  });

  it('keeps run and cancel referentially stable across renders', () => {
    const { result, rerender } = renderHook(() => useAbortableRequest());
    const firstRun = result.current.run;
    const firstCancel = result.current.cancel;
    rerender();
    rerender();
    expect(result.current.run).toBe(firstRun);
    expect(result.current.cancel).toBe(firstCancel);
  });

  it('works after a StrictMode simulated unmount and remount', async () => {
    const { result } = renderHook(() => useAbortableRequest(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    await expect(result.current.run(() => Promise.resolve('after-remount'))).resolves.toBe(
      'after-remount',
    );
  });
});
