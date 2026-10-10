import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig, makeImages } from '../../helpers/configFixtures';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config readiness states', () => {
  it('disables Play and explains an empty folder', async () => {
    vi.mocked(getImages).mockResolvedValue(makeImages(0));
    renderConfig(<Config />);
    expect(await screen.findByText('No playable images in this folder.')).toBeInTheDocument();
    expect(screen.getByText('HEIC, TIFF and RAW photos are not supported.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play slide show/ })).toBeDisabled();
  });

  it('shows the subfolder hint only when recursion is off', async () => {
    vi.mocked(getImages).mockResolvedValue(makeImages(0));
    renderConfig(<Config />, { config: { includeSubfolders: false } });
    expect(await screen.findByText(/Turn on Include subfolders/)).toBeInTheDocument();
  });

  it('shows formatted truncation information', async () => {
    vi.mocked(getImages).mockResolvedValue(makeImages(20000, { truncated: true }));
    renderConfig(<Config />);
    expect(await screen.findByText('20,000 images found')).toBeInTheDocument();
    expect(screen.getByText('Showing the first 20,000 images.')).toBeInTheDocument();
  });
});
