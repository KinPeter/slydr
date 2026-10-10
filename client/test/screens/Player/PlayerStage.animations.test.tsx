import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImageItem, SlideshowConfig } from '@slydr/shared';
import { PlayerStage } from '../../../src/screens/Player/PlayerStage';
import type { PlayerEngineState, PlayerSlide } from '../../../src/screens/Player/types';

const config: SlideshowConfig = {
  durationSeconds: 7,
  shuffle: false,
  loop: true,
  animations: true,
  fillEmptySpace: false,
  startFullScreen: false,
  includeSubfolders: false,
};
const slide = (position: number, cycle = 0): PlayerSlide => {
  const item: ImageItem = {
    name: `${position}.jpg`,
    path: `${position}.jpg`,
    dir: '',
    size: 1,
    mtimeMs: 1,
  };
  return {
    key: `${cycle}:${position}`,
    position,
    cycle,
    item,
    src: `/api/image?path=${position}.jpg`,
  };
};
const state = (
  previous: PlayerSlide | null = slide(0),
  current = slide(1),
  next = slide(2),
): PlayerEngineState => ({
  status: 'playing',
  previous,
  current,
  next,
  swapReason: 'auto',
  durationMs: 7000,
  counter: { index: 2, total: 3 },
  isFullscreen: false,
  error: null,
  interrupted: false,
  preloadSources: [],
});
const renderStage = (value: PlayerEngineState, animations: boolean) =>
  render(
    <PlayerStage
      state={value}
      controls={{
        play: vi.fn(),
        pause: vi.fn(),
        togglePause: vi.fn(),
        next: vi.fn(),
        previous: vi.fn(),
        toggleFullscreen: vi.fn(),
        stop: vi.fn(),
      }}
      config={config}
      animations={animations}
      releasePrevious={vi.fn()}
      registerLayer={vi.fn()}
      reportLoadError={vi.fn()}
      reportLoadSuccess={vi.fn()}
    />,
  );

describe('PlayerStage motion rendering', () => {
  it('renders static current and next without a previous layer when animations are off', () => {
    renderStage(state(), false);
    expect(document.querySelectorAll('[data-role="previous"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-motion="static"]')).toHaveLength(2);
    expect(screen.getByTestId('slide-current')).toHaveAttribute(
      'src',
      expect.stringContaining('1.jpg'),
    );
  });

  it('renders all animated slots, one image per layer, and pauses every image', () => {
    const value = state();
    value.status = 'paused';
    renderStage(value, true);
    expect(document.querySelectorAll('[data-motion="animated"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-role] img')).toHaveLength(3);
    expect(
      document.querySelectorAll('[data-role="current"] [data-testid="slide-current"]'),
    ).toHaveLength(1);
    expect(document.querySelectorAll('img[style*="paused"]')).toHaveLength(3);
  });

  it('keeps a fragment boundary rather than adding a stage wrapper', () => {
    const { container } = renderStage(state(), true);
    expect(container.firstElementChild).toHaveClass('layerBackground');
    expect(container.children).toHaveLength(3);
  });
});
