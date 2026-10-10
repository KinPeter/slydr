import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideImage } from '../../../src/screens/Player/SlideImage';
import { fireTransitionEnd } from '../../helpers/transitionEvents';
import type { PlayerSlide } from '../../../src/screens/Player/types';

const slide: PlayerSlide = {
  key: '0:1',
  position: 1,
  cycle: 0,
  item: { name: 'one.jpg', path: 'one.jpg', dir: '', size: 1, mtimeMs: 1 },
  src: '/one.jpg',
};
const props = (onFadeComplete = vi.fn(), role: 'previous' | 'current' = 'previous') => ({
  slide,
  role,
  swapReason: 'manual' as const,
  durationMs: 5000,
  animations: true,
  paused: false,
  onRef: vi.fn(),
  onLoad: vi.fn(),
  onError: vi.fn(),
  onFadeComplete,
});

afterEach(() => vi.useRealTimers());

describe('SlideImage layer lifecycle', () => {
  it('releases only on the wrapper opacity transition and only once', () => {
    const release = vi.fn();
    const { container } = render(<SlideImage {...props(release)} />);
    const layer = container.firstElementChild!;
    fireTransitionEnd(layer, 'transform');
    fireTransitionEnd(layer, 'opacity');
    fireTransitionEnd(layer, 'opacity');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('ignores bubbled descendant events', () => {
    const release = vi.fn();
    const { container } = render(<SlideImage {...props(release)} />);
    act(() =>
      container.querySelector('img')?.dispatchEvent(new Event('transitionend', { bubbles: true })),
    );
    expect(release).not.toHaveBeenCalled();
  });

  it('uses the safety net when transitionend never arrives', () => {
    vi.useFakeTimers();
    const release = vi.fn();
    render(<SlideImage {...props(release)} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not start a safety net for current or next layers', () => {
    vi.useFakeTimers();
    const release = vi.fn();
    render(<SlideImage {...props(release, 'current')} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(release).not.toHaveBeenCalled();
  });
});
