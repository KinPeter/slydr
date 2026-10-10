import { screen } from '@testing-library/react';
import { describe, it, vi } from 'vitest';
import { checkA11y } from '../helpers/axe';
import { Config } from '../../src/screens/Config';
import { getImages } from '../../src/api/client';
import { makeImages, renderConfig } from '../helpers/configFixtures';

vi.mock('../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('configuration accessibility regression', () => {
  it('has no axe violations in the idle state', async () => {
    vi.mocked(getImages).mockResolvedValue(makeImages(0));
    const { container } = renderConfig(<Config />);
    await screen.findByText('No playable images in this folder.');
    await checkA11y(container);
  });
});
