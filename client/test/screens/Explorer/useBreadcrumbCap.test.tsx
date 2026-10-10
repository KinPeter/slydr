import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installViewport } from '../../helpers/matchMedia';
import { useBreadcrumbCap } from '../../../src/screens/Explorer/useBreadcrumbCap';

describe('useBreadcrumbCap', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => dispose?.());

  it('caps the trail below 768px and responds to viewport changes', () => {
    const viewport = installViewport({ width: 767 });
    dispose = viewport.dispose;
    const hook = renderHook(() => useBreadcrumbCap());
    expect(hook.result.current).toBe(1);
    act(() => viewport.setViewport({ width: 800 }));
    expect(hook.result.current).toBeUndefined();
    expect(viewport.listenerCount('(min-width: 768px)')).toBe(1);
    hook.unmount();
    expect(viewport.listenerCount('(min-width: 768px)')).toBe(0);
  });

  it('defaults to the expanded trail when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    const hook = renderHook(() => useBreadcrumbCap());
    expect(hook.result.current).toBeUndefined();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  });
});
