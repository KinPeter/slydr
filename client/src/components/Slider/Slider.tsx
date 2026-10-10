import { useId } from 'react';
import type React from 'react';
import { cx } from '../../lib/cx';
import styles from './Slider.module.css';

export interface SliderProps extends Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'children' | 'size'
> {
  /** Visible label. Required. */
  label: React.ReactNode;
  value: number; // controlled only
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  /** Arrow-key and pointer step. Default 1. */
  step?: number;
  /** PageUp/PageDown step. Default 5. */
  pageStep?: number;
  /** Formats the number for the visible readout, e.g. (v) => `${v} s`. Default: String(v). */
  formatValue?: (value: number) => string;
  /**
   * Formats the number for aria-valuetext (the spoken form), e.g. (v) => `${v} seconds`.
   * Default: the same function as `formatValue`.
   */
  formatValueText?: (value: number) => string;
  ref?: React.Ref<HTMLInputElement>;
}

function roundToStep(value: number, min: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Number((min + Math.round((value - min) / step) * step).toFixed(10));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Native range input with a live numeric readout.
 *
 * Accessibility contract: the label is a real `<label>`, the spoken value comes
 * from `aria-valuetext` on the input (native range already exposes
 * `aria-valuenow`/`min`/`max`), and the visible `<output>` is `aria-live="off"`.
 * Decision (not specified): the output is deliberately silent because the slider
 * itself already announces through `aria-valuetext`; a live output would double
 * every announcement during a drag. Arrow keys, `Home` and `End` stay native
 * (step 1); only `PageUp`/`PageDown` are intercepted to apply exactly `pageStep`.
 */
export function Slider({
  label,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  pageStep = 5,
  formatValue = String,
  formatValueText,
  ref,
  className,
  id: idProp,
  onKeyDown: restOnKeyDown,
  style: restStyle,
  ...rest
}: SliderProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const describeValue = formatValueText ?? formatValue;

  const displayValue = Number.isFinite(value) ? clamp(value, min, max) : min;
  const span = max - min;
  const fillPercent = span > 0 ? ((displayValue - min) / span) * 100 : 0;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    onValueChange(Number(event.currentTarget.value));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    restOnKeyDown?.(event);
    if (event.defaultPrevented) return;
    // Never swallow browser or screen-reader shortcuts.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let delta = 0;
    if (event.key === 'PageUp') delta = pageStep;
    else if (event.key === 'PageDown') delta = -pageStep;
    else return; // arrows, Home, End: leave to the browser
    // preventDefault is essential: without it the browser also applies its own
    // (browser-specific, often 10%-of-range) page step and the value moves twice.
    event.preventDefault();
    const next = clamp(roundToStep(displayValue + delta, min, step), min, max);
    if (next !== displayValue) onValueChange(next);
  }

  return (
    <div className={cx(styles.root, className)}>
      <div className={styles.header}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        <output htmlFor={id} aria-live="off" className={styles.readout}>
          {formatValue(displayValue)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className={styles.input}
        min={min}
        max={max}
        step={step}
        value={displayValue}
        aria-valuetext={describeValue(displayValue)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        ref={ref}
        style={{ ...restStyle, '--slider-fill': `${fillPercent}%` } as React.CSSProperties}
        {...rest}
      />
    </div>
  );
}
