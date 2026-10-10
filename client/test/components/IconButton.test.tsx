import { render, screen } from '@testing-library/react';
import { X } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '../../src/components/IconButton';
import type { IconButtonProps } from '../../src/components/IconButton';

describe('IconButton', () => {
  it('has the accessible name from aria-label and a matching title', () => {
    render(<IconButton icon={X} aria-label="Close dialog" />);
    const button = screen.getByRole('button', { name: 'Close dialog' });
    expect(button).toHaveAttribute('title', 'Close dialog');
  });

  it('pressed maps to aria-pressed and omits it when undefined', () => {
    const { rerender } = render(<IconButton icon={X} aria-label="Grid view" pressed />);
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    rerender(<IconButton icon={X} aria-label="Grid view" pressed={false} />);
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(<IconButton icon={X} aria-label="Grid view" />);
    expect(screen.getByRole('button', { name: 'Grid view' })).not.toHaveAttribute('aria-pressed');
  });

  it('type-level: aria-label is required', () => {
    // @ts-expect-error — aria-label is required
    const missing: IconButtonProps = { icon: X };
    expect(missing).toBeDefined();
    render(<IconButton icon={X} aria-label="Close dialog" />);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
  });

  it('logs a dev error for an empty aria-label at runtime', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bypassed = { icon: X, 'aria-label': '' } as unknown as IconButtonProps;
    render(<IconButton {...bypassed} />);
    expect(error).toHaveBeenCalledWith('IconButton requires a non-empty aria-label.');
  });
});
