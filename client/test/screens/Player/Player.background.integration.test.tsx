import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayerBackground } from '../../../src/screens/Player/PlayerBackground';
import { PlayerStage } from '../../../src/screens/Player/PlayerStage';
import type {
  PlayerControls,
  PlayerEngineState,
  PlayerSlide,
} from '../../../src/screens/Player/types';

function slide(key: string, src: string): PlayerSlide {
  return {
    key,
    position: 0,
    cycle: 0,
    item: { name: `${key}.jpg`, path: `${key}.jpg`, dir: '', size: 1, mtimeMs: 1 },
    src,
  };
}

const config = {
  durationSeconds: 5,
  shuffle: false,
  loop: true,
  animations: true,
  fillEmptySpace: true,
  startFullScreen: false,
  includeSubfolders: false,
};

const controls: PlayerControls = {
  play: vi.fn(),
  pause: vi.fn(),
  togglePause: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  toggleFullscreen: vi.fn(),
  stop: vi.fn(),
};

function state(current: PlayerSlide, previous: PlayerSlide | null): PlayerEngineState {
  return {
    status: 'playing',
    current,
    previous,
    next: null,
    swapReason: previous === null ? 'initial' : 'auto',
    durationMs: 5000,
    counter: { index: 0, total: 2 },
    isFullscreen: false,
    error: null,
    interrupted: false,
    preloadSources: [],
  };
}

describe('PlayerStage background integration', () => {
  it('renders the reused background source alongside the foreground source', () => {
    const current = slide('current', '/api/image?path=current.jpg');
    const { container } = render(
      <PlayerStage
        state={state(current, null)}
        controls={controls}
        config={config}
        registerLayer={vi.fn()}
        reportLoadError={vi.fn()}
        reportLoadSuccess={vi.fn()}
        background={<PlayerBackground fillEmptySpace current={current} previous={null} />}
      />,
    );
    const foreground = container.querySelector('img:not([data-bg])');
    const background = container.querySelector('img[data-bg="true"]');

    expect(foreground).not.toBeNull();
    expect(background).not.toBeNull();
    expect(background).toHaveAttribute('src', foreground?.getAttribute('src'));
  });
});
