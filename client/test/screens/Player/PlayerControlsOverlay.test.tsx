import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayerControlsOverlay } from '../../../src/screens/Player/PlayerControlsOverlay';

describe('PlayerControlsOverlay', () => {
  const props = () => ({
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onTogglePause: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onStop: vi.fn(),
    paused: false,
    fullscreen: false,
    index: 7,
    total: 412,
    visible: true,
    holdProps: {
      onPointerEnter: vi.fn(),
      onPointerLeave: vi.fn(),
      onFocusCapture: vi.fn(),
      onBlurCapture: vi.fn(),
    },
  });

  it('renders the five controls and counter in the required state', () => {
    render(<PlayerControlsOverlay {...props()} />);
    expect(screen.getByRole('toolbar', { name: 'Slide show controls' })).toBeInTheDocument();
    expect(screen.getByText('7 / 412')).toBeInTheDocument();
    for (const name of [
      'Previous image',
      'Pause slide show',
      'Next image',
      'Enter full screen',
      'Stop slide show',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('calls each action and exposes hidden inert state', () => {
    const values = props();
    const { rerender } = render(<PlayerControlsOverlay {...values} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause slide show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enter full screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop slide show' }));
    expect(values.onPrev).toHaveBeenCalledOnce();
    expect(values.onTogglePause).toHaveBeenCalledOnce();
    expect(values.onNext).toHaveBeenCalledOnce();
    expect(values.onToggleFullscreen).toHaveBeenCalledOnce();
    expect(values.onStop).toHaveBeenCalledOnce();
    rerender(<PlayerControlsOverlay {...values} visible={false} />);
    expect(screen.getByRole('toolbar', { hidden: true })).toHaveAttribute('data-visible', 'false');
    expect(screen.getByRole('toolbar', { hidden: true })).toHaveAttribute('inert');
  });
});
