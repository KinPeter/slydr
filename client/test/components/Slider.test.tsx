import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from '../../src/components/Slider';

function renderSlider(overrides: Partial<ComponentProps<typeof Slider>> = {}) {
  const onValueChange = vi.fn();
  render(
    <Slider
      label="Duration for image shown"
      value={5}
      onValueChange={onValueChange}
      min={1}
      max={30}
      {...overrides}
    />,
  );
  return { onValueChange };
}

function sliderInput(): HTMLInputElement {
  return screen.getByRole('slider', { name: 'Duration for image shown' }) as HTMLInputElement;
}

describe('Slider', () => {
  it('renders range input, label and an output with formatted value', () => {
    render(
      <Slider
        label="Duration for image shown"
        value={5}
        onValueChange={() => undefined}
        min={1}
        max={30}
        formatValue={(v) => `${v} s`}
        formatValueText={(v) => `${v} seconds`}
      />,
    );
    const input = sliderInput();
    expect(input).toHaveAttribute('type', 'range');
    const output = document.querySelector('output');
    expect(output).not.toBeNull();
    expect(output).toHaveTextContent('5 s');
    expect(output).toHaveAttribute('aria-live', 'off');
    expect(input).toHaveAttribute('aria-valuetext', '5 seconds');
  });

  it('falls back to formatValue for aria-valuetext', () => {
    render(
      <Slider
        label="Duration for image shown"
        value={5}
        onValueChange={() => undefined}
        min={1}
        max={30}
        formatValue={(v) => `${v} s`}
      />,
    );
    expect(sliderInput()).toHaveAttribute('aria-valuetext', '5 s');
  });

  it('change events map to onValueChange with a number', () => {
    const { onValueChange } = renderSlider();
    // jsdom does not implement native arrow-key stepping on range inputs, so the
    // test simulates the browser's result; native stepping stays the browser's job.
    fireEvent.change(sliderInput(), { target: { value: '6' } });
    expect(onValueChange).toHaveBeenCalledWith(6);
    expect(typeof onValueChange.mock.calls[0]?.[0]).toBe('number');
  });

  it('PageUp adds 5 and PageDown subtracts 5', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Slider
        label="Duration for image shown"
        value={5}
        onValueChange={onValueChange}
        min={1}
        max={30}
      />,
    );
    const preventedUp = fireEvent.keyDown(sliderInput(), { key: 'PageUp' });
    expect(preventedUp).toBe(false);
    expect(onValueChange).toHaveBeenCalledWith(10);

    rerender(
      <Slider
        label="Duration for image shown"
        value={3}
        onValueChange={onValueChange}
        min={1}
        max={30}
      />,
    );
    const preventedDown = fireEvent.keyDown(sliderInput(), { key: 'PageDown' });
    expect(preventedDown).toBe(false);
    // 3 - 5 clamps to min 1.
    expect(onValueChange).toHaveBeenCalledWith(1);
  });

  it('PageUp clamps at max and does not call onValueChange when already at max', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Slider
        label="Duration for image shown"
        value={28}
        onValueChange={onValueChange}
        min={1}
        max={30}
      />,
    );
    fireEvent.keyDown(sliderInput(), { key: 'PageUp' });
    expect(onValueChange).toHaveBeenCalledWith(30);

    rerender(
      <Slider
        label="Duration for image shown"
        value={30}
        onValueChange={onValueChange}
        min={1}
        max={30}
      />,
    );
    onValueChange.mockClear();
    fireEvent.keyDown(sliderInput(), { key: 'PageUp' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('ignores PageUp when a modifier is held', () => {
    const { onValueChange } = renderSlider();
    const prevented = fireEvent.keyDown(sliderInput(), { key: 'PageUp', ctrlKey: true });
    expect(prevented).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('supports a custom pageStep', () => {
    const { onValueChange } = renderSlider({ pageStep: 10 });
    fireEvent.keyDown(sliderInput(), { key: 'PageUp' });
    expect(onValueChange).toHaveBeenCalledWith(15);
  });

  it('clamps out-of-range and non-finite values for display', () => {
    const { rerender } = render(
      <Slider
        label="Duration for image shown"
        value={999}
        onValueChange={() => undefined}
        min={1}
        max={30}
      />,
    );
    expect(sliderInput().value).toBe('30');

    rerender(
      <Slider
        label="Duration for image shown"
        value={Number.NaN}
        onValueChange={() => undefined}
        min={1}
        max={30}
      />,
    );
    const input = sliderInput();
    expect(input.value).not.toBe('NaN');
    expect(Number(input.value)).toBe(1);
  });

  it('sets the --slider-fill custom property proportional to the value', () => {
    const { rerender } = render(
      <Slider
        label="Duration for image shown"
        value={1}
        onValueChange={() => undefined}
        min={1}
        max={30}
      />,
    );
    expect(sliderInput().style.getPropertyValue('--slider-fill')).toBe('0%');

    rerender(
      <Slider
        label="Duration for image shown"
        value={30}
        onValueChange={() => undefined}
        min={1}
        max={30}
      />,
    );
    expect(sliderInput().style.getPropertyValue('--slider-fill')).toBe('100%');

    rerender(
      <Slider
        label="Duration for image shown"
        value={5}
        onValueChange={() => undefined}
        min={1}
        max={30}
      />,
    );
    expect(sliderInput().style.getPropertyValue('--slider-fill')).toBe(
      `${((5 - 1) / (30 - 1)) * 100}%`,
    );
  });
});
