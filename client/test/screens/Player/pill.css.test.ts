import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/screens/Player/PlayerControlsOverlay.module.css',
);

describe('player controls responsive CSS', () => {
  it('keeps the narrow pill within the touch-target contract', () => {
    const css = fs.readFileSync(file, 'utf8');
    const coarse = css.indexOf('@media (pointer: coarse)');
    const narrow = css.indexOf('@media (max-width: 767.98px)');
    expect(coarse).toBeGreaterThanOrEqual(0);
    expect(narrow).toBeGreaterThan(coarse);
    expect(css.slice(narrow)).toContain('min-width: var(--target-min-coarse)');
    expect(css.slice(narrow)).toContain('.counter {');
    expect(css.slice(narrow)).toContain('display: none');
    expect(css).not.toContain('border-radius: 999px');
  });
});
