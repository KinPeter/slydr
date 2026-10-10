import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig } from '../../helpers/configFixtures';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config controls', () => {
  it('renders seven controls with native checkboxes and slider bounds', () => {
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    expect(screen.getByRole('slider')).toHaveAttribute('min', '1');
    expect(screen.getByRole('slider')).toHaveAttribute('max', '30');
    expect(screen.getByRole('slider')).toHaveAttribute('step', '1');
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    expect(screen.getAllByRole('checkbox').every((input) => !input.hasAttribute('role'))).toBe(
      true,
    );
    expect(screen.getByRole('slider')).toHaveValue('5');
    expect(screen.getByText('5 s')).toBeInTheDocument();
  });

  it('updates the duration and checkbox state through the provider', () => {
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '12' } });
    expect(slider).toHaveValue('12');
    const shuffle = screen.getByRole('checkbox', { name: /Shuffle images/ });
    fireEvent.click(shuffle);
    expect(shuffle).not.toBeChecked();
  });

  it('shows the reduced-motion note only when requested by the media query', () => {
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    expect(screen.queryByText(/reduce motion/)).not.toBeInTheDocument();
  });
});
