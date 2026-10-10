import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRevealOnFullscreenChange } from '../../../src/screens/Player/useRevealOnFullscreenChange';

function Harness({ value, reveal }: { value: boolean; reveal: () => void }) {
  useRevealOnFullscreenChange(value, reveal);
  return null;
}

describe('useRevealOnFullscreenChange', () => {
  it('reveals only when the value changes', () => {
    const reveal = vi.fn();
    const { rerender } = render(<Harness value={false} reveal={reveal} />);
    expect(reveal).not.toHaveBeenCalled();
    rerender(<Harness value={true} reveal={reveal} />);
    rerender(<Harness value={true} reveal={reveal} />);
    rerender(<Harness value={false} reveal={reveal} />);
    expect(reveal).toHaveBeenCalledTimes(2);
  });
});
