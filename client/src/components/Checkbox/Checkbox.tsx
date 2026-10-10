import { Check } from 'lucide-react';
import { useId } from 'react';
import type React from 'react';
import { cx } from '../../lib/cx';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'type' | 'role' | 'checked' | 'defaultChecked' | 'onChange' | 'children' | 'size'
> {
  /** Visible label text. Required; there is no label-less checkbox. */
  label: React.ReactNode;
  /** Optional secondary text linked with aria-describedby, e.g. "Play them in random order". */
  description?: React.ReactNode;
  /**
   * Optional extra text rendered OUTSIDE the label and linked with aria-describedby
   * (for example the reduced-motion note of T029). It never becomes part of the accessible name.
   */
  note?: React.ReactNode;
  checked: boolean; // controlled only
  onCheckedChange: (checked: boolean) => void;
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * Native checkbox with a token-drawn box-and-tick visual.
 *
 * Accessibility contract: a real `<input type="checkbox">` with a visible
 * `<label>`, so screen readers announce "checkbox, checked / not checked" with
 * free `Space` handling. Never `role="switch"` and never `aria-checked`. The
 * `description` lives inside the label while the `note` stays outside it, so the
 * note is announced as a description but never leaks into the accessible name.
 * Controlled only: the configuration screen's state is the single source of truth.
 */
export function Checkbox({
  label,
  description,
  note,
  checked,
  onCheckedChange,
  ref,
  className,
  id: idProp,
  'aria-describedby': ariaDescribedby,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const descriptionId = `${id}-description`;
  const noteId = `${id}-note`;
  const describedBy =
    [
      description !== undefined ? descriptionId : null,
      note !== undefined ? noteId : null,
      ariaDescribedby ?? null,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(' ') || undefined;

  return (
    <div className={styles.wrapper}>
      <label className={cx(styles.root, className)} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className={styles.input}
          checked={checked}
          onChange={(event) => onCheckedChange(event.currentTarget.checked)}
          aria-describedby={describedBy}
          ref={ref}
          {...rest}
        />
        <span className={styles.box} aria-hidden="true">
          <Check
            className={styles.tick}
            size={16}
            strokeWidth={3}
            aria-hidden="true"
            focusable="false"
          />
        </span>
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
          {description !== undefined && (
            <span id={descriptionId} className={styles.description}>
              {description}
            </span>
          )}
        </span>
      </label>
      {note !== undefined && (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      )}
    </div>
  );
}
