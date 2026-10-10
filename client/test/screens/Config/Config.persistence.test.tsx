import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig } from '../../helpers/configFixtures';
import { installMockStorage } from '../../helpers/storageMock';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config persistence', () => {
  it('persists a changed checkbox through the provider', () => {
    const storage = installMockStorage();
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Loop slide show/ }));
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.setItem).toHaveBeenCalledWith(
      'slydr.config',
      expect.stringContaining('"loop":false'),
    );
    storage.dispose();
  });

  it('continues to work when storage access throws', () => {
    const storage = installMockStorage({ throwOnAccess: true });
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />);
    expect(() =>
      fireEvent.click(screen.getByRole('checkbox', { name: /Shuffle images/ })),
    ).not.toThrow();
    storage.dispose();
  });

  it('resets config and announces the action', () => {
    const storage = installMockStorage();
    vi.mocked(getImages).mockReturnValue(new Promise(() => {}));
    renderConfig(<Config />, { config: { durationSeconds: 20, shuffle: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByRole('slider')).toHaveValue('5');
    expect(screen.getByText('Settings reset to defaults.')).toBeInTheDocument();
    storage.dispose();
  });
});
