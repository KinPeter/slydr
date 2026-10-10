import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageItem } from '@slydr/shared';
import { AppStateProvider, createInitialState } from '../../../src/state/AppStateProvider';
import { Player } from '../../../src/screens/Player/Player';

const images: ImageItem[] = [
  { name: 'one.jpg', path: 'one.jpg', dir: '', size: 1, mtimeMs: 1 },
  { name: 'two.jpg', path: 'two.jpg', dir: '', size: 1, mtimeMs: 1 },
];

function renderPlayer() {
  const state = createInitialState();
  state.view = 'player';
  state.selection = { path: '', name: 'Home' };
  state.playlist = images;
  state.config = { ...state.config, durationSeconds: 30, loop: false };
  return render(
    <AppStateProvider initialState={state}>
      <Player />
    </AppStateProvider>,
  );
}

afterEach(() => vi.useRealTimers());

describe('Player controls integration', () => {
  it('auto-hides, restores the cursor attribute, and responds to mouse activity', async () => {
    vi.useFakeTimers();
    renderPlayer();
    const player = screen.getByTestId('player');
    expect(player).toHaveAttribute('data-chrome', 'visible');
    await act(async () => vi.advanceTimersByTimeAsync(1999));
    expect(player).toHaveAttribute('data-chrome', 'visible');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(player).toHaveAttribute('data-chrome', 'hidden');
    fireEvent.mouseMove(window);
    expect(player).toHaveAttribute('data-chrome', 'visible');
  });

  it('keeps controls visible while paused, hovered, or focused', async () => {
    vi.useFakeTimers();
    renderPlayer();
    const pause = screen.getByRole('button', { name: 'Pause slide show' });
    fireEvent.click(pause);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(screen.getByTestId('player')).toHaveAttribute('data-chrome', 'visible');

    const next = screen.getByRole('button', { name: 'Next image' });
    fireEvent.focus(next);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(screen.getByTestId('player')).toHaveAttribute('data-chrome', 'visible');
  });

  it('reveals on a touch tap without activating a control', async () => {
    vi.useFakeTimers();
    renderPlayer();
    const player = screen.getByTestId('player');
    const next = screen.getByRole('button', { name: 'Next image' });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(player).toHaveAttribute('data-chrome', 'hidden');
    fireEvent.pointerDown(player, { pointerType: 'touch' });
    expect(player).toHaveAttribute('data-chrome', 'visible');
    expect(screen.getByRole('button', { name: 'Next image' })).toBe(next);
  });

  it('reveals with Tab and exposes the first button', async () => {
    vi.useFakeTimers();
    renderPlayer();
    const player = screen.getByTestId('player');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(player).toHaveAttribute('data-chrome', 'visible');
    const previous = screen.getByRole('button', { name: 'Previous image' });
    previous.focus();
    expect(document.activeElement).toBe(previous);
  });

  it('follows engine fullscreen state and renders the 1-based counter', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.resolve(),
    });
    renderPlayer();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    const element = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element });
    fireEvent(document, new Event('fullscreenchange'));
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    fireEvent(document, new Event('fullscreenchange'));
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toBeInTheDocument();
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  });
});
