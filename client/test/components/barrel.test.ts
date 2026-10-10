import { describe, expect, it } from 'vitest';
import * as components from '../../src/components';

describe('barrel exports', () => {
  it('exposes exactly the ten component names', () => {
    expect(Object.keys(components).sort()).toEqual([
      'Banner',
      'Breadcrumb',
      'Button',
      'Checkbox',
      'Chip',
      'Icon',
      'IconButton',
      'Skeleton',
      'Slider',
      'Spinner',
    ]);
  });
});
