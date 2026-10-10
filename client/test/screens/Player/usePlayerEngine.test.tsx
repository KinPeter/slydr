import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageItem, SlideshowConfig } from '@slydr/shared';
import { usePlayerEngine } from '../../../src/screens/Player/usePlayerEngine';

const config: SlideshowConfig = {
  durationSeconds: 5,
  shuffle: false,
  loop: false,
  animations: false,
  fillEmptySpace: false,
  startFullScreen: false,
  includeSubfolders: false,
};

const playlist: ImageItem[] = [
  { name: 'one.jpg', path: 'one.jpg', dir: '', size: 1, mtimeMs: 1 },
  { name: 'two.jpg', path: 'two.jpg', dir: '', size: 1, mtimeMs: 1 },
];

afterEach(() => vi.useRealTimers());

describe('usePlayerEngine scheduling and failures', () => {
  it('resumes with the paused remainder instead of resetting the duration', () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const { result } = renderHook(() => usePlayerEngine({ playlist, config, onExit }));

    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.controls.pause());
    act(() => vi.advanceTimersByTime(10000));
    act(() => result.current.controls.play());
    act(() => vi.advanceTimersByTime(2999));
    expect(onExit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.state.next?.item.path).toBe('two.jpg');
  });

  it('cancels the old timer when the current image fails', () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const { result } = renderHook(() => usePlayerEngine({ playlist, config, onExit }));

    act(() => result.current.reportLoadError('0:0'));
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.state.next?.item.path).toBe('two.jpg');
  });

  it('ignores a late decode success after the same layer failed', () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    let resolveDecode: (() => void) | undefined;
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: () =>
        new Promise<void>((resolve) => {
          resolveDecode = resolve;
        }),
    });
    const { result } = renderHook(() => usePlayerEngine({ playlist, config, onExit }));
    act(() => result.current.controls.next());
    act(() => result.current.registerLayer('0:1', document.createElement('img')));
    act(() => result.current.reportLoadError('0:1'));
    expect(result.current.state.current?.item.path).toBe('one.jpg');
    act(() => resolveDecode?.());
    expect(result.current.state.current?.item.path).toBe('one.jpg');
    vi.restoreAllMocks();
  });
});
