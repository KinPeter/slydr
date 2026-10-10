import { render } from '@testing-library/react';
import { describe, it } from 'vitest';
import { AppStateProvider, createInitialState } from '../../src/state/AppStateProvider';
import { Player } from '../../src/screens/Player';
import { checkA11y } from '../helpers/axe';

describe('player accessibility regression', () => {
  it('has no axe violations while playing', async () => {
    const state = createInitialState();
    state.view = 'player';
    state.selection = { path: 'Pictures', name: 'Pictures' };
    state.playlist = [
      { name: 'photo.jpg', path: 'photo.jpg', dir: 'Pictures', size: 1, mtimeMs: null },
    ];
    const { container } = render(
      <AppStateProvider initialState={state}>
        <Player />
      </AppStateProvider>,
    );
    await checkA11y(container);
  });
});
