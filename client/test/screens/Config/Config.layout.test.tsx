import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Config } from '../../../src/screens/Config';
import { getImages } from '../../../src/api/client';
import { renderConfig, makeConfigState } from '../../helpers/configFixtures';
import { AppStateProvider } from '../../../src/state/AppStateProvider';
import { render } from '@testing-library/react';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImages: vi.fn(),
}));

describe('Config layout', () => {
  beforeEach(() =>
    vi.mocked(getImages).mockResolvedValue({
      path: 'Pictures',
      recursive: false,
      count: 1,
      truncated: false,
      items: [{ name: 'a.jpg', path: 'a.jpg', dir: '', size: 1, mtimeMs: null }],
    }),
  );

  it('renders the heading, wire path, home label, header, and notice', async () => {
    renderConfig(<Config />, { notice: 'The show ended early.' });
    expect(screen.getByRole('heading', { name: 'Pictures' })).toBeInTheDocument();
    expect(screen.getByText('Pictures', { selector: 'p' })).toHaveAttribute('title', 'Pictures');
    expect(screen.getByRole('button', { name: 'Back to file explorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The show ended early.');
  });

  it('returns to the explorer and renders nothing without a selection', () => {
    const state = makeConfigState();
    state.selection = null;
    render(
      <AppStateProvider initialState={state}>
        <Config />
      </AppStateProvider>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(getImages).not.toHaveBeenCalled();
  });

  it('dismisses the player notice and keeps the home title readable', () => {
    const state = makeConfigState();
    state.selection = { path: '', name: 'Home' };
    state.notice = 'notice';
    render(
      <AppStateProvider initialState={state}>
        <Config />
      </AppStateProvider>,
    );
    expect(screen.getByText('Home folder')).toHaveAttribute('title', 'Home folder');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
