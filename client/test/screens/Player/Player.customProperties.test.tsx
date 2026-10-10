import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ImageItem } from '@slydr/shared';
import { AppStateProvider, createInitialState } from '../../../src/state/AppStateProvider';
import { Player } from '../../../src/screens/Player/Player';

const image: ImageItem = { name: 'one.jpg', path: 'one.jpg', dir: '', size: 1, mtimeMs: 1 };

function renderPlayer(durationSeconds: number, animations = true) {
  const state = createInitialState();
  state.view = 'player';
  state.playlist = [image];
  state.config = { ...state.config, durationSeconds, animations, loop: false };
  return render(
    <AppStateProvider initialState={state}>
      <Player />
    </AppStateProvider>,
  );
}

describe('Player inline motion properties', () => {
  it.each([3, 7, 30])('sets --kb-duration to %ss', (seconds) => {
    renderPlayer(seconds);
    expect(screen.getByTestId('player').getAttribute('style')).toContain(
      `--kb-duration: ${seconds}s`,
    );
  });

  it('sets a zero transition when animations are disabled', () => {
    renderPlayer(7, false);
    expect(screen.getByTestId('player').getAttribute('style')).toContain(
      '--player-transition-dur: 0ms',
    );
  });
});
