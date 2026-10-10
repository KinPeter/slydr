import { describe, expect, it } from 'vitest';
import { columnsFor, GRID_MIN_TILE_PX } from '../../../src/screens/Explorer/gridMetrics';

describe('grid metrics', () => {
  it('uses the responsive minimum tile sizes', () => {
    expect(GRID_MIN_TILE_PX).toEqual({ base: 104, md: 132, lg: 160 });
  });

  it('calculates auto-fill columns and never returns zero', () => {
    expect(columnsFor(288, 12, 104)).toBe(2);
    expect(columnsFor(0, 12, 104)).toBe(1);
    expect(columnsFor(900, 12, 160)).toBe(5);
  });
});
