import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { X } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/components/Button';
import type { ButtonProps } from '../../src/components/Button';

describe('Button', () => {
  it('renders a native button with its label and type="button" by default', () => {
    render(<Button variant="primary">Play slide show</Button>);
    const button = screen.getByRole('button', { name: 'Play slide show' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('calls onClick once when clicked, and not when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading sets aria-busy, ignores clicks, and stays focusable', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Play slide show
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Play slide show' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
    // The label stays rendered so the button width does not change.
    expect(button).toHaveTextContent('Play slide show');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();

    button.focus();
    expect(button).toHaveFocus();
    await user.tab();
    expect(button).not.toHaveFocus();
  });

  it('renders each variant class', () => {
    const { unmount } = render(<Button variant="primary">A</Button>);
    expect(screen.getByRole('button', { name: 'A' }).className).toContain('primary');
    unmount();
    render(<Button variant="secondary">B</Button>);
    expect(screen.getByRole('button', { name: 'B' }).className).toContain('secondary');
  });

  it('renders the ghost variant class', () => {
    render(<Button variant="ghost">C</Button>);
    expect(screen.getByRole('button', { name: 'C' }).className).toContain('ghost');
  });

  it('icon-only button exposes its aria-label as the accessible name', () => {
    render(<Button iconOnly icon={X} aria-label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('type', 'button');
  });

  it('type-level: icon-only button requires aria-label', () => {
    // @ts-expect-error — icon-only button requires aria-label
    const missing: ButtonProps = { iconOnly: true, icon: X };
    // @ts-expect-error — icon-only button forbids children
    const withChildren: ButtonProps = {
      iconOnly: true,
      icon: X,
      'aria-label': 'Close',
      children: 'x',
    };
    expect(missing).toBeDefined();
    expect(withChildren).toBeDefined();
    render(<Button iconOnly icon={X} aria-label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('forwards ref and merges className', () => {
    let node: HTMLButtonElement | null = null;
    render(
      <Button
        className="extra-class"
        ref={(element: HTMLButtonElement | null) => {
          node = element;
        }}
      >
        Ref
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Ref' });
    expect(node).toBe(button);
    expect(button.className).toContain('extra-class');
  });
});
