import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, vi } from 'vitest';
import type { FsEntry, ListResponse, RootResponse } from '@slydr/shared';
import { checkA11y } from '../helpers/axe';
import { AppStateProvider, createInitialState } from '../../src/state/AppStateProvider';
import { Explorer } from '../../src/screens/Explorer';
import { getRoot, list } from '../../src/api/client';

vi.mock('../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getRoot: vi.fn(), list: vi.fn() };
});

const root: RootResponse = {
  path: '',
  name: 'Home',
  absoluteRoot: '/home/test',
  platform: 'linux',
};
const entries: FsEntry[] = [
  { name: 'Pictures', path: 'Pictures', type: 'folder', hidden: false, size: null, mtimeMs: null },
];
const response: ListResponse = {
  path: '',
  name: 'Home',
  parentPath: null,
  entries,
  counts: { folders: 1, images: 0, files: 0 },
  truncated: false,
};

describe('explorer accessibility regression', () => {
  beforeEach(() => {
    vi.mocked(getRoot).mockResolvedValue(root);
    vi.mocked(list).mockResolvedValue(response);
  });

  it('has no axe violations after the listing loads', async () => {
    const { container } = render(
      <AppStateProvider initialState={createInitialState()}>
        <Explorer />
      </AppStateProvider>,
    );
    await screen.findByRole('option', { name: /Pictures/ });
    await checkA11y(container);
  });

  it('has no axe violations with a 1000-entry virtualized listing', async () => {
    const largeResponse: ListResponse = {
      ...response,
      entries: Array.from({ length: 1000 }, (_, index) => ({
        ...entries[0]!,
        name: `Folder ${index}`,
        path: `Folder-${index}`,
      })),
      counts: { folders: 1000, images: 0, files: 0 },
    };
    vi.mocked(list).mockResolvedValue(largeResponse);
    const { container } = render(
      <AppStateProvider initialState={createInitialState()}>
        <Explorer />
      </AppStateProvider>,
    );
    await screen.findByRole('listbox', { name: 'Folder contents' });
    await checkA11y(container);
  });
});
