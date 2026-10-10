import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from '../../src/components/Banner';

describe('Banner', () => {
  it('error variant has role="alert" and aria-live="polite"', () => {
    render(<Banner variant="error">Scan failed.</Banner>);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('info and warning variants have role="status" and aria-live="polite"', () => {
    const { unmount } = render(<Banner variant="info">Scanning.</Banner>);
    const info = screen.getByRole('status');
    expect(info).toHaveAttribute('aria-live', 'polite');
    unmount();

    render(<Banner variant="warning">Partial listing.</Banner>);
    const warning = screen.getByRole('status');
    expect(warning).toHaveAttribute('aria-live', 'polite');
  });

  it('all variants set aria-atomic="true"', () => {
    const { unmount } = render(<Banner variant="info">A</Banner>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    unmount();

    render(<Banner variant="warning">B</Banner>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    unmount();

    render(<Banner variant="error">C</Banner>);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-atomic', 'true');
  });

  it('renders title and message and a visually hidden variant prefix', () => {
    render(
      <Banner variant="error" title="Scan failed">
        The folder could not be read.
      </Banner>,
    );
    expect(screen.getByText('Scan failed')).toBeInTheDocument();
    expect(screen.getByText('The folder could not be read.')).toBeInTheDocument();
    const prefix = document.querySelector('.sr-only');
    expect(prefix).toHaveTextContent('Error:');
  });

  it('action button has the given label and fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Banner variant="error" action={{ label: 'Retry', onClick }}>
        Failed.
      </Banner>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading action does not fire onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Banner variant="error" action={{ label: 'Retry', loading: true, onClick }}>
        Failed.
      </Banner>,
    );
    const action = screen.getByRole('button', { name: 'Retry' });
    expect(action).toHaveAttribute('aria-busy', 'true');
    await user.click(action);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('dismiss button is named "Dismiss" and fires onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Banner variant="info" onDismiss={onDismiss}>
        Notice.
      </Banner>,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('live region announces newly inserted content', () => {
    const { rerender } = render(<Banner variant="info">Scanning.</Banner>);
    const region = screen.getByRole('status');
    rerender(<Banner variant="info">128 images found.</Banner>);
    // The same live-region node persists while its text changes.
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('128 images found.');
  });
});
