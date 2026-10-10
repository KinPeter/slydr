import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlayerKeyboard } from '../../../src/screens/Player/usePlayerKeyboard';
import type { PlayerControls } from '../../../src/screens/Player/types';

function Harness({ controls, reveal }: { controls: PlayerControls; reveal: () => void }) {
  usePlayerKeyboard({ controls, reveal });
  return <button type="button">focused</button>;
}

function controls(): PlayerControls {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    togglePause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    toggleFullscreen: vi.fn(),
    stop: vi.fn(),
  };
}

describe('usePlayerKeyboard', () => {
  it('dispatches shortcuts and prevents scrolling keys', () => {
    const value = controls();
    const reveal = vi.fn();
    const { unmount } = render(<Harness controls={value} reveal={reveal} />);
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    window.dispatchEvent(space);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'F', shiftKey: true });
    expect(space.defaultPrevented).toBe(true);
    expect(value.togglePause).toHaveBeenCalledOnce();
    expect(value.previous).toHaveBeenCalledOnce();
    expect(value.next).toHaveBeenCalledOnce();
    expect(value.stop).toHaveBeenCalledOnce();
    expect(value.toggleFullscreen).toHaveBeenCalledTimes(2);
    expect(reveal).toHaveBeenCalledTimes(6);
    unmount();
    fireEvent.keyDown(window, { key: 'f' });
    expect(value.toggleFullscreen).toHaveBeenCalledTimes(2);
  });

  it('guards modifiers and focused button Space, but keeps arrow shortcuts', () => {
    const value = controls();
    render(<Harness controls={value} reveal={vi.fn()} />);
    const button = document.querySelector('button');
    expect(button).not.toBeNull();
    if (!button) throw new Error('button not rendered');
    button.focus();
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    const modified = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(modified);
    fireEvent.keyDown(window, { key: 'f', isComposing: true });
    expect(value.togglePause).not.toHaveBeenCalled();
    expect(value.next).toHaveBeenCalledOnce();
    expect(value.toggleFullscreen).not.toHaveBeenCalled();
    expect(modified.defaultPrevented).toBe(false);
  });

  it('does not handle text entry and only prevents Space and arrows', () => {
    const value = controls();
    render(
      <>
        <Harness controls={value} reveal={vi.fn()} />
        <input aria-label="text entry" />
      </>,
    );
    const input = document.querySelector('input');
    expect(input).not.toBeNull();
    if (!input) throw new Error('input not rendered');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(value.next).not.toHaveBeenCalled();
    expect(value.stop).not.toHaveBeenCalled();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    const fullscreen = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    window.dispatchEvent(escape);
    window.dispatchEvent(fullscreen);
    expect(escape.defaultPrevented).toBe(false);
    expect(fullscreen.defaultPrevented).toBe(false);
    expect(value.stop).toHaveBeenCalledOnce();
    expect(value.toggleFullscreen).toHaveBeenCalledOnce();
  });

  it('ignores repeat Space, fullscreen, and Escape while revealing controls', () => {
    const value = controls();
    const reveal = vi.fn();
    render(<Harness controls={value} reveal={reveal} />);

    fireEvent.keyDown(window, { key: ' ', repeat: true, cancelable: true });
    fireEvent.keyDown(window, { key: 'f', repeat: true });
    fireEvent.keyDown(window, { key: 'Escape', repeat: true });

    expect(value.togglePause).not.toHaveBeenCalled();
    expect(value.toggleFullscreen).not.toHaveBeenCalled();
    expect(value.stop).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledTimes(3);
  });

  it('throttles repeated arrows to one action every 250 milliseconds', () => {
    vi.useFakeTimers();
    try {
      const value = controls();
      const reveal = vi.fn();
      render(<Harness controls={value} reveal={reveal} />);

      fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
      vi.advanceTimersByTime(100);
      fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
      vi.advanceTimersByTime(150);
      fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
      vi.advanceTimersByTime(10);
      fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
      vi.advanceTimersByTime(240);
      fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });

      expect(value.next).toHaveBeenCalledTimes(3);
      expect(reveal).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds one window listener and removes it on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const value = controls();
    const { unmount } = render(<Harness controls={value} reveal={vi.fn()} />);

    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function));
    unmount();
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    add.mockRestore();
    remove.mockRestore();
  });
});
