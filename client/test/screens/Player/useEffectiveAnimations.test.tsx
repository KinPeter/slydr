import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffectiveAnimations } from '../../../src/screens/Player/useEffectiveAnimations';
import { installMatchMedia } from '../../helpers/matchMedia';

const query = '(prefers-reduced-motion: reduce)';

describe('useEffectiveAnimations', () => {
  let media: ReturnType<typeof installMatchMedia> | undefined;
  afterEach(() => media?.dispose());

  it('combines configured animation and reduced-motion state without mutating config', () => {
    media = installMatchMedia({ [query]: true });
    const config = { animations: true };
    const { result } = renderHook(() => useEffectiveAnimations(config));
    expect(result.current).toEqual({ animations: false, reducedMotion: true });
    expect(config).toEqual({ animations: true });
  });

  it('is false when animation is disabled and reports media separately', () => {
    media = installMatchMedia({ [query]: false });
    const { result } = renderHook(() => useEffectiveAnimations({ animations: false }));
    expect(result.current).toEqual({ animations: false, reducedMotion: false });
  });

  it('updates live when the OS setting changes', () => {
    media = installMatchMedia({ [query]: false });
    const { result } = renderHook(() => useEffectiveAnimations({ animations: true }));
    act(() => media?.setMatches(query, true));
    expect(result.current.animations).toBe(false);
    expect(result.current.reducedMotion).toBe(true);
    act(() => media?.setMatches(query, false));
    expect(result.current.animations).toBe(true);
  });
});
