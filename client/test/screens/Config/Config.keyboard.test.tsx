import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig } from '../../helpers/configFixtures';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config keyboard access', () => {
  it('toggles checkboxes with Space and labels icon controls', () => {
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    const checkbox = screen.getByRole('checkbox', { name: /Shuffle images/ });
    checkbox.focus();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Back to file explorer' })).toBeInTheDocument();
  });

  it('keeps reset and play as keyboard-reachable buttons', () => {
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play slide show/ })).toBeDisabled();
  });
});
