import { describe, expect, it } from 'vitest';
import { cancelAllThumbnails } from '../../../src/screens/Explorer/thumbnailQueue';

describe('cancelAllThumbnails stub', () => {
  it('can be called with nothing queued', () => {
    expect(() => cancelAllThumbnails()).not.toThrow();
  });
});
