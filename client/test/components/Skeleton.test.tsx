import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '../../src/components/Skeleton';

describe('Skeleton', () => {
  it('is aria-hidden and applies width and height', () => {
    const { container } = render(<Skeleton width="12rem" height="2.75rem" />);
    const block = container.firstElementChild;
    expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(block).not.toHaveAttribute('role');
    const style = (block as HTMLElement).style;
    expect(style.width).toBe('12rem');
    expect(style.height).toBe('2.75rem');
  });

  it('circle shape forces equal width and height from height', () => {
    const { container } = render(<Skeleton shape="circle" height="2.5rem" />);
    const style = (container.firstElementChild as HTMLElement).style;
    expect(style.width).toBe('2.5rem');
    expect(style.height).toBe('2.5rem');
  });

  it('shape="text" renders the requested number of lines', () => {
    const { container } = render(<Skeleton shape="text" lines={3} />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root?.childElementCount).toBe(3);
  });
});
