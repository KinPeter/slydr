import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FADE_FALLBACK_MS,
  FADE_SAFETY_MARGIN_MS,
  fadeFallbackMs,
  parseFirstDurationMs,
  transitionDuration,
} from '../../../src/screens/Player/motion';

afterEach(() => vi.restoreAllMocks());

describe('transitionDuration', () => {
  it('selects static, initial, interrupted, manual and automatic durations', () => {
    expect(
      transitionDuration({ animations: false, swapReason: 'manual', interrupted: false }),
    ).toBe('0ms');
    expect(
      transitionDuration({ animations: true, swapReason: 'initial', interrupted: false }),
    ).toBe('0ms');
    expect(transitionDuration({ animations: true, swapReason: 'auto', interrupted: true })).toBe(
      '0ms',
    );
    expect(transitionDuration({ animations: true, swapReason: 'manual', interrupted: false })).toBe(
      'var(--dur-fast)',
    );
    expect(transitionDuration({ animations: true, swapReason: 'auto', interrupted: false })).toBe(
      'var(--slide-transition-duration)',
    );
  });
});

describe('duration parsing and fade fallback', () => {
  it('parses seconds, milliseconds and only the first comma-separated value', () => {
    expect(parseFirstDurationMs('0.7s, 2s')).toBe(700);
    expect(parseFirstDurationMs('120ms')).toBe(120);
    expect(parseFirstDurationMs('')).toBeNull();
    expect(parseFirstDurationMs('ease')).toBeNull();
  });

  it('adds the safety margin to computed and fallback durations', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionDuration: '0.2s',
    } as CSSStyleDeclaration);
    expect(fadeFallbackMs(document.createElement('div'))).toBe(200 + FADE_SAFETY_MARGIN_MS);
    expect(fadeFallbackMs(null)).toBe(FADE_FALLBACK_MS + FADE_SAFETY_MARGIN_MS);
  });
});
