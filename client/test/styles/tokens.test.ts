import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// The stylesheets under test. jsdom cannot evaluate `prefers-color-scheme`,
// so these tests parse the CSS text instead of asserting on getComputedStyle.
// Live cascade verification in all four states is manual (see §7).
let tokensCss = '';
let slideImageCss = '';

async function readClientFile(...segments: Array<string>): Promise<string> {
  const candidates = [join(process.cwd(), 'client', ...segments), join(process.cwd(), ...segments)];
  let lastError: unknown = new Error('client file not found');
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

beforeAll(async () => {
  tokensCss = await readClientFile('src', 'styles', 'tokens.css');
  slideImageCss = await readClientFile('src', 'screens', 'Player', 'SlideImage.module.css');
});

// ---------------------------------------------------------------------------
// CSS parsing helpers (test scaffolding — must not reach the bundle)
// ---------------------------------------------------------------------------

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseDeclarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const name = m[1];
    const value = m[2];
    if (name !== undefined && value !== undefined) {
      map.set(name, value.trim());
    }
  }
  return map;
}

function extractBlock(css: string, pattern: RegExp): string {
  const m = pattern.exec(css);
  if (m === null || m[1] === undefined) {
    throw new Error(`expected CSS block not found: ${pattern}`);
  }
  return m[1];
}

function countMatches(css: string, pattern: RegExp): number {
  return (css.match(pattern) ?? []).length;
}

interface ThemeBlocks {
  baseline: Map<string, string>;
  guardDark: Map<string, string>;
  attrDark: Map<string, string>;
  attrLight: Map<string, string>;
  baselineScheme: string;
  guardDarkScheme: string;
  attrDarkScheme: string;
  attrLightScheme: string;
}

function colorSchemeOf(block: string): string {
  const m = /color-scheme\s*:\s*([^;]+);/.exec(block);
  if (m === null || m[1] === undefined) {
    throw new Error('theme block declares no color-scheme');
  }
  return m[1].trim();
}

function themeBlocks(): ThemeBlocks {
  const css = stripComments(tokensCss);
  const baseline = extractBlock(css, /(?:^|\n)\s*:root\s*\{([\s\S]*?)\}/);
  const guardDark = extractBlock(
    css,
    /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\}\s*\}/,
  );
  const attrDark = extractBlock(css, /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/);
  const attrLight = extractBlock(css, /:root\[data-theme='light'\]\s*\{([\s\S]*?)\}/);
  return {
    baseline: parseDeclarations(baseline),
    guardDark: parseDeclarations(guardDark),
    attrDark: parseDeclarations(attrDark),
    attrLight: parseDeclarations(attrLight),
    baselineScheme: colorSchemeOf(baseline),
    guardDarkScheme: colorSchemeOf(guardDark),
    attrDarkScheme: colorSchemeOf(attrDark),
    attrLightScheme: colorSchemeOf(attrLight),
  };
}

/** Dark theme values: the light baseline overridden by the dark block. */
function darkTheme(): Map<string, string> {
  const blocks = themeBlocks();
  return new Map([...blocks.baseline, ...blocks.attrDark]);
}

// ---------------------------------------------------------------------------
// WCAG 2.1 contrast helpers (test scaffolding — must not reach the bundle)
// ---------------------------------------------------------------------------

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = srgbToLinear((n >> 16) & 0xff);
  const g = srgbToLinear((n >> 8) & 0xff);
  const b = srgbToLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function lookup(theme: Map<string, string>, name: string): string {
  const value = theme.get(name);
  if (value === undefined) {
    throw new Error(`token ${name} is not declared`);
  }
  return value;
}

function expectTextContrast(
  theme: Map<string, string>,
  fgVar: string,
  bgVar: string,
  min = 4.5,
): void {
  expect(contrast(lookup(theme, fgVar), lookup(theme, bgVar))).toBeGreaterThanOrEqual(min);
}

function expectNonTextContrast(
  theme: Map<string, string>,
  fgVar: string,
  bgVar: string,
  min = 3,
): void {
  expect(contrast(lookup(theme, fgVar), lookup(theme, bgVar))).toBeGreaterThanOrEqual(min);
}

