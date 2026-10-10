import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from '../../../src/screens/Player/useWakeLock';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
});

function installWakeLock() {
  const release = vi.fn(() => Promise.resolve());
  const sentinel = new EventTarget() as EventTarget & {
    released: boolean;
    release: typeof release;
  };
  sentinel.released = false;
  sentinel.release = release;
  const request = vi.fn(() => Promise.resolve(sentinel));
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  });
  return { request, release };
}

describe('useWakeLock', () => {
  it('requests while active and releases when deactivated', async () => {
    const { request, release } = installWakeLock();
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await act(async () => undefined);
    expect(request).toHaveBeenCalledWith('screen');
    rerender({ active: false });
    await act(async () => undefined);
    expect(release).toHaveBeenCalled();
  });

  it('does nothing when the API is unavailable', () => {
    const { result } = renderHook(() => useWakeLock(true));
    expect(result.current).toBeUndefined();
  });
});
