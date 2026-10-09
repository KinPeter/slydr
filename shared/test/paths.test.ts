import { describe, it, expect } from 'vitest';
import {
  normalizeWirePath,
  wireJoin,
  wireParent,
  wireBasename,
  wireSegments,
  breadcrumbSegments,
} from '../src/index.js';

describe('normalizeWirePath', () => {
  it('returns the empty string unchanged for the jail root', () => {
    expect(normalizeWirePath('')).toBe('');
  });

  it('leaves a single-segment path unchanged', () => {
    expect(normalizeWirePath('Pictures')).toBe('Pictures');
  });

  it('leaves a multi-segment path unchanged', () => {
    expect(normalizeWirePath('Pictures/2024/summer')).toBe('Pictures/2024/summer');
  });

  it('strips a leading slash', () => {
    expect(normalizeWirePath('/Pictures')).toBe('Pictures');
  });

  it('strips a trailing slash', () => {
    expect(normalizeWirePath('Pictures/')).toBe('Pictures');
  });

  it('collapses duplicate internal slashes into one', () => {
    expect(normalizeWirePath('Pictures//2024')).toBe('Pictures/2024');
  });

  it('drops a leading "." segment', () => {
    expect(normalizeWirePath('./Pictures')).toBe('Pictures');
  });

  it('drops an internal "." segment', () => {
    expect(normalizeWirePath('Pictures/./2024')).toBe('Pictures/2024');
  });

  it('preserves a ".." segment untouched rather than resolving it', () => {
    expect(normalizeWirePath('../etc')).toBe('../etc');
    expect(normalizeWirePath('Pictures/..')).toBe('Pictures/..');
  });

  it('is idempotent: normalizing an already-normalized path returns the same string', () => {
    const path = 'Pictures/2024/summer';
    expect(normalizeWirePath(path)).toBe(path);
  });

  it('is idempotent: normalizing the output of a previous normalization of a messy path returns the same string', () => {
    const messy = '/Pictures//2024/./summer/';
    const normalized = normalizeWirePath(messy);
    expect(normalizeWirePath(normalized)).toBe(normalized);
  });
});

describe('wireJoin', () => {
  it('joins a segment onto the jail root', () => {
    expect(wireJoin('', 'Pictures')).toBe('Pictures');
  });

  it('joins a segment onto a non-root base', () => {
    expect(wireJoin('Pictures', '2024')).toBe('Pictures/2024');
  });

  it('returns the normalized base unchanged when segment is empty', () => {
    expect(wireJoin('Pictures', '')).toBe('Pictures');
  });

  it('returns the normalized segment unchanged when base is the jail root', () => {
    expect(wireJoin('', 'Pictures')).toBe('Pictures');
  });

  it('normalizes slashes contributed by either base or segment', () => {
    expect(wireJoin('/Pictures/', '2024')).toBe('Pictures/2024');
    expect(wireJoin('Pictures', '/2024/')).toBe('Pictures/2024');
  });
});

describe('wireParent', () => {
  it('returns null for the jail root', () => {
    expect(wireParent('')).toBeNull();
  });

  it('returns the jail root for a single-segment path', () => {
    expect(wireParent('Pictures')).toBe('');
  });

  it('returns the immediate parent for a multi-segment path', () => {
    expect(wireParent('Pictures/2024/summer')).toBe('Pictures/2024');
  });

  it('normalizes its input before computing the parent, e.g. a trailing slash', () => {
    expect(wireParent('Pictures/')).toBe('');
    expect(wireParent('Pictures/2024/')).toBe('Pictures');
  });
});

describe('wireBasename', () => {
  it('returns the empty string for the jail root', () => {
    expect(wireBasename('')).toBe('');
  });

  it('returns the whole path for a single-segment path', () => {
    expect(wireBasename('Pictures')).toBe('Pictures');
  });

  it('returns the final segment of a multi-segment path', () => {
    expect(wireBasename('Pictures/2024/summer')).toBe('summer');
  });

  it('ignores a trailing slash', () => {
    expect(wireBasename('Pictures/2024/summer/')).toBe('summer');
  });
});

describe('wireSegments', () => {
  it('returns an empty array for the jail root', () => {
    expect(wireSegments('')).toEqual([]);
  });

  it('returns a single-element array for a single-segment path', () => {
    expect(wireSegments('Pictures')).toEqual(['Pictures']);
  });

  it('returns an ordered array for a multi-segment path', () => {
    expect(wireSegments('Pictures/2024/summer')).toEqual(['Pictures', '2024', 'summer']);
  });

  it('collapses duplicate slashes and drops "." segments before splitting', () => {
    expect(wireSegments('Pictures//2024/./summer')).toEqual(['Pictures', '2024', 'summer']);
  });
});

describe('breadcrumbSegments', () => {
  it('returns only the Home root segment for the jail root', () => {
    expect(breadcrumbSegments('')).toEqual([{ label: 'Home', path: '' }]);
  });

  it('returns Home followed by one entry per segment for a three-segment path, each with the cumulative wire path', () => {
    expect(breadcrumbSegments('Pictures/2024/summer')).toEqual([
      { label: 'Home', path: '' },
      { label: 'Pictures', path: 'Pictures' },
      { label: '2024', path: 'Pictures/2024' },
      { label: 'summer', path: 'Pictures/2024/summer' },
    ]);
  });

  it('uses the raw segment name as the label for every non-root entry', () => {
    const result = breadcrumbSegments('Pictures');
    expect(result[1]?.label).toBe('Pictures');
  });
});
