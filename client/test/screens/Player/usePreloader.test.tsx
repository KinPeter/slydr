import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreloader } from '../../../src/screens/Player/usePreloader';

afterEach(() => vi.restoreAllMocks());

describe('usePreloader', () => {
  it('keeps only the bounded set of requested sources', () => {
    const images: Array<{ src: string; decode: () => Promise<void> }> = [];
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decoding = '';
        decode = vi.fn(() => Promise.resolve());
        constructor() {
          images.push(this);
        }
      },
    );
    const { rerender } = renderHook(({ sources }) => usePreloader(sources, 1), {
      initialProps: { sources: ['/one', '/two'] },
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.src).toBe('/one');
    rerender({ sources: ['/two'] });
    expect(images[0]?.src).toBe('');
    expect(images).toHaveLength(2);
    expect(images[1]?.src).toBe('/two');
  });

  it('does not invent entries past the supplied play-order end', () => {
    const image = { src: '', decoding: '', decode: vi.fn(() => Promise.resolve()) };
    vi.stubGlobal(
      'Image',
      vi.fn(() => image),
    );
    renderHook(() => usePreloader([], 1));
    expect(image.src).toBe('');
    expect(Image).not.toHaveBeenCalled();
  });
});
