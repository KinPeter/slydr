import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Image } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from '../../src/components/Chip';

describe('Chip', () => {
  it('renders its content without a role or tab stop', async () => {
    const user = userEvent.setup();
    render(<Chip>412 images</Chip>);
    const chip = screen.getByText('412 images');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('role');
    expect(chip.getAttribute('tabindex')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    await user.tab();
    expect(chip).not.toHaveFocus();
  });

  it('renders a dismiss button named by dismissLabel and fires onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Chip icon={Image} onDismiss={onDismiss} dismissLabel="Remove filter">
        Filtered
      </Chip>,
    );
    const dismiss = screen.getByRole('button', { name: 'Remove filter' });
    expect(dismiss).toHaveAttribute('type', 'button');
    await user.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('default dismiss name is "Remove"', () => {
    render(<Chip onDismiss={() => undefined}>Filtered</Chip>);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
