import { describe, it, expect } from 'vitest';
import type { SlideshowConfig } from '../src/index.js';
import {
  DEFAULT_CONFIG,
  MIN_DURATION_SECONDS,
  MAX_DURATION_SECONDS,
  parseConfig,
} from '../src/index.js';

function deepClone(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('DEFAULT_CONFIG', () => {
  it('sets durationSeconds to 5', () => {
    expect(DEFAULT_CONFIG.durationSeconds).toBe(5);
  });

  it('enables shuffle, loop, animations, fillEmptySpace and startFullScreen', () => {
    expect(DEFAULT_CONFIG.shuffle).toBe(true);
    expect(DEFAULT_CONFIG.loop).toBe(true);
    expect(DEFAULT_CONFIG.animations).toBe(true);
    expect(DEFAULT_CONFIG.fillEmptySpace).toBe(true);
    expect(DEFAULT_CONFIG.startFullScreen).toBe(true);
  });

  it('disables includeSubfolders, per resolved decision D1', () => {
    expect(DEFAULT_CONFIG.includeSubfolders).toBe(false);
  });

  it('has exactly the seven SlideshowConfig keys', () => {
    expect(Object.keys(DEFAULT_CONFIG)).toEqual([
      'durationSeconds',
      'shuffle',
      'loop',
      'animations',
      'fillEmptySpace',
      'startFullScreen',
      'includeSubfolders',
    ]);
  });
});

describe('duration bounds', () => {
  it('exposes MIN_DURATION_SECONDS as 1 and MAX_DURATION_SECONDS as 30, matching the §8.2 slider range', () => {
    expect(MIN_DURATION_SECONDS).toBe(1);
    expect(MAX_DURATION_SECONDS).toBe(30);
  });

  it('places the default duration inside the bounds', () => {
    expect(DEFAULT_CONFIG.durationSeconds).toBeGreaterThanOrEqual(MIN_DURATION_SECONDS);
    expect(DEFAULT_CONFIG.durationSeconds).toBeLessThanOrEqual(MAX_DURATION_SECONDS);
  });
});

describe('parseConfig with non-record input', () => {
  it('returns the defaults for undefined', () => {
    const result = parseConfig(undefined);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for null', () => {
    const result = parseConfig(null);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for a string', () => {
    const result = parseConfig('string');
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for a number', () => {
    const result = parseConfig(42);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for a boolean', () => {
    const result = parseConfig(true);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for an empty array', () => {
    const result = parseConfig([]);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for a populated array', () => {
    const result = parseConfig([1, 2, 3]);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for a function', () => {
    const fn = (): void => undefined;
    const result = parseConfig(fn);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns the defaults for an empty object', () => {
    const result = parseConfig({});
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });

  it('returns a fresh object rather than a reference to DEFAULT_CONFIG', () => {
    const result = parseConfig(undefined);
    expect(result).not.toBe(DEFAULT_CONFIG);
    expect(deepEqual(result, DEFAULT_CONFIG)).toBe(true);
  });
});

describe('parseConfig durationSeconds clamping', () => {
  it('clamps 0 up to 1', () => {
    expect(parseConfig({ durationSeconds: 0 }).durationSeconds).toBe(1);
  });

  it('clamps -5 up to 1', () => {
    expect(parseConfig({ durationSeconds: -5 }).durationSeconds).toBe(1);
  });

  it('clamps 31 down to 30', () => {
    expect(parseConfig({ durationSeconds: 31 }).durationSeconds).toBe(30);
  });

  it('clamps 1e9 down to 30', () => {
    expect(parseConfig({ durationSeconds: 1e9 }).durationSeconds).toBe(30);
  });

  it('accepts the inclusive lower bound 1', () => {
    expect(parseConfig({ durationSeconds: 1 }).durationSeconds).toBe(1);
  });

  it('accepts the inclusive upper bound 30', () => {
    expect(parseConfig({ durationSeconds: 30 }).durationSeconds).toBe(30);
  });
});

describe('parseConfig durationSeconds rounding', () => {
  it('rounds 7.6 to 8', () => {
    expect(parseConfig({ durationSeconds: 7.6 }).durationSeconds).toBe(8);
  });

  it('rounds 7.4 to 7', () => {
    expect(parseConfig({ durationSeconds: 7.4 }).durationSeconds).toBe(7);
  });

  it('rounds 7.5 up to 8, Math.round being half-up', () => {
    expect(parseConfig({ durationSeconds: 7.5 }).durationSeconds).toBe(8);
  });

  it('rounds 0.4 to 0 and then clamps it to 1', () => {
    expect(parseConfig({ durationSeconds: 0.4 }).durationSeconds).toBe(1);
  });

  it('rounds 30.6 to 31 and then clamps it to 30', () => {
    expect(parseConfig({ durationSeconds: 30.6 }).durationSeconds).toBe(30);
  });

  it('always returns an integer for a long list of fractional inputs', () => {
    const fractionalInputs = [0.1, 1.1, 1.5, 1.9, 2.2, 5.5, 10.3, 15.7, 20.1, 29.9, 30.4];
    fractionalInputs.forEach((input) => {
      const result = parseConfig({ durationSeconds: input });
      expect(Number.isInteger(result.durationSeconds)).toBe(true);
    });
  });
});

describe('parseConfig durationSeconds invalid values', () => {
  it('falls back to 5 for NaN', () => {
    expect(parseConfig({ durationSeconds: NaN }).durationSeconds).toBe(5);
  });

  it('falls back to 5 for Infinity rather than clamping to 30', () => {
    expect(parseConfig({ durationSeconds: Infinity }).durationSeconds).toBe(5);
  });

  it('falls back to 5 for -Infinity rather than clamping to 1', () => {
    expect(parseConfig({ durationSeconds: -Infinity }).durationSeconds).toBe(5);
  });

  it('falls back to 5 for the string "5", which is rejected rather than coerced', () => {
    expect(parseConfig({ durationSeconds: '5' as unknown as number }).durationSeconds).toBe(5);
  });

  it('falls back to 5 for the string "7", proving string numerics are not coerced', () => {
    expect(parseConfig({ durationSeconds: '7' as unknown as number }).durationSeconds).toBe(5);
  });

  it('falls back to 5 for null', () => {
    expect(parseConfig({ durationSeconds: null as unknown as number }).durationSeconds).toBe(5);
  });

  it('falls back to 5 for true', () => {
    expect(parseConfig({ durationSeconds: true as unknown as number }).durationSeconds).toBe(5);
  });

  it('falls back to 5 for an object', () => {
    expect(parseConfig({ durationSeconds: {} as unknown as number }).durationSeconds).toBe(5);
  });
});

describe('parseConfig boolean fields', () => {
  it('keeps a legitimate false for each of the six boolean options', () => {
    const booleanKeys: (keyof Omit<SlideshowConfig, 'durationSeconds'>)[] = [
      'shuffle',
      'loop',
      'animations',
      'fillEmptySpace',
      'startFullScreen',
      'includeSubfolders',
    ];

    booleanKeys.forEach((key) => {
      const input = { [key]: false };
      expect(parseConfig(input)[key]).toBe(false);
    });
  });

  it('keeps a legitimate true for each of the six boolean options', () => {
    const booleanKeys: (keyof Omit<SlideshowConfig, 'durationSeconds'>)[] = [
      'shuffle',
      'loop',
      'animations',
      'fillEmptySpace',
      'startFullScreen',
      'includeSubfolders',
    ];

    booleanKeys.forEach((key) => {
      const input = { [key]: true };
      expect(parseConfig(input)[key]).toBe(true);
    });
  });

  it('falls back to the default for the string "false"', () => {
    expect(parseConfig({ shuffle: 'false' as unknown as boolean }).shuffle).toBe(true);
  });

  it('falls back to the default for the string "true"', () => {
    expect(parseConfig({ shuffle: 'true' as unknown as boolean }).shuffle).toBe(true);
  });

  it('does not turn includeSubfolders on for the string "true"', () => {
    expect(parseConfig({ includeSubfolders: 'true' as unknown as boolean }).includeSubfolders).toBe(
      false,
    );
  });

  it('falls back to the default for 0, proving truthiness is not applied', () => {
    expect(parseConfig({ shuffle: 0 as unknown as boolean }).shuffle).toBe(true);
  });

  it('falls back to the default for 1', () => {
    expect(parseConfig({ shuffle: 1 as unknown as boolean }).shuffle).toBe(true);
  });

  it('falls back to the default for null', () => {
    expect(parseConfig({ shuffle: null as unknown as boolean }).shuffle).toBe(true);
  });

  it('treats a present-but-undefined field as missing', () => {
    expect(parseConfig({ fillEmptySpace: undefined }).fillEmptySpace).toBe(true);
  });

  it('falls back to the default for an object or array value', () => {
    expect(parseConfig({ shuffle: {} as unknown as boolean }).shuffle).toBe(true);
    expect(parseConfig({ shuffle: [] as unknown as boolean }).shuffle).toBe(true);
  });
});

describe('parseConfig per-field recovery', () => {
  it('round-trips a fully specified valid configuration unchanged', () => {
    const valid: SlideshowConfig = {
      durationSeconds: 12,
      shuffle: false,
      loop: false,
      animations: false,
      fillEmptySpace: false,
      startFullScreen: false,
      includeSubfolders: true,
    };
    const result = parseConfig(valid);
    expect(deepEqual(result, valid)).toBe(true);
  });

  it('keeps valid fields and defaults only the invalid ones in a mixed record', () => {
    const result = parseConfig({
      durationSeconds: 99,
      shuffle: 'no',
      loop: true,
    } as unknown as SlideshowConfig);
    expect(result.durationSeconds).toBe(30);
    expect(result.shuffle).toBe(true);
    expect(result.loop).toBe(true);
    expect(result.animations).toBe(true);
    expect(result.fillEmptySpace).toBe(true);
    expect(result.startFullScreen).toBe(true);
    expect(result.includeSubfolders).toBe(false);
  });

  it('always returns exactly the seven SlideshowConfig keys', () => {
    const testCases = [{}, { durationSeconds: 5 }, { shuffle: false }, { nope: 1, theme: 'dark' }];
    testCases.forEach((input) => {
      const result = parseConfig(input);
      expect(Object.keys(result).length).toBe(7);
      expect(Object.keys(result)).toEqual([
        'durationSeconds',
        'shuffle',
        'loop',
        'animations',
        'fillEmptySpace',
        'startFullScreen',
        'includeSubfolders',
      ]);
    });
  });

  it('drops unknown keys instead of copying them through', () => {
    const result = parseConfig({
      durationSeconds: 9,
      nope: 1,
      theme: 'dark',
    } as unknown as SlideshowConfig);
    expect(result.durationSeconds).toBe(9);
    expect(Object.prototype.hasOwnProperty.call(result, 'nope')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'theme')).toBe(false);
  });
});

