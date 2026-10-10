import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig, makeImages } from '../../helpers/configFixtures';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config image scan', () => {
  it('requests the selected path and stores the returned playlist', async () => {
    const response = makeImages(2);
    vi.mocked(getImages).mockResolvedValue(response);
    renderConfig(<Config />, { showHidden: true });
    await screen.findByText('2 images found');
    expect(getImages).toHaveBeenCalledWith(
      { path: 'Pictures', recursive: false, showHidden: true },
      expect.any(AbortSignal),
    );
  });

  it('keeps the status region mounted and disables Play while scanning', () => {
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    const status = document.getElementById('cfg-status');
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent('Scanning…');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: /Play slide show/ })).toBeDisabled();
  });

  it('rescans when Include subfolders changes', async () => {
    vi.mocked(getImages).mockResolvedValue(makeImages(1));
    renderConfig(<Config />);
    await screen.findByText('1 image found');
    fireEvent.click(screen.getByRole('checkbox', { name: /Include subfolders/ }));
    await waitFor(() =>
      expect(getImages).toHaveBeenLastCalledWith(
        { path: 'Pictures', recursive: true, showHidden: false },
        expect.any(AbortSignal),
      ),
    );
  });

  it('aborts superseded scans and ignores the late first response', async () => {
    let resolveFirst!: (value: ReturnType<typeof makeImages>) => void;
    let resolveSecond!: (value: ReturnType<typeof makeImages>) => void;
    vi.mocked(getImages)
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));
    renderConfig(<Config />);
    const firstSignal = vi.mocked(getImages).mock.calls[0]?.[1];
    fireEvent.click(screen.getByRole('checkbox', { name: /Include subfolders/ }));
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst(makeImages(1));
    resolveSecond(makeImages(2));
    expect(await screen.findByText('2 images found')).toBeInTheDocument();
    expect(screen.queryByText('1 image found')).not.toBeInTheDocument();
  });

  it('shows a retry action for a failed scan', async () => {
    vi.mocked(getImages).mockRejectedValueOnce(new Error('secret server detail'));
    renderConfig(<Config />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong while scanning this folder.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret server detail');
    vi.mocked(getImages).mockResolvedValue(makeImages(1));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('1 image found');
  });
});
