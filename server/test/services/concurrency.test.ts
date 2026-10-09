import { describe, it, expect } from 'vitest';
import { mapPool, STAT_CONCURRENCY } from '../../src/services/concurrency.js';

describe('mapPool', () => {
  it('processes an empty list', async () => {
    const result = await mapPool([], 1, async (x) => x);
    expect(result).toEqual([]);
  });

  it('preserves result order even when operations complete out of order', async () => {
    const delays = [10, 50, 30, 20];
    const result = await mapPool(delays, 2, async (delayMs) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return delayMs * 2;
    });
    expect(result).toEqual([20, 100, 60, 40]);
  });

  it('rejects with the first error encountered', async () => {
    const result = mapPool([1, 2, 3], 2, async (x) => {
      if (x === 2) throw new Error('fail on 2');
      return x;
    });
    await expect(result).rejects.toThrow('fail on 2');
  });

  it('never exceeds the concurrency limit', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const result = await mapPool(
      Array.from({ length: 20 }, (_, i) => i),
      5,
      async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return 1;
      },
    );

    expect(result).toHaveLength(20);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it('throws RangeError when limit < 1', async () => {
    await expect(mapPool([], 0, async () => 1)).rejects.toThrow(RangeError);
    await expect(mapPool([], -1, async () => 1)).rejects.toThrow(RangeError);
  });

  it('works with a limit larger than the item count', async () => {
    const result = await mapPool([1, 2, 3], 100, async (x) => x * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it('has STAT_CONCURRENCY constant set to 64', () => {
    expect(STAT_CONCURRENCY).toBe(64);
  });
});
