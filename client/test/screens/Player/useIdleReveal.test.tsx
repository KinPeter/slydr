import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { useIdleReveal } from '../../../src/screens/Player/useIdleReveal';

afterEach(() => vi.useRealTimers());

describe('useIdleReveal', () => {
  it('starts visible and hides at exactly the timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleReveal());
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(result.current.visible).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.visible).toBe(false);
  });

  it('reveal restarts the timer and a paused hold prevents hiding', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ hold }) => useIdleReveal(2000, { hold }), {
      initialProps: { hold: false },
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.visible).toBe(false);
    act(() => result.current.reveal());
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(result.current.visible).toBe(true);
    rerender({ hold: true });
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(result.current.visible).toBe(true);
  });

  it('restarts after mouse activity and touch or pointer activity reveals', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleReveal());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.visible).toBe(false);

    act(() => window.dispatchEvent(new Event('pointerdown')));
    expect(result.current.visible).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(result.current.visible).toBe(true);
    act(() => window.dispatchEvent(new Event('mousemove')));
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(result.current.visible).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.visible).toBe(false);

    act(() => window.dispatchEvent(new Event('touchstart')));
    expect(result.current.visible).toBe(true);
  });

  it('holds on hover and releases with a fresh timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleReveal());
    act(() => result.current.holdProps.onPointerEnter());
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(result.current.visible).toBe(true);
    act(() => result.current.holdProps.onPointerLeave());
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(result.current.visible).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.visible).toBe(false);
  });

  it('holds while focused and ignores blur to another control', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleReveal());
    const overlay = document.createElement('div');
    const inside = document.createElement('button');
    overlay.append(inside);
    document.body.append(overlay);
    result.current.overlayRef.current = overlay;

    act(() => result.current.holdProps.onFocusCapture());
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(result.current.visible).toBe(true);
    act(() =>
      result.current.holdProps.onBlurCapture({
        relatedTarget: inside,
      } as unknown as React.FocusEvent),
    );
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(result.current.visible).toBe(true);
    act(() =>
      result.current.holdProps.onBlurCapture({
        relatedTarget: null,
      } as unknown as React.FocusEvent),
    );
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(result.current.visible).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.visible).toBe(false);
    overlay.remove();
  });

  it('releases focus after pointer activation so the overlay can hide', async () => {
    vi.useFakeTimers();
    function Harness() {
      const idle = useIdleReveal();
      return (
        <div data-visible={idle.visible ? 'true' : 'false'} {...idle.holdProps}>
          <button type="button">Control</button>
        </div>
      );
    }

    render(<Harness />);
    const button = document.querySelector('button');
    if (!button) throw new Error('Expected the control button to render');
    button?.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.pointerUp(button, { pointerType: 'mouse' });
    expect(document.activeElement).not.toBe(button);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(document.querySelector('button')?.closest('div')).toHaveAttribute(
      'data-visible',
      'false',
    );
  });

  it('removes listeners and timers on unmount', async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIdleReveal());
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(vi.getTimerCount()).toBe(0);
    expect(remove.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(['mousemove', 'pointerdown', 'touchstart']),
    );
    remove.mockRestore();
  });
});