function parseRgba(value: string): { r: number; g: number; b: number; a: number } {
  const m = /rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(value);
  if (
    m === null ||
    m[1] === undefined ||
    m[2] === undefined ||
    m[3] === undefined ||
    m[4] === undefined
  ) {
    throw new Error(`expected an rgba() value, got: ${value}`);
  }
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) };
}

/** Composite a translucent overlay colour over a pure white photo (worst case). */
function compositeOverWhite(rgba: string): string {
  const { r, g, b, a } = parseRgba(rgba);
  const channel = (fg: number): string =>
    Math.round(a * fg + (1 - a) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function compositeOver(rgba: string, backdrop: string): string {
  const { r, g, b, a } = parseRgba(rgba);
  const n = parseInt(backdrop.slice(1), 16);
  const br = (n >> 16) & 0xff;
  const bg = (n >> 8) & 0xff;
  const bb = n & 0xff;
  const channel = (fg: number, base: number): string =>
    Math.round(a * fg + (1 - a) * base)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r, br)}${channel(g, bg)}${channel(b, bb)}`;
}

function expectOverlayContrast(theme: Map<string, string>, fgVar: string, min = 4.5): void {
  const composited = compositeOverWhite(lookup(theme, '--overlay-bg'));
  expect(contrast(lookup(theme, fgVar), composited)).toBeGreaterThanOrEqual(min);
}

// ---------------------------------------------------------------------------
// Token completeness (spec §6.4)
// ---------------------------------------------------------------------------

describe('tokens.css — token completeness', () => {
  it('declares every token required by spec §6.4 on :root', () => {
    const { baseline } = themeBlocks();
    const required = [
      '--bg',
      '--bg-elevated',
      '--bg-sunken',
      '--fg',
      '--fg-muted',
      '--border',
      '--accent',
      '--accent-fg',
      '--focus-ring',
      '--danger',
      '--overlay-bg',
      '--shadow-1',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--space-7',
      '--space-8',
      '--font-ui',
      '--dur-fast',
      '--dur-base',
      '--dur-slow',
      '--ease-standard',
    ];
    for (const name of required) {
      expect(baseline.has(name), `missing token ${name}`).toBe(true);
    }
  });

  it('declares --player-bg as pure white on the light baseline', () => {
    expect(themeBlocks().baseline.get('--player-bg')).toBe('#ffffff');
  });

  it('declares --player-bg as pure black in both dark blocks', () => {
    const blocks = themeBlocks();
    expect(blocks.guardDark.get('--player-bg')).toBe('#000000');
    expect(blocks.attrDark.get('--player-bg')).toBe('#000000');
  });

  it('declares --slide-transition-duration as 700ms', () => {
    expect(themeBlocks().baseline.get('--slide-transition-duration')).toBe('700ms');
  });

  it('declares the slower Ken Burns target scale', () => {
    expect(themeBlocks().baseline.get('--kenburns-scale')).toBe('1.04');
  });

  it('uses smooth timing for the Ken Burns animation', () => {
    expect(slideImageCss).toContain('animation: kenburns var(--kb-duration) ease-in-out forwards;');
  });

  it('keeps the transition scale independent from the Ken Burns target', () => {
    const { baseline } = themeBlocks();
    expect(baseline.get('--slide-out-scale-from')).toBe('1.06');
    expect(baseline.get('--slide-out-scale-from')).not.toBe(baseline.get('--kenburns-scale'));
    expect(baseline.get('--slide-out-scale-to')).toBe('1.1');
    expect(baseline.get('--slide-in-scale-from')).toBe('0.96');
    expect(baseline.get('--slide-in-scale-to')).toBe('1');
  });

  it('declares the four spec §10 breakpoints as --bp-sm/md/lg/xl with 480/768/1024/1440px', () => {
    const { baseline } = themeBlocks();
    expect(baseline.get('--bp-sm')).toBe('480px');
    expect(baseline.get('--bp-md')).toBe('768px');
    expect(baseline.get('--bp-lg')).toBe('1024px');
    expect(baseline.get('--bp-xl')).toBe('1440px');
  });
});

// ---------------------------------------------------------------------------
// Dark cascade (spec §6.3)
// ---------------------------------------------------------------------------

describe('tokens.css — dark cascade (spec §6.3)', () => {
  it('has exactly four top-level theme blocks', () => {
    const css = stripComments(tokensCss);
    expect(countMatches(css, /:root\s*\{/g)).toBe(1);
    expect(countMatches(css, /:root:not\(\[data-theme='light'\]\)/g)).toBe(1);
    expect(countMatches(css, /:root\[data-theme='dark'\]/g)).toBe(1);
    expect(countMatches(css, /:root\[data-theme='light'\]/g)).toBe(1);
    expect(countMatches(css, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/g)).toBe(1);
  });

  it("sets color-scheme: light dark on :root, light under [data-theme='light'], dark in both dark blocks", () => {
    const blocks = themeBlocks();
    expect(blocks.baselineScheme).toBe('light dark');
    expect(blocks.attrLightScheme).toBe('light');
    expect(blocks.guardDarkScheme).toBe('dark');
    expect(blocks.attrDarkScheme).toBe('dark');
  });

  it("guards the prefers-color-scheme block with :root:not([data-theme='light'])", () => {
    const css = stripComments(tokensCss);
    expect(css).toMatch(
      /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{\s*:root:not\(\[data-theme='light'\]\)/,
    );
  });

  it("also declares the dark values under :root[data-theme='dark']", () => {
    const css = stripComments(tokensCss);
    expect(css).toMatch(/:root\[data-theme='dark'\]\s*\{/);
    // The attribute block is unconditional: it sits outside any @media rule.
    const mediaStart = css.indexOf('@media');
    const mediaEnd = css.indexOf(":root[data-theme='dark']");
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    expect(mediaEnd).toBeGreaterThan(mediaStart);
    const mediaBlock = css.slice(mediaStart, mediaEnd);
    let depth = 0;
    for (const ch of mediaBlock) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
    }
    expect(depth).toBe(0);
  });

  it('declares the identical property set in both dark blocks', () => {
    const blocks = themeBlocks();
    expect([...blocks.attrDark.keys()].sort()).toEqual([...blocks.guardDark.keys()].sort());
  });

  it('declares the identical value for every property in both dark blocks', () => {
    const blocks = themeBlocks();
    for (const [name, guardValue] of blocks.guardDark) {
      expect(blocks.attrDark.get(name), `dark value drifted for ${name}`).toBe(guardValue);
    }
  });
});

// ---------------------------------------------------------------------------
// WCAG 2.1 AA contrast (NFR-6)
// ---------------------------------------------------------------------------

describe('tokens.css — WCAG 2.1 AA contrast (NFR-6)', () => {
  it('light: --fg on --bg meets 4.5:1', () => {
    expectTextContrast(themeBlocks().baseline, '--fg', '--bg');
  });

  it('light: --fg-muted on --bg meets 4.5:1', () => {
    expectTextContrast(themeBlocks().baseline, '--fg-muted', '--bg');
  });

  it('light: --fg-muted on --bg-elevated and --bg-sunken meets 4.5:1', () => {
    const light = themeBlocks().baseline;
    expectTextContrast(light, '--fg-muted', '--bg-elevated');
    expectTextContrast(light, '--fg-muted', '--bg-sunken');
  });

  it('light: --fg on --bg-elevated meets 4.5:1', () => {
    expectTextContrast(themeBlocks().baseline, '--fg', '--bg-elevated');
  });

  it('light: --fg on --bg-sunken meets 4.5:1', () => {
    expectTextContrast(themeBlocks().baseline, '--fg', '--bg-sunken');
  });

  it('light: --accent on --bg meets 4.5:1', () => {
    expectTextContrast(themeBlocks().baseline, '--accent', '--bg');
  });

  it('light: --accent-fg on --accent meets 4.5:1', () => {
    expectTextContrast(themeBlocks().baseline, '--accent-fg', '--accent');
  });

  it('light: --accent and --danger on --bg-elevated meet 4.5:1', () => {
    const light = themeBlocks().baseline;
    expectTextContrast(light, '--accent', '--bg-elevated');
    expectTextContrast(light, '--danger', '--bg-elevated');
  });

  it('light: --danger on --bg meets 4.5:1', () => {
    expectTextContrast(themeBlocks().baseline, '--danger', '--bg');
  });

  it('light: --border on --bg, --bg-elevated and --bg-sunken meets 3:1 for non-text contrast', () => {
    const light = themeBlocks().baseline;
    expectNonTextContrast(light, '--border', '--bg');
    expectNonTextContrast(light, '--border', '--bg-elevated');
    expectNonTextContrast(light, '--border', '--bg-sunken');
  });

  it('light: --focus-ring on --bg meets 3:1 for non-text contrast', () => {
    expectNonTextContrast(themeBlocks().baseline, '--focus-ring', '--bg');
  });

  it('light: focus ring and accent meet the additional UI contrast pairs', () => {
    const light = themeBlocks().baseline;
    expectNonTextContrast(light, '--focus-ring', '--bg-elevated');
    expectNonTextContrast(light, '--focus-ring', '--bg-sunken');
    expectNonTextContrast(light, '--accent', '--bg');
    expectNonTextContrast(light, '--accent', '--bg-elevated');
  });

  it('light: --overlay-fg and --overlay-fg-muted on --overlay-bg composited over pure white meet 4.5:1', () => {
    const light = themeBlocks().baseline;
    expectOverlayContrast(light, '--overlay-fg');
    expectOverlayContrast(light, '--overlay-fg-muted');
  });

  it('dark: --fg on --bg meets 4.5:1', () => {
    expectTextContrast(darkTheme(), '--fg', '--bg');
  });

  it('dark: --fg-muted on --bg meets 4.5:1', () => {
    expectTextContrast(darkTheme(), '--fg-muted', '--bg');
  });

  it('dark: --fg-muted on --bg-elevated and --bg-sunken meets 4.5:1', () => {
    const dark = darkTheme();
    expectTextContrast(dark, '--fg-muted', '--bg-elevated');
    expectTextContrast(dark, '--fg-muted', '--bg-sunken');
  });

  it('dark: --fg on --bg-elevated meets 4.5:1', () => {
    expectTextContrast(darkTheme(), '--fg', '--bg-elevated');
  });

  it('dark: --fg on --bg-sunken meets 4.5:1', () => {
    expectTextContrast(darkTheme(), '--fg', '--bg-sunken');
  });

  it('dark: --accent on --bg meets 4.5:1', () => {
    expectTextContrast(darkTheme(), '--accent', '--bg');
  });

  it('dark: --accent-fg on --accent meets 4.5:1', () => {
    expectTextContrast(darkTheme(), '--accent-fg', '--accent');
  });

  it('dark: --accent and --danger on --bg-elevated meet 4.5:1', () => {
    const dark = darkTheme();
    expectTextContrast(dark, '--accent', '--bg-elevated');
    expectTextContrast(dark, '--danger', '--bg-elevated');
  });

  it('dark: --danger on --bg meets 4.5:1', () => {
    expectTextContrast(darkTheme(), '--danger', '--bg');
  });

  it('dark: --border on --bg, --bg-elevated and --bg-sunken meets 3:1 for non-text contrast', () => {
    const dark = darkTheme();
    expectNonTextContrast(dark, '--border', '--bg');
    expectNonTextContrast(dark, '--border', '--bg-elevated');
    expectNonTextContrast(dark, '--border', '--bg-sunken');
  });

  it('dark: --focus-ring on --bg meets 3:1 for non-text contrast', () => {
    expectNonTextContrast(darkTheme(), '--focus-ring', '--bg');
  });

  it('dark: focus ring on accent and accent UI pairs meet 3:1', () => {
    const dark = darkTheme();
    expectNonTextContrast(dark, '--focus-ring', '--bg-elevated');
    expectNonTextContrast(dark, '--focus-ring', '--bg-sunken');
    expectNonTextContrast(dark, '--focus-ring', '--accent');
    expectNonTextContrast(dark, '--accent', '--bg');
    expectNonTextContrast(dark, '--accent', '--bg-elevated');
  });

  it('dark: --overlay-fg and --overlay-fg-muted on --overlay-bg composited over pure white meet 4.5:1', () => {
    const dark = darkTheme();
    expectOverlayContrast(dark, '--overlay-fg');
    expectOverlayContrast(dark, '--overlay-fg-muted');
  });

  it('overlay foreground remains readable over a mid-grey photo', () => {
    for (const theme of [themeBlocks().baseline, darkTheme()]) {
      const backdrop = compositeOver(lookup(theme, '--overlay-bg'), '#808080');
      expect(contrast(lookup(theme, '--overlay-fg'), backdrop)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(lookup(theme, '--overlay-fg-muted'), backdrop)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
