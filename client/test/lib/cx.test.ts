import { describe, expect, it } from 'vitest';
import { cx } from '../../src/lib/cx';

describe('cx', () => {
  it('joins class names with a single space', () => {
    expect(cx('card', 'cardActive')).toBe('card cardActive');
  });

  it('skips falsy parts', () => {
    expect(cx('card', false, null, undefined, 'cardActive')).toBe('card cardActive');
  });

  it('returns an empty string when every part is falsy', () => {
    expect(cx(false, null, undefined)).toBe('');
  });

  it('returns a lone class name unchanged', () => {
    expect(cx('card')).toBe('card');
  });
});