describe('parseConfig hostile input', () => {
  const adversarialTable = [
    undefined,
    null,
    'string',
    42,
    true,
    [],
    [1, 2, 3],
    ((): void => undefined) as unknown,
    {},
    { durationSeconds: 0 },
    { durationSeconds: -5 },
    { durationSeconds: 31 },
    { durationSeconds: 1e9 },
    { durationSeconds: 1 },
    { durationSeconds: 30 },
    { durationSeconds: 7.6 },
    { durationSeconds: 7.4 },
    { durationSeconds: 7.5 },
    { durationSeconds: 0.4 },
    { durationSeconds: 30.6 },
    { durationSeconds: NaN },
    { durationSeconds: Infinity },
    { durationSeconds: -Infinity },
    { durationSeconds: '5' },
    { durationSeconds: '7' },
    { durationSeconds: null },
    { durationSeconds: true },
    { shuffle: false },
    { shuffle: 'false' },
    { shuffle: 'true' },
    { loop: 'false' },
    { includeSubfolders: 'true' },
    { shuffle: 0 },
    { shuffle: 1 },
    { shuffle: null },
    { fillEmptySpace: undefined },
    {
      durationSeconds: 12,
      shuffle: false,
      loop: false,
      animations: false,
      fillEmptySpace: false,
      startFullScreen: false,
      includeSubfolders: true,
    },
    { durationSeconds: 99, shuffle: 'no', loop: true },
    { durationSeconds: 9, nope: 1, theme: 'dark' },
  ];

  it('never throws for any input in the adversarial table', () => {
    adversarialTable.forEach((value) => {
      expect(() => parseConfig(value)).not.toThrow();
    });
  });

  it('ignores a JSON-parsed __proto__ key and leaves the result prototype clean', () => {
    const jsonProtoPayload = JSON.parse('{"__proto__":{"shuffle":false},"durationSeconds":9}');
    const result = parseConfig(jsonProtoPayload);
    expect(result.durationSeconds).toBe(9);
    expect(result.shuffle).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('does not pollute Object.prototype when given a JSON-parsed __proto__ payload', () => {
    const before = Object.prototype.hasOwnProperty.call(Object.prototype, 'shuffle');
    JSON.parse('{"__proto__":{"shuffle":false}}');
    parseConfig(JSON.parse('{"__proto__":{"shuffle":false},"durationSeconds":9}'));
    const after = Object.prototype.hasOwnProperty.call(Object.prototype, 'shuffle');
    expect(before).toBe(after);
    expect(after).toBe(false);
  });

  it('ignores values inherited from a tampered prototype', () => {
    const obj = { durationSeconds: 9 };
    Object.setPrototypeOf(obj, { shuffle: false });
    const result = parseConfig(obj);
    expect(result.durationSeconds).toBe(9);
    expect(result.shuffle).toBe(true);
  });

  it('handles an Object.create(null) input without throwing', () => {
    const obj = Object.create(null);
    obj.durationSeconds = 9;
    const result = parseConfig(obj);
    expect(result.durationSeconds).toBe(9);
    expect(deepEqual({ ...result }, { ...DEFAULT_CONFIG, durationSeconds: 9 })).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = {
      durationSeconds: 15,
      shuffle: false,
      loop: true,
      animations: false,
      fillEmptySpace: true,
      startFullScreen: false,
      includeSubfolders: true,
      extra: 'should-be-ignored',
    };
    const before = deepClone(input);
    parseConfig(input);
    const after = deepClone(input);
    expect(deepEqual(before, after)).toBe(true);
  });

  it('returns a result whose durationSeconds is always an integer within 1..30', () => {
    adversarialTable.forEach((value) => {
      const result = parseConfig(value);
      expect(Number.isInteger(result.durationSeconds)).toBe(true);
      expect(result.durationSeconds).toBeGreaterThanOrEqual(MIN_DURATION_SECONDS);
      expect(result.durationSeconds).toBeLessThanOrEqual(MAX_DURATION_SECONDS);
    });
  });
});

describe('parseConfig idempotence', () => {
  it('returns an equal result when applied to its own output', () => {
    const testCases = [
      undefined,
      null,
      {},
      { durationSeconds: 5 },
      {
        durationSeconds: 12,
        shuffle: false,
        loop: true,
        animations: false,
        fillEmptySpace: true,
        startFullScreen: false,
        includeSubfolders: true,
      },
    ];

    testCases.forEach((input) => {
      const first = parseConfig(input);
      const second = parseConfig(first);
      expect(deepEqual(first, second)).toBe(true);
    });
  });
});
