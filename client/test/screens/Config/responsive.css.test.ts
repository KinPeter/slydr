import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/screens/Config/Config.module.css',
);

describe('configuration responsive CSS', () => {
  it('uses a full-width mobile column and centred desktop column', () => {
    const css = fs.readFileSync(file, 'utf8');
    expect(css).toContain('width: 100%');
    expect(css).toContain('max-width: 35rem');
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('env(safe-area-inset-left)');
  });
});
