import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(
  path.resolve(process.cwd(), 'client/src/screens/Player/PlayerBackground.module.css'),
  'utf8',
);

describe('PlayerBackground.module.css', () => {
  it('defines the full, clipped background and cover treatment', () => {
    expect(css).toContain('position: absolute');
    expect(css).toContain('inset: 0');
    expect(css).toContain('overflow: hidden');
    expect(css).toContain('object-fit: cover');
    expect(css).toContain('transform: scale(var(--player-bg-scale))');
    expect(css).toContain('blur(var(--player-bg-blur))');
    expect(css).toContain('brightness(var(--player-bg-brightness))');
    expect(css).toContain('saturate(var(--player-bg-saturate))');
  });

  it('animates only incoming opacity and never filter', () => {
    expect(css).toContain('animation: coverFadeIn');
    expect(css).toContain('from {\n    opacity: 0;');
    expect(css).toContain('to {\n    opacity: 1;');
    expect(css).not.toMatch(/transition[^;]*filter/);
    expect(css).not.toMatch(/@keyframes[\s\S]*?filter/);
    expect(css).toContain('will-change: transform');
    expect(css).not.toContain('will-change: filter');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('does not redeclare custom property tokens', () => {
    expect(css).not.toMatch(/--[\w-]+\s*:/);
  });
});
