import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig } from '../../helpers/configFixtures';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config Play slide show', () => {
  it('requests fullscreen before starting the player', async () => {
    vi.mocked(getImages).mockResolvedValue({
      path: 'Pictures',
      recursive: false,
      count: 1,
      truncated: false,
      items: [{ name: 'a.jpg', path: 'a.jpg', dir: '', size: 1, mtimeMs: null }],
    });
    const fullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: fullscreen,
    });
    renderConfig(<Config />);
    const play = await screen.findByRole('button', { name: /Play slide show/ });
    fireEvent.click(play);
    expect(fullscreen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fullscreen).toHaveBeenCalledTimes(1));
  });

  it('does not request fullscreen when disabled in config', async () => {
    vi.mocked(getImages).mockResolvedValue({
      path: 'Pictures',
      recursive: false,
      count: 1,
      truncated: false,
      items: [{ name: 'a.jpg', path: 'a.jpg', dir: '', size: 1, mtimeMs: null }],
    });
    const fullscreen = vi.fn();
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: fullscreen,
    });
    renderConfig(<Config />, { config: { startFullScreen: false } });
    fireEvent.click(await screen.findByRole('button', { name: /Play slide show/ }));
    expect(fullscreen).not.toHaveBeenCalled();
  });
});
