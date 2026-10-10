import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig } from '../../helpers/configFixtures';
import { installMatchMedia } from '../../helpers/matchMedia';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config reduced motion', () => {
  it('shows the note without changing the checkbox preference', () => {
    const media = installMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />, { config: { animations: true } });
    expect(screen.getByText(/Your system is set to reduce motion/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Use animations and transitions' })).toBeChecked();
    media.dispose();
  });

  it('updates the note when the media query changes', () => {
    const media = installMatchMedia({ '(prefers-reduced-motion: reduce)': false });
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    expect(screen.queryByText(/Your system is set to reduce motion/)).not.toBeInTheDocument();
    act(() => media.setMatches('(prefers-reduced-motion: reduce)', true));
    expect(screen.getByText(/Your system is set to reduce motion/)).toBeInTheDocument();
    media.dispose();
  });
});
