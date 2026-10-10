import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const cssFiles = fs
  .readdirSync(src, { recursive: true })
  .filter((file): file is string => typeof file === 'string' && file.endsWith('.css'))
  .map((file) => path.join(src, file));
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const contents = cssFiles.map((file) => ({
  file,
  css: withoutComments(fs.readFileSync(file, 'utf8')),
}));
const tokens = contents.find(({ file }) => file.endsWith('styles/tokens.css'))?.css ?? '';
const breakpoints = [...tokens.matchAll(/--bp-(?:sm|md|lg|xl):\s*(\d+)px/g)].map((m) =>
  Number(m[1]),
);
const allowed = new Set([
  ...breakpoints.map((n) => `${n}px`),
  ...breakpoints.map((n) => `${n - 0.02}px`),
]);

describe('responsive stylesheet tripwires', () => {
  it('uses only canonical media widths', () => {
    for (const { file, css } of contents) {
      for (const match of css.matchAll(/\((?:min|max)-width:\s*([^)]+)\)/g)) {
        expect(allowed, `${file}: ${match[0]}`).toContain(match[1]?.trim());
      }
    }
  });

  it('does not use pixel font sizes or whole-pixel max breakpoints', () => {
    for (const { file, css } of contents) {
      expect(css, file).not.toMatch(/font-size\s*:\s*[^;]*px/);
      expect(css, file).not.toMatch(/max-width:\s*(?:479|767|1023|1439)px/);
    }
  });

  it('does not hide horizontal overflow globally', () => {
    for (const { file, css } of contents) {
      expect(css, file).not.toMatch(/(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*hidden/);
    }
  });

  it('pairs every 100vh declaration with 100dvh', () => {
    for (const { file, css } of contents) {
      for (const rule of css.matchAll(/[^{}]+\{([^{}]*)\}/g)) {
        if (rule[1]?.includes('100vh')) expect(rule[1], file).toContain('100dvh');
      }
    }
  });

  it('keeps hover rules in hover-capable media blocks', () => {
    for (const { file, css } of contents) {
      for (const match of css.matchAll(/([^{}]*)\{[^{}]*:hover[^{}]*\}/g)) {
        const before = css.slice(0, match.index ?? 0);
        expect(before.slice(before.lastIndexOf('@media'), before.length), file).toContain(
          '(hover: hover)',
        );
      }
    }
  });
});
