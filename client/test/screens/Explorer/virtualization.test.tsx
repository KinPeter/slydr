import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  useVirtualizationMode,
  VIRTUALIZE_ABOVE,
  DEVIRTUALIZE_BELOW,
} from '../../../src/screens/Explorer/virtualization';

function Probe({
  path,
  count,
  onValue,
}: {
  path: string;
  count: number;
  onValue: (value: boolean) => void;
}) {
  onValue(useVirtualizationMode(path, count));
  return null;
}

describe('useVirtualizationMode', () => {
  it('uses the threshold and hysteresis band, then resets for a new path', () => {
    const values: boolean[] = [];
    const { rerender } = render(
      <Probe path="a" count={VIRTUALIZE_ABOVE} onValue={(v) => values.push(v)} />,
    );
    expect(values.at(-1)).toBe(false);
    rerender(<Probe path="a" count={VIRTUALIZE_ABOVE + 1} onValue={(v) => values.push(v)} />);
    expect(values.at(-1)).toBe(true);
    rerender(<Probe path="a" count={DEVIRTUALIZE_BELOW} onValue={(v) => values.push(v)} />);
    expect(values.at(-1)).toBe(true);
    rerender(<Probe path="a" count={DEVIRTUALIZE_BELOW - 1} onValue={(v) => values.push(v)} />);
    expect(values.at(-1)).toBe(false);
    rerender(<Probe path="b" count={DEVIRTUALIZE_BELOW + 1} onValue={(v) => values.push(v)} />);
    expect(values.at(-1)).toBe(false);
  });
});
