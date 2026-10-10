import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsEntry, ListResponse, RootResponse } from '@slydr/shared';
import { AppStateProvider, createInitialState } from '../../../src/state/AppStateProvider';
import { Explorer } from '../../../src/screens/Explorer';
import { ApiClientError, getRoot, list } from '../../../src/api/client';

vi.mock('../../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getRoot: vi.fn(), list: vi.fn() };
});

const root: RootResponse = {
  path: '',
  name: 'Home',
  absoluteRoot: '/home/test',
  platform: 'linux',
};
const folder: FsEntry = {
  name: 'Pictures',
  path: 'Pictures',
  type: 'folder',
  hidden: false,
  size: null,
  mtimeMs: null,
};
const image: FsEntry = {
  name: 'photo.jpg',
  path: 'photo.jpg',
  type: 'image',
  hidden: false,
  size: 1536,
  mtimeMs: null,
};

function listing(path: string, entries: FsEntry[] = [folder, image]): ListResponse {
  return {
    path,
    name: path ? path.split('/').at(-1)! : 'Home',
    parentPath: path ? '' : null,
    entries,
    counts: {
      folders: entries.filter((entry) => entry.type === 'folder').length,
      images: 1,
      files: 0,
    },
    truncated: false,
  };
}

function renderExplorer() {
  const state = createInitialState();
  return render(
    <AppStateProvider initialState={state}>
      <Explorer />
    </AppStateProvider>,
  );
}

describe('Explorer component', () => {
  beforeEach(() => {
    vi.mocked(getRoot).mockClear();
    vi.mocked(list).mockClear();
    vi.mocked(getRoot).mockResolvedValue(root);
    vi.mocked(list).mockImplementation(({ path }) => Promise.resolve(listing(path)));
  });

  it('opens the root, renders rows in server order, and exposes the listbox contract', async () => {
    renderExplorer();
    expect(screen.getAllByRole('listbox')[0]).toHaveAttribute('aria-busy', 'true');
    await screen.findByRole('option', { name: /Folder, Pictures/ });
    expect(vi.mocked(getRoot)).toHaveBeenCalled();
    expect(vi.mocked(list)).toHaveBeenCalledWith(
      { path: '', showHidden: false },
      expect.any(AbortSignal),
    );
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('aria-label', 'Folder contents');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('data-type', 'folder');
    expect(screen.getByRole('option', { name: /Image, photo.jpg/ })).toHaveTextContent('1.5 KB');
    expect(screen.getByRole('button', { name: 'Select this folder' })).toBeEnabled();
  });

  it('single-clicks, double-clicks folders, and navigates with the keyboard', async () => {
    renderExplorer();
    const row = await screen.findByRole('option', { name: /Folder, Pictures/ });
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-selected', 'true');
    fireEvent.doubleClick(row);
    await waitFor(() =>
      expect(vi.mocked(list)).toHaveBeenCalledWith(
        { path: 'Pictures', showHidden: false },
        expect.any(AbortSignal),
      ),
    );
    const listbox = screen.getByRole('listbox');
    listbox.focus();
    fireEvent.keyDown(listbox, { key: 'Backspace' });
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument());
  });

  it('keeps prior rows and offers Retry after a failed navigation', async () => {
    renderExplorer();
    const row = await screen.findByRole('option', { name: /Folder, Pictures/ });
    vi.mocked(list).mockImplementation(({ path }) =>
      path === 'Pictures'
        ? Promise.reject(new ApiClientError('ACCESS_DENIED', 'private', 403))
        : Promise.resolve(listing(path)),
    );
    fireEvent.doubleClick(row);
    expect(
      await screen.findByText('You do not have permission to read this folder.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Folder, Pictures/ })).toBeInTheDocument();
    expect(
      vi.mocked(list).mock.calls.filter(([params]) => params.path === 'Pictures'),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(vi.mocked(list).mock.calls.filter(([params]) => params.path === '')).toHaveLength(2),
    );
  });

  it('falls back from an unavailable restored folder and announces the fallback', async () => {
    const state = createInitialState();
    state.explorer.path = 'Missing';
    vi.mocked(list)
      .mockRejectedValueOnce(new ApiClientError('NOT_FOUND', 'gone', 404))
      .mockResolvedValueOnce(listing(''));
    render(
      <AppStateProvider initialState={state}>
        <Explorer />
      </AppStateProvider>,
    );
    expect(await screen.findByText(/last used is no longer available/)).toBeInTheDocument();
    await screen.findByRole('option', { name: /Folder, Pictures/ });
    expect(vi.mocked(list).mock.calls.map(([params]) => params.path)).toEqual(['Missing', '']);
  });

  it('renders empty, truncation, and initial skeleton states', async () => {
    let resolve!: (value: ListResponse) => void;
    vi.mocked(list).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderExplorer();
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    resolve({ ...listing('', []), truncated: true });
    await waitFor(() => expect(screen.getByText('This folder is empty.')).toBeInTheDocument());
    expect(screen.getByText(/more than 10,000/)).toBeInTheDocument();
  });

  it('prevents root history keys while leaving the root unchanged', async () => {
    renderExplorer();
    await screen.findByRole('option', { name: /Folder, Pictures/ });
    const listbox = screen.getByRole('listbox');
    listbox.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    listbox.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0);
  });
});
