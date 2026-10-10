import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePrefersReducedMotion } from '../../src/lib/usePrefersReducedMotion';
import { installMatchMedia, type MatchMediaController } from '../helpers/matchMedia';

describe('usePrefersReducedMotion', () => {
  let controller: MatchMediaController | undefined;
  afterEach(() => controller?.dispose());

  it('returns false without matchMedia', () => {
    const original = window.matchMedia;
    delete (window as { matchMedia?: unknown }).matchMedia;
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
    window.matchMedia = original;
  });

  it('reads and updates the media query', () => {
    controller = installMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    const result = renderHook(() => usePrefersReducedMotion());
    expect(result.result.current).toBe(true);
    act(() => controller?.setMatches('(prefers-reduced-motion: reduce)', false));
    expect(result.result.current).toBe(false);
  });

  it('removes its listener on unmount', () => {
    controller = installMatchMedia();
    const result = renderHook(() => usePrefersReducedMotion());
    expect(controller.listenerCount('(prefers-reduced-motion: reduce)')).toBe(1);
    result.unmount();
    expect(controller.listenerCount('(prefers-reduced-motion: reduce)')).toBe(0);
  });
});
