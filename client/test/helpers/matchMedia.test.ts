import { afterEach, describe, expect, it } from 'vitest';
import { installViewport } from './matchMedia';

describe('installViewport', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => dispose?.());

  it('answers viewport media queries', () => {
    const viewport = installViewport({
      width: 767,
      height: 568,
      hover: 'none',
      pointer: 'coarse',
      reducedMotion: true,
    });
    dispose = viewport.dispose;
    expect(window.matchMedia('(min-width: 768px)').matches).toBe(false);
    expect(window.matchMedia('(max-width: 767.98px)').matches).toBe(true);
    expect(window.matchMedia('(hover: none)').matches).toBe(true);
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
  });

  it('notifies only queries whose result flips', () => {
    const viewport = installViewport({ width: 767 });
    dispose = viewport.dispose;
    const md = window.matchMedia('(min-width: 768px)');
    const coarse = window.matchMedia('(pointer: coarse)');
    let mdChanges = 0;
    let coarseChanges = 0;
    md.addEventListener('change', () => mdChanges++);
    coarse.addEventListener('change', () => coarseChanges++);
    viewport.setViewport({ width: 800 });
    expect(mdChanges).toBe(1);
    expect(coarseChanges).toBe(0);
    viewport.setViewport({ width: 801 });
    expect(mdChanges).toBe(1);
  });
});
