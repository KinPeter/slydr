import { describe, expect, it, vi } from 'vitest';
import {
  buildPlayOrder,
  cryptoRandomInt,
  identityOrder,
  shuffleInPlace,
} from '../../../src/screens/Player/playOrder';

describe('identityOrder', () => {
  it('returns an empty array for length 0', () => expect(identityOrder(0)).toEqual([]));
  it('returns the identity order', () => expect(identityOrder(4)).toEqual([0, 1, 2, 3]));
});

describe('shuffleInPlace', () => {
  it('mutates and returns a permutation', () => {
    const items = [0, 1, 2, 3];
    const result = shuffleInPlace(items, () => 0);
    expect(result).toBe(items);
    expect([...result].sort()).toEqual([0, 1, 2, 3]);
  });
  it('uses each descending bound', () => {
    const calls: number[] = [];
    shuffleInPlace([0, 1, 2], (max) => {
      calls.push(max);
      return 0;
    });
    expect(calls).toEqual([3, 2]);
  });
});

describe('cryptoRandomInt', () => {
  it('returns zero for a unit range', () => expect(cryptoRandomInt(1)).toBe(0));
  it('uses crypto and rejects an out-of-range draw', () => {
    const getRandomValues = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementationOnce((values) => {
        (values as Uint32Array)[0] = 0xffff_ffff;
        return values;
      })
      .mockImplementationOnce((values) => {
        (values as Uint32Array)[0] = 7;
        return values;
      });
    expect(cryptoRandomInt(10)).toBe(7);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    getRandomValues.mockRestore();
  });
});

describe('buildPlayOrder', () => {
  it('keeps deterministic order when shuffle is off', () => {
    expect(buildPlayOrder(4, false, () => 0, 3)).toEqual([0, 1, 2, 3]);
  });
  it('returns a permutation and avoids the previous final image', () => {
    const result = buildPlayOrder(4, true, () => 0, 0);
    expect([...result].sort()).toEqual([0, 1, 2, 3]);
    expect(result[0]).not.toBe(0);
  });
  it('handles empty and one-image playlists', () => {
    expect(buildPlayOrder(0, true)).toEqual([]);
    expect(buildPlayOrder(1, true, () => 0, 0)).toEqual([0]);
  });
});
