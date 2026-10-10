import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../src/components/Checkbox';

describe('Checkbox', () => {
  it('exposes the checkbox role and the label as accessible name', () => {
    render(<Checkbox label="Shuffle images" checked={false} onCheckedChange={() => undefined} />);
    const input = screen.getByRole('checkbox', { name: 'Shuffle images' });
    expect(input).toHaveAttribute('type', 'checkbox');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(input).not.toHaveAttribute('role');
  });

  it('reflects checked state and fires onCheckedChange with the new value', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Checkbox label="Shuffle images" checked={false} onCheckedChange={onCheckedChange} />,
    );
    const input = screen.getByRole('checkbox', { name: 'Shuffle images' });
    expect(input).not.toBeChecked();

    await user.click(input);
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    rerender(<Checkbox label="Shuffle images" checked onCheckedChange={onCheckedChange} />);
    expect(screen.getByRole('checkbox', { name: 'Shuffle images' })).toBeChecked();

    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('clicking the label text toggles it', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Loop slide show" checked={false} onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByText('Loop slide show'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('links the description and the note with aria-describedby, and keeps the note out of the accessible name', () => {
    render(
      <Checkbox
        label="Use animations"
        description="Slow zoom and crossfade"
        note="Reduced motion is on."
        checked={false}
        onCheckedChange={() => undefined}
      />,
    );
    // The description lives inside the <label>, so it is part of the name; the
    // note sits outside the <label> and is only a description.
    const input = screen.getByRole('checkbox', { name: 'Use animations Slow zoom and crossfade' });
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    const ids = describedBy.split(' ').filter((part) => part !== '');
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(document.getElementById(ids[0] ?? '')).toHaveTextContent('Slow zoom and crossfade');
    expect(document.getElementById(ids[1] ?? '')).toHaveTextContent('Reduced motion is on.');
    // The note sits outside the <label>, so it is not part of the accessible name.
    const label = document.querySelector('label');
    const note = screen.getByText('Reduced motion is on.');
    expect(label?.contains(note)).toBe(false);
    expect(input).toHaveAccessibleName('Use animations Slow zoom and crossfade');
  });

  it('does not set aria-checked, and disabled blocks changes', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        label="Shuffle images"
        checked={false}
        onCheckedChange={onCheckedChange}
        disabled
      />,
    );
    const input = screen.getByRole('checkbox', { name: 'Shuffle images' });
    expect(input).not.toHaveAttribute('aria-checked');
    expect(input).toBeDisabled();
    await user.click(input);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('remains in the tab order', async () => {
    const user = userEvent.setup();
    render(<Checkbox label="Shuffle images" checked={false} onCheckedChange={() => undefined} />);
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Shuffle images' })).toHaveFocus();
  });
});
