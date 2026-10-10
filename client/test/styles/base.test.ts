import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let baseCss = '';

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
  baseCss = await readClientFile('src', 'styles', 'base.css');
});

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** All top-level rule bodies for a given selector in comment-stripped CSS. */
function ruleBodies(css: string, selectorPattern: string): Array<string> {
  const bodies: Array<string> = [];
  const re = new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    if (m[1] !== undefined) {
      bodies.push(m[1]);
    }
  }
  return bodies;
}

describe('base.css', () => {
  it('applies box-sizing: border-box to all elements', () => {
    expect(stripComments(baseCss)).toMatch(
      /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{\s*box-sizing:\s*border-box\s*;/,
    );
  });

  it('sets html font-size to 100% so browser zoom and font preferences still work', () => {
    const bodies = ruleBodies(stripComments(baseCss), 'html');
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((body) => /font-size:\s*100%/.test(body))).toBe(true);
  });

  it('sets body font-family to var(--font-ui) and font-size to var(--text-md)', () => {
    const combined = ruleBodies(stripComments(baseCss), 'body').join('\n');
    expect(combined).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(combined).toMatch(/font-size:\s*var\(--text-md\)/);
  });

  it('defines a :focus-visible outline built from var(--focus-ring) with a non-zero offset', () => {
    const bodies = ruleBodies(stripComments(baseCss), ':focus-visible');
    const global = bodies[0];
    expect(global).toBeDefined();
    if (global === undefined) {
      throw new Error('no :focus-visible rule found');
    }
    expect(global).toMatch(/outline:\s*[^;]*var\(--focus-ring\)/);
    const offset = /outline-offset:\s*([^;]+);/.exec(global);
    expect(offset).not.toBeNull();
    if (offset === null || offset[1] === undefined) {
      throw new Error('no outline-offset found in the :focus-visible rule');
    }
    expect(offset[1].trim()).not.toMatch(/^0(px|rem|em)?$/);
  });

  it('contains no bare "outline: none" outside the :focus:not(:focus-visible) rule', () => {
    // `.focus-ring-inset:focus-visible` also uses `outline: none`, but it is
    // not bare: the same rule paints a two-layer box-shadow replacement.
    const css = stripComments(baseCss);
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const selector = (m[1] ?? '').trim();
      const body = m[2] ?? '';
      if (!/outline\s*:\s*none/.test(body)) {
        continue;
      }
      const allowed =
        selector.includes(':focus:not(:focus-visible)') || /box-shadow\s*:/.test(body);
      expect(allowed, `bare "outline: none" in rule: ${selector}`).toBe(true);
    }
  });

  it('prevents horizontal page scroll with overflow-x: clip on body, and never uses overflow-x: hidden or any overflow on html (sticky positioning, spec §7.1)', () => {
    const css = stripComments(baseCss);
    const bodyCombined = ruleBodies(css, 'body').join('\n');
    expect(bodyCombined).toMatch(/overflow-x:\s*clip/);
    expect(bodyCombined).toMatch(/max-width:\s*100%/);
    expect(css).not.toMatch(/overflow-x:\s*hidden/);
    for (const body of ruleBodies(css, 'html')) {
      expect(body).not.toMatch(/overflow/);
    }
  });

  it('does not set color-scheme (tokens.css owns it)', () => {
    expect(stripComments(baseCss)).not.toMatch(/color-scheme/);
  });

  it('the global :focus-visible rule sets no border-radius', () => {
    const bodies = ruleBodies(stripComments(baseCss), ':focus-visible');
    const global = bodies[0];
    expect(global).toBeDefined();
    if (global === undefined) {
      throw new Error('no :focus-visible rule found');
    }
    expect(global).not.toMatch(/border-radius/);
  });

  it('.page-gutter pads left and right with the matching safe-area insets', () => {
    const bodies = ruleBodies(stripComments(baseCss), '\\.page-gutter');
    expect(bodies.length).toBeGreaterThan(0);
    const combined = bodies.join('\n');
    expect(combined).toMatch(
      /padding-left:\s*max\(var\(--page-gutter\),\s*env\(safe-area-inset-left\)\)/,
    );
    expect(combined).toMatch(
      /padding-right:\s*max\(var\(--page-gutter\),\s*env\(safe-area-inset-right\)\)/,
    );
  });

  it('contains no nested comment terminator inside the breakpoint documentation block', () => {
    const marker = 'Breakpoint convention';
    const markerIndex = baseCss.indexOf(marker);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    const openIndex = baseCss.lastIndexOf('/*', markerIndex);
    const closeIndex = baseCss.indexOf('*/', markerIndex);
    expect(openIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThan(markerIndex);
    const inner = baseCss.slice(openIndex + 2, closeIndex);
    expect(inner).not.toContain('/*');
    expect(inner).not.toContain('*/');
  });

  it('documents only the four spec §10 breakpoint values and no others', () => {
    // The convention is documentation: the four values live in the breakpoint
    // comment block, and base.css itself adds no real breakpoint rules yet.
    const values = new Set<string>();
    const re = /min-width:\s*(\d+)px/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(baseCss)) !== null) {
      if (m[1] !== undefined) {
        values.add(m[1]);
      }
    }
    expect([...values].sort()).toEqual(['1024', '1440', '480', '768']);
    // No max-width breakpoint condition anywhere (comment prose or real rule).
    expect(baseCss).not.toMatch(/@media[^{]*max-width\s*:/);
    // No real (non-comment) min-width rule: the values above are doc-only.
    expect(stripComments(baseCss)).not.toMatch(/min-width:/);
  });

  it('forces reduced motion under prefers-reduced-motion: reduce', () => {
    expect(stripComments(baseCss)).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)[\s\S]*?animation-duration/,
    );
  });
});
