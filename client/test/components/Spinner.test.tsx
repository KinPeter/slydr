import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from '../../src/components/Spinner';

describe('Spinner', () => {
  it('is aria-hidden without a label', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('with label renders role="status" and the label text', () => {
    render(<Spinner label="Loading images" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading images');
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
